// Browser autosave of typed form answers (drafts). Pure apart from the small storage helpers at the end, which take
// the storage object as a parameter and never throw.
//
// A draft lives in localStorage under `tt-draft:v1:<audience>:<slug>:<scope>` (scope: `new`, `entry:<number>` or
// `link:<number>`; a role-link token never appears in a key or a value). It holds only typed values:
//   f.<Field>, f.<Field>.<Part>, f.<Field>.other   for text-like, choice, yes/no, rating, name and address fields
//   cl.<n>.pass|fail|comments                       for the kit inspection checklist
// Never: signatures (sig.*), files (file.*), protected email fields, fields locked for the audience, lookups,
// hidden inputs (__version, __action, __hp), Turnstile tokens or anything that looks like a password or secret.
// Encrypted forms (DEAL, Delivery Note, any spec with settings.encryptEntries) are never autosaved.

import { ALWAYS_ENCRYPTED } from '@/lib/forms/builder/spec';
import { inputFields, type FormSpec, type InputField } from '@/lib/spec/types';
import { lockedFor, readFormData, type Audience, type EntryData, type ReadOptions } from '@/lib/spec/values';

export const DRAFT_PREFIX = 'tt-draft:v1:';
/** Drafts older than this are ignored and removed. */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Largest serialized draft kept (characters). A bigger draft is not stored (and an older one is removed). */
export const DRAFT_MAX_CHARS = 64 * 1024;
/** Longest single value kept; longer ones are left out of the draft. */
export const DRAFT_MAX_VALUE = 10_000;
/** Debounce between the last change and the save. */
export const DRAFT_DEBOUNCE_MS = 800;

export type DraftScope = { kind: 'new' } | { kind: 'entry'; number: number } | { kind: 'link'; number: number };
export type DraftValues = Array<[string, string]>;
export interface Draft { values: DraftValues; savedAt: number; base: string | null }

/** Field types whose typed values may be kept. Everything else (file, signature, lookup, table, content...) is not. */
const KEPT_TYPES = new Set([
  'text', 'textarea', 'email', 'date', 'number', 'phone', 'url', 'time', 'datetime', 'currency', 'yesno', 'rating', 'choice', 'name', 'address',
]);
/** Field names that must never be stored, whatever their type. */
const SECRET_NAME = /pass(word|code|phrase)|secret|token|otp|\bpin\b|cvv|card.?number/i;
const CHECKLIST_KEY = /^cl\.(\d{1,4})\.(pass|fail|comments)$/;
const SLUG_RE = /^[a-z0-9-]{1,80}$/;

/** False for encrypted forms (spec flag or a slug that is always encrypted): their answers never touch storage. */
export function draftAllowed(spec: FormSpec): boolean {
  return spec.settings.encryptEntries !== true && !ALWAYS_ENCRYPTED.has(spec.slug);
}

/** The storage key for a form and scope, or null when drafts are not allowed or the input is odd. */
export function draftKey(spec: FormSpec, audience: Audience, scope: DraftScope): string | null {
  if (!draftAllowed(spec) || !SLUG_RE.test(spec.slug)) return null;
  let s: string;
  if (scope.kind === 'new') s = 'new';
  else if (Number.isInteger(scope.number) && scope.number > 0) s = `${scope.kind}:${scope.number}`;
  else return null;
  return `${DRAFT_PREFIX}${audience}:${spec.slug}:${s}`;
}

function keptField(f: InputField, locked: Set<string>): boolean {
  if (!KEPT_TYPES.has(f.type) || locked.has(f.name) || SECRET_NAME.test(f.name)) return false;
  if (f.type === 'email' && f.protected) return false;
  return true;
}

/** Field name -> sub-keys allowed after `f.<name>.` (parts, `other`). */
function allowedFields(spec: FormSpec, audience: Audience): Map<string, Set<string>> {
  const locked = lockedFor(spec, audience);
  const out = new Map<string, Set<string>>();
  for (const f of inputFields(spec)) {
    if (!keptField(f, locked)) continue;
    const subs = new Set<string>();
    if (f.type === 'name' || f.type === 'address') for (const p of f.parts) subs.add(p);
    if (f.type === 'choice' && f.other) subs.add('other');
    out.set(f.name, subs);
  }
  return out;
}

/** Whether one posted key may be kept in a draft. */
function keyAllowed(key: string, fields: Map<string, Set<string>>, checklist: Set<number>): boolean {
  const cl = CHECKLIST_KEY.exec(key);
  if (cl) return checklist.has(Number(cl[1]));
  if (!key.startsWith('f.')) return false;
  const rest = key.slice(2);
  if (fields.has(rest)) return true;
  const dot = rest.lastIndexOf('.');
  if (dot <= 0) return false;
  return fields.get(rest.slice(0, dot))?.has(rest.slice(dot + 1)) ?? false;
}

/**
 * The values of a form post that may be kept in a draft, in order. Non-string values (File objects) and values longer
 * than DRAFT_MAX_VALUE are dropped. Empty strings are kept, so a cleared field restores as cleared.
 */
export function pickDraftValues(spec: FormSpec, entries: Iterable<[string, unknown]>, audience: Audience): DraftValues {
  if (!draftAllowed(spec)) return [];
  const fields = allowedFields(spec, audience);
  const checklist = new Set((spec.checklist ?? []).map((c) => c.itemNo));
  const out: DraftValues = [];
  for (const [k, v] of entries) {
    if (typeof v !== 'string' || v.length > DRAFT_MAX_VALUE) continue;
    if (keyAllowed(k, fields, checklist)) out.push([k, v]);
  }
  return out;
}

/** Same keys and values in the same order. */
export function sameValues(a: DraftValues, b: DraftValues): boolean {
  return a.length === b.length && a.every(([k, v], i) => b[i][0] === k && b[i][1] === v);
}

/** JSON for storage, or null when the draft is bigger than DRAFT_MAX_CHARS. */
export function serializeDraft(d: Draft): string | null {
  const s = JSON.stringify({ v: 1, savedAt: d.savedAt, base: d.base, values: d.values });
  return s.length > DRAFT_MAX_CHARS ? null : s;
}

/**
 * Reads a stored draft. Null when it is missing, not a v1 draft, expired (older than DRAFT_TTL_MS or dated in the
 * future), saved against another version of the entry (`base`), or holds no keepable value. Values are filtered again
 * with the current spec, so a field that became protected, locked or a file since the save is dropped.
 */
export function parseDraft(raw: string | null, spec: FormSpec, audience: Audience, opts: { now: number; base: string | null }): Draft | null {
  if (!raw || raw.length > DRAFT_MAX_CHARS) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const d = o as { v?: unknown; savedAt?: unknown; base?: unknown; values?: unknown };
  if (d.v !== 1 || typeof d.savedAt !== 'number' || !Array.isArray(d.values)) return null;
  if (d.savedAt > opts.now + 60_000 || opts.now - d.savedAt > DRAFT_TTL_MS) return null;
  const base = typeof d.base === 'string' ? d.base : null;
  if (base !== opts.base) return null;
  const pairs = d.values.filter((p): p is [string, string] => Array.isArray(p) && p.length === 2 && typeof p[0] === 'string' && typeof p[1] === 'string');
  const values = pickDraftValues(spec, pairs, audience);
  if (!values.length) return null;
  return { values, savedAt: d.savedAt, base };
}

/**
 * The entry data to show after Restore: the stored values read with the form's own reader (readFormData), applied
 * over `initial` for the fields the draft holds. A value the reader drops (e.g. a malformed phone number) is left empty.
 */
export function restoredData(spec: FormSpec, initial: EntryData, values: DraftValues, opts: ReadOptions = {}): EntryData {
  const get = (k: string) => values.find(([n]) => n === k)?.[1] ?? null;
  const getAll = (k: string) => values.filter(([n]) => n === k).map(([, v]) => v);
  const read = readFormData(spec, { get, getAll }, opts).data;
  const names = new Set<string>();
  let checklist = false;
  for (const [k] of values) {
    if (k.startsWith('cl.')) checklist = true;
    else names.add(k.slice(2).split('.')[0]);
  }
  const out: EntryData = { ...initial };
  for (const f of inputFields(spec)) {
    // Field names never contain dots in the specs, but a name with one is still matched whole.
    if (!names.has(f.name) && !values.some(([k]) => k === `f.${f.name}` || k.startsWith(`f.${f.name}.`))) continue;
    if (read[f.name] === undefined) delete out[f.name];
    else out[f.name] = read[f.name];
  }
  if (checklist && read.checklist !== undefined) out.checklist = read.checklist;
  return out;
}

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago". */
export function draftAge(savedAt: number, now: number): string {
  const min = Math.max(0, Math.floor((now - savedAt) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

// ---------------------------------------------------------------------------------------------------------------
// Storage helpers. Every access is wrapped: private windows, blocked site data and full quotas must never break the
// form, so these return null/false instead of throwing.

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

/** window.localStorage, or null when it is missing or its accessor throws. */
export function browserStorage(): DraftStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readDraftRaw(storage: DraftStorage | null, key: string): string | null {
  try {
    return storage ? storage.getItem(key) : null;
  } catch {
    return null;
  }
}

/** Stores the draft; removes the old one when it is too big. True when written. */
export function writeDraft(storage: DraftStorage | null, key: string, d: Draft): boolean {
  if (!storage) return false;
  const s = serializeDraft(d);
  try {
    if (s === null) {
      storage.removeItem(key);
      return false;
    }
    storage.setItem(key, s);
    return true;
  } catch {
    return false;
  }
}

export function removeDraft(storage: DraftStorage | null, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing to do: the draft expires on its own.
  }
}

/** Removes every expired or unreadable draft of this app (any form). Returns how many were removed. */
export function sweepDrafts(storage: DraftStorage | null, now: number): number {
  if (!storage) return 0;
  try {
    const stale: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (!k || !k.startsWith(DRAFT_PREFIX)) continue;
      let savedAt: unknown;
      try {
        savedAt = (JSON.parse(storage.getItem(k) ?? '') as { savedAt?: unknown }).savedAt;
      } catch {
        savedAt = undefined;
      }
      if (typeof savedAt !== 'number' || now - savedAt > DRAFT_TTL_MS) stale.push(k);
    }
    for (const k of stale) storage.removeItem(k);
    return stale.length;
  } catch {
    return 0;
  }
}
