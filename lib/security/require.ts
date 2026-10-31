import 'server-only';
import { forbidden, redirect } from 'next/navigation';
import { cache } from 'react';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { can, clampAccess, isRole, MEMBER_STATUSES, type Member, type MemberStatus, type Permission } from './can';

/** last_seen_at is written at most this often per member (ms). */
const SEEN_EVERY = 5 * 60 * 1000;

/**
 * Loads the signed-in user's membership (RLS-scoped: a member always reads their own row) with its resolved access
 * map and status. Null when signed out or without a membership. Deduplicated per request (layout, shell and page
 * share one lookup). Invited and disabled members are returned with their status; can() refuses them everything.
 */
export const getMember = cache(async (): Promise<Member | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from('memberships')
    .select('id, org_id, role, branch, access, status, last_seen_at, must_change_password')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data || !isRole(data.role)) return null;
  const status: MemberStatus = (MEMBER_STATUSES as readonly string[]).includes(data.status) ? data.status : 'disabled';
  if (status === 'active') await touchLastSeen(data.id as string, data.last_seen_at as string | null);
  return {
    userId: auth.user.id,
    orgId: data.org_id,
    role: data.role,
    branch: data.branch,
    access: clampAccess(data.role, data.access as Record<string, unknown> | null),
    status,
    mustChangePassword: data.must_change_password === true,
  };
});

/** Best effort: the users list shows "last seen". Never breaks a request. Service role (members cannot write memberships). */
async function touchLastSeen(membershipId: string, last: string | null): Promise<void> {
  if (last && Date.now() - Date.parse(last) < SEEN_EVERY) return;
  try {
    await createAdminClient().from('memberships').update({ last_seen_at: new Date().toISOString() }).eq('id', membershipId);
  } catch {
    // ignore
  }
}

/**
 * Call at the top of every page, server action and route handler that mutates or exposes data.
 * Signed-out users are sent to /login; signed-in users without the permission (or not active) get 403
 * (forbidden(): app/forbidden.tsx for pages, a 403 response for route handlers and server actions).
 */
export async function requirePerm(permission: Permission): Promise<Member> {
  const member = await getMember();
  if (!member) redirect('/login');
  // A temporary password (Add user) must be changed before anything else.
  if (member.mustChangePassword && member.status === 'active') redirect('/admin/account/password');
  if (!can(member, permission)) forbidden();
  return member;
}
