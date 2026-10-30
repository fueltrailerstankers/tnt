import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomToken, sha256Hex } from '@/lib/security/crypto';
import { linkStatus, type LinkStatus } from './link-status';

// Role links (/e/<token>) let a public role, e.g. the Inspector, reopen one entry from an email.
// Only sha256(token) is stored; the raw token exists only in the emailed URL.
export const LINK_TTL_DAYS = 30;

export async function createRoleLink(db: SupabaseClient, entryId: string, roleName: string): Promise<string> {
  // Only the newest link for an entry and role works: earlier ones are revoked.
  await db.from('entry_links').update({ revoked_at: new Date().toISOString() }).eq('entry_id', entryId).eq('role_name', roleName).is('revoked_at', null);
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

/** Link and its state, including expired and revoked links (the landing page explains them; actions refuse). */
export async function inspectRoleLink(db: SupabaseClient, token: string): Promise<{ status: LinkStatus; link: ResolvedLink | null }> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { status: 'unknown', link: null };
  const { data } = await db.from('entry_links').select('token, entry_id, role_name, expires_at, revoked_at').eq('token', sha256Hex(token)).maybeSingle();
  const status = linkStatus(data, new Date());
  return { status, link: data ? { id: data.token, entryId: data.entry_id, roleName: data.role_name } : null };
}

/** A link that may act now: known, not revoked, not expired. Everything that reads or saves uses this. */
export async function resolveRoleLink(db: SupabaseClient, token: string): Promise<ResolvedLink | null> {
  const { status, link } = await inspectRoleLink(db, token);
  return status === 'ok' ? link : null;
}
