'use client';

import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { contentBlocks, type Block, type Span } from '@/lib/spec/content';
import { pages, type Cell } from '@/lib/spec/layout';
import { utcToZoned } from '@/lib/spec/time';
import type { FieldSpec, FormSpec } from '@/lib/spec/types';
import { applyLocks, checkPost, displayValue, lockedFor, publicSpec, readFormData, type Audience, type ChecklistRow, type EntryData } from '@/lib/spec/values';
import { hasShowWhen, hiddenFields, isHeading } from '@/lib/spec/visibility';
import { isQuoteField } from '@/lib/forms/quote-fields';
import { ChoiceInput, CurrencyInput, RatingInput, SectionHeading, YesNoInput } from './fields';
import { a11y, ErrorText, HelpText, inputCls, Label, Legend } from './parts';
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
  /**
   * M8: who fills the form. 'public' (public link, role links) hides internalOnly fields and shows readOnly
   * fields as not editable; the server applies the same rules (prepareSave). Default 'staff'.
   */
  audience?: Audience;
  /** Org timezone for datetime fields (entered and shown in it, stored UTC). Default UTC. */
  timeZone?: string;
  /** Org currency code for currency fields that do not name one. Default USD. */
  currency?: string;
}

export function FormRenderer(props: FormRendererProps) {
  const audience = props.audience ?? 'staff';
  const spec = useMemo(() => (audience === 'public' ? publicSpec(props.spec) : props.spec), [audience, props.spec]);
  const allPages = useMemo(() => pages(spec), [spec]);
  const [state, formAction, pending] = useActionState(props.submit, {} as SubmitState);
  // Errors found in the browser before submitting (same rules as the server; see checkPost).
  const [local, setLocal] = useState<SubmitState | null>(null);
  const [page, setPage] = useState(0);
  const [panel, setPanel] = useState(props.lookupPanel ?? []);
  const top = useRef<HTMLFormElement>(null);
  const readOnly = props.actions.length === 0;
  const shown = local ?? state;
  const errors = shown.errors ?? {};
  const readOpts = { timeZone: props.timeZone, currency: props.currency };

  // Show-when: track the current values only when the form has rules (the kit forms have none).
  const track = useMemo(() => hasShowWhen(spec), [spec]);
  const [live, setLive] = useState<EntryData>(props.initial);
  const hidden = useMemo(
    () => (track ? hiddenFields(spec, applyLocks(spec, live, { audience, previous: props.initial })) : new Set<FieldSpec>()),
    [track, spec, live, audience, props.initial],
  );
  const locked = useMemo(() => lockedFor(spec, audience), [spec, audience]);

  // After a failed save, jump to the first page with an error.
  useEffect(() => {
    if (!shown.at || !shown.errors) return;
    const first = allPages.findIndex((p) => p.rows.some((r) => r.cells.some((c) => 'name' in c.field && shown.errors![c.field.name])));
    if (first >= 0) setPage(first);
    top.current?.scrollIntoView({ behavior: 'smooth' });
  }, [shown.at, shown.errors, allPages]);

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
        const found = checkPost(props.spec, fd, { ...readOpts, audience, previous: props.initial });
        if (Object.keys(found).length) {
          setLocal({ message: 'Please correct the highlighted fields.', errors: found, at: Date.now() });
          return;
        }
        setLocal(null);
        startTransition(() => formAction(fd));
      }}
      onChange={track ? (e) => setLive(readFormData(spec, new FormData(e.currentTarget), readOpts).data) : undefined}
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
            <li key={p.index} className={`rounded-full px-3 py-1 ${p.index === page ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-fg-muted'}`}>
              {p.title ?? `Page ${p.index + 1}`}
            </li>
          ))}
        </ol>
      ) : null}
      {shown.message ? (
        <p role="alert" className="rounded bg-status-red-bg p-3 text-sm text-status-red-fg">{shown.message}</p>
      ) : null}

      {allPages.map((p) => (
        <fieldset key={p.index} hidden={p.index !== page} disabled={readOnly} className="space-y-3">
          {p.title && multiPage ? <legend className="mb-2 text-h2">{p.title}</legend> : null}
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-24">
            {p.rows.flatMap((r) =>
              r.cells.map((c, i) => (
                <div key={`${r.row}-${i}`} className="min-w-0 md:[grid-column:var(--gc)]" style={{ '--gc': `${c.col} / span ${c.span}` } as React.CSSProperties} hidden={hidden.has(c.field) || undefined}>
                  <FieldView
                    cell={c} {...props} spec={spec} errors={errors} readOnly={readOnly} panel={panel} setPanel={setPanel}
                    locked={'name' in c.field && locked.has(c.field.name)}
                  />
                </div>
              )),
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {p.backButton ? (
              <button type="button" className="rounded-pill border border-border-strong bg-surface font-semibold text-fg no-underline px-4 py-2" onClick={() => setPage((x) => Math.max(0, x - 1))}>
                {p.backButton}
              </button>
            ) : null}
            {p.index < allPages.length - 1 ? (
              <button type="button" className="rounded-pill bg-accent px-5 py-2.5 font-semibold text-accent-fg" onClick={() => { setPage((x) => x + 1); top.current?.scrollIntoView(); }}>
                {p.nextButton}
              </button>
            ) : (
              props.actions.map((a) => (
                <button key={a.name} type="submit" name="__action" value={a.name} disabled={pending} className="rounded-pill bg-accent px-5 py-2.5 font-semibold text-accent-fg disabled:opacity-60">
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
  /** Public role on a readOnly field. */
  locked: boolean;
};

function SpanView({ s }: { s: Span }) {
  let node: React.ReactNode = s.bold ? <strong>{s.text}</strong> : <span>{s.text}</span>;
  if (s.italic) node = <em>{node}</em>;
  if (s.href) node = <a href={s.href} target="_blank" rel="noopener noreferrer" className="underline">{node}</a>;
  return node;
}

export function ContentView({ blocks, scroll }: { blocks: Block[]; scroll: boolean }) {
  return (
    <div className={`rounded border border-border-strong bg-surface-2 p-3 text-sm leading-relaxed ${scroll ? 'max-h-80 overflow-y-auto' : ''}`} tabIndex={scroll ? 0 : undefined}>
      {blocks.map((b, i) => {
        if (b.kind === 'list') {
          const items = b.items.map((it, j) => <li key={j}>{it.map((s, k) => <SpanView key={k} s={s} />)}</li>);
          return b.ordered ? <ol key={i} className="mb-2 list-decimal pl-5 last:mb-0">{items}</ol> : <ul key={i} className="mb-2 list-disc pl-5 last:mb-0">{items}</ul>;
        }
        if (b.kind === 'heading') return <p key={i} className="mb-2 font-semibold last:mb-0">{b.spans.map((s, j) => <SpanView key={j} s={s} />)}</p>;
        return (
          <p key={i} className="mb-2 last:mb-0">
            {b.spans.map((s, j) => (s.bold && !s.italic && !s.href ? <strong key={j}>{s.text}</strong> : !s.italic && !s.href ? <span key={j}>{s.text}</span> : <SpanView key={j} s={s} />))}
          </p>
        );
      })}
    </div>
  );
}

const INPUT_TYPE: Record<string, string> = { text: 'text', email: 'email', date: 'date', number: 'number', phone: 'tel', url: 'url', time: 'time', datetime: 'datetime-local' };

function FieldView(p: ViewProps) {
  const f = p.cell.field;
  if (f.type === 'content') return <ContentView blocks={contentBlocks(f)} scroll={!!f.contentRef} />;

  const name = 'name' in f ? f.name : '';
  const id = `f-${name}`;
  const err = p.errors[name];
  const v = p.initial[name];
  const label = 'label' in f ? f.label.trim() || name : name;
  // M8 options (absent on the kit forms, so their markup is unchanged).
  const help = 'help' in f ? f.help : undefined;
  const req = !!p.spec.settings.markRequired && 'required' in f && f.required === true;
  const errProps = a11y(id, err, help, req);
  const hideLabel = 'hideLabel' in f && !!f.hideLabel;
  const locked = p.locked || undefined;

  if (f.type === 'section' && isHeading(f)) return <SectionHeading id={id} title={label} description={f.description} />;

  if (f.type === 'text' && p.quotes && isQuoteField(p.spec.slug, name)) {
    return (
      <QuoteField
        id={id} name={name} label={label} hideLabel={hideLabel}
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
    case 'phone':
    case 'url':
    case 'time':
    case 'datetime': {
      const value =
        v === undefined || v === null ? ''
        : f.type === 'datetime' ? utcToZoned(String(v), p.timeZone ?? 'UTC')
        : f.type === 'phone' ? displayValue(v)
        : String(v);
      const ph = 'placeholder' in f && f.placeholder ? f.placeholder : undefined;
      return (
        <div>
          <Label htmlFor={id} text={label} hidden={hideLabel} required={req} />
          <input
            id={id}
            name={`f.${name}`}
            type={INPUT_TYPE[f.type]}
            step={f.type === 'number' ? (f.integer ? 1 : 'any') : undefined}
            inputMode={f.type === 'number' ? (f.integer ? 'numeric' : 'decimal') : f.type === 'phone' ? 'tel' : f.type === 'url' ? 'url' : undefined}
            placeholder={ph ?? (hideLabel ? label : undefined)}
            defaultValue={value}
            autoComplete="off"
            className={f.type === 'text' && f.pattern === 'uppercase' ? `${inputCls(err)} uppercase` : inputCls(err)}
            {...errProps}
            readOnly={locked}
            min={f.type === 'number' || f.type === 'date' || f.type === 'time' ? f.min : undefined}
            max={f.type === 'number' || f.type === 'date' || f.type === 'time' ? f.max : undefined}
            maxLength={f.type === 'text' ? f.maxLength : undefined}
          />
          <HelpText text={help} id={`${id}-help`} />
          <ErrorText msg={err} id={`${id}-err`} />
        </div>
      );
    }
    case 'textarea':
      return (
        <div>
          <Label htmlFor={id} text={label} required={req} />
          <textarea
            id={id} name={`f.${name}`} rows={f.rows ?? 3} defaultValue={(v as string) ?? ''} className={inputCls(err)} {...errProps}
            placeholder={f.placeholder} readOnly={locked} maxLength={f.maxLength}
          />
          <HelpText text={help} id={`${id}-help`} />
          <ErrorText msg={err} id={`${id}-err`} />
        </div>
      );
    case 'currency':
      return (
        <CurrencyInput
          id={id} name={name} label={label} err={err} help={help} required={req} locked={p.locked} hideLabel={hideLabel}
          currency={f.currency ?? p.currency ?? 'USD'} placeholder={f.placeholder} value={v}
        />
      );
    case 'yesno':
      return <YesNoInput id={id} name={name} label={label} err={err} help={help} required={req} locked={p.locked} style={f.style} value={v} />;
    case 'rating':
      return <RatingInput id={id} name={name} label={label} err={err} help={help} required={req} locked={p.locked} value={v} />;
    case 'choice':
      if (f.other || (f.style === 'radio' && !f.multi)) {
        return (
          <ChoiceInput
            id={id} name={name} label={label} err={err} help={help} required={req} locked={p.locked}
            style={f.style} multi={!!f.multi} options={f.options} other={!!f.other} value={v}
          />
        );
      }
      if (f.style === 'checkboxes' || f.multi) {
        const selected = new Set(Array.isArray(v) ? (v as string[]) : v ? [String(v)] : []);
        return (
          <fieldset {...a11y(id, err, help, false)}>
            <Legend text={label} required={req} />
            <div className="flex flex-wrap gap-4">
              {f.options.map((o) => (
                <label key={o} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name={`f.${name}`} value={o} defaultChecked={selected.has(o)} className="h-5 w-5" disabled={locked} />
                  {o}
                </label>
              ))}
            </div>
            <HelpText text={help} id={`${id}-help`} />
            <ErrorText msg={err} id={`${id}-err`} />
          </fieldset>
        );
      }
      return (
        <div>
          <Label htmlFor={id} text={label} required={req} />
          <select id={id} name={`f.${name}`} defaultValue={(v as string) ?? ''} className={inputCls(err)} {...errProps} disabled={locked}>
            <option value="" />
            {f.options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <HelpText text={help} id={`${id}-help`} />
          <ErrorText msg={err} id={`${id}-err`} />
        </div>
      );
    case 'name':
    case 'address': {
      const obj = (v ?? {}) as Record<string, string>;
      const partLabel: Record<string, string> = { Line1: 'Address Line 1', Line2: 'Address Line 2', PostalCode: 'Postal / Zip Code', State: 'State / Province / Region' };
      return (
        <fieldset {...a11y(id, err, help, false)}>
          <Legend text={label} required={req} />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {f.parts.map((part) => (
              <div key={part} className={f.type === 'address' && part.startsWith('Line') ? 'sm:col-span-2' : ''}>
                <label htmlFor={`${id}-${part}`} className="text-xs text-fg-muted">{partLabel[part] ?? part}</label>
                <input
                  id={`${id}-${part}`} name={`f.${name}.${part}`} defaultValue={obj[part] ?? ''} autoComplete="off" className={inputCls(err)}
                  readOnly={locked} aria-required={f.type === 'name' && req ? true : undefined}
                />
              </div>
            ))}
          </div>
          <HelpText text={help} id={`${id}-help`} />
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
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded border border-border-strong bg-surface-2 p-3 text-sm" data-testid="customer-panel">
            {p.panel.length ? (
              p.panel.map(([k, val]) => (
                <div key={k} className="contents">
                  <dt className="text-fg-muted">{k}</dt>
                  <dd>{val || '-'}</dd>
                </div>
              ))
            ) : (
              <dd className="col-span-2 text-fg-muted">Choose a quote no to show the customer.</dd>
            )}
          </dl>
        </div>
      );
    case 'section':
      return <ChecklistView spec={p.spec} rows={(p.initial.checklist as ChecklistRow[] | undefined) ?? []} label={label} />;
    case 'file':
      return (
        <>
          <FileField
            name={name} label={label} multi={!!f.multi} maxFiles={f.maxFiles} accept={f.accept}
            existing={p.files[name] ?? []} upload={p.upload} supabase={p.supabase} error={err} disabled={p.readOnly || p.locked}
          />
          <HelpText text={help} id={`${id}-help`} />
        </>
      );
    case 'signature':
      return (
        <>
          <SignaturePad name={name} label={label} existing={p.signatures[name] ?? null} error={err} disabled={p.readOnly || p.locked} />
          <HelpText text={help} id={`${id}-help`} />
        </>
      );
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
      {msg ? <p className="mt-1 text-sm text-fg-muted">{msg}</p> : null}
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
          <div key={item.itemNo} className="rounded border border-border-strong bg-surface p-3">
            <p className="mb-2 text-sm font-medium">{item.label}</p>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`cl.${item.itemNo}.fail`} defaultChecked={r?.fail} className="h-5 w-5" /> Fail
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`cl.${item.itemNo}.pass`} defaultChecked={r?.pass} className="h-5 w-5" /> Pass
              </label>
            </div>
            <label htmlFor={`cl-${item.itemNo}-c`} className="text-xs text-fg-muted">Comments</label>
            <textarea id={`cl-${item.itemNo}-c`} name={`cl.${item.itemNo}.comments`} rows={2} defaultValue={r?.comments ?? ''} className={inputCls()} />
          </div>
        );
      })}
    </fieldset>
  );
}
