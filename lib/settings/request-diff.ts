// Dry-run diff viewer: "Portal would send" vs "Make.com sent". Pure (also runs in the browser).
//
// Left: the planned requests of one recorded dry run (xero_action_runs.planned_requests, already redacted when it
// was stored). Right: the requests Make.com sent for the same trigger, taken only from a recording the admin
// pastes from Make's execution history (the `make.requests` of a tt-make-replay/1 execution, docs/M3.md, or a bare
// request list). The portal never stores Make's requests, so without a recording the right side stays empty:
// nothing is ever made up. The pasted text is redacted with the same rules as the stored side before it is shown or
// compared, so personal fields compare as "[redacted]" on both sides and never appear on screen.
import { REDACTED, redactValue } from '@/lib/integrations/xero/write/redact';

export interface RequestLike {
  method?: unknown;
  path?: unknown;
  params?: unknown;
  body?: unknown;
  file?: unknown;
}

/** Objects with sorted keys, so key order never shows as a difference. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  }
  return v;
}

/** "/api.xro/2.0/Invoices" and "Invoices" both become "/Invoices" (Make records paths relative to /api.xro/2.0). */
export function normalisePath(p: unknown): string {
  const s = typeof p === 'string' ? p.trim() : '';
  const rel = s.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/?api\.xro\/2\.0/i, '');
  return rel.startsWith('/') ? rel : `/${rel}`;
}

const MAX_LINES = 1500;

/** Request list as display lines: "POST /Invoices", query params, then the JSON body (sorted keys, 2 spaces). */
export function requestLines(requests: readonly RequestLike[]): string[] {
  const out: string[] = [];
  requests.forEach((r, i) => {
    if (i > 0) out.push('');
    const method = typeof r.method === 'string' ? r.method.toUpperCase().slice(0, 10) : '?';
    const params = r.params && typeof r.params === 'object' ? Object.entries(canonical(r.params) as Record<string, unknown>) : [];
    const query = params.length ? `?${params.map(([k, v]) => `${k}=${String(v)}`).join('&')}` : '';
    out.push(`${method} ${normalisePath(r.path)}${query}`);
    if (r.body !== undefined) out.push(...JSON.stringify(canonical(r.body), null, 2).split('\n'));
    else if (r.file !== undefined) out.push('(file body)');
  });
  return out.slice(0, MAX_LINES);
}

export type MakeParse = { ok: true; requests: RequestLike[] } | { ok: false; error: string };

const isRequest = (v: unknown): v is RequestLike =>
  !!v && typeof v === 'object' && typeof (v as RequestLike).method === 'string' && typeof (v as RequestLike).path === 'string';

/**
 * Reads a pasted Make.com recording: a tt-make-replay/1 file (first execution, or the one for `action`), one
 * execution ({ make: { requests } }), a { requests } object, a request list, or one request. The result is
 * redacted. Errors are fixed texts and never echo the input.
 */
export function parseMakeRecording(text: string, action?: string): MakeParse {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Paste the requests Make.com sent.' };
  if (text.length > 500_000) return { ok: false, error: 'That recording is too large to compare here.' };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That is not valid JSON. Paste the request list from Make.com as JSON.' };
  }
  const pickExecution = (execs: unknown[]) => {
    const mine = execs.find((e) => !!e && typeof e === 'object' && (e as { action?: unknown }).action === action);
    return mine ?? execs[0];
  };
  let list: unknown = json;
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.executions)) list = pickExecution(o.executions);
    else list = o;
  }
  if (list && typeof list === 'object' && !Array.isArray(list)) {
    const o = list as Record<string, unknown>;
    if (o.make && typeof o.make === 'object' && Array.isArray((o.make as { requests?: unknown }).requests)) list = (o.make as { requests: unknown[] }).requests;
    else if (Array.isArray(o.requests)) list = o.requests;
    else if (isRequest(o)) list = [o];
  }
  if (!Array.isArray(list) || !list.length || !list.every(isRequest)) {
    return { ok: false, error: 'No requests found. Each request needs a method and a path.' };
  }
  const requests = (list as RequestLike[]).slice(0, 50).map((r) => {
    const out: RequestLike = { method: r.method, path: redactPathText(String(r.path)) };
    if (r.params !== undefined) out.params = redactValue(r.params);
    if (r.body !== undefined) out.body = redactValue(r.body);
    if (r.file !== undefined) out.file = true;
    return out;
  });
  return { ok: true, requests };
}

/** Make records attachment uploads with the file name in the path: mask it like the stored side does. */
function redactPathText(p: string): string {
  return p.replace(/(\/Attachments\/)[^/?]+/i, `$1[file]`).replace(/[^\s@/]+@[^\s@/]+/g, REDACTED);
}

export type DiffKind = 'same' | 'portal' | 'make';
export interface DiffLine { kind: DiffKind; text: string }

/** Line diff (longest common subsequence). 'portal' = only in what the portal would send; 'make' = only in Make's. */
export function diffLines(portal: readonly string[], make: readonly string[]): DiffLine[] {
  const a = portal.slice(0, MAX_LINES);
  const b = make.slice(0, MAX_LINES);
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i..] and b[j..]
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ kind: 'same', text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: 'portal', text: a[i++] });
    else out.push({ kind: 'make', text: b[j++] });
  }
  while (i < n) out.push({ kind: 'portal', text: a[i++] });
  while (j < m) out.push({ kind: 'make', text: b[j++] });
  return out;
}

/** Number of changed blocks (a run of portal-only and/or Make-only lines counts once). */
export function differenceCount(diff: readonly DiffLine[]): number {
  let n = 0;
  let inChange = false;
  for (const d of diff) {
    if (d.kind === 'same') inChange = false;
    else if (!inChange) { n++; inChange = true; }
  }
  return n;
}

export interface SideLine { kind: 'same' | 'added' | 'removed'; text: string }

/**
 * The two columns: left shows shared lines and portal-only lines (added), right shows shared lines and
 * Make-only lines (removed).
 */
export function sides(diff: readonly DiffLine[]): { portal: SideLine[]; make: SideLine[] } {
  const portal: SideLine[] = [];
  const make: SideLine[] = [];
  for (const d of diff) {
    if (d.kind !== 'make') portal.push({ kind: d.kind === 'same' ? 'same' : 'added', text: d.text });
    if (d.kind !== 'portal') make.push({ kind: d.kind === 'same' ? 'same' : 'removed', text: d.text });
  }
  return { portal, make };
}

export const differencesLabel = (n: number) => (n === 0 ? 'No differences' : n === 1 ? '1 difference' : `${n} differences`);
