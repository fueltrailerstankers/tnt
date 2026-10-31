import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dateRange } from '@/lib/admin/grid';
import { areaOrFilter, type ActivityFilters, type AuditRow } from './describe';

export const ACTIVITY_PAGE = 50;
const COLS = 'id, created_at, actor_user, action, entity, entity_id, meta';

/**
 * One page of the org's audit log, newest first, through the caller's RLS client (Activity read shows every row).
 * user = rows the member did (actor); area = action prefixes; action = exact; q = exact record id; dates in the org tz.
 */
export async function loadActivity(db: SupabaseClient, orgId: string, f: ActivityFilters, timeZone: string, limit: number, offset: number): Promise<{ rows: AuditRow[]; total: number }> {
  let q = db.from('audit_log').select(COLS, { count: 'exact' }).eq('org_id', orgId);
  if (f.user) q = q.eq('actor_user', f.user);
  const area = f.area ? areaOrFilter(f.area) : null;
  if (area) q = q.or(area);
  if (f.action) q = q.eq('action', f.action);
  if (f.q) q = q.eq('entity_id', f.q);
  const { from, to } = dateRange({ from: f.from ?? null, to: f.to ?? null }, timeZone);
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lt('created_at', to);
  const { data, count, error } = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1);
  if (error) throw new Error('Could not load the activity log');
  return { rows: (data ?? []) as AuditRow[], total: count ?? 0 };
}
