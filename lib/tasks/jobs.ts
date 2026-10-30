// Job and sync error labels for Home and Tasks. Pure.
// Errors in outbox_jobs.last_error, job_runs.error and xero_sync_state.last_error are already redacted by the
// writers ('xero 429', 'auth invalid_grant', 'sync error', ...). Anything else is shown clipped, with anything
// that looks like an email address or a long number masked, so an error text can never put personal data on screen.

const HTTP_SHORT: Record<number, string> = { 401: 'not authorised', 403: 'forbidden', 404: 'not found', 429: 'rate limit' };
const HTTP_LONG: Record<number, string> = { 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 429: 'Too Many Requests' };
const MAX = 80;

/** Masks emails and long digit runs, collapses whitespace and clips. */
export function safeErrorText(s: string): string {
  const clean = s
    .replace(/[^\s@<>()"',;:]+@[^\s@<>()"',;:]+/g, '[email]')
    .replace(/\d{9,}/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > MAX ? `${clean.slice(0, MAX - 1)}…` : clean;
}

/**
 * Human label for a redacted job error. `short` is the Home wording ("429 rate limit"), `long` the Tasks wording
 * ("429 Too Many Requests").
 */
export function jobErrorLabel(error: string | null | undefined, style: 'short' | 'long' = 'long'): string {
  const e = (error ?? '').trim();
  if (!e) return 'Failed';
  const http = /^xero (\d{3})$/i.exec(e);
  if (http) {
    const code = Number(http[1]);
    if (code >= 500) return `${code} Xero server error`;
    const words = (style === 'short' ? HTTP_SHORT : HTTP_LONG)[code];
    return words ? `${code} ${words}` : `${code} error`;
  }
  const auth = /^auth (.+)$/i.exec(e);
  if (auth) return style === 'short' ? 'Xero sign-in failed' : `Xero sign-in failed (${safeErrorText(auth[1])})`;
  if (/^sync error$/i.test(e)) return 'Sync error';
  return safeErrorText(e);
}

/** Short code for a sync row: "429", "auth" or "error". */
export function errorCode(error: string | null | undefined): string {
  const e = (error ?? '').trim();
  const http = /^xero (\d{3})$/i.exec(e);
  if (http) return http[1];
  if (/^auth /i.test(e)) return 'auth';
  return 'error';
}

/** Mirror entities shown on Home, in design order. Attachments are internal and not listed. */
export const SYNC_ENTITIES = ['quotes', 'invoices', 'contacts', 'payments'] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

const SINGULAR: Record<string, string> = { quotes: 'quote', invoices: 'invoice', contacts: 'contact', payments: 'payment', attachments: 'attachment' };

export function entitySingular(entity: string): string {
  return SINGULAR[entity] ?? entity;
}

export function entityLabel(entity: string): string {
  return entity ? entity[0].toUpperCase() + entity.slice(1) : entity;
}
