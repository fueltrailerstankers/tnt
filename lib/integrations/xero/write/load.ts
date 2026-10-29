import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { escapeLike } from '@/lib/admin/grid';
import { loadEntryById, loadFiles, type EntryRecord } from '@/lib/forms/entries';
import { loadForm, type FormRecord } from '@/lib/forms/forms';
import { documentName } from '@/lib/pdf/documents';
import { XeroReader } from '../client';
import type { Connection } from '../connection';
import { invoiceNoOf, quoteNoOf } from '../mappers';
import { upsertList } from '../sync';
import type { DealInput } from './plan-deal';
import type { DeliveryInput } from './plan-delivery';
import type { MergeInput } from './plan-merge';
import type { ReleaseInput } from './plan-release';
import type { RfiInput } from './plan-rfi';
import { text, type AttachmentIn, type ContactIn, type EntryIn, type InvoiceIn, type QuoteIn, type QuoteLineIn } from './types';

// Planner inputs. Read from the mirror. In live mode the records a write depends on are first re-read from Xero
// (GET only, through XeroReader) and upserted, so a stale mirror can never cause a second invoice.

type J = Record<string, unknown>;

const QUOTE_COLS = 'quote_id, quote_number, status, contact_id, quote_date, currency_code, total, raw';
const INVOICE_COLS = 'invoice_id, invoice_number, invoice_type, reference, status, contact_id, contact_name, total, amount_due, fully_paid_on, currency_code';
const CONTACT_COLS = 'contact_id, name, first_name, last_name, email';

/** Xero `where` string literal: double quotes escaped. */
const whereLit = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export class Refresher {
  private reader: XeroReader | null;
  constructor(private db: SupabaseClient, private conn: Connection | null, live: boolean) {
    this.reader = live && conn && conn.status === 'connected' ? new XeroReader(db, conn) : null;
  }
  async get(entity: 'quotes' | 'contacts' | 'invoices', path: string, params: Record<string, string>) {
    if (!this.reader || !this.conn) return;
    const key = entity === 'quotes' ? 'Quotes' : entity === 'contacts' ? 'Contacts' : 'Invoices';
    const res = await this.reader.get<J>(path, { params });
    const list = (res?.[key] as J[] | undefined) ?? [];
    if (list.length) await upsertList(this.db, this.conn, entity, list);
  }
  async flush() {
    await this.reader?.flushRate().catch(() => undefined);
  }
}

const toEntryIn = (e: EntryRecord): EntryIn => ({ id: e.id, number: e.number, status: e.status, updatedAt: e.updatedAt, data: e.data });

async function entryOf(db: SupabaseClient, orgId: string, slug: string, entryId: string): Promise<{ form: FormRecord; entry: EntryRecord } | null> {
  const form = await loadForm(db, orgId, slug);
  if (!form) return null;
  const entry = await loadEntryById(db, form, entryId);
  return entry ? { form, entry } : null;
}

async function quotesFor(db: SupabaseClient, orgId: string, quoteNo: string, r: Refresher): Promise<{ quotes: QuoteIn[]; lines: QuoteLineIn[] }> {
  await r.get('quotes', '/Quotes', { QuoteNumber: `QU-${quoteNo}` });
  const { data } = await db.from('xero_quotes').select(QUOTE_COLS).eq('org_id', orgId).eq('quote_number', `QU-${quoteNo}`);
  const quotes = (data ?? []) as QuoteIn[];
  if (!quotes.length) return { quotes, lines: [] };
  const { data: lines } = await db.from('xero_quote_lines').select('line_no, item_code, description, quantity, unit_amount').eq('org_id', orgId).eq('quote_id', quotes[0].quote_id).order('line_no');
  return { quotes, lines: (lines ?? []) as QuoteLineIn[] };
}

export async function loadDealInput(db: SupabaseClient, orgId: string, entryId: string, r: Refresher): Promise<DealInput | null> {
  const e = await entryOf(db, orgId, 'deal', entryId);
  if (!e) return null;
  const no = quoteNoOf(text(e.entry.data.QUOTENO));
  const q = no ? await quotesFor(db, orgId, no, r) : { quotes: [], lines: [] };
  return { entry: toEntryIn(e.entry), quotes: q.quotes, lines: q.lines };
}

export async function loadRfiInput(db: SupabaseClient, orgId: string, entryId: string, r: Refresher, today: string): Promise<RfiInput | null> {
  const e = await entryOf(db, orgId, 'request-for-invoice', entryId);
  if (!e) return null;
  const files = await loadFiles(db, entryId);
  const typed = text(e.entry.data.QuoteNo);
  const no = quoteNoOf(typed);
  const base: RfiInput = {
    entry: toEntryIn(e.entry), files, documentName: documentName(e.form, e.entry, 1), quotes: [], quoteLines: [],
    quoteContact: null, contactsByEmail: [], contactsByName: [], invoicesByReference: [], today,
  };
  if (!no) return base;
  const q = await quotesFor(db, orgId, no, r);
  base.quotes = q.quotes;
  base.quoteLines = q.lines;
  const quote = q.quotes[0];
  if (quote?.contact_id) {
    await r.get('contacts', `/Contacts/${encodeURIComponent(quote.contact_id)}`, {});
    const { data } = await db.from('xero_contacts').select(CONTACT_COLS).eq('org_id', orgId).eq('contact_id', quote.contact_id).maybeSingle();
    base.quoteContact = (data as ContactIn | null) ?? null;
  }
  const email = base.quoteContact?.email?.trim();
  if (email) {
    await r.get('contacts', '/Contacts', { where: `EmailAddress==${whereLit(email)}` });
    const { data } = await db.from('xero_contacts').select(CONTACT_COLS).eq('org_id', orgId).ilike('email', escapeLike(email)).limit(5);
    base.contactsByEmail = (data ?? []) as ContactIn[];
  }
  const n = e.entry.data.Name as Record<string, unknown> | undefined;
  const full = [text(n?.First), text(n?.Last)].filter(Boolean).join(' ');
  if (full && !base.contactsByEmail.length) {
    await r.get('contacts', '/Contacts', { where: `Name==${whereLit(full)}` });
    const { data } = await db.from('xero_contacts').select(CONTACT_COLS).eq('org_id', orgId).ilike('name', escapeLike(full)).limit(5);
    base.contactsByName = (data ?? []) as ContactIn[];
  }
  // Reference == QuoteNo: Make searches with the typed value; also match the bare number.
  const refs = [...new Set([typed, no].filter(Boolean) as string[])];
  for (const ref of refs) await r.get('invoices', '/Invoices', { where: `Type=="ACCREC" AND Reference==${whereLit(ref)}` });
  const found: InvoiceIn[] = [];
  for (const ref of refs) {
    const { data } = await db.from('xero_invoices').select(INVOICE_COLS).eq('org_id', orgId).ilike('reference', escapeLike(ref));
    for (const i of (data ?? []) as InvoiceIn[]) if (!found.some((x) => x.invoice_id === i.invoice_id)) found.push(i);
  }
  base.invoicesByReference = found;
  return base;
}

export async function loadDeliveryInput(db: SupabaseClient, orgId: string, entryId: string, r: Refresher): Promise<DeliveryInput | null> {
  const e = await entryOf(db, orgId, 'delivery-note', entryId);
  if (!e) return null;
  const files = await loadFiles(db, entryId);
  const no = invoiceNoOf(text(e.entry.data.INVOICENO));
  let invoices: InvoiceIn[] = [];
  if (no) {
    await r.get('invoices', '/Invoices', { InvoiceNumbers: `INV-${no}` });
    const { data } = await db.from('xero_invoices').select(INVOICE_COLS).eq('org_id', orgId).eq('invoice_number', `INV-${no}`);
    invoices = (data ?? []) as InvoiceIn[];
  }
  // The RFI: the Delivery Note's QuoteNo lookup (an RFI entry id), else the stored invoice -> RFI mapping.
  let rfiId = text(e.entry.data.QuoteNo);
  if (!rfiId && invoices[0]) {
    const { data } = await db.from('external_refs').select('internal_id').eq('org_id', orgId).eq('source', 'xero').eq('entity', 'rfi.invoice').eq('external_id', invoices[0].invoice_id).maybeSingle();
    rfiId = (data?.internal_id as string | undefined) ?? null;
  }
  let rfi: DeliveryInput['rfi'] = null;
  if (rfiId && /^[0-9a-f-]{36}$/i.test(rfiId)) {
    const re = await entryOf(db, orgId, 'request-for-invoice', rfiId);
    if (re) rfi = { entry: toEntryIn(re.entry), documentName: documentName(re.form, re.entry, 1) };
  }
  return { entry: toEntryIn(e.entry), files, documentName: documentName(e.form, e.entry, 1), invoices, rfi };
}

export async function loadReleaseInput(db: SupabaseClient, orgId: string, invoiceId: string, r: Refresher): Promise<ReleaseInput | null> {
  await r.get('invoices', `/Invoices/${encodeURIComponent(invoiceId)}`, {});
  const { data: inv } = await db.from('xero_invoices').select(INVOICE_COLS).eq('org_id', orgId).eq('invoice_id', invoiceId).maybeSingle();
  if (!inv) return null;
  const invoice = inv as InvoiceIn;
  let contactEmail: string | null = null;
  if (invoice.contact_id) {
    const { data } = await db.from('xero_contacts').select('email').eq('org_id', orgId).eq('contact_id', invoice.contact_id).maybeSingle();
    contactEmail = (data?.email as string | null) ?? null;
  }
  const { data: ref } = await db.from('external_refs').select('internal_id').eq('org_id', orgId).eq('source', 'xero').eq('entity', 'invoice.release').eq('external_id', invoiceId).maybeSingle();
  return { invoice, contactEmail, existingReleaseEntryId: (ref?.internal_id as string | undefined) ?? null };
}

export async function loadMergeInput(db: SupabaseClient, orgId: string, invoiceId: string): Promise<MergeInput | null> {
  const { data: inv } = await db.from('xero_invoices').select(INVOICE_COLS).eq('org_id', orgId).eq('invoice_id', invoiceId).maybeSingle();
  if (!inv) return null;
  const { data } = await db.from('xero_attachments').select('attachment_id, file_name, mime_type, content_length').eq('org_id', orgId).eq('parent_type', 'Invoice').eq('parent_id', invoiceId);
  return { invoice: inv as InvoiceIn, attachments: (data ?? []) as AttachmentIn[] };
}
