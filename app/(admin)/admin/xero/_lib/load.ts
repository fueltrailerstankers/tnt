import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MIRROR_PAGE, type MirrorQuery } from '@/lib/admin/mirror';
import { can, type Member } from '@/lib/security/can';

// Reads for the Xero mirror pages. Every read goes through the caller's RLS-scoped client and is pinned to the
// member's org; the pages call requirePerm first. Read only: nothing here writes, and nothing calls Xero.

export interface QuoteRow {
  quote_id: string; quote_number: string | null; quote_no: string | null; reference: string | null; status: string | null;
  contact_name: string | null; quote_date: string | null; expiry_date: string | null; currency_code: string | null;
  sub_total: number | string | null; total_tax: number | string | null; total: number | string | null; synced_at: string | null;
}
export interface InvoiceRow {
  invoice_id: string; invoice_number: string | null; invoice_type: string | null; reference: string | null; status: string | null;
  contact_name: string | null; invoice_date: string | null; due_date: string | null; currency_code: string | null;
  sub_total: number | string | null; total_tax: number | string | null; total: number | string | null;
  amount_due: number | string | null; amount_paid: number | string | null; amount_credited: number | string | null;
  fully_paid_on: string | null; has_attachments: boolean | null; attachments_synced_at: string | null; synced_at: string | null;
}
export interface LineRow {
  line_no: number; item_code: string | null; description: string | null;
  quantity: number | string | null; unit_amount: number | string | null; line_amount: number | string | null;
}
export interface PaymentRow {
  payment_id: string; payment_date: string | null; amount: number | string | null; currency_code: string | null;
  status: string | null; payment_type: string | null; reference: string | null;
}
export interface AttachmentRow { attachment_id: string; file_name: string | null; mime_type: string | null; content_length: number | string | null }

const QUOTE_COLS = 'quote_id, quote_number, quote_no, reference, status, contact_name, quote_date, expiry_date, currency_code, sub_total, total_tax, total, synced_at';
const INVOICE_COLS = 'invoice_id, invoice_number, invoice_type, reference, status, contact_name, invoice_date, due_date, currency_code, sub_total, total_tax, total, amount_due, amount_paid, amount_credited, fully_paid_on, has_attachments, attachments_synced_at, synced_at';

export async function listQuotes(db: SupabaseClient, orgId: string, s: MirrorQuery) {
  let query = db.from('xero_quotes').select(QUOTE_COLS, { count: 'exact' })
    .eq('org_id', orgId).order('quote_date', { ascending: false, nullsFirst: false }).order('quote_number', { ascending: false })
    .range((s.page - 1) * MIRROR_PAGE, s.page * MIRROR_PAGE - 1);
  if (s.q) query = query.or(`quote_number.ilike.*${s.q}*,contact_name.ilike.*${s.q}*,reference.ilike.*${s.q}*`);
  if (s.status) query = query.eq('status', s.status);
  const { data, count } = await query;
  return { rows: (data ?? []) as QuoteRow[], count: count ?? 0 };
}

export async function listInvoices(db: SupabaseClient, orgId: string, s: MirrorQuery, today: string) {
  let query = db.from('xero_invoices').select(INVOICE_COLS, { count: 'exact' })
    .eq('org_id', orgId).order('invoice_date', { ascending: false, nullsFirst: false }).order('invoice_number', { ascending: false })
    .range((s.page - 1) * MIRROR_PAGE, s.page * MIRROR_PAGE - 1);
  if (s.q) query = query.or(`invoice_number.ilike.*${s.q}*,contact_name.ilike.*${s.q}*,reference.ilike.*${s.q}*`);
  if (s.status === 'OVERDUE') query = query.eq('status', 'AUTHORISED').lt('due_date', today).gt('amount_due', 0);
  else if (s.status) query = query.eq('status', s.status);
  if (s.type !== 'ALL') query = query.eq('invoice_type', s.type);
  const { data, count } = await query;
  return { rows: (data ?? []) as InvoiceRow[], count: count ?? 0 };
}

/** Header facts: the other tab's count (only when readable), the newest synced_at, and whether the last sync failed. */
export async function mirrorHeader(db: SupabaseClient, member: Member, kind: 'quotes' | 'invoices') {
  const table = kind === 'quotes' ? 'xero_quotes' : 'xero_invoices';
  const [quotes, invoices, latest, state] = await Promise.all([
    can(member, 'quotes.read') ? db.from('xero_quotes').select('quote_id', { count: 'exact', head: true }).eq('org_id', member.orgId) : null,
    can(member, 'invoices.read') ? db.from('xero_invoices').select('invoice_id', { count: 'exact', head: true }).eq('org_id', member.orgId).eq('invoice_type', 'ACCREC') : null,
    db.from(table).select('synced_at').eq('org_id', member.orgId).order('synced_at', { ascending: false }).limit(1).maybeSingle(),
    can(member, 'integrations.read')
      ? db.from('xero_sync_state').select('last_error, last_run_at, last_ok_at').eq('org_id', member.orgId).eq('entity', kind).maybeSingle()
      : null,
  ]);
  const st = state?.data as { last_error: string | null; last_run_at: string | null; last_ok_at: string | null } | null | undefined;
  return {
    quoteCount: quotes ? quotes.count ?? 0 : null,
    invoiceCount: invoices ? invoices.count ?? 0 : null,
    syncedAt: (latest.data?.synced_at as string | undefined) ?? null,
    syncFailed: !!st?.last_error && (!st.last_ok_at || (!!st.last_run_at && st.last_run_at > st.last_ok_at)),
  };
}

/** The deal file a quote or invoice belongs to (only with Deals read; RLS agrees). */
async function dealFor(db: SupabaseClient, member: Member, by: { quoteNo?: string | null; invoiceId?: string }): Promise<string | null> {
  if (!can(member, 'deals.read')) return null;
  if (by.quoteNo) {
    const { data } = await db.from('deal_files').select('quote_no').eq('org_id', member.orgId).eq('quote_no', by.quoteNo).maybeSingle();
    return (data?.quote_no as string | undefined) ?? null;
  }
  if (by.invoiceId) {
    const { data } = await db.from('deal_files').select('quote_no').eq('org_id', member.orgId).contains('invoice_ids', [by.invoiceId])
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();
    return (data?.quote_no as string | undefined) ?? null;
  }
  return null;
}

export async function quoteDetail(db: SupabaseClient, member: Member, id: string) {
  const { data: quote } = await db.from('xero_quotes').select(QUOTE_COLS).eq('org_id', member.orgId).eq('quote_id', id).maybeSingle();
  if (!quote) return null;
  const q = quote as QuoteRow;
  const [{ data: lines }, deal] = await Promise.all([
    db.from('xero_quote_lines').select('line_no, item_code, description, quantity, unit_amount, line_amount').eq('org_id', member.orgId).eq('quote_id', id).order('line_no'),
    dealFor(db, member, { quoteNo: q.quote_no }),
  ]);
  return { quote: q, lines: (lines ?? []) as LineRow[], dealQuoteNo: deal };
}

export async function invoiceDetail(db: SupabaseClient, member: Member, id: string) {
  const { data: invoice } = await db.from('xero_invoices').select(INVOICE_COLS).eq('org_id', member.orgId).eq('invoice_id', id).maybeSingle();
  if (!invoice) return null;
  const [{ data: lines }, { data: payments }, { data: files }, deal] = await Promise.all([
    db.from('xero_invoice_lines').select('line_no, item_code, description, quantity, unit_amount, line_amount').eq('org_id', member.orgId).eq('invoice_id', id).order('line_no'),
    db.from('xero_payments').select('payment_id, payment_date, amount, currency_code, status, payment_type, reference').eq('org_id', member.orgId).eq('invoice_id', id).order('payment_date', { ascending: true }),
    db.from('xero_attachments').select('attachment_id, file_name, mime_type, content_length').eq('org_id', member.orgId).eq('parent_type', 'Invoice').eq('parent_id', id).order('file_name'),
    dealFor(db, member, { invoiceId: id }),
  ]);
  return {
    invoice: invoice as InvoiceRow,
    lines: (lines ?? []) as LineRow[],
    payments: (payments ?? []) as PaymentRow[],
    attachments: (files ?? []) as AttachmentRow[],
    dealQuoteNo: deal,
  };
}
