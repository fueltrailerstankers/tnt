// Entries grid: URL query parsing, column choice, timezone date ranges and CSV. Pure.
import { z } from 'zod';
import { fieldByName, inputFields, type FormSpec, type InputField } from '@/lib/spec/types';
import { formatValue, type EntryData } from '@/lib/spec/values';
import { toneFor, type Tone } from '@/lib/ui/status';

export const PAGE_SIZE = 50;
export const EXPORT_LIMIT = 10_000;

export interface GridQuery {
  view: 'all' | 'unread' | 'status';
  status: string | null;
  q: string | null;
  from: string | null; // YYYY-MM-DD, org timezone
  to: string | null;
  page: number;
  cols: string[];
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return DATE.test(s) && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/** Columns the grid can show: data fields only (no files, signatures, content, panels or the checklist). */
export function columnChoices(spec: FormSpec): Array<{ name: string; label: string }> {
  return inputFields(spec)
    .filter((f) => !['file', 'signature', 'section', 'table'].includes(f.type))
    .map((f) => ({ name: f.name, label: (f.label ?? '').trim() || f.name }));
}

export function defaultColumns(spec: FormSpec): string[] {
  return columnChoices(spec).slice(0, 4).map((c) => c.name);
}

export function parseGridQuery(spec: FormSpec, p: Params): GridQuery {
  const statuses = spec.workflow.statuses.map((s) => s.name);
  const rawView = one(p.view);
  let view: GridQuery['view'] = 'all';
  let status: string | null = null;
  if (rawView === 'unread') view = 'unread';
  else if (rawView.startsWith('status:') && statuses.includes(rawView.slice(7))) {
    view = 'status';
    status = rawView.slice(7);
  }
  const allowed = new Set(columnChoices(spec).map((c) => c.name));
  const picked = (Array.isArray(p.cols) ? p.cols : one(p.cols).split(',')).filter((c) => allowed.has(c));
  const q = one(p.q).trim().slice(0, 100);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(one(p.page), 10) || 1));
  return {
    view, status, q: q || null,
    from: isDate(one(p.from)) ? one(p.from) : null,
    to: isDate(one(p.to)) ? one(p.to) : null,
    page,
    cols: picked.length ? picked.slice(0, 12) : defaultColumns(spec),
  };
}

/** Escapes LIKE wildcards so a search for "50%" matches literally. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Start of a calendar day in a timezone, as a UTC instant. */
export function zonedDayStart(date: string, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(guess))
    .reduce<Record<string, number>>((a, x) => (x.type !== 'literal' ? { ...a, [x.type]: Number(x.value) } : a), {});
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return new Date(guess - (asUtc - guess)).toISOString();
}

export function dateRange(q: Pick<GridQuery, 'from' | 'to'>, timeZone: string): { from: string | null; to: string | null } {
  const next = (d: string) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + 1)).toISOString().slice(0, 10);
  return { from: q.from ? zonedDayStart(q.from, timeZone) : null, to: q.to ? zonedDayStart(next(q.to), timeZone) : null };
}

export function formatDateTime(iso: string | null, timeZone: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-ZA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

export interface ExportRow {
  number: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  data: EntryData;
}

/** A grid cell: the stored value as text, with the field's type (datetime in the org timezone, rating "4/5"). */
export function gridCell(spec: FormSpec, name: string, v: unknown, timeZone: string): string {
  return formatValue(fieldByName(spec, name), v, { timeZone });
}

/** Export text of one value. M8 types: currency splits into amount + code columns (see exportTable), rating is the number. */
function exportCell(f: InputField | undefined, v: unknown, timeZone: string): string {
  if (f?.type === 'rating' && typeof v === 'number') return String(v);
  return formatValue(f, v, { timeZone });
}

/**
 * Header and rows for CSV/XLSX: Entry number, status, timestamps, then every data field (protected fields
 * masked). A currency field (M8) gives two columns, "<label>" (amount, 2 decimals) and "<label> currency".
 */
export function exportTable(spec: FormSpec, rows: ExportRow[], timeZone: string, revealProtected: boolean): string[][] {
  const fields = columnChoices(spec);
  const byName = new Map(inputFields(spec).map((f) => [f.name, f]));
  const prot = new Set(inputFields(spec).filter((f) => f.type === 'email' && f.protected).map((f) => f.name));
  const isMoney = (name: string) => byName.get(name)?.type === 'currency';
  const header = ['Entry Number', 'Status', 'Created', 'Updated', ...fields.flatMap((f) => (isMoney(f.name) ? [f.label, `${f.label} currency`] : [f.label]))];
  const hasChecklist = !!spec.checklist;
  if (hasChecklist) header.push(...spec.checklist!.map((c) => c.label));
  const body = rows.map((r) => {
    const cells = [String(r.number), r.status, formatDateTime(r.createdAt, timeZone), formatDateTime(r.updatedAt, timeZone)];
    for (const f of fields) {
      const v = r.data[f.name];
      if (isMoney(f.name)) {
        const m = v as { amount?: unknown; currency?: unknown } | undefined;
        cells.push(typeof m?.amount === 'number' ? m.amount.toFixed(2) : '', typeof m?.currency === 'string' ? m.currency : '');
        continue;
      }
      cells.push(prot.has(f.name) && !revealProtected && v ? '(protected)' : exportCell(byName.get(f.name), v, timeZone));
    }
    if (hasChecklist) {
      const list = (r.data.checklist as Array<{ itemNo: number; fail: boolean; pass: boolean; comments: string }> | undefined) ?? [];
      for (const c of spec.checklist!) {
        const x = list.find((y) => y.itemNo === c.itemNo);
        cells.push([x?.pass ? 'Pass' : '', x?.fail ? 'Fail' : '', x?.comments ?? ''].filter(Boolean).join(' / '));
      }
    }
    return cells;
  });
  return [header, ...body];
}

/** Spreadsheet formula injection guard: cells starting with = + - @ tab or CR are prefixed with '. */
export function safeCell(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export function toCsv(table: string[][]): string {
  return '﻿' + table.map((row) => row.map((v) => {
    const s = safeCell(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Redesigned entries grid (UI handoff Entries.dc.html). Pure.
// ---------------------------------------------------------------------------

type HrefKey = 'view' | 'q' | 'from' | 'to' | 'cols' | 'page';

/** The `view` URL value of a query: null (all), 'unread' or 'status:<name>'. */
export function viewParam(q: Pick<GridQuery, 'view' | 'status'>): string | null {
  if (q.view === 'unread') return 'unread';
  if (q.view === 'status' && q.status) return `status:${q.status}`;
  return null;
}

/**
 * The grid's own URL: the current query with some keys replaced (null drops a key). Page 1 is never written, and
 * the columns only when they differ from the form's defaults (so built-in views keep short URLs).
 */
export function gridHref(slug: string, spec: FormSpec, q: GridQuery, over: Partial<Record<HrefKey, string | null>> = {}): string {
  const cols = q.cols.join(',');
  const base: Record<HrefKey, string | null> = {
    view: viewParam(q),
    q: q.q, from: q.from, to: q.to,
    cols: cols && cols !== defaultColumns(spec).join(',') ? cols : null,
    page: q.page > 1 ? String(q.page) : null,
  };
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v && !(k === 'page' && v === '1')) u.set(k, v);
  const s = u.toString();
  return `/admin/forms/${slug}${s ? `?${s}` : ''}`;
}

/** Whether a search or date filter is applied: the empty state then offers Clear filters. */
export function hasFilters(q: Pick<GridQuery, 'q' | 'from' | 'to'>): boolean {
  return !!(q.q || q.from || q.to);
}

export interface ViewCounts {
  all: number;
  unread: number;
  byStatus: Readonly<Record<string, number>>;
}

export interface ViewChip {
  /** The `view` URL value ('all' for none). */
  value: string;
  label: string;
  count: number;
  dot: Tone | 'all';
}

/**
 * Filter chips with counts: All entries, Unread, then each status in spec order. Archived statuses show only while
 * they still hold entries (Store Room "Submitted"). Dots take the status colour; the label always carries meaning.
 */
export function viewChips(spec: FormSpec, counts: ViewCounts): ViewChip[] {
  const chips: ViewChip[] = [
    { value: 'all', label: 'All entries', count: counts.all, dot: 'all' },
    { value: 'unread', label: 'Unread', count: counts.unread, dot: 'all' },
  ];
  for (const s of spec.workflow.statuses) {
    const n = counts.byStatus[s.name] ?? 0;
    if (s.archived && !n) continue;
    chips.push({ value: `status:${s.name}`, label: s.name, count: n, dot: toneFor(s.name, s.color) });
  }
  return chips;
}

export interface GridColumn {
  key: string;
  label: string;
  visible: boolean;
  required?: boolean;
}

/** Fixed columns every grid shows; field columns sit between Summary and Created. */
export const FIXED_COLUMNS = [
  { key: '_number', label: '#' },
  { key: '_summary', label: 'Summary' },
  { key: '_created', label: 'Created' },
  { key: '_status', label: 'Status' },
] as const;

/**
 * Column picker options. Encrypted forms (DEAL, Delivery Note) list only number, summary, created and status: no
 * field is offered, so no field value can reach the grid. Other forms offer every data field.
 */
export function gridColumns(spec: FormSpec, encrypted: boolean, visibleCols: readonly string[]): GridColumn[] {
  const fixed = (i: number): GridColumn => ({ ...FIXED_COLUMNS[i], visible: true, required: true });
  const fields = encrypted ? [] : columnChoices(spec).map((c) => ({ key: c.name, label: c.label, visible: visibleCols.includes(c.name) }));
  return [fixed(0), fixed(1), ...fields, fixed(2), fixed(3)];
}

/** Field columns to render, in the chosen order. Always none for encrypted forms. */
export function visibleFieldColumns(spec: FormSpec, encrypted: boolean, cols: readonly string[]): Array<{ name: string; label: string }> {
  if (encrypted) return [];
  const label = new Map(columnChoices(spec).map((c) => [c.name, c.label]));
  return cols.filter((c) => label.has(c)).map((c) => ({ name: c, label: label.get(c)! }));
}

// --- bulk actions and export inputs (Zod) -------------------------------------------------------------------------

/** Most rows one bulk action or "Export selected" takes (a page is PAGE_SIZE). */
export const BULK_MAX = 200;

/** Mark read / Mark unread: entry ids from the current page, and the mode. */
export const ReadStateInput = z.object({
  ids: z.array(z.string().uuid()).min(1, 'Select entries first.').max(BULK_MAX),
  mode: z.enum(['read', 'unread']),
}).strict();
export type ReadStateInput = z.output<typeof ReadStateInput>;

/**
 * Export route options: format (CSV unless xlsx) and an optional selection of entry numbers ("sel=214,213"). The
 * rest of the query is the grid filter, parsed by parseGridQuery.
 */
export const ExportParams = z.object({
  format: z.enum(['csv', 'xlsx']).catch('csv'),
  sel: z.string().max(2400).optional().transform((s, ctx) => {
    if (!s) return null;
    const parts = s.split(',');
    if (parts.length > BULK_MAX || parts.some((p) => !/^[1-9]\d{0,8}$/.test(p))) {
      ctx.addIssue({ code: 'custom', message: 'Invalid selection' });
      return z.NEVER;
    }
    return [...new Set(parts.map(Number))];
  }),
});
export type ExportParams = z.output<typeof ExportParams>;

/** Export link for the current filter, optionally limited to the selected entry numbers. */
export function exportHref(slug: string, q: GridQuery, format: 'csv' | 'xlsx', selected: readonly number[] = []): string {
  const u = new URLSearchParams({ format });
  const view = viewParam(q);
  if (view) u.set('view', view);
  if (q.q) u.set('q', q.q);
  if (q.from) u.set('from', q.from);
  if (q.to) u.set('to', q.to);
  if (q.cols.length) u.set('cols', q.cols.join(','));
  if (selected.length) u.set('sel', selected.join(','));
  return `/admin/forms/${slug}/export?${u}`;
}

/**
 * Export of an encrypted form: the clear columns only (number, status, timestamps, summary). Field values stay
 * sealed; reading them means opening the entry, which is logged.
 */
export function clearExportTable(
  rows: ReadonlyArray<Pick<ExportRow, 'number' | 'status' | 'createdAt' | 'updatedAt'> & { summary: string | null }>,
  timeZone: string,
): string[][] {
  return [
    ['Entry Number', 'Status', 'Created', 'Updated', 'Summary'],
    ...rows.map((r) => [String(r.number), r.status, formatDateTime(r.createdAt, timeZone), formatDateTime(r.updatedAt, timeZone), r.summary ?? '']),
  ];
}

// --- saved views ----------------------------------------------------------------------------------------------------

/** What "Save view" stores for the current grid: view, search, dates and non-default columns. Never paging. */
export function gridViewQuery(spec: FormSpec, q: GridQuery): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const view = viewParam(q);
  if (view) out.view = view;
  if (q.q) out.q = q.q;
  if (q.from) out.from = q.from;
  if (q.to) out.to = q.to;
  if (q.cols.join(',') !== defaultColumns(spec).join(',')) out.cols = [...q.cols];
  return out;
}

function paramsOf(href: string): { path: string; params: Params } {
  const u = new URL(href, 'http://local');
  const params: Params = {};
  for (const k of new Set(u.searchParams.keys())) {
    const all = u.searchParams.getAll(k);
    params[k] = all.length > 1 ? all : all[0];
  }
  return { path: u.pathname, params };
}

/**
 * Which view the select shows: a saved view whose stored query gives this grid, else the built-in "all" or
 * "unread", else "custom" (filters no view holds).
 */
export function currentViewId(slug: string, spec: FormSpec, q: GridQuery, saved: ReadonlyArray<{ id: string; href: string }>): string {
  const here = gridHref(slug, spec, { ...q, page: 1 });
  const hit = saved.find((v) => {
    const { path, params } = paramsOf(v.href);
    return path === `/admin/forms/${slug}` && gridHref(slug, spec, { ...parseGridQuery(spec, params), page: 1 }) === here;
  });
  if (hit) return hit.id;
  if (here === `/admin/forms/${slug}`) return 'all';
  if (here === `/admin/forms/${slug}?view=unread`) return 'unread';
  return 'custom';
}
