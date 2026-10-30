import Link from 'next/link';
import { StatusChip } from '@/components/ui/StatusChip';
import type { XeroHealth } from '@/lib/home/xero-health';

const XERO_PAGE = '/admin/integrations/xero';

/** "Xero sync health": chip (Healthy / N failures / Not connected), last sync, token expiry, failures in 24 h. */
export function XeroHealthTile({ health }: { health: XeroHealth | null }) {
  const rows = health?.rows ?? [
    { label: 'Last sync', value: '—' },
    { label: 'Token expiry', value: '—' },
    { label: 'Failures 24 h', value: '—' },
  ];
  return (
    <Link
      href={XERO_PAGE}
      data-testid="xero-health"
      className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4 text-fg no-underline transition hover:border-border-strong"
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-small text-fg-muted">Xero sync health</span>
        {health ? <StatusChip status={health.chip.label} color={health.chip.tone} /> : <StatusChip status="Unavailable" color="gray" />}
      </span>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-[3px] text-small">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-fg-muted">{r.label}</dt>
            <dd className={`m-0 font-semibold ${'danger' in r && r.danger ? 'text-status-red-fg' : ''}`}>{r.value}</dd>
          </div>
        ))}
      </dl>
    </Link>
  );
}
