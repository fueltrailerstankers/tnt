'use client';

import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { contentBlocks, type Block } from '@/lib/spec/content';
import { pages, type Cell } from '@/lib/spec/layout';
import type { FormSpec } from '@/lib/spec/types';
import type { ChecklistRow, EntryData } from '@/lib/spec/values';
import { isQuoteField } from '@/lib/forms/quote-fields';
import { FileField } from './FileField';
import { QuoteField } from './QuoteField';
import { SignaturePad } from './SignaturePad';
import type { ActionButton, ExistingFile, LookupConfig, QuoteConfig, SubmitState, UploadFn } from './types';

export interface FormRendererProps {
  spec: FormSpec;
  initial: EntryData;
  files: Record<string, ExistingFile[]>;
  signatures: Record<string, ExistingFile>;
  /** Buttons on the last page. Empty = read-only (no action available for this role and status). */
  actions: ActionButton[];
  submit: (state: SubmitState, fd: FormData) => Promise<SubmitState>;
  upload: UploadFn;
  supabase: { url: string; anonKey: string };
  lookup?: LookupConfig;
  lookupPanel?: Array<[string, string]>;
  /** Xero quote picker for the form's quote field (staff search or public check). Absent = plain text. */
  quotes?: QuoteConfig;
  hidden?: Record<string, string>;
  /** Public forms carry a honeypot field that real people never see. */
  honeypot?: boolean;
}

export function FormRenderer(props: FormRendererProps) {
  const { spec } = props;
  const allPages = useMemo(() => pages(spec), [spec]);
  const [state, formAction, pending] = useActionState(props.submit, {} as SubmitState);
  const [page, setPage] = useState(0);
  const [panel, setPanel] = useState(props.lookupPanel ?? []);
  const top = useRef<HTMLFormElement>(null);
  const readOnly = props.actions.length === 0;
  const errors = state.errors ?? {};

  // After a failed save, jump to the first page with an error.
  useEffect(() => {
    if (!state.at || !state.errors) return;
    const first = allPages.findIndex((p) => p.rows.some((r) => r.cells.some((c) => 'name' in c.field && state.errors![c.field.name])));
    if (first >= 0) setPage(first);
    top.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.at, state.errors, allPages]);

  const multiPage = allPages.length > 1;
  return (
    <form
      ref={top}
      noValidate
      className="space-y-4"
      aria-busy={pending}
      // Submitted by hand (not action=) so React does not reset the fields after a failed save.
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const fd = new FormData(e.currentTarget, submitter);
        startTransition(() => formAction(fd));
      }}
    >
      {Object.entries(props.hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {props.honeypot ? (
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Leave this empty
            <input type="text" name="__hp" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
      ) : null}
      {multiPage ? (
        <ol className="flex gap-2 text-xs" aria-label="Progress">
          {allPages.map((p) => (
            <li key={p.index} className={`rounded-full px-3 py-1 ${p.index === page ? 'bg-neutral-900 text-white' : 'bg-neutral-200 text-neutral-700'}`}>
              {p.title ?? `Page ${p.index + 1}`}
            </li>
          ))}
        </ol>
      ) : null}
      {state.message ? (
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{state.message}</p>
      ) : null}

      {allPages.map((p) => (
        <fieldset key={p.index} hidden={p.index !== page} disabled={readOnly} className="space-y-3">
          {p.title && multiPage ? <legend className="mb-2 text-lg font-semibold">{p.title}</legend> : null}
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-24">
            {p.rows.flatMap((r) =>
              r.cells.map((c, i) => (
                <div key={`${r.row}-${i}`} className="min-w-0 md:[grid-column:var(--gc)]" style={{ '--gc': `${c.col} / span ${c.span}` } as React.CSSProperties}>
                  <FieldView cell={c} {...props} errors={errors} readOnly={readOnly} panel={panel} setPanel={setPanel} />
                </div>
              )),
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {p.backButton ? (
              <button type="button" className="rounded border px-4 py-2" onClick={() => setPage((x) => Math.max(0, x - 1))}>
                {p.backButton}
              </button>
            ) : null}
            {p.index < allPages.length - 1 ? (
              <button type="button" className="rounded bg-neutral-900 px-4 py-2 text-white" onClick={() => { setPage((x) => x + 1); top.current?.scrollIntoView(); }}>
                {p.nextButton}
              </button>
            ) : (
              props.actions.map((a) => (
                <button key={a.name} type="submit" name="__action" value={a.name} disabled={pending} className="rounded bg-neutral-900 px-4 py-2 text-white disabled:opacity-60">
                  {pending ? 'Saving…' : a.label}
                </button>
              ))
            )}
          </div>
        </fieldset>
      ))}
    </form>
  );
}

type ViewProps = FormRendererProps & {
  cell: Cell;
  errors: Record<string, string>;
  readOnly: boolean;
  panel: Array<[string, string]>;
  setPanel: (p: Array<[string, string]>) => void;
};

const inputCls = (err?: string) =>
  `w-full rounded border px-3 py-2 text-base md:text-sm bg-white disabled:bg-neutral-100 ${err ? 'border-red-500' : 'border-neutral-300'}`;

function Label({ htmlFor, text, hidden }: { htmlFor: string; text: string; hidden?: boolean }) {
  return (
    <label htmlFor={htmlFor} className={hidden ? 'sr-only' : 'mb-1 block text-sm font-medium'}>
      {text}
    </label>
  );
}

function ErrorText({ msg, id }: { msg?: string; id: string }) {
  return msg ? <p id={id} className="mt-1 text-sm text-red-700">{msg}</p> : null;
}

export function ContentView({ blocks, scroll }: { blocks: Block[]; scroll: boolean }) {
  return (
    <div className={`rounded border border-neutral-300 bg-neutral-50 p-3 text-sm leading-relaxed ${scroll ? 'max-h-80 overflow-y-auto' : ''}`} tabIndex={scroll ? 0 : undefined}>
      {blocks.map((b, i) => (
        <p key={i} className="mb-2 last:mb-0">
          {b.spans.map((s, j) => (s.bold ? <strong key={j}>{s.text}</strong> : <span key={j}>{s.text}</span>))}
        </p>
      ))}
    </div>
  );
}

function FieldView(p: ViewProps) {
  const f = p.cell.field;
  if (f.type === 'content') return <ContentView blocks={contentBlocks(f)} scroll={!!f.contentRef} />;

  const name = 'name' in f ? f.name : '';
  const id = `f-${name}`;
  const err = p.errors[name];
  const v = p.initial[name];
  const errProps = err ? { 'aria-invalid': true, 'aria-describedby': `${id}-err` } : {};
  const label = 'label' in f ? f.label.trim() || name : name;

  if (f.type === 'text' && p.quotes && isQuoteField(p.spec.slug, name)) {
    return (
      <QuoteField
        id={id} name={name} label={label} hideLabel={'hideLabel' in f && !!f.hideLabel}
        value={v === undefined || v === null ? '' : String(v)} err={err} disabled={p.readOnly}
        config={p.quotes} inputClassName={inputCls(err)}
      />
    );
  }

  switch (f.type) {
    case 'text':
    case 'email':
    case 'date':
    case 'number':
      return (
        <div>
          <Label htmlFor={id} text={label} hidden={'hideLabel' in f && f.hideLabel} />
          <input
            id={id}
            name={`f.${name}`}
            type={f.type === 'number' ? 'number' : f.type}
            step={f.type === 'number' ? (f.integer ? 1 : 'any') : undefined}
            inputMode={f.type === 'number' ? (f.integer ? 'numeric' : 'decimal') : undefined}
            placeholder={'hideLabel' in f && f.hideLabel ? label : undefined}
            defaultValue={v === undefined || v === null ? '' : String(v)}
            autoComplete="off"
            className={inputCls(err)}
            {...errProps}
          />
          <ErrorText msg={err} id={`${id}-err`} />
        </div>
      );
    case 'textarea':
      return (
        <div>
          <Label htmlFor={id} text={label} />
          <textarea id={id} name={`f.${name}`} rows={3} defaultValue={(v as string) ?? ''} className={inputCls(err)} {...errProps} />
          <ErrorText msg={err} id={`${id}-err`} />
        </div>
      );
    case 'choice':
      if (f.style === 'checkboxes' || f.multi) {
        const selected = new Set(Array.isArray(v) ? (v as string[]) : v ? [String(v)] : []);
        return (
          <fieldset {...errProps}>
            <legend className="mb-1 text-sm font-medium">{label}</legend>
            <div className="flex flex-wrap gap-4">
              {f.options.map((o) => (
                <label key={o} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name={`f.${name}`} value={o} defaultChecked={selected.has(o)} className="h-5 w-5" />
                  {o}
                </label>
              ))}
            </div>
            <ErrorText msg={err} id={`${id}-err`} />
          </fieldset>
        );
      }
      return (
        <div>
          <Label htmlFor={id} text={label} />
          <select id={id} name={`f.${name}`} defaultValue={(v as string) ?? ''} className={inputCls(err)} {...errProps}>
            <option value="" />
            {f.options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <ErrorText msg={err} id={`${id}-err`} />
        </div>
      );
    case 'name':
    case 'address': {
      const obj = (v ?? {}) as Record<string, string>;
      const partLabel: Record<string, string> = { Line1: 'Address Line 1', Line2: 'Address Line 2', PostalCode: 'Postal / Zip Code', State: 'State / Province / Region' };
      return (
        <fieldset {...errProps}>
          <legend className="mb-1 text-sm font-medium">{label}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {f.parts.map((part) => (
              <div key={part} className={f.type === 'address' && part.startsWith('Line') ? 'sm:col-span-2' : ''}>
                <label htmlFor={`${id}-${part}`} className="text-xs text-neutral-600">{partLabel[part] ?? part}</label>
                <input id={`${id}-${part}`} name={`f.${name}.${part}`} defaultValue={obj[part] ?? ''} autoComplete="off" className={inputCls(err)} />
              </div>
            ))}
          </div>
          <ErrorText msg={err} id={`${id}-err`} />
        </fieldset>
      );
    }
    case 'lookup':
      return <LookupView {...p} id={id} name={name} label={label} err={err} value={(v as string) ?? ''} />;
    case 'table':
      return (
        <div aria-live="polite">
          <span className="mb-1 block text-sm font-medium">Customer details</span>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded border border-neutral-300 bg-neutral-50 p-3 text-sm" data-testid="customer-panel">
            {p.panel.length ? (
              p.panel.map(([k, val]) => (
                <div key={k} className="contents">
                  <dt className="text-neutral-600">{k}</dt>
                  <dd>{val || '-'}</dd>
                </div>
              ))
            ) : (
              <dd className="col-span-2 text-neutral-600">Choose a quote no to show the customer.</dd>
            )}
          </dl>
        </div>
      );
    case 'section':
      return <ChecklistView spec={p.spec} rows={(p.initial.checklist as ChecklistRow[] | undefined) ?? []} label={label} />;
    case 'file':
      return (
        <FileField
          name={name} label={label} multi={!!f.multi} maxFiles={f.maxFiles} accept={f.accept}
          existing={p.files[name] ?? []} upload={p.upload} supabase={p.supabase} error={err} disabled={p.readOnly}
        />
      );
    case 'signature':
      return <SignaturePad name={name} label={label} existing={p.signatures[name] ?? null} error={err} disabled={p.readOnly} />;
  }
}

function LookupView(p: ViewProps & { id: string; name: string; label: string; err?: string; value: string }) {
  const [value, setValue] = useState(p.value);
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const cfg = p.lookup;
  if (!cfg) return null;
  if (cfg.mode === 'list') {
    return (
      <div>
        <Label htmlFor={p.id} text={p.label} />
        <select
          id={p.id}
          name={`f.${p.name}`}
          value={value}
          onChange={async (e) => {
            setValue(e.target.value);
            p.setPanel(e.target.value ? await cfg.panel(e.target.value) : []);
          }}
          className={inputCls(p.err)}
        >
          <option value="" />
          {cfg.options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <ErrorText msg={p.err} id={`${p.id}-err`} />
      </div>
    );
  }
  return (
    <div>
      <Label htmlFor={p.id} text={p.label} />
      <div className="flex gap-2">
        <input id={p.id} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type the quote no" className={inputCls(p.err)} autoComplete="off" />
        <button
          type="button"
          className="rounded border px-3"
          onClick={async () => {
            setMsg(null);
            const hit = await cfg.find(typed);
            if (!hit) {
              setValue('');
              p.setPanel([]);
              setMsg('No Request For Invoice found for that quote no.');
              return;
            }
            setValue(hit.option.id);
            p.setPanel(hit.panel);
          }}
        >
          Find
        </button>
      </div>
      <input type="hidden" name={`f.${p.name}`} value={value} />
      {msg ? <p className="mt-1 text-sm text-neutral-700">{msg}</p> : null}
      <ErrorText msg={p.err} id={`${p.id}-err`} />
    </div>
  );
}

function ChecklistView({ spec, rows, label }: { spec: FormSpec; rows: ChecklistRow[]; label: string }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-base font-semibold">{label}</legend>
      {(spec.checklist ?? []).map((item) => {
        const r = rows.find((x) => x.itemNo === item.itemNo);
        return (
          <div key={item.itemNo} className="rounded border border-neutral-300 bg-white p-3">
            <p className="mb-2 text-sm font-medium">{item.label}</p>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`cl.${item.itemNo}.fail`} defaultChecked={r?.fail} className="h-5 w-5" /> Fail
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`cl.${item.itemNo}.pass`} defaultChecked={r?.pass} className="h-5 w-5" /> Pass
              </label>
            </div>
            <label htmlFor={`cl-${item.itemNo}-c`} className="text-xs text-neutral-600">Comments</label>
            <textarea id={`cl-${item.itemNo}-c`} name={`cl.${item.itemNo}.comments`} rows={2} defaultValue={r?.comments ?? ''} className={inputCls()} />
          </div>
        );
      })}
    </fieldset>
  );
}
