// Pure helpers for the in-app import (import_runs rows): parsing what is stored, merging reports, error codes,
// matching Cognito forms to platform forms. No I/O. Everything here is counts, codes, slugs and form names only.
import { z } from 'zod';
import { CognitoApiError } from './api';
import { emptyFormReport, type FormReport } from './report';
import { SourceDeadlineError, type CognitoFormInfo, type SourcePosition } from './source';

export const IMPORT_QUEUE = 'cognito.import';

export type RunMode = 'dry_run' | 'apply';
export type RunStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed';

// ---------------------------------------------------------------------------------------------------------------
// Stored shapes (jsonb). Parsed leniently: a row written by an older version still renders.
// ---------------------------------------------------------------------------------------------------------------
const count = z.number().int().nonnegative().catch(0);
const counts = z.record(z.string(), count).catch({});
const tally = z.object({ count, bytes: count, unknownSize: count }).catch({ count: 0, bytes: 0, unknownSize: 0 });

const reportSchema = z.object({
  form: z.string(),
  expected: z.number().int().nullable().catch(null),
  seen: count, toImport: count, alreadyImported: count, resumable: count, imported: count,
  skipped: counts, failed: counts,
  unknownFields: z.record(z.string(), z.object({ present: count, withValue: count })).catch({}),
  issues: counts,
  files: tally, signatures: tally,
  stored: z.object({ files: count, bytes: count }).catch({ files: 0, bytes: 0 }),
  lookups: z.object({ resolved: count, pendingSource: count, unresolved: count }).catch({ resolved: 0, pendingSource: 0, unresolved: 0 }),
  stoppedAtLimit: z.boolean().catch(false),
  maxNumber: z.number().int().nullable().catch(null),
  counterSetTo: z.number().int().nullable().catch(null),
});

/** import_runs.report -> FormReport, or null when nothing was saved yet ({}). */
export function parseReport(raw: unknown): FormReport | null {
  const r = reportSchema.safeParse(raw);
  return r.success ? r.data : null;
}

const positionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('number'), next: z.number().int().positive(), misses: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('skip'), n: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('index'), n: z.number().int().nonnegative() }),
]);

/**
 * Steps started at one cursor position without getting past it. Written when a step starts, so a step that is killed
 * (time limit) still counts; a checkpoint further on drops it. `last` is the reason code of the last retry-later exit.
 */
export interface PositionAttempts {
  at: string;
  n: number;
  last?: string;
}

export interface RunCursor {
  /** Where the next slice resumes; null = from the start (or the form is finished). */
  position: SourcePosition | null;
  /** Dry runs of a lookup source form: Cognito entry ids planned for import (ids like "4-12", never data). */
  planned: string[];
  attempt?: PositionAttempts;
}

const EXTERNAL_ID = /^\d{1,9}-\d{1,9}$/;
const CODE = /^[a-z0-9_]{1,64}$/;

/** Steps that may start at the same position before the run fails ('stuck_entry', or the last retry reason). */
export const MAX_POSITION_ATTEMPTS = 5;

export const positionKey = (p: SourcePosition | null): string => JSON.stringify(p);

export function parseCursor(raw: unknown): RunCursor {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const p = positionSchema.safeParse(o.position);
  const planned = Array.isArray(o.planned) ? o.planned.filter((x): x is string => typeof x === 'string' && EXTERNAL_ID.test(x)) : [];
  const a = o.attempt && typeof o.attempt === 'object' ? (o.attempt as Record<string, unknown>) : null;
  const attempt = a && typeof a.at === 'string' && a.at.length <= 200 && Number.isInteger(a.n) && (a.n as number) > 0
    ? { at: a.at, n: a.n as number, ...(typeof a.last === 'string' && CODE.test(a.last) ? { last: a.last } : {}) }
    : undefined;
  return { position: p.success ? p.data : null, planned, ...(attempt ? { attempt } : {}) };
}

/**
 * A step starting at the cursor's position: the attempt count for that position, and whether the run must fail now
 * (with which code) because steps keep dying or retrying there.
 */
export function nextAttempt(cursor: RunCursor): { attempt: PositionAttempts; giveUp: string | null } {
  const at = positionKey(cursor.position);
  const prev = cursor.attempt?.at === at ? cursor.attempt : undefined;
  const attempt: PositionAttempts = { at, n: (prev?.n ?? 0) + 1, ...(prev?.last ? { last: prev.last } : {}) };
  return { attempt, giveUp: attempt.n > MAX_POSITION_ATTEMPTS ? (prev?.last ?? 'stuck_entry') : null };
}

/** Union of planned ids, first-seen order. Only Cognito entry ids are kept. */
export function mergePlanned(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].filter((x) => EXTERNAL_ID.test(x));
}

const optionsSchema = z.object({ limit: z.number().int().positive().max(1_000_000).optional() }).catch({});
export type RunOptions = z.infer<typeof optionsSchema>;
export const parseOptions = (raw: unknown): RunOptions => optionsSchema.parse(raw ?? {});

// ---------------------------------------------------------------------------------------------------------------
// Report merging
// ---------------------------------------------------------------------------------------------------------------
function addCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/**
 * Adds two reports of the same kind (e.g. the forms of an "All forms" batch, or a report and a later delta).
 * Counts add up; maxNumber is the larger; counterSetTo and expected take the later known value / the sum.
 */
export function mergeFormReports(a: FormReport, b: FormReport, form = a.form === b.form ? a.form : 'all'): FormReport {
  const uf: FormReport['unknownFields'] = structuredClone(a.unknownFields);
  for (const [k, v] of Object.entries(b.unknownFields)) {
    const t = (uf[k] ??= { present: 0, withValue: 0 });
    t.present += v.present;
    t.withValue += v.withValue;
  }
  const sumNull = (x: number | null, y: number | null) => (x === null && y === null ? null : (x ?? 0) + (y ?? 0));
  return {
    form,
    expected: a.form === b.form ? (b.expected ?? a.expected) : sumNull(a.expected, b.expected),
    seen: a.seen + b.seen,
    toImport: a.toImport + b.toImport,
    alreadyImported: a.alreadyImported + b.alreadyImported,
    resumable: a.resumable + b.resumable,
    imported: a.imported + b.imported,
    skipped: addCounts(a.skipped, b.skipped),
    failed: addCounts(a.failed, b.failed),
    unknownFields: uf,
    issues: addCounts(a.issues, b.issues),
    files: { count: a.files.count + b.files.count, bytes: a.files.bytes + b.files.bytes, unknownSize: a.files.unknownSize + b.files.unknownSize },
    signatures: { count: a.signatures.count + b.signatures.count, bytes: a.signatures.bytes + b.signatures.bytes, unknownSize: a.signatures.unknownSize + b.signatures.unknownSize },
    stored: { files: a.stored.files + b.stored.files, bytes: a.stored.bytes + b.stored.bytes },
    lookups: {
      resolved: a.lookups.resolved + b.lookups.resolved,
      pendingSource: a.lookups.pendingSource + b.lookups.pendingSource,
      unresolved: a.lookups.unresolved + b.lookups.unresolved,
    },
    stoppedAtLimit: a.stoppedAtLimit || b.stoppedAtLimit,
    maxNumber: a.maxNumber === null && b.maxNumber === null ? null : Math.max(a.maxNumber ?? 0, b.maxNumber ?? 0),
    counterSetTo: a.form === b.form ? (b.counterSetTo ?? a.counterSetTo) : null,
  };
}

/** Totals over several forms' reports (the "All forms" line). */
export function totalReport(reports: FormReport[]): FormReport {
  return reports.reduce((acc, r) => mergeFormReports(acc, r, 'all'), { ...emptyFormReport('all', null) });
}

export const sumCounts = (m: Record<string, number>): number => Object.values(m).reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------------------------------------------
// Errors -> reason codes (stored in import_runs.error, shown as plain words). Never a message from outside.
// ---------------------------------------------------------------------------------------------------------------
export class ImportJobError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function errorCode(e: unknown): string {
  if (e instanceof ImportJobError) return e.code;
  if (e instanceof SourceDeadlineError) return e.code;
  if (e instanceof CognitoApiError) {
    if (e.message.includes('invalid JSON')) return 'cognito_bad_response';
    if (e.status === 401 || e.status === 403) return 'cognito_auth';
    if (e.status === 404) return 'cognito_not_found';
    if (e.status === 429) return 'cognito_rate_limited';
    return Number.isInteger(e.status) && e.status >= 100 && e.status <= 599 ? `cognito_http_${e.status}` : 'cognito_error';
  }
  if (e instanceof TypeError && /fetch failed|network|ECONN|ENOTFOUND/i.test(e.message)) return 'cognito_unreachable';
  return 'internal_error';
}

const ERROR_TEXT: Record<string, string> = {
  no_api_key: 'Save a Cognito API key first.',
  key_unreadable: 'The saved key cannot be decrypted (was ENCRYPTION_KEY changed?). Save the key again.',
  encryption_key_missing: 'ENCRYPTION_KEY is not set on the server, so the key cannot be stored or read.',
  entry_key_missing: 'ENTRY_ENCRYPTION_KEY is not set on the server; DEAL and Delivery Note entries cannot be imported.',
  cognito_auth: 'Cognito did not accept the key (HTTP 401/403). Check the key and that it can read forms and entries.',
  cognito_not_found: 'Cognito answered "not found" for the form list. Check the API address (assumption A14 in docs/M5.md).',
  cognito_rate_limited: 'Cognito is limiting requests (HTTP 429). The import retries by itself in a few minutes; if it stopped, Resume later.',
  cognito_unavailable: 'Cognito is not answering (HTTP 5xx). The import retries by itself shortly; if it stopped, Resume later.',
  step_deadline: 'A step ran out of time. The import continues from its last checkpoint.',
  stuck_entry: 'The import kept stopping at the same entry (e.g. a very slow file download). Check the entry in Cognito, then Resume.',
  cognito_unreachable: 'Could not reach Cognito. Try again shortly.',
  cognito_bad_response: 'Cognito answered with something that is not JSON (docs/M5.md, API assumptions).',
  form_not_found: 'This form is no longer in the platform.',
  internal_error: 'The import stopped on an unexpected error. Resume to try again.',
};

export function errorText(code: string | null | undefined): string {
  if (!code) return '';
  if (ERROR_TEXT[code]) return ERROR_TEXT[code];
  const http = code.match(/^cognito_http_(\d{3})$/);
  if (http) return `Cognito answered with HTTP ${http[1]}. Resume to try again.`;
  return 'The import stopped on an error. Resume to try again.';
}

// ---------------------------------------------------------------------------------------------------------------
// Test connection: Cognito forms <-> platform forms by Cognito form id
// ---------------------------------------------------------------------------------------------------------------
export interface PlatformFormRef {
  slug: string;
  name: string;
  cognitoFormId: number;
  expected: number | null;
}

export interface FormMatch {
  cognito: CognitoFormInfo;
  platform: PlatformFormRef | null;
}

export function matchForms(cognito: CognitoFormInfo[], platform: PlatformFormRef[]): { forms: FormMatch[]; missing: PlatformFormRef[] } {
  const byId = new Map(platform.map((p) => [p.cognitoFormId, p]));
  const forms = cognito.map((c) => ({ cognito: c, platform: c.id !== null ? (byId.get(c.id) ?? null) : null }));
  const seen = new Set(forms.flatMap((f) => (f.platform ? [f.platform.slug] : [])));
  // Mapped forms first (in the platform's order), then the rest by name.
  const order = new Map(platform.map((p, i) => [p.slug, i]));
  forms.sort((a, b) => (a.platform ? order.get(a.platform.slug)! : 1e6) - (b.platform ? order.get(b.platform.slug)! : 1e6) || a.cognito.name.localeCompare(b.cognito.name));
  return { forms, missing: platform.filter((p) => !seen.has(p.slug)) };
}

/** Forms another form looks up (e.g. request-for-invoice for the Delivery Note): their dry runs keep planned ids. */
export function lookupSources(specs: Array<{ fields: Array<{ type: string; lookup?: { sourceForm: string } }> }>): Set<string> {
  const out = new Set<string>();
  for (const s of specs) for (const f of s.fields) if (f.type === 'lookup' && f.lookup?.sourceForm) out.add(f.lookup.sourceForm);
  return out;
}

/** Plain-words status for a run. */
export function statusLabel(status: RunStatus, leaseActive: boolean, stopRequested: boolean): string {
  if (status === 'running' && stopRequested) return 'Stopping';
  if (status === 'running' && !leaseActive) return 'Waiting for the next job run';
  return { queued: 'Queued', running: 'Running', paused: 'Paused', done: 'Done', failed: 'Failed' }[status];
}
