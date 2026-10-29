// lib/leads/service.ts createLead and lib/leads/intake-job.ts against an in-memory stand-in for the
// supabase-js calls they make. Checks that intake is resumable: a retry after a failure at any stage
// completes only the missing stages, and the notification is sent at most once. Synthetic data only.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

type Row = Record<string, unknown>;
const sends: Row[] = [];
let failSend = false;

vi.mock('@/lib/workflow/mailer', () => ({
  sendEmail: vi.fn(async (db: { from: (t: string) => { insert: (r: Row) => PromiseLike<unknown> } }, input: Row) => {
    if (failSend) throw new Error('mail transport crashed');
    sends.push(input);
    await db.from('email_log').insert({ lead_id: input.leadId, action: input.action, event_key: input.eventKey, to_addresses: input.to, subject: input.subject, status: 'skipped' });
    return 'skipped';
  }),
}));

const { createLead } = await import('@/lib/leads/service');
const { processLeadEvent } = await import('@/lib/leads/intake-job');
const { notifyClaimKey } = await import('@/lib/leads/intake');

const ORG = '00000000-0000-0000-0000-000000000001';

type Fail = (table: string, op: 'select' | 'insert' | 'update', row: Row) => boolean;

/** Enough of PostgREST for the lead service: eq/in/like/or/gte/gt filters, inserts with unique keys, updates. */
function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    routing_rules: [{ id: 'rule-default', name: 'Default', priority: 1000, match_source: null, match_product: null, match_branch: null, assign_branch: null, notify_event_key: 'leads.new', active: true, org_id: ORG, created_at: '2026-10-01T00:00:00Z' }],
    lead_sources: [{ org_id: ORG, key: 'test', name: 'Test', active: true }],
    notification_recipients: [{ org_id: ORG, event_key: 'leads.new', address: 'sales@example.invalid', active: true }],
    leads: [], lead_events: [], email_log: [], action_claims: [], app_settings: [], integration_events: [],
    xero_contacts: [], xero_quotes: [], xero_invoices: [],
    ...seed,
  };
  const unique: Record<string, string[]> = { leads: ['org_id', 'source', 'external_id'], action_claims: ['org_id', 'action_key'] };
  // 0012 lead_events_once: unique (lead_id, kind) for the one-time intake stages.
  const uniqueWhere: Record<string, { keys: string[]; when: (r: Row) => boolean }> = {
    lead_events: { keys: ['lead_id', 'kind'], when: (r) => ['created', 'duplicate', 'routed', 'emailed'].includes(String(r.kind)) },
  };
  const failures: Fail[] = [];
  const hooks: { beforeInsert?: (table: string, row: Row) => void } = {};
  let seq = 0;

  const from = (t: string) => {
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Row = {};
    let limit = Infinity;
    const filters: Array<(r: Row) => boolean> = [];
    const run = async (): Promise<{ data: Row[] | null; error: { code?: string; message: string } | null }> => {
      const rows = (tables[t] ??= []);
      if (op === 'insert') {
        if (failures.some((f) => f(t, 'insert', payload))) return { data: null, error: { code: 'XX000', message: 'injected failure' } };
        hooks.beforeInsert?.(t, payload);
        const keys = unique[t];
        if (keys && rows.some((r) => keys.every((k) => r[k] === payload[k]) && keys.every((k) => payload[k] != null))) {
          return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        }
        const partial = uniqueWhere[t];
        if (partial && partial.when(payload) && rows.some((r) => partial.when(r) && partial.keys.every((k) => r[k] === payload[k]))) {
          return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        }
        const row: Row = { id: `${t}-${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), ...(t === 'action_claims' ? { result: null, claimed_at: new Date().toISOString() } : {}), ...payload };
        if (t === 'leads') Object.assign(row, { matched_contact_ids: [], invoice_count: 0, ...payload });
        rows.push(row);
        return { data: [row], error: null };
      }
      if (op === 'select' && failures.some((f) => f(t, 'select', {}))) return { data: null, error: { code: 'XX000', message: 'injected read failure' } };
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') {
        if (hit.some((r) => failures.some((f) => f(t, 'update', { ...r, ...payload })))) return { data: null, error: { code: 'XX000', message: 'injected failure' } };
        hit.forEach((r) => Object.assign(r, payload));
      }
      return { data: hit.slice(0, limit), error: null };
    };
    const orClause = (s: string) => s.split(',').map((part) => {
      const [col, , ...rest] = part.split('.');
      const v = rest.join('.').replace(/^"|"$/g, '');
      return (r: Row) => r[col] === v;
    });
    const b = {
      select() { return b; },
      insert(p: Row) { op = 'insert'; payload = p; return b; },
      update(p: Row) { op = 'update'; payload = p; return b; },
      eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return b; },
      in(k: string, v: unknown[]) { filters.push((r) => v.includes(r[k])); return b; },
      like(k: string, pat: string) { const re = new RegExp(`^${pat.replace(/[.]/g, '\\.').replace(/\*/g, '.*')}$`); filters.push((r) => re.test(String(r[k]))); return b; },
      gte(k: string, v: string) { filters.push((r) => String(r[k]) >= v); return b; },
      gt(k: string, v: number) { filters.push((r) => Number(r[k]) > v); return b; },
      or(s: string) { const ors = orClause(s); filters.push((r) => ors.some((f) => f(r))); return b; },
      order() { return b; },
      limit(n: number) { limit = n; return b; },
      range(a: number, z: number) { limit = z - a + 1; return b; },
      single: () => run().then((r) => (r.error ? { data: null, error: r.error } : r.data?.length === 1 ? { data: r.data[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not one row' } })),
      maybeSingle: () => run().then((r) => ({ data: r.data?.[0] ?? null, error: r.error })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
    };
    return b;
  };
  return { db: { from } as never, tables, hooks, failOnce: (f: Fail) => { let used = false; failures.push((...a) => !used && f(...a) && (used = true)); } };
}

const input = (o: Row = {}) => ({ source: 'test', external_id: 'svc-1', name: 'Test Person', email: 'tp@example.invalid', phone: '082 555 0101', product: 'Fuel trailer', ...o });
const kinds = (tables: Record<string, Row[]>) => tables.lead_events.map((e) => e.kind).sort();

beforeEach(() => { sends.length = 0; failSend = false; });

describe('createLead', () => {
  it('creates, routes and notifies once; a replay is a no-op', async () => {
    const f = fakeDb();
    const r = await createLead(f.db, ORG, input(), { actor: null, notify: true });
    expect(r).toMatchObject({ created: true, eventKey: 'leads.new', emailed: 'skipped' });
    expect(kinds(f.tables)).toEqual(['created', 'emailed', 'routed']);
    expect(sends).toHaveLength(1);
    expect(f.tables.action_claims).toEqual([expect.objectContaining({ action_key: notifyClaimKey(r.id), result: { status: 'skipped', recipients: 1 } })]);

    const again = await createLead(f.db, ORG, input({ name: 'Changed' }), { actor: null, notify: true });
    expect(again).toMatchObject({ id: r.id, created: false, emailed: null });
    expect(kinds(f.tables)).toEqual(['created', 'emailed', 'routed']);
    expect(sends).toHaveLength(1);
    expect(f.tables.leads).toHaveLength(1);
  });

  it('resumes after a failure before routing: missing stages run once, nothing repeats', async () => {
    const f = fakeDb();
    f.failOnce((t, op, row) => t === 'lead_events' && op === 'insert' && row.kind === 'routed');
    await expect(createLead(f.db, ORG, input(), { actor: null, notify: true })).rejects.toThrow('could not record lead event routed');
    expect(kinds(f.tables)).toEqual(['created']);
    expect(sends).toHaveLength(0);

    const r = await createLead(f.db, ORG, input(), { actor: null, notify: true });
    expect(r).toMatchObject({ created: false, eventKey: 'leads.new', emailed: 'skipped' });
    expect(kinds(f.tables)).toEqual(['created', 'emailed', 'routed']);
    expect(sends).toHaveLength(1);
    expect(f.tables.leads).toHaveLength(1);
  });

  it('never sends twice when the send happened but its event was not recorded', async () => {
    const f = fakeDb();
    f.failOnce((t, op, row) => t === 'lead_events' && op === 'insert' && row.kind === 'emailed');
    await expect(createLead(f.db, ORG, input(), { actor: null, notify: true })).rejects.toThrow('could not record lead event emailed');
    expect(sends).toHaveLength(1);

    const r = await createLead(f.db, ORG, input(), { actor: null, notify: true });
    expect(r.emailed).toBe('skipped');
    expect(sends).toHaveLength(1);
    const emailed = f.tables.lead_events.filter((e) => e.kind === 'emailed');
    expect(emailed).toHaveLength(1);
    expect(emailed[0].meta).toMatchObject({ status: 'skipped', recipients: 1, resumed: true });
  });

  it('falls back to email_log when the claim result was not stored, and never re-sends', async () => {
    const f = fakeDb();
    f.failOnce((t, op) => t === 'action_claims' && op === 'update');
    f.failOnce((t, op, row) => t === 'lead_events' && op === 'insert' && row.kind === 'emailed');
    await expect(createLead(f.db, ORG, input(), { actor: null, notify: true })).rejects.toThrow();
    expect(f.tables.action_claims[0].result).toBeNull();

    const r = await createLead(f.db, ORG, input(), { actor: null, notify: true });
    expect(r.emailed).toBe('skipped');
    expect(sends).toHaveLength(1);
  });

  it('a claim held without any result is retried later while young and recorded as unknown when stale', async () => {
    const f = fakeDb();
    failSend = true;
    await expect(createLead(f.db, ORG, input(), { actor: null, notify: true })).rejects.toThrow('mail transport crashed');
    failSend = false;

    await expect(createLead(f.db, ORG, input(), { actor: null, notify: true })).rejects.toThrow('lead notification in progress');
    expect(sends).toHaveLength(0);

    f.tables.action_claims[0].claimed_at = new Date(Date.now() - 11 * 60_000).toISOString();
    const r = await createLead(f.db, ORG, input(), { actor: null, notify: true });
    expect(r.emailed).toBe('unknown');
    expect(sends).toHaveLength(0);
    expect(f.tables.lead_events.filter((e) => e.kind === 'emailed')).toHaveLength(1);
  });

  it('records a Xero match once and keeps the first routing key on resume', async () => {
    const f = fakeDb({
      xero_contacts: [{ org_id: ORG, contact_id: 'c-1', email_norm: 'tp@example.invalid', phone_norm: null }],
      xero_quotes: [{ org_id: ORG, quote_id: 'q-1', quote_number: 'QU-0001', status: 'SENT', contact_id: 'c-1', quote_date: '2026-10-20', updated_utc: null, total: 1000, currency_code: 'ZAR' }],
    });
    f.failOnce((t, op, row) => t === 'lead_events' && op === 'insert' && row.kind === 'emailed');
    await expect(createLead(f.db, ORG, input(), { actor: null, notify: true })).rejects.toThrow();
    expect(f.tables.leads[0].matched_quote_id).toBe('q-1');

    // A rule added between attempts must not change where the (already sent) notification was routed.
    f.tables.routing_rules.push({ id: 'rule-fuel', name: 'Fuel', priority: 1, match_source: null, match_product: 'fuel', match_branch: null, assign_branch: null, notify_event_key: 'leads.fuel', active: true, org_id: ORG });
    const r = await createLead(f.db, ORG, input(), { actor: null, notify: true });
    expect(r.eventKey).toBe('leads.new');
    expect(kinds(f.tables)).toEqual(['created', 'emailed', 'matched', 'routed']);
  });

  it('a one-time stage another intake job recorded first counts as done (0012 unique index)', async () => {
    const f = fakeDb();
    let raced = false;
    f.hooks.beforeInsert = (t, row) => {
      if (t !== 'lead_events' || raced || (row.kind !== 'routed' && row.kind !== 'emailed')) return;
      // A concurrent job for the same lead records routed and emailed just before this one does.
      raced = true;
      f.tables.lead_events.push({ id: 'other-routed', lead_id: row.lead_id, kind: 'routed', meta: {} }, { id: 'other-emailed', lead_id: row.lead_id, kind: 'emailed', meta: {} });
    };
    const r = await createLead(f.db, ORG, input(), { actor: null, notify: true });
    expect(r.created).toBe(true);
    expect(kinds(f.tables)).toEqual(['created', 'emailed', 'routed']);
    expect(sends).toHaveLength(1);
  });

  it('a failed routing rules read throws before anything is written', async () => {
    const f = fakeDb();
    f.failOnce((t, op) => t === 'routing_rules' && op === 'select');
    await expect(createLead(f.db, ORG, input(), { actor: null, notify: true })).rejects.toThrow('could not read routing rules');
    expect(f.tables.leads).toHaveLength(0);
  });

  it('a failed duplicate lookup throws instead of creating an unlinked lead', async () => {
    const f = fakeDb();
    await createLead(f.db, ORG, input({ external_id: 'first' }), { actor: null, notify: false });
    let reads = 0;
    f.failOnce((t, op) => t === 'leads' && op === 'select' && ++reads === 2); // 1: by external id, 2: duplicate lookup
    await expect(createLead(f.db, ORG, input({ external_id: 'second' }), { actor: null, notify: false })).rejects.toThrow();
    expect(f.tables.leads).toHaveLength(1);
    const again = await createLead(f.db, ORG, input({ external_id: 'second' }), { actor: null, notify: false });
    expect(again.duplicateOf).toBe(f.tables.leads[0].id);
  });

  it('a failed read of the held claim throws instead of recording the email as unknown for good', async () => {
    const f = fakeDb();
    failSend = true;
    await expect(createLead(f.db, ORG, input(), { actor: null, notify: true })).rejects.toThrow('mail transport crashed');
    failSend = false;
    f.tables.action_claims[0].claimed_at = new Date(Date.now() - 11 * 60_000).toISOString();

    f.failOnce((t, op) => t === 'action_claims' && op === 'select');
    await expect(createLead(f.db, ORG, input(), { actor: null, notify: true })).rejects.toThrow('could not read lead notification claim');
    expect(f.tables.lead_events.filter((e) => e.kind === 'emailed')).toHaveLength(0);

    f.failOnce((t, op) => t === 'email_log' && op === 'select');
    await expect(createLead(f.db, ORG, input(), { actor: null, notify: true })).rejects.toThrow('could not read lead notification log');
    expect(f.tables.lead_events.filter((e) => e.kind === 'emailed')).toHaveLength(0);

    const r = await createLead(f.db, ORG, input(), { actor: null, notify: true });
    expect(r.emailed).toBe('unknown');
    expect(sends).toHaveLength(0);
  });

  it('a failed recipients read throws without using up the one-time notification claim', async () => {
    const f = fakeDb();
    f.failOnce((t, op) => t === 'notification_recipients' && op === 'select');
    await expect(createLead(f.db, ORG, input(), { actor: null, notify: true })).rejects.toThrow('could not read notification recipients');
    expect(f.tables.action_claims).toHaveLength(0);
    expect(sends).toHaveLength(0);

    const r = await createLead(f.db, ORG, input(), { actor: null, notify: true });
    expect(r.emailed).toBe('skipped');
    expect(sends).toEqual([expect.objectContaining({ to: ['sales@example.invalid'] })]);
  });

  it('manual leads (notify off) never claim or send', async () => {
    const f = fakeDb({ lead_sources: [{ org_id: ORG, key: 'manual', name: 'Manual', active: true }] });
    const r = await createLead(f.db, ORG, { source: 'manual', name: 'Walk In', phone: '011 555 0123' }, { actor: null, notify: false });
    expect(r.emailed).toBeNull();
    expect(kinds(f.tables)).toEqual(['created', 'routed']);
    expect(f.tables.action_claims).toHaveLength(0);
    expect(sends).toHaveLength(0);
  });
});

describe('leads.intake job (processLeadEvent)', () => {
  const stored = (payload: Row, status = 'queued') => ({ id: 'ev-1', org_id: ORG, source: 'leads', payload, status, attempts: 0 });
  const body = { source: 'test', source_id: 'job-1', name: 'Test Person', email: 'tp@example.invalid' };

  it('creates the lead from the stored raw event and marks it processed; a re-run is skipped', async () => {
    const f = fakeDb({ integration_events: [stored(body)] });
    expect(await processLeadEvent(f.db, ORG, 'ev-1')).toBe('processed');
    expect(f.tables.integration_events[0]).toMatchObject({ status: 'processed', attempts: 1, error: null });
    expect(f.tables.leads).toEqual([expect.objectContaining({ external_id: 'job-1', raw: body })]);
    expect(await processLeadEvent(f.db, ORG, 'ev-1')).toBe('skipped');
    expect(sends).toHaveLength(1);
  });

  it('marks an invalid payload ignored with field names only', async () => {
    const f = fakeDb({ integration_events: [stored({ source: 'test', source_id: 'job-2', name: 'No Contact' })] });
    expect(await processLeadEvent(f.db, ORG, 'ev-1')).toBe('ignored');
    expect(f.tables.integration_events[0].status).toBe('ignored');
    expect(String(f.tables.integration_events[0].error)).not.toContain('No Contact');
    expect(f.tables.leads).toHaveLength(0);
  });

  it('marks a processing failure failed and rethrows; the retry finishes it with one email', async () => {
    const f = fakeDb({ integration_events: [stored(body)] });
    f.failOnce((t, op, row) => t === 'lead_events' && op === 'insert' && row.kind === 'routed');
    await expect(processLeadEvent(f.db, ORG, 'ev-1')).rejects.toThrow();
    expect(f.tables.integration_events[0]).toMatchObject({ status: 'failed', attempts: 1 });
    expect(await processLeadEvent(f.db, ORG, 'ev-1')).toBe('processed');
    expect(f.tables.integration_events[0]).toMatchObject({ status: 'processed', attempts: 2 });
    expect(kinds(f.tables)).toEqual(['created', 'emailed', 'routed']);
    expect(sends).toHaveLength(1);
  });

  it('ignores events of another org', async () => {
    const f = fakeDb({ integration_events: [{ ...stored(body), org_id: '00000000-0000-0000-0000-0000000000d4' }] });
    expect(await processLeadEvent(f.db, ORG, 'ev-1')).toBe('skipped');
    expect(f.tables.leads).toHaveLength(0);
  });
});
