// Snapshot of how each of the 7 kit forms renders, reads, validates and displays. The baseline in
// tests/fixtures/kit-forms/baseline.json was written from the engine BEFORE M8 (field types, required,
// show-when); kit-forms-unchanged.test.ts compares the current engine with it. Synthetic values only.
//
// Regenerate (only when a kit change is intended): KIT_BASELINE=write pnpm test tests/unit/kit-forms-unchanged.test.ts
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { FormRenderer, type FormRendererProps } from '@/components/form-engine/FormRenderer';
import { columnChoices, defaultColumns, exportTable } from '@/lib/admin/grid';
import { quoteFieldOf } from '@/lib/forms/quote-fields';
import { EntryPdf } from '@/lib/pdf/EntryPdf';
import { pages } from '@/lib/spec/layout';
import { inputFields, type FormSpec } from '@/lib/spec/types';
import { defaultData, displayValue, readFormData, renderSummary, validateEntry } from '@/lib/spec/values';
import { entryDetailRows } from '@/lib/workflow/email-template';
import { allowedActions, internalRole, NEW_ENTRY_STATUS, publicRole } from '@/lib/workflow/rules';
import { fd } from './specs';

export const TODAY = '2026-10-29';
export const TZ = 'Africa/Johannesburg';
const LOOKUP_ID = '11111111-1111-4111-8111-111111111111';
const SIG_ID = '22222222-2222-4222-8222-222222222222';

/** A FormData-like record with a plausible value for every input of the spec. */
export function sampleValues(spec: FormSpec): Record<string, string | string[]> {
  const v: Record<string, string | string[]> = {};
  for (const f of inputFields(spec)) {
    const k = `f.${f.name}`;
    switch (f.type) {
      case 'text': v[k] = `T-${f.name}`; break;
      case 'textarea': v[k] = `Line one ${f.name}`; break;
      case 'email': v[k] = `${f.name.toLowerCase()}@example.invalid`; break;
      case 'date': v[k] = TODAY; break;
      case 'number': v[k] = f.integer ? '42' : '42.5'; break;
      case 'choice': v[k] = f.multi ? f.options.slice(0, 2) : f.options[f.options.length - 1]; break;
      case 'name': case 'address': for (const p of f.parts) v[`${k}.${p}`] = `${p}-x`; break;
      case 'lookup': v[k] = LOOKUP_ID; break;
      case 'signature': v[`sig.${f.name}`] = `keep:${SIG_ID}`; break;
      case 'file': v[`file.${f.name}`] = '[]'; break;
      case 'section': v['cl.1.pass'] = 'on'; v['cl.2.fail'] = 'on'; v['cl.2.comments'] = 'loose bolt'; break;
      default: break;
    }
  }
  return v;
}

/** Values every typed field rejects. */
export function badValues(spec: FormSpec): Record<string, string | string[]> {
  const v: Record<string, string | string[]> = {};
  for (const f of inputFields(spec)) {
    const k = `f.${f.name}`;
    if (f.type === 'email') v[k] = 'not-an-email';
    if (f.type === 'date') v[k] = '2026-02-30';
    if (f.type === 'number') v[k] = f.integer ? '1.5' : 'abc';
    if (f.type === 'choice') v[k] = 'NOT AN OPTION';
    if (f.type === 'lookup') v[k] = 'not-a-uuid';
    if (f.type === 'signature') v[`sig.${f.name}`] = 'data:text/html;base64,PHNjcmlwdD4=';
    if (f.type === 'file') v[`file.${f.name}`] = '{bad json';
  }
  return v;
}

const noop = async () => ({});

function baseProps(spec: FormSpec): FormRendererProps {
  return {
    spec, initial: {}, files: {}, signatures: {}, actions: [], submit: noop, upload: noop,
    supabase: { url: 'http://127.0.0.1:1', anonKey: 'stub-anon-key' },
  };
}

export function renderHtml(props: FormRendererProps): string {
  return renderToStaticMarkup(createElement(FormRenderer, props));
}

/** The three ways a kit form is rendered: new public entry, existing staff entry, read-only. */
export function renderVariants(spec: FormSpec, extra: Partial<FormRendererProps> = {}) {
  const hasLookup = spec.fields.some((f) => f.type === 'lookup');
  const quote = !!quoteFieldOf(spec);
  const sample = readFormData(spec, fd(sampleValues(spec))).data;
  const pub = allowedActions(spec, NEW_ENTRY_STATUS, publicRole(spec).name).map((a) => ({ name: a.name, label: a.button }));
  const staff = allowedActions(spec, 'Submitted', internalRole(spec).name).map((a) => ({ name: a.name, label: a.button }));
  return {
    publicNew: renderHtml({
      ...baseProps(spec), initial: defaultData(spec, { today: TODAY }), actions: pub, honeypot: true,
      lookup: hasLookup ? { mode: 'exact', find: async () => null } : undefined,
      quotes: quote ? { mode: 'check', check: async () => ({ found: false }) } : undefined,
      ...extra,
    }),
    staffExisting: renderHtml({
      ...baseProps(spec), initial: sample, actions: staff.length ? staff : [{ name: 'Update', label: 'Save' }],
      signatures: Object.fromEntries(inputFields(spec).filter((f) => f.type === 'signature').map((f) => [f.name, { id: SIG_ID, name: `${f.name}.png`, url: null }])),
      files: Object.fromEntries(inputFields(spec).filter((f) => f.type === 'file').map((f) => [f.name, [{ id: SIG_ID, name: 'proof.pdf', url: null }]])),
      lookup: hasLookup ? { mode: 'list', options: [{ id: LOOKUP_ID, label: 'QTEST-1' }], panel: async () => [] } : undefined,
      lookupPanel: hasLookup ? [['Name', 'Test Person']] : undefined,
      quotes: quote ? { mode: 'search', search: async () => [] } : undefined,
      hidden: { __version: '2026-10-29T08:00:00.000Z' },
      ...extra,
    }),
    readOnly: renderHtml({ ...baseProps(spec), initial: sample, ...extra }),
  };
}

export function sha(s: string | Buffer): string {
  return createHash('sha256').update(s).digest('hex');
}

/** react-pdf stamps the creation date and a random document id; everything else is deterministic. */
export function normalisePdf(b: Buffer): string {
  return b.toString('latin1').replace(/\(D:\d{14}Z\)/g, '(D:0)').replace(/\/ID \[<[0-9a-f]+> <[0-9a-f]+>\]/g, '/ID [<0> <0>]');
}

export async function pdfHash(spec: FormSpec, data: Record<string, unknown>): Promise<string> {
  const files = Object.fromEntries(inputFields(spec).filter((f) => f.type === 'file').map((f) => [f.name, ['proof.pdf']]));
  const doc = createElement(EntryPdf, {
    spec, title: `${spec.name} - 7`, entry: { number: 7, status: 'Submitted', createdAt: '2026-10-29T08:00:00Z', updatedAt: '2026-10-29T09:30:00Z' },
    data, files, signatures: {}, lookupPanel: [['Name', 'Test Person']], timezone: TZ, generatedAt: '2026-10-29T10:00:00Z',
  });
  return sha(normalisePdf(await renderToBuffer(doc as Parameters<typeof renderToBuffer>[0])));
}

/** Everything compared for one kit form, using only the engine's pre-M8 call signatures. */
export async function kitSnapshot(spec: FormSpec) {
  const sample = readFormData(spec, fd(sampleValues(spec)));
  const empty = readFormData(spec, fd({}));
  const bad = readFormData(spec, fd(badValues(spec)));
  const counts = Object.fromEntries(inputFields(spec).filter((f) => f.type === 'file' || f.type === 'signature').map((f) => [f.name, 1]));
  const html = renderVariants(spec);
  const rows = [{ number: 7, status: 'Submitted', createdAt: '2026-10-29T08:00:00Z', updatedAt: '2026-10-29T09:30:00Z', data: sample.data }];
  return {
    pages: pages(spec).map((p) => ({ title: p.title ?? null, next: p.nextButton, back: p.backButton ?? null, rows: p.rows.map((r) => r.cells.map((c) => `${'name' in c.field ? c.field.name : c.field.type}@${c.col}+${c.span}`)) })),
    read: { sample, empty, bad },
    validate: { empty: validateEntry(spec, empty.data, {}), sample: validateEntry(spec, sample.data, counts) },
    defaults: { plain: defaultData(spec), today: defaultData(spec, { today: TODAY }) },
    summary: renderSummary(spec.settings.entrySummary, sample.data),
    display: Object.fromEntries(inputFields(spec).map((f) => [f.name, displayValue(sample.data[f.name])])),
    columns: { choices: columnChoices(spec), defaults: defaultColumns(spec) },
    export: { masked: exportTable(spec, rows, TZ, false), revealed: exportTable(spec, rows, TZ, true) },
    email: entryDetailRows(spec, sample.data, counts),
    html: { publicNew: sha(html.publicNew), staffExisting: sha(html.staffExisting), readOnly: sha(html.readOnly) },
    pdf: { sample: await pdfHash(spec, sample.data), blank: await pdfHash(spec, {}) },
  };
}
