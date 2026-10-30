'use client';

import { startTransition, useActionState, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Icon } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Stepper } from '@/components/ui/Stepper';
import { contentBlocks, type Block } from '@/lib/spec/content';
import { cellId, minimumOf, present, shortBy, stepOf, type DisplayCell, type Section, type Step } from '@/lib/spec/presentation';
import type { FormSpec } from '@/lib/spec/types';
import type { ChecklistRow, EntryData } from '@/lib/spec/values';
import { isQuoteField } from '@/lib/forms/quote-fields';
import { Checklist } from './Checklist';
import { CountField } from './CountField';
import { FileField } from './FileField';
import { QuoteField } from './QuoteField';
import { SignaturePad } from './SignaturePad';
import { errorCls, inputCls, labelCls, partLabelCls, primaryBtn, secondaryBtn, textareaCls } from './styles';
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

const SECONDARY_ACTION = /change|reject|cancel|decline/i;

export function FormRenderer(props: FormRendererProps) {
  const { spec } = props;
  const steps = useMemo(() => present(spec), [spec]);
  const [state, formAction, pending] = useActionState(props.submit, {} as SubmitState);
  const [step, setStep] = useState(0);
  const [panel, setPanel] = useState(props.lookupPanel ?? []);
  const [gateErrors, setGateErrors] = useState<Record<string, string>>({});
  const [termsRead, setTermsRead] = useState<Record<string, boolean>>({});
  const [counts, setCounts] = useState<Record<string, string>>(() => initialCounts(steps, props.initial));
  const [review, setReview] = useState<Array<[string, string]>>([]);
  const [filesRev, setFilesRev] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const readOnly = props.actions.length === 0;
  const errors = useMemo(() => ({ ...(state.errors ?? {}), ...gateErrors }), [state.errors, gateErrors]);
  const labels = useMemo(() => labelMap(spec, steps), [spec, steps]);
  const multi = steps.length > 1;
  const current = steps[step];

  // After a failed save, jump to the step with the first error.
  useEffect(() => {
    if (!state.at || !state.errors) return;
    const first = Object.keys(state.errors).map((n) => stepOf(steps, n)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (first !== undefined) setStep(first);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [state.at, state.errors, steps]);

  // The review step reads back what was entered (labels and short values only; nothing leaves the browser).
  // Recomputed when the step opens and whenever a file list changes (uploads made on the review step).
  useEffect(() => {
    if (!current?.review || !formRef.current) return;
    setReview(reviewRows(formRef.current, steps.slice(0, step + 1), labels, panel.length > 0));
  }, [current, step, steps, labels, panel.length, filesRev]);

  const go = (i: number) => {
    setStep(i);
    requestAnimationFrame(() => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const next = () => {
    if (!readOnly && formRef.current) {
      const missing = current.requireSigned.filter((n) => !((formRef.current!.elements.namedItem(`sig.${n}`) as HTMLInputElement | null)?.value));
      if (missing.length) {
        setGateErrors(Object.fromEntries(missing.map((n) => [n, 'Sign here to continue.'])));
        document.querySelector<HTMLElement>(`[data-testid="sig-${missing[0]}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    setGateErrors({});
    go(step + 1);
  };

  const clearGate = (name: string) => setGateErrors((m) => {
    if (!(name in m)) return m;
    const rest = { ...m };
    delete rest[name];
    return rest;
  });

  const onFiles = () => setFilesRev((n) => n + 1);

  const jumpTo = (name: string) => {
    const i = stepOf(steps, name);
    if (i >= 0 && i !== step) setStep(i);
    setTimeout(() => {
      const el = document.getElementById(`f-${name}`) ?? document.querySelector<HTMLElement>(`[name="f.${name}"], [data-testid="sig-${name}"], [data-testid="file-${name}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus?.();
    }, 50);
  };

  const errorList = Object.entries(state.errors ?? {});
  const lowItems = steps.flatMap((s) => s.sections.filter((sec) => sec.kind === 'count').flatMap((sec) => sec.rows.flatMap((r) => r.cells)))
    .map((c) => ({ name: cellId(c.cell), label: labelOf(c), min: minimumOf(labelOf(c)) }))
    .map((x) => ({ ...x, short: shortBy(counts[x.name], x.min) }))
    .filter((x) => x.short > 0);

  return (
    <form
      ref={formRef}
      noValidate
      className="space-y-5"
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

      <div ref={topRef} className="scroll-mt-24 space-y-4">
        {multi ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-small font-semibold text-fg">
                Step {step + 1} of {steps.length}
                {current.title && current.title !== `Page ${step + 1}` ? <span className="font-normal text-fg-muted"> · {current.title}</span> : null}
              </p>
              <p className="text-label font-medium tracking-normal text-fg-muted">{Math.round(((step + 1) / steps.length) * 100)}%</p>
            </div>
            <ProgressBar value={step + 1} max={steps.length} label="Form progress" />
            <div className="hidden sm:block">
              <Stepper steps={steps.map((s, i) => ({ label: s.title ?? `Step ${i + 1}` }))} current={step} onSelect={go} label="Form pages" />
            </div>
          </div>
        ) : null}
        {state.message ? <Alert tone="error">{state.message}</Alert> : null}
        {errorList.length ? (
          <Alert tone="error" title={`Check ${errorList.length} field${errorList.length === 1 ? '' : 's'}`}>
            <ul className="space-y-0.5">
              {errorList.map(([name, msg]) => (
                <li key={name}>
                  <button type="button" onClick={() => jumpTo(name)} className="text-left underline underline-offset-2 hover:no-underline">
                    {labels[name] ?? name}
                  </button>
                  : {msg}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </div>

      {steps.map((st) => (
        <fieldset key={st.index} hidden={st.index !== step} disabled={readOnly} className="min-w-0 space-y-5">
          {st.title ? <legend className="sr-only">{st.title}</legend> : null}
          {st.sections.map((sec) => (
            <SectionCard key={sec.key} section={sec}>
              {sec.kind === 'lines' ? (
                <LinesTable section={sec} initial={props.initial} errors={errors} />
              ) : sec.kind === 'count' ? (
                <div className="grid gap-x-4 gap-y-4 [grid-template-columns:repeat(auto-fill,minmax(min(15.5rem,100%),1fr))]">
                  {sec.rows.flatMap((r) => r.cells).map((c) => {
                    const name = cellId(c.cell);
                    const label = labelOf(c);
                    if (label.trim() === 'OTHER' || c.cell.field.type !== 'text') {
                      return (
                        <div key={name} className="[grid-column:1/-1]">
                          <FieldView {...props} dc={c} step={st} errors={errors} readOnly={readOnly} panel={panel} setPanel={setPanel} termsRead={termsRead} setTermsRead={setTermsRead} clearGate={clearGate} onFiles={onFiles} />
                        </div>
                      );
                    }
                    return (
                      <CountField
                        key={name} id={`f-${name}`} name={name} label={label} min={minimumOf(label)} value={counts[name] ?? ''}
                        onChange={(v) => setCounts((m) => ({ ...m, [name]: v }))} err={errors[name]} disabled={readOnly}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 md:grid-cols-24">
                  {sec.rows.flatMap((r, ri) =>
                    r.cells.map((c, ci) => (
                      <div
                        key={`${ri}-${ci}`}
                        className="min-w-0 sm:[grid-column:var(--gc-sm)] md:[grid-column:var(--gc)]"
                        style={{ '--gc': `span ${c.span} / span ${c.span}`, '--gc-sm': c.span >= 18 ? '1 / -1' : 'auto' } as CSSProperties}
                      >
                        <FieldView {...props} dc={c} step={st} errors={errors} readOnly={readOnly} panel={panel} setPanel={setPanel} termsRead={termsRead} setTermsRead={setTermsRead} clearGate={clearGate} onFiles={onFiles} />
                      </div>
                    )),
                  )}
                </div>
              )}
            </SectionCard>
          ))}
          {st.sections.some((s) => s.kind === 'count') && lowItems.length ? (
            <section aria-label="Below minimum" className="rounded-md border border-danger bg-surface shadow-card">
              <header className="flex items-center gap-2 border-b border-border px-5 py-3 text-status-red-fg">
                <Icon name="warning" size={18} strokeWidth={2} />
                <h2 className="text-h2">Below minimum · {lowItems.length}</h2>
              </header>
              <ul className="divide-y divide-border px-5">
                {lowItems.map((x) => (
                  <li key={x.name} className="flex items-center justify-between gap-3 py-2 text-small">
                    <span className="min-w-0 text-fg">{x.label}</span>
                    <span className="whitespace-nowrap font-mono font-semibold text-status-red-fg">{counts[x.name]} / {x.min}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {st.review && st.index === step ? <ReviewCard rows={review} /> : null}
        </fieldset>
      ))}

      <div className="flex flex-col-reverse gap-2 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {step > 0 && (current.backButton || multi) ? (
            <button type="button" className={`${secondaryBtn} w-full sm:w-auto`} onClick={() => go(Math.max(0, step - 1))}>
              <Icon name="chevronLeft" size={18} strokeWidth={2} />
              {current.backButton ?? 'Back'}
            </button>
          ) : null}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {step < steps.length - 1 ? (
            <button type="button" className={`${primaryBtn} w-full sm:w-auto`} onClick={next}>
              {current.nextButton}
              <Icon name="chevronRight" size={18} strokeWidth={2} />
            </button>
          ) : (
            props.actions.map((a) => (
              <button
                key={a.name}
                type="submit"
                name="__action"
                value={a.name}
                disabled={pending}
                className={`${SECONDARY_ACTION.test(a.name) ? secondaryBtn : primaryBtn} w-full sm:w-auto`}
              >
                {pending ? 'Saving…' : a.label}
              </button>
            ))
          )}
        </div>
      </div>
    </form>
  );
}

function SectionCard({ section, children }: { section: Section; children: ReactNode }) {
  const id = `sec-${section.key}`;
  return (
    <section aria-labelledby={section.title ? id : undefined} className="rounded-md border border-border bg-surface shadow-card">
      {section.title ? (
        <header className="border-b border-border px-5 py-4 sm:px-6">
          <h2 id={id} className="text-h2 text-fg">{section.title}</h2>
          {section.description ? <p className="mt-0.5 text-small text-fg-muted">{section.description}</p> : null}
        </header>
      ) : null}
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

function labelOf(c: DisplayCell): string {
  const f = c.cell.field;
  return (c.label ?? ('label' in f ? f.label.trim() : '')) || ('name' in f ? f.name : '');
}

function labelMap(spec: FormSpec, steps: Step[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of spec.fields) if ('name' in f && 'label' in f) out[f.name] = f.label.trim() || f.name;
  for (const s of steps) for (const sec of s.sections) for (const r of sec.rows) for (const c of r.cells) if (c.label) out[cellId(c.cell)] = c.label;
  return out;
}

function initialCounts(steps: Step[], initial: EntryData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of steps) for (const sec of s.sections) if (sec.kind === 'count') for (const r of sec.rows) for (const c of r.cells) {
    const n = cellId(c.cell);
    const v = initial[n];
    out[n] = v === undefined || v === null ? '' : String(v);
  }
  return out;
}

function reviewRows(form: HTMLFormElement, steps: Step[], labels: Record<string, string>, customerFound: boolean): Array<[string, string]> {
  const fd = new FormData(form);
  const rows: Array<[string, string]> = [];
  for (const s of steps) for (const sec of s.sections) for (const r of sec.rows) for (const c of r.cells) {
    const f = c.cell.field;
    const name = cellId(c.cell);
    const label = labels[name] ?? name;
    if (f.type === 'signature') rows.push([label, fd.get(`sig.${name}`) ? 'Signed' : 'Not signed']);
    else if (f.type === 'file') {
      const n = (() => { try { return (JSON.parse(String(fd.get(`file.${name}`) ?? '[]')) as unknown[]).length; } catch { return 0; } })();
      rows.push([label, n ? `${n} file${n === 1 ? '' : 's'}` : 'None']);
    } else if (f.type === 'table') rows.push([label.startsWith('[') ? 'Customer' : label, customerFound ? 'Found' : 'Not found']);
    else if (f.type === 'text' || f.type === 'date' || f.type === 'email' || f.type === 'number') {
      const v = String(fd.get(`f.${name}`) ?? '').trim();
      rows.push([label, v || '—']);
    }
  }
  return rows;
}

function ReviewCard({ rows }: { rows: Array<[string, string]> }) {
  return (
    <section aria-labelledby="review-title" className="rounded-md border border-border bg-surface shadow-card">
      <header className="border-b border-border px-5 py-4 sm:px-6">
        <h2 id="review-title" className="text-h2 text-fg">Review</h2>
        <p className="mt-0.5 text-small text-fg-muted">Check everything before you submit. Submitting creates the signed PDF.</p>
      </header>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-5 sm:grid-cols-2 sm:p-6">
        {rows.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-label font-medium tracking-normal text-fg-muted">{k}</dt>
            <dd className={`truncate text-body ${v === 'Not signed' || v === 'None' ? 'text-fg-muted' : 'font-medium text-fg'}`}>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Deal lines: part number + description pairs on one row each, labelled by the spec labels for screen readers. */
function LinesTable({ section, initial, errors }: { section: Section; initial: EntryData; errors: Record<string, string> }) {
  const val = (n: string) => (initial[n] === undefined || initial[n] === null ? '' : String(initial[n]));
  return (
    <div className="space-y-2">
      <div aria-hidden="true" className="hidden grid-cols-[2rem_minmax(8rem,1fr)_minmax(0,3fr)] gap-2 text-label font-semibold tracking-normal text-fg-muted sm:grid">
        <span />
        <span>Part number</span>
        <span>Description</span>
      </div>
      {section.rows.map((r, i) => r.cells.length === 1 ? (
        <TotalRow key={i} dc={r.cells[0]} initial={initial} errors={errors} />
      ) : (
        <div key={i} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 sm:grid-cols-[2rem_minmax(8rem,1fr)_minmax(0,3fr)] sm:items-center">
          <span aria-hidden="true" className="row-span-2 pt-3 text-right font-mono text-label tracking-normal text-fg-muted sm:row-span-1 sm:pt-0">{i + 1}</span>
          {r.cells.map((c) => {
            const name = cellId(c.cell);
            const id = `f-${name}`;
            const err = errors[name];
            const isPart = name.startsWith('PARTNO');
            return (
              <div key={name} className="min-w-0">
                <label htmlFor={id} className="sr-only">{labelOf(c)}</label>
                <input
                  id={id}
                  name={`f.${name}`}
                  defaultValue={val(name)}
                  placeholder={isPart ? '—' : 'Description'}
                  autoComplete="off"
                  aria-invalid={err ? true : undefined}
                  className={inputCls(err, isPart ? 'font-mono' : '')}
                />
                {err ? <p className={errorCls}>{err}</p> : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Manual total at the foot of the lines table: label left, amount right-aligned in mono. */
function TotalRow({ dc, initial, errors }: { dc: DisplayCell; initial: EntryData; errors: Record<string, string> }) {
  const name = cellId(dc.cell);
  const id = `f-${name}`;
  const f = dc.cell.field;
  const err = errors[name];
  const v = initial[name];
  const integer = f.type === 'number' && !!f.integer;
  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
      <label htmlFor={id} className="text-body font-semibold text-fg">{labelOf(dc)}</label>
      <div className="sm:w-72">
        <input
          id={id}
          name={`f.${name}`}
          type={f.type === 'number' ? 'number' : 'text'}
          step={f.type === 'number' ? (integer ? 1 : 'any') : undefined}
          inputMode={integer ? 'numeric' : 'decimal'}
          defaultValue={v === undefined || v === null ? '' : String(v)}
          placeholder="0"
          autoComplete="off"
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${id}-err` : undefined}
          className={inputCls(err, 'text-right font-mono text-base font-semibold')}
        />
        <ErrorText msg={err} id={`${id}-err`} />
      </div>
    </div>
  );
}

function FieldLabel({ htmlFor, text, hidden, required }: { htmlFor: string; text: string; hidden?: boolean; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className={hidden ? 'sr-only' : labelCls}>
      {text}
      {required ? <span className="ml-0.5 text-danger" aria-hidden="true">*</span> : null}
    </label>
  );
}

function ErrorText({ msg, id }: { msg?: string; id: string }) {
  return msg ? <p id={id} className={errorCls}>{msg}</p> : null;
}

/** Legal and info text. A short all-bold line is a heading; long paragraphs read at normal weight. */
export function ContentView({ blocks, scroll, onReadToEnd, testId }: { blocks: Block[]; scroll: boolean; onReadToEnd?: () => void; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [atEnd, setAtEnd] = useState(false);
  const check = () => {
    const el = ref.current;
    // A hidden step measures 0: only text that is actually on screen can count as read.
    if (!el || el.clientHeight === 0 || el.getClientRects().length === 0) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 8) {
      setAtEnd(true);
      onReadToEnd?.();
    }
  };
  // Short text that needs no scrolling counts as read once it is on screen.
  useEffect(() => {
    if (scroll && onReadToEnd) check();
  });
  return (
    <div>
      <div
        ref={ref}
        onScroll={scroll ? check : undefined}
        data-testid={testId}
        className={`rounded-sm border border-border bg-surface-2 px-4 py-3.5 text-small leading-6 text-fg ${scroll ? 'max-h-80 overflow-y-auto focus-visible:outline-2 focus-visible:outline-focus' : ''}`}
        tabIndex={scroll ? 0 : undefined}
        role={scroll ? 'region' : undefined}
        aria-label={scroll ? 'Terms (scroll to read)' : undefined}
      >
        {blocks.map((b, i) => {
          const text = b.spans.map((s) => s.text).join('');
          const allBold = b.spans.length > 0 && b.spans.every((s) => s.bold || !s.text.trim());
          if (allBold && text.length <= 90) return <p key={i} className="mb-2 mt-3 font-semibold text-fg first:mt-0">{text}</p>;
          return (
            <p key={i} className="mb-2.5 last:mb-0">
              {b.spans.map((s, j) => (s.bold && !allBold ? <strong key={j} className="font-semibold">{s.text}</strong> : <span key={j} className={allBold ? 'font-medium' : ''}>{s.text}</span>))}
            </p>
          );
        })}
      </div>
      {scroll && onReadToEnd ? (
        <p className={`mt-1.5 flex items-center gap-1.5 text-label font-medium tracking-normal ${atEnd ? 'text-status-green-fg' : 'text-fg-muted'}`} aria-live="polite">
          <Icon name={atEnd ? 'check' : 'info'} size={14} strokeWidth={2} />
          {atEnd ? 'Read to the end' : 'Scroll to the end of the terms to unlock the signature'}
        </p>
      ) : null}
    </div>
  );
}

type ViewProps = FormRendererProps & {
  dc: DisplayCell;
  step: Step;
  errors: Record<string, string>;
  readOnly: boolean;
  panel: Array<[string, string]>;
  setPanel: (p: Array<[string, string]>) => void;
  termsRead: Record<string, boolean>;
  setTermsRead: (f: (m: Record<string, boolean>) => Record<string, boolean>) => void;
  clearGate: (name: string) => void;
  onFiles: () => void;
};

function FieldView(p: ViewProps) {
  const f = p.dc.cell.field;
  const cid = cellId(p.dc.cell);
  if (f.type === 'content') {
    const gate = p.step.gate?.content === cid ? p.step.gate : undefined;
    return (
      <ContentView
        blocks={contentBlocks(f)}
        scroll={!!f.contentRef}
        testId={gate ? 'terms-scroll' : undefined}
        onReadToEnd={gate ? () => p.setTermsRead((m) => (m[gate.signature] ? m : { ...m, [gate.signature]: true })) : undefined}
      />
    );
  }

  const name = 'name' in f ? f.name : '';
  const id = `f-${name}`;
  const err = p.errors[name];
  const v = p.initial[name];
  const errProps = err ? { 'aria-invalid': true, 'aria-describedby': `${id}-err` } : {};
  const label = labelOf(p.dc);
  const hideLabel = 'hideLabel' in f && !!f.hideLabel;
  const required = 'required' in f && !!f.required;

  if (f.type === 'text' && p.quotes && isQuoteField(p.spec.slug, name)) {
    return (
      <QuoteField
        id={id} name={name} label={label} hideLabel={hideLabel}
        value={v === undefined || v === null ? '' : String(v)} err={err} disabled={p.readOnly}
        config={p.quotes} inputClassName={inputCls(err, 'font-mono')}
      />
    );
  }

  switch (f.type) {
    case 'text':
    case 'email':
    case 'date':
    case 'number': {
      const mono = f.type === 'number' || /VIN|QUOTE|INV|PART/i.test(name);
      return (
        <div>
          <FieldLabel htmlFor={id} text={label} hidden={hideLabel} required={required} />
          <input
            id={id}
            name={`f.${name}`}
            type={f.type === 'number' ? 'number' : f.type}
            step={f.type === 'number' ? (f.integer ? 1 : 'any') : undefined}
            inputMode={f.type === 'number' ? (f.integer ? 'numeric' : 'decimal') : f.type === 'email' ? 'email' : undefined}
            placeholder={hideLabel ? label : undefined}
            defaultValue={v === undefined || v === null ? '' : String(v)}
            autoComplete="off"
            className={inputCls(err, `${mono ? 'font-mono' : ''} ${f.type === 'number' ? 'text-right' : ''}`)}
            {...errProps}
          />
          <ErrorText msg={err} id={`${id}-err`} />
        </div>
      );
    }
    case 'textarea':
      return (
        <div>
          <FieldLabel htmlFor={id} text={label} />
          <textarea id={id} name={`f.${name}`} rows={3} defaultValue={(v as string) ?? ''} className={textareaCls(err)} {...errProps} />
          <ErrorText msg={err} id={`${id}-err`} />
        </div>
      );
    case 'choice':
      if (f.style === 'checkboxes' || f.style === 'radio' || f.multi) {
        const radio = f.style === 'radio' && !f.multi;
        const selected = new Set(Array.isArray(v) ? (v as string[]) : v ? [String(v)] : []);
        return (
          <fieldset {...errProps}>
            <legend className={labelCls}>{label}</legend>
            <div className="flex flex-wrap gap-2">
              {f.options.map((o) => (
                <label
                  key={o}
                  className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-pill border border-border-strong bg-surface px-3.5 text-body font-medium text-fg transition hover:bg-surface-2 has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus sm:h-10"
                >
                  <input type={radio ? 'radio' : 'checkbox'} name={`f.${name}`} value={o} defaultChecked={selected.has(o)} className="size-4 accent-[var(--accent)]" />
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
          <FieldLabel htmlFor={id} text={label} />
          <div className="relative">
            <select id={id} name={`f.${name}`} defaultValue={(v as string) ?? ''} className={inputCls(err, 'appearance-none pr-10')} {...errProps}>
              <option value="" />
              {f.options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-fg-muted">
              <Icon name="chevronDown" size={16} strokeWidth={2} />
            </span>
          </div>
          <ErrorText msg={err} id={`${id}-err`} />
        </div>
      );
    case 'name':
    case 'address': {
      const obj = (v ?? {}) as Record<string, string>;
      const partLabel: Record<string, string> = { Line1: 'Address Line 1', Line2: 'Address Line 2', PostalCode: 'Postal / Zip Code', State: 'State / Province / Region' };
      const wide = (part: string) => f.type === 'address' && part.startsWith('Line');
      return (
        <fieldset {...errProps}>
          <legend className={labelCls}>
            {label}
            {required ? <span className="ml-0.5 text-danger" aria-hidden="true">*</span> : null}
          </legend>
          <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2">
            {f.parts.map((part) => (
              <div key={part} className={wide(part) ? 'sm:col-span-2' : ''}>
                <label htmlFor={`${id}-${part}`} className={partLabelCls}>{partLabel[part] ?? part}</label>
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
          <span className={labelCls}>Customer details</span>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 rounded-sm border border-border bg-surface-2 p-4 text-body sm:grid-cols-2" data-testid="customer-panel">
            {p.panel.length ? (
              p.panel.map(([k, val]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-label font-medium tracking-normal text-fg-muted">{k}</dt>
                  <dd className="font-medium text-fg">{val || '-'}</dd>
                </div>
              ))
            ) : (
              <dd className="flex items-center gap-2 text-fg-muted sm:col-span-2">
                <Icon name="info" size={16} strokeWidth={2} />
                Choose a quote no to show the customer.
              </dd>
            )}
          </dl>
        </div>
      );
    case 'section':
      return <Checklist spec={p.spec} rows={(p.initial.checklist as ChecklistRow[] | undefined) ?? []} label={label} disabled={p.readOnly} />;
    case 'file':
      return (
        <FileField
          name={name} label={label} multi={!!f.multi} maxFiles={f.maxFiles} accept={f.accept}
          existing={p.files[name] ?? []} upload={p.upload} supabase={p.supabase} error={err} disabled={p.readOnly}
          onChange={p.onFiles}
        />
      );
    case 'signature': {
      const gated = p.step.gate?.signature === name && !p.termsRead[name] && !p.signatures[name];
      return (
        <SignaturePad
          name={name} label={label} existing={p.signatures[name] ?? null} error={err} disabled={p.readOnly}
          required={p.step.requireSigned.includes(name)}
          locked={gated ? 'Scroll to the end of the terms above to sign.' : null}
          onChange={(signed) => { if (signed) p.clearGate(name); }}
        />
      );
    }
  }
}

function LookupView(p: ViewProps & { id: string; name: string; label: string; err?: string; value: string }) {
  const [value, setValue] = useState(p.value);
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cfg = p.lookup;
  if (!cfg) return null;
  if (cfg.mode === 'list') {
    return (
      <div>
        <FieldLabel htmlFor={p.id} text={p.label} />
        <div className="relative">
          <select
            id={p.id}
            name={`f.${p.name}`}
            value={value}
            onChange={async (e) => {
              setValue(e.target.value);
              p.setPanel(e.target.value ? await cfg.panel(e.target.value) : []);
            }}
            className={inputCls(p.err, 'appearance-none pr-10')}
          >
            <option value="" />
            {cfg.options.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-fg-muted">
            <Icon name="chevronDown" size={16} strokeWidth={2} />
          </span>
        </div>
        <ErrorText msg={p.err} id={`${p.id}-err`} />
      </div>
    );
  }
  const find = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const hit = await cfg.find(typed);
      if (!hit) {
        setValue('');
        p.setPanel([]);
        setMsg('No Request For Invoice found for that quote no.');
        return;
      }
      setValue(hit.option.id);
      p.setPanel(hit.panel);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <FieldLabel htmlFor={p.id} text={p.label} />
      <div className="flex gap-2">
        <input
          id={p.id}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void find(); } }}
          placeholder="Type the quote no"
          className={inputCls(p.err, 'font-mono')}
          autoComplete="off"
        />
        <button type="button" onClick={() => void find()} disabled={busy} className="h-12 flex-none rounded-pill border border-border-strong bg-surface px-4 text-body font-semibold text-fg hover:bg-surface-2 disabled:opacity-60 sm:h-10">
          Find
        </button>
      </div>
      <input type="hidden" name={`f.${p.name}`} value={value} />
      {msg ? <p className="mt-1.5 text-small text-fg-muted" role="status">{msg}</p> : null}
      <ErrorText msg={p.err} id={`${p.id}-err`} />
    </div>
  );
}
