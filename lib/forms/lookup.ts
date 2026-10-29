import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { displayValue } from '@/lib/spec/values';
import { loadForm } from './forms';
import { loadEntryById } from './entries';

// Delivery Note "Quote no" lookup into Request For Invoice entries, and the read-only customer panel
// that replaces Cognito's empty table. Staff see the full panel; public/role-link pages see a masked one
// (POPIA: an ID number and address must not be readable by anyone holding a quote number).

import { maskId, type LookupOption } from './lookup-types';
export type { LookupOption };

/** Staff: RFI entries for the dropdown, newest first, labelled by Quote no (the RFI display field). */
export async function lookupOptions(db: SupabaseClient, orgId: string, sourceSlug: string, displayField: string): Promise<LookupOption[]> {
  const src = await loadForm(db, orgId, sourceSlug);
  if (!src) return [];
  const { data, error } = await db
    .from('entries')
    .select('id, number, data')
    .eq('form_id', src.id)
    .neq('status', 'Incomplete')
    .order('number', { ascending: false })
    .limit(500);
  if (error) throw new Error(`lookup: ${error.message}`);
  return (data ?? []).map((e) => ({ id: e.id, label: displayValue((e.data as Record<string, unknown>)[displayField]) || `#${e.number}` }));
}

/** Public: exact Quote no match only, newest entry wins. */
export async function lookupExact(db: SupabaseClient, orgId: string, sourceSlug: string, displayField: string, value: string): Promise<LookupOption | null> {
  const src = await loadForm(db, orgId, sourceSlug);
  const v = value.trim();
  if (!src || !v || v.length > 64) return null;
  const { data } = await db
    .from('entries')
    .select('id, number')
    .eq('form_id', src.id)
    .neq('status', 'Incomplete')
    .eq(`data->>${displayField}`, v)
    .order('number', { ascending: false })
    .limit(1);
  const hit = data?.[0];
  return hit ? { id: hit.id, label: v } : null;
}

export async function customerPanel(
  db: SupabaseClient, orgId: string, sourceSlug: string, entryId: string, masked: boolean,
): Promise<Array<[string, string]>> {
  const src = await loadForm(db, orgId, sourceSlug);
  if (!src || !/^[0-9a-f-]{36}$/i.test(entryId)) return [];
  const e = await loadEntryById(db, src, entryId);
  if (!e) return [];
  const addr = (e.data.Address ?? {}) as Record<string, string>;
  const idNo = displayValue(e.data.IDNO);
  if (masked) {
    // Enough for the rep to confirm the right customer at handover, not enough to identify them from a quote no.
    const name = (e.data.Name ?? {}) as Record<string, string>;
    return [
      ['Name', [name.First, name.Last ? `${name.Last.charAt(0)}.` : ''].filter(Boolean).join(' ')],
      ['ID NO', idNo ? maskId(idNo) : ''],
    ];
  }
  return [
    ['Name', displayValue(e.data.Name)],
    ['ID NO', idNo],
    ['Address', [addr.Line1, addr.Line2, addr.City, addr.State, addr.Country].filter(Boolean).join(', ')],
  ];
}
