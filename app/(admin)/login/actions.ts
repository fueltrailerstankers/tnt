'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { safeNext } from '@/lib/security/safe-next';
import { createClient } from '@/lib/supabase/server';

const credentials = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

export async function signIn(formData: FormData) {
  const parsed = credentials.safeParse({ email: formData.get('email'), password: formData.get('password') });
  const next = safeNext(formData.get('next'));
  if (!parsed.success) redirect(`/login?error=1&next=${encodeURIComponent(next)}`);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // Same message for every failure so the form does not reveal which accounts exist.
  if (error) redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  redirect(next);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
