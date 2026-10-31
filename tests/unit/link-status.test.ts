import { describe, expect, it } from 'vitest';
import { linkStatus } from '@/lib/workflow/link-status';

describe('role link status', () => {
  it('form links never expire; only replaced (revoked) or unknown links are refused', () => {
    expect(linkStatus(null)).toBe('unknown');
    expect(linkStatus({ expires_at: null, revoked_at: null })).toBe('ok');
    // An expiry stored before the "links do not expire" decision is ignored.
    expect(linkStatus({ expires_at: '2020-01-01T00:00:00Z', revoked_at: null })).toBe('ok');
    expect(linkStatus({ expires_at: null, revoked_at: '2026-10-28T00:00:00Z' })).toBe('revoked');
  });
});
