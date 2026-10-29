import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { invoiceNoOf, mapInvoice, mapPayment, mapQuote, maxUpdated, normaliseVin, quoteNoOf, xeroDate, xeroTimestamp } from '@/lib/integrations/xero/mappers';
import { backfillPasses, incrementalPass, isLastPage, pageParams, readRateHeaders, retryDelayMs, shouldPause } from '@/lib/integrations/xero/plan';
import { entityFor, eventKey, Payload, verifySignature } from '@/lib/integrations/xero/webhook';

describe('dates', () => {
  it('parses .NET JSON dates and ISO strings as UTC', () => {
    expect(xeroTimestamp('/Date(1761696000000+0000)/')).toBe('2025-10-29T00:00:00.000Z');
    expect(xeroTimestamp('2025-10-29T08:15:00')).toBe('2025-10-29T08:15:00.000Z');
    expect(xeroDate('2025-10-29T00:00:00')).toBe('2025-10-29');
    expect(xeroTimestamp('nonsense')).toBeNull();
    expect(xeroTimestamp(undefined)).toBeNull();
  });
});

describe('numbers', () => {
  it('quote, invoice and VIN normalisation', () => {
    expect(quoteNoOf('QU-12345')).toBe('12345');
    expect(quoteNoOf(' qu12345 ')).toBe('12345');
    expect(quoteNoOf('12345')).toBe('12345');
    expect(invoiceNoOf('INV-001234')).toBe('001234');
    expect(invoiceNoOf('001234')).toBe('001234');
    expect(normaliseVin(' testvin 0001 ')).toBe('TESTVIN0001');
    expect(normaliseVin('12')).toBeNull();
  });
});

const QUOTE = {
  QuoteID: 'q-1', QuoteNumber: 'QU-90001', Reference: 'Synthetic', Status: 'SENT', CurrencyCode: 'ZAR',
  Contact: { ContactID: 'c-1', Name: 'Test Customer (Pty) Ltd' },
  DateString: '2025-10-01T00:00:00', ExpiryDateString: '2025-10-31T00:00:00',
  SubTotal: 1000, TotalTax: 150, Total: 1150, UpdatedDateUTC: '/Date(1761696000000+0000)/',
  LineItems: [{ LineItemID: 'l-1', ItemCode: '1000DB', Description: '1000 litre metal bowser', Quantity: 1, UnitAmount: 1000, LineAmount: 1000, TaxAmount: 150 }],
};

describe('mappers', () => {
  it('quote with lines keeps its currency and the typed quote no', () => {
    const m = mapQuote(QUOTE);
    expect(m.row).toMatchObject({ quote_id: 'q-1', quote_number: 'QU-90001', quote_no: '90001', currency_code: 'ZAR', total: 1150, contact_name: 'Test Customer (Pty) Ltd', quote_date: '2025-10-01' });
    expect(m.lines).toEqual([{ line_no: 1, line_item_id: 'l-1', item_code: '1000DB', description: '1000 litre metal bowser', quantity: 1, unit_amount: 1000, line_amount: 1000, tax_amount: 150, currency_code: 'ZAR' }]);
  });

  it('invoice amounts, paid date and attachments flag', () => {
    const m = mapInvoice({ InvoiceID: 'i-1', InvoiceNumber: 'INV-0001', Type: 'ACCREC', Reference: '90001', Status: 'PAID', CurrencyCode: 'ZAR',
      Total: 1150.005, AmountDue: 0, AmountPaid: 1150, FullyPaidOnDate: '/Date(1761782400000+0000)/', HasAttachments: true, LineItems: [] });
    expect(m.row).toMatchObject({ invoice_number: 'INV-0001', total: 1150.01, amount_due: 0, fully_paid_on: '2025-10-30', has_attachments: true, currency_code: 'ZAR' });
  });

  it('payment takes its invoice currency', () => {
    expect(mapPayment({ PaymentID: 'p-1', Amount: 500, Date: '/Date(1761782400000+0000)/', Invoice: { InvoiceID: 'i-1', InvoiceNumber: 'INV-0001', CurrencyCode: 'ZAR' } }))
      .toMatchObject({ payment_id: 'p-1', invoice_id: 'i-1', amount: 500, currency_code: 'ZAR', payment_date: '2025-10-30' });
  });

  it('high-water mark', () => {
    expect(maxUpdated([{ updated_utc: '2025-01-02T00:00:00.000Z' }, { updated_utc: null }], '2025-01-01T00:00:00.000Z')).toBe('2025-01-02T00:00:00.000Z');
  });
});

describe('sync plan', () => {
  it('backfill covers everything since the start plus open documents', () => {
    expect(backfillPasses('invoices', '2025-01-01')).toEqual([
      { path: '/Invoices', params: {}, modifiedSince: '2025-01-01T00:00:00Z' },
      { path: '/Invoices', params: { Statuses: 'DRAFT,SUBMITTED,AUTHORISED' }, modifiedSince: null },
    ]);
    expect(backfillPasses('quotes', '2025-01-01').map((p) => p.params.Status ?? 'all')).toEqual(['all', 'DRAFT', 'SENT', 'ACCEPTED']);
    expect(incrementalPass('payments', '2025-06-01T10:00:00.000Z', '2025-01-01').modifiedSince).toBe('2025-06-01T09:59:00.000Z');
  });

  it('paging and rate limits', () => {
    expect(pageParams('quotes', 2)).toEqual({ page: '2' });
    expect(pageParams('invoices', 1)).toMatchObject({ page: '1', pageSize: '200' });
    expect(isLastPage('quotes', 99)).toBe(true);
    expect(isLastPage('quotes', 100)).toBe(false);
    const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
    expect(readRateHeaders(h({ 'x-minlimit-remaining': '40', 'x-appminlimit-remaining': '9000', 'x-daylimit-remaining': '4000' }))).toEqual({ minRemaining: 40, dayRemaining: 4000 });
    expect(shouldPause({ minRemaining: 3, dayRemaining: 4000 })).toBe(true);
    expect(shouldPause({ minRemaining: 50, dayRemaining: 200 })).toBe(true);
    expect(shouldPause({ minRemaining: null, dayRemaining: null })).toBe(false);
    expect(retryDelayMs('7', 0)).toBe(7000);
    expect(retryDelayMs(null, 2, () => 0)).toBe(4000);
  });
});

describe('webhook', () => {
  const key = 'synthetic-webhook-key';
  const body = JSON.stringify({ events: [{ resourceId: 'i-1', eventDateUtc: '2025-10-29T08:00:00.000', eventType: 'UPDATE', eventCategory: 'INVOICE', tenantId: 't-1' }], firstEventSequence: 1, lastEventSequence: 1, entropy: 'x' });
  const sig = createHmac('sha256', key).update(body).digest('base64');

  it('accepts the right signature only', () => {
    expect(verifySignature(body, sig, key)).toBe(true);
    expect(verifySignature(body + ' ', sig, key)).toBe(false);
    expect(verifySignature(body, sig, 'other')).toBe(false);
    expect(verifySignature(body, null, key)).toBe(false);
    expect(verifySignature(body, 'not-base64!!', key)).toBe(false);
  });

  it('event keys are stable for replays and map to entities', () => {
    const e = Payload.parse(JSON.parse(body)).events[0];
    expect(eventKey(e)).toBe(eventKey({ ...e }));
    expect(eventKey(e)).not.toBe(eventKey({ ...e, eventType: 'CREATE' }));
    expect(entityFor(e)).toBe('invoices');
    expect(entityFor({ ...e, eventCategory: 'CONTACT' })).toBe('contacts');
    expect(entityFor({ ...e, eventCategory: 'SUBSCRIPTION' })).toBeNull();
  });
});

import { monthBounds, summarise } from '@/lib/integrations/xero/month';
describe('month check', () => {
  it('bounds', () => {
    expect(monthBounds('2025-02')).toEqual({ first: '2025-02-01', next: '2025-03-01', last: '2025-02-28' });
    expect(monthBounds('2025-12')).toEqual({ first: '2025-12-01', next: '2026-01-01', last: '2025-12-31' });
    expect(() => monthBounds('2025-13')).toThrow();
  });
  it('matches per currency to the cent', () => {
    expect(summarise('Invoices', [{ amount: 10.1, currency: 'ZAR' }, { amount: '0.2', currency: 'ZAR' }], [{ amount: 10.3, currency: 'ZAR' }, { amount: 0, currency: 'ZAR' }]))
      .toEqual([{ entity: 'Invoices', currency: 'ZAR', xeroCount: 2, mirrorCount: 2, xeroTotal: 10.3, mirrorTotal: 10.3, match: true }]);
    expect(summarise('Payments', [{ amount: 1, currency: 'ZAR' }], [])[0].match).toBe(false);
  });
});
