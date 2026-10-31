import 'server-only';
import { canArea, isRole, type AccessMap } from '@/lib/security/can';
import { createAdminClient } from '@/lib/supabase/admin';

export interface OrgMember { userId: string; label: string; role: string }

interface MemberRow { user_id: string; role: string; access: AccessMap | null; status: string }

/** Active members with Leads write (admins included): they can work leads. */
const worksLeads = (m: MemberRow, orgId: string) =>
  isRole(m.role) && canArea({ userId: m.user_id, orgId, role: m.role, branch: null, access: m.access ?? undefined, status: m.status === 'active' ? 'active' : 'disabled' }, 'leads', 'write');

/**
 * Members of the org who can work leads (active, Leads write), for the assign picker and the assignee column.
 * Service role: staff cannot read other members' profiles through RLS. Call only after requirePerm('leads.read').
 */
export async function leadMembers(orgId: string): Promise<OrgMember[]> {
  const db = createAdminClient();
  const { data } = await db.from('memberships').select('user_id, role, access, status').eq('org_id', orgId).eq('status', 'active');
  const ms = ((data ?? []) as MemberRow[]).filter((m) => worksLeads(m, orgId));
  const ids = ms.map((m) => m.user_id);
  if (!ids.length) return [];
  const { data: ps } = await db.from('profiles').select('id, full_name, email').in('id', ids);
  const byId = new Map((ps ?? []).map((p) => [p.id as string, p as { full_name: string | null; email: string | null }]));
  return ms.map((m) => {
    const p = byId.get(m.user_id);
    return { userId: m.user_id, role: m.role, label: p?.full_name || p?.email || 'Member' };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

/** True when the user is an active member of the org with Leads write (valid assignee). */
export async function isLeadMember(orgId: string, userId: string): Promise<boolean> {
  const { data } = await createAdminClient().from('memberships').select('user_id, role, access, status').eq('org_id', orgId).eq('user_id', userId).maybeSingle();
  return Boolean(data) && worksLeads(data as MemberRow, orgId);
}
