import { describe, expect, it } from 'vitest';
import { PRESET_ACCESS, type AccessMap, type Member, type Role } from '@/lib/security/can';
import { visibleNav } from '@/lib/ui/nav';
import { canSearch, searchTarget, type SearchScope } from '@/lib/ui/search';
import { settingsTabs } from '@/lib/ui/settings-tabs';

// M7: menus, phone tabs, search and settings tabs follow the member's area levels.
const member = (role: Role, over: Partial<AccessMap> = {}, status: Member['status'] = 'active'): Member =>
  ({ userId: 'u', orgId: 'o', role, branch: null, access: { ...PRESET_ACCESS[role], ...over }, status });
const keys = (m: Member) => visibleNav(m).map((n) => n.key);

describe('nav follows the access map', () => {
  it('presets', () => {
    expect(keys(member('admin'))).toEqual(['home', 'tasks', 'forms', 'deals', 'quotes', 'invoices', 'stock', 'leads', 'integrations', 'settings']);
    expect(keys(member('staff'))).toEqual(['home', 'tasks', 'forms', 'deals', 'quotes', 'invoices', 'stock', 'leads']);
    expect(keys(member('reviewer'))).toEqual(['home', 'tasks', 'forms', 'deals', 'quotes', 'invoices', 'stock']);
    expect(keys(member('factory'))).toEqual(['home', 'stock']);
    expect(keys(member('inspector'))).toEqual([]);
  });

  it('a custom map shows exactly the readable areas', () => {
    expect(keys(member('staff', { quotes: 'none', home: 'none', integrations: 'read' }))).toEqual(['tasks', 'forms', 'deals', 'invoices', 'stock', 'leads', 'integrations']);
    // Tasks need Forms read as well.
    expect(keys(member('staff', { forms: 'none' }))).not.toContain('tasks');
  });

  it('Settings shows for any of its tabs; the tabs follow their own areas', () => {
    const usersOnly = member('staff', { users: 'read' });
    expect(keys(usersOnly)).toContain('settings');
    expect(settingsTabs(usersOnly).map((t) => t.key)).toEqual(['users']);
    const activityOnly = member('staff', { activity: 'read' });
    expect(settingsTabs(activityOnly).map((t) => t.key)).toEqual(['activity']);
    expect(settingsTabs(member('staff', { settings: 'read' })).map((t) => t.key)).toEqual(['organisation', 'notifications', 'jobs', 'forms']);
    expect(settingsTabs(member('admin')).map((t) => t.key)).toEqual(['organisation', 'users', 'notifications', 'activity', 'jobs', 'forms']);
    expect(keys(member('staff'))).not.toContain('settings');
  });

  it('invited and disabled members see nothing', () => {
    expect(keys(member('admin', {}, 'invited'))).toEqual([]);
    expect(keys(member('staff', {}, 'disabled'))).toEqual([]);
  });
});

describe('search never routes to an unreadable area', () => {
  const scope = (o: Partial<SearchScope>): SearchScope => ({ deals: false, quotes: false, invoices: false, stock: false, ...o });

  it('falls back from quotes and invoices to deal files, then the stock register', () => {
    expect(searchTarget('QU-10482', scope({ deals: true }))).toBe('/admin/deal-files?q=QU-10482');
    expect(searchTarget('INV-1', scope({ deals: true, quotes: true }))).toBe('/admin/deal-files?q=INV-1');
    expect(searchTarget('TT9DEMO24D0010482', scope({ stock: true }))).toBe('/admin/stock/units?q=TT9DEMO24D0010482');
    expect(searchTarget('Bergview', scope({ invoices: true }))).toBe('/admin/xero/invoices?q=Bergview');
    expect(searchTarget('ABCDEFGH123456789', scope({ quotes: true }))).toBeNull();
    expect(searchTarget('anything', scope({}))).toBeNull();
  });

  it('is hidden when nothing is searchable', () => {
    expect(canSearch(scope({}))).toBe(false);
    expect(canSearch(scope({ stock: true }))).toBe(true);
    expect(canSearch(null)).toBe(false);
  });
});
