// Lead to Xero matching. Pure. Rules from BUILD_PLAN 4.7 (the Make "Quote Matches" and "Invoiced Leads"
// flows): the lead's normalised email or phone matches a Xero contact; quotes with status SENT, ACCEPTED,
// DECLINED or INVOICED have "gone out"; invoices count only from a start date (default 2026-10-01) and
// with a value greater than 0; the invoiced total is a running sum of those invoices.

export const GONE_OUT_STATUSES = ['SENT', 'ACCEPTED', 'DECLINED', 'INVOICED'] as const;
export const DEFAULT_INVOICE_START = '2026-10-01';
/** app_settings key holding the invoice start date ("YYYY-MM-DD"). */
export const INVOICE_START_SETTING = 'leads.invoice_match_from';
/** Invoices that never stood for the customer. */
const DEAD_INVOICE_STATUSES = new Set(['DELETED', 'VOIDED']);

export interface ContactRow { contact_id: string; email_norm: string | null; phone_norm: string | null }
export interface QuoteRow {
  quote_id: string; quote_number: string | null; status: string | null; contact_id: string | null;
  quote_date: string | null; updated_utc?: string | null; total: number | string | null; currency_code: string | null;
}
export interface InvoiceRow {
  invoice_id: string; invoice_number: string | null; invoice_type?: string | null; status: string | null; contact_id: string | null;
  invoice_date: string | null; total: number | string | null; currency_code: string | null;
}

export interface LeadMatch {
  contactIds: string[];
  quote: { id: string; number: string | null; status: string | null; total: number | null; currency: string | null } | null;
  invoice: { id: string; number: string | null } | null;
  invoiceCount: number;
  invoicedTotal: number | null;
  invoicedCurrency: string | null;
}

export const NO_MATCH: LeadMatch = { contactIds: [], quote: null, invoice: null, invoiceCount: 0, invoicedTotal: null, invoicedCurrency: null };

export function matchContacts(lead: { email_norm: string | null; phone_norm: string | null }, contacts: readonly ContactRow[]): string[] {
  return [...new Set(contacts.filter((c) =>
    (lead.email_norm && c.email_norm && c.email_norm === lead.email_norm) ||
    (lead.phone_norm && c.phone_norm && c.phone_norm === lead.phone_norm)).map((c) => c.contact_id))].sort();
}

const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));
const desc = (a: string | null | undefined, b: string | null | undefined) => (b ?? '').localeCompare(a ?? '');

export function isGoneOut(status: string | null | undefined): boolean {
  return (GONE_OUT_STATUSES as readonly string[]).includes((status ?? '').toUpperCase());
}

export function countsAsInvoice(inv: InvoiceRow, start: string): boolean {
  if (inv.invoice_type && inv.invoice_type !== 'ACCREC') return false;
  if (DEAD_INVOICE_STATUSES.has((inv.status ?? '').toUpperCase())) return false;
  if (!inv.invoice_date || inv.invoice_date.slice(0, 10) < start) return false;
  const total = num(inv.total);
  return total !== null && Number.isFinite(total) && total > 0;
}

export function matchLead(
  lead: { email_norm: string | null; phone_norm: string | null },
  data: { contacts: readonly ContactRow[]; quotes: readonly QuoteRow[]; invoices: readonly InvoiceRow[] },
  opts: { invoiceStart?: string } = {},
): LeadMatch {
  const contactIds = matchContacts(lead, data.contacts);
  if (!contactIds.length) return NO_MATCH;
  const mine = new Set(contactIds);
  const start = opts.invoiceStart ?? DEFAULT_INVOICE_START;

  const quotes = data.quotes.filter((q) => q.contact_id && mine.has(q.contact_id) && isGoneOut(q.status))
    .sort((a, b) => desc(a.quote_date, b.quote_date) || desc(a.updated_utc, b.updated_utc) || desc(a.quote_number, b.quote_number));
  const q = quotes[0];

  const invoices = data.invoices.filter((i) => i.contact_id && mine.has(i.contact_id) && countsAsInvoice(i, start))
    .sort((a, b) => desc(a.invoice_date, b.invoice_date) || desc(a.invoice_number, b.invoice_number));
  const latest = invoices[0];
  // Running total in the latest invoice's currency: money is never summed across currencies.
  const currency = latest?.currency_code ?? null;
  const same = invoices.filter((i) => (i.currency_code ?? null) === currency);
  const cents = same.reduce((s, i) => s + Math.round((num(i.total) ?? 0) * 100), 0);

  return {
    contactIds,
    quote: q ? { id: q.quote_id, number: q.quote_number, status: q.status, total: num(q.total), currency: q.currency_code } : null,
    invoice: latest ? { id: latest.invoice_id, number: latest.invoice_number } : null,
    invoiceCount: same.length,
    invoicedTotal: latest ? cents / 100 : null,
    invoicedCurrency: currency,
  };
}

/** The lead columns a match writes. */
export function matchColumns(m: LeadMatch) {
  return {
    matched_contact_ids: m.contactIds,
    matched_quote_id: m.quote?.id ?? null,
    matched_quote_number: m.quote?.number ?? null,
    matched_quote_status: m.quote?.status ?? null,
    matched_quote_total: m.quote?.total ?? null,
    matched_quote_currency: m.quote?.currency ?? null,
    matched_invoice_id: m.invoice?.id ?? null,
    matched_invoice_number: m.invoice?.number ?? null,
    invoice_count: m.invoiceCount,
    invoiced_total: m.invoicedTotal,
    invoiced_currency: m.invoicedCurrency,
  };
}
export type MatchColumns = ReturnType<typeof matchColumns>;

/** True when a stored match differs from a fresh one, so a rematch writes and logs only real changes. */
export function matchChanged(stored: Readonly<Record<string, unknown>>, fresh: LeadMatch): boolean {
  const next = matchColumns(fresh);
  return (Object.keys(next) as (keyof MatchColumns)[]).some((k) => {
    const a = stored[k] ?? null;
    const b = next[k] ?? null;
    if (Array.isArray(a) || Array.isArray(b)) {
      return JSON.stringify([...((a as string[] | null) ?? [])].sort()) !== JSON.stringify([...((b as string[] | null) ?? [])].sort());
    }
    if (k === 'matched_quote_total' || k === 'invoiced_total' || k === 'invoice_count') {
      return num(a as number | string | null) !== num(b as number | string | null);
    }
    return String(a ?? '').trim() !== String(b ?? '').trim();
  });
}

/** A valid ISO date setting, or the default start date. */
export function invoiceStartFrom(setting: unknown): string {
  return typeof setting === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(setting) && !Number.isNaN(Date.parse(setting)) ? setting : DEFAULT_INVOICE_START;
}
