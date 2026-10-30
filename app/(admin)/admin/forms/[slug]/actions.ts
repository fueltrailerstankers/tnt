'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { QuoteImport, SubmitState, UploadTicket } from '@/components/form-engine/types';
import { adminForm } from '@/lib/admin/context';
import { loadEntryByNumber, loadFiles } from '@/lib/forms/entries';
import { customerPanel } from '@/lib/forms/lookup';
import { dealFieldsFromQuote } from '@/lib/integrations/xero/write/plan-deal';
import { dealImportFields } from '@/lib/forms/deal-import';
import { checkableQuoteNo, QUOTE_COLUMNS, QUOTE_SEARCH_MAX, quoteFieldOf, quoteOptions, quoteSearchFilter, type QuoteOption, type QuoteRow } from '@/lib/forms/quote-fields';
import { DOCS_BUCKET, ENTRY_BUCKET, issueUploads, removeObjects } from '@/lib/forms/storage';
import { validateUploadRequest } from '@/lib/forms/uploads';
import { can } from '@/lib/security/can';
import { manualStatuses } from '@/lib/workflow/rules';
import { runAction } from '@/lib/workflow/run-action';

// Staff actions on entries. Each one starts with a permission check (adminForm -> requirePerm);
// runAction additionally enforces the spec's allowedWhen and the per-action permission.

const entryUrl = (slug: string, n: number) => `/admin/forms/${slug}/entries/${n}`;

export async function saveEntryStaff(slug: string, number: number | null, _prev: SubmitState, fd: FormData): Promise<SubmitState> {
  const { member, db, form } = await adminForm(slug, 'admin.access');
  if (fd.get('__uploading')) return { message: 'Wait for the uploads to finish, then save again.', at: Date.now() };
  const entry = number === null ? null : await loadEntryByNumber(db, form, number);
  if (number !== null && !entry) return { message: 'Entry not found.', at: Date.now() };
  const res = await runAction({
    db, form, entry, actionName: String(fd.get('__action') ?? ''), fd,
    actor: { kind: 'staff', member },
    expectedUpdatedAt: String(fd.get('__version') ?? '') || null,
  });
  if (!res.ok) return { message: res.message, errors: res.errors, at: Date.now() };
  revalidatePath(`/admin/forms/${slug}`);
  redirect(`${entryUrl(slug, res.number)}?saved=${encodeURIComponent(res.status)}`);
}

export async function requestUploadStaff(slug: string, field: string, files: Array<{ name: string; size: number; type: string }>): Promise<{ tickets?: UploadTicket[]; error?: string }> {
  const { db, form } = await adminForm(slug, 'entries.write');
  const v = validateUploadRequest(form.spec, field, files);
  if (!v.ok) return { error: v.error };
  return { tickets: await issueUploads(db, field, v.files) };
}

export async function lookupPanelStaff(slug: string, entryId: string): Promise<Array<[string, string]>> {
  const { db, form } = await adminForm(slug, 'entries.read');
  const field = form.spec.fields.find((f) => f.type === 'lookup');
  if (!field || field.type !== 'lookup') return [];
  return customerPanel(db, form.orgId, field.lookup.sourceForm, entryId, false);
}

/**
 * Quote picker search on the form's quote field: bare quote number or customer name, newest first.
 * Reads the Xero mirror through the user's RLS client, scoped to the member's org.
 */
export async function searchQuotesStaff(slug: string, q: string): Promise<QuoteOption[]> {
  const { member, userDb, form } = await adminForm(slug, 'entries.read');
  if (!can(member, 'xero.read') || !quoteFieldOf(form.spec)) return [];
  const filter = quoteSearchFilter(q);
  if (!filter) return [];
  const exactNo = checkableQuoteNo(q);
  const [exact, list] = await Promise.all([
    // The exact number first, so "not found" is never a side effect of the result limit.
    exactNo ? userDb.from('xero_quotes').select(QUOTE_COLUMNS).eq('org_id', member.orgId).eq('quote_no', exactNo).limit(1) : null,
    userDb.from('xero_quotes').select(QUOTE_COLUMNS).eq('org_id', member.orgId).or(filter)
      .order('quote_date', { ascending: false, nullsFirst: false }).order('quote_number', { ascending: false }).limit(QUOTE_SEARCH_MAX),
  ]);
  return quoteOptions([...((exact?.data ?? []) as QuoteRow[]), ...((list.data ?? []) as QuoteRow[])]);
}

/**
 * DEAL "Import from Xero" (handoff DealForm): reads the mirrored quote and its lines (never calls or writes Xero)
 * and returns the values the form fills in: LINE/PARTNO 1..8 and Total, the same mapping as the Submit job.
 */
export async function importQuoteStaff(slug: string, quoteNo: string): Promise<QuoteImport> {
  const { member, userDb } = await adminForm(slug, 'entries.write');
  if (slug !== 'deal' || !can(member, 'xero.read')) return { ok: false, error: 'Import from Xero is not available for this form.' };
  const no = checkableQuoteNo(quoteNo);
  if (!no) return { ok: false, error: 'Type a quote number first.' };
  const { data: quote } = await userDb.from('xero_quotes').select('quote_id, quote_number, total, currency_code')
    .eq('org_id', member.orgId).eq('quote_no', no).limit(1).maybeSingle();
  if (!quote || (quote.quote_number ?? '').toUpperCase() !== `QU-${no}`) return { ok: false, error: `QU-${no} is not in the Xero mirror yet.` };
  const { data: lines } = await userDb.from('xero_quote_lines').select('line_no, item_code, description, quantity, unit_amount')
    .eq('org_id', member.orgId).eq('quote_id', quote.quote_id).order('line_no', { ascending: true }).limit(50);
  const { target, linesImported, total } = dealFieldsFromQuote(quote, lines ?? []);
  return { ok: true, quoteNumber: quote.quote_number as string, lines: linesImported, total, currency: (quote.currency_code as string | null) ?? null, fields: dealImportFields(target) };
}

/** Manual status change (e.g. Store Room APPROVAL -> APPROVED EMAILED). */
export async function setStatus(slug: string, number: number, fd: FormData): Promise<void> {
  const { member, db, form } = await adminForm(slug, 'entries.write');
  const status = String(fd.get('status') ?? '');
  const entry = await loadEntryByNumber(db, form, number);
  if (!entry || !manualStatuses(form.spec).includes(status) || status === entry.status) redirect(entryUrl(slug, number));
  await db.from('entries').update({ status }).eq('id', entry.id);
  await db.from('entry_events').insert({
    entry_id: entry.id, action: 'SetStatus', from_status: entry.status, to_status: status, actor_user: member.userId, actor_role: 'Internal', diff: { changed: [] },
  });
  await db.from('audit_log').insert({ org_id: member.orgId, actor_user: member.userId, action: 'entry.status', entity: 'entry', entity_id: entry.id, meta: { from: entry.status, to: status } });
  revalidatePath(`/admin/forms/${slug}`);
  redirect(entryUrl(slug, number));
}

export async function markRead(slug: string, fd: FormData): Promise<void> {
  const { member, userDb } = await adminForm(slug, 'entries.read');
  const ids = fd.getAll('id').map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
  const unread = fd.get('mode') === 'unread';
  if (ids.length) {
    if (unread) await userDb.from('entry_reads').delete().eq('user_id', member.userId).in('entry_id', ids);
    else await userDb.from('entry_reads').upsert(ids.map((entry_id) => ({ entry_id, user_id: member.userId })), { onConflict: 'entry_id,user_id', ignoreDuplicates: true });
  }
  // Re-render the current grid in place. A redirect here would be applied after any navigation the user makes
  // meanwhile (e.g. clicking a view straight away) and take them back to this page.
  revalidatePath(`/admin/forms/${slug}`);
}

/** Admin only. Removes the entry, its files and generated documents; the audit row keeps ids only. */
export async function deleteEntry(slug: string, number: number, fd: FormData): Promise<void> {
  const { member, db, form } = await adminForm(slug, 'entries.delete');
  if (!can(member, 'entries.delete') || fd.get('confirm') !== String(number)) redirect(`${entryUrl(slug, number)}?delete=confirm`);
  const entry = await loadEntryByNumber(db, form, number);
  if (!entry) redirect(`/admin/forms/${slug}`);
  const files = await loadFiles(db, entry.id);
  const { data: docs } = await db.from('entry_documents').select('storage_path').eq('entry_id', entry.id);
  await db.from('audit_log').insert({ org_id: member.orgId, actor_user: member.userId, action: 'entry.delete', entity: 'entry', entity_id: entry.id, meta: { form: slug, number } });
  const { error } = await db.from('entries').delete().eq('id', entry.id);
  if (error) redirect(`${entryUrl(slug, number)}?delete=failed`);
  await removeObjects(db, ENTRY_BUCKET, files.map((f) => f.storagePath));
  await removeObjects(db, DOCS_BUCKET, (docs ?? []).map((d) => d.storage_path as string));
  revalidatePath(`/admin/forms/${slug}`);
  redirect(`/admin/forms/${slug}`);
}
