// Deal files: one trailer's life from quote to delivery, keyed by quote no. Pure.
//
// The links staff retype today, and how they are matched here:
//   quote no   DEAL.QUOTENO, RFI.QuoteNo, Job Card.QuoteNo, Xero quote "QU-<no>", invoice Reference (set by Make's
//              RFI flow to the quote no)
//   invoice no Release.INVNO, Delivery Note.INVOICENO ("INV-" optional), Xero invoice number
//   VIN        Release.VINNO, Delivery Note.TrailerVinNO, Inspection.TRAILERVINNUMBER, invoice Reference after
//              Make's Delivery Note flow writes the VIN there
//   lookup     Delivery Note.QuoteNo is the id of an RFI entry
// When a form has several entries for the same deal, the newest (highest number) wins.
import { displayValue, type EntryData } from '@/lib/spec/values';
import { invoiceNoOf, normaliseQuoteNo, normaliseVin } from '@/lib/integrations/xero/mappers';

export interface QuoteIn {
  quote_id: string;
  quote_no: string | null;
  contact_name: string | null;
  status: string | null;
}
export interface InvoiceIn {
  invoice_id: string;
  invoice_number: string | null;
  reference: string | null;
  contact_name: string | null;
  invoice_type: string | null;
  status: string | null;
}
export interface EntryIn {
  id: string;
  form: string;
  number: number;
  status: string;
  data: EntryData;
}

export interface DealFileOut {
  quote_no: string;
  quote_id: string | null;
  invoice_ids: string[];
  invoice_numbers: string[];
  vin: string | null;
  customer_name: string | null;
  branch: string | null;
  rep: string | null;
  deal_entry_id: string | null;
  rfi_entry_id: string | null;
  job_card_entry_id: string | null;
  inspection_entry_id: string | null;
  release_entry_id: string | null;
  delivery_entry_id: string | null;
}

const text = (d: EntryData, k: string) => displayValue(d[k]).trim() || null;

function newest(list: EntryIn[]): EntryIn | null {
  return list.reduce<EntryIn | null>((a, b) => (!a || b.number > a.number ? b : a), null);
}

export function linkDealFiles(quotes: QuoteIn[], invoices: InvoiceIn[], entriesIn: EntryIn[]): DealFileOut[] {
  const entries = entriesIn.filter((e) => e.status !== 'Incomplete');
  const byForm = (slug: string) => entries.filter((e) => e.form === slug);
  const quoteField: Record<string, string> = { deal: 'QUOTENO', 'request-for-invoice': 'QuoteNo', 'job-card': 'QuoteNo' };

  const keys = new Set<string>();
  for (const q of quotes) if (q.quote_no && q.status !== 'DELETED') keys.add(q.quote_no);
  for (const [slug, field] of Object.entries(quoteField)) {
    for (const e of byForm(slug)) {
      const k = normaliseQuoteNo(text(e.data, field));
      if (k) keys.add(k);
    }
  }

  const sales = invoices.filter((i) => (i.invoice_type ?? 'ACCREC') === 'ACCREC' && i.status !== 'DELETED' && i.status !== 'VOIDED');
  const rfiById = new Map(byForm('request-for-invoice').map((e) => [e.id, e]));
  const out: DealFileOut[] = [];

  for (const key of [...keys].sort()) {
    const forForm = (slug: string) => newest(byForm(slug).filter((e) => normaliseQuoteNo(text(e.data, quoteField[slug])) === key));
    const quote = quotes.find((q) => q.quote_no === key) ?? null;
    const deal = forForm('deal');
    const rfi = forForm('request-for-invoice');
    const job = forForm('job-card');

    const invs = new Map<string, InvoiceIn>();
    for (const i of sales) if (normaliseQuoteNo(i.reference) === key) invs.set(i.invoice_id, i);
    const invoiceNos = () => new Set([...invs.values()].map((i) => invoiceNoOf(i.invoice_number)).filter(Boolean) as string[]);

    // Delivery Note: linked by its RFI lookup, else by invoice number.
    const deliveries = byForm('delivery-note');
    let delivery = newest(deliveries.filter((d) => {
      const rfiId = text(d.data, 'QuoteNo');
      const r = rfiId ? rfiById.get(rfiId) : undefined;
      return r ? normaliseQuoteNo(text(r.data, 'QuoteNo')) === key : false;
    }));
    let release: EntryIn | null = null;
    let vin: string | null = null;

    // Two rounds: a VIN found in round one can pull in an invoice (Reference = VIN) and so a release in round two.
    for (let round = 0; round < 2; round++) {
      const nos = invoiceNos();
      if (!delivery) delivery = newest(deliveries.filter((d) => nos.has(invoiceNoOf(text(d.data, 'INVOICENO')) ?? '')));
      release = newest(byForm('release-form').filter((r) => nos.has(invoiceNoOf(text(r.data, 'INVNO')) ?? '')));
      vin = normaliseVin(text(delivery?.data ?? {}, 'TrailerVinNO')) ?? normaliseVin(text(release?.data ?? {}, 'VINNO'));
      if (vin) for (const i of sales) if (normaliseVin(i.reference) === vin) invs.set(i.invoice_id, i);
    }
    const inspection = vin ? newest(byForm('trailer-inspection-checklist').filter((e) => normaliseVin(text(e.data, 'TRAILERVINNUMBER')) === vin)) : null;

    const invList = [...invs.values()].sort((a, b) => (a.invoice_number ?? '').localeCompare(b.invoice_number ?? ''));
    const collection = deal?.data.COLLECTIONLOCATION;
    out.push({
      quote_no: key,
      quote_id: quote?.quote_id ?? null,
      invoice_ids: invList.map((i) => i.invoice_id),
      invoice_numbers: invList.map((i) => i.invoice_number).filter(Boolean) as string[],
      vin,
      customer_name: (rfi && text(rfi.data, 'Name')) || quote?.contact_name || invList[0]?.contact_name || null,
      branch: Array.isArray(collection) ? (collection[0] as string) ?? null : deal ? text(deal.data, 'COLLECTIONLOCATION') : null,
      rep: (deal && text(deal.data, 'SALESREP')) || (rfi && text(rfi.data, 'SalesRep')) || null,
      deal_entry_id: deal?.id ?? null,
      rfi_entry_id: rfi?.id ?? null,
      job_card_entry_id: job?.id ?? null,
      inspection_entry_id: inspection?.id ?? null,
      release_entry_id: release?.id ?? null,
      delivery_entry_id: delivery?.id ?? null,
    });
  }
  return out;
}
