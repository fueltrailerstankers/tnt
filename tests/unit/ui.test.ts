import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { activeKey, badgeLabel, homeShowsForms, NAV, visibleNav } from '@/lib/ui/nav';
import { searchTarget } from '@/lib/ui/search';
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
