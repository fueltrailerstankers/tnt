// rfi.create_invoice (BUILD_PLAN 4.2). Pure.
//
//   - only with QuoteNo and a 1st deposit file
//   - find the quote QU-{QuoteNo}
//   - contact: search by the quote contact's email, else by the form's Name.FirstAndLast; create it when still
//     missing and a name exists, otherwise update it
//   - quote status SENT -> ACCEPTED -> INVOICED (only the moves still ahead of the current status)
//   - invoice: if an invoice with Reference == QuoteNo exists, never create another (attach to it);
//     otherwise create one from the quote unless any line has a negative UnitAmount
//   - attach the RFI PDF (document #1) and the files of _1stDeposit, _2ndDeposit, _3rdDeposit, _4thPayment
//   - remember (RFI entry, quote no, invoice id) in external_refs
// Idempotency key: (quote no, action). Every request has a stable step id, claimed once in live mode.
import { createHash } from 'node:crypto';
import { quoteNoOf } from '../mappers';
import {
  emptyPlan, safeFileName, text, type ContactIn, type EntryIn, type FileIn, type FileSource, type InvoiceIn, type Plan,
  type PlannedRequest, type QuoteIn, type QuoteLineIn,
} from './types';

export const RFI_FILE_FIELDS = ['_1stDeposit', '_2ndDeposit', '_3rdDeposit', '_4thPayment'] as const;
export const QUOTE_FLOW = ['SENT', 'ACCEPTED', 'INVOICED'] as const;
const QUOTE_ORDER: Record<string, number> = { DRAFT: 0, SENT: 1, ACCEPTED: 2, INVOICED: 3 };

/**
 * Status of a new invoice made from a quote. ASSUMPTION to confirm with the Make recordings: Make's
 * "create invoice" module default is a DRAFT invoice. The replay diff will show it if Make sends another.
 */
export const NEW_INVOICE_STATUS = 'DRAFT';

/** Quote line fields copied onto the invoice (from the raw Xero quote JSON). */
const LINE_FIELDS = ['Description', 'Quantity', 'UnitAmount', 'ItemCode', 'AccountCode', 'TaxType', 'DiscountRate', 'Tracking'] as const;

export interface RfiInput {
  entry: EntryIn;
  files: FileIn[];
  /** Name of the RFI document #1 (the PDF is produced when the request is sent). */
  documentName: string;
  quotes: QuoteIn[];
  quoteLines: QuoteLineIn[];
  /** The contact the quote points at (for its email). */
  quoteContact: ContactIn | null;
  contactsByEmail: ContactIn[];
  contactsByName: ContactIn[];
  /** Sales invoices whose Reference equals the quote no. */
  invoicesByReference: InvoiceIn[];
  /** Today in the org's timezone, YYYY-MM-DD. */
  today: string;
}

export function rfiKey(quoteNo: string) {
  return `rfi.create_invoice:${quoteNo}`;
}

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const shortHash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 12);

export function nameOf(data: Record<string, unknown>): { first: string | null; last: string | null; full: string | null } {
  const n = data.Name && typeof data.Name === 'object' ? (data.Name as Record<string, unknown>) : {};
  const first = text(n.First);
  const last = text(n.Last);
  const full = [first, last].filter(Boolean).join(' ') || null;
  return { first, last, full };
}

export function attachRequest(step: string, invoiceRef: string, name: string, file: FileSource, purpose: string): PlannedRequest {
  return {
    step,
    method: 'PUT',
    path: `/Invoices/${invoiceRef}/Attachments/${encodeURIComponent(safeFileName(name))}`,
    params: { IncludeOnline: 'false' },
    file,
    purpose,
  };
}

export function fileSource(entryId: string, f: FileIn): FileSource {
  return { kind: 'entry_file', entryId, fileId: f.id, field: f.fieldKey, fileName: f.fileName, contentType: f.contentType, size: f.sizeBytes };
}

export function planRfiInvoice(input: RfiInput): Plan {
  const { entry } = input;
  const quoteNo = quoteNoOf(text(entry.data.QuoteNo));
  if (!quoteNo) return emptyPlan('rfi.create_invoice', `rfi.create_invoice:entry-${entry.id}`, 'skip', 'RFI has no quote number');
  const key = rfiKey(quoteNo);
  const filesOf = (field: string) => input.files.filter((f) => f.kind === 'file' && f.fieldKey === field).sort((a, b) => a.sortOrder - b.sortOrder);
  if (!filesOf('_1stDeposit').length) return emptyPlan('rfi.create_invoice', key, 'skip', 'no 1st deposit file (no payment loaded)');

  const quote = input.quotes.find((q) => (q.quote_number ?? '').toUpperCase() === `QU-${quoteNo}`);
  if (!quote) return emptyPlan('rfi.create_invoice', key, 'retry', 'quote not found in Xero');
  const qStatus = (quote.status ?? '').toUpperCase();
  if (!(qStatus in QUOTE_ORDER)) return emptyPlan('rfi.create_invoice', key, 'skip', `quote status ${qStatus || 'unknown'}`);

  const requests: PlannedRequest[] = [];
  const name = nameOf(entry.data);

  // --- contact ---------------------------------------------------------------------------------
  const email = input.quoteContact?.email?.trim() || null;
  const byEmail = email ? input.contactsByEmail.find((c) => lower(c.email) === lower(email)) : undefined;
  const byName = !byEmail && name.full ? input.contactsByName.find((c) => lower(c.name) === lower(name.full)) : undefined;
  const found = byEmail ?? byName;
  let contactRef: string;
  let contactHow: string;
  if (found) {
    contactRef = found.contact_id;
    contactHow = byEmail ? 'found by quote contact email' : 'found by name';
    // ASSUMPTION: Make's "update contact" writes the person's first and last name from the form.
    const patch: Record<string, string> = {};
    if (name.first && name.first !== found.first_name) patch.FirstName = name.first;
    if (name.last && name.last !== found.last_name) patch.LastName = name.last;
    if (Object.keys(patch).length) {
      requests.push({
        // Keyed on the entry version, not the names: a hash of names alone could be reversed from a name list.
        step: `contact.update.${shortHash([found.contact_id, entry.id, entry.updatedAt])}`,
        method: 'POST',
        path: `/Contacts/${found.contact_id}`,
        body: { Contacts: [{ ContactID: found.contact_id, ...patch }] },
        purpose: 'Update the Xero contact with the name on the RFI',
      });
    }
  } else if (name.full) {
    contactRef = '{{contact}}';
    contactHow = 'created';
    requests.push({
      step: 'contact.create',
      method: 'PUT',
      path: '/Contacts',
      body: { Contacts: [{ Name: name.full, ...(name.first ? { FirstName: name.first } : {}), ...(name.last ? { LastName: name.last } : {}), ...(email ? { EmailAddress: email } : {}) }] },
      capture: { name: 'contact', path: 'Contacts.0.ContactID' },
      purpose: 'Create the Xero contact (none found by email or name)',
    });
  } else if (quote.contact_id) {
    contactRef = quote.contact_id;
    contactHow = 'quote contact (no name on the RFI)';
  } else {
    return emptyPlan('rfi.create_invoice', key, 'skip', 'no contact on the quote and no name on the RFI');
  }

  // --- quote status moves ----------------------------------------------------------------------
  for (const s of QUOTE_FLOW) {
    if (QUOTE_ORDER[s] <= QUOTE_ORDER[qStatus]) continue;
    requests.push({
      step: `quote.status.${s}`,
      method: 'POST',
      path: `/Quotes/${quote.quote_id}`,
      body: { Quotes: [{ QuoteID: quote.quote_id, QuoteNumber: quote.quote_number, Contact: { ContactID: contactRef }, Date: quote.quote_date, Status: s }] },
      purpose: `Move the quote to ${s}`,
    });
  }

  // --- invoice ---------------------------------------------------------------------------------
  const existing = input.invoicesByReference
    .filter((i) => (i.invoice_type ?? 'ACCREC') === 'ACCREC' && !['DELETED', 'VOIDED'].includes((i.status ?? '').toUpperCase()))
    .filter((i) => lower(i.reference) === lower(text(entry.data.QuoteNo)) || lower(i.reference) === lower(quoteNo));
  const rawLines = Array.isArray(quote.raw.LineItems) ? (quote.raw.LineItems as Record<string, unknown>[]) : [];
  const negative = input.quoteLines.some((l) => Number(l.unit_amount) < 0) || rawLines.some((l) => Number(l.UnitAmount) < 0);
  let invoiceRef: string | null = null;
  let invoiceHow: string;
  if (existing.length) {
    invoiceRef = existing[0].invoice_id;
    invoiceHow = 'exists (Reference == QuoteNo): not created again';
  } else if (negative) {
    invoiceHow = 'not created: a quote line has a negative UnitAmount';
  } else {
    invoiceRef = '{{invoice}}';
    invoiceHow = 'created from the quote';
    const source: Record<string, unknown>[] = rawLines.length
      ? rawLines
      : input.quoteLines.map((l) => ({ Description: l.description, Quantity: Number(l.quantity ?? 1), UnitAmount: Number(l.unit_amount ?? 0), ItemCode: l.item_code }));
    const lineItems = source
      .map((l) => Object.fromEntries(LINE_FIELDS.filter((f) => l[f] !== undefined && l[f] !== null).map((f) => [f, l[f]])));
    requests.push({
      step: 'invoice.create',
      method: 'PUT',
      path: '/Invoices',
      body: {
        Invoices: [{
          Type: 'ACCREC',
          Contact: { ContactID: contactRef },
          Date: input.today,
          Reference: text(entry.data.QuoteNo) ?? quoteNo,
          Status: NEW_INVOICE_STATUS,
          ...(quote.currency_code ? { CurrencyCode: quote.currency_code } : {}),
          ...(typeof quote.raw.LineAmountTypes === 'string' ? { LineAmountTypes: quote.raw.LineAmountTypes } : {}),
          ...(typeof quote.raw.BrandingThemeID === 'string' ? { BrandingThemeID: quote.raw.BrandingThemeID } : {}),
          LineItems: lineItems,
        }],
      },
      capture: { name: 'invoice', path: 'Invoices.0.InvoiceID' },
      purpose: 'Create the invoice from the quote',
    });
  }

  // --- attachments -----------------------------------------------------------------------------
  let attachments = 0;
  if (invoiceRef) {
    requests.push(attachRequest(
      `attach.doc1.${entry.updatedAt}`, invoiceRef, input.documentName,
      { kind: 'document', formSlug: 'request-for-invoice', entryId: entry.id, template: 1, name: input.documentName },
      'Attach the RFI PDF',
    ));
    attachments++;
    for (const field of RFI_FILE_FIELDS) {
      for (const f of filesOf(field)) {
        requests.push(attachRequest(`attach.${f.id}`, invoiceRef, f.fileName, fileSource(entry.id, f), `Attach ${field}`));
        attachments++;
      }
    }
  }

  const plan: Plan = {
    action: 'rfi.create_invoice', idempotencyKey: key, status: 'ready', requests, effects: [],
    expected: {
      quote: { quoteNumber: quote.quote_number, status: 'INVOICED', contact: contactHow },
      invoice: invoiceRef ? { reference: text(entry.data.QuoteNo) ?? quoteNo, how: invoiceHow } : { how: invoiceHow },
      attachments,
    },
  };
  plan.effects.push({ kind: 'external_ref', entity: 'rfi.quote', externalId: quoteNo, internalId: entry.id });
  if (invoiceRef) plan.effects.push({ kind: 'external_ref', entity: 'rfi.invoice', externalId: invoiceRef, internalId: entry.id, needsLive: invoiceRef.startsWith('{{') });
  if (!invoiceRef) plan.reason = invoiceHow;
  return plan;
}
