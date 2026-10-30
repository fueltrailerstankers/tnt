import { describe, expect, it } from 'vitest';
import { creditNoteApplied, mapCreditNote, mapInvoice } from '@/lib/integrations/xero/mappers';
import { ENTITIES, isLastPage, pageParams, QUICK_ENTITIES } from '@/lib/integrations/xero/plan';
import type { UnitFacts } from '@/lib/stock/invoice';
import {
  applyRpcResult, cleanInvoiceIds, countOutcome, exceptionKey, invoicesFromInstant, emptyCounts, evaluateInvoice, itemCodesByInvoice, manualResultMessage, MAX_IDS_PER_JOB,
  mergeInvoiceIds, outcomeView, xeroStatusLabel, type MirrorInvoiceRow, creditNoteOutcome, mayMergeInto, mergeIdsPayload, mustWait,
  otherInvoicesNamingVin, recordedState, type MirrorCreditNoteRow,
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
  invoice_id: ID(1), invoice_number: 'INV-0001', invoice_type: 'ACCREC', status: 'AUTHORISED', amount_due: '1000.00', credit_note_applied: '0.00',
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
      .toEqual({ start: '2026-03-01', invoicesFromSetting: null, invoicesFrom: '2026-03-01', rules: 'live' });
    expect(stockSettingsFrom(null)).toEqual({ start: null, invoicesFromSetting: null, invoicesFrom: null, rules: 'preview' });
  });

  it('live needs the typed confirmation and an invoice start date; other modes do not', () => {
    expect(checkRulesSwitch('live', '', '2026-01-01')).toMatch(/Type "live"/);
    expect(checkRulesSwitch('live', 'yes', '2026-01-01')).toMatch(/Type "live"/);
    expect(checkRulesSwitch('live', ' Live ', '2026-01-01')).toBeNull();
    // Item 8: no date = no invoice examined, so live is refused even with the word typed.
    expect(checkRulesSwitch('live', 'live', null)).toMatch(/Set the invoice start date/);
    expect(checkRulesSwitch('preview', null, null)).toBeNull();
    expect(checkRulesSwitch('off', undefined, null)).toBeNull();
  });

  it('stock.invoices_from overrides the stock start date; unset follows it; neither = nothing examined', () => {
    expect(stockSettingsFrom([{ key: 'stock.deals_from', value: '2026-03-01' }])).toMatchObject({ invoicesFrom: '2026-03-01', invoicesFromSetting: null });
    expect(stockSettingsFrom([{ key: 'stock.deals_from', value: '2026-03-01' }, { key: 'stock.invoices_from', value: '2026-06-01' }]))
      .toMatchObject({ start: '2026-03-01', invoicesFrom: '2026-06-01', invoicesFromSetting: '2026-06-01' });
    expect(stockSettingsFrom([{ key: 'stock.invoices_from', value: '2026-06-01' }])).toMatchObject({ start: null, invoicesFrom: '2026-06-01' });
    expect(stockSettingsFrom([])).toMatchObject({ invoicesFrom: null });
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
    expect(evaluateInvoice(row({ credit_note_applied: '10.00' }), [], units(), PARTS)).toMatchObject({ kind: 'exception', reason: 'credited' });
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

describe('M6 review fixes (pure)', () => {
  it('item 1: one stock.invoices job at a time per org: the later claim waits', () => {
    const a = { id: 'a', locked_at: '2026-10-30T10:00:00.000Z' };
    const b = { id: 'b', locked_at: '2026-10-30T10:00:05.000Z' };
    expect(mustWait(b, [a, b])).toBe(true);
    expect(mustWait(a, [a, b])).toBe(false);
    expect(mustWait(a, [a])).toBe(false);
    // Same instant: the smaller id goes first, never both.
    const c = { id: 'c', locked_at: a.locked_at };
    expect([mustWait(a, [a, c]), mustWait(c, [a, c])]).toEqual([false, true]);
  });

  it('item 7: ids merge only into untried pending jobs, both id kinds, capped', () => {
    expect(mayMergeInto({ status: 'pending', attempts: 0 })).toBe(true);
    expect(mayMergeInto({ status: 'pending', attempts: 1 })).toBe(false);
    expect(mayMergeInto({ status: 'running', attempts: 0 })).toBe(false);
    expect(mayMergeInto(null)).toBe(false);
    expect(mergeIdsPayload({ kind: 'ids', invoice_ids: [ID(1)] }, { credit_note_ids: [ID(2)] })).toEqual({ invoice_ids: [ID(1)], credit_note_ids: [ID(2)] });
    expect(mergeIdsPayload({ kind: 'ids', invoice_ids: [ID(1)], credit_note_ids: [ID(2)] }, { invoice_ids: [ID(1), ID(3)] }, 3)).toEqual({ invoice_ids: [ID(1), ID(3)], credit_note_ids: [ID(2)] });
    expect(mergeIdsPayload({ kind: 'ids', invoice_ids: [ID(1)], credit_note_ids: [ID(2)] }, { invoice_ids: [ID(3)] }, 2)).toBeNull();
  });

  it('item 6: another live invoice naming the same VIN is a conflict; drafts, voids, bills and the same number are not', () => {
    const self = row({ invoice_id: ID(1), invoice_number: 'INV-1', reference: 'TESTVIN00000000001' });
    const others = [
      row({ invoice_id: ID(2), invoice_number: 'INV-2', reference: 'Unit testvin00000000001', status: 'PAID' }),
      row({ invoice_id: ID(3), invoice_number: 'INV-3', reference: 'TESTVIN00000000001', status: 'DRAFT' }),
      row({ invoice_id: ID(4), invoice_number: 'INV-4', reference: 'TESTVIN00000000001', status: 'VOIDED' }),
      row({ invoice_id: ID(5), invoice_number: 'INV-5', reference: 'TESTVIN00000000001', invoice_type: 'ACCPAY' }),
      row({ invoice_id: ID(6), invoice_number: 'inv-1', reference: 'TESTVIN00000000001' }),
      self,
    ];
    expect(otherInvoicesNamingVin(self, 'TESTVIN00000000001', others).map((r) => r.invoice_id)).toEqual([ID(2)]);
  });

  it('item 5: a resolved exception hides only the same or an older Xero state', () => {
    const T1 = '2026-05-01T10:00:00Z';
    const T2 = '2026-05-02T10:00:00Z';
    expect(recordedState(undefined, T1)).toBeNull();
    expect(recordedState([{ resolved: false, source_updated_utc: T1 }], T2)).toBe('open');
    expect(recordedState([{ resolved: true, source_updated_utc: T1 }], T1)).toBe('resolved');
    expect(recordedState([{ resolved: true, source_updated_utc: T1 }], T2)).toBeNull();
    expect(recordedState([{ resolved: true, source_updated_utc: null }], T2)).toBeNull();
    expect(recordedState([{ resolved: true, source_updated_utc: T1 }, { resolved: true, source_updated_utc: T2 }], T2)).toBe('resolved');
  });

  it('item 2: sales credit notes naming a unit (directly or via an allocated invoice) are credit_note exceptions', () => {
    const cn = (o: Partial<MirrorCreditNoteRow>): MirrorCreditNoteRow => ({
      credit_note_id: ID(9), credit_note_number: 'CN-1', credit_note_type: 'ACCRECCREDIT', status: 'AUTHORISED', reference: null, invoice_ids: [], updated_utc: null, ...o,
    });
    expect(creditNoteOutcome(cn({ reference: 'Return testvin00000000001' }), [], units())).toEqual({ kind: 'exception', reason: 'credit_note', unitId: 'u1', vin: 'TESTVIN00000000001' });
    // Allocated to the invoice unit u2 holds.
    expect(creditNoteOutcome(cn({}), [{ invoice_number: 'inv-0002', reference: 'whatever' }], units())).toMatchObject({ kind: 'exception', unitId: 'u2' });
    // Allocated to an invoice whose reference names the VIN.
    expect(creditNoteOutcome(cn({}), [{ invoice_number: 'INV-77', reference: 'TESTVIN00000000001' }], units())).toMatchObject({ unitId: 'u1' });
    expect(creditNoteOutcome(cn({ reference: 'Parts refund' }), [{ invoice_number: 'INV-77', reference: 'parts' }], units())).toEqual({ kind: 'ignore', reason: 'not_stock' });
    expect(creditNoteOutcome(cn({ credit_note_type: 'ACCPAYCREDIT', reference: 'TESTVIN00000000001' }), [], units())).toMatchObject({ kind: 'ignore', reason: 'not_sales' });
    expect(creditNoteOutcome(cn({ status: 'DRAFT', reference: 'TESTVIN00000000001' }), [], units())).toMatchObject({ kind: 'ignore', reason: 'status' });
    expect(creditNoteOutcome(cn({ status: 'VOIDED', reference: 'TESTVIN00000000001' }), [], units())).toMatchObject({ kind: 'ignore' });
  });

  it('item 3: only credit notes count as credited (prepayments and overpayments do not)', () => {
    expect(creditNoteApplied({ AmountCredited: 500, CreditNotes: [], Prepayments: [{ AppliedAmount: 500 }] })).toBe(0);
    expect(creditNoteApplied({ CreditNotes: [{ AppliedAmount: 100.1 }, { AppliedAmount: '0.2' }], Overpayments: [{ AppliedAmount: 50 }] })).toBe(100.3);
    expect(creditNoteApplied({})).toBe(0);
    // A prepayment-funded invoice is not "credited": it applies normally.
    const m = mapInvoice({ InvoiceID: 'i-1', Type: 'ACCREC', Status: 'PAID', AmountDue: 0, AmountCredited: 1000, Prepayments: [{ AppliedAmount: 1000 }], LineItems: [] });
    expect(m.row.credit_note_applied).toBe(0);
    expect(evaluateInvoice(row({ status: 'PAID', amount_due: 0, credit_note_applied: m.row.credit_note_applied }), [], units(), PARTS)).toMatchObject({ kind: 'apply', status: 'sold' });
    expect(evaluateInvoice(row({ credit_note_applied: '1.00' }), [], units(), PARTS)).toMatchObject({ kind: 'exception', reason: 'credited' });
  });

  it('item 2: credit notes mirror (read-only GET /CreditNotes, 100 per page)', () => {
    const c = mapCreditNote({ CreditNoteID: 'cn-1', CreditNoteNumber: 'CN-0001', Type: 'ACCRECCREDIT', Status: 'AUTHORISED', Reference: 'R', Total: 10.005,
      Allocations: [{ Invoice: { InvoiceID: 'i-1' } }, { Invoice: { InvoiceID: 'i-1' } }, { Amount: 1 }], UpdatedDateUTC: '/Date(1761782400000+0000)/' });
    expect(c).toMatchObject({ credit_note_id: 'cn-1', credit_note_number: 'CN-0001', credit_note_type: 'ACCRECCREDIT', total: 10.01, invoice_ids: ['i-1'], updated_utc: '2025-10-30T00:00:00.000Z' });
    expect(pageParams('credit_notes', 2)).toEqual({ page: '2' });
    expect(isLastPage('credit_notes', 99)).toBe(true);
    expect(QUICK_ENTITIES).toContain('credit_notes');
    expect(ENTITIES).toContain('credit_notes');
  });
});
