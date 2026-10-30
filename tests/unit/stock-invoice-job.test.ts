// lib/stock/invoice-job.ts against an in-memory stand-in for the supabase-js calls it makes, with a simulated
// stock_apply_invoice. Covers the M6 review fixes at job level. Synthetic invoices and VINs only.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { processStockInvoices, runStockInvoicesJob, enqueueStockInvoices } = await import('@/lib/stock/invoice-job');

type Row = Record<string, unknown>;
const ORG = '00000000-0000-0000-0000-000000000001';
const ID = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-30T10:00:00.000Z';

interface Fake {
  db: never;
  tables: Record<string, Row[]>;
  rpcs: Row[];
  /** Called after each select on a table (to change the mirror mid-run). */
  afterSelect: (table: string, n: number) => void;
  failSelect: Set<string>;
}

function fakeDb(seed: Record<string, Row[]>): Fake {
  const tables: Record<string, Row[]> = { app_settings: [], stock_models: [{ org_id: ORG, part_number: '3000D' }], stock_units: [], xero_invoices: [], xero_invoice_lines: [],
    xero_credit_notes: [], stock_invoice_exceptions: [], outbox_jobs: [], job_runs: [], orgs: [{ id: ORG, timezone: 'UTC' }], ...seed };
  const selects: Record<string, number> = {};
  const f: Fake = { db: undefined as never, tables, rpcs: [], afterSelect: () => {}, failSelect: new Set() };
  let seq = 0;

  const from = (t: string) => {
    let op: 'select' | 'insert' | 'update' = 'select';
    let payload: Row = {};
    let limit = Infinity;
    let offset = 0;
    const filters: Array<(r: Row) => boolean> = [];
    const get = (r: Row, k: string) => {
      const m = k.match(/^(\w+)->>(\w+)$/);
      if (!m) return r[k];
      const v = (r[m[1]] as Row | undefined)?.[m[2]];
      return v === undefined || v === null ? null : String(v);
    };
    const run = async (): Promise<{ data: Row[] | null; error: { message: string } | null }> => {
      const rows = (tables[t] ??= []);
      if (op === 'insert') {
        const list = Array.isArray(payload) ? payload : [payload];
        const made = list.map((p) => ({ id: `${t}-${++seq}`, status: 'pending', attempts: 0, created_at: new Date(Date.now() + seq).toISOString(), ...p }));
        rows.push(...made);
        return { data: made, error: null };
      }
      if (op === 'select' && f.failSelect.has(t)) return { data: null, error: { message: 'injected' } };
      const hit = rows.filter((r) => filters.every((fn) => fn(r)));
      if (op === 'update') {
        hit.forEach((r) => Object.assign(r, payload));
        return { data: hit, error: null };
      }
      selects[t] = (selects[t] ?? 0) + 1;
      const out = hit.slice(offset, offset + limit).map((r) => ({ ...r }));
      f.afterSelect(t, selects[t]);
      return { data: out, error: null };
    };
    const b = {
      select() { return b; },
      insert(p: Row) { op = 'insert'; payload = p; return b; },
      update(p: Row) { op = 'update'; payload = p; return b; },
      eq(k: string, v: unknown) { filters.push((r) => String(get(r, k)) === String(v)); return b; },
      in(k: string, v: unknown[]) { filters.push((r) => v.includes(get(r, k))); return b; },
      gte(k: string, v: string) { filters.push((r) => r[k] != null && String(r[k]) >= v); return b; },
      gt(k: string, v: string) { filters.push((r) => String(r[k]) > v); return b; },
      ilike(k: string, pat: string) { const needle = pat.replace(/\*/g, '').toLowerCase(); filters.push((r) => String(r[k] ?? '').toLowerCase().includes(needle)); return b; },
      order() { return b; },
      limit(n: number) { limit = n; return b; },
      range(a: number, z: number) { offset = a; limit = z - a + 1; return b; },
      maybeSingle: () => run().then((r) => ({ data: r.data?.[0] ?? null, error: r.error })),
      single: () => run().then((r) => ({ data: r.data?.[0] ?? null, error: r.error })),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
    };
    return b;
  };

  // stock_apply_invoice, simplified: VIN match by containment, the conflicts, and exception dedupe per Xero state.
  const rpc = async (name: string, a: Row) => {
    expect(name).toBe('stock_apply_invoice');
    f.rpcs.push(a);
    const ref = String(a.p_reference ?? '').toUpperCase().replace(/\s/g, '');
    const unit = tables.stock_units.find((u) => ref.includes(String(u.vin_norm)));
    const outcome = String(a.p_outcome);
    const inv = a.p_invoice_number ? String(a.p_invoice_number).toUpperCase() : null;
    let reason: string | null = outcome.startsWith('exception:') ? outcome.slice(10) : null;
    if (!reason) {
      if (!unit) reason = 'vin_not_found';
      else if (unit.invoice_number && unit.invoice_number !== inv) reason = 'unit_linked_other_invoice';
    }
    if (reason) {
      const exists = tables.stock_invoice_exceptions.some((e) => e.xero_invoice_id === a.p_xero_invoice_id && e.reason === reason
        && (!e.resolved_at || !a.p_source_updated || (e.source_updated_utc != null && String(e.source_updated_utc) >= String(a.p_source_updated))));
      if (!exists) tables.stock_invoice_exceptions.push({ org_id: ORG, xero_invoice_id: a.p_xero_invoice_id, invoice_number: inv, reason, unit_id: unit?.id ?? null, resolved_at: null, source_updated_utc: a.p_source_updated });
      return { data: { result: 'exception', reason, recorded: !exists, unit_id: unit?.id }, error: null };
    }
    if (unit!.status === outcome && unit!.invoice_number === inv) {
      if (!unit!.xero_invoice_id) unit!.xero_invoice_id = a.p_xero_invoice_id;
      return { data: { result: 'noop', status: outcome, unit_id: unit!.id, invoice_number: inv }, error: null };
    }
    Object.assign(unit!, { status: outcome, invoice_number: inv, xero_invoice_id: a.p_xero_invoice_id });
    return { data: { result: outcome, unit_id: unit!.id, invoice_number: inv }, error: null };
  };
  f.db = { from, rpc } as never;
  return f;
}

const settings = (rules = 'live', from = '2026-01-01') => [
  { org_id: ORG, key: 'stock.deals_from', value: from },
  { org_id: ORG, key: 'stock.invoice_rules', value: rules },
];
const unit = (n: number, o: Row = {}): Row => ({ org_id: ORG, id: `u${n}`, vin_norm: `TESTVIN0000000000${n}`, status: 'available', invoice_number: null, xero_invoice_id: null, ...o });
const inv = (n: number, o: Row = {}): Row => ({
  org_id: ORG, invoice_id: ID(n), invoice_number: `INV-${n}`, invoice_type: 'ACCREC', status: 'AUTHORISED', amount_due: 100, credit_note_applied: 0,
  reference: null, updated_utc: NOW, ...o,
});
const ids = (...n: number[]) => ({ kind: 'ids' as const, invoice_ids: n.map(ID), credit_note_ids: [] });

let f: Fake;
beforeEach(() => { f = fakeDb({}); });

describe('stock.invoices job (review fixes)', () => {
  it('item 1: re-reads the invoice right before applying, so a state that changed during the run is never applied', async () => {
    f = fakeDb({ app_settings: settings(), stock_units: [unit(1)], xero_invoices: [inv(1, { status: 'PAID', amount_due: 0, reference: 'TESTVIN00000000001' })] });
    // After the batch was listed, the payment is removed in Xero and the mirror updated.
    f.afterSelect = (t, n) => {
      if (t === 'xero_invoices' && n === 1) Object.assign(f.tables.xero_invoices[0], { status: 'AUTHORISED', amount_due: 100, updated_utc: '2026-10-30T10:05:00.000Z' });
    };
    await processStockInvoices(f.db, ORG, ids(1));
    expect(f.rpcs).toHaveLength(1);
    expect(f.rpcs[0]).toMatchObject({ p_outcome: 'reserved', p_source_updated: '2026-10-30T10:05:00.000Z' });
    expect(f.tables.stock_units[0]).toMatchObject({ status: 'reserved' });
  });

  it('item 1: a job claimed while an earlier one for the org runs re-queues itself and does nothing now', async () => {
    f = fakeDb({ app_settings: settings(), stock_units: [unit(1)], xero_invoices: [inv(1, { reference: 'TESTVIN00000000001' })] });
    f.tables.outbox_jobs.push(
      { id: 'job-a', org_id: ORG, queue: 'stock.invoices', status: 'running', attempts: 1, locked_at: '2026-10-30T10:00:00.000Z', payload: { kind: 'sweep' } },
      { id: 'job-b', org_id: ORG, queue: 'stock.invoices', status: 'running', attempts: 1, locked_at: '2026-10-30T10:00:01.000Z', payload: ids(1) },
    );
    await runStockInvoicesJob(f.db, { id: 'job-b', org_id: ORG, queue: 'stock.invoices', payload: {}, attempts: 1 });
    expect(f.rpcs).toHaveLength(0);
    expect(f.tables.job_runs).toHaveLength(0);
    const deferred = f.tables.outbox_jobs.filter((j) => j.status === 'pending');
    expect(deferred).toHaveLength(1);
    expect(deferred[0].payload).toMatchObject({ kind: 'ids', invoice_ids: [ID(1)] });
    expect(Date.parse(String(deferred[0].run_at))).toBeGreaterThan(Date.now());
    // The earlier job is not held back by the later one.
    await runStockInvoicesJob(f.db, { id: 'job-a', org_id: ORG, queue: 'stock.invoices', payload: {}, attempts: 1 });
    expect(f.tables.stock_units[0]).toMatchObject({ status: 'reserved' });
  });

  it('item 6: two live invoices naming one VIN: neither is applied, both are exceptions', async () => {
    f = fakeDb({ app_settings: settings(), stock_units: [unit(1)], xero_invoices: [
      inv(1, { reference: 'TESTVIN00000000001' }), inv(2, { reference: 'Unit TESTVIN00000000001', status: 'PAID', amount_due: 0 }),
    ] });
    await processStockInvoices(f.db, ORG, ids(1, 2));
    expect(f.tables.stock_units[0]).toMatchObject({ status: 'available', invoice_number: null });
    expect(f.tables.stock_invoice_exceptions.map((e) => [e.xero_invoice_id, e.reason])).toEqual([[ID(1), 'vin_on_several_invoices'], [ID(2), 'vin_on_several_invoices']]);
  });

  it('a unit linked to another invoice: exception, no change', async () => {
    f = fakeDb({ app_settings: settings(), stock_units: [unit(1, { status: 'reserved', invoice_number: 'INV-9', xero_invoice_id: ID(9) })],
      xero_invoices: [inv(3, { reference: 'TESTVIN00000000001', status: 'PAID', amount_due: 0 })] });
    await processStockInvoices(f.db, ORG, ids(3));
    expect(f.tables.stock_units[0]).toMatchObject({ status: 'reserved', invoice_number: 'INV-9' });
    expect(f.tables.stock_invoice_exceptions).toEqual([expect.objectContaining({ xero_invoice_id: ID(3), reason: 'unit_linked_other_invoice', unit_id: 'u1' })]);
  });

  it('item 5: a resolved exception is not raised again for the same Xero state, but is after the invoice changes', async () => {
    f = fakeDb({ app_settings: settings(), stock_units: [unit(1)], xero_invoices: [inv(4, { reference: 'TESTVIN00000000001', status: 'VOIDED' })] });
    await processStockInvoices(f.db, ORG, ids(4));
    expect(f.tables.stock_invoice_exceptions).toHaveLength(1);
    f.tables.stock_invoice_exceptions[0].resolved_at = NOW;
    await processStockInvoices(f.db, ORG, ids(4));
    expect(f.rpcs).toHaveLength(1); // skipped: resolved for this state
    f.tables.xero_invoices[0].updated_utc = '2026-10-31T09:00:00.000Z';
    await processStockInvoices(f.db, ORG, ids(4));
    expect(f.tables.stock_invoice_exceptions).toHaveLength(2);
    expect(f.tables.stock_invoice_exceptions[1]).toMatchObject({ resolved_at: null, source_updated_utc: '2026-10-31T09:00:00.000Z' });
  });

  it('item 2: a sales credit note naming a unit becomes a credit_note exception; the unit is unchanged', async () => {
    f = fakeDb({ app_settings: settings(), stock_units: [unit(1, { status: 'reserved', invoice_number: 'INV-5' })], xero_credit_notes: [
      { org_id: ORG, credit_note_id: ID(50), credit_note_number: 'CN-50', credit_note_type: 'ACCRECCREDIT', status: 'AUTHORISED', reference: null, invoice_ids: [ID(5)], updated_utc: NOW },
      { org_id: ORG, credit_note_id: ID(51), credit_note_number: 'CN-51', credit_note_type: 'ACCRECCREDIT', status: 'AUTHORISED', reference: 'Parts refund', invoice_ids: [], updated_utc: NOW },
    ], xero_invoices: [inv(5, { reference: 'TESTVIN00000000001', updated_utc: '2025-01-01T00:00:00.000Z' })] });
    await processStockInvoices(f.db, ORG, { kind: 'ids', invoice_ids: [], credit_note_ids: [ID(50), ID(51)] });
    expect(f.tables.stock_invoice_exceptions).toEqual([expect.objectContaining({ xero_invoice_id: ID(50), invoice_number: 'CN-50', reason: 'credit_note', unit_id: 'u1' })]);
    expect(f.tables.stock_units[0]).toMatchObject({ status: 'reserved', invoice_number: 'INV-5' });
    // The nightly sweep sees the credit note too, and records nothing new.
    await processStockInvoices(f.db, ORG, { kind: 'sweep' });
    expect(f.tables.stock_invoice_exceptions).toHaveLength(1);
  });

  it('item 4: stock.invoices_from bounds the job; unset with no stock start date = nothing examined', async () => {
    const base = { stock_units: [unit(1)], xero_invoices: [inv(6, { reference: 'TESTVIN00000000001', updated_utc: '2026-03-01T00:00:00.000Z' })] };
    f = fakeDb({ ...base, app_settings: [...settings(), { org_id: ORG, key: 'stock.invoices_from', value: '2026-06-01' }] });
    expect(await processStockInvoices(f.db, ORG, ids(6))).toMatchObject({ evaluated: 0 });
    f = fakeDb({ ...base, app_settings: [...settings(), { org_id: ORG, key: 'stock.invoices_from', value: '2026-02-01' }] });
    expect(await processStockInvoices(f.db, ORG, ids(6))).toMatchObject({ evaluated: 1, applied: 1 });
    f = fakeDb({ ...base, app_settings: [{ org_id: ORG, key: 'stock.invoice_rules', value: 'live' }] });
    expect(await processStockInvoices(f.db, ORG, ids(6))).toMatchObject({ skipped: 'no_start_date', evaluated: 0 });
  });

  it('item 7: an unreadable payload throws (the outbox retries) instead of running an empty job', async () => {
    f = fakeDb({ app_settings: settings() });
    f.tables.outbox_jobs.push({ id: 'job-c', org_id: ORG, queue: 'stock.invoices', status: 'running', attempts: 1, payload: ids(1) });
    f.failSelect.add('outbox_jobs');
    await expect(runStockInvoicesJob(f.db, { id: 'job-c', org_id: ORG, queue: 'stock.invoices', payload: ids(1), attempts: 1 })).rejects.toThrow('payload unreadable');
  });

  it('item 7: ids merge only into a pending job nothing has tried yet', async () => {
    f.tables.outbox_jobs.push({ id: 'tried', org_id: ORG, queue: 'stock.invoices', status: 'pending', attempts: 1, payload: { kind: 'ids', invoice_ids: [ID(1)], rev: 0 }, created_at: NOW });
    await enqueueStockInvoices(f.db, ORG, [ID(2)]);
    expect(f.tables.outbox_jobs.find((j) => j.id === 'tried')?.payload).toEqual({ kind: 'ids', invoice_ids: [ID(1)], rev: 0 });
    const fresh = f.tables.outbox_jobs.filter((j) => j.id !== 'tried');
    expect(fresh).toHaveLength(1);
    await enqueueStockInvoices(f.db, ORG, [ID(3)]);
    expect(f.tables.outbox_jobs).toHaveLength(2);
    expect(fresh[0].payload).toMatchObject({ kind: 'ids', invoice_ids: [ID(2), ID(3)], rev: 1 });
  });
});
