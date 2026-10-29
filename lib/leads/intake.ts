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
