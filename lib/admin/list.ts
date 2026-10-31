import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ENTRY_COLUMNS, openRow, type EntryRecord, type EntryRow } from '@/lib/forms/entries';
import type { FormRecord } from '@/lib/forms/forms';
import { BULK_MAX, dateRange, escapeLike, type GridQuery, type ViewCounts } from './grid';

const CLEAR_COLUMNS = 'id, form_id, org_id, number, status, summary, created_at, updated_at, submitted_at';

export interface ListedEntry extends EntryRecord {
  isRead: boolean;
}

export interface ListOptions {
  /**
   * Open encrypted rows (DEAL, Delivery Note). Default true for compatibility. The grid passes false: it only shows
   * the clear number, summary, created and status, so field values are never decrypted for a list.
   */
  decrypt?: boolean;
}

/** An entry row as a record; encrypted rows stay sealed (data = {}) unless decrypt is set. */
function toRecord(form: FormRecord, r: EntryRow, decrypt: boolean): EntryRecord {
  if (form.encrypt && !decrypt) return openRow({ ...form, encrypt: false }, { ...r, data: {}, data_encrypted: null });
  return openRow(form, r);
}

/** One page of entries through list_entries (RLS-scoped to the caller). Encrypted rows are opened server-side unless decrypt is false. */
export async function listEntries(
  userDb: SupabaseClient, form: FormRecord, q: GridQuery, timeZone: string, limit: number, offset: number, opts: ListOptions = {},
): Promise<{ rows: ListedEntry[]; total: number }> {
  const range = dateRange(q, timeZone);
  const { data, error } = await userDb.rpc('list_entries', {
    p_form: form.id,
    p_view: q.view,
    p_status: q.status,
    p_q: q.q ? escapeLike(q.q.toLowerCase()) : null,
    p_from: range.from,
    p_to: range.to,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(`list_entries: ${error.message}`);
  const list = (data ?? []) as Array<EntryRow & { is_read: boolean; total: number }>;
  const decrypt = opts.decrypt ?? true;
  return {
    rows: list.map((r) => ({ ...toRecord(form, { ...r, form_id: form.id, org_id: form.orgId }, decrypt), isRead: r.is_read })),
    total: list.length ? Number(list[0].total) : 0,
  };
}

/**
 * Chip counts for the grid: all, unread and per status, under the current search and date filter (the view itself
 * is ignored). One list_entries call per count with a single row, so RLS and the unread rule stay in one place.
 */
export async function viewCounts(
  userDb: SupabaseClient, form: FormRecord, q: GridQuery, timeZone: string, statuses: readonly string[],
): Promise<ViewCounts> {
  const count = async (view: GridQuery['view'], status: string | null) =>
    (await listEntries(userDb, form, { ...q, view, status }, timeZone, 1, 0, { decrypt: false })).total;
  const [all, unread, ...per] = await Promise.all([
    count('all', null),
    count('unread', null),
    ...statuses.map((s) => count('status', s)),
  ]);
  return { all, unread, byStatus: Object.fromEntries(statuses.map((s, i) => [s, per[i]])) };
}

/** The selected entries of one form by number, newest first (Export selected). RLS-scoped; sealed unless decrypt. */
export async function listEntriesByNumbers(
  userDb: SupabaseClient, form: FormRecord, numbers: readonly number[], opts: ListOptions = {},
): Promise<EntryRecord[]> {
  const nums = [...new Set(numbers)].filter((n) => Number.isInteger(n) && n > 0).slice(0, BULK_MAX);
  if (!nums.length) return [];
  const decrypt = opts.decrypt ?? true;
  // A sealed listing never fetches the ciphertext at all.
  const columns = form.encrypt && !decrypt ? CLEAR_COLUMNS : ENTRY_COLUMNS;
  const { data, error } = await userDb.from('entries').select(columns)
    .eq('form_id', form.id).in('number', nums).order('number', { ascending: false }).limit(BULK_MAX);
  if (error) throw new Error(`entries: ${error.message}`);
  return ((data ?? []) as unknown as EntryRow[]).map((r) => toRecord(form, { ...r, data: r.data ?? {}, data_encrypted: r.data_encrypted ?? null }, decrypt));
}
