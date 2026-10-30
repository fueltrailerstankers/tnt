import { describe, expect, it } from 'vitest';
import { invoiceOutcome, isModelItemCode, matchUnit, normalizeInvoiceNumber, rpcOutcome, type InvoiceFacts, type UnitFacts } from '@/lib/stock/invoice';
import { partKey, STOCK_MODELS } from '@/lib/stock/models';

// Synthetic invoices and VINs only.
const PARTS = STOCK_MODELS.map((m) => m.partNumber);
const UNITS: UnitFacts[] = [
  { id: 'u1', vin_norm: 'TESTVIN00000000001', status: 'available', invoice_number: null },
  { id: 'u2', vin_norm: 'TESTVIN00000000002', status: 'reserved', invoice_number: 'INV-0002' },
  { id: 'u3', vin_norm: 'TESTVIN00000000003', status: 'sold', invoice_number: 'INV-0003' },
];
const inv = (o: Partial<InvoiceFacts>): InvoiceFacts => ({
  invoice_id: 'x1', invoice_number: 'INV-0001', invoice_type: 'ACCREC', status: 'AUTHORISED', amount_due: 1000, amount_credited: 0,
  reference: 'TESTVIN00000000001', item_codes: [], ...o,
});
const outcome = (o: Partial<InvoiceFacts>) => {
  const i = inv(o);
  return invoiceOutcome(i, matchUnit(i, UNITS), PARTS);
};

describe('invoiceOutcome: payment rules', () => {
  it('unpaid (AUTHORISED or SUBMITTED, amount due > 0) reserves the unit', () => {
    expect(outcome({})).toEqual({ kind: 'apply', status: 'reserved', from: 'available', unitId: 'u1', vin: 'TESTVIN00000000001' });
    expect(outcome({ status: 'SUBMITTED' })).toMatchObject({ kind: 'apply', status: 'reserved' });
  });

  it('partly paid stays reserved', () => {
    expect(outcome({ amount_due: 1 })).toMatchObject({ kind: 'apply', status: 'reserved' });
  });

  it('fully paid (PAID, nothing due) sells the unit', () => {
    expect(outcome({ status: 'PAID', amount_due: 0 })).toEqual({ kind: 'apply', status: 'sold', from: 'available', unitId: 'u1', vin: 'TESTVIN00000000001' });
  });

  it('a reserved unit becomes sold when its invoice is paid', () => {
    expect(outcome({ invoice_number: 'inv-0002', reference: 'TESTVIN00000000002', status: 'PAID', amount_due: 0 }))
      .toMatchObject({ kind: 'apply', status: 'sold', from: 'reserved', unitId: 'u2' });
  });

  it('the same state twice is a no-op', () => {
    expect(outcome({ invoice_number: 'INV-0002', reference: 'TESTVIN00000000002' })).toEqual({ kind: 'noop', status: 'reserved', unitId: 'u2', vin: 'TESTVIN00000000002' });
    expect(outcome({ invoice_number: 'INV-0003', reference: 'TESTVIN00000000003', status: 'PAID', amount_due: 0 })).toMatchObject({ kind: 'noop', status: 'sold' });
  });

  it('matches a VIN contained in a longer reference', () => {
    expect(outcome({ reference: 'Trailer testvin 00000000001 deposit' })).toMatchObject({ kind: 'apply', unitId: 'u1' });
  });
});

describe('invoiceOutcome: ignored', () => {
  it('ignores drafts', () => {
    expect(outcome({ status: 'DRAFT' })).toEqual({ kind: 'ignore', reason: 'draft' });
  });
  it('ignores bills and supplier credits', () => {
    expect(outcome({ invoice_type: 'ACCPAY' })).toEqual({ kind: 'ignore', reason: 'not_sales' });
    expect(outcome({ invoice_type: 'ACCPAYCREDIT' })).toEqual({ kind: 'ignore', reason: 'not_sales' });
  });
  it('ignores sales invoices that are not about a unit (no known VIN, no model line)', () => {
    expect(outcome({ reference: 'PO 7788' })).toEqual({ kind: 'ignore', reason: 'not_stock' });
    expect(outcome({ reference: null, item_codes: ['SPARE-WHEEL'] })).toEqual({ kind: 'ignore', reason: 'not_stock' });
    expect(outcome({ reference: null, item_codes: ['5000DX', '3000-D', null, ''] })).toEqual({ kind: 'ignore', reason: 'not_stock' });
  });
  it('KNOWN LIMIT (docs/M6.md section 3): no known VIN and no model item code is ignored, not an exception', () => {
    expect(outcome({ reference: '', item_codes: [] })).toEqual({ kind: 'ignore', reason: 'not_stock' });
    expect(outcome({ reference: 'TESTVIN0000000000l', item_codes: [null] })).toEqual({ kind: 'ignore', reason: 'not_stock' });
  });
});

describe('invoiceOutcome: exceptions change nothing', () => {
  const reason = (o: Partial<InvoiceFacts>) => {
    const r = outcome(o);
    return r.kind === 'exception' ? r.reason : r.kind;
  };

  it('voided, deleted, credit notes, credited invoices and unknown statuses', () => {
    expect(reason({ status: 'VOIDED' })).toBe('voided');
    expect(reason({ status: 'DELETED' })).toBe('deleted');
    expect(reason({ invoice_type: 'ACCRECCREDIT', status: 'AUTHORISED' })).toBe('credit_note');
    expect(reason({ status: 'PAID', amount_due: 0, amount_credited: 500 })).toBe('credited');
    expect(reason({ status: 'WEIRD' })).toBe('unknown_status');
    expect(reason({ status: null })).toBe('unknown_status');
  });

  it('keeps the matched unit on the exception for context', () => {
    expect(outcome({ status: 'VOIDED' })).toEqual({ kind: 'exception', reason: 'voided', unitId: 'u1', vin: 'TESTVIN00000000001' });
  });

  it('unpaid with nothing due, and a missing invoice number', () => {
    expect(reason({ amount_due: 0 })).toBe('unexpected_amount');
    expect(reason({ amount_due: null })).toBe('unexpected_amount');
    expect(reason({ invoice_number: '  ' })).toBe('missing_invoice_number');
  });

  it('missing, unknown and ambiguous VINs on a stock invoice (a model line marks it as one)', () => {
    expect(reason({ reference: '', item_codes: ['3000d'] })).toBe('missing_vin');
    expect(reason({ reference: 'NOPE', item_codes: [null, '3000D'] })).toBe('vin_not_found');
    expect(reason({ reference: 'TESTVIN00000000001 and TESTVIN00000000002' })).toBe('vin_ambiguous');
  });

  it('a unit invoice with an empty reference or a mistyped VIN is an exception when a line carries a model code with a suffix', () => {
    expect(outcome({ reference: '', item_codes: ['CTLL1-GWM'] })).toEqual({ kind: 'exception', reason: 'missing_vin', unitId: null, vin: null });
    expect(reason({ reference: null, status: 'PAID', amount_due: 0, item_codes: ['SERVICE', 'ctll1 gwm'] })).toBe('missing_vin');
    expect(reason({ reference: 'TESTVIN0000000000l', item_codes: ['3000D/RED'] })).toBe('vin_not_found');
  });

  it('conflicts: invoice on another unit, unit on another invoice, a sold unit invoiced as unpaid', () => {
    expect(reason({ invoice_number: 'INV-0002' })).toBe('invoice_linked_other_unit');
    expect(reason({ invoice_number: 'INV-0099', reference: 'TESTVIN00000000002' })).toBe('unit_linked_other_invoice');
    expect(reason({ invoice_number: 'INV-0003', reference: 'TESTVIN00000000003', status: 'AUTHORISED', amount_due: 10 })).toBe('unit_sold');
  });
});

describe('helpers', () => {
  it('isModelItemCode: the part number, or the part number and a suffix after a separator', () => {
    const parts = new Set(PARTS.map(partKey));
    for (const c of ['3000D', ' ctll 1 ', 'CTLL1-GWM', '3000D/RED', 'BOX02 ISO', '1000DB_X', 'CT1.2', 'TS25:A']) expect(isModelItemCode(c, parts), c).toBe(true);
    for (const c of [null, undefined, '', ' ', 'SPARE-WHEEL', '5000DX', '-3000D', 'XCTLL1']) expect(isModelItemCode(c, parts), String(c)).toBe(false);
  });

  it('normalises invoice numbers', () => {
    expect(normalizeInvoiceNumber(' inv-0042 ')).toBe('INV-0042');
    expect(normalizeInvoiceNumber('')).toBeNull();
    expect(normalizeInvoiceNumber(null)).toBeNull();
  });

  it('matchUnit finds the referenced unit and any other holder of the invoice number', () => {
    const m = matchUnit({ reference: 'TESTVIN00000000001', invoice_number: 'inv-0002' }, UNITS);
    expect(m.unit?.id).toBe('u1');
    expect(m.holder?.id).toBe('u2');
    expect(matchUnit({ reference: 'TESTVIN00000000002', invoice_number: 'INV-0002' }, UNITS).holder).toBeNull();
  });

  it('rpcOutcome gives the stock_apply_invoice argument', () => {
    expect(rpcOutcome({ kind: 'apply', status: 'sold', from: 'reserved', unitId: 'u', vin: 'v' })).toBe('sold');
    expect(rpcOutcome({ kind: 'exception', reason: 'voided', unitId: null, vin: null })).toBe('exception:voided');
    expect(rpcOutcome({ kind: 'noop', status: 'sold', unitId: 'u', vin: 'v' })).toBeNull();
    expect(rpcOutcome({ kind: 'ignore', reason: 'draft' })).toBeNull();
  });
});
