import { createHash, timingSafeEqual } from 'node:crypto';

// Intake helpers for /api/webhooks/leads. Pure (node crypto only).

export const MIN_SECRET_LENGTH = 32;
export const MAX_BODY_BYTES = 64 * 1024;

/** The configured secret, or null when unset or too short to be safe (the endpoint then refuses every post). */
export function usableSecret(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  return s.length >= MIN_SECRET_LENGTH ? s : null;
}

/** Constant-time comparison: both sides are hashed first so the compared buffers have equal length. */
export function secretMatches(given: string | null | undefined, expected: string): boolean {
  const a = createHash('sha256').update(given ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** integration_events.external_id for a lead: sha256 of source + source id. */
export function intakeEventKey(source: string, sourceId: string): string {
  return createHash('sha256').update(`${source}:${sourceId}`).digest('hex');
}

/** True when a Content-Length header declares a body over the cap (checked before the body is read). */
export function declaredTooLarge(contentLength: string | null | undefined, max = MAX_BODY_BYTES): boolean {
  if (!contentLength) return false;
  const n = Number(contentLength.trim());
  return Number.isFinite(n) && n > max;
}

/**
 * What a VALID post does when an integration_events row with the same key already exists (an invalid post is
 * answered 400 before this and never touches the stored row):
 * - `replace`: the stored body never became a lead (it was invalid and `ignored`, or stored but never queued):
 *   accept the new body (conditionally on that status) and queue it;
 * - `requeue`: processing failed; claim the row (failed -> queued) and queue the stored event again (the lead
 *   service resumes where it stopped);
 * - `duplicate`: already queued or processed, nothing to do.
 */
export type PriorEventAction = 'replace' | 'requeue' | 'duplicate';
export function priorEventAction(status: string): PriorEventAction {
  if (status === 'ignored' || status === 'received') return 'replace';
  if (status === 'failed') return 'requeue';
  return 'duplicate';
}

/** Lead intake stages recorded in lead_events. */
export type LeadStage = 'created' | 'duplicate' | 'routed' | 'matched' | 'emailed';

/**
 * Stages recorded at most once per lead (unique index lead_events_once, migration 0012). When two intake jobs
 * for the same lead race, the loser's insert fails with 23505 and the stage counts as done. `matched` is not
 * one of them: it is logged again whenever the Xero match changes.
 */
export const ONCE_STAGES: ReadonlySet<string> = new Set<LeadStage>(['created', 'duplicate', 'routed', 'emailed']);

/** True when a failed lead_events insert means another job already recorded this one-time stage. */
export function stageAlreadyRecorded(kind: string, error: { code?: string } | null | undefined): boolean {
  return ONCE_STAGES.has(kind) && error?.code === '23505';
}

/**
 * Which stages still need to run for a lead, given the lead_events kinds it already has. A retry after a
 * partial failure runs only the missing ones. `matched` is logged only when a match was found, so a lead
 * without one re-runs matching, which writes nothing when the match is unchanged.
 */
export function pendingStages(done: Iterable<string>, opts: { duplicate: boolean; notify: boolean }): Record<LeadStage, boolean> {
  const has = new Set(done);
  return {
    created: !has.has('created'),
    duplicate: opts.duplicate && !has.has('duplicate'),
    routed: !has.has('routed'),
    matched: !has.has('matched'),
    emailed: opts.notify && !has.has('emailed'),
  };
}

/** action_claims key that makes a lead's intake notification a one-time send. */
export const notifyClaimKey = (leadId: string) => `lead.notify:${leadId}`;

/** A notification claim with no recorded result younger than this may still be sending: retry later. */
export const NOTIFY_CLAIM_STALE_MS = 10 * 60_000;

/** Field names (never values) of a failed payload validation. */
export function invalidFields(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>): string[] {
  return [...new Set(issues.map((i) => i.path.map(String).join('.') || '(root)'))];
}
