'use client';

// The form designer (M8 Part B): palette, canvas (drag and drop + up/down), property panel, live preview with
// the real FormRenderer (desktop and 390px), undo, workflow, documents, settings, history. Saves to the draft;
// Publish runs parseSpec + builder rules + data guards on the server.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { FormRenderer } from '@/components/form-engine/FormRenderer';
import { Alert } from '@/components/ui/Alert';
import { Input, Label } from '@/components/ui/Field';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { buttonClass, cardClass } from '@/components/ui/styles';
import { fromItems, move, toItems, type Item } from '@/lib/forms/builder/layout';
import { newField, PALETTE, type PaletteType } from '@/lib/forms/builder/palette';
import { issues, summaryFields, summaryFrom } from '@/lib/forms/builder/spec';
import { FormSpec, inputFields, type FieldSpec } from '@/lib/spec/types';
import { defaultData } from '@/lib/spec/values';
import { archiveFormAction, discardDraftAction, publishAction, restoreVersionAction, saveDraftAction } from '@/app/(admin)/admin/forms/[slug]/design/actions';
import { FieldPanel } from './FieldPanel';
import { WorkflowEditor } from './WorkflowEditor';

type Tab = 'fields' | 'workflow' | 'documents' | 'settings' | 'history';

export interface DesignerProps {
  slug: string;
  draft: FormSpec;
  hasDraft: boolean;
  version: number;
  publishedNames: string[];
  withData: string[];
  hasEntries: boolean;
  encrypted: boolean;
  isActive: boolean;
  versions: Array<{ version: number; note: string | null; createdAt: string }>;
  forms: Array<{ slug: string; name: string; fields: Array<{ name: string; label: string }> }>;
  timeZone: string;
  currency: string;
  supabase: { url: string; anonKey: string };
  initialTab: Tab;
  flash?: string;
}

interface Doc {
  spec: FormSpec;
  items: Item[];
}

const keyOf = (f: FieldSpec, i: number) => ('name' in f && f.name ? f.name : `${f.type}-${i}`);
const labelOf = (f: FieldSpec) => ('label' in f && f.label ? f.label : f.type === 'content' ? 'Text block' : f.type === 'pagebreak' ? 'Page break' : f.type);

export function Designer(p: DesignerProps) {
  const router = useRouter();
  const [doc, setDoc] = useState<Doc>(() => ({ spec: p.draft, items: toItems(p.draft.fields) }));
  const history = useRef<Doc[]>([]);
  const [selected, setSelected] = useState<number | null>(doc.items.length ? 0 : null);
  const [tab, setTab] = useState<Tab>(p.initialTab);
  const [view, setView] = useState<'desktop' | 'phone'>('desktop');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(p.flash ?? null);
  const [note, setNote] = useState('');
  const dragFrom = useRef<number | null>(null);
  const withData = useMemo(() => new Set(p.withData), [p.withData]);
  const published = useMemo(() => new Set(p.publishedNames), [p.publishedNames]);

  const assembled: FormSpec = useMemo(() => ({ ...doc.spec, fields: fromItems(doc.items) }), [doc]);
  const parsed = useMemo(() => FormSpec.safeParse(assembled), [assembled]);

  const update = (fn: (d: Doc) => Doc) => {
    history.current = [...history.current.slice(-49), doc];
    setDoc(fn(doc));
    setDirty(true);
    setMessage(null);
  };
  const undo = () => {
    const prev = history.current.pop();
    if (prev) {
      setDoc(prev);
      setDirty(true);
    }
  };
  const names = (except?: number) => doc.items.filter((_, i) => i !== except).flatMap((it) => ('name' in it.field ? [it.field.name] : []));

  const add = (type: PaletteType) => {
    const f = newField(type, names());
    const at = selected === null ? doc.items.length : selected + 1;
    update((d) => ({ ...d, items: [...d.items.slice(0, at), { field: f, sameRow: false }, ...d.items.slice(at)] }));
    setSelected(at);
  };
  const reorder = (from: number, to: number) => {
    update((d) => ({ ...d, items: move(d.items, from, to) }));
    setSelected(to);
  };

  const run = async (fn: () => Promise<{ ok: boolean; problems?: string[]; version?: number }>, ok: string) => {
    setBusy(true);
    setProblems([]);
    try {
      const r = await fn();
      if (!r.ok) setProblems(r.problems ?? ['Something went wrong.']);
      else {
        setMessage(r.version ? `Published version ${r.version}.` : ok);
        setDirty(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };
  const json = () => JSON.stringify(assembled);

  const sel = selected !== null ? doc.items[selected] : null;
  const inputs = inputFields(assembled).filter((f) => f.type !== 'section' && f.type !== 'table');
  const summary = summaryFields(assembled.settings.entrySummary);
  const docSpec = assembled.documents.find((d) => d.number === 1);
  const setSpec = (patch: Partial<FormSpec>) => update((d) => ({ ...d, spec: { ...d.spec, ...patch } }));
  const setSettings = (patch: Partial<FormSpec['settings']>) => setSpec({ settings: { ...doc.spec.settings, ...patch } });
  const setDoc1 = (patch: Record<string, unknown> | null) => {
    if (patch === null) return setSpec({ documents: doc.spec.documents.filter((d) => d.number !== 1) });
    const cur = doc.spec.documents.find((d) => d.number === 1) ?? { number: 1, mode: 'view' as const, output: 'pdf' as const };
    setSpec({ documents: [...doc.spec.documents.filter((d) => d.number !== 1), { ...cur, ...patch }].sort((a, b) => a.number - b.number) });
  };

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-2 border-b border-border bg-bg px-4 py-3 sm:mx-0 sm:rounded-md sm:border">
        <p className="mr-auto text-small text-fg-muted" aria-live="polite">
          Published version {p.version}
          {dirty ? ' · unsaved changes' : p.hasDraft ? ' · draft saved' : ''}
        </p>
        <button type="button" className={buttonClass('secondary', 36)} onClick={undo} disabled={!history.current.length}>Undo</button>
        <button type="button" className={buttonClass('secondary', 36)} disabled={busy} onClick={() => run(() => saveDraftAction(p.slug, json()), 'Draft saved.')}>Save draft</button>
        <label className="sr-only" htmlFor="pub-note">Version note</label>
        <Input id="pub-note" placeholder="Version note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="max-w-56" />
        <button type="button" className={buttonClass('primary', 36)} disabled={busy} onClick={() => run(() => publishAction(p.slug, json(), note), 'Published.')}>Publish</button>
      </div>

      {message ? <Alert tone="success">{message}</Alert> : null}
      {problems.length ? (
        <Alert tone="error" title="Not published">
          <ul className="list-disc pl-5" data-testid="publish-problems">{problems.map((x) => <li key={x}>{x}</li>)}</ul>
        </Alert>
      ) : null}

      <nav aria-label="Designer" className="flex flex-wrap gap-1">
        {(['fields', 'workflow', 'documents', 'settings', 'history'] as Tab[]).map((t) => (
          <button key={t} type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}
            className={`rounded-pill px-3.5 py-1.5 text-small font-semibold capitalize ${tab === t ? 'bg-accent text-accent-fg' : 'border border-border-strong bg-surface text-fg'}`}>
            {t}
          </button>
        ))}
      </nav>

      {tab === 'fields' ? (
        <div className="grid gap-4 lg:grid-cols-[11rem_minmax(0,1fr)_22rem]">
          <section aria-labelledby="palette-h" className={`${cardClass} p-3`}>
            <h2 id="palette-h" className="mb-2 text-small font-semibold text-fg">Add a field</h2>
            <ul className="grid grid-cols-2 gap-1.5 lg:grid-cols-1">
              {PALETTE.map((x) => (
                <li key={x.type}>
                  <button type="button" className={`${buttonClass('secondary', 32)} w-full justify-start`} aria-label={`Add ${x.label}`} onClick={() => add(x.type)}>
                    + {x.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="canvas-h" className={`${cardClass} min-w-0 p-3`}>
            <h2 id="canvas-h" className="mb-2 text-small font-semibold text-fg">Fields ({doc.items.length})</h2>
            {!doc.items.length ? <p className="p-4 text-small text-fg-muted">No fields yet. Add one from the palette.</p> : null}
            <ol className="space-y-1.5" data-testid="canvas">
              {doc.items.map((it, i) => {
                const f = it.field;
                const name = 'name' in f ? f.name : '';
                const data = !!name && withData.has(name);
                return (
                  <li
                    key={keyOf(f, i)} draggable
                    onDragStart={() => { dragFrom.current = i; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); if (dragFrom.current !== null) reorder(dragFrom.current, i); dragFrom.current = null; }}
                    className={`flex items-center gap-2 rounded-sm border px-2 py-1.5 ${selected === i ? 'border-accent bg-accent-soft' : 'border-border bg-surface'} ${it.sameRow ? 'ml-6' : ''}`}
                    data-testid={`item-${keyOf(f, i)}`}
                  >
                    <span aria-hidden="true" className="cursor-grab select-none text-fg-subtle">⋮⋮</span>
                    <button type="button" aria-pressed={selected === i} onClick={() => setSelected(i)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-body font-semibold text-fg">{labelOf(f)}</span>
                      <span className="block truncate text-label tracking-normal text-fg-muted">
                        {f.type}{name ? ` · ${name}` : ''}
                        {'required' in f && f.required ? ' · required' : ''}
                        {'showWhen' in f && f.showWhen ? ' · show-when' : ''}
                        {'internalOnly' in f && f.internalOnly ? ' · internal' : ''}
                        {data ? ' · has data' : ''}
                      </span>
                    </button>
                    <button type="button" className={buttonClass('ghost', 30)} aria-label={`Move ${labelOf(f)} up`} disabled={i === 0} onClick={() => reorder(i, i - 1)}>↑</button>
                    <button type="button" className={buttonClass('ghost', 30)} aria-label={`Move ${labelOf(f)} down`} disabled={i === doc.items.length - 1} onClick={() => reorder(i, i + 1)}>↓</button>
                    <button
                      type="button" className={buttonClass('ghost', 30)} aria-label={`Remove ${labelOf(f)}`} disabled={data}
                      title={data ? 'This field has data: hide it with a show-when rule or make it internal only.' : undefined}
                      onClick={() => { update((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) })); setSelected(null); }}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>

          <section aria-labelledby="props-h" className={`${cardClass} p-3`}>
            <h2 id="props-h" className="mb-2 text-small font-semibold text-fg">Properties</h2>
            {sel && selected !== null ? (
              <FieldPanel
                key={`${selected}-${keyOf(sel.field, selected)}`}
                field={sel.field} sameRow={sel.sameRow}
                others={doc.items.filter((_, j) => j !== selected).flatMap((x) => ('name' in x.field && x.field.type !== 'section' ? [{ name: x.field.name, label: labelOf(x.field), type: x.field.type }] : []))}
                nameFixed={'name' in sel.field && (published.has(sel.field.name) || withData.has(sel.field.name))}
                hasData={'name' in sel.field && withData.has(sel.field.name)}
                forms={p.forms}
                onChange={(field) => update((d) => ({ ...d, items: d.items.map((x, j) => (j === selected ? { ...x, field } : x)) }))}
                onSameRow={(v) => update((d) => ({ ...d, items: d.items.map((x, j) => (j === selected ? { ...x, sameRow: v } : x)) }))}
              />
            ) : <p className="text-small text-fg-muted">Select a field to edit it.</p>}
          </section>

          <section aria-labelledby="preview-h" className="space-y-3 lg:col-span-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="preview-h" className="text-h2">Preview</h2>
              <SegmentedControl<'desktop' | 'phone'> name="preview-width" label="Preview width" value={view} onChange={setView}
                options={[{ value: 'desktop', label: 'Desktop' }, { value: 'phone', label: 'Phone (390px)' }]} />
            </div>
            <div className={`${cardClass} mx-auto p-4 ${view === 'phone' ? 'max-w-[390px]' : ''}`} data-testid="preview">
              {parsed.success ? (
                <FormRenderer
                  key={JSON.stringify(parsed.data).length + view}
                  spec={parsed.data} initial={defaultData(parsed.data, { now: new Date(), timeZone: p.timeZone, currency: p.currency })}
                  files={{}} signatures={{}} actions={[{ name: 'Preview', label: 'Submit (preview)' }]}
                  submit={async () => ({ message: 'Preview only: nothing is saved.', at: Date.now() })}
                  upload={async () => ({ error: 'Preview only: uploads are off.' })}
                  supabase={p.supabase} audience="public" timeZone={p.timeZone} currency={p.currency}
                />
              ) : (
                <Alert tone="warning" title="Preview paused: fix these first">
                  <ul className="list-disc pl-5">{issues(parsed.error).map((x) => <li key={x}>{x}</li>)}</ul>
                </Alert>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'workflow' ? <WorkflowEditor workflow={doc.spec.workflow} onChange={(workflow) => setSpec({ workflow })} /> : null}

      {tab === 'documents' ? (
        <section className={`${cardClass} max-w-2xl space-y-2 p-4`} aria-labelledby="docs-h">
          <h2 id="docs-h" className="text-h2">Entry PDF</h2>
          <label className="flex min-h-11 items-center gap-2 text-body">
            <input type="checkbox" className="size-5" checked={!!docSpec} onChange={(e) => setDoc1(e.target.checked ? {} : null)} /> Entry PDF on
          </label>
          {docSpec ? (
            <>
              <label className="flex min-h-11 items-center gap-2 text-body"><input type="checkbox" className="size-5" checked={docSpec.includeTitle !== false} onChange={(e) => setDoc1({ includeTitle: e.target.checked })} /> Title</label>
              <label className="flex min-h-11 items-center gap-2 text-body"><input type="checkbox" className="size-5" checked={docSpec.includeLogo !== false} onChange={(e) => setDoc1({ includeLogo: e.target.checked })} /> Company name (logo line)</label>
              <label className="flex min-h-11 items-center gap-2 text-body"><input type="checkbox" className="size-5" checked={docSpec.includeBlankFields !== false} onChange={(e) => setDoc1({ includeBlankFields: e.target.checked })} /> Include blank fields</label>
            </>
          ) : null}
          <p className="text-small text-fg-muted">Emails to an address taken from the entry get a PDF without internal-only fields.</p>
        </section>
      ) : null}

      {tab === 'settings' ? (
        <section className={`${cardClass} max-w-2xl space-y-4 p-4`} aria-labelledby="set-h">
          <h2 id="set-h" className="text-h2">Settings</h2>
          <div><Label htmlFor="set-name">Form name</Label><Input id="set-name" value={doc.spec.name} onChange={(e) => setSpec({ name: e.target.value })} /></div>
          <p className="text-small text-fg-muted">Slug <span className="font-mono">{p.slug}</span> (fixed). Public link: {p.isActive ? 'on' : 'off'} · <Link className="underline" href={`/admin/forms/${p.slug}/settings`}>Form settings</Link></p>
          <label className="flex min-h-11 items-center gap-2 text-body">
            <input type="checkbox" className="size-5" checked={!!doc.spec.settings.encryptEntries} disabled={p.hasEntries} onChange={(e) => setSettings({ encryptEntries: e.target.checked || undefined })} />
            Encrypt entries {p.hasEntries ? '(fixed: the form has entries)' : '(only before the first entry)'}
          </label>
          <fieldset>
            <legend className="mb-1.5 text-small font-semibold text-fg">Entry summary (shown in lists)</legend>
            <div className="flex flex-wrap gap-x-4">
              {inputs.map((f) => (
                <label key={f.name} className="flex min-h-11 items-center gap-2 text-body">
                  <input type="checkbox" className="size-5" checked={summary.includes(f.name)}
                    onChange={(e) => setSettings({ entrySummary: summaryFrom(e.target.checked ? [...summary, f.name] : summary.filter((x) => x !== f.name)) })} />
                  {f.label || f.name}
                </label>
              ))}
            </div>
          </fieldset>
        </section>
      ) : null}

      {tab === 'history' ? (
        <div className="space-y-4">
          <section className={`${cardClass} p-4`} aria-labelledby="hist-h">
            <h2 id="hist-h" className="mb-2 text-h2">Versions</h2>
            <ul className="divide-y divide-border" data-testid="versions">
              {p.versions.map((v) => (
                <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="text-body"><span className="font-semibold">Version {v.version}</span>{v.note ? ` · ${v.note}` : ''} <span className="text-small text-fg-muted">· {v.createdAt}</span></span>
                  <button type="button" className={buttonClass('secondary', 32)} disabled={busy}
                    onClick={() => run(async () => { const r = await restoreVersionAction(p.slug, v.version); if (r.ok) window.location.assign(`/admin/forms/${p.slug}/design?restored=${v.version}`); return r; }, `Version ${v.version} restored as the draft.`)}>
                    Restore as draft
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section className={`${cardClass} flex flex-wrap gap-2 p-4`} aria-label="Export">
            <a className={buttonClass('secondary', 36)} href={`/admin/forms/${p.slug}/spec.json`}>Export JSON</a>
            {p.hasDraft ? <a className={buttonClass('secondary', 36)} href={`/admin/forms/${p.slug}/spec.json?draft=1`}>Export draft JSON</a> : null}
            {p.hasDraft ? (
              <button type="button" className={buttonClass('ghost', 36)} disabled={busy}
                onClick={() => run(async () => { const r = await discardDraftAction(p.slug); if (r.ok) window.location.assign(`/admin/forms/${p.slug}/design`); return r; }, 'Draft discarded.')}>
                Discard draft
              </button>
            ) : null}
          </section>
          <form action={archiveFormAction.bind(null, p.slug)} className={`${cardClass} space-y-2 p-4`}>
            <h2 className="text-h2">Archive form</h2>
            <p className="text-small text-fg-muted">Hides the form and turns its public link off. Entries and versions are kept.</p>
            <Label htmlFor="arch-confirm">Type the slug ({p.slug}) to confirm</Label>
            <Input id="arch-confirm" name="confirm" autoComplete="off" className="max-w-xs" />
            <button className={buttonClass('destructive-outline', 36)}>Archive form</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
