import 'server-only';
import { createHash } from 'node:crypto';
import { appEnv } from '@/lib/env';
import { rateLimit } from '@/lib/security/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { audit } from './service';

// Sign-in, sign-out and failed sign-in rows for the activity log. Never the email or password: failed sign-ins
// record the account id when the email belongs to a member, otherwise nothing that identifies the attempt.
// Best effort: auditing never blocks or changes the sign-in answer.

async function orgOf(userId: string): Promise<string | null> {
  const { data } = await createAdminClient().from('memberships').select('org_id').eq('user_id', userId)
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  return (data?.org_id as string | undefined) ?? null;
}

export async function auditSignIn(userId: string, method: 'password' | 'link'): Promise<void> {
  try {
    const org = await orgOf(userId);
    if (org) await audit(org, userId, 'auth.sign_in', userId, { method });
  } catch {
    // ignore
  }
}

export async function auditSignOut(orgId: string, userId: string): Promise<void> {
  try {
    await audit(orgId, userId, 'auth.sign_out', userId);
  } catch {
    // ignore
  }
}

/** At most this many failed-sign-in rows per account (or unknown email) per window, and per server instance overall. */
export const FAILED_PER_ACCOUNT = 5;
export const FAILED_OVERALL = 100;
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Records a failed sign-in. Rate limited (a password-guessing run cannot flood the log). Call it after the response
 * (next/server after()) so neither the lookup nor the insert shows in the sign-in timing.
 */
export async function auditSignInFailed(email: string): Promise<void> {
  try {
    const key = createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
    if (!rateLimit(`signin-failed:${key}`, FAILED_PER_ACCOUNT, WINDOW_MS) || !rateLimit('signin-failed:all', FAILED_OVERALL, WINDOW_MS)) return;
    const { data: p } = await createAdminClient().from('profiles').select('id').eq('email', email.trim().toLowerCase()).maybeSingle();
    const userId = (p?.id as string | undefined) ?? null;
    const org = userId ? await orgOf(userId) : null;
    if (userId && org) await audit(org, null, 'auth.sign_in_failed', userId);
    else await audit(appEnv().PUBLIC_ORG_ID, null, 'auth.sign_in_failed', null, { known: false }, 'auth');
  } catch {
    // ignore
  }
}
