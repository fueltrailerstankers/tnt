import 'server-only';
import { xeroConfig } from './config';

// OAuth2 Authorization Code flow against Xero's identity server. These are the ONLY non-GET requests in the
// Xero integration, and they go to the identity server, never to the accounting API.

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
}

export function authorizeUrl(state: string): string {
  const c = xeroConfig();
  const u = new URL('/identity/connect/authorize', c.XERO_LOGIN_URL);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', c.XERO_CLIENT_ID);
  u.searchParams.set('redirect_uri', c.redirectUri);
  u.searchParams.set('scope', c.XERO_SCOPES);
  u.searchParams.set('state', state);
  return u.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const c = xeroConfig();
  const res = await fetch(new URL('/connect/token', c.XERO_IDENTITY_URL), {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.XERO_CLIENT_ID}:${c.XERO_CLIENT_SECRET}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => ({}))) as Partial<TokenSet> & { error?: string };
  // Never include the response body in errors: it can carry tokens.
  if (!res.ok || !json.access_token || !json.refresh_token) throw new XeroAuthError(json.error === 'invalid_grant' ? 'invalid_grant' : `token ${res.status}`);
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_in: json.expires_in ?? 1800, scope: json.scope };
}

export class XeroAuthError extends Error {
  constructor(readonly reason: string) {
    super(`Xero authorisation failed: ${reason}`);
    this.name = 'XeroAuthError';
  }
}

export function exchangeCode(code: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: xeroConfig().redirectUri });
}

export function refreshTokens(refreshToken: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
}

export interface XeroTenant {
  tenantId: string;
  tenantName: string;
  tenantType: string;
}

export async function listTenants(accessToken: string): Promise<XeroTenant[]> {
  const res = await fetch(new URL('/connections', xeroConfig().XERO_API_URL), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new XeroAuthError(`connections ${res.status}`);
  return (await res.json()) as XeroTenant[];
}
