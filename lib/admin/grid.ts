// Entries grid: URL query parsing, column choice, timezone date ranges and CSV. Pure.
import { inputFields, type FormSpec } from '@/lib/spec/types';
import { displayValue, type EntryData } from '@/lib/spec/values';

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

/** Header and rows for CSV/XLSX: Entry number, status, timestamps, then every data field (protected fields masked). */
export function exportTable(spec: FormSpec, rows: ExportRow[], timeZone: string, revealProtected: boolean): string[][] {
  const fields = columnChoices(spec);
  const prot = new Set(inputFields(spec).filter((f) => f.type === 'email' && f.protected).map((f) => f.name));
  const header = ['Entry Number', 'Status', 'Created', 'Updated', ...fields.map((f) => f.label)];
  const hasChecklist = !!spec.checklist;
  if (hasChecklist) header.push(...spec.checklist!.map((c) => c.label));
  const body = rows.map((r) => {
    const cells = [String(r.number), r.status, formatDateTime(r.createdAt, timeZone), formatDateTime(r.updatedAt, timeZone)];
    for (const f of fields) cells.push(prot.has(f.name) && !revealProtected && r.data[f.name] ? '(protected)' : displayValue(r.data[f.name]));
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
