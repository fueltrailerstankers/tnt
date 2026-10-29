// Xero JSON -> mirror rows. Pure. Xero dates arrive either as .NET JSON dates ("/Date(1700000000000+0000)/")
// or as ISO strings (the *String fields); both are handled. Money keeps the record's own CurrencyCode.

type J = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const money = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n * 100) / 100;
};

/** Parses "/Date(1700000000000+0000)/" or ISO; returns an ISO timestamp (UTC) or null. */
export function xeroTimestamp(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const m = v.match(/^\/Date\((-?\d+)([+-]\d{4})?\)\/$/);
  if (m) return new Date(Number(m[1])).toISOString();
  // ISO without zone from Xero means UTC.
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Calendar date (YYYY-MM-DD). Xero document dates are dates, not instants: take the UTC calendar day. */
export function xeroDate(v: unknown): string | null {
  const t = xeroTimestamp(v);
  return t ? t.slice(0, 10) : null;
}

/** "QU-12345" -> "12345". Staff type quote numbers without the prefix; Make adds "QU-" when it looks them up. */
export function quoteNoOf(quoteNumber: string | null | undefined): string | null {
  if (!quoteNumber) return null;
  const s = quoteNumber.trim().toUpperCase().replace(/^QU-?/, '').trim();
  return s || null;
}

/** Normalises a quote number typed on a form for matching ("qu-123 " -> "123"). */
export const normaliseQuoteNo = quoteNoOf;

/** "INV-001234" and "001234" match; Delivery Note INVOICENO is typed without the prefix (Make prepends "INV-"). */
export function invoiceNoOf(invoiceNumber: string | null | undefined): string | null {
  if (!invoiceNumber) return null;
  const s = invoiceNumber.trim().toUpperCase().replace(/^INV-?/, '').trim();
  return s || null;
}

export function normaliseVin(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.toUpperCase().replace(/\s+/g, '');
  return s.length >= 5 ? s : null;
}

const contactRef = (j: J) => (j.Contact && typeof j.Contact === 'object' ? (j.Contact as J) : {});

export interface LineRow {
  line_no: number;
  line_item_id: string | null;
  item_code: string | null;
  description: string | null;
  quantity: number | null;
  unit_amount: number | null;
  line_amount: number | null;
  tax_amount: number | null;
  currency_code: string | null;
}

function lines(j: J, currency: string | null): LineRow[] {
  const list = Array.isArray(j.LineItems) ? (j.LineItems as J[]) : [];
  return list.map((l, i) => ({
    line_no: i + 1,
    line_item_id: str(l.LineItemID),
    item_code: str(l.ItemCode),
    description: str(l.Description),
    quantity: num(l.Quantity),
    unit_amount: num(l.UnitAmount),
    line_amount: money(l.LineAmount),
    tax_amount: money(l.TaxAmount),
    currency_code: currency,
  }));
}

export function mapContact(j: J) {
  return {
    contact_id: String(j.ContactID),
    name: str(j.Name),
    first_name: str(j.FirstName),
    last_name: str(j.LastName),
    email: str(j.EmailAddress),
    contact_status: str(j.ContactStatus),
    is_customer: typeof j.IsCustomer === 'boolean' ? j.IsCustomer : null,
    updated_utc: xeroTimestamp(j.UpdatedDateUTC),
    raw: j,
  };
}

export function mapQuote(j: J) {
  const currency = str(j.CurrencyCode);
  const c = contactRef(j);
  return {
    row: {
      quote_id: String(j.QuoteID),
      quote_number: str(j.QuoteNumber),
      quote_no: quoteNoOf(str(j.QuoteNumber)),
      reference: str(j.Reference),
      status: str(j.Status),
      contact_id: str(c.ContactID),
      contact_name: str(c.Name),
      quote_date: xeroDate(j.DateString ?? j.Date),
      expiry_date: xeroDate(j.ExpiryDateString ?? j.ExpiryDate),
      currency_code: currency,
      sub_total: money(j.SubTotal),
      total_tax: money(j.TotalTax),
      total: money(j.Total),
      updated_utc: xeroTimestamp(j.UpdatedDateUTC),
      raw: j,
    },
    lines: lines(j, currency),
  };
}

export function mapInvoice(j: J) {
  const currency = str(j.CurrencyCode);
  const c = contactRef(j);
  return {
    row: {
      invoice_id: String(j.InvoiceID),
      invoice_number: str(j.InvoiceNumber),
      invoice_type: str(j.Type),
      reference: str(j.Reference),
      status: str(j.Status),
      contact_id: str(c.ContactID),
      contact_name: str(c.Name),
      invoice_date: xeroDate(j.DateString ?? j.Date),
      due_date: xeroDate(j.DueDateString ?? j.DueDate),
      currency_code: currency,
      sub_total: money(j.SubTotal),
      total_tax: money(j.TotalTax),
      total: money(j.Total),
      amount_due: money(j.AmountDue),
      amount_paid: money(j.AmountPaid),
      amount_credited: money(j.AmountCredited),
      fully_paid_on: xeroDate(j.FullyPaidOnDate),
      has_attachments: j.HasAttachments === true,
      updated_utc: xeroTimestamp(j.UpdatedDateUTC),
      raw: j,
    },
    lines: lines(j, currency),
  };
}

export function mapPayment(j: J) {
  const inv = j.Invoice && typeof j.Invoice === 'object' ? (j.Invoice as J) : {};
  return {
    payment_id: String(j.PaymentID),
    invoice_id: str(inv.InvoiceID),
    invoice_number: str(inv.InvoiceNumber),
    payment_date: xeroDate(j.Date),
    amount: money(j.Amount),
    currency_code: str(inv.CurrencyCode) ?? str(j.CurrencyCode),
    status: str(j.Status),
    payment_type: str(j.PaymentType),
    reference: str(j.Reference),
    updated_utc: xeroTimestamp(j.UpdatedDateUTC),
    raw: j,
  };
}

export function mapAttachment(j: J, parentType: 'Invoice' | 'Quote', parentId: string) {
  return {
    attachment_id: String(j.AttachmentID),
    parent_type: parentType,
    parent_id: parentId,
    file_name: str(j.FileName),
    mime_type: str(j.MimeType),
    content_length: num(j.ContentLength),
    raw: j,
  };
}

/** Latest UpdatedDateUTC in a page, for the incremental high-water mark. */
export function maxUpdated(rows: Array<{ updated_utc: string | null }>, current: string | null): string | null {
  let best = current;
  for (const r of rows) if (r.updated_utc && (!best || r.updated_utc > best)) best = r.updated_utc;
  return best;
}
