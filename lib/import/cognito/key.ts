import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, encrypt, parseKey } from '@/lib/security/crypto';
import { ImportJobError } from './progress';

// The org's Cognito API key lives only in cognito_api_keys (service role, no client grants), AES-256-GCM encrypted
// with ENCRYPTION_KEY (AAD binds it to the org). Only the last 4 characters, who saved it and when are in clear.
// It is decrypted only inside the import job and the Test connection action, never returned to a page, logged or
// put into an error message.

const aad = (orgId: string) => `cognito-api-key:${orgId}`;

function encryptionKey(): Buffer {
  try {
    return parseKey(process.env.ENCRYPTION_KEY, 'ENCRYPTION_KEY');
  } catch {
    throw new ImportJobError('encryption_key_missing');
  }
}

/** Postgres bytea hex literal of the sealed key. Pure apart from the key argument (tested). */
export function sealApiKey(apiKey: string, orgId: string, key: Buffer): string {
  return `\\x${encrypt(Buffer.from(apiKey, 'utf8'), key, aad(orgId)).toString('hex')}`;
}

export function openApiKey(bytea: string, orgId: string, key: Buffer): string {
  return decrypt(Buffer.from(bytea.replace(/^\\x/, ''), 'hex'), key, aad(orgId)).toString('utf8');
}

/** Last 4 characters shown to admins ("key ending in abcd"). */
export const last4 = (apiKey: string) => apiKey.slice(-4);

export interface ApiKeyInfo {
  last4: string;
  createdAt: string;
  createdBy: string | null;
}

export async function apiKeyInfo(db: SupabaseClient, orgId: string): Promise<ApiKeyInfo | null> {
  const { data, error } = await db.from('cognito_api_keys').select('last4, created_at, created_by').eq('org_id', orgId).maybeSingle();
  if (error) throw new Error('cognito_api_keys read failed');
  return data ? { last4: data.last4 as string, createdAt: data.created_at as string, createdBy: (data.created_by as string | null) ?? null } : null;
}

/** Saves or replaces the org's key. */
export async function saveApiKey(db: SupabaseClient, orgId: string, apiKey: string, userId: string): Promise<void> {
  const row = { org_id: orgId, key_enc: sealApiKey(apiKey, orgId, encryptionKey()), last4: last4(apiKey), created_by: userId, created_at: new Date().toISOString() };
  const { error } = await db.from('cognito_api_keys').upsert(row, { onConflict: 'org_id' });
  if (error) throw new Error('cognito_api_keys write failed');
}

export async function removeApiKey(db: SupabaseClient, orgId: string): Promise<boolean> {
  const { data, error } = await db.from('cognito_api_keys').delete().eq('org_id', orgId).select('org_id');
  if (error) throw new Error('cognito_api_keys delete failed');
  return (data ?? []).length > 0;
}

/** The decrypted key, or null when none is saved. Throws ImportJobError('key_unreadable') if it cannot be opened. */
export async function loadApiKey(db: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await db.from('cognito_api_keys').select('key_enc').eq('org_id', orgId).maybeSingle();
  if (error) throw new Error('cognito_api_keys read failed');
  if (!data?.key_enc) return null;
  const key = encryptionKey();
  try {
    return openApiKey(data.key_enc as string, orgId, key);
  } catch {
    throw new ImportJobError('key_unreadable');
  }
}
