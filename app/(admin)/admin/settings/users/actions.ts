'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { createLink, sendInvite, setBanned } from '@/lib/users/auth-admin';
import {
  accessChanges, accessFromForm, changeError, EditInput, enabledStatus, InviteInput, resolveAccess,
  type InviteState, type LinkResult,
} from '@/lib/users/rules';
import { audit, loadMember, otherActiveAdmins } from '@/lib/users/service';

// Users & access server actions. Each one: requirePerm('users.manage') first, Zod validation, then the service-role
// client with every query filtered by member.orgId. Audit rows carry ids and codes only (never emails, names or
// links). The last-admin and self lock-out guards run here; 0014's trigger backs up the last-admin rule in SQL.

const Uuid = z.string().uuid();
const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' ? v : undefined; };
const userUrl = (id: string, q = '') => `/admin/settings/users/${id}${q}`;

/** The org's location ids (the optional branch scope must be one of them). */
async function validBranch(orgId: string, branch: string | null): Promise<boolean> {
  if (!branch) return true;
  const { data } = await createAdminClient().from('stock_locations').select('id').eq('org_id', orgId).eq('id', branch).maybeSingle();
  return Boolean(data);
}

async function targetOf(orgId: string, userId: unknown) {
  const id = Uuid.safeParse(userId);
  if (!id.success) return null;
  return loadMember(createAdminClient(), orgId, id.data);
}

export async function inviteUser(_prev: InviteState, fd: FormData): Promise<InviteState> {
  const member = await requirePerm('users.manage');
  const parsed = InviteInput.safeParse({ email: str(fd, 'email'), name: str(fd, 'name'), role: str(fd, 'role'), branch: str(fd, 'branch') ?? null, method: str(fd, 'method') });
  if (!parsed.success || !(await validBranch(member.orgId, parsed.data.branch))) return { status: 'error', error: 'input' };
  const { email, name, role, branch, method } = parsed.data;
  const { access, preset } = resolveAccess(role, accessFromForm((k) => fd.get(k)));
  const admin = createAdminClient();

  const isMember = async (userId: string) =>
    Boolean((await admin.from('memberships').select('user_id').eq('org_id', member.orgId).eq('user_id', userId).maybeSingle()).data);
  const { data: known } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
  if (known && (await isMember(known.id as string))) return { status: 'error', error: 'exists' };

  let userId: string;
  let link: string | undefined;
  let sent: InviteState['sent'];
  if (method === 'email') {
    const r = await sendInvite(admin, email, name);
    if ('userId' in r) {
      userId = r.userId;
      sent = 'email';
    } else {
      if (r.error === 'auth') return { status: 'error', error: 'auth' };
      // No email delivery, or the account already exists: hand the admin a link to pass on instead.
      const l = await createLink(admin, email, name);
      if ('error' in l) return { status: 'error', error: r.error === 'email' ? 'email' : 'auth' };
      ({ userId, link } = l);
      sent = r.error === 'email' ? 'email_failed' : 'existing';
    }
  } else {
    const l = await createLink(admin, email, name);
    if ('error' in l) return { status: 'error', error: l.error };
    ({ userId, link } = l);
    sent = 'link';
  }
  if (await isMember(userId)) return { status: 'error', error: 'exists' };

  // A new account gets a profile; an existing one keeps its own (the per-org name is the membership's display_name).
  await admin.from('profiles').upsert({ id: userId, email, full_name: name }, { onConflict: 'id', ignoreDuplicates: true });
  const { error } = await admin.from('memberships').insert({
    org_id: member.orgId, user_id: userId, role, access, status: 'invited', invited_by: member.userId,
    invited_at: new Date().toISOString(), display_name: name, branch,
  });
  if (error) return { status: 'error', error: 'auth' };
  await audit(member.orgId, member.userId, 'user.invite', userId, { preset, access, method: sent });
  if (link) await audit(member.orgId, member.userId, 'user.invite_link', userId);
  revalidatePath('/admin/settings/users');
  return { status: 'done', userId, link, sent };
}

export async function saveUser(userId: string, fd: FormData): Promise<void> {
  const member = await requirePerm('users.manage');
  const before = await targetOf(member.orgId, userId);
  if (!before) redirect('/admin/settings/users?error=not_found');
  const parsed = EditInput.safeParse({ name: str(fd, 'name'), role: str(fd, 'role'), branch: str(fd, 'branch') ?? null });
  if (!parsed.success || !(await validBranch(member.orgId, parsed.data.branch))) redirect(userUrl(before.userId, '/edit?error=input'));
  const { name, role, branch } = parsed.data;
  const { access, preset } = resolveAccess(role, accessFromForm((k) => fd.get(k)));
  const err = changeError(member.userId, before, { ...before, role, access }, await otherActiveAdmins(member.orgId, before.userId));
  if (err) redirect(userUrl(before.userId, `/edit?error=${err}`));

  const { error } = await createAdminClient().from('memberships').update({ role, access, display_name: name, branch })
    .eq('org_id', member.orgId).eq('user_id', before.userId);
  if (error) redirect(userUrl(before.userId, `/edit?error=${/LAST_ADMIN/.test(error.message) ? 'last_admin' : 'input'}`));
  await audit(member.orgId, member.userId, 'user.update', before.userId, {
    preset_from: before.preset, preset_to: preset, role_from: before.role, role_to: role, changes: accessChanges(before.access, access),
    name_changed: name !== before.name, branch_changed: (branch ?? null) !== (before.branch ?? null),
  });
  revalidatePath('/admin/settings/users');
  redirect(userUrl(before.userId, '?saved=1'));
}

export async function resendInvite(userId: string): Promise<void> {
  const member = await requirePerm('users.manage');
  const target = await targetOf(member.orgId, userId);
  if (!target) redirect('/admin/settings/users?error=not_found');
  if (target.status !== 'invited' || !target.email) redirect(userUrl(target.userId, '?error=state'));
  const r = await sendInvite(createAdminClient(), target.email, target.name);
  if (!('userId' in r)) redirect(userUrl(target.userId, `?error=${r.error === 'exists' ? 'state' : 'email'}`));
  await audit(member.orgId, member.userId, 'user.invite_resend', target.userId);
  redirect(userUrl(target.userId, '?sent=1'));
}

/** A fresh invite link for an invited member, shown once on the admin's screen. */
export async function inviteLinkFor(userId: string): Promise<LinkResult> {
  const member = await requirePerm('users.manage');
  const target = await targetOf(member.orgId, userId);
  if (!target) return { error: 'not_found' };
  if (target.status !== 'invited' || !target.email) return { error: 'state' };
  const l = await createLink(createAdminClient(), target.email, target.name);
  if ('error' in l || l.userId !== target.userId) return { error: 'auth' };
  await audit(member.orgId, member.userId, 'user.invite_link', target.userId);
  return { link: l.link };
}

export async function disableUser(userId: string): Promise<void> {
  const member = await requirePerm('users.manage');
  const target = await targetOf(member.orgId, userId);
  if (!target) redirect('/admin/settings/users?error=not_found');
  if (target.status === 'disabled') redirect(userUrl(target.userId));
  const err = changeError(member.userId, target, { ...target, status: 'disabled' }, await otherActiveAdmins(member.orgId, target.userId));
  if (err) redirect(userUrl(target.userId, `?error=${err}`));
  const { error } = await createAdminClient().from('memberships').update({ status: 'disabled', disabled_at: new Date().toISOString() })
    .eq('org_id', member.orgId).eq('user_id', target.userId);
  if (error) redirect(userUrl(target.userId, `?error=${/LAST_ADMIN/.test(error.message) ? 'last_admin' : 'state'}`));
  // Banned in Auth too, so refresh tokens stop working; the app already refuses the disabled membership.
  const banned = await setBanned(createAdminClient(), target.userId, true);
  await audit(member.orgId, member.userId, 'user.disable', target.userId, { auth_banned: banned });
  revalidatePath('/admin/settings/users');
  redirect(userUrl(target.userId, '?saved=disabled'));
}

export async function enableUser(userId: string): Promise<void> {
  const member = await requirePerm('users.manage');
  const target = await targetOf(member.orgId, userId);
  if (!target) redirect('/admin/settings/users?error=not_found');
  if (target.status !== 'disabled') redirect(userUrl(target.userId));
  await createAdminClient().from('memberships').update({ status: enabledStatus(target.acceptedAt), disabled_at: null })
    .eq('org_id', member.orgId).eq('user_id', target.userId);
  const unbanned = await setBanned(createAdminClient(), target.userId, false);
  await audit(member.orgId, member.userId, 'user.enable', target.userId, { auth_unbanned: unbanned });
  revalidatePath('/admin/settings/users');
  redirect(userUrl(target.userId, '?saved=enabled'));
}

/** Removes the membership. The account and its history stay (audit rows keep the user id). */
export async function removeUser(userId: string, fd: FormData): Promise<void> {
  const member = await requirePerm('users.manage');
  const target = await targetOf(member.orgId, userId);
  if (!target) redirect('/admin/settings/users?error=not_found');
  if (fd.get('confirm') !== 'remove') redirect(userUrl(target.userId, '?error=input'));
  const err = changeError(member.userId, target, null, await otherActiveAdmins(member.orgId, target.userId));
  if (err) redirect(userUrl(target.userId, `?error=${err}`));
  const { error } = await createAdminClient().from('memberships').delete().eq('org_id', member.orgId).eq('user_id', target.userId);
  if (error) redirect(userUrl(target.userId, `?error=${/LAST_ADMIN/.test(error.message) ? 'last_admin' : 'state'}`));
  // Without a membership the account has no access; lift a ban from Disable so a later invite works normally.
  if (target.status === 'disabled') await setBanned(createAdminClient(), target.userId, false);
  await audit(member.orgId, member.userId, 'user.remove', target.userId, { preset: target.preset, status: target.status });
  revalidatePath('/admin/settings/users');
  redirect('/admin/settings/users?removed=1');
}
