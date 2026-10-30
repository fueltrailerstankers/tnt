import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_REGISTER_QUERY, type RegisterQuery, type UnitRow } from '@/lib/stock/register';

// Register reads and the CSV export against an in-memory stand-in for the PostgREST client (review item 4).
// Synthetic rows only.

vi.mock('server-only', () => ({}));

// The export route's server dependencies: a signed-in admin, the fake client below, a recorded audit insert.
const route = vi.hoisted(() => ({ db: null as unknown, insert: null as unknown as (row: unknown) => Promise<{ error: null; row: unknown }> }));
vi.mock('@/lib/security/require', () => ({ requirePerm: async () => ({ userId: 'user-1', orgId: 'org-1', role: 'admin', branch: null }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => route.db }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ insert: (row: unknown) => route.insert(row) }) }) }));

type Row = Record<string, unknown>;
interface Db {
  tables: Record<string, Row[]>;
  /** Called after each data (non-count) read of stock_units: lets a test add units between chunks. */
  afterRead?: (n: number) => void;
  /** Table names whose reads fail. */
  fail?: Set<string>;
  reads: { table: string; head: boolean }[];
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown; count: number | null }> {
  private filters: ((r: Row) => boolean)[] = [];
  private orders: [string, boolean][] = [];
  private lim: number | null = null;
  private from = 0;
  private to: number | null = null;
  private count = false;
  private head = false;
  private single = false;
  constructor(private db: Db, private table: string) {}
  select(_cols: string, o?: { count?: string; head?: boolean }) { this.count = o?.count === 'exact'; this.head = !!o?.head; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  in(c: string, vs: readonly unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  gt(c: string, v: string) { this.filters.push((r) => String(r[c]) > v); return this; }
  or(): this { throw new Error('or() not used in these tests'); }
  order(c: string, o?: { ascending?: boolean }) { this.orders.push([c, o?.ascending ?? true]); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.from = a; this.to = b; return this; }
  maybeSingle() { this.single = true; return this; }
  then<A, B>(ok?: ((v: { data: unknown; error: unknown; count: number | null }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.run()).then(ok, bad);
  }
  private run() {
    this.db.reads.push({ table: this.table, head: this.head });
    if (this.db.fail?.has(this.table)) return { data: null, error: { message: 'boom' }, count: null };
    let rows = (this.db.tables[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    const total = rows.length;
    for (const [c, asc] of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.to !== null) rows = rows.slice(this.from, this.to + 1);
    if (this.lim !== null) rows = rows.slice(0, this.lim);
    if (!this.head && this.table === 'stock_units') this.db.afterRead?.(this.db.reads.filter((r) => r.table === 'stock_units' && !r.head).length);
    if (this.head) return { data: null, error: null, count: total };
    if (this.single) return { data: rows[0] ?? null, error: null, count: null };
    return { data: rows.map((r) => ({ ...r })), error: null, count: this.count ? total : null };
  }
}

const fakeDb = (db: Db) => ({ from: (t: string) => new FakeQuery(db, t) }) as never;

const ORG = 'org-1';
const LOCATIONS = [
  { org_id: ORG, id: 'FACTORY', name: 'Factory', is_factory: true, sort_order: 0 },
  { org_id: ORG, id: 'JHB', name: 'Johannesburg', is_factory: false, sort_order: 1 },
];
const hex = (n: number) => n.toString(16).padStart(12, '0');
let seq = 0;
const unit = (over: Partial<UnitRow> & { org_id?: string } = {}): Row => {
  seq += 1;
  // Ids are not in creation order (as with gen_random_uuid): reverse the digits.
  const id = `00000000-0000-4000-8000-${hex(seq).split('').reverse().join('')}`;
  return {
    org_id: ORG, id, vin: `SYNTH${seq}`, vin_norm: `SYNTH${seq}`, deal_year: null, sequence: null, deal_id: null, model_part: 'CTLL1',
    location_id: 'JHB', status: 'available', invoice_number: null, xero_invoice_id: null, dispatch_date: null, accessories: [],
    notes: null, transfer_reason: null, sold_at: null, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
    updated_at: '2026-01-01T00:00:00Z', ...over,
  };
};

const q = (over: Partial<RegisterQuery> = {}): RegisterQuery => ({ ...EMPTY_REGISTER_QUERY, ...over });

let rq: typeof import('@/lib/stock/register-query');
beforeEach(async () => {
  rq = await import('@/lib/stock/register-query');
});

describe('loaders report failures (item 4a)', () => {
  it('a failed locations or models read is an error, not an empty list', async () => {
    const db: Db = { tables: { stock_locations: LOCATIONS }, fail: new Set(['stock_models']), reads: [] };
    expect(await rq.loadLocations(fakeDb(db), ORG)).toEqual({ data: LOCATIONS, error: false });
    expect(await rq.loadModels(fakeDb(db), ORG)).toEqual({ data: [], error: true });
    db.fail = new Set(['stock_locations']);
    expect((await rq.loadLocations(fakeDb(db), ORG)).error).toBe(true);
  });
  it('a failed count or chunk makes the export an error', async () => {
    const db: Db = { tables: { stock_units: [unit()] }, fail: new Set(['stock_units']), reads: [] };
    expect(await rq.readExport(fakeDb(db), ORG, q(), LOCATIONS as never)).toEqual({ kind: 'error' });
  });
});

describe('export reads every unit exactly once (item 4b)', () => {
  it('units added between chunks neither repeat nor push others out', async () => {
    const original = Array.from({ length: 25 }, () => unit());
    const db: Db = { tables: { stock_units: [...original] }, reads: [] };
    db.afterRead = (n) => { if (n <= 2) db.tables.stock_units.push(unit(), unit()); };   // newest units arrive mid-export
    const out = await rq.readExport(fakeDb(db), ORG, q(), LOCATIONS as never, { chunk: 10, max: 100 });
    expect(out.kind).toBe('ok');
    const rows = (out as { rows: UnitRow[] }).rows;
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);                       // no duplicates
    for (const u of original) expect(ids).toContain(u.id);            // nothing skipped
    expect(rows.map((r) => r.created_at)).toEqual([...rows.map((r) => r.created_at)].sort().reverse());   // newest first
  });
  it('control: offset paging over newest first (the old export) repeats a row when a unit is added', async () => {
    const original = Array.from({ length: 25 }, () => unit());
    const db: Db = { tables: { stock_units: [...original] }, reads: [] };
    db.afterRead = (n) => { if (n === 1) db.tables.stock_units.push(unit()); };
    const seen: string[] = [];
    for (let from = 0; from < 30; from += 10) {
      const page = await rq.selectUnits(fakeDb(db), ORG, q(), LOCATIONS as never, { from, to: from + 9 });
      seen.push(...page.rows.map((r) => r.id));
      if (page.rows.length < 10) break;
    }
    expect(new Set(seen).size).toBeLessThan(seen.length);
  });
  it('applies the register filters to every chunk', async () => {
    const db: Db = { tables: { stock_units: [unit({ location_id: 'FACTORY' }), unit(), unit({ status: 'sold' }), unit({ org_id: 'other' })] }, reads: [] };
    const out = await rq.readExport(fakeDb(db), ORG, q({ location: 'branches', status: 'in_stock' }), LOCATIONS as never, { chunk: 1 });
    expect(out.kind === 'ok' && out.rows.map((r) => r.location_id + r.status)).toEqual(['JHBavailable']);
  });
});

describe('export cap (item 4c)', () => {
  it('counts first and refuses above the cap without reading rows', async () => {
    const db: Db = { tables: { stock_units: Array.from({ length: 12 }, () => unit()) }, reads: [] };
    expect(await rq.readExport(fakeDb(db), ORG, q(), LOCATIONS as never, { max: 11, chunk: 5 })).toEqual({ kind: 'too_many', count: 12 });
    expect(db.reads.filter((r) => r.table === 'stock_units').map((r) => r.head)).toEqual([true]);
  });
  it('exactly at the cap is exported in full', async () => {
    const db: Db = { tables: { stock_units: Array.from({ length: 11 }, () => unit()) }, reads: [] };
    const out = await rq.readExport(fakeDb(db), ORG, q(), LOCATIONS as never, { max: 11, chunk: 5 });
    expect(out.kind === 'ok' && out.rows.length).toBe(11);
  });
  it('refuses when units added during the read push it over the cap (never a cut file)', async () => {
    const db: Db = { tables: { stock_units: Array.from({ length: 10 }, () => unit()) }, reads: [] };
    db.afterRead = (n) => { if (n === 1) for (let i = 0; i < 5; i += 1) db.tables.stock_units.push(unit()); };
    expect(await rq.readExport(fakeDb(db), ORG, q(), LOCATIONS as never, { max: 11, chunk: 5 })).toMatchObject({ kind: 'too_many' });
  });
});

describe('export route', () => {
  const insert = vi.fn(async (row: unknown) => ({ error: null, row }));
  route.insert = insert;
  const state = {
    set db(d: Db) { this._db = d; route.db = fakeDb(d); },
    get db(): Db { return this._db; },
    _db: { tables: {}, reads: [] } as Db,
  };
  const models = [{ org_id: ORG, part_number: 'CTLL1', description: 'Synthetic trailer', active: true, sort_order: 1 }];

  beforeEach(() => { insert.mockClear(); });

  it('answers 502 and exports nothing when the locations cannot be read (no silently dropped filter)', async () => {
    state.db = { tables: { stock_models: models, stock_units: [unit({ location_id: 'FACTORY' })] }, fail: new Set(['stock_locations']), reads: [] };
    const { GET } = await import('@/app/(admin)/admin/stock/units/export/route');
    const res = await GET(new Request('http://x/admin/stock/units/export?location=JHB'));
    expect(res.status).toBe(502);
    expect(insert).not.toHaveBeenCalled();
    expect(state.db.reads.some((r) => r.table === 'stock_units')).toBe(false);
  });
  it('answers 422 with the reason above the cap and writes no audit row', async () => {
    state.db = { tables: { stock_locations: LOCATIONS, stock_models: models, stock_units: Array.from({ length: 10_001 }, () => unit()) }, reads: [] };
    const { GET } = await import('@/app/(admin)/admin/stock/units/export/route');
    const res = await GET(new Request('http://x/admin/stock/units/export'));
    expect(res.status).toBe(422);
    expect(await res.text()).toBe('Too many units to export (10,001). Narrow the filters to 10,000 units or fewer.');
    expect(insert).not.toHaveBeenCalled();
  });
  it('keeps only known part numbers in the audit row (item 3)', async () => {
    state.db = { tables: { stock_locations: LOCATIONS, stock_models: models, stock_units: [unit()] }, reads: [] };
    const { GET } = await import('@/app/(admin)/admin/stock/units/export/route');
    expect((await GET(new Request('http://x/admin/stock/units/export?model=8001015009087'))).status).toBe(200);
    expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ meta: expect.objectContaining({ model: null, rows: 1 }) }));
    await GET(new Request('http://x/admin/stock/units/export?model=ctll1'));
    expect(insert).toHaveBeenLastCalledWith(expect.objectContaining({ meta: expect.objectContaining({ model: 'CTLL1', rows: 1 }) }));
  });
});
