import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export interface OrgMember { userId: string; label: string; role: string }

/**
 * Members of the org who can work leads (admin, staff), for the assign picker and the assignee column.
 * Service role: staff cannot read other members' profiles through RLS. Call only after requirePerm('leads.read').
 */
export async function leadMembers(orgId: string): Promise<OrgMember[]> {
  const db = createAdminClient();
  const { data: ms } = await db.from('memberships').select('user_id, role').eq('org_id', orgId).in('role', ['admin', 'staff']);
  const ids = (ms ?? []).map((m) => m.user_id as string);
  if (!ids.length) return [];
  const { data: ps } = await db.from('profiles').select('id, full_name, email').in('id', ids);
  const byId = new Map((ps ?? []).map((p) => [p.id as string, p as { full_name: string | null; email: string | null }]));
  return (ms ?? []).map((m) => {
    const p = byId.get(m.user_id);
    return { userId: m.user_id, role: m.role, label: p?.full_name || p?.email || 'Member' };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

/** True when the user is an admin or staff member of the org (valid assignee). */
export async function isLeadMember(orgId: string, userId: string): Promise<boolean> {
  const { data } = await createAdminClient().from('memberships').select('user_id').eq('org_id', orgId).eq('user_id', userId).in('role', ['admin', 'staff']).maybeSingle();
  return Boolean(data);
}
