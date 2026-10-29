// release.on_paid (BUILD_PLAN 4.4). Pure.
//
// When a sales invoice is fully paid (AmountDue == 0): create the RELEASE FORM entry (public Submit, run by
// the system actor) or update the one already mapped to the invoice; record invoice -> release entry; email
// the branches "Release Form - {InvoiceNumber}" with Contact Name, Invoice Number and Fully Paid On, attaching
// the invoice PDF (GET from Xero) and the release PDF. No Xero writes.
import { emptyPlan, money, text, type InvoiceIn, type Plan } from './types';

export const RELEASE_EVENT = 'release.paid';
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

export interface ReleaseInput {
  invoice: InvoiceIn;
  contactEmail: string | null;
  /** Release entry already mapped to this invoice (external_refs), if any. */
  existingReleaseEntryId: string | null;
}

export function releaseKey(invoiceId: string) {
  return `release.on_paid:${invoiceId}`;
}

/** The release condition. Make: AmountDue == 0. Also: a sales invoice that is PAID (not draft, voided or deleted). */
export function isFullyPaid(i: Pick<InvoiceIn, 'amount_due' | 'status' | 'invoice_type' | 'total'>): boolean {
  return money(i.amount_due) === 0 && (i.invoice_type ?? 'ACCREC') === 'ACCREC' && (i.status ?? '').toUpperCase() === 'PAID' && (money(i.total) ?? 0) > 0;
}

export function planRelease(input: ReleaseInput): Plan {
  const inv = input.invoice;
  const key = releaseKey(inv.invoice_id);
  if (!isFullyPaid(inv)) return emptyPlan('release.on_paid', key, 'skip', `invoice not fully paid (status ${inv.status ?? 'unknown'})`);
  const number = text(inv.invoice_number) ?? inv.invoice_id;
  const email = input.contactEmail && EMAIL_RE.test(input.contactEmail.trim()) ? input.contactEmail.trim() : null;
  const values: Record<string, string> = {
    INVNO: number,
    ...(text(inv.reference) ? { VINNO: text(inv.reference)! } : {}),
    ...(email ? { Email: email } : {}),
    ...(text(inv.contact_name) ? { COSTOMERDETAILS: text(inv.contact_name)! } : {}),
  };
  const plan: Plan = {
    action: 'release.on_paid', idempotencyKey: key, status: 'ready', requests: [], effects: [],
    expected: { invoiceNumber: number, release: input.existingReleaseEntryId ? 'update' : 'create' },
  };
  plan.effects.push(
    input.existingReleaseEntryId
      ? { kind: 'entry.update', formSlug: 'release-form', entryId: input.existingReleaseEntryId, values }
      : { kind: 'entry.submit', formSlug: 'release-form', values },
    { kind: 'external_ref', entity: 'invoice.release', externalId: inv.invoice_id, internalId: input.existingReleaseEntryId ?? '{{release_entry}}' },
    {
      kind: 'email',
      eventKey: RELEASE_EVENT,
      subject: `Release Form - ${number}`,
      lines: [['Contact Name', text(inv.contact_name) ?? ''], ['Invoice Number', number], ['Fully Paid On', inv.fully_paid_on ?? '']],
      attach: ['invoice.pdf', 'release.pdf'],
    },
  );
  return plan;
}
