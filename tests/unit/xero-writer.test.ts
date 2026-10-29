// writer.ts: dry_run never touches the network; live refuses to send without a claimed key; claims make a
// retry a no-op. The "network" here is an injected fetch function: no request leaves the process.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { ClaimHeld, executePlan, WriterRefused, XeroWriteError, XeroWriter } = await import('@/lib/integrations/xero/write/writer');
type WriterDeps = ConstructorParameters<typeof XeroWriter>[0];
import type { Plan } from '@/lib/integrations/xero/write/types';
import type { Claim } from '@/lib/integrations/xero/write/writer';

type Row = Record<string, unknown>;

/** In-memory stand-in for the few supabase-js calls the writer makes (action_claims, xero_connections). */
function fakeDb() {
  const tables: Record<string, Row[]> = { action_claims: [], xero_connections: [] };
  const from = (t: string) => {
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Row = {};
    const filters: Array<[string, unknown]> = [];
    const match = (r: Row) => filters.every(([k, v]) => (k === 'result->>status' ? (r.result as Row | null)?.status === v : r[k] === v));
    const run = async () => {
      const rows = (tables[t] ??= []);
      if (op === 'insert') {
        if (t === 'action_claims' && rows.some((r) => r.org_id === payload.org_id && r.action_key === payload.action_key)) return { data: null, error: { code: '23505' } };
        const row = { id: String(rows.length + 1), result: null, ...payload };
        rows.push(row);
        return { data: [row], error: null };
      }
      if (op === 'update') {
        const hit = rows.filter(match);
        hit.forEach((r) => Object.assign(r, payload));
        return { data: hit, error: null };
      }
      return { data: rows.filter(match), error: null };
    };
    const b = {
      insert(p: Row) { op = 'insert'; payload = p; return b; },
      update(p: Row) { op = 'update'; payload = p; return b; },
      select() { return b; },
      eq(k: string, v: unknown) { filters.push([k, v]); return b; },
      maybeSingle: () => run().then((r) => ({ data: (r.data as Row[] | null)?.[0] ?? null, error: r.error })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
    };
    return b;
  };
  return { db: { from } as unknown as WriterDeps['db'], tables };
}

const ORG = '00000000-0000-0000-0000-000000000001';
const conn = { id: 'conn-1', orgId: ORG, tenantId: 'tenant-test', tenantName: 'Demo', status: 'connected' as const, expiresAt: null, scopes: ['accounting.transactions', 'accounting.contacts', 'accounting.attachments'] };

const plan: Plan = {
  action: 'rfi.create_invoice', idempotencyKey: 'rfi.create_invoice:90001', status: 'ready', effects: [], expected: {},
  requests: [
    { step: 'invoice.create', method: 'PUT', path: '/Invoices', body: { Invoices: [{ Reference: '90001' }] }, capture: { name: 'invoice', path: 'Invoices.0.InvoiceID' }, purpose: 'create' },
    { step: 'attach.f1', method: 'PUT', path: '/Invoices/{{invoice}}/Attachments/proof.pdf', file: { kind: 'entry_file', entryId: 'e', fileId: 'f1', field: '_1stDeposit', fileName: 'proof.pdf', contentType: 'application/pdf', size: 3 }, purpose: 'attach' },
  ],
};
const loadFile = async () => ({ bytes: Buffer.from('pdf'), contentType: 'application/pdf' });

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (_url: URL, init: RequestInit) => {
    if (init.method === 'PUT' && String(_url).endsWith('/Invoices')) return json(200, { Invoices: [{ InvoiceID: 'inv-created' }] });
    return json(200, { Attachments: [{ AttachmentID: 'att-1' }] });
  });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('global fetch must not be used in tests'); }));
});

function writer(mode: 'dry_run' | 'live', db = fakeDb().db) {
  return new XeroWriter({ db, orgId: ORG, mode, connection: conn, token: async () => 'test-token', fetchImpl: fetchMock as unknown as typeof fetch, apiUrl: 'http://xero-mock.invalid', sleep: async () => undefined });
}

describe('dry_run', () => {
  it('records every planned request with synthetic ids and never touches the network or claims', async () => {
    const f = fakeDb();
    const w = writer('dry_run', f.db);
    const r = await executePlan(w, plan, loadFile);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(f.tables.action_claims).toEqual([]);
    expect(r.captures).toEqual({ invoice: 'dry-run-invoice' });
    expect(w.recorded.map((x) => [x.step, x.path, x.dryRun])).toEqual([
      ['invoice.create', '/Invoices', true],
      ['attach.f1', '/Invoices/dry-run-invoice/Attachments/proof.pdf', true],
    ]);
  });

  it('send() in dry_run returns a synthetic response even without a claim', async () => {
    const res = await writer('dry_run').send({ step: 's', method: 'POST', path: '/Invoices/x', json: {}, claimKey: 'k' }, null);
    expect(res).toEqual({ status: 0, dryRun: true, json: { dryRun: true } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('live', () => {
  const req = { step: 'invoice.create', method: 'PUT' as const, path: '/Invoices', json: {}, claimKey: 'rfi.create_invoice:90001#invoice.create' };

  it('refuses to send without a claimed key, with a forged claim, or with another request\'s claim', async () => {
    const w = writer('live');
    await expect(w.send(req, null)).rejects.toBeInstanceOf(WriterRefused);
    const forged = { orgId: ORG, key: req.claimKey } as unknown as Claim;
    await expect(w.send(req, forged)).rejects.toBeInstanceOf(WriterRefused);
    const other = await w.claim('rfi.create_invoice:90001#other');
    if (!('claim' in other)) throw new Error('expected a claim');
    await expect(w.send(req, other.claim)).rejects.toThrow(/does not match/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses DELETE and PATCH outright', async () => {
    const w = writer('live');
    const c = await w.claim(req.claimKey);
    if (!('claim' in c)) throw new Error('expected a claim');
    await expect(w.send({ ...req, method: 'DELETE' as never }, c.claim)).rejects.toThrow(/method DELETE/);
    await expect(w.send({ ...req, method: 'PATCH' as never }, c.claim)).rejects.toThrow(/method PATCH/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends claimed requests once (with an Idempotency-Key); a retried plan reuses the results and sends nothing', async () => {
    const f = fakeDb();
    const first = await executePlan(writer('live', f.db), plan, loadFile);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(String(url)).toBe('http://xero-mock.invalid/api.xro/2.0/Invoices/inv-created/Attachments/proof.pdf');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toMatch(/^[0-9a-f]{64}$/);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/pdf');
    expect(first.captures).toEqual({ invoice: 'inv-created' });
    expect(f.tables.action_claims.map((c) => c.action_key)).toEqual(['rfi.create_invoice:90001#invoice.create', 'rfi.create_invoice:90001#attach.f1']);

    const again = await executePlan(writer('live', f.db), plan, loadFile);
    expect(fetchMock).toHaveBeenCalledTimes(2); // no duplicate invoice, no duplicate attachment
    expect(again.steps.map((s) => s.outcome)).toEqual(['already_done', 'already_done']);
    expect(again.captures).toEqual({ invoice: 'inv-created' });
  });

  it('stops when a step was claimed but has no result (unknown outcome): never re-sends', async () => {
    const f = fakeDb();
    f.tables.action_claims.push({ id: 'x', org_id: ORG, action_key: 'rfi.create_invoice:90001#invoice.create', result: null });
    await expect(executePlan(writer('live', f.db), plan, loadFile)).rejects.toBeInstanceOf(ClaimHeld);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a Xero refusal (4xx) marks the claim rejected so a later run may try again', async () => {
    const f = fakeDb();
    fetchMock.mockImplementationOnce(async () => json(400, { Type: 'ValidationException', Message: 'synthetic' }));
    await expect(executePlan(writer('live', f.db), plan, loadFile)).rejects.toBeInstanceOf(XeroWriteError);
    expect(f.tables.action_claims[0].result).toEqual({ status: 'rejected', http: 400 });
    const r = await executePlan(writer('live', f.db), plan, loadFile);
    expect(r.captures.invoice).toBe('inv-created');
  });

  it('retries 429 with backoff under the same claim', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 429, headers: { 'retry-after': '1' } }));
    const r = await executePlan(writer('live'), plan, loadFile);
    expect(r.captures.invoice).toBe('inv-created');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('claims are only for live mode', async () => {
    await expect(writer('dry_run').claim('k')).rejects.toBeInstanceOf(WriterRefused);
  });
});
