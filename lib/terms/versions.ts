import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

// Terms versions: the exact legal text blocks shown to a signer (for the Delivery Note: terms, declaration,
// waiver, receipt), identified by a sha256 over their canonical form and stored once per (org, key, sha256)
// in terms_versions (0015, append-only). Signature rows and the signed PDF point at the version id.
//
// Pure part: normaliseTermsBlocks, canonicalTermsText, termsSha256, verifyTermsBody.
// Server part: ensureTermsVersion (service-role client, only after the form or role-link checks).
//
// The text is verbatim (typos intentional, see content/*.md). The only normalisation is line endings
// (CRLF/CR -> LF), so the same content checked out on another OS hashes the same. No Unicode normalisation:
// the hash is over the exact code points shown.
//
// The database recomputes the same hash on insert (public.terms_body_sha256, 0015) and refuses a row whose
// sha256 does not match its body, so a stored version is always the hashed text.

export interface TermsBlock {
  /** Stable block id, e.g. 'terms', 'declaration', 'waiver', 'receipt'. */
  id: string;
  /** The exact text (or markup) rendered to the signer. */
  text: string;
}

export const TERMS_KEY = /^[a-z][a-z0-9-]{1,63}$/;
const BLOCK_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Upper bound on all block text together (the DN terms are ~40k characters). */
export const TERMS_MAX_CHARS = 1_000_000;

/** A lone UTF-16 surrogate: not valid Unicode, and Postgres text cannot store it. */
const LONE_SURROGATE = /\p{Cs}/u;

/**
 * Validates blocks (non-empty list, unique well-formed ids, non-empty text, no NUL or lone surrogate, which
 * Postgres text cannot store) and returns them in order with only `id` and `text`, line endings normalised to
 * LF. Throws on bad input.
 */
export function normaliseTermsBlocks(blocks: readonly TermsBlock[]): TermsBlock[] {
  if (!Array.isArray(blocks) || blocks.length === 0) throw new Error('terms: at least one block is required');
  const seen = new Set<string>();
  let total = 0;
  return blocks.map((b, i) => {
    if (!b || typeof b.id !== 'string' || !BLOCK_ID.test(b.id)) throw new Error(`terms: block ${i} has an invalid id`);
    if (seen.has(b.id)) throw new Error(`terms: duplicate block id ${b.id}`);
    seen.add(b.id);
    if (typeof b.text !== 'string') throw new Error(`terms: block ${b.id} has no text`);
    const text = b.text.replace(/\r\n?/g, '\n');
    if (!text.trim()) throw new Error(`terms: block ${b.id} is empty`);
    if (text.includes('\u0000')) throw new Error(`terms: block ${b.id} contains a NUL character`);
    if (LONE_SURROGATE.test(text)) throw new Error(`terms: block ${b.id} contains invalid Unicode`);
    total += text.length;
    if (total > TERMS_MAX_CHARS) throw new Error('terms: text is too long');
    return { id: b.id, text };
  });
}

/**
 * The exact string that is hashed: JSON of the normalised [{id, text}] list in display order, as JSON.stringify
 * writes it (keys id then text, no whitespace, non-ASCII unescaped). JSON keeps block boundaries unambiguous
 * (no separator can be forged inside a text); Postgres rebuilds the same string with to_json (0015).
 */
export function canonicalTermsText(blocks: readonly TermsBlock[]): string {
  return JSON.stringify(normaliseTermsBlocks(blocks).map(({ id, text }) => ({ id, text })));
}

/** Lower-case hex sha256 of the canonical text (UTF-8). */
export function termsSha256(blocks: readonly TermsBlock[]): string {
  return createHash('sha256').update(canonicalTermsText(blocks), 'utf8').digest('hex');
}

const isExactBlock = (b: unknown): b is TermsBlock =>
  !!b && typeof b === 'object' && !Array.isArray(b)
  && Object.keys(b).sort().join(',') === 'id,text';

/**
 * True when a stored terms_versions body is already canonical (blocks of exactly {id, text}, LF line endings)
 * and hashes to its sha256, e.g. before embedding it in a signed PDF. A body that only hashes the same after
 * dropping extra keys or rewriting line endings is not the text that was signed, so it fails.
 */
export function verifyTermsBody(body: unknown, sha256: string): boolean {
  if (!SHA256.test(sha256) || !Array.isArray(body) || !body.every(isExactBlock)) return false;
  try {
    const normalised = normaliseTermsBlocks(body);
    if (normalised.some((b, i) => b.text !== body[i].text)) return false;
    return termsSha256(normalised) === sha256;
  } catch {
    return false;
  }
}

/**
 * Returns the id of the terms_versions row for these exact blocks, inserting it on first use. Idempotent:
 * the same (org, key, blocks) always returns the same id, and a concurrent insert of the same version is
 * resolved through the unique (org_id, key, sha256) key. Pass the service-role client, only after the form
 * or role-link checks; orgId must come from the server (the form or link), never from the client.
 */
export async function ensureTermsVersion(
  admin: SupabaseClient, orgId: string, key: string, blocks: readonly TermsBlock[],
): Promise<string> {
  if (!UUID.test(orgId)) throw new Error('terms: invalid org id');
  if (!TERMS_KEY.test(key)) throw new Error('terms: invalid key');
  const body = normaliseTermsBlocks(blocks);
  const sha256 = termsSha256(body);

  const find = async (): Promise<string | null> => {
    const { data, error } = await admin.from('terms_versions').select('id')
      .eq('org_id', orgId).eq('key', key).eq('sha256', sha256).limit(1);
    if (error) throw new Error(`terms_versions: ${error.message}`);
    return (data as Array<{ id: string }> | null)?.[0]?.id ?? null;
  };

  const existing = await find();
  if (existing) return existing;

  const { data, error } = await admin.from('terms_versions')
    .insert({ org_id: orgId, key, sha256, body })
    .select('id');
  if (error?.code === '23505') {
    const raced = await find();
    if (raced) return raced;
  }
  if (error) throw new Error(`terms_versions: ${error.message}`);
  const id = (data as Array<{ id: string }> | null)?.[0]?.id;
  if (!id) throw new Error('terms_versions: insert returned no row');
  return id;
}
