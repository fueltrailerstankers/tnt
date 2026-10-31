import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from '@/lib/security/safe-next';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { auditSignIn } from '@/lib/users/auth-audit';
import { ACCEPT_PATH, ConfirmQuery } from '@/lib/users/rules';

export const dynamic = 'force-dynamic';

// Relative Location: stays on the host the browser used (the session cookies are set for it).
const to = (_req: NextRequest, path: string, status: 303 | 307 = 303) =>
  new NextResponse(null, { status, headers: { Location: path, 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' } });
const sameHost = (req: NextRequest, origin: string) => {
  try { return new URL(origin).host === (req.headers.get('x-forwarded-host') ?? req.headers.get('host')); } catch { return false; }
};

/**
 * Invite links land here (type invite, or recovery for a leftover invite account; no magic links)
 * (`?token_hash=&type=&next=`). Opening the link (GET) does NOT use it: mail scanners such as Microsoft Safe Links open
 * every link in an email, which would spend the one-time token before the person clicks. GET only shows the
 * /auth/accept page; its Continue button POSTs here, and only then is the token verified with Supabase Auth.
 * Invalid or used links go to /login with a plain message. The token is never logged (no-referrer, no-store).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const parsed = ConfirmQuery.safeParse({ token_hash: sp.get('token_hash'), type: sp.get('type') });
  if (!parsed.success) return to(req, '/login?error=link');
  const q = new URLSearchParams({ token_hash: parsed.data.token_hash, type: parsed.data.type });
  if (sp.get('next')) q.set('next', safeNext(sp.get('next')));
  return to(req, `/auth/accept?${q}`, 307);
}

export async function POST(req: NextRequest) {
  // Same-origin form posts only (the Continue button on /auth/accept). With no-referrer the browser sends Origin
  // "null", so Sec-Fetch-Site is the check; a real Origin must still match.
  const origin = req.headers.get('origin');
  const site = req.headers.get('sec-fetch-site');
  if ((site && site !== 'same-origin') || (origin && origin !== 'null' && !sameHost(req, origin))) return to(req, '/login?error=link');
  const fd = await req.formData();
  const parsed = ConfirmQuery.safeParse({ token_hash: fd.get('token_hash'), type: fd.get('type') });
  if (!parsed.success) return to(req, '/login?error=link');

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ type: parsed.data.type, token_hash: parsed.data.token_hash });
  if (error || !data.user) return to(req, '/login?error=link');
  if (parsed.data.type === 'recovery') {
    // Recovery links are only made for a leftover invite account: accept one only while that account has a pending
    // new-account invite and no other membership; otherwise end the session it just opened.
    const { data: ms } = await createAdminClient().from('memberships').select('status, invite_new_account').eq('user_id', data.user.id);
    const rows = (ms ?? []) as Array<{ status: string; invite_new_account: boolean | null }>;
    if (rows.length !== 1 || rows[0].status !== 'invited' || rows[0].invite_new_account !== true) {
      await supabase.auth.signOut();
      return to(req, '/login?error=link');
    }
  }
  // Opens the first-password window for invites that created this account (acceptMode 'new').
  await createAdminClient().from('memberships').update({ invite_verified_at: new Date().toISOString() })
    .eq('user_id', data.user.id).eq('status', 'invited').eq('invite_new_account', true);
  await auditSignIn(data.user.id, 'link');
  return to(req, fd.get('next') ? safeNext(fd.get('next')) : ACCEPT_PATH);
}
