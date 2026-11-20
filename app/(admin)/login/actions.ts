'use server';

import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { z } from 'zod';
import { getMember } from '@/lib/security/require';
import { safeNext } from '@/lib/security/safe-next';
import { createClient } from '@/lib/supabase/server';
import { LOGIN_ERROR_PARAM, signInFailureOf } from '@/lib/users/sign-in-error';
import { auditSignIn, auditSignInFailed, auditSignOut } from '@/lib/users/auth-audit';

const credentials = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

export async function signIn(formData: FormData) {
  const parsed = credentials.safeParse({ email: formData.get('email'), password: formData.get('password') });
  const next = safeNext(formData.get('next'));
  if (!parsed.success) redirect(`/login?error=1&next=${encodeURIComponent(next)}`);

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  // Same message for every account-specific failure so the form does not reveal which accounts exist.
  // A service outage (e.g. Supabase answering 402 for a project over its plan limits) hits every
  // account alike, so it gets its own message instead of blaming the password.
  if (error || !data.user) {
    const failure = signInFailureOf(error);
    if (failure === 'unavailable') {
      console.error('sign-in: auth service unavailable', { status: error?.status ?? null, code: error?.code ?? null });
      redirect(`/login?error=${LOGIN_ERROR_PARAM.unavailable}&next=${encodeURIComponent(next)}`);
    }
    // After the response: the audit's account lookup must not make known and unknown emails answer at different speeds.
    const email = parsed.data.email;
    after(() => auditSignInFailed(email));
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }
  await auditSignIn(data.user.id, 'password');
  redirect(next);
}

export async function signOut() {
  const member = await getMember();
  if (member) await auditSignOut(member.orgId, member.userId);
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
