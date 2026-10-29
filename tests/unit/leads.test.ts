import { describe, expect, it } from 'vitest';
import { findDuplicateOf } from '@/lib/leads/duplicates';
import {
  declaredTooLarge, intakeEventKey, invalidFields, MAX_BODY_BYTES, notifyClaimKey, pendingStages, priorEventAction, secretMatches, stageAlreadyRecorded, usableSecret,
} from '@/lib/leads/intake';
import {
  countsAsInvoice, DEFAULT_INVOICE_START, invoiceStartFrom, isGoneOut, matchChanged, matchColumns, matchContacts, matchLead, NO_MATCH,
  type InvoiceRow, type QuoteRow,
} from '@/lib/leads/matching';
import { normEmail, normPhone } from '@/lib/leads/normalise';
import { leadEmail } from '@/lib/leads/notify';
import { recipientsFor, routeLead, type RoutingRule } from '@/lib/leads/routing';
import { Assign, IntakePayload, ManualLead } from '@/lib/leads/schema';

// Synthetic data only.

describe('normalisation', () => {
  it('lower-cases and trims email', () => {
    expect(normEmail('  Jane.Doe@Example.INVALID ')).toBe('jane.doe@example.invalid');
    expect(normEmail('   ')).toBeNull();
    expect(normEmail(undefined)).toBeNull();
  });
  it('keeps digits and the last 9 of a phone', () => {
    expect(normPhone('+27 (82) 555-0101')).toBe('825550101');
    expect(normPhone('082 555 0101')).toBe('825550101');
    expect(normPhone('0027825550101')).toBe('825550101');
    expect(normPhone('12345')).toBeNull();
    expect(normPhone(null)).toBeNull();
  });
});

describe('duplicates', () => {
  const c = (id: string, created: string, email: string | null, phone: string | null, dup: string | null = null) =>
    ({ id, created_at: created, email_norm: email, phone_norm: phone, duplicate_of: dup });
  const rows = [
    c('b', '2026-10-02T00:00:00Z', 'a@example.invalid', null, 'a'),
    c('a', '2026-10-01T00:00:00Z', 'a@example.invalid', '825550101'),
    c('z', '2026-09-01T00:00:00Z', 'other@example.invalid', '111111111'),
  ];
  it('links to the earliest lead with the same email or phone', () => {
    expect(findDuplicateOf({ email_norm: 'a@example.invalid', phone_norm: null }, rows)).toBe('a');
    expect(findDuplicateOf({ email_norm: null, phone_norm: '825550101' }, rows)).toBe('a');
    expect(findDuplicateOf({ email_norm: 'new@example.invalid', phone_norm: '999999999' }, rows)).toBeNull();
    expect(findDuplicateOf({ email_norm: null, phone_norm: null }, rows)).toBeNull();
  });
  it('ignores the lead itself and follows the earliest lead to its own original', () => {
    expect(findDuplicateOf({ id: 'a', created_at: '2026-10-01T00:00:00Z', email_norm: 'a@example.invalid', phone_norm: null }, rows)).toBeNull();
    expect(findDuplicateOf({ id: 'b', created_at: '2026-10-02T00:00:00Z', email_norm: 'a@example.invalid', phone_norm: null }, rows)).toBe('a');
    expect(findDuplicateOf({ email_norm: 'x@example.invalid', phone_norm: null }, [c('q', '2026-01-01', 'x@example.invalid', null, 'root')])).toBe('root');
  });
});

describe('routing', () => {
  const rule = (o: Partial<RoutingRule> & { id: string; priority: number }): RoutingRule => ({
    name: o.id, match_source: null, match_product: null, match_branch: null, assign_branch: null, notify_event_key: 'leads.new', active: true, ...o,
  });
  const rules = [
    rule({ id: 'default', priority: 1000 }),
    rule({ id: 'tanker-durban', priority: 10, match_product: 'Tanker', match_branch: 'durban', assign_branch: 'Durban', notify_event_key: 'leads.durban' }),
    rule({ id: 'web', priority: 20, match_source: 'website', notify_event_key: 'leads.web' }),
    rule({ id: 'off', priority: 1, active: false, notify_event_key: 'leads.off' }),
  ];
  it('takes the first active matching rule by priority', () => {
    expect(routeLead({ source: 'website', product: 'Diesel bowser', branch: null }, rules)).toEqual({ ruleId: 'web', branch: null, eventKey: 'leads.web' });
    expect(routeLead({ source: 'website', product: '5000L fuel TANKER', branch: 'Durban' }, rules)).toEqual({ ruleId: 'tanker-durban', branch: 'Durban', eventKey: 'leads.durban' });
    expect(routeLead({ source: 'test', product: null, branch: 'Cape Town' }, rules)).toEqual({ ruleId: 'default', branch: 'Cape Town', eventKey: 'leads.new' });
  });
  it('falls back to leads.new without rules', () => {
    expect(routeLead({ source: 'test', product: null, branch: null }, [])).toEqual({ ruleId: null, branch: null, eventKey: 'leads.new' });
  });
  it('resolves recipients, falling back to leads.new when a branch key has none', () => {
    const rows = [
      { event_key: 'leads.new', address: 'sales@example.invalid', active: true },
      { event_key: 'leads.new', address: 'sales@example.invalid', active: true },
      { event_key: 'leads.durban', address: 'durban@example.invalid', active: true },
      { event_key: 'leads.web', address: 'web@example.invalid', active: false },
    ];
    expect(recipientsFor('leads.durban', rows)).toEqual(['durban@example.invalid']);
    expect(recipientsFor('leads.web', rows)).toEqual(['sales@example.invalid']);
    expect(recipientsFor('leads.new', rows)).toEqual(['sales@example.invalid']);
    expect(recipientsFor('leads.new', [])).toEqual([]);
  });
});

describe('matching to Xero', () => {
  const contacts = [
    { contact_id: 'c1', email_norm: 'buyer@example.invalid', phone_norm: null },
    { contact_id: 'c2', email_norm: null, phone_norm: '825550101' },
    { contact_id: 'c3', email_norm: 'someone@example.invalid', phone_norm: '000000000' },
  ];
  const quote = (id: string, status: string, date: string, contact = 'c1', total = 1000): QuoteRow =>
    ({ quote_id: id, quote_number: `QU-${id}`, status, contact_id: contact, quote_date: date, total, currency_code: 'ZAR' });
  const inv = (id: string, date: string, total: number | string, o: Partial<InvoiceRow> = {}): InvoiceRow =>
    ({ invoice_id: id, invoice_number: `INV-${id}`, invoice_type: 'ACCREC', status: 'AUTHORISED', contact_id: 'c1', invoice_date: date, total, currency_code: 'ZAR', ...o });

  it('matches contacts by normalised email or phone', () => {
    expect(matchContacts({ email_norm: 'buyer@example.invalid', phone_norm: '825550101' }, contacts)).toEqual(['c1', 'c2']);
    expect(matchContacts({ email_norm: null, phone_norm: null }, contacts)).toEqual([]);
  });

  it('only counts quotes that have gone out, latest first', () => {
    expect(['SENT', 'ACCEPTED', 'DECLINED', 'INVOICED'].every(isGoneOut)).toBe(true);
    expect(isGoneOut('DRAFT')).toBe(false);
    const m = matchLead({ email_norm: 'buyer@example.invalid', phone_norm: null }, {
      contacts,
      quotes: [quote('1', 'SENT', '2026-10-01'), quote('2', 'DRAFT', '2026-10-20'), quote('3', 'ACCEPTED', '2026-10-10', 'c1', 2500.5), quote('4', 'SENT', '2026-10-30', 'c3')],
      invoices: [],
    });
    expect(m.quote).toEqual({ id: '3', number: 'QU-3', status: 'ACCEPTED', total: 2500.5, currency: 'ZAR' });
    expect(m.invoice).toBeNull();
    expect(m.invoicedTotal).toBeNull();
  });

  it('counts invoices from the start date with value > 0 and keeps a running total', () => {
    const start = DEFAULT_INVOICE_START;
    expect(countsAsInvoice(inv('a', '2026-09-30', 100), start)).toBe(false);
    expect(countsAsInvoice(inv('a', '2026-10-01', 0), start)).toBe(false);
    expect(countsAsInvoice(inv('a', '2026-10-01', 100, { status: 'VOIDED' }), start)).toBe(false);
    expect(countsAsInvoice(inv('a', '2026-10-01', 100, { invoice_type: 'ACCPAY' }), start)).toBe(false);
    expect(countsAsInvoice(inv('a', '2026-10-01', '100.10'), start)).toBe(true);
    const m = matchLead({ email_norm: 'buyer@example.invalid', phone_norm: null }, {
      contacts, quotes: [],
      invoices: [inv('1', '2026-10-02', '100.10'), inv('2', '2026-10-05', 200.2), inv('3', '2026-09-01', 999), inv('4', '2026-10-06', 50, { currency_code: 'USD', contact_id: 'c3' })],
    });
    expect(m.invoice).toEqual({ id: '2', number: 'INV-2' });
    expect(m.invoiceCount).toBe(2);
    expect(m.invoicedTotal).toBe(300.3);
    expect(m.invoicedCurrency).toBe('ZAR');
  });

  it('respects a configured start date', () => {
    const m = matchLead({ email_norm: 'buyer@example.invalid', phone_norm: null }, { contacts, quotes: [], invoices: [inv('3', '2026-09-01', 999)] }, { invoiceStart: '2026-08-01' });
    expect(m.invoicedTotal).toBe(999);
    expect(invoiceStartFrom('2026-08-01')).toBe('2026-08-01');
    expect(invoiceStartFrom('nonsense')).toBe(DEFAULT_INVOICE_START);
    expect(invoiceStartFrom(undefined)).toBe(DEFAULT_INVOICE_START);
  });

  it('no contact means no match', () => {
    expect(matchLead({ email_norm: 'nobody@example.invalid', phone_norm: null }, { contacts, quotes: [quote('1', 'SENT', '2026-10-01')], invoices: [] })).toEqual(NO_MATCH);
  });

  it('detects whether a stored match changed', () => {
    const m = matchLead({ email_norm: 'buyer@example.invalid', phone_norm: null }, { contacts, quotes: [quote('1', 'SENT', '2026-10-01')], invoices: [] });
    const stored = { ...matchColumns(m), matched_quote_total: '1000.00' };
    expect(matchChanged(stored, m)).toBe(false);
    expect(matchChanged({ ...stored, matched_quote_status: 'DRAFT' }, m)).toBe(true);
    expect(matchChanged({ matched_contact_ids: [], invoice_count: 0 }, NO_MATCH)).toBe(false);
    expect(matchChanged({ matched_contact_ids: ['c1'], invoice_count: 0 }, NO_MATCH)).toBe(true);
  });
});

describe('intake', () => {
  const secret = 'x'.repeat(40);
  it('refuses unset or short secrets', () => {
    expect(usableSecret(undefined)).toBeNull();
    expect(usableSecret('short')).toBeNull();
    expect(usableSecret('y'.repeat(31))).toBeNull();
    expect(usableSecret(secret)).toBe(secret);
  });
  it('compares secrets exactly', () => {
    expect(secretMatches(secret, secret)).toBe(true);
    expect(secretMatches(secret.slice(1), secret)).toBe(false);
    expect(secretMatches(null, secret)).toBe(false);
    expect(secretMatches(`${secret}x`, secret)).toBe(false);
  });
  it('keys events by source and source id', () => {
    expect(intakeEventKey('test', 'abc')).toMatch(/^[0-9a-f]{64}$/);
    expect(intakeEventKey('test', 'abc')).toBe(intakeEventKey('test', 'abc'));
    expect(intakeEventKey('test', 'abc')).not.toBe(intakeEventKey('website', 'abc'));
  });
  it('refuses a declared body over 64 KB before reading it', () => {
    expect(declaredTooLarge(String(MAX_BODY_BYTES + 1))).toBe(true);
    expect(declaredTooLarge(String(MAX_BODY_BYTES))).toBe(false);
    expect(declaredTooLarge(null)).toBe(false); // chunked: the post-read check still applies
    expect(declaredTooLarge('not-a-number')).toBe(false);
  });
  it('decides what a repeated source id does from the stored event status', () => {
    expect(priorEventAction('ignored')).toBe('replace'); // a corrected re-post is accepted
    expect(priorEventAction('received')).toBe('replace');
    expect(priorEventAction('failed')).toBe('requeue');
    expect(priorEventAction('queued')).toBe('duplicate');
    expect(priorEventAction('processed')).toBe('duplicate');
  });
  it('runs only the lead stages without an event', () => {
    expect(pendingStages([], { duplicate: true, notify: true })).toEqual({ created: true, duplicate: true, routed: true, matched: true, emailed: true });
    expect(pendingStages(['created', 'routed'], { duplicate: false, notify: true })).toEqual({ created: false, duplicate: false, routed: false, matched: true, emailed: true });
    expect(pendingStages(['created', 'duplicate', 'routed', 'matched', 'emailed'], { duplicate: true, notify: true })).toEqual({ created: false, duplicate: false, routed: false, matched: false, emailed: false });
    expect(pendingStages([], { duplicate: false, notify: false }).emailed).toBe(false);
    expect(notifyClaimKey('abc')).toBe('lead.notify:abc');
  });
  it('treats a unique violation as done only for the one-time stages', () => {
    for (const k of ['created', 'duplicate', 'routed', 'emailed']) expect(stageAlreadyRecorded(k, { code: '23505' })).toBe(true);
    for (const k of ['matched', 'status', 'assigned', 'note']) expect(stageAlreadyRecorded(k, { code: '23505' })).toBe(false);
    expect(stageAlreadyRecorded('created', { code: 'XX000' })).toBe(false);
    expect(stageAlreadyRecorded('created', null)).toBe(false);
  });
  it('reports invalid field names, never values', () => {
    const r = IntakePayload.safeParse({ source: 'test', source_id: 't-1', email: 'Secret Value' });
    expect(r.success).toBe(false);
    expect(invalidFields(r.error!.issues)).toEqual(['email']);
    expect(invalidFields([{ path: [] }])).toEqual(['(root)']);
  });
  it('validates payloads', () => {
    const ok = IntakePayload.safeParse({ source: 'test', source_id: 't-1', name: ' Test Person ', email: 'TP@example.invalid', utm: { utm_source: 'google' } });
    expect(ok.success).toBe(true);
    expect(ok.data?.name).toBe('Test Person');
    expect(IntakePayload.safeParse({ source: 'manual', source_id: 't-1', email: 'a@example.invalid' }).success).toBe(false);
    expect(IntakePayload.safeParse({ source: 'test', email: 'a@example.invalid' }).success).toBe(false);
    expect(IntakePayload.safeParse({ source: 'test', source_id: 't-1', name: 'No contact' }).success).toBe(false);
    expect(IntakePayload.safeParse({ source: 'test', source_id: 't-1', email: 'not-an-email' }).success).toBe(false);
    expect(IntakePayload.safeParse({ source: 'test', source_id: 't-1', phone: '082 555 0101', email: '' }).success).toBe(true);
    expect(IntakePayload.safeParse({ source: 'test', source_id: 't-1', phone: '082', utm: { evil: 'x' } }).success).toBe(false);
    expect(ManualLead.safeParse({ name: 'X', phone: '0825550101', branch: '' }).success).toBe(true);
    expect(ManualLead.safeParse({ name: 'X', phone: '0825550101', branch: '<script>' }).success).toBe(false);
    expect(Assign.safeParse({ id: '00000000-0000-0000-0000-00000000a001', assigned_to: '' }).data?.assigned_to).toBeNull();
  });
});

describe('notification email', () => {
  it('keeps personal data out of the subject and escapes the body', () => {
    const e = leadEmail({
      id: 'lead-1', source_form: 'Product Inquiry', name: 'Test <b>Person</b>', email: 'tp@example.invalid', phone: '0825550101',
      product: 'Tanker', message: null, branch: 'Durban', duplicate_of: null,
    }, 'Website', 'http://app.example.invalid/', ['sales@example.invalid']);
    expect(e.subject).toBe('New lead from Website (Durban)');
    expect(e.subject).not.toContain('Person');
    expect(e.html).toContain('Test &lt;b&gt;Person&lt;/b&gt;');
    expect(e.html).toContain('http://app.example.invalid/admin/leads/lead-1');
    expect(e.text).toContain('Email: tp@example.invalid');
    expect(e.to).toEqual(['sales@example.invalid']);
  });
});
