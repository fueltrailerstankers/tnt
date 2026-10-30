import { describe, expect, it } from 'vitest';
import type { StockDealFields } from '@/lib/stock/deal';
import {
  dealDate, DEAL_SYNC_QUEUE, inDealScope, parseDealsFrom, planDealSync, stockDealFor, stockJobsForSave,
  type DealEntry, type ExistingDeal,
} from '@/lib/stock/deal-sync';
import { backfillDeals, syncDealEntry, type DealSyncStore, type UnreadableEntry } from '@/lib/stock/deal-sync-run';
import { STOCK_LOCATIONS, STOCK_MODELS } from '@/lib/stock/models';

// Synthetic DEAL data only: no customer fields (they never reach stock).
const REF = { modelParts: STOCK_MODELS.map((m) => m.partNumber), locationIds: STOCK_LOCATIONS.map((l) => l.id) };
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

function entry(n: number, data: Record<string, unknown> = {}, over: Partial<DealEntry> = {}): DealEntry {
  return {
    id: id(n), number: n, status: 'Submitted', createdAt: '2026-03-10T08:00:00Z',
    data: { DATECREATED: '2026-03-09', COLLECTIONLOCATION: ['CPT'], QUOTENO: `SAMPLE-Q-${n}`, PARTNO1: '1000DB', LINE1: 'Bowser', LINE2: 'Sample hose reel', ...data },
    ...over,
  };
}

const fields = (n: number, over: Partial<StockDealFields> = {}): StockDealFields => ({
  entry_id: id(n), year: 2026, number: n, location_id: 'CPT', model_part: '1000DB', quote_number: `SAMPLE-Q-${n}`, accessories: ['Sample hose reel'], ...over,
});

const existing = (n: number, over: Partial<ExistingDeal> = {}): ExistingDeal => ({
  id: id(9000 + n), ...fields(n), status: 'awaiting_dispatch', unit_id: null, hasHistory: false, ...over,
});

describe('start date and deal date', () => {
  it('reads app_settings stock.deals_from as a date string, an object or a timestamp; anything else is unset', () => {
    expect(parseDealsFrom('2026-03-01')).toBe('2026-03-01');
    expect(parseDealsFrom(' 2026-03-01T00:00:00Z ')).toBe('2026-03-01');
    expect(parseDealsFrom({ date: '2026-03-01' })).toBe('2026-03-01');
    for (const v of [null, undefined, '', 'soon', '2026-02-30', '1999-12-31', 20260301, ['2026-03-01'], {}]) expect(parseDealsFrom(v)).toBeNull();
  });

  it('dates a DEAL by DATE CREATED, else by its created time in Africa/Johannesburg', () => {
    expect(dealDate('2026-03-09', '2026-04-01T08:00:00Z')).toBe('2026-03-09');
    // 22:30 UTC on 31 Dec is 1 Jan in Johannesburg (UTC+2).
    expect(dealDate('2025-12-31T22:30:00Z', '2026-04-01T08:00:00Z')).toBe('2026-01-01');
    expect(dealDate('', '2025-12-31T22:30:00Z')).toBe('2026-01-01');
    expect(dealDate('not a date', '2026-04-01T08:00:00Z')).toBe('2026-04-01');
    expect(dealDate('2026-02-30', '2026-04-01T08:00:00Z')).toBe('2026-04-01');
  });

  it('is in scope only on or after the start date; no start date means nothing is in scope', () => {
    expect(inDealScope('2026-03-01', '2026-03-01T08:00:00Z', '2026-03-01')).toBe(true);
    expect(inDealScope('2026-02-28', '2026-03-01T08:00:00Z', '2026-03-01')).toBe(false);
    expect(inDealScope('2026-03-09', '2026-03-10T08:00:00Z', null)).toBe(false);
  });
});

describe('stockDealFor', () => {
  it('maps a submitted DEAL in scope to stock deal columns (no personal data)', () => {
    const d = stockDealFor(entry(260, { CUSTOMERNAME: 'Sample Customer', EMAIL: 'x@example.invalid' }), '2026-01-01', REF);
    expect(d).toEqual(fields(260));
    expect(JSON.stringify(d)).not.toMatch(/Sample Customer|example\.invalid/);
  });

  it('skips drafts, deals before the start date and every deal when no start date is set', () => {
    expect(stockDealFor(entry(1, {}, { status: 'Incomplete' }), '2026-01-01', REF)).toBeNull();
    expect(stockDealFor(entry(1, { DATECREATED: '2025-12-31' }), '2026-01-01', REF)).toBeNull();
    expect(stockDealFor(entry(1), null, REF)).toBeNull();
  });

  it('drops a location the org does not have (FK) and keeps an unknown model as null', () => {
    const d = stockDealFor(entry(2, { PARTNO1: 'NOPE' }), '2026-01-01', { ...REF, locationIds: ['FACTORY', 'JHB'] });
    expect(d).toMatchObject({ location_id: null, model_part: null, accessories: ['Bowser', 'Sample hose reel'] });
  });
});

describe('planDealSync', () => {
  it('inserts a new deal and does nothing for an out-of-scope entry without a deal', () => {
    expect(planDealSync(null, fields(1))).toEqual({ kind: 'insert', row: fields(1) });
    expect(planDealSync(null, null)).toEqual({ kind: 'noop', reason: 'out_of_scope' });
  });

  it('is a no-op when nothing changed (idempotent)', () => {
    expect(planDealSync(existing(1), fields(1))).toEqual({ kind: 'noop', reason: 'unchanged' });
  });

  it('updates only the changed descriptive columns', () => {
    const plan = planDealSync(existing(1), fields(1, { location_id: 'JHB', accessories: ['Sample hose reel', 'Spare wheel'] }));
    expect(plan).toEqual({ kind: 'update', id: id(9001), patch: { location_id: 'JHB', accessories: ['Sample hose reel', 'Spare wheel'] } });
  });

  it('never writes status, unit or dismissal columns: a dispatched or dismissed deal is never downgraded', () => {
    for (const status of ['dispatched', 'dismissed'] as const) {
      const ex = existing(1, { status, unit_id: status === 'dispatched' ? id(77) : null, hasHistory: status === 'dismissed' });
      const plan = planDealSync(ex, fields(1, { year: 2027, number: 5, model_part: '2500D' }));
      expect(plan.kind).toBe('update');
      if (plan.kind !== 'update') return;
      // Year and number stay: a unit (or the dismissal history) refers to them.
      expect(plan.patch).toEqual({ model_part: '2500D' });
      expect(Object.keys(plan.patch)).not.toEqual(expect.arrayContaining(['status']));
    }
  });

  it('lets year and number follow the DEAL only while the deal awaits dispatch and was never dismissed', () => {
    expect(planDealSync(existing(1), fields(1, { year: 2025 }))).toEqual({ kind: 'update', id: id(9001), patch: { year: 2025 } });
    expect(planDealSync(existing(1, { hasHistory: true }), fields(1, { year: 2025 }))).toEqual({ kind: 'noop', reason: 'unchanged' });
  });

  it('removes an untouched awaiting deal that fell out of scope, and keeps anything with history', () => {
    expect(planDealSync(existing(1), null)).toEqual({ kind: 'remove', id: id(9001) });
    expect(planDealSync(existing(1, { hasHistory: true }), null)).toEqual({ kind: 'noop', reason: 'kept' });
    expect(planDealSync(existing(1, { status: 'dismissed', hasHistory: true }), null)).toEqual({ kind: 'noop', reason: 'kept' });
    expect(planDealSync(existing(1, { status: 'dispatched', unit_id: id(77) }), null)).toEqual({ kind: 'noop', reason: 'kept' });
  });
});

describe('stockJobsForSave', () => {
  it('queues the deal sync for DEAL Submit, Update and Action only', () => {
    for (const a of ['Submit', 'Update', 'Action']) expect(stockJobsForSave('deal', a)).toEqual([DEAL_SYNC_QUEUE]);
    expect(stockJobsForSave('deal', 'Save draft')).toEqual([]);
    expect(stockJobsForSave('job-card', 'Submit')).toEqual([]);
  });
});

/** In-memory store with the same constraints as stock_deals (unique entry, unique year + number). */
function memoryStore(opts: { dealsFrom?: string | null; entries?: Array<DealEntry | UnreadableEntry>; deals?: ExistingDeal[] } = {}) {
  const deals = new Map<string, ExistingDeal>((opts.deals ?? []).map((d) => [d.id, { ...d }]));
  const entries = opts.entries ?? [];
  let seq = 0;
  const writes: string[] = [];
  const store: DealSyncStore & { deals: Map<string, ExistingDeal>; writes: string[] } = {
    deals,
    writes,
    async dealsFrom() { return opts.dealsFrom === undefined ? '2026-01-01' : opts.dealsFrom; },
    async reference() { return REF; },
    async entry(entryId) { return (entries.find((e) => e.id === entryId && !('unreadable' in e)) as DealEntry | undefined) ?? null; },
    async entriesAfter(after, limit) { return entries.filter((e) => e.number > after).sort((a, b) => a.number - b.number).slice(0, limit); },
    async dealsForEntries(ids) { return [...deals.values()].filter((d) => d.entry_id && ids.includes(d.entry_id)).map((d) => ({ ...d })); },
    async dealByYearNumber(year, number) { const d = [...deals.values()].find((x) => x.year === year && x.number === number); return d ? { ...d } : null; },
    async insert(row) {
      if ([...deals.values()].some((d) => d.entry_id === row.entry_id || (d.year === row.year && d.number === row.number))) return 'conflict';
      const d: ExistingDeal = { id: `deal-${++seq}`, ...row, status: 'awaiting_dispatch', unit_id: null, hasHistory: false };
      deals.set(d.id, d);
      writes.push(`insert ${row.number}`);
      return 'ok';
    },
    async update(dealId, patch) {
      const d = deals.get(dealId);
      if (!d) return 'conflict';
      if (('year' in patch || 'number' in patch) && d.status !== 'awaiting_dispatch') return 'conflict';
      const year = patch.year ?? d.year;
      const number = patch.number ?? d.number;
      if ([...deals.values()].some((x) => x.id !== dealId && x.year === year && x.number === number)) return 'conflict';
      Object.assign(d, patch);
      writes.push(`update ${d.number}`);
      return 'ok';
    },
    async remove(dealId) {
      const d = deals.get(dealId);
      if (d && d.status === 'awaiting_dispatch' && !d.unit_id) deals.delete(dealId);
      writes.push(`remove ${dealId}`);
    },
  };
  return store;
}

describe('syncDealEntry (stock.deal-sync)', () => {
  it('creates exactly one stock deal for a DEAL; a resubmit with the same data writes nothing', async () => {
    const store = memoryStore({ entries: [entry(260)] });
    expect(await syncDealEntry(store, id(260))).toMatchObject({ inserted: 1, disabled: false });
    expect(await syncDealEntry(store, id(260))).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });
    expect(store.deals.size).toBe(1);
    expect(store.writes).toEqual(['insert 260']);
  });

  it('updates the deal after the DEAL changes', async () => {
    const e = entry(260);
    const store = memoryStore({ entries: [e] });
    await syncDealEntry(store, e.id);
    e.data = { ...e.data, COLLECTIONLOCATION: ['DUR'] };
    expect(await syncDealEntry(store, e.id)).toMatchObject({ updated: 1 });
    expect([...store.deals.values()][0].location_id).toBe('DBN');
  });

  it('does nothing at all when no start date is set', async () => {
    const store = memoryStore({ dealsFrom: null, entries: [entry(260)] });
    expect(await syncDealEntry(store, id(260))).toMatchObject({ disabled: true, inserted: 0 });
    expect(store.writes).toEqual([]);
  });

  it('skips an entry that does not exist (deleted, or another org)', async () => {
    expect(await syncDealEntry(memoryStore(), id(1))).toMatchObject({ skipped: 1 });
  });

  it('never downgrades a dispatched deal', async () => {
    const store = memoryStore({ entries: [entry(260)], deals: [existing(260, { status: 'dispatched', unit_id: id(77) })] });
    await syncDealEntry(store, id(260));
    expect(store.deals.get(id(9260))).toMatchObject({ status: 'dispatched', unit_id: id(77) });
  });

  it('adopts a deal with the same year and number left without an entry; reports one held by another DEAL', async () => {
    const orphan = existing(260, { entry_id: null });
    const store = memoryStore({ entries: [entry(260)], deals: [orphan] });
    expect(await syncDealEntry(store, id(260))).toMatchObject({ updated: 1, conflicts: 0 });
    expect(store.deals.get(orphan.id)?.entry_id).toBe(id(260));

    const taken = memoryStore({ entries: [entry(260)], deals: [existing(260, { entry_id: id(5) })] });
    expect(await syncDealEntry(taken, id(260))).toMatchObject({ inserted: 0, conflicts: 1 });
  });
});

describe('backfillDeals (stock.deals-backfill)', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => entry(i + 1, { DATECREATED: i < 3 ? '2025-06-01' : '2026-02-01' }));

  it('walks every DEAL in number order, in batches, importing only those since the start date', async () => {
    const store = memoryStore({ entries: many(10) });
    const r = await backfillDeals(store, { budgetMs: 60_000, batch: 4 });
    expect(r).toMatchObject({ complete: true, processed: 10, next: 10, inserted: 7, skipped: 3, failed: 0 });
    expect(store.deals.size).toBe(7);
  });

  it('stops when out of time and resumes from the last entry number done; a re-run writes nothing', async () => {
    const store = memoryStore({ entries: many(10) });
    let t = 0;
    const first = await backfillDeals(store, { budgetMs: 1, batch: 4, now: () => (t += 1) });
    expect(first).toMatchObject({ complete: false, processed: 4, next: 4 });
    const second = await backfillDeals(store, { from: first.next, budgetMs: 60_000, batch: 4 });
    expect(second).toMatchObject({ complete: true, processed: 6, next: 10 });
    expect(store.deals.size).toBe(7);
    const writes = store.writes.length;
    expect(await backfillDeals(store, { budgetMs: 60_000, batch: 4 })).toMatchObject({ inserted: 0, updated: 0, unchanged: 7 });
    expect(store.writes.length).toBe(writes);
  });

  it('removes untouched deals before a later start date, keeps dismissed ones, and counts unreadable entries', async () => {
    const entries: Array<DealEntry | UnreadableEntry> = [entry(1, { DATECREATED: '2026-01-05' }), entry(2, { DATECREATED: '2026-01-06' }), { id: id(3), number: 3, unreadable: true }];
    const deals = [existing(1, { year: 2026 }), existing(2, { status: 'dismissed', hasHistory: true })];
    const store = memoryStore({ dealsFrom: '2026-02-01', entries, deals });
    const r = await backfillDeals(store, { budgetMs: 60_000 });
    expect(r).toMatchObject({ removed: 1, unchanged: 1, failed: 1, complete: true });
    expect([...store.deals.keys()]).toEqual([id(9002)]);
  });

  it('does nothing when no start date is set', async () => {
    const store = memoryStore({ dealsFrom: null, entries: many(3) });
    expect(await backfillDeals(store, { budgetMs: 60_000 })).toMatchObject({ disabled: true, complete: true, processed: 0 });
    expect(store.writes).toEqual([]);
  });
});
