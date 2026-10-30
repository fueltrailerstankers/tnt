'use client';

import { usePathname } from 'next/navigation';
import { Tabs } from '@/components/ui/Tabs';
import { currentStockTab, type StockTabItem } from '@/lib/stock/tabs';

/** Stock section tabs; the items are filtered by permission on the server (lib/stock/tabs.ts), the current one follows the path. */
export function StockTabs({ items }: { items: StockTabItem[] }) {
  const current = currentStockTab(usePathname() ?? '', items);
  return <Tabs label="Stock sections" items={items.map((t) => ({ href: t.href, label: t.label, current: t.key === current }))} />;
}
