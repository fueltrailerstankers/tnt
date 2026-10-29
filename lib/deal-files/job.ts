import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { openRow, type EntryRow } from '@/lib/forms/entries';
import { loadForms } from '@/lib/forms/forms';
import { fetchAll as all } from '@/lib/db/paging';
import { linkDealFiles, type EntryIn, type InvoiceIn, type QuoteIn } from './link';

const LINKED_FORMS = ['deal', 'request-for-invoice', 'job-card', 'trailer-inspection-checklist', 'release-form', 'delivery-note'];
/** Rebuilds deal_files for one org from the mirror and the form entries. Idempotent; never deletes a file. */
export async function rebuildDealFiles(db: SupabaseClient, orgId: string): Promise<number> {
  const quotes = await all<QuoteIn>((a, b) => db.from('xero_quotes').select('quote_id, quote_no, contact_name, status').eq('org_id', orgId).order('quote_id').range(a, b));
  const invoices = await all<InvoiceIn>((a, b) => db.from('xero_invoices').select('invoice_id, invoice_number, reference, contact_name, invoice_type, status').eq('org_id', orgId).order('invoice_id').range(a, b));
  const forms = (await loadForms(db, orgId)).filter((f) => LINKED_FORMS.includes(f.slug));
  const entries: EntryIn[] = [];
  for (const form of forms) {
    const rows = await all<EntryRow>((a, b) => db.from('entries').select('id, form_id, org_id, number, status, summary, data, data_encrypted, created_at, updated_at, submitted_at').eq('form_id', form.id).order('number').range(a, b));
    for (const r of rows) {
      const e = openRow(form, r);
      entries.push({ id: e.id, form: form.slug, number: e.number, status: e.status, data: e.data });
    }
  }
  const files = linkDealFiles(quotes, invoices, entries);
  for (let i = 0; i < files.length; i += 500) {
    const { error } = await db.from('deal_files').upsert(files.slice(i, i + 500).map((f) => ({ org_id: orgId, ...f })), { onConflict: 'org_id,quote_no' });
    if (error) throw new Error(`deal files: ${error.message}`);
  }
  return files.length;
}
