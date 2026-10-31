import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { appEnv } from '@/lib/env';
import { ACCEPT_PATH, confirmLink } from './rules';

// Supabase Auth admin calls for Users & access. Service-role client only, after requirePerm('users.manage').
// Links carry a one-time token: they are returned to the admin's screen once and never logged, stored or audited.

type AuthFail = { error: 'exists' | 'email' | 'auth' };

/** Banned for ~100 years: Supabase Auth refuses sign-in and token refresh, so the sessions stop. */
const BAN = '876000h';

const isExists = (e: { status?: number; code?: string; message?: string }) =>
  e.code === 'email_exists' || e.code === 'user_already_exists' || /already (been )?registered|already exists/i.test(e.message ?? '');

/** The invite email redirect: our /auth/confirm (the email template must link there with the token hash; docs/M7.md). */
export function inviteRedirect(): string {
  const u = new URL('/auth/confirm', appEnv().APP_URL);
  u.searchParams.set('next', ACCEPT_PATH);
  return u.toString();
}

/** Sends the Supabase invite email. Existing accounts (another org, or a removed member) answer 'exists'. */
export async function sendInvite(admin: SupabaseClient, email: string, name: string): Promise<{ userId: string } | AuthFail> {
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { full_name: name }, redirectTo: inviteRedirect() });
  if (error) return { error: isExists(error) ? 'exists' : error.status && error.status >= 500 ? 'email' : 'auth' };
  return data.user ? { userId: data.user.id } : { error: 'auth' };
}

/**
 * A copyable invite link, without sending email, for a NEW account only. An account that already exists answers
 * 'exists' and never gets a link: a sign-in link for someone else's account would hand it to the inviter.
 */
export async function createLink(admin: SupabaseClient, email: string, name: string): Promise<{ userId: string; link: string } | AuthFail> {
  const res = await admin.auth.admin.generateLink({ type: 'invite', email, options: { data: { full_name: name }, redirectTo: inviteRedirect() } });
  if (res.error) return { error: isExists(res.error) ? 'exists' : 'auth' };
  const token = res.data?.properties?.hashed_token;
  if (!res.data?.user || !token) return { error: 'auth' };
  return { userId: res.data.user.id, link: confirmLink(appEnv().APP_URL, token) };
}

/** Creates a confirmed account with a temporary password (Add user). No email is sent. */
export async function createAccount(admin: SupabaseClient, email: string, password: string, name: string): Promise<{ userId: string } | AuthFail> {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (error) return { error: isExists(error) ? 'exists' : 'auth' };
  return data.user ? { userId: data.user.id } : { error: 'auth' };
}

/** Bans or unbans the account in Supabase Auth. */
export async function setBanned(admin: SupabaseClient, userId: string, banned: boolean): Promise<boolean> {
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: banned ? BAN : 'none' });
  return !error;
}

/** True when the Auth account never signed in or confirmed an invite (a leftover from a cancelled invite). Fails closed. */
export async function neverSignedIn(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return false;
  return !data.user.email_confirmed_at && !data.user.last_sign_in_at;
}
