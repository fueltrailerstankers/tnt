// Role link state from its stored row. Pure.

export type LinkStatus = 'ok' | 'expired' | 'revoked' | 'unknown';

export function linkStatus(row: { expires_at: string | null; revoked_at: string | null } | null | undefined, now: Date): LinkStatus {
  if (!row) return 'unknown';
  if (row.revoked_at) return 'revoked';
  if (row.expires_at && new Date(row.expires_at) < now) return 'expired';
  return 'ok';
}
