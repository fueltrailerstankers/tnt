import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { canReplay, replayPlan, retryDecision, type StoredEvent } from '@/lib/integrations/ops';
import { replayEvent, retryJob } from '@/lib/integrations/ops-run';
import { describe as describeRow, areaOf, hrefFor } from '@/lib/activity/describe';
import { eqOf, FakeSupabase, type Row } from './fake-supabase';

vi.mock('server-only', () => ({}));

// Webhook Replay and outbox job Retry: pure rules, then the runner against an in-memory Supabase (org scoping,
// no duplicate jobs, conditional claims, audit rows with ids/codes only). Synthetic ids only.
const ORG = '00000000-0000-0000-0000-00000000000a';
const OTHER = '00000000-0000-0000-0000-00000000000b';
const USER = '00000000-0000-0000-0000-0000000000u1';
const RESOURCE = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-10-29T12:00:00Z');

const xeroPayload = (category = 'INVOICE') => ({
  resourceId: RESOURCE, eventDateUtc: '2026-10-29T10:00:00Z', eventType: 'UPDATE', eventCategory: category, tenantId: 'tenant-sample',
});
const ev = (over: Partial<StoredEvent> = {}): StoredEvent => ({ id: 'ev1', org_id: ORG, source: 'xero', status: 'failed', payload: xeroPayload(), ...over });

describe('replayPlan', () => {
  it('re-queues a Xero event as a read-only fetch of its record, from the stored payload', () => {
    expect(replayPlan(ev())).toEqual({ ok: true, queue: 'xero.fetch', payload: { entity: 'invoices', id: RESOURCE, event_id: 'ev1' } });
    expect(replayPlan(ev({ payload: xeroPayload('CONTACT'), status: 'processed' }))).toMatchObject({ ok: true, payload: { entity: 'contacts' } });
  });
  it('re-queues a lead intake event by id (createLead resumes by source id)', () => {
    expect(replayPlan(ev({ source: 'leads', payload: { source: 'test' }, status: 'processed' }))).toEqual({ ok: true, queue: 'leads.intake', payload: { event_id: 'ev1' } });
  });
  it('accepts received, queued, failed and processed events', () => {
    for (const status of ['received', 'queued', 'failed', 'processed']) expect(canReplay(ev({ status }))).toBe(true);
  });
  it('refuses missing, ignored, org-less, unknown-source, unreadable and unhandled events', () => {
    expect(replayPlan(null)).toEqual({ ok: false, reason: 'not_found' });
    expect(replayPlan(ev({ status: 'ignored' }))).toEqual({ ok: false, reason: 'ignored' });
    expect(replayPlan(ev({ org_id: null }))).toEqual({ ok: false, reason: 'no_org' });
    expect(replayPlan(ev({ source: 'resend' }))).toEqual({ ok: false, reason: 'unsupported_source' });
    expect(replayPlan(ev({ payload: { eventCategory: 'INVOICE' } }))).toEqual({ ok: false, reason: 'unreadable' });
    expect(replayPlan(ev({ payload: xeroPayload('SUBSCRIPTION') }))).toEqual({ ok: false, reason: 'not_handled' });
    expect(replayPlan(ev({ source: 'toString' }))).toEqual({ ok: false, reason: 'unsupported_source' });
  });
});

describe('retryDecision', () => {
  it('re-queues only failed jobs, in place: pending, attempts 0, due now, lock and error cleared', () => {
    expect(retryDecision({ id: 'j', status: 'failed', attempts: 5 }, NOW)).toEqual({
      ok: true, update: { status: 'pending', attempts: 0, run_at: NOW.toISOString(), locked_at: null, last_error: null },
    });
  });
  it('refuses missing jobs and jobs that are pending, running or done', () => {
    expect(retryDecision(null, NOW)).toEqual({ ok: false, reason: 'not_found' });
    for (const status of ['pending', 'running', 'done']) expect(retryDecision({ id: 'j', status, attempts: 1 }, NOW)).toEqual({ ok: false, reason: 'not_failed' });
  });
});

function store(tables: Record<string, Row[]> = {}) {
  return new FakeSupabase({ integration_events: [], outbox_jobs: [], audit_log: [], ...tables }, {
    defaults: { outbox_jobs: { status: 'pending', attempts: 0 } },
  });
}
const actor = { orgId: ORG, userId: USER };

describe('replayEvent', () => {
  it('claims the event, queues one job from the stored payload and audits ids/codes only', async () => {
    const f = store({ integration_events: [{ id: 'ev1', org_id: ORG, source: 'xero', status: 'processed', payload: xeroPayload(), error: null }] });
    const r = await replayEvent(f.client, actor, 'ev1');
    expect(r).toMatchObject({ ok: true, queued: true });
    expect(f.tables.integration_events[0].status).toBe('queued');
    expect(f.tables.outbox_jobs).toHaveLength(1);
    expect(f.tables.outbox_jobs[0]).toMatchObject({ org_id: ORG, queue: 'xero.fetch', payload: { entity: 'invoices', id: RESOURCE, event_id: 'ev1' } });
    expect(f.tables.audit_log).toEqual([expect.objectContaining({
      org_id: ORG, actor_user: USER, action: 'integration.replay', entity: 'integration_event', entity_id: 'ev1', meta: { source: 'xero', queue: 'xero.fetch', from: 'processed' },
    })]);
    // Every read and write is scoped to the member's org.
    for (const c of f.calls('integration_events')) expect(eqOf(c, 'org_id')).toBe(ORG);
    // Nothing but the stored row is used: no signature check, no Xero call happens here.
    expect(f.log.map((l) => l.table)).toEqual(['integration_events', 'outbox_jobs', 'integration_events', 'outbox_jobs', 'audit_log']);
  });

  it('does not queue a second job while one is pending or running for the event', async () => {
    const f = store({
      integration_events: [{ id: 'ev1', org_id: ORG, source: 'xero', status: 'queued', payload: xeroPayload() }],
      outbox_jobs: [{ id: 'j1', org_id: ORG, queue: 'xero.fetch', status: 'running', attempts: 1, payload: { event_id: 'ev1' } }],
    });
    const r = await replayEvent(f.client, actor, 'ev1');
    expect(r).toMatchObject({ ok: true, queued: false });
    expect(f.tables.outbox_jobs).toHaveLength(1);
    expect(f.tables.audit_log).toHaveLength(0);
  });

  it("reads another org's event as not found and changes nothing", async () => {
    const f = store({ integration_events: [{ id: 'ev1', org_id: OTHER, source: 'xero', status: 'failed', payload: xeroPayload() }] });
    const r = await replayEvent(f.client, actor, 'ev1');
    expect(r).toMatchObject({ ok: false, queued: false });
    expect(r.message).toMatch(/no longer exists/);
    expect(f.tables.integration_events[0].status).toBe('failed');
    expect(f.tables.outbox_jobs).toHaveLength(0);
    expect(f.tables.audit_log).toHaveLength(0);
  });

  it('refuses ignored events', async () => {
    const f = store({ integration_events: [{ id: 'ev1', org_id: ORG, source: 'xero', status: 'ignored', payload: xeroPayload() }] });
    expect((await replayEvent(f.client, actor, 'ev1')).ok).toBe(false);
    expect(f.tables.outbox_jobs).toHaveLength(0);
  });

  it('puts the status back when the job cannot be stored', async () => {
    const f = store({ integration_events: [{ id: 'ev1', org_id: ORG, source: 'leads', status: 'failed', payload: { source: 'test' } }] });
    const client = f.client;
    const from = client.from.bind(client);
    (client as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      const q = from(t);
      if (t === 'outbox_jobs') (q as unknown as { insert: () => unknown }).insert = () => Promise.resolve({ data: null, error: { code: 'XX000', message: 'down' } });
      return q;
    };
    const r = await replayEvent(client, actor, 'ev1');
    expect(r.ok).toBe(false);
    expect(f.tables.integration_events[0].status).toBe('failed');
    expect(f.tables.audit_log).toHaveLength(0);
  });
});

describe('retryJob', () => {
  it('resets the same row (no new job) and audits the queue', async () => {
    const f = store({ outbox_jobs: [{ id: 'j1', org_id: ORG, queue: 'xero.fetch', status: 'failed', attempts: 5, last_error: 'xero 429', run_at: '2026-10-29T13:00:00Z', locked_at: '2026-10-29T11:00:00Z' }] });
    const r = await retryJob(f.client, actor, 'j1', NOW);
    expect(r).toMatchObject({ ok: true, queued: true });
    expect(f.tables.outbox_jobs).toEqual([expect.objectContaining({ id: 'j1', status: 'pending', attempts: 0, last_error: null, locked_at: null, run_at: NOW.toISOString() })]);
    expect(f.calls('outbox_jobs').filter((c) => c.op === 'insert')).toHaveLength(0);
    const upd = f.calls('outbox_jobs').find((c) => c.op === 'update')!;
    expect(eqOf(upd, 'status')).toBe('failed'); // conditional: a concurrent retry or drain wins
    expect(eqOf(upd, 'org_id')).toBe(ORG);
    expect(f.tables.audit_log).toEqual([expect.objectContaining({ action: 'job.retry', entity: 'outbox_job', entity_id: 'j1', meta: { queue: 'xero.fetch', attempts: 5 } })]);
  });

  it('refuses a job that is not failed, or belongs to another org', async () => {
    const f = store({ outbox_jobs: [
      { id: 'j1', org_id: ORG, queue: 'q', status: 'pending', attempts: 1 },
      { id: 'j2', org_id: OTHER, queue: 'q', status: 'failed', attempts: 5 },
    ] });
    expect((await retryJob(f.client, actor, 'j1', NOW)).ok).toBe(false);
    expect((await retryJob(f.client, actor, 'j2', NOW)).message).toMatch(/no longer exists/);
    expect(f.tables.outbox_jobs.map((j) => j.status)).toEqual(['pending', 'failed']);
    expect(f.tables.audit_log).toHaveLength(0);
  });
});

describe('activity wording', () => {
  const row = (action: string, meta: Record<string, unknown>, entity: string) => ({ id: 1, created_at: NOW.toISOString(), actor_user: null, action, entity, entity_id: 'abc', meta });
  it('describes replay and retry under Integrations, with links', () => {
    expect(describeRow(row('integration.replay', { source: 'xero' }, 'integration_event'), new Map()).text).toBe('System replayed a stored Xero webhook event');
    expect(describeRow(row('integration.replay', { source: 'leads' }, 'integration_event'), new Map()).text).toBe('System replayed a stored lead intake event');
    expect(describeRow(row('job.retry', { queue: 'xero.fetch' }, 'outbox_job'), new Map()).text).toBe('System retried a failed job (xero.fetch)');
    expect(areaOf('integration.replay')).toBe('integrations');
    expect(areaOf('job.retry')).toBe('integrations');
    expect(hrefFor({ entity: 'integration_event', entity_id: 'abc', meta: {} })).toBe('/admin/integrations/xero');
    expect(hrefFor({ entity: 'outbox_job', entity_id: 'abc', meta: {} })).toBe('/admin/tasks?filter=failed-jobs');
  });
});

describe('server actions', () => {
  it('check integrations.manage first and validate the id with Zod', () => {
    const src = readFileSync(path.resolve('app/(admin)/admin/integrations/ops-actions.ts'), 'utf8');
    for (const fn of ['replayEventAction', 'retryJobAction']) {
      const body = src.slice(src.indexOf(`export async function ${fn}`));
      const firstLine = body.split('\n')[1];
      expect(firstLine).toContain("await requirePerm('integrations.manage')");
      expect(body.slice(0, 400)).toContain('Id.safeParse');
    }
  });
});
