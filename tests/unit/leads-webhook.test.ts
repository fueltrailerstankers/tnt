// app/api/webhooks/leads/route.ts against an in-memory integration_events table. Checks the re-post rules:
// an invalid body never touches a stored row, a late status write never overwrites a finished event, a failed
// event is re-queued by one post only, and storage errors are 500s. Synthetic data only.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type Res = { data: Row[] | null; error: { code?: string; message: string } | null };

const ORG = '00000000-0000-0000-0000-000000000001';
const SECRET = 'test-only-leads-webhook-secret-000000000'; // not a real secret

/** Enough of PostgREST for the route: insert with the unique (source, external_id) key, filtered select/update. */
function fakeEvents() {
  const rows: Row[] = [];
  const faults: { read?: boolean; update?: (patch: Row) => boolean } = {};
  let seq = 0;
  const from = (table: string) => {
    if (table !== 'integration_events') throw new Error(`unexpected table ${table}`);
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Row = {};
    const filters: Array<(r: Row) => boolean> = [];
    const run = async (): Promise<Res> => {
      await Promise.resolve();
      if (op === 'insert') {
        if (rows.some((r) => r.source === payload.source && r.external_id === payload.external_id)) return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        const row = { id: `ev-${++seq}`, ...payload };
        rows.push(row);
        return { data: [{ ...row }], error: null };
      }
      if (op === 'select' && faults.read) return { data: null, error: { code: 'XX000', message: 'injected read failure' } };
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') {
        if (faults.update?.(payload)) return { data: null, error: { code: 'XX000', message: 'injected update failure' } };
        hit.forEach((r) => Object.assign(r, payload));
      }
      return { data: hit.map((r) => ({ ...r })), error: null };
    };
    const b = {
      select() { return b; },
      insert(p: Row) { op = 'insert'; payload = p; return b; },
      update(p: Row) { op = 'update'; payload = p; return b; },
      eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return b; },
      in(k: string, v: unknown[]) { filters.push((r) => v.includes(r[k])); return b; },
      single: () => run().then((r) => (r.error ? { data: null, error: r.error } : r.data?.length === 1 ? { data: r.data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not one row' } })),
      then: (res: (v: Res) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
    };
    return b;
  };
  return { db: { from }, rows, faults };
}

let current = fakeEvents();
let onEnqueue: (payload: Row) => Promise<void> = async () => {};
const enqueued: Row[] = [];

vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/lib/env', () => ({ appEnv: () => ({ PUBLIC_ORG_ID: ORG }) }));
vi.mock('@/lib/jobs/handlers', () => ({ drainOutbox: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => current.db }));
vi.mock('@/lib/jobs/outbox', () => ({
  enqueue: vi.fn(async (_db: unknown, _org: string, queue: string, payload: Row) => {
    await onEnqueue(payload);
    enqueued.push({ queue, ...payload });
  }),
}));

process.env.LEADS_WEBHOOK_SECRET = SECRET;
const { POST } = await import('@/app/api/webhooks/leads/route');
const { intakeEventKey } = await import('@/lib/leads/intake');

let ip = 0;
const post = (body: Row) => POST(new Request('http://localhost/api/webhooks/leads', {
  method: 'POST',
  // A fresh client address per post keeps the per-client rate limit out of the way.
  headers: { 'content-type': 'application/json', 'x-leads-secret': SECRET, 'x-forwarded-for': `192.0.2.${++ip % 250}` },
  body: JSON.stringify(body),
}));

const valid = (o: Row = {}) => ({ source: 'test', source_id: 'wh-1', name: 'Test Person', email: 'tp@example.invalid', ...o });
const invalidBody = { source: 'test', source_id: 'wh-1', name: 'No Contact' };
const seed = (status: string, payload: Row = valid()) => {
  current.rows.push({ id: 'ev-seeded', org_id: ORG, source: 'leads', external_id: intakeEventKey('test', 'wh-1'), payload, status, error: null });
};

beforeEach(() => {
  current = fakeEvents();
  onEnqueue = async () => {};
  enqueued.length = 0;
});

describe('POST /api/webhooks/leads', () => {
  it('stores a valid post as received, queues it and marks it queued', async () => {
    const res = await post(valid());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: false });
    expect(current.rows).toEqual([expect.objectContaining({ status: 'queued', payload: valid() })]);
    expect(enqueued).toEqual([{ queue: 'leads.intake', event_id: current.rows[0].id }]);
  });

  it('stores an invalid post once as ignored with field names only, and queues nothing', async () => {
    const res = await post(invalidBody);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid payload', fields: ['email'] });
    expect(current.rows).toEqual([expect.objectContaining({ status: 'ignored', error: 'invalid: email', processed_at: expect.any(String) })]);
    expect(JSON.stringify(current.rows[0].error)).not.toContain('No Contact');
    expect(enqueued).toHaveLength(0);
  });

  it.each(['received', 'queued', 'processed', 'failed', 'ignored'])('an invalid re-post of a %s event is 400 and leaves the stored row alone', async (status) => {
    seed(status);
    const before = structuredClone(current.rows[0]);
    const res = await post(invalidBody);
    expect(res.status).toBe(400);
    expect(current.rows).toEqual([before]);
    expect(enqueued).toHaveLength(0);
  });

  it('an invalid post arriving while a valid one is being queued cannot replace it', async () => {
    let inner: Response | null = null;
    let started = false;
    onEnqueue = async () => {
      if (started) return;
      started = true;
      inner = await post(invalidBody); // lands between the valid post's insert and its status write
    };
    const res = await post(valid());
    expect(res.status).toBe(200);
    expect(inner!.status).toBe(400);
    expect(current.rows).toEqual([expect.objectContaining({ status: 'queued', payload: valid() })]);
    expect(enqueued).toHaveLength(1);
  });

  it('a late queued write never overwrites an event the job already finished', async () => {
    onEnqueue = async () => { current.rows[0].status = 'processed'; }; // the scheduler ran the job meanwhile
    expect((await post(valid())).status).toBe(200);
    expect(current.rows[0].status).toBe('processed');
  });

  it('a valid re-post replaces an ignored body and queues it', async () => {
    seed('ignored', invalidBody);
    const res = await post(valid());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: false });
    expect(current.rows).toEqual([expect.objectContaining({ id: 'ev-seeded', status: 'queued', payload: valid(), error: null, processed_at: null })]);
    expect(enqueued).toEqual([{ queue: 'leads.intake', event_id: 'ev-seeded' }]);
  });

  it('a failing replace is a 500, not a duplicate', async () => {
    seed('ignored', invalidBody);
    current.faults.update = (patch) => patch.status === 'received';
    const res = await post(valid());
    expect(res.status).toBe(500);
    expect(current.rows[0]).toMatchObject({ status: 'ignored', payload: invalidBody });
    expect(enqueued).toHaveLength(0);
  });

  it('a failing read of the stored event is a 500', async () => {
    seed('processed');
    current.faults.read = true;
    expect((await post(valid())).status).toBe(500);
  });

  it('a valid re-post of a processed event is a no-op duplicate', async () => {
    seed('processed');
    const res = await post(valid({ name: 'Changed' }));
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
    expect(current.rows[0]).toMatchObject({ status: 'processed', payload: valid() });
    expect(enqueued).toHaveLength(0);
  });

  it('a failed event is claimed and re-queued by one post only', async () => {
    seed('failed');
    let inner: Response | null = null;
    let started = false;
    onEnqueue = async () => {
      if (started) return;
      started = true;
      inner = await post(valid()); // a second retry while the first is queueing
    };
    const res = await post(valid());
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
    expect(await inner!.json()).toEqual({ ok: true, duplicate: true });
    expect(enqueued).toEqual([{ queue: 'leads.intake', event_id: 'ev-seeded' }]);
    expect(current.rows[0].status).toBe('queued');
  });

  it('a failed event goes back to failed when the retry cannot be queued', async () => {
    seed('failed');
    onEnqueue = async () => { throw new Error('outbox down'); };
    expect((await post(valid())).status).toBe(500);
    expect(current.rows[0].status).toBe('failed');
    expect(enqueued).toHaveLength(0);
  });
});
