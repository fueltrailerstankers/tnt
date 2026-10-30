import Link from 'next/link';
import { Card, CardHeader } from '@/components/ui/Card';
import type { SyncDot, SyncRowView } from '@/lib/home/xero-health';

const DOT: Record<SyncDot, string> = { ok: 'bg-status-green-fg', failed: 'bg-danger', never: 'bg-border-strong' };

/** Last sync per Xero mirror entity. The text always says the state; the dot only repeats it. */
export function SyncByEntityCard({ rows }: { rows: SyncRowView[] }) {
  return (
    <Card padding="sm" aria-labelledby="home-sync-title" data-testid="sync-by-entity">
      <CardHeader id="home-sync-title" title="Sync by entity" action={<Link href="/admin/integrations/xero" className="font-semibold underline underline-offset-2">Integrations</Link>} />
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map((s) => (
          <li key={s.entity} className="flex items-center gap-2.5 text-small">
            <span aria-hidden="true" className={`size-2 flex-none rounded-full ${DOT[s.dot]}`} />
            <span className="flex-1 font-medium text-fg">{s.label}</span>
            <span className="text-fg-muted">{s.when}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
