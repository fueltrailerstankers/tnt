import 'server-only';
import { appEnv } from '@/lib/env';
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

export async function auditSignInFailed(email: string): Promise<void> {
  try {
    const { data: p } = await createAdminClient().from('profiles').select('id').eq('email', email.trim().toLowerCase()).maybeSingle();
    const userId = (p?.id as string | undefined) ?? null;
    const org = userId ? await orgOf(userId) : null;
    if (userId && org) await audit(org, null, 'auth.sign_in_failed', userId);
    else await audit(appEnv().PUBLIC_ORG_ID, null, 'auth.sign_in_failed', null, { known: false }, 'auth');
  } catch {
    // ignore
  }
}
