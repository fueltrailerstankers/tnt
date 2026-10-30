// Unit register (stock plan 7.3): URL query, search parsing, CSV table, and the Correct record / Transfer inputs.
// Pure. The pages and the export route apply these to PostgREST queries (lib/stock/register-query.ts).

import { z } from 'zod';
import { searchTerm } from '@/lib/admin/format';
import { pageOf } from '@/lib/admin/mirror';
import { UNIT_STATUSES, type UnitStatus } from './kpi';
import { partKey } from './models';
import { normalizeVin } from './vin';

export const REGISTER_PAGE = 50;
/** Rows per request when the export reads the register in chunks (PostgREST caps a response at 1000 by default). */
export const EXPORT_CHUNK = 1000;
export const EXPORT_MAX_ROWS = 10_000;

/** Status filter: one status, or in_stock = available + reserved (what the overview counts). */
export const STATUS_FILTERS = ['in_stock', 'available', 'reserved', 'sold'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  in_stock: 'In stock (available + reserved)',
  available: 'Available',
  reserved: 'Reserved',
  sold: 'Sold',
};

/** Location filter value for "every branch" (all locations except the Factory). */
export const ALL_BRANCHES = 'branches';

export interface RegisterQuery {
  q: string | null;
  /** Exact model part number (from an overview cell). */
  model: string | null;
  /** A location id, ALL_BRANCHES, or null for every location. */
  location: string | null;
  status: StatusFilter | null;
  page: number;
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
/**
 * Reads the register query from the URL. Unknown locations, statuses and models are dropped: the model must be one
 * of the org's part numbers, so free text (an ID number, a name) never reaches a query or the export audit row.
 */
export function parseRegisterQuery(sp: Params, locationIds: readonly string[], modelParts: readonly string[]): RegisterQuery {
  const model = partKey(one(sp.model));
  const loc = one(sp.location).trim();
  const locUpper = loc.toUpperCase();
  const status = one(sp.status);
  return {
    q: searchTerm(sp.q),
    model: model && modelParts.includes(model) ? model : null,
    location: loc === ALL_BRANCHES ? ALL_BRANCHES : locationIds.includes(locUpper) ? locUpper : null,
    status: (STATUS_FILTERS as readonly string[]).includes(status) ? (status as StatusFilter) : null,
    page: pageOf(sp.page),
  };
}

/** URL query string for the register (defaults left out), e.g. "q=ABC&status=sold". */
export function registerQueryString(rq: RegisterQuery, over: Partial<RegisterQuery> = {}): string {
  const m = { ...rq, ...over };
  const u = new URLSearchParams();
  if (m.q) u.set('q', m.q);
  if (m.model) u.set('model', m.model);
  if (m.location) u.set('location', m.location);
  if (m.status) u.set('status', m.status);
  if (m.page > 1) u.set('page', String(m.page));
  return u.toString();
}

export function registerHref(rq: RegisterQuery, over: Partial<RegisterQuery> = {}, base = '/admin/stock/units'): string {
  const s = registerQueryString(rq, over);
  return s ? `${base}?${s}` : base;
}

export const EMPTY_REGISTER_QUERY: RegisterQuery = { q: null, model: null, location: null, status: null, page: 1 };

/** Register link with only the given filters (overview cells and KPI cards). */
export function unitsHref(over: Partial<RegisterQuery>): string {
  return registerHref(EMPTY_REGISTER_QUERY, over);
}

export type RegisterSearch =
  | { kind: 'none' }
  /** "2026/248" or "2026 / 248": one deal year and sequence. */
  | { kind: 'deal'; year: number; sequence: number }
  /** Free text: VIN contains (normalised), invoice or model contains (spaces removed), or the sequence when numeric. */
  | { kind: 'text'; vin: string; text: string; sequence: number | null };

/** Splits the search box into what the register matches: VIN, sequence, model or invoice. */
export function parseRegisterSearch(q: string | null): RegisterSearch {
  if (!q) return { kind: 'none' };
  const deal = q.match(/^\s*(\d{4})\s*\/\s*(\d{1,9})\s*$/);
  if (deal) return { kind: 'deal', year: Number(deal[1]), sequence: Number(deal[2]) };
  const vin = normalizeVin(q);
  if (!vin) return { kind: 'none' };
  const seq = /^\d{1,9}$/.test(vin) ? Number(vin) : null;
  return { kind: 'text', vin, text: vin, sequence: seq !== null && seq > 0 && seq <= 2_147_483_647 ? seq : null };
}

/** PostgREST or() filter for a text search. Values carry no separators: searchTerm and normalizeVin removed them. */
export function registerOrFilter(s: Extract<RegisterSearch, { kind: 'text' }>): string {
  const parts = [`vin_norm.ilike.*${s.vin}*`, `invoice_number.ilike.*${s.text}*`, `model_part.ilike.*${s.text}*`];
  if (s.sequence !== null) parts.push(`sequence.eq.${s.sequence}`);
  return parts.join(',');
}

/** Status filter from a select value (unknown -> null). */
export function statusFilterOf(v: string | null | undefined): StatusFilter | null {
  return v && (STATUS_FILTERS as readonly string[]).includes(v) ? (v as StatusFilter) : null;
}

/** Status values a status filter selects. */
export function statusesFor(f: StatusFilter): UnitStatus[] {
  return f === 'in_stock' ? ['available', 'reserved'] : [f];
}

// ---------------------------------------------------------------------------------------------------
// Unit rows and the CSV export
// ---------------------------------------------------------------------------------------------------

export interface UnitRow {
  id: string;
  vin: string;
  vin_norm: string;
  deal_year: number | null;
  sequence: number | null;
  deal_id: string | null;
  model_part: string;
  location_id: string;
  status: UnitStatus;
  invoice_number: string | null;
  xero_invoice_id: string | null;
  dispatch_date: string | null;
  accessories: string[] | null;
  notes: string | null;
  transfer_reason: string | null;
  sold_at: string | null;
  created_at: string;
  updated_at: string;
}

export const UNIT_COLUMNS =
  'id, vin, vin_norm, deal_year, sequence, deal_id, model_part, location_id, status, invoice_number, xero_invoice_id, dispatch_date, accessories, notes, transfer_reason, sold_at, created_at, updated_at';

/** "2026 / 249", "Sequence 249" (no year), or an em dash. */
export function dealLabel(u: Pick<UnitRow, 'deal_year' | 'sequence'>): string {
  if (u.sequence === null || u.sequence === undefined) return '—';
  return u.deal_year ? `${u.deal_year} / ${u.sequence}` : String(u.sequence);
}

export const CSV_HEADER = ['VIN', 'Deal year', 'Sequence', 'Model', 'Description', 'Location', 'Status', 'Invoice', 'Dispatch date', 'Accessories', 'Notes'];

const STATUS_TEXT: Record<UnitStatus, string> = { available: 'Available', reserved: 'Reserved', sold: 'Sold' };

/** Export table (header first): accessories joined with "; ". Cells are made formula-safe by toCsv. */
export function unitsCsvTable(
  units: readonly UnitRow[],
  description: (part: string) => string | undefined,
  locationName: (id: string) => string | undefined,
): string[][] {
  return [
    CSV_HEADER,
    ...units.map((u) => [
      u.vin,
      u.deal_year ? String(u.deal_year) : '',
      u.sequence ? String(u.sequence) : '',
      u.model_part,
      description(u.model_part) ?? '',
      locationName(u.location_id) ?? u.location_id,
      STATUS_TEXT[u.status] ?? u.status,
      u.invoice_number ?? '',
      u.dispatch_date ?? '',
      (u.accessories ?? []).join('; '),
      u.notes ?? '',
    ]),
  ];
}

/** Newest first, as the register lists units (created_at, then id, both descending). */
export function sortNewestFirst<T extends Pick<UnitRow, 'created_at' | 'id'>>(rows: readonly T[]): T[] {
  const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
  // Instant first; then the text (same column format, so it orders the microseconds Date.parse drops); then the id.
  return [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || desc(a.created_at, b.created_at) || desc(a.id, b.id));
}

/** Refusal text when the filtered set is over the export cap: the file is never cut short silently. */
export function exportTooManyMessage(count: number, max = EXPORT_MAX_ROWS): string {
  const n = (v: number) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `Too many units to export (${n(count)}). Narrow the filters to ${n(max)} units or fewer.`;
}

/**
 * The 'stock.export' audit row: row count and filter codes only. The search text is never stored (it may be
 * anything a user typed); model part numbers, location ids and status values are codes.
 */
export function exportAuditRow(member: { orgId: string; userId: string }, rq: RegisterQuery, rows: number) {
  return {
    org_id: member.orgId, actor_user: member.userId, action: 'stock.export', entity: 'stock_units', entity_id: null,
    meta: { format: 'csv', rows, search: !!rq.q, model: rq.model, location: rq.location, status: rq.status },
  };
}

// ---------------------------------------------------------------------------------------------------
// Correct record (stock_correct_unit) and Transfer (stock_move_unit)
// ---------------------------------------------------------------------------------------------------

export type ActionState = { ok?: string; error?: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (s: string) => {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const digits = (max: number) => z.string().trim().regex(new RegExp(`^\\d{0,${max}}$`));
const flag = z.enum(['1']).optional();

/** The unit's updated_at as the form was rendered: a save refuses when the unit has changed since (isStale). */
const version = z.string().trim().min(1).max(64);

export const CorrectInput = z.object({
  unit: z.guid(),
  updated_at: version,
  vin: z.string().max(80),
  model: z.string().trim().min(1).max(20),
  location: z.string().trim().min(1).max(20),
  status: z.enum(UNIT_STATUSES),
  invoice: z.string().trim().max(50),
  dispatch_date: z.string().trim().refine((s) => s === '' || isRealDate(s)),
  accessories: z.array(z.string().max(200)).max(10),
  /** Length checked after CRLF -> LF, as stored (the textarea's maxLength counts a line break once). */
  notes: z.string().max(4000).refine((s) => normalizeNewlines(s).length <= 2000),
  deal_year: digits(4),
  deal_number: digits(9),
  /** Unit without a deal: link it to the deal year/number (clears that deal). */
  link_deal: flag,
  /** Unit with a deal: unlink it (the deal goes back to awaiting dispatch). */
  unlink_deal: flag,
});
export type CorrectInput = z.infer<typeof CorrectInput>;

export const TransferInput = z.object({
  unit: z.guid(),
  updated_at: version,
  location: z.string().trim().min(1).max(20),
  reason: z.string().trim().max(200),
  deal_year: digits(4),
  deal_number: digits(9),
});
export type TransferInput = z.infer<typeof TransferInput>;

/** Field name in a failed Zod parse -> the stock error field (lib/stock/errors.ts INVALID_INPUT copy). */
export function invalidField(path: readonly PropertyKey[]): string {
  const k = String(path[0] ?? '');
  const map: Record<string, string> = {
    vin: 'vin', model: 'model', location: 'location', status: 'status', invoice: 'invoice_number',
    dispatch_date: 'dispatch_date', accessories: 'accessories', notes: 'notes', reason: 'reason',
    deal_year: 'deal', deal_number: 'deal', link_deal: 'deal', unlink_deal: 'deal', updated_at: 'fields',
  };
  return map[k] ?? 'fields';
}

const num = (s: string) => (s === '' ? null : Number(s));
/** Browsers post textarea line breaks as CRLF; the record keeps LF. */
export const normalizeNewlines = (s: string) => s.replace(/\r\n?/g, '\n');
const clean = (s: string) => {
  const t = normalizeNewlines(s).trim();
  return t === '' ? null : t;
};
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export type CorrectionResult = { fields: Record<string, unknown> } | { error: 'deal_pair' | 'deal_link_needs_deal' };

/**
 * The p_fields for stock_correct_unit: only the values that differ from the stored unit. Empty when nothing changed.
 * Deal handling: a linked unit relinks when the year/number change and unlinks with unlink_deal; an unlinked unit
 * links with link_deal, otherwise its deal year and sequence are plain record values.
 */
export function correctionFields(u: UnitRow, input: CorrectInput): CorrectionResult {
  const f: Record<string, unknown> = {};
  const vin = normalizeVin(input.vin) ?? '';
  if (vin !== u.vin_norm) f.vin = vin;
  const model = partKey(input.model);
  if (model !== u.model_part) f.model_part = model;
  const loc = input.location.trim().toUpperCase();
  if (loc !== u.location_id) f.location_id = loc;
  if (input.status !== u.status) f.status = input.status;
  const inv = clean(input.invoice)?.toUpperCase() ?? null;
  if (inv !== u.invoice_number) f.invoice_number = inv;
  const date = clean(input.dispatch_date);
  if (date !== (u.dispatch_date ?? null)) f.dispatch_date = date ?? '';
  const acc = input.accessories.map((a) => a.trim()).filter(Boolean);
  if (!sameList(acc, u.accessories ?? [])) f.accessories = acc;
  const notes = clean(input.notes);
  if (notes !== clean(u.notes ?? '')) f.notes = notes;

  const year = num(input.deal_year);
  const number = num(input.deal_number);
  const pair = year !== null && number !== null;
  if ((year === null) !== (number === null)) return { error: 'deal_pair' };
  if (u.deal_id) {
    if (input.unlink_deal) f.deal = null;
    else if (!pair) return { error: 'deal_pair' };
    else if (year !== u.deal_year || number !== u.sequence) f.deal = { year, number };
  } else if (input.link_deal) {
    if (!pair) return { error: 'deal_link_needs_deal' };
    f.deal = { year, number };
  } else {
    if (year !== u.deal_year) f.deal_year = year;
    if (number !== u.sequence) f.sequence = number;
  }
  return { fields: f };
}

export const STALE_MESSAGE = 'This unit changed since you opened it. Reload and check.';

/**
 * Whether the unit changed after the form was rendered (another admin, a dispatch or the invoice job). The form posts
 * the updated_at it was rendered with; correctionFields compares against the current row, so saving a stale form
 * would silently put back the status, invoice or location someone else just changed.
 */
export function isStale(u: Pick<UnitRow, 'updated_at'>, renderedUpdatedAt: string): boolean {
  // Both values come from the same PostgREST column, so the text is identical unless the row was written since.
  return u.updated_at !== renderedUpdatedAt.trim();
}

/** Arguments for stock_move_unit (deal only when both parts are given). Null when only one part is given. */
export function transferArgs(orgId: string, input: TransferInput) {
  const year = num(input.deal_year);
  const number = num(input.deal_number);
  if ((year === null) !== (number === null)) return null;
  return {
    p_org: orgId,
    p_unit: input.unit,
    p_location: input.location.trim().toUpperCase(),
    p_reason: clean(input.reason),
    p_deal_year: year,
    p_deal_number: number,
  };
}

/** Changed field keys in plain words, for the success message ("Saved: VIN, notes."). */
export function changedSummary(fields: Record<string, unknown>): string {
  const label: Record<string, string> = {
    vin: 'VIN', model_part: 'model', location_id: 'location', status: 'status', invoice_number: 'invoice',
    dispatch_date: 'dispatch date', accessories: 'accessories', notes: 'notes', deal_year: 'deal year',
    sequence: 'sequence', deal: 'deal link',
  };
  return Object.keys(fields).map((k) => label[k] ?? k).join(', ');
}
