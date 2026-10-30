import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { activeKey, badgeLabel, homeShowsForms, MAX_PHONE_TABS, NAV, phoneTabKeys, visibleNav } from '@/lib/ui/nav';
import { searchAccessOf, searchTarget } from '@/lib/ui/search';
import { STATUS_TONE, toneFor } from '@/lib/ui/status';
import { nextTheme, parseTheme, resolveTheme } from '@/lib/ui/theme';
import type { Member } from '@/lib/security/can';

const member = (role: Member['role']): Member => ({ userId: 'u', orgId: 'o', role, branch: null });

describe('theme', () => {
  it('prefers an explicit choice over the OS', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
  it('follows the OS when nothing valid is stored', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme('purple', false)).toBe('light');
    expect(parseTheme('purple')).toBeNull();
  });
  it('toggles', () => {
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
  });
});

describe('status tone', () => {
  it('maps known labels exactly as written', () => {
    expect(toneFor('APPROVAL')).toBe('red');
    expect(toneFor('APPROVED EMAILED')).toBe('green');
    expect(toneFor('Submitted')).toBe('teal');
    expect(toneFor('Reviewed')).toBe('yellow');
    expect(toneFor('Incomplete')).toBe('gray');
  });
  it('lets a spec colour win and falls back to gray', () => {
    expect(toneFor('Whatever', 'green')).toBe('green');
    expect(toneFor('Whatever', 'yel')).toBe('yellow');
    expect(toneFor('Whatever')).toBe('gray');
    expect(toneFor('Submitted', 'unknown-colour')).toBe('teal');
  });
  it('only uses defined tones', () => {
    for (const t of Object.values(STATUS_TONE)) expect(['gray', 'teal', 'yellow', 'green', 'red']).toContain(t);
  });
});

describe('navigation', () => {
  it('hides pages that are not built and ones the role cannot use', () => {
    const keys = visibleNav(member('admin')).map((n) => n.key);
    expect(keys).toContain('settings');
    expect(keys).toContain('leads');
    expect(visibleNav(member('reviewer')).map((n) => n.key)).not.toContain('leads');
    expect(keys).not.toContain('documents');
    expect(visibleNav(member('staff')).map((n) => n.key)).not.toContain('settings');
    expect(visibleNav(null)).toEqual([]);
  });
  it('factory staff see no forms, tasks, deals, Xero, leads or settings', () => {
    const keys = visibleNav(member('factory')).map((n) => n.key);
    for (const k of ['tasks', 'forms', 'deals', 'quotes', 'invoices', 'leads', 'integrations', 'settings']) expect(keys).not.toContain(k);
  });
  it('the admin home lists forms (links to entries pages) only for roles that can read entries; never for factory', () => {
    expect(homeShowsForms(member('factory'))).toBe(false);
    expect(homeShowsForms(null)).toBe(false);
    for (const r of ['admin', 'staff', 'reviewer'] as const) expect(homeShowsForms(member(r)), r).toBe(true);
    const page = readFileSync(path.resolve(__dirname, '../../app/(admin)/admin/page.tsx'), 'utf8');
    expect(page).toContain('homeShowsForms(member)');
    expect(page).toMatch(/showForms \? \(\(\(await supabase\.rpc\('form_overview'\)/);
  });
  it('picks the longest matching prefix', () => {
    const defs = NAV.filter((n) => n.built);
    expect(activeKey('/admin', defs)).toBe('home');
    expect(activeKey('/admin/forms/deal/entries/3', defs)).toBe('forms');
    expect(activeKey('/admin/xero/quotes/abc', defs)).toBe('quotes');
    expect(activeKey('/admin/integrations/xero/callback', defs)).toBe('integrations');
    expect(activeKey('/elsewhere', defs)).toBeNull();
  });
  it('formats badges', () => {
    expect(badgeLabel(0)).toBe('');
    expect(badgeLabel(5)).toBe('5');
    expect(badgeLabel(120)).toBe('99+');
  });
});

describe('global search routing', () => {
  it('routes by key type and encodes the term', () => {
    expect(searchTarget('QU-10482')).toBe('/admin/xero/quotes?q=QU-10482');
    expect(searchTarget('inv-20931')).toBe('/admin/xero/invoices?q=inv-20931');
    expect(searchTarget('TT9DEMO24D0010482')).toBe('/admin/deal-files?q=TT9DEMO24D0010482');
    expect(searchTarget('Bergview Agri')).toBe('/admin/deal-files?q=Bergview%20Agri');
  });
  it('ignores empty input', () => {
    expect(searchTarget('   ')).toBeNull();
  });
});

describe('phone bottom bar (M6 stock)', () => {
  const tabsFor = (role: Member['role']) => {
    const nav = visibleNav(member(role));
    const keys = phoneTabKeys(nav);
    return nav.filter((n) => keys.has(n.key)).map((n) => n.key);   // displayed in NAV order
  };
  it('factory staff get Home and Stock', () => {
    expect(NAV.find((n) => n.key === 'stock')?.tab).toBe(true);
    expect(tabsFor('factory')).toEqual(['home', 'stock']);
  });
  it('never more than 5 items; office roles keep their bar, reviewers have room for Stock', () => {
    expect(MAX_PHONE_TABS).toBe(5);
    for (const r of ['admin', 'staff', 'reviewer', 'inspector', 'factory'] as const) expect(tabsFor(r).length, r).toBeLessThanOrEqual(5);
    expect(tabsFor('admin')).toEqual(['home', 'tasks', 'forms', 'deals', 'leads']);
    expect(tabsFor('staff')).toEqual(['home', 'tasks', 'forms', 'deals', 'leads']);
    expect(tabsFor('reviewer')).toEqual(['home', 'tasks', 'forms', 'deals', 'stock']);
  });
  it('picks by priority, keeps unlisted tab items last, and honours a smaller max', () => {
    const items = [{ key: 'x', tab: true }, { key: 'stock', tab: true }, { key: 'home', tab: true }, { key: 'quotes', tab: false }];
    expect([...phoneTabKeys(items, 2)].sort()).toEqual(['home', 'stock']);
    expect(phoneTabKeys(items).has('quotes')).toBe(false);
  });
  it('the shell builds the bar with phoneTabKeys and passes search access', () => {
    const shell = readFileSync(path.resolve(__dirname, '../../components/shell/AppShell.tsx'), 'utf8');
    expect(shell).toContain('tab: tabKeys.has(n.key)');
    expect(shell).toContain('searchAccess={searchAccessOf(member)}');
    const frame = readFileSync(path.resolve(__dirname, '../../components/shell/ShellFrame.tsx'), 'utf8');
    // M7: only shown when something is searchable.
    expect(frame.match(/<GlobalSearch [^>]*access=\{searchable\}/g)).toHaveLength(2);
  });
});

describe('global search for stock-only members (M6 stock)', () => {
  it('sends a VIN (and anything else) to the unit register when the member cannot read Xero', () => {
    const factory = searchAccessOf(member('factory'));
    expect(factory).toEqual({ deals: false, quotes: false, invoices: false, stock: true });
    expect(searchTarget('TT9DEMO24D0010482', factory)).toBe('/admin/stock/units?q=TT9DEMO24D0010482');
    expect(searchTarget('inv-20931', factory)).toBe('/admin/stock/units?q=inv-20931');
    expect(searchTarget(' 2026 / 248 ', factory)).toBe('/admin/stock/units?q=2026%20%2F%20248');
  });
  it('office roles keep the Xero and deal file routing', () => {
    for (const r of ['admin', 'staff', 'reviewer'] as const) {
      const a = searchAccessOf(member(r));
      expect(searchTarget('TT9DEMO24D0010482', a), r).toBe('/admin/deal-files?q=TT9DEMO24D0010482');
      expect(searchTarget('QU-10482', a), r).toBe('/admin/xero/quotes?q=QU-10482');
    }
    expect(searchAccessOf(null)).toEqual({ deals: false, quotes: false, invoices: false, stock: false });
    expect(searchTarget('TT9DEMO24D0010482', { deals: false, quotes: false, invoices: false, stock: false })).toBeNull();
  });
});
