import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomToken, sha256Hex } from '@/lib/security/crypto';

// Role links (/e/<token>) let a public role, e.g. the Inspector, reopen one entry from an email.
// Only sha256(token) is stored; the raw token exists only in the emailed URL.
export const LINK_TTL_DAYS = 30;

export async function createRoleLink(db: SupabaseClient, entryId: string, roleName: string): Promise<string> {
  const token = randomToken(32);
  const expires = new Date(Date.now() + LINK_TTL_DAYS * 86_400_000).toISOString();
  const { error } = await db.from('entry_links').insert({ token: sha256Hex(token), entry_id: entryId, role_name: roleName, expires_at: expires });
  if (error) throw new Error('Could not create role link');
  return token;
}

export interface ResolvedLink {
  id: string;
  entryId: string;
  roleName: string;
}

export async function resolveRoleLink(db: SupabaseClient, token: string): Promise<ResolvedLink | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const hash = sha256Hex(token);
  const { data } = await db.from('entry_links').select('token, entry_id, role_name, expires_at, revoked_at').eq('token', hash).maybeSingle();
  if (!data || data.revoked_at || (data.expires_at && new Date(data.expires_at) < new Date())) return null;
  return { id: data.token, entryId: data.entry_id, roleName: data.role_name };
}
