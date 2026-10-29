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
  built: boolean;
  /** Shown in the phone bottom tab bar. */
  tab?: boolean;
  /** Badge count source. */
  badge?: 'tasks' | 'leads';
}

export const NAV: readonly NavDef[] = [
  { key: 'home', label: 'Home', href: '/admin', icon: 'home', perm: 'admin.access', built: true, tab: true },
  { key: 'tasks', label: 'Tasks', href: '/admin/tasks', icon: 'tasks', perm: 'tasks.read', built: true, tab: true, badge: 'tasks' },
  { key: 'forms', label: 'Forms', href: '/admin/forms', icon: 'forms', perm: 'forms.read', built: true, tab: true },
  { key: 'deals', label: 'Deals', href: '/admin/deal-files', icon: 'deals', perm: 'xero.read', built: true, tab: true },
  { key: 'quotes', label: 'Quotes', href: '/admin/xero/quotes', icon: 'quotes', perm: 'xero.read', built: true },
  { key: 'invoices', label: 'Invoices', href: '/admin/xero/invoices', icon: 'invoices', perm: 'xero.read', built: true },
  { key: 'documents', label: 'Documents', href: '/admin/documents', icon: 'documents', perm: 'entries.read', built: false },
  { key: 'leads', label: 'Leads', href: '/admin/leads', icon: 'leads', perm: 'leads.read', built: true, tab: true, badge: 'leads' },
  { key: 'integrations', label: 'Integrations', href: '/admin/integrations/xero', icon: 'integrations', perm: 'xero.read', built: true },
  { key: 'settings', label: 'Settings', href: '/admin/settings', icon: 'settings', perm: 'settings.manage', built: true },
];

export function visibleNav(member: Member | null, defs: readonly NavDef[] = NAV): NavDef[] {
  return defs.filter((n) => n.built && can(member, n.perm));
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

/** Badge text: empty for zero, capped at 99+. */
export function badgeLabel(n: number | undefined): string {
  if (!n || n < 1) return '';
  return n > 99 ? '99+' : String(n);
}
