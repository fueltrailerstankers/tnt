import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { xeroConfig } from '@/lib/integrations/xero/config';
import { saveConnection } from '@/lib/integrations/xero/connection';
import { exchangeCode, listTenants } from '@/lib/integrations/xero/oauth';
import { enqueue } from '@/lib/jobs/outbox';
import { safeEqual, sha256Hex } from '@/lib/security/crypto';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const back = (q: string) => redirect(`/admin/integrations/xero?${q}`);

/** Xero redirects here after consent. Checks state (cookie + stored hash, same user, unexpired), stores tokens encrypted. */
export async function GET(req: Request) {
  const member = await requirePerm('integrations.manage');
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  const jar = await cookies();
  const cookieState = jar.get('xero_oauth_state')?.value ?? '';
  jar.delete({ name: 'xero_oauth_state', path: '/admin/integrations/xero' });
  if (url.searchParams.get('error')) back('error=denied');
  if (!code || !state || !cookieState || !safeEqual(state, cookieState)) back('error=state');

  const db = createAdminClient();
  const { data: row } = await db.from('xero_oauth_states').select('org_id, user_id, expires_at').eq('state_hash', sha256Hex(state)).maybeSingle();
  await db.from('xero_oauth_states').delete().eq('state_hash', sha256Hex(state));
  if (!row || row.user_id !== member.userId || row.org_id !== member.orgId || new Date(row.expires_at) < new Date()) back('error=state');

  let connectedTenant: string | null = null;
  let failed = false;
  try {
    const tokens = await exchangeCode(code!);
    const tenants = (await listTenants(tokens.access_token)).filter((t) => t.tenantType === 'ORGANISATION');
    const wanted = xeroConfig().XERO_TENANT_ID;
    const tenant = wanted ? tenants.find((t) => t.tenantId === wanted) : tenants[0];
    // redirect() throws, so it must not run inside this try: the catch would turn it into error=exchange.
    if (tenant) {
      await saveConnection(db, member.orgId, tenant, tokens, member.userId);
      connectedTenant = tenant.tenantId;
    }
  } catch {
    failed = true;
  }
  if (failed) back('error=exchange');
  if (!connectedTenant) back('error=tenant');
  await db.from('audit_log').insert({ org_id: member.orgId, actor_user: member.userId, action: 'xero.connect', entity: 'xero_connection', entity_id: connectedTenant!, meta: { scopes: xeroConfig().XERO_SCOPES } });
  await enqueue(db, member.orgId, 'deal-files.rebuild', {}, { uniquePending: true });
  back('connected=1');
}
