// What the sync asks Xero for, per entity. Pure.
//
// Backfill = a list of passes, each paged until a short/empty page:
//   - everything updated since the backfill start (If-Modified-Since)
//   - plus open documents older than that (open quotes, unpaid invoices), so nothing current is missed.
// After the backfill, each run is incremental from the high-water mark of UpdatedDateUTC.

export type Entity = 'contacts' | 'quotes' | 'invoices' | 'credit_notes' | 'payments';
export const ENTITIES: Entity[] = ['contacts', 'quotes', 'invoices', 'credit_notes', 'payments'];
/** Daytime quick sync: what moves stock and money (credit notes feed the stock invoice rules, M6). */
export const QUICK_ENTITIES: Entity[] = ['invoices', 'credit_notes', 'payments'];

export interface Pass {
  path: string;
  params: Record<string, string>;
  modifiedSince: string | null;
}

export const PATHS: Record<Entity, string> = {
  contacts: '/Contacts',
  quotes: '/Quotes',
  invoices: '/Invoices',
  credit_notes: '/CreditNotes',
  payments: '/Payments',
};

/** Xero array key in each list response. */
export const LIST_KEY: Record<Entity, string> = { contacts: 'Contacts', quotes: 'Quotes', invoices: 'Invoices', credit_notes: 'CreditNotes', payments: 'Payments' };

/** Page sizes: Contacts, Invoices and Payments accept pageSize; Quotes and CreditNotes page at Xero's default of 100. */
export const PAGE_SIZE: Record<Entity, number> = { contacts: 200, quotes: 100, invoices: 200, credit_notes: 100, payments: 200 };

export function backfillPasses(entity: Entity, from: string): Pass[] {
  const since = `${from}T00:00:00Z`;
  const base: Pass = { path: PATHS[entity], params: {}, modifiedSince: since };
  if (entity === 'quotes') {
    return [base, ...['DRAFT', 'SENT', 'ACCEPTED'].map((s) => ({ path: PATHS.quotes, params: { Status: s }, modifiedSince: null }))];
  }
  if (entity === 'invoices') {
    return [base, { path: PATHS.invoices, params: { Statuses: 'DRAFT,SUBMITTED,AUTHORISED' }, modifiedSince: null }];
  }
  return [base];
}

/** Incremental pass from the high-water mark (one minute of overlap: Xero timestamps are to the second). */
export function incrementalPass(entity: Entity, modifiedSince: string | null, from: string): Pass {
  const mark = modifiedSince ? new Date(new Date(modifiedSince).getTime() - 60_000).toISOString() : `${from}T00:00:00Z`;
  return { path: PATHS[entity], params: {}, modifiedSince: mark };
}

export function pageParams(entity: Entity, page: number): Record<string, string> {
  const p: Record<string, string> = { page: String(page) };
  if (entity !== 'quotes' && entity !== 'credit_notes') p.pageSize = String(PAGE_SIZE[entity]);
  if (entity === 'invoices' || entity === 'contacts') p.summaryOnly = 'false';
  return p;
}

/** A page shorter than the page size is the last one. */
export function isLastPage(entity: Entity, count: number): boolean {
  return count < PAGE_SIZE[entity];
}

/** Rate limits: stop a run early and leave headroom for webhooks and staff pages. */
export interface RateState {
  minRemaining: number | null;
  dayRemaining: number | null;
}
export function shouldPause(r: RateState): boolean {
  return (r.minRemaining !== null && r.minRemaining < 5) || (r.dayRemaining !== null && r.dayRemaining < 300);
}

export function readRateHeaders(h: { get(name: string): string | null }): RateState {
  const n = (k: string) => {
    const v = h.get(k);
    return v !== null && /^\d+$/.test(v) ? Number(v) : null;
  };
  const appMin = n('x-appminlimit-remaining');
  const min = n('x-minlimit-remaining');
  return { minRemaining: appMin !== null && min !== null ? Math.min(appMin, min) : (min ?? appMin), dayRemaining: n('x-daylimit-remaining') };
}

/** Wait for a 429: Retry-After seconds when given, else exponential backoff with jitter, capped. */
export function retryDelayMs(retryAfter: string | null, attempt: number, rand = Math.random): number {
  const ra = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : null;
  if (ra !== null) return Math.min(ra, 60_000);
  return Math.min(1000 * 2 ** attempt + Math.floor(rand() * 500), 30_000);
}
