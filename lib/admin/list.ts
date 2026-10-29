import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { openRow, type EntryRecord, type EntryRow } from '@/lib/forms/entries';
import type { FormRecord } from '@/lib/forms/forms';
import { dateRange, escapeLike, type GridQuery } from './grid';

export interface ListedEntry extends EntryRecord {
  isRead: boolean;
}

/** One page of entries through list_entries (RLS-scoped to the caller). Encrypted rows are opened server-side. */
export async function listEntries(
  userDb: SupabaseClient, form: FormRecord, q: GridQuery, timeZone: string, limit: number, offset: number,
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
  return {
    rows: list.map((r) => ({ ...openRow(form, { ...r, form_id: form.id, org_id: form.orgId }), isRead: r.is_read })),
    total: list.length ? Number(list[0].total) : 0,
  };
}
