import { describe, expect, it } from 'vitest';
import { linkStatus } from '@/lib/workflow/link-status';

const now = new Date('2026-10-30T10:00:00Z');

describe('role link status', () => {
  it('tells expired, revoked and unknown links apart', () => {
    expect(linkStatus(null, now)).toBe('unknown');
    expect(linkStatus({ expires_at: '2026-11-05T00:00:00Z', revoked_at: null }, now)).toBe('ok');
    expect(linkStatus({ expires_at: null, revoked_at: null }, now)).toBe('ok');
    expect(linkStatus({ expires_at: '2026-10-29T00:00:00Z', revoked_at: null }, now)).toBe('expired');
    // Revoked wins over expired: a replaced link is not "expired", it is gone.
    expect(linkStatus({ expires_at: '2026-10-29T00:00:00Z', revoked_at: '2026-10-28T00:00:00Z' }, now)).toBe('revoked');
  });
});
