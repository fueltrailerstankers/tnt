// Cognito JSON value -> the value shape the forms engine stores (lib/spec/values.ts readFormData). Pure.
// Each converter returns { value } (undefined = store nothing) and an optional issue code. Issues are counted
// per form and field in the report; values themselves are never reported.

export type IssueCode =
  | 'invalid_date'
  | 'invalid_number'
  | 'not_integer'
  | 'not_in_options'
  | 'invalid_value'
  | 'truncated'
  | 'invalid_email'
  | 'checklist_missing'
  | 'checklist_unmatched'
  | 'signature_svg_only'
  | 'file_without_source';

export interface Converted<T> {
  value: T | undefined;
  issue?: IssueCode;
}

/** Same cap as the forms engine (lib/spec/values.ts MAX_TEXT). */
export const MAX_TEXT = 10_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const US_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isoDate(y: number, m: number, d: number): string | undefined {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return undefined;
  return dt.toISOString().slice(0, 10);
}

export function isBlank(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.every(isBlank);
  if (typeof v === 'object') return Object.values(v as Record<string, unknown>).every(isBlank);
  return false;
}

export function toText(v: unknown): Converted<string> {
  if (isBlank(v)) return { value: undefined };
  if (typeof v === 'number' || typeof v === 'boolean') return { value: String(v) };
  if (typeof v !== 'string') return { value: undefined, issue: 'invalid_value' };
  const t = v.trim();
  return t.length > MAX_TEXT ? { value: t.slice(0, MAX_TEXT), issue: 'truncated' } : { value: t };
}

/** Kept even when malformed (history is history); flagged so the spot check can look at it. */
export function toEmail(v: unknown): Converted<string> {
  const r = toText(v);
  if (r.value !== undefined && !r.issue && !EMAIL_RE.test(r.value)) return { value: r.value, issue: 'invalid_email' };
  return r;
}

/**
 * Date field -> YYYY-MM-DD. ASSUMPTION (A9): Cognito returns "YYYY-MM-DD" or an ISO date-time; the org locale
 * is US, so "M/D/YYYY" is accepted as a fallback. The date part is taken as written (no timezone shift).
 */
export function toDate(v: unknown): Converted<string> {
  if (isBlank(v)) return { value: undefined };
  if (typeof v !== 'string') return { value: undefined, issue: 'invalid_date' };
  const s = v.trim();
  let m = DATE_RE.exec(s);
  if (m) {
    const d = isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return d ? { value: d } : { value: undefined, issue: 'invalid_date' };
  }
  m = US_DATE_RE.exec(s);
  if (m) {
    const d = isoDate(Number(m[3]), Number(m[1]), Number(m[2]));
    return d ? { value: d } : { value: undefined, issue: 'invalid_date' };
  }
  return { value: undefined, issue: 'invalid_date' };
}

/** Entry timestamps -> ISO UTC. ASSUMPTION (A8): a value without an offset is UTC (Cognito org timezone is UTC). */
export function toTimestamp(v: unknown): string | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const s = v.trim();
  const withZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s) || !/T\d/.test(s) ? s : `${s}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function toNumber(v: unknown, integer?: boolean): Converted<number> {
  if (isBlank(v)) return { value: undefined };
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim().replace(/,/g, '')) : NaN;
  if (!Number.isFinite(n)) return { value: undefined, issue: 'invalid_number' };
  // Kept as recorded; the engine would refuse a fraction on edit, so it is flagged for the spot check.
  if (integer && !Number.isInteger(n)) return { value: n, issue: 'not_integer' };
  return { value: n };
}

export function toYesNo(v: unknown): Converted<boolean> {
  if (v === undefined || v === null || v === '') return { value: false };
  if (typeof v === 'boolean') return { value: v };
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['yes', 'true', '1', 'on'].includes(s)) return { value: true };
    if (['no', 'false', '0', 'off'].includes(s)) return { value: false };
  }
  if (v === 1 || v === 0) return { value: v === 1 };
  return { value: false, issue: 'invalid_value' };
}

/** Choice values outside the current option list are kept (old options were removed in Cognito) and flagged. */
export function toChoice(v: unknown, options: string[], multi: boolean | undefined): Converted<string | string[]> {
  if (isBlank(v)) return { value: undefined };
  const raw = Array.isArray(v) ? v : multi && typeof v === 'string' && !options.includes(v) && v.includes(',') ? v.split(',') : [v];
  const vals: string[] = [];
  for (const x of raw) {
    const t = toText(x);
    if (t.issue && t.issue !== 'truncated') return { value: undefined, issue: 'invalid_value' };
    if (t.value !== undefined) vals.push(t.value);
  }
  if (!vals.length) return { value: undefined };
  const issue = vals.some((x) => !options.includes(x)) ? 'not_in_options' : undefined;
  if (multi) return { value: vals, issue };
  return { value: vals[0], issue: vals.length > 1 ? 'invalid_value' : issue };
}

/**
 * Cognito sub-properties that are derived from the parts we keep, so dropping them loses nothing.
 * ASSUMPTION (A10): names as in Cognito's JSON for Name and Address fields.
 */
export const DERIVED_PARTS: Record<'name' | 'address', string[]> = {
  name: ['FirstAndLast', 'LastFirst', 'FullName', 'MiddleInitial'],
  address: ['FullAddress', 'FullInternationalAddress', 'Type', 'Latitude', 'Longitude'],
};

/**
 * Name/address object -> { Part: string } with only the spec's parts. Returns the non-empty sub-keys that were
 * neither a part nor derived, so the report can show them (e.g. Name.Middle).
 */
export function toParts(v: unknown, parts: string[], kind: 'name' | 'address'): Converted<Record<string, string>> & { dropped: string[] } {
  if (isBlank(v)) return { value: undefined, dropped: [] };
  if (typeof v !== 'object' || Array.isArray(v)) return { value: undefined, issue: 'invalid_value', dropped: [] };
  const o = v as Record<string, unknown>;
  const out: Record<string, string> = {};
  let issue: IssueCode | undefined;
  for (const p of parts) {
    const t = toText(o[p]);
    if (t.issue) issue = t.issue;
    if (t.value !== undefined) out[p] = t.value;
  }
  const dropped = Object.keys(o).filter((k) => !parts.includes(k) && !DERIVED_PARTS[kind].includes(k) && !k.startsWith('$') && !isBlank(o[k]));
  return { value: Object.keys(out).length ? out : undefined, issue, dropped };
}
