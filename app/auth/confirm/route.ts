import { redirect } from 'next/navigation';
import type { NextRequest } from 'next/server';
import { safeNext } from '@/lib/security/safe-next';
import { createClient } from '@/lib/supabase/server';
import { auditSignIn } from '@/lib/users/auth-audit';
import { ACCEPT_PATH, ConfirmQuery } from '@/lib/users/rules';

export const dynamic = 'force-dynamic';

/**
 * Invite and sign-in links land here (`?token_hash=&type=&next=`). The token hash is verified with Supabase Auth,
 * which sets the session cookies; the person then sets a password (`next`, default /admin/account/password).
 * Invalid or used links go to /login with a plain message. The token is never logged (no-referrer, no-store).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = ConfirmQuery.safeParse({ token_hash: sp.get('token_hash'), type: sp.get('type') });
  if (!parsed.success) redirect('/login?error=link');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type: parsed.data.type, token_hash: parsed.data.token_hash });
  if (error || !data.user) redirect('/login?error=link');
  await auditSignIn(data.user.id, 'link');
  const next = sp.get('next') ? safeNext(sp.get('next')) : ACCEPT_PATH;
  redirect(next);
}
