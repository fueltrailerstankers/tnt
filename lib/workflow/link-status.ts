// Role link state from its stored row. Pure.
// Form links never expire (owner decision): only a revoked link (replaced by a newer one) or an unknown token is
// refused. A stored expires_at from before that decision is ignored.

export type LinkStatus = 'ok' | 'revoked' | 'unknown';

export function linkStatus(row: { expires_at: string | null; revoked_at: string | null } | null | undefined): LinkStatus {
  if (!row) return 'unknown';
  if (row.revoked_at) return 'revoked';
  return 'ok';
}
