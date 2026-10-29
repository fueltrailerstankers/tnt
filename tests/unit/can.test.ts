import { describe, expect, it } from 'vitest';
import { assertPerm, can, ForbiddenError, PERMISSIONS, ROLES, type Member, type Permission, type Role } from '@/lib/security/can';

const member = (role: Role): Member => ({ userId: 'u1', orgId: 'o1', role, branch: null });

describe('can', () => {
  it('denies when there is no member', () => {
    expect(can(null, 'admin.access')).toBe(false);
    expect(can(undefined, 'forms.read')).toBe(false);
  });

  it('admin holds every permission', () => {
    for (const p of PERMISSIONS) expect(can(member('admin'), p)).toBe(true);
  });

  it('non-admin roles never manage users, settings, integrations or Xero actions', () => {
    for (const role of ROLES.filter((r) => r !== 'admin')) {
      for (const p of ['users.manage', 'settings.manage', 'integrations.manage', 'xero.actions.configure', 'entries.delete'] as const) {
        expect(can(member(role), p), `${role} ${p}`).toBe(false);
      }
    }
  });

  it('reviewer can approve but not write; staff can write but not approve', () => {
    expect(can(member('reviewer'), 'entries.approve')).toBe(true);
    expect(can(member('reviewer'), 'entries.write')).toBe(false);
    expect(can(member('staff'), 'entries.write')).toBe(true);
    expect(can(member('staff'), 'entries.approve')).toBe(false);
  });

  it('inspector has no admin access', () => {
    expect(can(member('inspector'), 'admin.access')).toBe(false);
  });

  it('stock permissions follow docs/M6.md section 7', () => {
    const holders = (p: Permission) => ROLES.filter((r) => can(member(r), p));
    expect(holders('stock.read')).toEqual(['admin', 'staff', 'reviewer', 'factory']);
    expect(holders('stock.dispatch')).toEqual(['admin', 'staff', 'factory']);
    expect(holders('stock.export')).toEqual(['admin', 'staff']);
    expect(holders('stock.manage')).toEqual(['admin']);
    // Invoice review (Invoices tab, exceptions queue): the Xero mirror audience, not factory (0011 RLS agrees).
    expect(holders('stock.invoices')).toEqual(['admin', 'staff', 'reviewer']);
  });

  it('factory holds admin access, stock read and dispatch only: no entries, forms, tasks, Xero or leads', () => {
    expect(PERMISSIONS.filter((p) => can(member('factory'), p))).toEqual(['admin.access', 'stock.read', 'stock.dispatch']);
    for (const p of ['entries.read', 'entries.write', 'forms.read', 'tasks.read', 'xero.read', 'leads.read', 'stock.export', 'stock.manage', 'stock.invoices'] as const) {
      expect(can(member('factory'), p), p).toBe(false);
    }
  });

  it('ignores an unknown role instead of granting anything', () => {
    expect(can({ ...member('admin'), role: 'owner' as Role }, 'admin.access')).toBe(false);
  });
});

describe('assertPerm', () => {
  it('returns the member when allowed', () => {
    const m = member('admin');
    expect(assertPerm(m, 'forms.manage')).toBe(m);
  });

  it('throws ForbiddenError (403) when denied or signed out', () => {
    expect(() => assertPerm(member('staff'), 'users.manage')).toThrow(ForbiddenError);
    expect(() => assertPerm(null, 'admin.access')).toThrow(ForbiddenError);
    try {
      assertPerm(null, 'admin.access');
    } catch (e) {
      expect((e as ForbiddenError).status).toBe(403);
    }
  });
});
