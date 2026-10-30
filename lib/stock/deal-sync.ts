// DEAL entry -> stock_deals: which deals exist and what the sync job writes (docs/M6.md sections 3, 4 and 6). Pure.
// The job (lib/stock/deal-jobs.ts) decrypts DEAL entries server-side, asks stockDealFor what the deal should look
// like and planDealSync what to write. Nothing here reads personal data: dealFromEntry carries over the date,
// location, part numbers, line descriptions and quote number only.

import { dealFromEntry, johannesburgYear, type StockDealFields } from './deal';

export const DEAL_FORM_SLUG = 'deal';
export const DEALS_FROM_KEY = 'stock.deals_from';
export const DEAL_SYNC_QUEUE = 'stock.deal-sync';
export const DEALS_BACKFILL_QUEUE = 'stock.deals-backfill';
/** DEAL actions that save the entry (Submit, Update and the generic Action) re-sync its stock deal. */
export const DEAL_SYNC_ACTIONS: readonly string[] = ['Submit', 'Update', 'Action'];
/** Drafts are not deals yet (lib/workflow/rules.ts NEW_ENTRY_STATUS). */
const DRAFT_STATUS = 'Incomplete';
const TZ = 'Africa/Johannesburg';

export type DealStatus = 'awaiting_dispatch' | 'dispatched' | 'dismissed';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Calendar date ("YYYY-MM-DD") of an instant in Africa/Johannesburg. */
function johannesburgDate(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * app_settings 'stock.deals_from' -> "YYYY-MM-DD", or null when unset or unreadable (then no deals are imported).
 * The setup page stores a JSON string ("2026-03-01"); an object { date } or a full timestamp is read too.
 */
export function parseDealsFrom(v: unknown): string | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return parseDealsFrom((v as { date?: unknown }).date);
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, 10);
  return validIsoDate(s) ? s : null;
}

/**
 * The DEAL's date: DATE CREATED ("YYYY-MM-DD"; a full timestamp is read in Africa/Johannesburg), else the entry's
 * created date in Africa/Johannesburg. Same rule as dealYear, so a deal's year and its date always agree.
 */
export function dealDate(dateCreated: unknown, entryCreatedAt: string): string | null {
  const s = typeof dateCreated === 'string' ? dateCreated.trim() : '';
  if (validIsoDate(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = johannesburgDate(s);
    const y = johannesburgYear(s);
    if (d && y !== null && y >= 2000 && y <= 2100) return d;
  }
  return johannesburgDate(entryCreatedAt);
}

/** Whether a DEAL dated `dateCreated` falls on or after the start date. No start date = nothing is in scope. */
export function inDealScope(dateCreated: unknown, entryCreatedAt: string, dealsFrom: string | null): boolean {
  if (!dealsFrom) return false;
  const d = dealDate(dateCreated, entryCreatedAt);
  return !!d && d >= dealsFrom;
}

export interface DealEntry {
  id: string;
  number: number;
  status: string;
  /** entries.created_at (UTC ISO). */
  createdAt: string;
  /** Decrypted DEAL data. Never logged or stored: only dealFromEntry's output leaves this module. */
  data: Record<string, unknown>;
}

export interface DealReference {
  /** The org's stock_models part numbers (model detection; the FK on stock_deals.model_part). */
  modelParts: readonly string[];
  /** The org's stock_locations ids (the FK on stock_deals.location_id). */
  locationIds: readonly string[];
}

/**
 * What the stock deal for a DEAL entry should hold, or null when the entry is not a stock deal: a draft
 * (Incomplete), or dated before the start date (or no start date set).
 */
export function stockDealFor(entry: DealEntry, dealsFrom: string | null, ref: DealReference): StockDealFields | null {
  if (entry.status === DRAFT_STATUS) return null;
  if (!inDealScope(entry.data.DATECREATED, entry.createdAt, dealsFrom)) return null;
  const fields = dealFromEntry(entry.data, { id: entry.id, number: entry.number, created_at: entry.createdAt }, ref.modelParts);
  if (fields.location_id && !ref.locationIds.includes(fields.location_id)) fields.location_id = null;
  return fields;
}

/** A stock_deals row as the sync reads it. */
export interface ExistingDeal {
  id: string;
  entry_id: string | null;
  year: number;
  number: number;
  location_id: string | null;
  model_part: string | null;
  quote_number: string | null;
  accessories: string[];
  status: DealStatus;
  unit_id: string | null;
  /** Dismissed at least once (stock_deal_dismissals rows): it has history and is never removed. */
  hasHistory: boolean;
}

type Patch = Partial<Pick<StockDealFields, 'entry_id' | 'year' | 'number' | 'location_id' | 'model_part' | 'quote_number' | 'accessories'>>;

export type DealSyncPlan =
  | { kind: 'insert'; row: StockDealFields }
  | { kind: 'update'; id: string; patch: Patch }
  | { kind: 'remove'; id: string }
  | { kind: 'noop'; reason: 'unchanged' | 'out_of_scope' | 'kept' };

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * What the sync writes for one DEAL entry.
 * - New in-scope deal -> insert (awaiting dispatch).
 * - Existing deal -> update the descriptive columns (branch, model, quote number, accessories) that changed. Status,
 *   unit and dismissal columns are never written: a dispatched or dismissed deal is never downgraded. Year and number
 *   (how Dispatch finds the deal) follow the DEAL only while the deal awaits dispatch and was never dismissed.
 * - Out of scope (draft, before the start date) -> an awaiting deal with no history (never dismissed, no unit) is
 *   removed, so moving the start date later and rebuilding takes the early deals off the list; anything with
 *   history is kept as is.
 */
export function planDealSync(existing: ExistingDeal | null, next: StockDealFields | null): DealSyncPlan {
  if (!next) {
    if (!existing) return { kind: 'noop', reason: 'out_of_scope' };
    if (existing.status === 'awaiting_dispatch' && !existing.hasHistory && !existing.unit_id) return { kind: 'remove', id: existing.id };
    return { kind: 'noop', reason: 'kept' };
  }
  if (!existing) return { kind: 'insert', row: next };

  const patch: Patch = {};
  if (existing.entry_id !== next.entry_id) patch.entry_id = next.entry_id;
  const identityFollows = existing.status === 'awaiting_dispatch' && !existing.hasHistory;
  if (identityFollows && existing.year !== next.year) patch.year = next.year;
  if (identityFollows && existing.number !== next.number) patch.number = next.number;
  if (existing.location_id !== next.location_id) patch.location_id = next.location_id;
  if (existing.model_part !== next.model_part) patch.model_part = next.model_part;
  if (existing.quote_number !== next.quote_number) patch.quote_number = next.quote_number;
  if (!sameList(existing.accessories ?? [], next.accessories)) patch.accessories = next.accessories;
  return Object.keys(patch).length ? { kind: 'update', id: existing.id, patch } : { kind: 'noop', reason: 'unchanged' };
}

/** Outbox queues a form save enqueues for stock (payload { entryId }). */
export function stockJobsForSave(formSlug: string, actionName: string): string[] {
  return formSlug === DEAL_FORM_SLUG && DEAL_SYNC_ACTIONS.includes(actionName) ? [DEAL_SYNC_QUEUE] : [];
}

export interface DealSyncCounts {
  inserted: number;
  updated: number;
  removed: number;
  unchanged: number;
  /** Not a stock deal (draft or before the start date) and nothing to remove. */
  skipped: number;
  /** Year and number already taken by another DEAL's stock deal: left alone, reported. */
  conflicts: number;
  /** Entries that could not be read (decryption failed): left alone, reported. */
  failed: number;
}

export const emptyCounts = (): DealSyncCounts => ({ inserted: 0, updated: 0, removed: 0, unchanged: 0, skipped: 0, conflicts: 0, failed: 0 });
