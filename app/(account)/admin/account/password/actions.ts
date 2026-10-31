'use server';

import { redirect } from 'next/navigation';
import { getMember } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { ACCEPT_PATH, acceptMode, PasswordInput } from '@/lib/users/rules';
import { audit } from '@/lib/users/service';

// Self-service password and invite acceptance. The check is the session plus the caller's own membership (read
// with the service role here, because invited and must-change members get nothing through RLS).

/** The caller's invite state: whether this invite may set a first password without the current one. */
async function inviteState(orgId: string, userId: string) {
  const { data } = await createAdminClient().from('memberships').select('invite_new_account, invite_verified_at')
    .eq('org_id', orgId).eq('user_id', userId).maybeSingle();
  return acceptMode({ inviteNewAccount: data?.invite_new_account === true, inviteVerifiedAt: (data?.invite_verified_at as string | null) ?? null });
}

async function currentPasswordOk(fd: FormData): Promise<boolean> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const current = fd.get('current');
  if (!auth.user?.email || typeof current !== 'string' || !current.length || current.length > 200) return false;
  return !(await supabase.auth.signInWithPassword({ email: auth.user.email, password: current })).error;
}

async function activate(orgId: string, userId: string) {
  await createAdminClient().from('memberships').update({ status: 'active', accepted_at: new Date().toISOString(), invite_verified_at: null })
    .eq('org_id', orgId).eq('user_id', userId).eq('status', 'invited');
  await audit(orgId, userId, 'user.accept', userId);
}

/**
 * Sets the signed-in person's password.
 * - Invite of a brand-new account, link verified within the hour: the first password, no current one (accepts).
 * - Temporary password (Add user): they just signed in with it, so no current one.
 * - Everyone else (active members; invites of existing accounts): the current password is required.
 */
export async function setPassword(fd: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');
  const member = await getMember();
  if (!member || member.status === 'disabled') redirect(`${ACCEPT_PATH}?error=access`);
  const parsed = PasswordInput.safeParse({ password: fd.get('password'), confirm: fd.get('confirm') });
  if (!parsed.success) redirect(`${ACCEPT_PATH}?error=${parsed.error.issues[0]?.path[0] === 'confirm' ? 'mismatch' : 'short'}`);

  const firstPassword = member.status === 'invited'
    ? (await inviteState(member.orgId, member.userId)) === 'new'
    : member.mustChangePassword === true;
  if (!firstPassword && !(await currentPasswordOk(fd))) redirect(`${ACCEPT_PATH}?error=current`);
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) redirect(`${ACCEPT_PATH}?error=auth`);

  if (member.status === 'invited') {
    await activate(member.orgId, member.userId);
    redirect('/admin');
  }
  if (member.mustChangePassword) {
    await createAdminClient().from('memberships').update({ must_change_password: false }).eq('org_id', member.orgId).eq('user_id', member.userId);
    await audit(member.orgId, member.userId, 'auth.password', member.userId, { first: true });
    redirect('/admin');
  }
  await audit(member.orgId, member.userId, 'auth.password', member.userId);
  redirect('/admin/account?password=1');
}

/** An existing account accepts an invitation by proving it is theirs (current password); the password stays. */
export async function acceptInvite(fd: FormData): Promise<void> {
  const member = await getMember();
  if (!member) redirect('/login');
  if (member.status !== 'invited') redirect('/admin');
  if (!(await currentPasswordOk(fd))) redirect(`${ACCEPT_PATH}?error=current`);
  await activate(member.orgId, member.userId);
  redirect('/admin');
}
