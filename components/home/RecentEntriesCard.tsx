import Link from 'next/link';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusChip } from '@/components/ui/StatusChip';
import type { RecentEntryRow } from '@/lib/home/recent';

/** Last six submitted entries across forms, with the caller's unread dot. */
export function RecentEntriesCard({ rows }: { rows: RecentEntryRow[] | null }) {
  return (
    <Card padding="none" aria-labelledby="home-recent-title">
      <CardHeader
        id="home-recent-title"
        title="Recent entries"
        className="border-b border-border px-4 py-3.5"
        action={<Link href="/admin/forms" className="font-semibold underline underline-offset-2">All entries</Link>}
      />
      <div className="overflow-x-auto">
        <table aria-labelledby="home-recent-title" className="w-full min-w-[640px] border-collapse text-body text-fg">
          <thead>
            <tr className="bg-surface-2 text-left text-[12px] leading-4 text-fg-muted">
              <th scope="col" className="px-4 py-2 font-semibold">Form</th>
              <th scope="col" className="p-2 font-semibold">Reference</th>
              <th scope="col" className="p-2 font-semibold">By</th>
              <th scope="col" className="p-2 font-semibold">When</th>
              <th scope="col" className="py-2 pl-2 pr-4 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr className="border-t border-border">
                <td colSpan={5} className="h-[42px] px-4 text-fg-muted">Recent entries could not be loaded.</td>
              </tr>
            ) : rows.length ? (
              rows.map((r) => (
                <tr key={r.id} className="border-t border-border" data-testid="recent-entry">
                  <td className="h-[42px] whitespace-nowrap px-4">
                    <span className={`flex items-center gap-2 ${r.unread ? 'font-semibold' : ''}`}>
                      <span aria-hidden="true" className={`size-2 flex-none rounded-full ${r.unread ? 'bg-accent' : 'bg-transparent'}`} />
                      {r.unread ? <span className="sr-only">Unread:</span> : null}
                      <Link href={r.href} className="text-fg no-underline hover:underline">{r.label}</Link>
                    </span>
                  </td>
                  <td className="px-2 font-mono text-small">{r.reference}</td>
                  <td className="px-2 text-fg-muted">{r.by}</td>
                  <td className="whitespace-nowrap px-2 text-fg-muted">{r.when}</td>
                  <td className="pl-2 pr-4"><StatusChip status={r.status} color={r.statusColor} /></td>
                </tr>
              ))
            ) : (
              <tr className="border-t border-border">
                <td colSpan={5} className="h-[42px] px-4 text-fg-muted">No entries yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
