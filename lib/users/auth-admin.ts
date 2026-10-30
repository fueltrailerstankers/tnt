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
 * A copyable sign-in link for an invited person, without sending email: an invite link for a new or not yet
 * confirmed account, a magic link for an account that already exists (e.g. a member of another org).
 */
export async function createLink(admin: SupabaseClient, email: string, name: string): Promise<{ userId: string; link: string } | AuthFail> {
  const options = { data: { full_name: name }, redirectTo: inviteRedirect() };
  let type: 'invite' | 'magiclink' = 'invite';
  let res = await admin.auth.admin.generateLink({ type, email, options });
  if (res.error && isExists(res.error)) {
    type = 'magiclink';
    res = await admin.auth.admin.generateLink({ type, email, options: { redirectTo: options.redirectTo } });
  }
  const token = res.data?.properties?.hashed_token;
  if (res.error || !res.data?.user || !token) return { error: 'auth' };
  return { userId: res.data.user.id, link: confirmLink(appEnv().APP_URL, token, type) };
}

/** Bans or unbans the account in Supabase Auth. */
export async function setBanned(admin: SupabaseClient, userId: string, banned: boolean): Promise<boolean> {
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: banned ? BAN : 'none' });
  return !error;
}
