'use server';

import { redirect } from 'next/navigation';
import { getMember } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { ACCEPT_PATH, PasswordInput } from '@/lib/users/rules';
import { audit } from '@/lib/users/service';

/**
 * Sets the signed-in person's password. Self-service: the check is the session plus a membership that is not disabled.
 * An invited member who sets a password has accepted: their membership becomes active (audited user.accept).
 * An active member changing their password must give the current one first.
 */
export async function setPassword(fd: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/login');
  const member = await getMember();
  if (!member || member.status === 'disabled') redirect(`${ACCEPT_PATH}?error=access`);
  const parsed = PasswordInput.safeParse({ password: fd.get('password'), confirm: fd.get('confirm') });
  if (!parsed.success) redirect(`${ACCEPT_PATH}?error=${parsed.error.issues[0]?.path[0] === 'confirm' ? 'mismatch' : 'short'}`);

  // A temporary password (Add user) was just used to sign in: no need to type it again.
  if (member.status === 'active' && !member.mustChangePassword) {
    const current = fd.get('current');
    const ok = typeof current === 'string' && current.length > 0 && current.length <= 200 && auth.user.email
      ? !(await supabase.auth.signInWithPassword({ email: auth.user.email, password: current })).error
      : false;
    if (!ok) redirect(`${ACCEPT_PATH}?error=current`);
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) redirect(`${ACCEPT_PATH}?error=auth`);

  if (member.status === 'invited') {
    await createAdminClient().from('memberships').update({ status: 'active', accepted_at: new Date().toISOString() })
      .eq('org_id', member.orgId).eq('user_id', member.userId).eq('status', 'invited');
    await audit(member.orgId, member.userId, 'user.accept', member.userId);
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
