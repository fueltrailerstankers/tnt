// Stock section tabs (docs/M6.md section 5): one "Stock" sidebar item, sub-pages as Tabs. Pure.
// The stock layout (app/(admin)/admin/stock/layout.tsx) renders them once for every stock page; a tab shows only
// when the member holds its permission (the page itself still calls requirePerm). `built: false` would keep a tab
// out of the UI until its page exists (same rule as lib/ui/nav.ts); every stock tab is built.

import { can, type Member, type Permission } from '@/lib/security/can';

export type StockTabKey = 'overview' | 'units' | 'dispatch' | 'deals' | 'invoices' | 'activity' | 'setup';

export interface StockTabDef {
  key: StockTabKey;
  label: string;
  href: string;
  perm: Permission;
  built: boolean;
}
export type StockTab = StockTabDef;

export const STOCK_TABS: readonly StockTabDef[] = [
  { key: 'overview', label: 'Overview', href: '/admin/stock', perm: 'stock.read', built: true },
  { key: 'units', label: 'Units', href: '/admin/stock/units', perm: 'stock.read', built: true },
  { key: 'dispatch', label: 'Dispatch', href: '/admin/stock/dispatch', perm: 'stock.dispatch', built: true },
  { key: 'deals', label: 'Deals', href: '/admin/stock/deals', perm: 'stock.read', built: true },
  { key: 'invoices', label: 'Invoices', href: '/admin/stock/invoices', perm: 'stock.invoices', built: true },
  { key: 'activity', label: 'Activity', href: '/admin/stock/activity', perm: 'stock.read', built: true },
  { key: 'setup', label: 'Setup', href: '/admin/stock/setup', perm: 'stock.manage', built: true },
];

export interface StockTabItem { key: StockTabKey; label: string; href: string; current: boolean }

/** Tabs the member may open (built and permitted), `current` marking the given one. */
export function stockTabs(member: Member | null, current: StockTabKey | null = null, defs: readonly StockTabDef[] = STOCK_TABS): StockTabItem[] {
  return defs.filter((t) => t.built && can(member, t.perm)).map(({ key, label, href }) => ({ key, label, href, current: key === current }));
}

/** The tab for a path: the longest matching href ("/admin/stock" itself is Overview only). */
export function currentStockTab(pathname: string, tabs: readonly Pick<StockTabDef, 'key' | 'href'>[]): StockTabKey | null {
  let best: { key: StockTabKey; len: number } | null = null;
  for (const t of tabs) {
    const hit = t.href === '/admin/stock' ? pathname === '/admin/stock' : pathname === t.href || pathname.startsWith(`${t.href}/`);
    if (hit && (!best || t.href.length > best.len)) best = { key: t.key, len: t.href.length };
  }
  return best?.key ?? null;
}
