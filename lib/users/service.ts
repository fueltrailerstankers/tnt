import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { clampAccess, isRole, MEMBER_STATUSES, type AccessMap, type MemberStatus, type Role } from '@/lib/security/can';
import { createAdminClient } from '@/lib/supabase/admin';

// Users & access data. Reads go through the caller's RLS client (Users read shows other members' rows and
// profiles); names for the activity log use the service role after the audit.read check (names only, no emails).

export interface MemberView {
  userId: string;
  role: Role;
  preset: string;
  access: AccessMap;
  status: MemberStatus;
  name: string;
  email: string | null;
  branch: string | null;
  invitedAt: string | null;
  acceptedAt: string | null;
  disabledAt: string | null;
  lastSeenAt: string | null;
  lastSignInAt: string | null;
  createdAt: string;
}

const COLUMNS = 'user_id, role, preset, access, status, display_name, branch, invited_at, accepted_at, disabled_at, last_seen_at, created_at';

interface Row {
  user_id: string; role: string; preset: string; access: Record<string, unknown> | null; status: string; display_name: string | null;
  branch: string | null; invited_at: string | null; accepted_at: string | null; disabled_at: string | null; last_seen_at: string | null; created_at: string;
}
interface Profile { id: string; full_name: string | null; email: string | null }

const statusOf = (s: string): MemberStatus => ((MEMBER_STATUSES as readonly string[]).includes(s) ? (s as MemberStatus) : 'disabled');

function view(r: Row, p: Profile | undefined, lastSignInAt: string | null): MemberView | null {
  if (!isRole(r.role)) return null;
  return {
    userId: r.user_id, role: r.role, preset: r.preset, access: clampAccess(r.role, r.access), status: statusOf(r.status),
    name: r.display_name || p?.full_name || p?.email || 'Member', email: p?.email ?? null, branch: r.branch,
    invitedAt: r.invited_at, acceptedAt: r.accepted_at, disabledAt: r.disabled_at, lastSeenAt: r.last_seen_at, lastSignInAt, createdAt: r.created_at,
  };
}

async function lastSignIns(db: SupabaseClient, orgId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data } = await db.from('audit_log').select('actor_user, created_at').eq('org_id', orgId).eq('action', 'auth.sign_in')
    .in('actor_user', ids).order('created_at', { ascending: false }).limit(2000);
  for (const r of (data ?? []) as Array<{ actor_user: string; created_at: string }>) if (!out.has(r.actor_user)) out.set(r.actor_user, r.created_at);
  return out;
}

/** Every member of the org, newest first within status order (invited, active, disabled are all listed). */
export async function listMembers(db: SupabaseClient, orgId: string): Promise<MemberView[]> {
  const { data: rows, error } = await db.from('memberships').select(COLUMNS).eq('org_id', orgId).order('created_at', { ascending: true });
  if (error) throw new Error('Could not load members');
  const ids = ((rows ?? []) as Row[]).map((r) => r.user_id);
  const [{ data: profiles }, signIns] = await Promise.all([
    ids.length ? db.from('profiles').select('id, full_name, email').in('id', ids) : Promise.resolve({ data: [] as Profile[] }),
    lastSignIns(db, orgId, ids),
  ]);
  const byId = new Map(((profiles ?? []) as Profile[]).map((p) => [p.id, p]));
  return ((rows ?? []) as Row[])
    .map((r) => view(r, byId.get(r.user_id), signIns.get(r.user_id) ?? null))
    .filter((m): m is MemberView => !!m)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadMember(db: SupabaseClient, orgId: string, userId: string): Promise<MemberView | null> {
  const { data: r } = await db.from('memberships').select(COLUMNS).eq('org_id', orgId).eq('user_id', userId).maybeSingle();
  if (!r) return null;
  const [{ data: p }, signIns] = await Promise.all([
    db.from('profiles').select('id, full_name, email').eq('id', userId).maybeSingle(),
    lastSignIns(db, orgId, [userId]),
  ]);
  return view(r as Row, (p ?? undefined) as Profile | undefined, signIns.get(userId) ?? null);
}

/** Active admins of the org other than userId (the last-admin guard). Service role. */
export async function otherActiveAdmins(orgId: string, userId: string): Promise<number> {
  const { count } = await createAdminClient().from('memberships').select('user_id', { count: 'exact', head: true })
    .eq('org_id', orgId).eq('role', 'admin').eq('status', 'active').neq('user_id', userId);
  return count ?? 0;
}

/** userId -> display name for every member, current or not yet accepted. Service role: call after audit.read or users.read. */
export async function memberNames(orgId: string): Promise<Map<string, string>> {
  const db = createAdminClient();
  const { data: rows } = await db.from('memberships').select('user_id, display_name').eq('org_id', orgId);
  const ids = ((rows ?? []) as Array<{ user_id: string; display_name: string | null }>).map((r) => r.user_id);
  const { data: profiles } = ids.length ? await db.from('profiles').select('id, full_name').in('id', ids) : { data: [] };
  const full = new Map(((profiles ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [p.id, p.full_name]));
  return new Map(((rows ?? []) as Array<{ user_id: string; display_name: string | null }>)
    .map((r) => [r.user_id, r.display_name || full.get(r.user_id) || 'Member']));
}

/** Appends an audit row. Ids and codes only: never emails, names, links or tokens. */
export async function audit(orgId: string, actor: string | null, action: string, entityId: string | null, meta: Record<string, unknown> = {}, entity = 'user') {
  await createAdminClient().from('audit_log').insert({ org_id: orgId, actor_user: actor, action, entity, entity_id: entityId, meta });
}
