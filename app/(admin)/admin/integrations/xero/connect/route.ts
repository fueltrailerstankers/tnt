import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { authorizeUrl } from '@/lib/integrations/xero/oauth';
import { xeroConfigured } from '@/lib/integrations/xero/config';
import { randomToken, sha256Hex } from '@/lib/security/crypto';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** Starts the Xero OAuth flow. State is random, stored hashed for 10 minutes, bound to this user and a cookie. */
export async function GET() {
  const member = await requirePerm('integrations.manage');
  if (!xeroConfigured()) redirect('/admin/integrations/xero?error=config');
  const state = randomToken(24);
  await createAdminClient().from('xero_oauth_states').insert({
    state_hash: sha256Hex(state), org_id: member.orgId, user_id: member.userId, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  (await cookies()).set('xero_oauth_state', state, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/admin/integrations/xero', maxAge: 600 });
  redirect(authorizeUrl(state));
}
