import { describe, expect, it } from 'vitest';
import type { UnitFacts } from '@/lib/stock/invoice';
import {
  applyRpcResult, cleanInvoiceIds, countOutcome, exceptionKey, invoicesFromInstant, emptyCounts, evaluateInvoice, itemCodesByInvoice, manualResultMessage, MAX_IDS_PER_JOB,
  mergeInvoiceIds, outcomeView, xeroStatusLabel, type MirrorInvoiceRow,
} from '@/lib/stock/invoice-review';
import { STOCK_MODELS } from '@/lib/stock/models';
import {
  checkRulesSwitch, DEFAULT_INVOICE_RULES, isIsoDate, parseInvoiceRules, parseStockStart, stockSettingsFrom,
} from '@/lib/stock/settings';

// Synthetic invoices and VINs only.
const PARTS = STOCK_MODELS.map((m) => m.partNumber);
const ID = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const units = (): UnitFacts[] => [
  { id: 'u1', vin_norm: 'TESTVIN00000000001', status: 'available', invoice_number: null },
  { id: 'u2', vin_norm: 'TESTVIN00000000002', status: 'reserved', invoice_number: 'INV-0002' },
];
const row = (o: Partial<MirrorInvoiceRow>): MirrorInvoiceRow => ({
  invoice_id: ID(1), invoice_number: 'INV-0001', invoice_type: 'ACCREC', status: 'AUTHORISED', amount_due: '1000.00', amount_credited: '0.00',
  reference: 'TESTVIN00000000001', updated_utc: '2026-10-01T00:00:00Z', ...o,
});

describe('stock settings', () => {
  it('invoice rules default to preview; only off/preview/live are read', () => {
    expect(DEFAULT_INVOICE_RULES).toBe('preview');
    expect(parseInvoiceRules(undefined)).toBe('preview');
    expect(parseInvoiceRules('LIVE')).toBe('live');
    expect(parseInvoiceRules(' off ')).toBe('off');
    expect(parseInvoiceRules('dry_run')).toBe('preview');
    expect(parseInvoiceRules({ mode: 'live' })).toBe('preview');
  });

  it('the start date is a real YYYY-MM-DD (string, { date } or a timestamp)', () => {
    expect(parseStockStart('2026-03-01')).toBe('2026-03-01');
    expect(parseStockStart({ date: '2026-03-01' })).toBe('2026-03-01');
    expect(parseStockStart('2026-03-01T10:00:00Z')).toBe('2026-03-01');
    expect(parseStockStart('2026-02-30')).toBeNull();
    expect(parseStockStart(null)).toBeNull();
    expect(isIsoDate('1999-12-31')).toBe(false);
  });

  it('reads settings rows', () => {
    expect(stockSettingsFrom([{ key: 'stock.deals_from', value: '2026-03-01' }, { key: 'stock.invoice_rules', value: 'live' }]))
      .toEqual({ start: '2026-03-01', rules: 'live' });
    expect(stockSettingsFrom(null)).toEqual({ start: null, rules: 'preview' });
  });

  it('live needs the typed confirmation; other modes do not', () => {
    expect(checkRulesSwitch('live', '')).toMatch(/Type "live"/);
    expect(checkRulesSwitch('live', 'yes')).toMatch(/Type "live"/);
    expect(checkRulesSwitch('live', ' Live ')).toBeNull();
    expect(checkRulesSwitch('preview', null)).toBeNull();
    expect(checkRulesSwitch('off', undefined)).toBeNull();
  });

  it('invoices are checked from the start of the start date in the org timezone', () => {
    expect(invoicesFromInstant('2026-03-01', 'Africa/Johannesburg')).toBe('2026-02-28T22:00:00.000Z');
    expect(invoicesFromInstant('2026-03-01', 'UTC')).toBe('2026-03-01T00:00:00.000Z');
  });
});

describe('evaluateInvoice (mirror rows, as the job and the page use it)', () => {
  it('reads numeric strings from the mirror and applies the rules', () => {
    expect(evaluateInvoice(row({}), [], units(), PARTS)).toMatchObject({ kind: 'apply', status: 'reserved', unitId: 'u1' });
    expect(evaluateInvoice(row({ status: 'PAID', amount_due: '0.00' }), [], units(), PARTS)).toMatchObject({ kind: 'apply', status: 'sold' });
    expect(evaluateInvoice(row({ amount_credited: '10.00' }), [], units(), PARTS)).toMatchObject({ kind: 'exception', reason: 'credited' });
  });

  it('a model line makes a VIN-less invoice a stock invoice (exception); without one it is ignored', () => {
    expect(evaluateInvoice(row({ reference: 'Parts order' }), ['3000D-RED'], units(), PARTS)).toMatchObject({ kind: 'exception', reason: 'vin_not_found' });
    expect(evaluateInvoice(row({ reference: 'Parts order' }), ['HOSE-1', null], units(), PARTS)).toEqual({ kind: 'ignore', reason: 'not_stock' });
  });

  it('item codes are grouped per invoice, [] when none', () => {
    const m = itemCodesByInvoice([ID(1), ID(2)], [{ invoice_id: ID(1), item_code: '3000D' }, { invoice_id: ID(1), item_code: null }, { invoice_id: ID(3), item_code: 'X' }]);
    expect(m.get(ID(1))).toEqual(['3000D', null]);
    expect(m.get(ID(2))).toEqual([]);
    expect(m.has(ID(3))).toBe(false);
  });

  it('counts outcomes', () => {
    const c = emptyCounts();
    for (const r of [row({}), row({ status: 'PAID', amount_due: 0 }), row({ status: 'VOIDED' }), row({ status: 'DRAFT' }), row({ invoice_number: 'INV-0002', reference: 'TESTVIN00000000002' })]) {
      countOutcome(c, evaluateInvoice(r, [], units(), PARTS));
    }
    expect(c).toEqual({ ignored: 1, noop: 1, reserve: 1, sell: 1, exceptions: 1 });
  });

  it('a live result updates the in-memory unit so a later invoice in the batch sees it', () => {
    const us = units();
    applyRpcResult(us, { result: 'reserved', unit_id: 'u1', invoice_number: 'INV-0001' });
    expect(us[0]).toMatchObject({ status: 'reserved', invoice_number: 'INV-0001' });
    expect(evaluateInvoice(row({}), [], us, PARTS)).toMatchObject({ kind: 'noop' });
    // The same VIN on a second invoice is now a conflict.
    expect(evaluateInvoice(row({ invoice_id: ID(2), invoice_number: 'INV-0099' }), [], us, PARTS)).toMatchObject({ kind: 'exception', reason: 'unit_linked_other_invoice' });
    applyRpcResult(us, { result: 'exception', unit_id: 'u2' });
    applyRpcResult(us, null);
    expect(us[1]).toMatchObject({ status: 'reserved', invoice_number: 'INV-0002' });
  });
});

describe('outcomeView', () => {
  const apply = { kind: 'apply', status: 'sold', from: 'reserved', unitId: 'u', vin: 'V' } as const;
  const exc = { kind: 'exception', reason: 'voided', unitId: null, vin: null } as const;
  it('labels by mode', () => {
    expect(outcomeView(apply, 'live')).toEqual({ label: 'Queued: mark sold', tone: 'yellow' });
    expect(outcomeView(apply, 'preview')).toEqual({ label: 'Preview: would mark sold', tone: 'teal' });
    expect(outcomeView(apply, 'off')).toEqual({ label: 'Rules off: would mark sold', tone: 'gray' });
    expect(outcomeView(exc, 'live')).toEqual({ label: 'Queued: exception, Invoice voided', tone: 'yellow' });
    expect(outcomeView(exc, 'preview').label).toBe('Preview: exception, Invoice voided');
    expect(outcomeView(exc, 'off').label).toBe('Rules off: exception, Invoice voided');
    // Recorded exceptions show their queue state in any mode.
    expect(outcomeView(exc, 'preview', 'open')).toEqual({ label: 'Exception: Invoice voided', tone: 'red' });
    expect(outcomeView(exc, 'live', 'resolved')).toEqual({ label: 'Resolved: Invoice voided', tone: 'gray' });
    expect(outcomeView({ kind: 'ignore', reason: 'draft' }, 'live')).toEqual({ label: 'Not a stock invoice', tone: 'gray' });
    expect(outcomeView({ kind: 'noop', status: 'reserved', unitId: 'u', vin: 'V' }, 'preview')).toEqual({ label: 'Applied: Reserved', tone: 'green' });
  });

  it('Xero status words', () => {
    expect(xeroStatusLabel('AUTHORISED', '50', '100')).toBe('Partly paid');
    expect(xeroStatusLabel('AUTHORISED', '100', '100')).toBe('Authorised');
    expect(xeroStatusLabel('PAID', 0, 100)).toBe('Paid');
    expect(xeroStatusLabel(null, null)).toBe('—');
  });
});

describe('job payloads', () => {
  it('exception keys pair the Xero invoice id with the reason', () => {
    expect(exceptionKey(ID(1), 'voided')).toBe(`${ID(1)}|voided`);
  });

  it('keeps uuids only, once', () => {
    expect(cleanInvoiceIds([ID(1), ID(1), 'x', 3, null, ID(2)])).toEqual([ID(1), ID(2)]);
  });

  it('merges ids into a pending ids payload up to the cap', () => {
    expect(mergeInvoiceIds({ kind: 'ids', invoice_ids: [ID(1)], rev: 2 }, [ID(1), ID(2)])).toEqual([ID(1), ID(2)]);
    expect(mergeInvoiceIds({ kind: 'sweep' }, [ID(1)])).toBeNull();
    expect(mergeInvoiceIds(null, [ID(1)])).toBeNull();
    const full = Array.from({ length: MAX_IDS_PER_JOB }, (_, i) => ID(i + 10));
    expect(mergeInvoiceIds({ kind: 'ids', invoice_ids: full }, [ID(1)])).toBeNull();
    expect(mergeInvoiceIds({ kind: 'ids', invoice_ids: full }, [ID(10)])).toHaveLength(MAX_IDS_PER_JOB);
  });
});

describe('manual apply copy (plan 7.5)', () => {
  it('uses the plan toasts and says when nothing changed', () => {
    expect(manualResultMessage({ result: 'sold' })).toBe('Fully paid: unit marked Sold.');
    expect(manualResultMessage({ result: 'reserved' })).toBe('Unpaid: unit reserved.');
    expect(manualResultMessage({ result: 'noop', status: 'reserved', invoice_number: 'inv-1' })).toBe('No change: the unit is already Reserved on INV-1.');
    expect(manualResultMessage(null)).toBe('No stock record has been changed.');
  });
});
