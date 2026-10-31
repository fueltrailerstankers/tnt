import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { Tabs } from '@/components/ui/Tabs';
import { dayTime } from '@/lib/ui/time';

const count = (n: number) => new Intl.NumberFormat('en-US').format(n);

/**
 * Title, the read-only note, "Last synced" and the Quotes / Invoices tabs (only the tabs the member may open).
 * Counts are the whole mirror (quotes; sales invoices), not the current filter.
 */
export function MirrorHeader({ kind, quoteCount, invoiceCount, syncedAt, syncFailed, now, healthHref }: {
  kind: 'quotes' | 'invoices';
  quoteCount: number | null;
  invoiceCount: number | null;
  syncedAt: string | null;
  syncFailed: boolean;
  now: string;
  /** Sync health page, only for members with Integrations read. */
  healthHref: string | null;
}) {
  const tabs = [
    quoteCount !== null ? { href: '/admin/xero/quotes', label: `Quotes · ${count(quoteCount)}`, current: kind === 'quotes' } : null,
    invoiceCount !== null ? { href: '/admin/xero/invoices', label: `Invoices · ${count(invoiceCount)}`, current: kind === 'invoices' } : null,
  ].filter((t): t is { href: string; label: string; current: boolean } => !!t);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="m-0 text-h1">{kind === 'quotes' ? 'Quotes' : 'Invoices'}</h1>
          <p className="m-0 flex items-start gap-1.5 text-small text-fg-muted">
            <span className="mt-0.5 flex-none"><Icon name="lock" size={14} strokeWidth={2} /></span>
            <span>Read-only mirror of Xero. Change these in Xero; the portal never creates quotes.</span>
          </p>
        </div>
        <p className="m-0 text-small text-fg-muted" data-testid="last-synced">
          {syncedAt ? <>Last synced {dayTime(syncedAt, now)} SAST</> : 'Not synced yet'}
          {syncFailed ? <span className="font-semibold text-status-red-fg"> · last sync failed</span> : null}
          {healthHref ? <> · <Link href={healthHref} className="font-semibold text-accent-text">Sync health</Link></> : null}
        </p>
      </div>
      {tabs.length > 1 ? <Tabs label="Record type" items={tabs} /> : null}
    </div>
  );
}
