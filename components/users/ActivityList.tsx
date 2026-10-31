import Link from 'next/link';
import { formatDateTime } from '@/lib/admin/grid';
import { areaOf, describe, type AuditRow } from '@/lib/activity/describe';
import { AREA_LABELS } from '@/lib/security/can';

/** Audit rows in plain words, newest first, each with a link to its record when there is one. Phone-friendly list. */
export function ActivityList({ rows, names, timeZone, empty }: { rows: AuditRow[]; names: ReadonlyMap<string, string>; timeZone: string; empty: string }) {
  if (!rows.length) return <p className="text-fg-muted">{empty}</p>;
  return (
    <ol className="divide-y divide-border" data-testid="activity-rows">
      {rows.map((r) => {
        const d = describe(r, names);
        const area = areaOf(r.action);
        return (
          <li key={r.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-3">
            <time dateTime={r.created_at} className="shrink-0 text-small tabular-nums text-fg-muted sm:w-40">{formatDateTime(r.created_at, timeZone)}</time>
            <span className="min-w-0 flex-1 break-words" data-action={r.action}>
              {d.href ? <Link href={d.href} className="underline">{d.text}</Link> : d.text}
            </span>
            {area ? <span className="shrink-0 text-small text-fg-muted">{AREA_LABELS[area]}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
