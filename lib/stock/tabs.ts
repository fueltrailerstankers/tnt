// Stock section tabs (docs/M6.md section 5): one "Stock" sidebar item, sub-pages as Tabs. Pure.
// A tab shows only when the member holds its permission; the page itself still calls requirePerm.

import { can, type Member, type Permission } from '@/lib/security/can';

export interface StockTab { key: string; label: string; href: string; perm: Permission }

export const STOCK_TABS: readonly StockTab[] = [
  { key: 'overview', label: 'Overview', href: '/admin/stock', perm: 'stock.read' },
  { key: 'units', label: 'Units', href: '/admin/stock/units', perm: 'stock.read' },
  { key: 'dispatch', label: 'Dispatch', href: '/admin/stock/dispatch', perm: 'stock.dispatch' },
  { key: 'deals', label: 'Deals', href: '/admin/stock/deals', perm: 'stock.read' },
  { key: 'invoices', label: 'Invoices', href: '/admin/stock/invoices', perm: 'stock.invoices' },
  { key: 'activity', label: 'Activity', href: '/admin/stock/activity', perm: 'stock.read' },
  { key: 'setup', label: 'Setup', href: '/admin/stock/setup', perm: 'stock.manage' },
];

export function stockTabs(member: Member | null): Pick<StockTab, 'key' | 'label' | 'href'>[] {
  return STOCK_TABS.filter((t) => can(member, t.perm)).map(({ key, label, href }) => ({ key, label, href }));
}

/** The tab for a path: the longest matching href ("/admin/stock" itself is Overview only). */
export function currentStockTab(pathname: string, tabs: readonly Pick<StockTab, 'key' | 'href'>[]): string | null {
  let best: { key: string; len: number } | null = null;
  for (const t of tabs) {
    const hit = t.href === '/admin/stock' ? pathname === '/admin/stock' : pathname === t.href || pathname.startsWith(`${t.href}/`);
    if (hit && (!best || t.href.length > best.len)) best = { key: t.key, len: t.href.length };
  }
  return best?.key ?? null;
}
