import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, encrypt, parseKey } from '@/lib/security/crypto';
import { refreshTokens, XeroAuthError, type TokenSet } from './oauth';

// Xero tokens live only in xero_connections (service role, no client grants), encrypted with ENCRYPTION_KEY
// (AES-256-GCM, AAD = connection id + token kind). Access tokens last 30 minutes; refresh tokens are single
// use, so a refresh is claimed first (xero_claim_refresh) and the new pair is saved before it is used.

export interface Connection {
  id: string;
  orgId: string;
  tenantId: string;
  tenantName: string | null;
  status: 'connected' | 'disconnected' | 'error';
  expiresAt: string | null;
  scopes: string[];
}

const COLS = 'id, org_id, tenant_id, tenant_name, status, expires_at, scopes, access_token_enc, refresh_token_enc';

type Row = {
  id: string; org_id: string; tenant_id: string; tenant_name: string | null; status: Connection['status'];
  expires_at: string | null; scopes: string[]; access_token_enc: string | null; refresh_token_enc: string | null;
};

const key = () => parseKey(process.env.ENCRYPTION_KEY, 'ENCRYPTION_KEY');
const seal = (v: string, id: string, kind: string) => `\\x${encrypt(Buffer.from(v), key(), `${id}:${kind}`).toString('hex')}`;
const open = (v: string, id: string, kind: string) => decrypt(Buffer.from(v.replace(/^\\x/, ''), 'hex'), key(), `${id}:${kind}`).toString('utf8');

const toConn = (r: Row): Connection => ({
  id: r.id, orgId: r.org_id, tenantId: r.tenant_id, tenantName: r.tenant_name, status: r.status, expiresAt: r.expires_at, scopes: r.scopes ?? [],
});

export async function loadConnection(db: SupabaseClient, orgId: string): Promise<Connection | null> {
  const { data } = await db.from('xero_connections').select(COLS).eq('org_id', orgId).order('connected_at', { ascending: false }).limit(1).maybeSingle();
  return data ? toConn(data as Row) : null;
}

/** Saves a fresh token pair for a tenant (connect flow). Creates the connection row on first connect. */
export async function saveConnection(
  db: SupabaseClient, orgId: string, tenant: { tenantId: string; tenantName: string }, t: TokenSet, userId: string,
): Promise<Connection> {
  const { data: existing } = await db.from('xero_connections').select('id').eq('org_id', orgId).eq('tenant_id', tenant.tenantId).maybeSingle();
  let id = existing?.id as string | undefined;
  if (!id) {
    const { data, error } = await db.from('xero_connections').insert({ org_id: orgId, tenant_id: tenant.tenantId, tenant_name: tenant.tenantName, connected_by: userId }).select('id').single();
    if (error || !data) throw new Error('Could not save the Xero connection');
    id = data.id as string;
  }
  // One active connection per org: any other tenant row is disconnected.
  await db.from('xero_connections').update({ status: 'disconnected', access_token_enc: null, refresh_token_enc: null }).eq('org_id', orgId).neq('id', id);
  await storeTokens(db, id, t, { tenant_name: tenant.tenantName, status: 'connected', connected_by: userId, connected_at: new Date().toISOString() });
  return (await loadConnection(db, orgId))!;
}

async function storeTokens(db: SupabaseClient, id: string, t: TokenSet, extra: Record<string, unknown> = {}) {
  const { error } = await db.from('xero_connections').update({
    access_token_enc: seal(t.access_token, id, 'access'),
    refresh_token_enc: seal(t.refresh_token, id, 'refresh'),
    expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    scopes: (t.scope ?? '').split(' ').filter(Boolean),
    last_refreshed_at: new Date().toISOString(),
    refresh_locked_until: null,
    ...extra,
  }).eq('id', id);
  if (error) throw new Error('Could not store Xero tokens');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A valid access token for the connection, refreshing it when it expires within 2 minutes.
 * Survives restarts: everything is read from the database each time.
 */
export async function accessToken(db: SupabaseClient, connectionId: string): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data } = await db.from('xero_connections').select(COLS).eq('id', connectionId).single();
    const r = data as Row | null;
    if (!r || r.status !== 'connected' || !r.access_token_enc || !r.refresh_token_enc) throw new XeroAuthError('not connected');
    const fresh = r.expires_at && new Date(r.expires_at).getTime() - Date.now() > 120_000;
    if (fresh) return open(r.access_token_enc, r.id, 'access');

    const { data: claimed } = await db.rpc('xero_claim_refresh', { p_connection: r.id, p_seconds: 30 });
    const ok = Array.isArray(claimed) ? (claimed[0] as { xero_claim_refresh?: boolean })?.xero_claim_refresh ?? claimed[0] : claimed;
    if (ok !== true) {
      await sleep(1000); // another run is refreshing: wait and re-read
      continue;
    }
    try {
      const t = await refreshTokens(open(r.refresh_token_enc, r.id, 'refresh'));
      await storeTokens(db, r.id, t);
      return t.access_token;
    } catch (e) {
      if (e instanceof XeroAuthError && e.reason === 'invalid_grant') {
        await db.from('xero_connections').update({ status: 'disconnected', refresh_locked_until: null }).eq('id', r.id);
      } else {
        await db.from('xero_connections').update({ refresh_locked_until: null }).eq('id', r.id);
      }
      throw e;
    }
  }
  throw new XeroAuthError('refresh busy');
}

export async function recordRate(db: SupabaseClient, connectionId: string, minRemaining: number | null, dayRemaining: number | null) {
  await db.from('xero_connections').update({ rate_min_remaining: minRemaining, rate_day_remaining: dayRemaining, rate_seen_at: new Date().toISOString() }).eq('id', connectionId);
}

/** Local disconnect: forget the tokens. (Revoking at Xero is done from the Xero app's connected-apps page.) */
export async function disconnect(db: SupabaseClient, connectionId: string) {
  await db.from('xero_connections').update({ status: 'disconnected', access_token_enc: null, refresh_token_enc: null, refresh_locked_until: null }).eq('id', connectionId);
}
