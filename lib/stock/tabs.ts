// Stock sub-pages as tabs under the one "Stock" nav item (docs/M6.md section 5). Pure.
// `built: false` keeps a tab out of the UI until its page exists (same rule as lib/ui/nav.ts), so no dead links.

import { can, type Member, type Permission } from '@/lib/security/can';

export interface StockTabDef {
  key: 'overview' | 'deals' | 'units' | 'dispatch' | 'invoices' | 'activity' | 'setup';
  label: string;
  href: string;
  perm: Permission;
  built: boolean;
}

export const STOCK_TABS: readonly StockTabDef[] = [
  { key: 'overview', label: 'Stock', href: '/admin/stock', perm: 'stock.read', built: false },
  { key: 'deals', label: 'Deals', href: '/admin/stock/deals', perm: 'stock.read', built: true },
  { key: 'units', label: 'Units', href: '/admin/stock/units', perm: 'stock.read', built: false },
  { key: 'dispatch', label: 'Dispatch', href: '/admin/stock/dispatch', perm: 'stock.dispatch', built: true },
  { key: 'invoices', label: 'Invoices', href: '/admin/stock/invoices', perm: 'stock.invoices', built: false },
  { key: 'activity', label: 'Activity', href: '/admin/stock/activity', perm: 'stock.read', built: false },
  { key: 'setup', label: 'Setup', href: '/admin/stock/setup', perm: 'stock.manage', built: false },
];

/** Tabs the member may open, the current one marked. */
export function stockTabs(member: Member | null, current: StockTabDef['key'], defs: readonly StockTabDef[] = STOCK_TABS) {
  return defs.filter((t) => t.built && can(member, t.perm)).map((t) => ({ href: t.href, label: t.label, current: t.key === current }));
}
