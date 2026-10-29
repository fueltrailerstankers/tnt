// M3 planners, modes, redaction and triggers. Synthetic data only: no real people, emails or documents.
import { describe, expect, it } from 'vitest';
import { checkSwitch, dryRunDoesNothing, hasWriteScopes, NO_XERO_WRITES_NOTE, parseMode, resolveMode, WRITE_SCOPES } from '@/lib/integrations/xero/write/modes';
import { planDealImport } from '@/lib/integrations/xero/write/plan-deal';
import { planDeliveryInvoice } from '@/lib/integrations/xero/write/plan-delivery';
import { mergedNameOf, planMerge } from '@/lib/integrations/xero/write/plan-merge';
import { isFullyPaid, planRelease } from '@/lib/integrations/xero/write/plan-release';
import { planRfiInvoice, type RfiInput } from '@/lib/integrations/xero/write/plan-rfi';
import { REDACTED, REDACTED_FILE, redactEffect, redactError, redactRequest } from '@/lib/integrations/xero/write/redact';
import { actionsForSave, paidTransitions } from '@/lib/integrations/xero/write/triggers';
import { fillPlaceholders, pick, type ContactIn, type FileIn, type InvoiceIn, type QuoteIn } from '@/lib/integrations/xero/write/types';

const T = '2026-10-01T08:00:00.000Z';
const entry = (id: string, data: Record<string, unknown>, number = 7) => ({ id, number, status: 'Submitted', updatedAt: T, data });
const file = (id: string, fieldKey: string, sortOrder = 1): FileIn => ({ id, fieldKey, kind: 'file', fileName: `${fieldKey}-scan.pdf`, contentType: 'application/pdf', sizeBytes: 1000, sortOrder });

const quote = (over: Partial<QuoteIn> = {}): QuoteIn => ({
  quote_id: 'q-1', quote_number: 'QU-90001', status: 'SENT', contact_id: 'c-quote', quote_date: '2026-09-01', currency_code: 'ZAR', total: 115000,
  raw: {
    LineAmountTypes: 'Exclusive',
    LineItems: [
      { Description: 'Synthetic tanker 5000L', Quantity: 1, UnitAmount: 90000, ItemCode: 'TNK-5000', AccountCode: '200', TaxType: 'OUTPUT', LineItemID: 'li-1' },
      { Description: 'Synthetic pump kit', Quantity: 2, UnitAmount: 5000, ItemCode: 'PMP-1', AccountCode: '200', TaxType: 'OUTPUT', LineItemID: 'li-2' },
    ],
  },
  ...over,
});
const contact = (id: string, over: Partial<ContactIn> = {}): ContactIn => ({ contact_id: id, name: 'Test Customer', first_name: 'Test', last_name: 'Customer', email: 'buyer@example.invalid', ...over });
const invoice = (over: Partial<InvoiceIn> = {}): InvoiceIn => ({
  invoice_id: 'i-1', invoice_number: 'INV-0001', invoice_type: 'ACCREC', reference: '90001', status: 'AUTHORISED', contact_id: 'c-quote',
  contact_name: 'Test Customer', total: 115000, amount_due: 50000, fully_paid_on: null, currency_code: 'ZAR', ...over,
});

function rfi(over: Partial<RfiInput> = {}, data: Record<string, unknown> = {}): RfiInput {
  return {
    entry: entry('rfi-1', { QuoteNo: '90001', Name: { First: 'Test', Last: 'Customer' }, IDNO: '0000000000000', ...data }),
    files: [file('f1', '_1stDeposit'), file('f2', '_2ndDeposit'), file('f9', 'Other')],
    documentName: 'REQUEST FOR INVOICE - 7.pdf',
    quotes: [quote()],
    quoteLines: [
      { line_no: 1, item_code: 'TNK-5000', description: 'Synthetic tanker 5000L', quantity: 1, unit_amount: 90000 },
      { line_no: 2, item_code: 'PMP-1', description: 'Synthetic pump kit', quantity: 2, unit_amount: 5000 },
    ],
    quoteContact: contact('c-quote'),
    contactsByEmail: [contact('c-quote')],
    contactsByName: [],
    invoicesByReference: [],
    today: '2026-10-29',
    ...over,
  };
}

describe('modes', () => {
  it('flags actions without Xero writes as doing nothing in dry run (dry run applies no entries or emails)', () => {
    expect(dryRunDoesNothing('deal.import_quote', 'dry_run')).toBe(true);
    expect(dryRunDoesNothing('release.on_paid', 'dry_run')).toBe(true);
    expect(dryRunDoesNothing('release.on_paid', 'live')).toBe(false);
    expect(dryRunDoesNothing('release.on_paid', 'off')).toBe(false);
    expect(dryRunDoesNothing('rfi.create_invoice', 'dry_run')).toBe(false); // it records the Xero requests it would send
    expect(NO_XERO_WRITES_NOTE).not.toMatch(/behave the same/);
    expect(NO_XERO_WRITES_NOTE).toContain('dry run only records');
  });
  it('defaults to off and parses only known modes', () => {
    expect(parseMode(undefined)).toBe('off');
    expect(parseMode('LIVE')).toBe('off');
    expect(parseMode({ mode: 'live' })).toBe('off');
    expect(parseMode('dry_run')).toBe('dry_run');
  });

  it('live needs a connected Xero with all write scopes, else it runs as dry run', () => {
    const read = { status: 'connected', scopes: ['offline_access', 'accounting.transactions.read', 'accounting.contacts.read', 'accounting.attachments.read'] };
    const write = { status: 'connected', scopes: ['offline_access', ...WRITE_SCOPES] };
    expect(hasWriteScopes(read.scopes)).toBe(false);
    expect(hasWriteScopes(write.scopes)).toBe(true);
    expect(resolveMode('rfi.create_invoice', 'live', read)).toEqual({ mode: 'dry_run', requested: 'live', downgraded: 'connection lacks write scopes' });
    expect(resolveMode('rfi.create_invoice', 'live', null).mode).toBe('dry_run');
    expect(resolveMode('rfi.create_invoice', 'live', { ...write, status: 'disconnected' }).mode).toBe('dry_run');
    expect(resolveMode('rfi.create_invoice', 'live', write).mode).toBe('live');
    expect(resolveMode('rfi.create_invoice', undefined, write).mode).toBe('off');
    // Merge is plan only, whatever the setting says.
    expect(resolveMode('invoice.merge_attachments', 'live', write).mode).toBe('dry_run');
    // No Xero writes: live does not need write scopes.
    expect(resolveMode('release.on_paid', 'live', read).mode).toBe('live');
  });

  it('switching to live needs permission, write scopes and the typed action name', () => {
    const write = { status: 'connected', scopes: [...WRITE_SCOPES] };
    const base = { action: 'rfi.create_invoice' as const, to: 'live' as const, mayConfigure: true, connection: write, typed: 'rfi.create_invoice' };
    expect(checkSwitch(base)).toBeNull();
    expect(checkSwitch({ ...base, mayConfigure: false })).toMatch(/permission/);
    expect(checkSwitch({ ...base, typed: 'yes' })).toMatch(/Type rfi.create_invoice/);
    expect(checkSwitch({ ...base, connection: { status: 'connected', scopes: ['accounting.transactions.read'] } })).toMatch(/write scopes/);
    expect(checkSwitch({ ...base, action: 'invoice.merge_attachments', typed: 'invoice.merge_attachments' })).toMatch(/pdf-lib/);
    expect(checkSwitch({ ...base, to: 'dry_run', typed: null })).toBeNull();
  });
});

describe('deal.import_quote (4.1)', () => {
  it('fills LINE/PARTNO 1..8 and Total from the quote QU-{QUOTENO} only', () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({ line_no: i + 1, item_code: `P${i + 1}`, description: `Line ${i + 1}`, quantity: 1, unit_amount: 1 }));
    const plan = planDealImport({ entry: entry('d1', { QUOTENO: '90001', LINE1: 'old' }), quotes: [quote({ quote_number: 'QU-900011' }), quote()], lines });
    expect(plan.status).toBe('ready');
    expect(plan.requests).toEqual([]); // never writes to Xero
    const fields = (plan.effects[0] as { fields: Record<string, unknown> }).fields;
    expect(fields.LINE1).toBe('Line 1');
    expect(fields.PARTNO8).toBe('P8');
    expect(fields.LINE9).toBeUndefined();
    expect(fields.Total).toBe(115000);
  });

  it('accepts a typed QU- prefix, skips without a number and retries when the quote is unknown', () => {
    expect(planDealImport({ entry: entry('d1', { QUOTENO: 'qu-90001' }), quotes: [quote()], lines: [] }).status).toBe('ready');
    expect(planDealImport({ entry: entry('d1', {}), quotes: [], lines: [] }).status).toBe('skip');
    expect(planDealImport({ entry: entry('d1', { QUOTENO: '90002' }), quotes: [quote()], lines: [] }).status).toBe('retry');
  });

  it('changes nothing when the DEAL already matches', () => {
    const plan = planDealImport({ entry: entry('d1', { QUOTENO: '90001', LINE1: 'A', PARTNO1: 'B', Total: 115000 }), quotes: [quote()], lines: [{ line_no: 1, item_code: 'B', description: 'A', quantity: 1, unit_amount: 1 }] });
    expect(plan.effects).toEqual([]);
  });
});

describe('rfi.create_invoice (4.2)', () => {
  it('needs a quote number and a 1st deposit file', () => {
    expect(planRfiInvoice(rfi({}, { QuoteNo: undefined })).status).toBe('skip');
    const noDeposit = planRfiInvoice(rfi({ files: [file('f2', '_2ndDeposit')] }));
    expect(noDeposit.status).toBe('skip');
    expect(noDeposit.reason).toMatch(/1st deposit/);
    expect(noDeposit.idempotencyKey).toBe('rfi.create_invoice:90001');
  });

  it('full flow: contact update, SENT already -> ACCEPTED, INVOICED, invoice from quote, attachments, mapping', () => {
    const plan = planRfiInvoice(rfi({}, { Name: { First: 'Tester', Last: 'Customer' } }));
    expect(plan.status).toBe('ready');
    expect(plan.requests.map((r) => `${r.method} ${r.step}`)).toEqual([
      expect.stringMatching(/^POST contact\.update\./),
      'POST quote.status.ACCEPTED',
      'POST quote.status.INVOICED',
      'PUT invoice.create',
      `PUT attach.doc1.${T}`,
      'PUT attach.f1',
      'PUT attach.f2',
    ]);
    expect(plan.requests[0].body).toEqual({ Contacts: [{ ContactID: 'c-quote', FirstName: 'Tester' }] });
    expect(plan.requests[1].body).toEqual({ Quotes: [{ QuoteID: 'q-1', QuoteNumber: 'QU-90001', Contact: { ContactID: 'c-quote' }, Date: '2026-09-01', Status: 'ACCEPTED' }] });
    const inv = (plan.requests[3].body as { Invoices: Array<Record<string, unknown>> }).Invoices[0];
    expect(inv).toMatchObject({ Type: 'ACCREC', Contact: { ContactID: 'c-quote' }, Reference: '90001', Date: '2026-10-29', Status: 'DRAFT', CurrencyCode: 'ZAR', LineAmountTypes: 'Exclusive' });
    expect(inv.LineItems).toEqual([
      { Description: 'Synthetic tanker 5000L', Quantity: 1, UnitAmount: 90000, ItemCode: 'TNK-5000', AccountCode: '200', TaxType: 'OUTPUT' },
      { Description: 'Synthetic pump kit', Quantity: 2, UnitAmount: 5000, ItemCode: 'PMP-1', AccountCode: '200', TaxType: 'OUTPUT' },
    ]);
    expect(plan.requests[3].capture).toEqual({ name: 'invoice', path: 'Invoices.0.InvoiceID' });
    expect(plan.requests[5].path).toBe('/Invoices/{{invoice}}/Attachments/_1stDeposit-scan.pdf');
    expect(plan.effects).toContainEqual({ kind: 'external_ref', entity: 'rfi.invoice', externalId: '{{invoice}}', internalId: 'rfi-1', needsLive: true });
    expect(plan.effects).toContainEqual({ kind: 'external_ref', entity: 'rfi.quote', externalId: '90001', internalId: 'rfi-1' });
  });

  it('never creates a second invoice when one with Reference == QuoteNo exists; attaches to it', () => {
    const plan = planRfiInvoice(rfi({ invoicesByReference: [invoice({ invoice_id: 'i-existing' })], quotes: [quote({ status: 'INVOICED' })] }));
    expect(plan.requests.some((r) => r.step === 'invoice.create')).toBe(false);
    expect(plan.requests.some((r) => r.step.startsWith('quote.status'))).toBe(false);
    expect(plan.requests.filter((r) => r.file).every((r) => r.path.startsWith('/Invoices/i-existing/Attachments/'))).toBe(true);
    // A voided one does not count.
    const voided = planRfiInvoice(rfi({ invoicesByReference: [invoice({ status: 'VOIDED' })] }));
    expect(voided.requests.some((r) => r.step === 'invoice.create')).toBe(true);
  });

  it('skips invoice creation (and attachments) when a quote line has a negative UnitAmount', () => {
    const q = quote();
    (q.raw.LineItems as Array<Record<string, unknown>>)[1].UnitAmount = -500;
    const plan = planRfiInvoice(rfi({ quotes: [q] }));
    expect(plan.requests.some((r) => r.step === 'invoice.create' || r.file)).toBe(false);
    expect(plan.reason).toMatch(/negative/);
    expect(plan.requests.some((r) => r.step === 'quote.status.INVOICED')).toBe(true);
  });

  it('contact: by email, else by name, else created (placeholder flows into quote and invoice)', () => {
    const byName = planRfiInvoice(rfi({ quoteContact: contact('c-quote', { email: null }), contactsByEmail: [], contactsByName: [contact('c-name', { email: null })] }));
    expect(byName.requests.find((r) => r.step === 'quote.status.ACCEPTED')!.body).toMatchObject({ Quotes: [{ Contact: { ContactID: 'c-name' } }] });

    const created = planRfiInvoice(rfi({ quoteContact: contact('c-quote', { email: null }), contactsByEmail: [], contactsByName: [] }));
    const c = created.requests[0];
    expect(c).toMatchObject({ step: 'contact.create', method: 'PUT', path: '/Contacts', capture: { name: 'contact', path: 'Contacts.0.ContactID' } });
    expect(c.body).toEqual({ Contacts: [{ Name: 'Test Customer', FirstName: 'Test', LastName: 'Customer' }] });
    expect(created.requests.find((r) => r.step === 'invoice.create')!.body).toMatchObject({ Invoices: [{ Contact: { ContactID: '{{contact}}' } }] });
  });

  it('does not move a quote backwards and stops on a declined quote', () => {
    expect(planRfiInvoice(rfi({ quotes: [quote({ status: 'DRAFT' })] })).requests.filter((r) => r.step.startsWith('quote.status')).map((r) => r.step))
      .toEqual(['quote.status.SENT', 'quote.status.ACCEPTED', 'quote.status.INVOICED']);
    expect(planRfiInvoice(rfi({ quotes: [quote({ status: 'DECLINED' })] })).status).toBe('skip');
    expect(planRfiInvoice(rfi({ quotes: [] })).status).toBe('retry');
  });
});

describe('delivery.update_invoice (4.3)', () => {
  const files = [
    file('id1', 'COPYOfSignatoryID'), file('id2', 'COPYOfSignatoryID', 2), file('p1', 'PAYMENT'), file('p2', 'Payment2'), file('n1', 'NATIS'),
    file('ph1', 'Pic1FRONT'), file('ph1b', 'Pic1FRONT', 0), file('ph4', 'Pic4REAR'), file('x', 'RELEASENOTE'),
  ];
  const base = { entry: entry('dn-1', { INVOICENO: '0001', TrailerVinNO: 'TESTVIN0000000001', QuoteNo: 'rfi-1' }), files, documentName: 'DELIVERY NOTE - 3.pdf', invoices: [invoice()], rfi: { entry: entry('rfi-1', {}), documentName: 'REQUEST FOR INVOICE - 7.pdf' } };

  it('sets the VIN as Reference and attaches documents in Make order, first file per field, then the RFI PDF', () => {
    const plan = planDeliveryInvoice(base);
    expect(plan.idempotencyKey).toBe('delivery.update_invoice:INV-0001');
    expect(plan.requests[0]).toMatchObject({ method: 'POST', path: '/Invoices/i-1', body: { Invoices: [{ InvoiceID: 'i-1', Reference: 'TESTVIN0000000001' }] } });
    expect(plan.requests.slice(1).map((r) => r.step)).toEqual([`attach.doc1.${T}`, 'attach.id1', 'attach.p1', 'attach.p2', 'attach.n1', 'attach.ph1b', 'attach.ph4', `attach.rfi.rfi-1.${T}`]);
  });

  it('retries when the invoice is missing, skips voided/deleted, and does not rewrite an equal Reference', () => {
    expect(planDeliveryInvoice({ ...base, invoices: [] }).status).toBe('retry');
    expect(planDeliveryInvoice({ ...base, invoices: [invoice({ status: 'VOIDED' })] }).status).toBe('skip');
    expect(planDeliveryInvoice({ ...base, invoices: [invoice({ status: 'DELETED' })] }).status).toBe('skip');
    expect(planDeliveryInvoice({ ...base, invoices: [invoice({ reference: 'TESTVIN0000000001' })] }).requests[0].step).toMatch(/^attach\./);
    expect(planDeliveryInvoice({ ...base, entry: entry('dn-1', { INVOICENO: 'inv-0001' }) }).status).toBe('ready');
  });
});

describe('release.on_paid (4.4)', () => {
  it('only fully paid sales invoices', () => {
    expect(isFullyPaid(invoice({ amount_due: 0, status: 'PAID' }))).toBe(true);
    expect(isFullyPaid(invoice({ amount_due: '0.00', status: 'PAID' }))).toBe(true);
    expect(isFullyPaid(invoice({ amount_due: 0.01, status: 'AUTHORISED' }))).toBe(false);
    expect(isFullyPaid(invoice({ amount_due: 0, status: 'VOIDED' }))).toBe(false);
    expect(isFullyPaid(invoice({ amount_due: 0, status: 'PAID', invoice_type: 'ACCPAY' }))).toBe(false);
  });

  it('creates the release entry, maps it, and emails the branches; no Xero writes', () => {
    const plan = planRelease({ invoice: invoice({ amount_due: 0, status: 'PAID', reference: 'TESTVIN0000000001', fully_paid_on: '2026-10-28' }), contactEmail: 'buyer@example.invalid', existingReleaseEntryId: null });
    expect(plan.requests).toEqual([]);
    expect(plan.effects[0]).toEqual({ kind: 'entry.submit', formSlug: 'release-form', values: { INVNO: 'INV-0001', VINNO: 'TESTVIN0000000001', Email: 'buyer@example.invalid', COSTOMERDETAILS: 'Test Customer' } });
    expect(plan.effects[1]).toEqual({ kind: 'external_ref', entity: 'invoice.release', externalId: 'i-1', internalId: '{{release_entry}}' });
    expect(plan.effects[2]).toMatchObject({ kind: 'email', eventKey: 'release.paid', subject: 'Release Form - INV-0001', lines: [['Contact Name', 'Test Customer'], ['Invoice Number', 'INV-0001'], ['Fully Paid On', '2026-10-28']] });
  });

  it('updates the mapped entry instead of creating another; drops an invalid email', () => {
    const plan = planRelease({ invoice: invoice({ amount_due: 0, status: 'PAID' }), contactEmail: 'not an email', existingReleaseEntryId: 'rel-1' });
    expect(plan.effects[0]).toMatchObject({ kind: 'entry.update', entryId: 'rel-1' });
    expect((plan.effects[0] as { values: Record<string, string> }).values.Email).toBeUndefined();
  });
});

describe('invoice.merge_attachments (4.5, plan only)', () => {
  const att = (id: string, name: string, mime = 'application/pdf') => ({ attachment_id: id, file_name: name, mime_type: mime, content_length: 10 });
  it('lists downloads and the merged upload; removals only when every original is merged', () => {
    const plan = planMerge({ invoice: invoice({ invoice_number: 'INV/0001' }), attachments: [att('a1', 'x.pdf'), att('a2', 'y.jpg', 'image/jpeg')] });
    expect(mergedNameOf('INV/0001')).toBe('INV-0001-merged.pdf');
    expect(plan.outline).toEqual({ download: ['a1', 'a2'], mergedName: 'INV-0001-merged.pdf', unsupported: [], removeAfterUpload: ['a1', 'a2'] });
    expect(plan.requests.map((r) => r.method)).toEqual(['PUT']);
    const partial = planMerge({ invoice: invoice(), attachments: [att('a1', 'x.pdf'), att('a2', 'z.docx', 'application/msword')] });
    expect(partial.outline!.removeAfterUpload).toEqual([]);
  });
  it('skips when already merged or fewer than two attachments', () => {
    expect(planMerge({ invoice: invoice(), attachments: [att('a1', 'x.pdf'), att('m', 'INV-0001-merged.pdf')] }).status).toBe('skip');
    expect(planMerge({ invoice: invoice(), attachments: [att('a1', 'x.pdf')] }).status).toBe('skip');
  });
});

describe('triggers', () => {
  it('maps form saves to actions', () => {
    expect(actionsForSave('deal', 'Submit')).toEqual(['deal.import_quote']);
    expect(actionsForSave('deal', 'Update')).toEqual([]);
    expect(actionsForSave('request-for-invoice', 'Update')).toEqual(['rfi.create_invoice']);
    expect(actionsForSave('delivery-note', 'Submit')).toEqual(['delivery.update_invoice']);
    expect(actionsForSave('release-form', 'Submit')).toEqual([]);
  });

  it('fires release only on a transition to paid, never for backfilled history', () => {
    const paid = (id: string) => invoice({ invoice_id: id, amount_due: 0, status: 'PAID' });
    const before = new Map<string, number | string | null>([['was-due', '100.00'], ['was-paid', '0.00']]);
    expect(paidTransitions(before, [paid('was-due'), paid('was-paid'), paid('new'), invoice({ invoice_id: 'due' })], true)).toEqual(['was-due', 'new']);
    expect(paidTransitions(before, [paid('was-due'), paid('new')], false)).toEqual(['was-due']);
  });
});

describe('redaction', () => {
  it('masks personal data and uploaded file names, keeps ids, numbers, VINs and amounts', () => {
    const plan = planRfiInvoice(rfi({ quoteContact: contact('c-quote', { email: null }), contactsByEmail: [], contactsByName: [] }));
    const shown = plan.requests.map(redactRequest);
    expect(JSON.stringify(shown)).not.toMatch(/Test|Customer|scan\.pdf|example\.invalid/);
    expect(shown[0].body).toEqual({ Contacts: [{ Name: REDACTED, FirstName: REDACTED, LastName: REDACTED }] });
    const upload = shown.find((r) => r.step === 'attach.f1')!;
    expect(upload.path).toBe(`/Invoices/{{invoice}}/Attachments/${REDACTED_FILE}`);
    expect(upload.file).toMatchObject({ fileName: REDACTED_FILE, field: '_1stDeposit' });
    expect(JSON.stringify(shown)).toContain('QU-90001');
    expect(JSON.stringify(shown)).toContain('90000');
    const rel = planRelease({ invoice: invoice({ amount_due: 0, status: 'PAID', reference: 'TESTVIN0000000001' }), contactEmail: 'buyer@example.invalid', existingReleaseEntryId: null });
    const eff = JSON.stringify(rel.effects.map(redactEffect));
    expect(eff).not.toMatch(/example\.invalid|Test Customer/);
    expect(eff).toContain('TESTVIN0000000001');
  });

  it('errors keep only status and type', () => {
    expect(redactError(Object.assign(new Error('x'), { status: 400, xeroType: 'ValidationException' }))).toBe('xero 400 ValidationException');
    expect(redactError(new Error('contact buyer@example.invalid 0821234567 failed'))).toBe(`contact ${REDACTED} ${REDACTED} failed`);
  });
});

describe('placeholders', () => {
  it('fills captures and refuses unknown ones', () => {
    expect(fillPlaceholders({ p: '/Invoices/{{invoice}}/x', b: [{ id: '{{invoice}}' }] }, { invoice: 'i-9' })).toEqual({ p: '/Invoices/i-9/x', b: [{ id: 'i-9' }] });
    expect(() => fillPlaceholders('{{nope}}', {})).toThrow(/missing capture/);
    expect(pick({ Invoices: [{ InvoiceID: 'x' }] }, 'Invoices.0.InvoiceID')).toBe('x');
  });
});
