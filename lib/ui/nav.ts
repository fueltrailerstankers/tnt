import type { IconName } from '@/components/ui/Icon';
import { can, type Member, type Permission } from '@/lib/security/can';

// Single source for the sidebar, the phone menu and the bottom tab bar. Pure.
// `built: false` keeps an item (and its route) out of the UI until its page exists, so there are no dead links.

export interface NavDef {
  key: string;
  label: string;
  href: string;
  icon: IconName;
  perm: Permission;
  /** Also shown when the member holds any of these (Settings: its Users and Activity log tabs). */
  anyOf?: readonly Permission[];
  built: boolean;
  /** Shown in the phone bottom tab bar. */
  tab?: boolean;
  /** Badge count source. */
  badge?: 'tasks' | 'leads';
}

export const NAV: readonly NavDef[] = [
  { key: 'home', label: 'Home', href: '/admin', icon: 'home', perm: 'home.read', built: true, tab: true },
  { key: 'tasks', label: 'Tasks', href: '/admin/tasks', icon: 'tasks', perm: 'tasks.read', built: true, tab: true, badge: 'tasks' },
  { key: 'forms', label: 'Forms', href: '/admin/forms', icon: 'forms', perm: 'forms.read', built: true, tab: true },
  { key: 'deals', label: 'Deals', href: '/admin/deal-files', icon: 'deals', perm: 'deals.read', built: true, tab: true },
  { key: 'quotes', label: 'Quotes', href: '/admin/xero/quotes', icon: 'quotes', perm: 'quotes.read', built: true },
  { key: 'invoices', label: 'Invoices', href: '/admin/xero/invoices', icon: 'invoices', perm: 'invoices.read', built: true },
  { key: 'stock', label: 'Stock', href: '/admin/stock', icon: 'stock', perm: 'stock.read', built: true, tab: true },
  { key: 'documents', label: 'Documents', href: '/admin/documents', icon: 'documents', perm: 'entries.read', built: false },
  { key: 'leads', label: 'Leads', href: '/admin/leads', icon: 'leads', perm: 'leads.read', built: true, tab: true, badge: 'leads' },
  { key: 'integrations', label: 'Integrations', href: '/admin/integrations/xero', icon: 'integrations', perm: 'integrations.read', built: true },
  { key: 'settings', label: 'Settings', href: '/admin/settings', icon: 'settings', perm: 'settings.read', anyOf: ['users.read', 'audit.read'], built: true },
];

export function visibleNav(member: Member | null, defs: readonly NavDef[] = NAV): NavDef[] {
  return defs.filter((n) => n.built && (can(member, n.perm) || (n.anyOf ?? []).some((p) => can(member, p))));
}

/**
 * Whether the admin home lists forms. Every link there opens an entries page (/admin/forms/<slug>, entries.read),
 * so roles with admin access but no entries (factory) get the home page without them.
 */
export function homeShowsForms(member: Member | null): boolean {
  return can(member, 'entries.read');
}

/** The item whose href is the longest prefix of the path ('/admin' only matches exactly). */
export function activeKey(pathname: string, defs: readonly Pick<NavDef, 'key' | 'href'>[]): string | null {
  let best: { key: string; len: number } | null = null;
  for (const d of defs) {
    const hit = d.href === '/admin' ? pathname === '/admin' : pathname === d.href || pathname.startsWith(`${d.href}/`);
    if (hit && (!best || d.href.length > best.len)) best = { key: d.key, len: d.href.length };
  }
  return best?.key ?? null;
}

/** The phone bottom bar holds at most this many items. */
export const MAX_PHONE_TABS = 5;

/**
 * Which tab items win when more than MAX_PHONE_TABS qualify (earlier wins). Stock is last, so office roles keep
 * their bar (Home, Tasks, Forms, Deals, Leads) and reach Stock from the menu; factory staff (Home, Stock) and
 * reviewers (5 items) still get it. Unlisted tab items rank after these.
 */
export const TAB_PRIORITY: readonly string[] = ['home', 'tasks', 'forms', 'deals', 'leads', 'stock'];

/** Keys of the items shown in the phone bottom bar (displayed in NAV order). */
export function phoneTabKeys(items: readonly Pick<NavDef, 'key' | 'tab'>[], max = MAX_PHONE_TABS): Set<string> {
  const rank = (k: string) => {
    const i = TAB_PRIORITY.indexOf(k);
    return i < 0 ? TAB_PRIORITY.length : i;
  };
  const tabs = items.filter((i) => i.tab).map((i, order) => ({ key: i.key, rank: rank(i.key), order }));
  return new Set(tabs.sort((a, b) => a.rank - b.rank || a.order - b.order).slice(0, max).map((t) => t.key));
}

/** Badge text: empty for zero, capped at 99+. */
export function badgeLabel(n: number | undefined): string {
  if (!n || n < 1) return '';
  return n > 99 ? '99+' : String(n);
}
