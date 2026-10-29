import { describe, expect, it } from 'vitest';
import { linkDealFiles, type EntryIn } from '@/lib/deal-files/link';

const e = (id: string, form: string, number: number, data: Record<string, unknown>, status = 'Submitted'): EntryIn => ({ id, form, number, status, data });

describe('deal file linking', () => {
  it('links quote, invoices, VIN and all six forms for one trailer', () => {
    const files = linkDealFiles(
      [{ quote_id: 'q1', quote_no: '90001', contact_name: 'Test Customer', status: 'INVOICED' }],
      [
        { invoice_id: 'i1', invoice_number: 'INV-0001', reference: '90001', contact_name: 'Test Customer', invoice_type: 'ACCREC', status: 'PAID' },
        { invoice_id: 'i2', invoice_number: 'INV-0002', reference: 'TESTVIN0000000001', contact_name: 'Test Customer', invoice_type: 'ACCREC', status: 'AUTHORISED' },
        { invoice_id: 'b1', invoice_number: 'BILL-1', reference: '90001', contact_name: 'Supplier', invoice_type: 'ACCPAY', status: 'PAID' },
      ],
      [
        e('d1', 'deal', 5, { QUOTENO: 'QU-90001', COLLECTIONLOCATION: ['CPT'], SALESREP: 'MELINDA' }),
        e('r1', 'request-for-invoice', 7, { QuoteNo: '90001', Name: { First: 'Test', Last: 'Customer' } }),
        e('j1', 'job-card', 2, { QuoteNo: '90001' }),
        e('rel', 'release-form', 9, { VINNO: 'TESTVIN0000000001', INVNO: '0001' }),
        e('dn', 'delivery-note', 3, { TrailerVinNO: 'testvin 0000000001', QuoteNo: 'r1', INVOICENO: '0001' }),
        e('ins', 'trailer-inspection-checklist', 4, { TRAILERVINNUMBER: 'TESTVIN0000000001' }),
      ],
    );
    expect(files).toEqual([{
      quote_no: '90001', quote_id: 'q1', invoice_ids: ['i1', 'i2'], invoice_numbers: ['INV-0001', 'INV-0002'],
      vin: 'TESTVIN0000000001', customer_name: 'Test Customer', branch: 'CPT', rep: 'MELINDA',
      deal_entry_id: 'd1', rfi_entry_id: 'r1', job_card_entry_id: 'j1', inspection_entry_id: 'ins', release_entry_id: 'rel', delivery_entry_id: 'dn',
    }]);
  });

  it('newest entry wins; incomplete entries and deleted quotes are ignored; form-only deals still get a file', () => {
    const files = linkDealFiles(
      [{ quote_id: 'q9', quote_no: '777', contact_name: null, status: 'DELETED' }],
      [],
      [
        e('old', 'request-for-invoice', 1, { QuoteNo: '555' }),
        e('new', 'request-for-invoice', 2, { QuoteNo: 'QU-555' }),
        e('draft', 'job-card', 3, { QuoteNo: '999' }, 'Incomplete'),
      ],
    );
    expect(files.map((f) => [f.quote_no, f.rfi_entry_id, f.quote_id])).toEqual([['555', 'new', null]]);
  });
});
