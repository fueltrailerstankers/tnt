import Link from 'next/link';
import { StockHeader } from '@/components/stock/StockHeader';
import { Icon, type IconName } from '@/components/ui/Icon';
import { buttonClass, cardClass, tableClass, theadClass } from '@/components/ui/styles';
import { buildMatrix, cellLabel, matrixFooter, stockKpis, type MatrixCellRow } from '@/lib/stock/kpi';
import { ALL_BRANCHES, unitsHref } from '@/lib/stock/register';
import { loadLocations } from '@/lib/stock/register-query';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { InStockToggle } from './in-stock-toggle';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Stock overview · Trailers & Tankers' };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Stock overview (stock plan 7.1): KPIs and the model x branch matrix. Reads through the caller's RLS. */
export default async function StockOverview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('stock.read');
  const sp = await searchParams;
  const inStockOnly = one(sp.instock) === '1';
  const db = await createClient();
  const [locs, { data: cellData, error: cellError }] = await Promise.all([
    loadLocations(db, member.orgId),
    db.from('stock_matrix').select('part_number, description, sort_order, active, location_id, qty, reserved').eq('org_id', member.orgId),
  ]);
  const locations = locs.data;
  // Without the locations every count would read as zero: show the error rather than a wrong picture.
  const error = locs.error || !!cellError;
  const cells = error ? [] : ((cellData ?? []) as MatrixCellRow[]);
  const kpis = stockKpis(cells, locations);
  const matrix = buildMatrix(cells, locations, { inStockOnly });
  const factory = locations.find((l) => l.is_factory)?.id ?? null;

  const cards: { key: string; label: string; value: number; sub: string; icon: IconName; href: string }[] = [
    {
      key: 'branches', label: 'Stock across branches', value: kpis.stockAcrossBranches, sub: `Includes ${kpis.branchReserved} reserved`, icon: 'stock',
      href: unitsHref({ location: ALL_BRANCHES, status: 'in_stock' }),
    },
    { key: 'ready', label: 'Ready to sell', value: kpis.readyToSell, sub: 'Available in branches', icon: 'tasks', href: unitsHref({ location: ALL_BRANCHES, status: 'available' }) },
    { key: 'reserved', label: 'Reserved', value: kpis.reserved, sub: 'Awaiting full payment', icon: 'invoices', href: unitsHref({ status: 'reserved' }) },
    { key: 'factory', label: 'At factory', value: kpis.atFactory, sub: 'Not in branch quantities', icon: 'factory', href: unitsHref({ location: factory, status: 'in_stock' }) },
  ];

  return (
    <section className="space-y-5">
      <StockHeader
        eyebrow="Your network, at a glance"
        title="Stock overview"
        subtitle="Find the right unit. See every branch."
        action={can(member, 'stock.dispatch') ? (
          <Link href="/admin/stock/dispatch" className={buttonClass('primary', 36)}><Icon name="plus" size={16} />Dispatch a unit</Link>
        ) : null}
      />

      {error ? <p role="alert" className="rounded-sm bg-status-red-bg p-3 text-body text-status-red-fg">Stock could not be loaded. Try again.</p> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.key} href={c.href} data-testid={`kpi-${c.key}`} className={`${cardClass} flex items-start justify-between gap-2 p-4 text-fg no-underline hover:border-border-strong`}>
            <span className="min-w-0">
              <span className="block text-small font-semibold text-fg-muted">{c.label}</span>
              <span className="block text-display tabular-nums" data-testid={`kpi-${c.key}-value`}>{c.value}</span>
              <span className="block text-small text-fg-muted">{c.sub}</span>
            </span>
            <span aria-hidden="true" className="hidden size-9 shrink-0 place-items-center rounded-sm bg-accent-soft text-accent-text sm:grid">
              <Icon name={c.icon} />
            </span>
          </Link>
        ))}
      </div>

      <div className={cardClass}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="text-h2">Stock by model</h2>
            <p className="text-small text-fg-muted">Branch counts include reserved units. Fully paid units are excluded.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-pill bg-surface-2 px-2.5 py-0.5 text-small font-semibold text-fg-muted" data-testid="branch-count">
              {matrix.branches.length} {matrix.branches.length === 1 ? 'branch' : 'branches'}
            </span>
            <InStockToggle checked={inStockOnly} />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className={tableClass} data-testid="stock-matrix">
            <thead className={theadClass}>
              <tr>
                <th scope="col" className="min-w-40 px-3 py-2 uppercase sm:px-4">Model / part number</th>
                {matrix.branches.map((b) => (
                  <th key={b.id} scope="col" className="px-2 py-2 text-center uppercase">
                    <abbr title={b.name} className="no-underline sm:hidden">{b.id}</abbr>
                    <span className="hidden sm:inline">{b.name}</span>
                  </th>
                ))}
                <th scope="col" className="px-2 py-2 text-center uppercase sm:px-4">Total</th>
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((r) => (
                <tr key={r.partNumber} className="border-t border-border" data-testid={`matrix-row-${r.partNumber}`}>
                  <th scope="row" className="px-3 py-2 text-left font-normal sm:px-4">
                    <span className="block font-semibold">{r.description}</span>
                    <span className="block font-mono text-small text-fg-muted">{r.partNumber}</span>
                  </th>
                  {matrix.branches.map((b) => (
                    <td key={b.id} className="px-2 py-2 text-center">
                      <Count n={r.cells[b.id].qty} reserved={r.cells[b.id].reserved} what={`${r.partNumber} at ${b.name}`}
                        href={unitsHref({ model: r.partNumber, location: b.id, status: 'in_stock' })} testId={`cell-${r.partNumber}-${b.id}`} />
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center sm:px-4">
                    <Count n={r.total} reserved={r.reserved} what={`${r.partNumber} across branches`} strong
                      href={unitsHref({ model: r.partNumber, location: ALL_BRANCHES, status: 'in_stock' })} testId={`cell-${r.partNumber}-total`} />
                  </td>
                </tr>
              ))}
              {!matrix.rows.length ? (
                <tr><td colSpan={matrix.branches.length + 2} className="p-6 text-center text-fg-muted">No units in branch stock.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-4 py-3 text-small text-fg-muted" data-testid="matrix-footer">
          {matrixFooter(matrix)} · <span className="inline-flex items-center gap-1"><span aria-hidden="true" className="size-2 rounded-full bg-status-yellow-fg" />Amber indicator = reserved units included</span>
        </p>
      </div>
    </section>
  );
}

/** A matrix count: em dash for zero, else a link to the register; amber (with text, not colour alone) when it includes reserved units. */
function Count({ n, reserved, what, href, testId, strong }: { n: number; reserved: number; what: string; href: string; testId: string; strong?: boolean }) {
  if (n <= 0) return <span className="text-fg-subtle" data-testid={testId}><span aria-hidden="true">{cellLabel(0)}</span><span className="sr-only">None</span></span>;
  const amber = reserved > 0;
  return (
    <Link
      href={href}
      data-testid={testId}
      data-reserved={amber ? reserved : undefined}
      title={amber ? `Includes ${reserved} reserved` : undefined}
      className={`inline-flex min-w-9 items-center justify-center gap-1 rounded-pill px-2 py-0.5 tabular-nums no-underline ${strong ? 'font-bold' : 'font-semibold'} ${amber ? 'bg-status-yellow-bg text-status-yellow-fg' : 'text-fg hover:bg-surface-2'}`}
    >
      {cellLabel(n)}
      {amber ? <span aria-hidden="true" className="size-1.5 rounded-full bg-current" /> : null}
      <span className="sr-only">{` units, ${what}${amber ? `, includes ${reserved} reserved` : ''}`}</span>
    </Link>
  );
}
