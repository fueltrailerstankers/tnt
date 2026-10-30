import { describe, expect, it } from 'vitest';
import {
  accessOf, AREAS, assertPerm, can, canArea, clampAccess, ForbiddenError, PERMISSIONS, PRESET_ACCESS, presetOf, ROLES, RULES,
  type AccessMap, type Area, type Member, type MemberStatus, type Permission, type Role,
} from '@/lib/security/can';

const member = (role: Role, extra: Partial<Member> = {}): Member => ({ userId: 'u1', orgId: 'o1', role, branch: null, ...extra });
const custom = (role: Role, over: Partial<AccessMap>): Member => member(role, { access: { ...PRESET_ACCESS[role], ...over } });
const holders = (p: Permission) => ROLES.filter((r) => can(member(r), p));

describe('presets (docs/M7.md section 1)', () => {
  it('match the preset table', () => {
    const row = (role: Role) => AREAS.map((a) => PRESET_ACCESS[role][a][0]).join('');
    // home tasks forms deals quotes invoices leads stock integrations settings users activity
    expect(row('admin')).toBe('wwwwwwwwwwww');
    expect(row('staff')).toBe('rrwrrrwwnnnn');
    expect(row('reviewer')).toBe('rrrrrrnrnnnn');
    expect(row('factory')).toBe('rnnnnnnwnnnn');
    expect(row('inspector')).toBe('nnnnnnnnnnnn');
  });

  it('presetOf names an unchanged preset and calls anything else custom', () => {
    for (const role of ROLES) expect(presetOf(role, PRESET_ACCESS[role])).toBe(role);
    expect(presetOf('staff', { ...PRESET_ACCESS.staff, leads: 'read' })).toBe('custom');
    // Admin is always all write, whatever map is passed.
    expect(presetOf('admin', PRESET_ACCESS.inspector)).toBe('admin');
  });

  it('clampAccess fills missing areas, drops junk and applies the factory ceiling', () => {
    const m = clampAccess('staff', { forms: 'read', bogus: 'write', stock: 'owner' });
    expect(m.forms).toBe('read');
    expect(m.stock).toBe('none');
    expect(Object.keys(m).sort()).toEqual([...AREAS].sort());
    const f = clampAccess('factory', { forms: 'write', leads: 'read', stock: 'write', users: 'read' });
    expect([f.forms, f.leads, f.stock, f.users]).toEqual(['none', 'none', 'write', 'read']);
    expect(Object.values(clampAccess('admin', {}))).toEqual(AREAS.map(() => 'write'));
    expect(clampAccess('reviewer', null)).toEqual(PRESET_ACCESS.inspector);
  });

  it('every permission has a rule', () => {
    for (const p of PERMISSIONS) expect(RULES[p], p).toBeDefined();
  });
});

describe('can: presets', () => {
  it('denies when there is no member', () => {
    expect(can(null, 'admin.access')).toBe(false);
    expect(can(undefined, 'forms.read')).toBe(false);
  });

  it('admin holds every permission', () => {
    for (const p of PERMISSIONS) expect(can(member('admin'), p)).toBe(true);
  });

  it('admin-only actions stay admin-only even with write everywhere', () => {
    const everything = custom('staff', Object.fromEntries(AREAS.map((a) => [a, 'write'])) as AccessMap);
    for (const p of ['entries.delete', 'xero.actions.configure', 'import.run', 'stock.manage'] as const) {
      expect(holders(p), p).toEqual(['admin']);
      expect(can(everything, p), p).toBe(false);
    }
    expect(can(everything, 'users.manage')).toBe(true);
  });

  it('non-admin presets never manage users, settings, integrations or Xero actions', () => {
    for (const role of ROLES.filter((r) => r !== 'admin')) {
      for (const p of ['users.manage', 'users.read', 'settings.manage', 'forms.manage', 'integrations.manage', 'audit.read', 'xero.actions.configure', 'entries.delete'] as const) {
        expect(can(member(role), p), `${role} ${p}`).toBe(false);
      }
    }
  });

  it('reviewer can approve but not write; staff can write but not approve', () => {
    expect(can(member('reviewer'), 'entries.approve')).toBe(true);
    expect(can(member('reviewer'), 'entries.review')).toBe(true);
    expect(can(member('reviewer'), 'entries.write')).toBe(false);
    expect(can(member('staff'), 'entries.write')).toBe(true);
    expect(can(member('staff'), 'entries.approve')).toBe(false);
  });

  it('inspector has no admin access', () => {
    expect(PERMISSIONS.filter((p) => can(member('inspector'), p))).toEqual([]);
  });

  it('stock permissions follow docs/M7.md (stock.export is stock read; manage is admin-only)', () => {
    expect(holders('stock.read')).toEqual(['admin', 'staff', 'reviewer', 'factory']);
    expect(holders('stock.export')).toEqual(['admin', 'staff', 'reviewer', 'factory']);
    expect(holders('stock.dispatch')).toEqual(['admin', 'staff', 'factory']);
    expect(holders('stock.manage')).toEqual(['admin']);
    // Invoice review: stock read and invoices read, so never factory (0021 RLS agrees).
    expect(holders('stock.invoices')).toEqual(['admin', 'staff', 'reviewer']);
  });

  it('xero.read is split into deals.read, quotes.read and invoices.read', () => {
    for (const p of ['deals.read', 'quotes.read', 'invoices.read'] as const) expect(holders(p), p).toEqual(['admin', 'staff', 'reviewer']);
    const dealsOnly = custom('staff', { quotes: 'none', invoices: 'none' });
    expect(can(dealsOnly, 'deals.read')).toBe(true);
    expect(can(dealsOnly, 'quotes.read')).toBe(false);
    expect(can(dealsOnly, 'xero.read')).toBe(false);
  });

  it('factory: home and stock only, never entries, forms, tasks, Xero or leads', () => {
    expect(PERMISSIONS.filter((p) => can(member('factory'), p))).toEqual(['admin.access', 'home.read', 'stock.read', 'stock.dispatch', 'stock.export']);
  });

  it('factory ceiling holds even when the stored map says otherwise', () => {
    const f = custom('factory', { forms: 'write', leads: 'write', deals: 'read', users: 'read' });
    for (const p of ['entries.read', 'entries.write', 'leads.read', 'deals.read', 'tasks.read'] as const) expect(can(f, p), p).toBe(false);
    expect(can(f, 'users.read')).toBe(true);
  });

  it('ignores an unknown role instead of granting anything', () => {
    expect(can({ ...member('admin'), role: 'owner' as Role }, 'admin.access')).toBe(false);
  });
});

describe('can: per-area levels', () => {
  const MAP: Array<[Permission, Area, 'read' | 'write']> = [
    ['home.read', 'home', 'read'], ['forms.read', 'forms', 'read'], ['entries.read', 'forms', 'read'], ['entries.export', 'forms', 'read'],
    ['entries.write', 'forms', 'write'], ['deals.read', 'deals', 'read'], ['quotes.read', 'quotes', 'read'], ['invoices.read', 'invoices', 'read'],
    ['leads.read', 'leads', 'read'], ['leads.manage', 'leads', 'write'], ['stock.read', 'stock', 'read'], ['stock.export', 'stock', 'read'],
    ['stock.dispatch', 'stock', 'write'], ['integrations.read', 'integrations', 'read'], ['integrations.manage', 'integrations', 'write'],
    ['settings.read', 'settings', 'read'], ['settings.manage', 'settings', 'write'], ['forms.manage', 'settings', 'write'],
    ['users.read', 'users', 'read'], ['users.manage', 'users', 'write'], ['audit.read', 'activity', 'read'],
  ];

  for (const [p, area, level] of MAP) {
    it(`${p} = ${area} ${level}`, () => {
      const none = Object.fromEntries(AREAS.map((a) => [a, 'none'])) as AccessMap;
      const at = (l: 'none' | 'read' | 'write') => member('staff', { access: { ...none, [area]: l } });
      expect(can(at('none'), p)).toBe(false);
      expect(can(at('read'), p)).toBe(level === 'read');
      expect(can(at('write'), p)).toBe(true);
    });
  }

  it('admin.access = any area at read or better', () => {
    const none = Object.fromEntries(AREAS.map((a) => [a, 'none'])) as AccessMap;
    expect(can(member('staff', { access: none }), 'admin.access')).toBe(false);
    for (const a of AREAS) expect(can(member('staff', { access: { ...none, [a]: 'read' } }), 'admin.access'), a).toBe(true);
  });

  it('tasks need forms read too (every task opens an entry)', () => {
    expect(can(custom('staff', { forms: 'none' }), 'tasks.read')).toBe(false);
    expect(can(custom('staff', { tasks: 'none' }), 'tasks.read')).toBe(false);
    expect(can(custom('staff', {}), 'tasks.read')).toBe(true);
  });

  it('approval is a role: staff with forms write still cannot approve; reviewer without forms cannot', () => {
    expect(can(custom('staff', { forms: 'write' }), 'entries.approve')).toBe(false);
    expect(can(custom('reviewer', { forms: 'none' }), 'entries.approve')).toBe(false);
  });

  it('canArea reads the effective level', () => {
    expect(canArea(member('staff'), 'leads', 'write')).toBe(true);
    expect(canArea(member('reviewer'), 'leads')).toBe(false);
    expect(accessOf(member('factory', { access: { ...PRESET_ACCESS.factory, forms: 'write' } })).forms).toBe('none');
  });
});

describe('can: status', () => {
  for (const status of ['invited', 'disabled'] as MemberStatus[]) {
    it(`${status} members get nothing, admins included`, () => {
      for (const role of ROLES) {
        expect(PERMISSIONS.filter((p) => can(member(role, { status }), p)), `${role}`).toEqual([]);
        expect(canArea(member(role, { status }), 'home')).toBe(false);
      }
    });
  }

  it('L1: a member still on a temporary password gets nothing until they change it', () => {
    for (const role of ROLES) expect(PERMISSIONS.filter((p) => can(member(role, { mustChangePassword: true }), p)), role).toEqual([]);
    expect(canArea(member('admin', { mustChangePassword: true }), 'home')).toBe(false);
  });

  it('an unknown status is refused', () => {
    expect(can(member('admin', { status: 'banned' as MemberStatus }), 'admin.access')).toBe(false);
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
    expect(() => assertPerm(member('admin', { status: 'disabled' }), 'admin.access')).toThrow(ForbiddenError);
    try {
      assertPerm(null, 'admin.access');
    } catch (e) {
      expect((e as ForbiddenError).status).toBe(403);
    }
  });
});

describe('xero.read is not used any more', () => {
  it('no app or lib code checks the deprecated xero.read (use deals.read, quotes.read or invoices.read)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '../..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = path.join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n) && !p.endsWith(path.join('lib', 'security', 'can.ts')) && /['"]xero\.read['"]/.test(readFileSync(p, 'utf8'))) hits.push(path.relative(root, p));
      }
    };
    for (const d of ['app', 'lib', 'components']) walk(path.join(root, d));
    expect(hits).toEqual([]);
  });
});
