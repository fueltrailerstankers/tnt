import { describe, expect, it } from 'vitest';
import { safeNext } from '@/lib/security/safe-next';

describe('safeNext', () => {
  it('keeps same-site admin paths', () => {
    expect(safeNext('/admin')).toBe('/admin');
    expect(safeNext('/admin/forms/deal')).toBe('/admin/forms/deal');
  });

  it('falls back to /admin for anything else', () => {
    for (const bad of ['//evil.example', '/\\evil', 'https://evil.example', '/login', '', null, '/admin//x', '/adminx']) {
      expect(safeNext(bad as string | null)).toBe('/admin');
    }
  });
});
