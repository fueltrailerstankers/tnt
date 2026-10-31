// Users & access: input schemas and guards. Pure (docs/M7.md sections 1-3).
import { z } from 'zod';
import {
  AREAS, clampAccess, presetOf, ROLES, sameAccess, type AccessMap, type Area, type Level, type MemberStatus, type Role,
} from '@/lib/security/can';

const levelField = z.enum(['none', 'read', 'write']);

/** Reads the matrix radios (`access.<area>`) from a form; missing areas are none. */
export function accessFromForm(get: (key: string) => unknown): Record<Area, Level> {
  return Object.fromEntries(AREAS.map((a) => {
    const v = levelField.safeParse(get(`access.${a}`));
    return [a, v.success ? v.data : 'none'];
  })) as Record<Area, Level>;
}

const name = z.string().trim().min(1).max(120);
const branch = z.string().trim().max(40).transform((v) => v || null).nullable();

export const InviteInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name,
  role: z.enum(ROLES),
  branch,
  method: z.enum(['email', 'link']),
});
export type InviteInput = z.infer<typeof InviteInput>;

export const EditInput = z.object({ name, role: z.enum(ROLES), branch });
export type EditInput = z.infer<typeof EditInput>;

export const NameInput = z.object({ name });

/** Temporary passwords for Add user: at least 12 characters, or generated (shown once). */
export const TEMP_PASSWORD_MIN = 12;
export const AddInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name,
  role: z.enum(ROLES),
  branch,
  password: z.string().max(200).optional(),
  generate: z.boolean(),
}).superRefine((v, ctx) => {
  if (!v.generate && (v.password ?? '').length < TEMP_PASSWORD_MIN) ctx.addIssue({ code: 'custom', path: ['password'], message: 'short' });
});
export type AddInput = z.infer<typeof AddInput>;

const PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
/** A random temporary password (no look-alike characters), from Web Crypto. */
export function generatePassword(length = 16): string {
  const out: string[] = [];
  const buf = new Uint32Array(1);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    // Rejection sampling: no modulo bias.
    if (buf[0] < Math.floor(0x1_0000_0000 / PW_ALPHABET.length) * PW_ALPHABET.length) out.push(PW_ALPHABET[buf[0] % PW_ALPHABET.length]);
  }
  return out.join('');
}

/** What the Add user form shows afterwards. A generated password is shown once and never stored or logged. */
export interface AddState { status: 'idle' | 'error' | 'done'; error?: string; userId?: string; password?: string; values?: { name: string; email: string } }

/** New password (set after an invite, or changed from My account). */
export const PasswordInput = z.object({
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { message: 'The passwords do not match.', path: ['confirm'] });

export interface MemberState { userId: string; role: Role; access: AccessMap; status: MemberStatus }

export type GuardError = 'self' | 'last_admin' | 'admin_only';

/** Areas whose Write only an admin may grant: they control users, the org's settings and the Xero integration. */
export const ADMIN_GRANTED_WRITE: readonly Area[] = ['users', 'integrations', 'settings'];

/** True when a non-admin would grant Write on an admin-granted area the member did not already have. */
export function grantsAdminOnlyWrite(actorRole: Role, before: AccessMap | null, next: AccessMap): boolean {
  return actorRole !== 'admin' && ADMIN_GRANTED_WRITE.some((a) => next[a] === 'write' && before?.[a] !== 'write');
}

/** How long after the invite link is verified a new account may set its first password without a current one. */
export const INVITE_ACCEPT_WINDOW_MS = 60 * 60 * 1000;

/**
 * How an invited member accepts: 'new' (set a first password, no current one) only for an invite that created a
 * brand-new account and whose link was verified within the window; otherwise 'existing' (prove the account with
 * its current password; the password is not changed).
 */
export function acceptMode(m: { inviteNewAccount: boolean; inviteVerifiedAt: string | null }, now = Date.now()): 'new' | 'existing' {
  const at = m.inviteVerifiedAt ? Date.parse(m.inviteVerifiedAt) : NaN;
  return m.inviteNewAccount && Number.isFinite(at) && now - at >= 0 && now - at <= INVITE_ACCEPT_WINDOW_MS ? 'new' : 'existing';
}

const isActiveAdmin = (m: Pick<MemberState, 'role' | 'status'>) => m.role === 'admin' && m.status === 'active';

/**
 * Guards for a change to a member (the server action checks these; 0021's trigger is the SQL backstop for the
 * last admin). `next` is the member after the change, null for removal. `otherActiveAdmins` excludes the target.
 * - self: nobody changes their own preset, access or status, or removes themselves (no self lock-out).
 * - admin_only: only an admin creates, changes, disables or removes an admin account (a member with Users write
 *   cannot reach the admin-only actions by making an admin).
 * - last_admin: the org keeps at least one active admin.
 */
export function changeError(actor: { userId: string; role: Role }, before: MemberState, next: MemberState | null, otherActiveAdmins: number): GuardError | null {
  const actorId = actor.userId;
  if (actor.role !== 'admin' && (before.role === 'admin' || next?.role === 'admin')) return 'admin_only';
  if (next && grantsAdminOnlyWrite(actor.role, before.access, next.access)) return 'admin_only';
  if (before.userId === actorId) {
    if (!next || next.role !== before.role || next.status !== before.status || !sameAccess(next.access, before.access)) return 'self';
  }
  if (isActiveAdmin(before) && (!next || !isActiveAdmin(next)) && otherActiveAdmins < 1) return 'last_admin';
  return null;
}

/**
 * Whether an account-wide Auth ban may change. 'disable': ban only when no other org has the person active.
 * 'lift' (enable or remove): unban only when no other org keeps them disabled.
 */
export function banDecision(kind: 'disable' | 'lift', others: ReadonlyArray<{ status: string }>): boolean {
  return kind === 'disable' ? !others.some((o) => o.status === 'active') : !others.some((o) => o.status === 'disabled');
}

/** Status after Enable: active once the invite was accepted, else back to invited. */
export const enabledStatus = (acceptedAt: string | null): MemberStatus => (acceptedAt ? 'active' : 'invited');

/** Areas whose level changed, as [area, from, to] (codes only, for audit meta). */
export function accessChanges(before: AccessMap, after: AccessMap): Array<[Area, Level, Level]> {
  return AREAS.filter((a) => before[a] !== after[a]).map((a) => [a, before[a], after[a]]);
}

/** Resolves what the editor submitted into what is stored. */
export function resolveAccess(role: Role, submitted: Record<string, unknown>): { access: AccessMap; preset: Role | 'custom' } {
  const access = clampAccess(role, submitted);
  return { access, preset: presetOf(role, access) };
}

export const PRESET_LABEL = (preset: string) => (preset === 'custom' ? 'Custom' : preset.charAt(0).toUpperCase() + preset.slice(1));

export const STATUS_LABEL: Record<MemberStatus, string> = { invited: 'Invited', active: 'Active', disabled: 'Disabled' };
export const STATUS_COLOR: Record<MemberStatus, 'yellow' | 'green' | 'gray'> = { invited: 'yellow', active: 'green', disabled: 'gray' };

/**
 * The invite column on the members list: Pending until they accept, Accepted once they have, Disabled if switched off.
 * A member added with a temporary password has no invite to accept, so it reads Accepted from the start.
 */
export function inviteState(m: { status: MemberStatus; invitedAt: string | null; acceptedAt: string | null }): { label: 'Pending' | 'Accepted'; color: 'yellow' | 'green'; at: string | null } {
  return m.status === 'invited' || !m.acceptedAt
    ? { label: 'Pending', color: 'yellow', at: m.invitedAt }
    : { label: 'Accepted', color: 'green', at: m.acceptedAt };
}

/** Where the invite email and copied links land: our /auth/confirm, then the set-password page. */
export const ACCEPT_PATH = '/admin/account/password';

/**
 * A link straight to /auth/confirm from a generateLink() hashed token, so a copied link does not depend on the Auth
 * server's redirect allow-list or email template. Never logged or stored.
 */
export function confirmLink(appUrl: string, hashedToken: string, type: OtpType = 'invite'): string {
  const u = new URL('/auth/confirm', appUrl);
  u.searchParams.set('token_hash', hashedToken);
  u.searchParams.set('type', type);
  u.searchParams.set('next', ACCEPT_PATH);
  return u.toString();
}

/**
 * Invite links, and recovery links made only for a leftover invite account (an earlier invite link was already
 * opened, then the invite was cancelled): /auth/confirm accepts a recovery link only while that account has a
 * pending new-account invite and no other membership. No magic links: an inviter must never sign in as someone else.
 */
export const OTP_TYPES = ['invite', 'recovery'] as const;
export type OtpType = (typeof OTP_TYPES)[number];
export const ConfirmQuery = z.object({
  token_hash: z.string().min(6).max(200).regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(OTP_TYPES),
});

/** Error codes the users pages show, in plain words. */
export const USER_ERRORS: Record<string, string> = {
  input: 'Check the values and try again.',
  password: `Use a temporary password of at least 12 characters, or generate one.`,
  account_exists: 'An account with that email already exists. Use Invite user instead.',
  exists: 'That person is already a member of this organisation.',
  self: 'You cannot change your own access, disable or remove yourself. Ask another admin.',
  last_admin: 'The organisation needs at least one active admin.',
  admin_only: 'Only an admin can invite, change, disable or remove an admin, or give Write on Users, Integrations or Settings.',
  existing_account: 'This person already has an account: no invite link is made for it. They sign in with their own password and accept the invitation.',
  account_unlinked: 'That email already has an account that is not linked to this app. Ask an admin to check it in Supabase Auth.',
  auth: 'The sign-in service refused the request. Try again, or use Copy invite link.',
  email: 'The invite email could not be sent. Use Copy invite link instead.',
  use_link: 'This person already opened an earlier invite link, so a new invite email cannot be sent. Use Copy invite link and send it to them yourself.',
  not_found: 'That member was not found.',
  state: 'That action does not apply to this member now.',
};

/** What the invite form shows after submitting (useActionState). The link is shown once and never stored. */
export interface InviteState {
  status: 'idle' | 'error' | 'done';
  error?: string;
  userId?: string;
  link?: string;
  /** email: the invite email went out; email_failed / existing: a link was made instead. */
  sent?: 'email' | 'email_failed' | 'existing' | 'link';
  /** Name and email echoed back after an error (React resets the form after an action). */
  values?: { name: string; email: string };
}

export type LinkResult = { link: string } | { error: string };
