import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drain, type Job } from '@/lib/jobs/outbox';
import { DEALS_BACKFILL_QUEUE, DEAL_SYNC_QUEUE } from '@/lib/stock/deal-sync';
import { enqueueDealsBackfill, STOCK_DEAL_HANDLERS } from '@/lib/stock/deal-jobs';
import { STOCK_LOCATIONS, STOCK_MODELS } from '@/lib/stock/models';
import { eqOf, FakeSupabase, type Row } from './fake-supabase';
import { spec } from './specs';

vi.mock('server-only', () => ({}));

// The DEAL -> stock deal jobs against an in-memory Supabase: org scoping of every query, the rebuild queue and the
// drain deadline. Synthetic DEAL data only.
const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const FORM_A = '00000000-0000-0000-0000-0000000f000a';
const FORM_B = '00000000-0000-0000-0000-0000000f000b';
const entryId = (org: 'a' | 'b', n: number) => `00000000-0000-0000-00e${org}-${String(n).padStart(12, '0')}`;
const TENANT_TABLES = ['stock_deals', 'stock_deal_dismissals', 'stock_models', 'stock_locations', 'app_settings', 'forms'];

const dealSpec = spec('deal');

function entry(org: string, form: string, id: string, n: number, data: Row = {}): Row {
  return {
    id, form_id: form, org_id: org, number: n, status: 'Submitted', summary: `SAMPLE-Q-${n}`, data_encrypted: null,
    created_at: '2026-03-10T08:00:00Z', updated_at: '2026-03-10T08:00:00Z', submitted_at: '2026-03-10T08:00:00Z',
    data: { DATECREATED: '2026-03-09', COLLECTIONLOCATION: ['CPT'], QUOTENO: `SAMPLE-Q-${n}`, PARTNO1: '1000DB', LINE1: 'Bowser', LINE2: 'Sample hose reel', ...data },
  };
}

function orgRows(org: string, form: string, dealsFrom: string) {
  return {
    forms: [{ id: form, org_id: org, slug: 'deal', name: 'DEAL', is_active: true, encrypt_entries: false, entry_summary_template: null, spec: dealSpec }],
    stock_models: STOCK_MODELS.map((m) => ({ org_id: org, part_number: m.partNumber })),
    stock_locations: STOCK_LOCATIONS.map((l) => ({ org_id: org, id: l.id })),
    app_settings: [{ org_id: org, key: 'stock.deals_from', value: dealsFrom }],
  };
}

/** Two orgs with the same DEAL numbers; org B already has an untouched awaiting deal for its DEAL 1. */
function twoOrgs(opts: { fromA?: string; entriesA?: number; onWrite?: (table: string, op: string) => void } = {}) {
  const a = orgRows(ORG_A, FORM_A, opts.fromA ?? '2026-01-01');
  const b = orgRows(ORG_B, FORM_B, '2026-01-01');
  const entriesA = Array.from({ length: opts.entriesA ?? 1 }, (_, i) => entry(ORG_A, FORM_A, entryId('a', i + 1), i + 1));
  const tables: Record<string, Row[]> = {
    forms: [...a.forms, ...b.forms],
    stock_models: [...a.stock_models, ...b.stock_models],
    stock_locations: [...a.stock_locations, ...b.stock_locations],
    app_settings: [...a.app_settings, ...b.app_settings],
    entries: [...entriesA, entry(ORG_B, FORM_B, entryId('b', 1), 1)],
    stock_deals: [{
      id: 'deal-b-1', org_id: ORG_B, entry_id: entryId('b', 1), year: 2026, number: 1, location_id: 'CPT', model_part: '1000DB',
      quote_number: 'SAMPLE-Q-1', accessories: ['Sample hose reel'], status: 'awaiting_dispatch', unit_id: null,
    }],
    stock_deal_dismissals: [],
    job_runs: [],
    outbox_jobs: [],
  };
  const fake = new FakeSupabase(tables, {
    unique: { stock_deals: [['org_id', 'year', 'number'], ['org_id', 'entry_id']] },
    defaults: { outbox_jobs: { status: 'pending', attempts: 0, run_at: () => new Date().toISOString() } },
    rpc: {
      // 0016: deletes only an untouched deal of p_org (the history checks are covered in tests/db).
      stock_remove_untouched_deal: (args, t) => {
        const before = t.stock_deals.length;
        t.stock_deals = t.stock_deals.filter((d) => !(d.org_id === args.p_org && d.id === args.p_deal && d.status === 'awaiting_dispatch' && !d.unit_id));
        return t.stock_deals.length < before;
      },
    },
    onWrite: opts.onWrite,
  });
  return { fake, snapshotB: () => JSON.stringify(Object.fromEntries(Object.entries(fake.tables).map(([k, rows]) => [k, rows.filter((r) => r.org_id === ORG_B)]))) };
}

const job = (queue: string, payload: Row, org = ORG_A): Job => ({ id: `job-${queue}`, org_id: org, queue, payload, attempts: 0 });

/** Every query a job for org A made on tenant data was scoped to org A (or to org A's DEAL form). */
function expectScopedToA(fake: FakeSupabase) {
  for (const l of fake.log) {
    if (TENANT_TABLES.includes(l.table)) {
      if (l.op === 'insert') expect(l.rows?.every((r) => r.org_id === ORG_A), `${l.table} insert`).toBe(true);
      else expect(eqOf(l, 'org_id'), `${l.table} ${l.op}`).toBe(ORG_A);
    }
    if (l.table === 'entries') expect(eqOf(l, 'org_id') === ORG_A || eqOf(l, 'form_id') === FORM_A, 'entries').toBe(true);
    if (l.op === 'rpc') expect(l.args?.p_org, l.table).toBe(ORG_A);
  }
}

describe('deal store: cross-org isolation', () => {
  it('a deal sync for org A reads and writes only org A rows', async () => {
    const { fake, snapshotB } = twoOrgs();
    const before = snapshotB();
    await STOCK_DEAL_HANDLERS[DEAL_SYNC_QUEUE](fake.client, job(DEAL_SYNC_QUEUE, { entryId: entryId('a', 1) }));
    const mine = fake.tables.stock_deals.filter((d) => d.org_id === ORG_A);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ entry_id: entryId('a', 1), year: 2026, number: 1, location_id: 'CPT', model_part: '1000DB' });
    expect(snapshotB()).toBe(before);
    expectScopedToA(fake);
  });

  it('a job for org A naming org B\'s DEAL entry writes nothing', async () => {
    const { fake, snapshotB } = twoOrgs();
    const before = snapshotB();
    await STOCK_DEAL_HANDLERS[DEAL_SYNC_QUEUE](fake.client, job(DEAL_SYNC_QUEUE, { entryId: entryId('b', 1) }));
    expect(fake.tables.stock_deals.filter((d) => d.org_id === ORG_A)).toHaveLength(0);
    expect(fake.log.filter((l) => l.table === 'stock_deals' && l.op !== 'select')).toHaveLength(0);
    expect(snapshotB()).toBe(before);
    expectScopedToA(fake);
  });

  it('a backfill for org A with a later start date removes org A\'s untouched deal only', async () => {
    const { fake, snapshotB } = twoOrgs();
    await STOCK_DEAL_HANDLERS[DEAL_SYNC_QUEUE](fake.client, job(DEAL_SYNC_QUEUE, { entryId: entryId('a', 1) }));
    fake.tables.app_settings.find((s) => s.org_id === ORG_A)!.value = '2027-01-01';
    const before = snapshotB();
    fake.log = [];
    await STOCK_DEAL_HANDLERS[DEALS_BACKFILL_QUEUE](fake.client, job(DEALS_BACKFILL_QUEUE, { from: 0 }));
    expect(fake.tables.stock_deals.filter((d) => d.org_id === ORG_A)).toHaveLength(0);
    expect(fake.calls('stock_remove_untouched_deal')).toHaveLength(1);
    expect(snapshotB()).toBe(before);
    expectScopedToA(fake);
  });
});

describe('Rebuild deals (enqueueDealsBackfill)', () => {
  const pending = (fake: FakeSupabase, org = ORG_A) => fake.tables.outbox_jobs.filter((j) => j.org_id === org && j.queue === DEALS_BACKFILL_QUEUE && j.status === 'pending');

  it('queues a fresh pass even while a continuation of an older pass is pending; never two fresh passes', async () => {
    const { fake } = twoOrgs();
    fake.tables.outbox_jobs.push(
      { id: 'cont', org_id: ORG_A, queue: DEALS_BACKFILL_QUEUE, payload: { from: 400 }, status: 'pending' },
      { id: 'other-org', org_id: ORG_B, queue: DEALS_BACKFILL_QUEUE, payload: { from: 0 }, status: 'pending' },
    );
    await enqueueDealsBackfill(fake.client, ORG_A);
    expect(pending(fake).map((j) => j.payload)).toEqual([{ from: 400 }, { from: 0 }]);
    await enqueueDealsBackfill(fake.client, ORG_A);
    expect(pending(fake)).toHaveLength(2);
  });

  it('a payload without from counts as a fresh pass', async () => {
    const { fake } = twoOrgs();
    fake.tables.outbox_jobs.push({ id: 'bare', org_id: ORG_A, queue: DEALS_BACKFILL_QUEUE, payload: {}, status: 'pending' });
    await enqueueDealsBackfill(fake.client, ORG_A);
    expect(pending(fake)).toHaveLength(1);
  });

  it('a continuation stops (reads nothing, queues nothing) once a fresh pass is pending', async () => {
    const { fake } = twoOrgs();
    fake.tables.outbox_jobs.push({ id: 'fresh', org_id: ORG_A, queue: DEALS_BACKFILL_QUEUE, payload: { from: 0 }, status: 'pending' });
    await STOCK_DEAL_HANDLERS[DEALS_BACKFILL_QUEUE](fake.client, job(DEALS_BACKFILL_QUEUE, { from: 400 }));
    expect(fake.calls('entries')).toHaveLength(0);
    expect(fake.calls('job_runs')).toHaveLength(0);
    expect(pending(fake).map((j) => j.payload)).toEqual([{ from: 0 }]);
  });
});

describe('backfill within the drain deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-15T10:00:00Z'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('drain passes its deadline to the handler; the backfill stops in time and continues in a new job', async () => {
    // Each stock deal write takes 600 ms; the drain has 4 s left (e.g. after a Xero sync): budget 1 s.
    const { fake } = twoOrgs({ entriesA: 6, onWrite: (t) => { if (t === 'stock_deals') vi.setSystemTime(Date.now() + 600); } });
    fake.tables.outbox_jobs.push({ id: 'b1', org_id: ORG_A, queue: DEALS_BACKFILL_QUEUE, payload: { from: 0 }, status: 'pending', attempts: 0, run_at: '2026-01-01T00:00:00.000Z' });
    const r = await drain(fake.client, STOCK_DEAL_HANDLERS, Date.now() + 4_000);
    expect(r).toEqual({ ran: 1, failed: 0 });
    expect(fake.tables.stock_deals.filter((d) => d.org_id === ORG_A)).toHaveLength(2);
    const next = fake.tables.outbox_jobs.filter((j) => j.queue === DEALS_BACKFILL_QUEUE && j.status === 'pending');
    expect(next.map((j) => j.payload)).toEqual([{ from: 2 }]);
  });
});
