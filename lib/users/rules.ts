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

/** New password (set after an invite, or changed from My account). */
export const PasswordInput = z.object({
  password: z.string().min(10, 'Use at least 10 characters.').max(200),
  confirm: z.string(),
}).refine((v) => v.password === v.confirm, { message: 'The passwords do not match.', path: ['confirm'] });

export interface MemberState { userId: string; role: Role; access: AccessMap; status: MemberStatus }

export type GuardError = 'self' | 'last_admin';

const isActiveAdmin = (m: Pick<MemberState, 'role' | 'status'>) => m.role === 'admin' && m.status === 'active';

/**
 * Guards for a change to a member (the server action checks these; 0014's trigger is the SQL backstop for the
 * last admin). `next` is the member after the change, null for removal. `otherActiveAdmins` excludes the target.
 * - self: nobody changes their own preset, access or status, or removes themselves (no self lock-out).
 * - last_admin: the org keeps at least one active admin.
 */
export function changeError(actorId: string, before: MemberState, next: MemberState | null, otherActiveAdmins: number): GuardError | null {
  if (before.userId === actorId) {
    if (!next || next.role !== before.role || next.status !== before.status || !sameAccess(next.access, before.access)) return 'self';
  }
  if (isActiveAdmin(before) && (!next || !isActiveAdmin(next)) && otherActiveAdmins < 1) return 'last_admin';
  return null;
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

/** Where the invite email and copied links land: our /auth/confirm, then the set-password page. */
export const ACCEPT_PATH = '/admin/account/password';

/**
 * A link straight to /auth/confirm from a generateLink() hashed token, so a copied link does not depend on the Auth
 * server's redirect allow-list or email template. Never logged or stored.
 */
export function confirmLink(appUrl: string, hashedToken: string, type: 'invite' | 'magiclink'): string {
  const u = new URL('/auth/confirm', appUrl);
  u.searchParams.set('token_hash', hashedToken);
  u.searchParams.set('type', type);
  u.searchParams.set('next', ACCEPT_PATH);
  return u.toString();
}

export const OTP_TYPES = ['invite', 'magiclink', 'recovery', 'email', 'signup'] as const;
export type OtpType = (typeof OTP_TYPES)[number];
export const ConfirmQuery = z.object({
  token_hash: z.string().min(6).max(200).regex(/^[A-Za-z0-9_-]+$/),
  type: z.enum(OTP_TYPES),
});

/** Error codes the users pages show, in plain words. */
export const USER_ERRORS: Record<string, string> = {
  input: 'Check the values and try again.',
  exists: 'That person is already a member of this organisation.',
  self: 'You cannot change your own access, disable or remove yourself. Ask another admin.',
  last_admin: 'The organisation needs at least one active admin.',
  auth: 'The sign-in service refused the request. Try again, or use Copy invite link.',
  email: 'The invite email could not be sent. Use Copy invite link instead.',
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
}

export type LinkResult = { link: string } | { error: string };
