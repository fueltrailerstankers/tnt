import { StockTabs } from '@/components/stock/StockTabs';
import { stockTabs } from '@/lib/stock/tabs';
import { requirePerm } from '@/lib/security/require';

export const dynamic = 'force-dynamic';

/** Stock section (docs/M6.md section 5): one sidebar item, sub-pages as tabs the member may open. */
export default async function StockLayout({ children }: { children: React.ReactNode }) {
  const member = await requirePerm('stock.read');
  return (
    <div className="space-y-5">
      <StockTabs items={stockTabs(member)} />
      {children}
    </div>
  );
}
