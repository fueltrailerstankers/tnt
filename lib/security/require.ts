import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { assertPerm, ROLES, type Member, type Permission } from './can';

/** Loads the signed-in user's membership (RLS-scoped). Null when signed out or without a membership. */
export async function getMember(): Promise<Member | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data } = await supabase
    .from('memberships')
    .select('org_id, role, branch')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data || !(ROLES as readonly string[]).includes(data.role)) return null;
  return { userId: auth.user.id, orgId: data.org_id, role: data.role, branch: data.branch };
}

/**
 * Call at the top of every server action and route handler that mutates or exposes data.
 * Signed-out users are sent to /login; signed-in users without the permission get ForbiddenError (403).
 */
export async function requirePerm(permission: Permission): Promise<Member> {
  const member = await getMember();
  if (!member) redirect('/login');
  return assertPerm(member, permission);
}
