// lib/integrations/xero/write/run.ts performXeroAction for release.on_paid (no Xero writes) against an in-memory
// stand-in for the supabase-js calls it makes. Checks the run status of a dry run and the one-time guards of the
// RELEASE FORM effects. Forms, entries, PDFs and email are mocked. Synthetic data only.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

type Row = Record<string, unknown>;
const ORG = '00000000-0000-0000-0000-000000000001';

const runActionCalls: Row[] = [];
const sends: Row[] = [];
let release: { existingReleaseEntryId: string | null } = { existingReleaseEntryId: null };

vi.mock('@/lib/forms/entries', () => ({
  loadEntryById: vi.fn(async (_db: unknown, _form: unknown, id: string) => ({ id, number: 1, status: 'Submitted', data: {} })),
  loadFiles: vi.fn(async () => []),
}));
vi.mock('@/lib/forms/forms', () => ({ loadForm: vi.fn(async (_db: unknown, _org: string, slug: string) => ({ id: `form-${slug}`, slug })) }));
vi.mock('@/lib/forms/org', () => ({ loadOrg: vi.fn(async () => ({ timezone: 'Africa/Johannesburg' })) }));
vi.mock('@/lib/forms/storage', () => ({ downloadObject: vi.fn(async () => null), ENTRY_BUCKET: 'entry-files' }));
vi.mock('@/lib/pdf/documents', () => ({ ensureDocument: vi.fn(async () => ({ name: 'Release.pdf', bytes: Buffer.from('%PDF-') })) }));
vi.mock('@/lib/workflow/mailer', () => ({ sendEmail: vi.fn(async (_db: unknown, input: Row) => { sends.push(input); return 'skipped'; }) }));
vi.mock('@/lib/workflow/run-action', () => ({
  systemActor: (job: string) => ({ kind: 'system', job }),
  systemUpdateEntry: vi.fn(),
  runAction: vi.fn(async (input: { entry: { id: string } | null; actionName: string }) => {
    runActionCalls.push({ actionName: input.actionName, entryId: input.entry?.id ?? null });
    return { ok: true, entryId: input.entry?.id ?? 'release-new', number: 1 };
  }),
}));
vi.mock('@/lib/integrations/xero/connection', () => ({ loadConnection: vi.fn(async () => null), accessToken: vi.fn(), recordRate: vi.fn() }));
vi.mock('@/lib/integrations/xero/write/load', () => ({
  Refresher: class { async flush() {} },
  loadDealInput: vi.fn(), loadRfiInput: vi.fn(), loadDeliveryInput: vi.fn(), loadMergeInput: vi.fn(),
  loadReleaseInput: vi.fn(async (_db: unknown, _org: string, invoiceId: string) => ({
    invoice: {
      invoice_id: invoiceId, invoice_number: 'INV-0001', invoice_type: 'ACCREC', reference: '90001', status: 'PAID', contact_id: 'c-1',
      contact_name: 'Test Customer', total: 1000, amount_due: 0, fully_paid_on: '2026-10-20', currency_code: 'ZAR',
    },
    contactEmail: null,
    existingReleaseEntryId: release.existingReleaseEntryId,
  })),
}));

const { performXeroAction } = await import('@/lib/integrations/xero/write/run');

/** Enough of PostgREST for run.ts: settings, run rows, claims (unique org + key), refs, recipients. */
function fakeDb(mode: string) {
  const tables: Record<string, Row[]> = {
    app_settings: [{ org_id: ORG, key: 'xero.action.release.on_paid', value: mode }],
    xero_action_runs: [], action_claims: [], external_refs: [],
    notification_recipients: [{ org_id: ORG, event_key: 'release.paid', address: 'branch@example.invalid', active: true }],
  };
  let seq = 0;
  const from = (t: string) => {
    let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
    let payload: Row = {};
    const filters: Array<(r: Row) => boolean> = [];
    const run = async (): Promise<{ data: Row[] | null; error: { code?: string; message: string } | null }> => {
      const rows = (tables[t] ??= []);
      if (op === 'insert' || op === 'upsert') {
        if (t === 'action_claims' && rows.some((r) => r.org_id === payload.org_id && r.action_key === payload.action_key)) {
          return op === 'upsert' ? { data: [], error: null } : { data: null, error: { code: '23505', message: 'duplicate key value' } };
        }
        const row = { id: `${t}-${++seq}`, ...(t === 'action_claims' ? { result: null } : {}), ...payload };
        rows.push(row);
        return { data: [row], error: null };
      }
      const hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') hit.forEach((r) => Object.assign(r, payload));
      if (op === 'delete') tables[t] = rows.filter((r) => !hit.includes(r));
      return { data: hit, error: null };
    };
    const b = {
      select() { return b; },
      insert(p: Row) { op = 'insert'; payload = p; return b; },
      upsert(p: Row) { op = 'upsert'; payload = p; return b; },
      update(p: Row) { op = 'update'; payload = p; return b; },
      delete() { op = 'delete'; return b; },
      eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return b; },
      is(k: string, v: unknown) { filters.push((r) => (r[k] ?? null) === v); return b; },
      single: () => run().then((r) => ({ data: r.data?.[0] ?? null, error: r.error })),
      maybeSingle: () => run().then((r) => ({ data: r.data?.[0] ?? null, error: r.error })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
    };
    return b;
  };
  return { db: { from } as never, tables };
}

beforeEach(() => {
  runActionCalls.length = 0;
  sends.length = 0;
  release = { existingReleaseEntryId: null };
});

describe('performXeroAction (release.on_paid)', () => {
  it('a dry run with no Xero requests is recorded as planned and applies nothing', async () => {
    const f = fakeDb('dry_run');
    expect(await performXeroAction(f.db, ORG, 'release.on_paid', { invoiceId: 'inv-1' }, 'job-1')).toBe('planned');
    expect(f.tables.xero_action_runs).toEqual([expect.objectContaining({ mode: 'dry_run', status: 'planned', finished_at: expect.any(String) })]);
    expect(runActionCalls).toHaveLength(0);
    expect(sends).toHaveLength(0);
    expect(f.tables.action_claims).toHaveLength(0);
  });

  it('live: the RELEASE FORM Submit happens once per invoice, whatever the job', async () => {
    const f = fakeDb('live');
    expect(await performXeroAction(f.db, ORG, 'release.on_paid', { invoiceId: 'inv-1' }, 'job-1')).toBe('succeeded');
    expect(await performXeroAction(f.db, ORG, 'release.on_paid', { invoiceId: 'inv-1' }, 'job-2')).toBe('succeeded');
    expect(runActionCalls).toEqual([{ actionName: 'Submit', entryId: null }]);
    expect(sends).toHaveLength(1);
    expect(f.tables.xero_action_runs.map((r) => r.status)).toEqual(['succeeded', 'succeeded']);
  });

  it('live: the Update of the mapped entry applies once per job: a retry is a no-op, a new paid event applies', async () => {
    release = { existingReleaseEntryId: 'release-1' };
    const f = fakeDb('live');
    await performXeroAction(f.db, ORG, 'release.on_paid', { invoiceId: 'inv-1' }, 'job-1');
    await performXeroAction(f.db, ORG, 'release.on_paid', { invoiceId: 'inv-1' }, 'job-1'); // the outbox retries the same job
    expect(runActionCalls).toEqual([{ actionName: 'Update', entryId: 'release-1' }]);
    await performXeroAction(f.db, ORG, 'release.on_paid', { invoiceId: 'inv-1' }, 'job-2'); // the invoice is paid again later
    expect(runActionCalls).toEqual([{ actionName: 'Update', entryId: 'release-1' }, { actionName: 'Update', entryId: 'release-1' }]);
    const keys = f.tables.action_claims.map((c) => c.action_key);
    expect(keys).toContain('release.on_paid:inv-1#entry.update.job-1');
    expect(keys).toContain('release.on_paid:inv-1#entry.update.job-2');
    expect(sends).toHaveLength(1); // one release email per invoice
  });
});
