'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { adoptLeftover, authUserIdByEmail, createAccount, createLink, neverSignedIn, sendInvite, setBanned } from '@/lib/users/auth-admin';
import {
  accessChanges, accessFromForm, AddInput, changeError, EditInput, enabledStatus, generatePassword, banDecision, grantsAdminOnlyWrite, InviteInput, resolveAccess,
  type AddState, type InviteState, type LinkResult,
} from '@/lib/users/rules';
import { audit, loadMember, otherActiveAdmins, otherMemberships } from '@/lib/users/service';

// Users & access server actions. Each one: requirePerm('users.manage') first, Zod validation, then the service-role
// client with every query filtered by member.orgId. Audit rows carry ids and codes only (never emails, names or
// links). The last-admin and self lock-out guards run here; 0021's trigger backs up the last-admin rule in SQL.

const Uuid = z.guid();
const str = (fd: FormData, k: string) => { const v = fd.get(k); return typeof v === 'string' ? v : undefined; };
const echo = (fd: FormData) => ({ name: (str(fd, 'name') ?? '').slice(0, 120), email: (str(fd, 'email') ?? '').slice(0, 254) });
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
  if (!parsed.success || !(await validBranch(member.orgId, parsed.data.branch))) return { status: 'error', error: 'input', values: echo(fd) };
  const { email, name, role, branch, method } = parsed.data;
  if (role === 'admin' && member.role !== 'admin') return { status: 'error', error: 'admin_only', values: echo(fd) };
  const { access, preset } = resolveAccess(role, accessFromForm((k) => fd.get(k)));
  if (grantsAdminOnlyWrite(member.role, null, access)) return { status: 'error', error: 'admin_only', values: echo(fd) };
  const admin = createAdminClient();
  const fail = (error: string): InviteState => ({ status: 'error', error, values: echo(fd) });
  const memberships = async (userId: string) =>
    ((await admin.from('memberships').select('org_id').eq('user_id', userId)).data ?? []) as Array<{ org_id: string }>;
  const addMembership = async (userId: string, newAccount: boolean) => (await admin.from('memberships').insert({
    org_id: member.orgId, user_id: userId, role, access, status: 'invited', invited_by: member.userId,
    invited_at: new Date().toISOString(), display_name: name, branch, invite_new_account: newAccount,
  })).error;

  // An account the app already knows (a member here or elsewhere, a pending invite, a removed member): never make a
  // link or email for it. They sign in with their own password and accept the invitation (acceptMode 'existing').
  const { data: known } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
  if (known) {
    const knownId = known.id as string;
    const theirs = await memberships(knownId);
    if (theirs.some((m) => m.org_id === member.orgId)) return fail('exists');
    // Left over from an invite that was cancelled before they ever signed in (no membership anywhere, never confirmed):
    // not a real account yet, so invite it as a new one (a fresh email or link) instead of the existing-account path.
    if (theirs.length || !(await neverSignedIn(admin, knownId))) {
      if (await addMembership(knownId, false)) return fail('auth');
      await audit(member.orgId, member.userId, 'user.invite', knownId, { preset, access, method: 'existing' });
      revalidatePath('/admin/settings/users');
      return { status: 'done', userId: knownId, sent: 'existing' };
    }
  }

  // A new account: invite email, or a link for the inviter to pass on. Neither is ever made for an existing account.
  let userId: string;
  let link: string | undefined;
  let sent: InviteState['sent'];
  if (method === 'email') {
    const r = await sendInvite(admin, email, name);
    if ('userId' in r) {
      userId = r.userId;
      sent = 'email';
    } else {
      if (r.error === 'exists') return fail('account_unlinked');
      if (r.error === 'auth') return fail('auth');
      const l = await createLink(admin, email, name); // email delivery failed: hand over a link instead
      if ('error' in l) return fail(l.error === 'exists' ? 'account_unlinked' : 'email');
      ({ userId, link } = l);
      sent = 'email_failed';
    }
  } else {
    const l = await createLink(admin, email, name);
    if ('error' in l) return fail(l.error === 'exists' ? 'account_unlinked' : 'auth');
    ({ userId, link } = l);
    sent = 'link';
  }
  // Defence in depth: an account that turns out to have a membership anywhere is not new; drop the link.
  if ((await memberships(userId)).length) return fail('account_unlinked');

  await admin.from('profiles').upsert({ id: userId, email, full_name: name }, { onConflict: 'id', ignoreDuplicates: true });
  if (await addMembership(userId, true)) return fail('auth');
  await audit(member.orgId, member.userId, 'user.invite', userId, { preset, access, method: sent });
  if (link) await audit(member.orgId, member.userId, 'user.invite_link', userId);
  revalidatePath('/admin/settings/users');
  return { status: 'done', userId, link, sent };
}

/**
 * Add user: creates a confirmed account with a temporary password (typed, at least 12 characters, or generated and
 * shown once) and an active membership that must change the password on first sign-in. Existing accounts are
 * refused (invite them instead). Audited without the email or password.
 */
export async function addUser(_prev: AddState, fd: FormData): Promise<AddState> {
  const member = await requirePerm('users.manage');
  const parsed = AddInput.safeParse({
    email: str(fd, 'email'), name: str(fd, 'name'), role: str(fd, 'role'), branch: str(fd, 'branch') ?? null,
    password: str(fd, 'password') || undefined, generate: fd.get('generate') === 'on',
  });
  if (!parsed.success) return { status: 'error', error: parsed.error.issues.some((i) => i.path[0] === 'password') ? 'password' : 'input', values: echo(fd) };
  if (!(await validBranch(member.orgId, parsed.data.branch))) return { status: 'error', error: 'input', values: echo(fd) };
  const { email, name, role, branch, generate } = parsed.data;
  if (role === 'admin' && member.role !== 'admin') return { status: 'error', error: 'admin_only', values: echo(fd) };
  const { access, preset } = resolveAccess(role, accessFromForm((k) => fd.get(k)));
  if (grantsAdminOnlyWrite(member.role, null, access)) return { status: 'error', error: 'admin_only', values: echo(fd) };
  const password = generate ? generatePassword() : parsed.data.password!;
  const admin = createAdminClient();
  let made = await createAccount(admin, email, password, name);
  if ('error' in made && made.error === 'exists') {
    // A leftover from a cancelled invite (no membership anywhere, never signed in) is reused; a real account is refused.
    const knownId = (await authUserIdByEmail(admin, email)) ?? undefined; // works even if the profile row was deleted
    const leftover = knownId
      && !((await admin.from('memberships').select('org_id').eq('user_id', knownId)).data ?? []).length
      && await neverSignedIn(admin, knownId)
      && await adoptLeftover(admin, knownId, password, name);
    if (!knownId || !leftover) return { status: 'error', error: 'account_exists', values: echo(fd) };
    made = { userId: knownId };
  }
  if ('error' in made) return { status: 'error', error: 'auth', values: echo(fd) };
  await admin.from('profiles').upsert({ id: made.userId, email, full_name: name }, { onConflict: 'id', ignoreDuplicates: true });
  const { error } = await admin.from('memberships').insert({
    org_id: member.orgId, user_id: made.userId, role, access, status: 'active', must_change_password: true,
    invited_by: member.userId, invited_at: new Date().toISOString(), display_name: name, branch,
  });
  if (error) return { status: 'error', error: 'auth', values: echo(fd) };
  await audit(member.orgId, member.userId, 'user.add', made.userId, { preset, access, generated: generate });
  revalidatePath('/admin/settings/users');
  return { status: 'done', userId: made.userId, password: generate ? password : undefined };
}

export async function saveUser(userId: string, fd: FormData): Promise<void> {
  const member = await requirePerm('users.manage');
  const before = await targetOf(member.orgId, userId);
  if (!before) redirect('/admin/settings/users?error=not_found');
  const parsed = EditInput.safeParse({ name: str(fd, 'name'), role: str(fd, 'role'), branch: str(fd, 'branch') ?? null });
  if (!parsed.success || !(await validBranch(member.orgId, parsed.data.branch))) redirect(userUrl(before.userId, '/edit?error=input'));
  const { name, role, branch } = parsed.data;
  const { access, preset } = resolveAccess(role, accessFromForm((k) => fd.get(k)));
  const err = changeError(member, before, { ...before, role, access }, await otherActiveAdmins(member.orgId, before.userId));
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

/** Resend invite. `from=list` (hidden field) returns to the members list instead of the member's page. */
export async function resendInvite(userId: string, fd?: FormData): Promise<void> {
  const member = await requirePerm('users.manage');
  const fromList = fd?.get('from') === 'list';
  const back = (q: string) => (fromList ? `/admin/settings/users${q}` : userUrl(typeof userId === 'string' ? userId : '', q));
  const target = await targetOf(member.orgId, userId);
  if (!target) redirect('/admin/settings/users?error=not_found');
  if (target.status !== 'invited' || !target.email) redirect(back('?error=state'));
  if (target.role === 'admin' && member.role !== 'admin') redirect(back('?error=admin_only'));
  // Only a brand-new account gets invite emails (an existing account accepts with its own password).
  if (!target.inviteNewAccount || (await otherMemberships(member.orgId, target.userId)).length) redirect(back('?error=existing_account'));
  const r = await sendInvite(createAdminClient(), target.email, target.name);
  // A failed email goes to the member's page, where Copy invite link is, whichever page asked.
  if (!('userId' in r)) redirect(r.error === 'exists' ? back('?error=state') : userUrl(target.userId, '?error=email'));
  await audit(member.orgId, member.userId, 'user.invite_resend', target.userId);
  redirect(back('?sent=1'));
}

/** A fresh invite link for an invited member, shown once on the admin's screen. */
export async function inviteLinkFor(userId: string): Promise<LinkResult> {
  const member = await requirePerm('users.manage');
  const target = await targetOf(member.orgId, userId);
  if (!target) return { error: 'not_found' };
  if (target.status !== 'invited' || !target.email) return { error: 'state' };
  if (target.role === 'admin' && member.role !== 'admin') return { error: 'admin_only' };
  // Never a link for an account that exists elsewhere: it would let the inviter sign in as that person.
  if (!target.inviteNewAccount || (await otherMemberships(member.orgId, target.userId)).length) return { error: 'existing_account' };
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
  const err = changeError(member, target, { ...target, status: 'disabled' }, await otherActiveAdmins(member.orgId, target.userId));
  if (err) redirect(userUrl(target.userId, `?error=${err}`));
  const { error } = await createAdminClient().from('memberships').update({ status: 'disabled', disabled_at: new Date().toISOString() })
    .eq('org_id', member.orgId).eq('user_id', target.userId);
  if (error) redirect(userUrl(target.userId, `?error=${/LAST_ADMIN/.test(error.message) ? 'last_admin' : 'state'}`));
  // The app refuses the disabled membership on the next request. The Auth ban (refresh tokens stop) is account-wide,
  // so it applies only when no other org has the person active.
  const others = await otherMemberships(member.orgId, target.userId);
  const banned = banDecision('disable', others) ? await setBanned(createAdminClient(), target.userId, true) : false;
  await audit(member.orgId, member.userId, 'user.disable', target.userId, { auth_banned: banned });
  revalidatePath('/admin/settings/users');
  redirect(userUrl(target.userId, '?saved=disabled'));
}

export async function enableUser(userId: string): Promise<void> {
  const member = await requirePerm('users.manage');
  const target = await targetOf(member.orgId, userId);
  if (!target) redirect('/admin/settings/users?error=not_found');
  if (target.status !== 'disabled') redirect(userUrl(target.userId));
  const err = changeError(member, target, { ...target, status: enabledStatus(target.acceptedAt) }, await otherActiveAdmins(member.orgId, target.userId));
  if (err) redirect(userUrl(target.userId, `?error=${err}`));
  await createAdminClient().from('memberships').update({ status: enabledStatus(target.acceptedAt), disabled_at: null })
    .eq('org_id', member.orgId).eq('user_id', target.userId);
  // Lift the Auth ban only when no other org keeps them disabled (that org's ban must stay).
  const unbanned = banDecision('lift', await otherMemberships(member.orgId, target.userId)) ? await setBanned(createAdminClient(), target.userId, false) : false;
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
  const err = changeError(member, target, null, await otherActiveAdmins(member.orgId, target.userId));
  if (err) redirect(userUrl(target.userId, `?error=${err}`));
  const { error } = await createAdminClient().from('memberships').delete().eq('org_id', member.orgId).eq('user_id', target.userId);
  if (error) redirect(userUrl(target.userId, `?error=${/LAST_ADMIN/.test(error.message) ? 'last_admin' : 'state'}`));
  // Without a membership the account has no access; lift a ban from Disable so a later invite works normally.
  if (target.status === 'disabled' && banDecision('lift', await otherMemberships(member.orgId, target.userId))) await setBanned(createAdminClient(), target.userId, false);
  await audit(member.orgId, member.userId, 'user.remove', target.userId, { preset: target.preset, status: target.status });
  revalidatePath('/admin/settings/users');
  // Cancelling a pending invite is the same removal (the invite link stops working: the membership is gone).
  redirect(`/admin/settings/users?removed=${target.status === 'invited' ? 'invite' : '1'}`);
}
