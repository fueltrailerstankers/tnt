import { describe, expect, it } from 'vitest';
import {
  fileSize, invoiceStatusLabel, isOverdue, mirrorHref, parseMirrorQuery, quantity, sastToday, statusLabel, taxLabel, xeroLink,
} from '@/lib/admin/mirror';
import { parseFxRate } from '@/lib/deal-view/fx';
import { approxUsd } from '@/lib/money/fx';

const GUID = '6f1c3c0e-2b1a-4c9e-9d7a-0a1b2c3d4e5f';

describe('mirror list URL state', () => {
  it('parses and validates search params (Zod), falling back to defaults', () => {
    expect(parseMirrorQuery('quotes', {})).toEqual({ q: null, status: null, type: 'ACCREC', page: 1, id: null });
    expect(parseMirrorQuery('quotes', { q: 'QU-10482', status: 'SENT', page: '3', id: GUID })).toEqual({ q: 'QU-10482', status: 'SENT', type: 'ACCREC', page: 3, id: GUID });
    // Unknown status, bad page, malformed id, arrays.
    expect(parseMirrorQuery('quotes', { status: 'PAID', page: '-2', id: '../x', q: ['INV-1', 'x'] })).toEqual({ q: 'INV-1', status: null, type: 'ACCREC', page: 1, id: null });
    // Overdue is an invoice filter only.
    expect(parseMirrorQuery('quotes', { status: 'OVERDUE' }).status).toBeNull();
    expect(parseMirrorQuery('invoices', { status: 'OVERDUE', type: 'ACCPAY' })).toMatchObject({ status: 'OVERDUE', type: 'ACCPAY' });
    expect(parseMirrorQuery('invoices', { type: 'NOPE' }).type).toBe('ACCREC');
  });

  it('strips characters that would break a PostgREST or() filter from q', () => {
    expect(parseMirrorQuery('invoices', { q: 'INV-1),status.eq.PAID' }).q).not.toMatch(/[,()*%"'\\:]/);
    expect(parseMirrorQuery('invoices', { q: 'a,b(c)*d' }).q).not.toMatch(/[,()*]/);
  });

  it('builds short links: defaults left out, id for the drawer', () => {
    const s = parseMirrorQuery('invoices', { q: 'INV-20931', status: 'PAID' });
    expect(mirrorHref('invoices', s)).toBe('/admin/xero/invoices?q=INV-20931&status=PAID');
    expect(mirrorHref('invoices', s, { id: GUID })).toBe(`/admin/xero/invoices?q=INV-20931&status=PAID&id=${GUID}`);
    expect(mirrorHref('invoices', s, { type: 'ACCPAY', page: 2 })).toBe('/admin/xero/invoices?q=INV-20931&status=PAID&type=ACCPAY&page=2');
    expect(mirrorHref('quotes', parseMirrorQuery('quotes', {}))).toBe('/admin/xero/quotes');
    // The shell search's ?q= keeps working.
    expect(mirrorHref('quotes', parseMirrorQuery('quotes', { q: 'QU-10482' }))).toBe('/admin/xero/quotes?q=QU-10482');
  });
});

describe('mirror status labels', () => {
  it('title-cases Xero statuses', () => {
    expect(statusLabel('AUTHORISED')).toBe('Authorised');
    expect(statusLabel('INVOICED')).toBe('Invoiced');
    expect(statusLabel(null)).toBe('Unknown');
  });

  it('derives Overdue from authorised, unpaid and past the SAST due date', () => {
    const today = '2026-10-31';
    expect(isOverdue({ status: 'AUTHORISED', due_date: '2026-10-30', amount_due: '64500.00' }, today)).toBe(true);
    expect(invoiceStatusLabel({ status: 'AUTHORISED', due_date: '2026-10-30', amount_due: 64500 }, today)).toBe('Overdue');
    expect(invoiceStatusLabel({ status: 'AUTHORISED', due_date: '2026-10-31', amount_due: 64500 }, today)).toBe('Authorised');
    expect(invoiceStatusLabel({ status: 'AUTHORISED', due_date: '2026-10-01', amount_due: 0 }, today)).toBe('Authorised');
    expect(invoiceStatusLabel({ status: 'PAID', due_date: '2026-10-01', amount_due: 0 }, today)).toBe('Paid');
    expect(invoiceStatusLabel({ status: 'AUTHORISED', due_date: null, amount_due: 5 }, today)).toBe('Authorised');
  });

  it('today is the Johannesburg calendar day', () => {
    expect(sastToday('2026-10-30T21:59:00Z')).toBe('2026-10-30');
    expect(sastToday('2026-10-30T22:00:00Z')).toBe('2026-10-31');
  });
});

describe('totals and links', () => {
  it('labels the tax line VAT 15% only when it is 15% of the subtotal', () => {
    expect(taxLabel('423260.87', '63489.13')).toBe('VAT 15%');
    expect(taxLabel(1000, 150)).toBe('VAT 15%');
    expect(taxLabel(1000, 0)).toBe('VAT');
    expect(taxLabel(1000, 140)).toBe('VAT');
    expect(taxLabel(null, 10)).toBe('VAT');
  });

  it('links to Xero only for a GUID; bills and sales use their own pages', () => {
    expect(xeroLink('invoice', GUID, 'ACCREC')).toBe(`https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${GUID}`);
    expect(xeroLink('invoice', GUID, 'ACCPAY')).toBe(`https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=${GUID}`);
    expect(xeroLink('quote', GUID)).toMatch(/^https:\/\/go\.xero\.com\//);
    expect(xeroLink('quote', 'e2e-qp-1')).toBeNull();
    expect(xeroLink('invoice', 'javascript:alert(1)')).toBeNull();
    expect(xeroLink('invoice', null)).toBeNull();
  });

  it('formats sizes and quantities', () => {
    expect(fileSize(512)).toBe('512 B');
    expect(fileSize('2048')).toBe('2.0 KB');
    expect(fileSize(null)).toBe('');
    expect(fileSize(-1)).toBe('');
    expect(quantity('1.0000')).toBe('1');
    expect(quantity(2.5)).toBe('2.5');
  });
});

describe("FX setting 'fx.zar_usd'", () => {
  it('accepts only a positive decimal string', () => {
    expect(parseFxRate('0.0543')).toBe(0.0543);
    expect(parseFxRate(' 0.05 ')).toBe(0.05);
    expect(parseFxRate('1')).toBe(1);
    for (const bad of [undefined, null, 0.05, '0', '0.000', '-0.05', '5e-2', 'abc', '', '0.05 USD', '.05', 'Infinity', {}, ['0.05']]) {
      expect(parseFxRate(bad), String(bad)).toBeNull();
    }
  });

  it('feeds approxUsd: no rate, no USD line', () => {
    expect(approxUsd(486750, 'ZAR', parseFxRate('0.05434'))).toBe(26450.0);
    expect(approxUsd(486750, 'ZAR', parseFxRate(undefined))).toBeNull();
  });
});
