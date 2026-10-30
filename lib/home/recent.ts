// Home "Recent entries" rows. Pure. Encrypted forms only ever show number, clear summary, status and time:
// their entries carry data = {} and Home never decrypts.
import type { EntryData } from '@/lib/spec/values';
import { displayValue } from '@/lib/spec/values';
import { dayTime, type TimeInput } from '@/lib/ui/time';
import { entryReference, formUi } from './forms';

/** actor_role of the system actor (lib/workflow/run-action.ts SYSTEM_ROLE): jobs such as release.on_paid. */
export const SYSTEM_ROLE = 'System';

export interface RecentEntryInput {
  id: string;
  slug: string;
  formName: string;
  number: number;
  status: string;
  statusColor: string | null;
  summary: string | null;
  data: EntryData | null;
  createdAt: string;
  submittedAt: string | null;
  createdBy: string | null;
  /** actor_role of the entry's first timeline event. */
  firstRole: string | null;
  read: boolean;
}

export interface RecentEntryRow {
  id: string;
  label: string;
  href: string;
  reference: string;
  by: string;
  when: string;
  status: string;
  statusColor: string | null;
  unread: boolean;
}

/** Who started the entry: a staff name, "Auto · Xero" for jobs, the inspector's own name, or "Public link". */
export function byLabel(e: Pick<RecentEntryInput, 'slug' | 'createdBy' | 'firstRole' | 'data'>, names: ReadonlyMap<string, string>): string {
  if (e.createdBy) return names.get(e.createdBy) ?? 'Staff member';
  if (e.firstRole === SYSTEM_ROLE) return 'Auto · Xero';
  if (e.slug === 'trailer-inspection-checklist') {
    const n = displayValue(e.data?.InspectedByName).trim();
    return n || 'Inspector link';
  }
  return 'Public link';
}

export function recentRows(entries: readonly RecentEntryInput[], names: ReadonlyMap<string, string>, now: TimeInput): RecentEntryRow[] {
  return entries.map((e) => ({
    id: e.id,
    label: `${formUi(e.slug, e.formName).label} #${e.number}`,
    href: `/admin/forms/${e.slug}/entries/${e.number}`,
    reference: entryReference(e.slug, e.summary, e.data),
    by: byLabel(e, names),
    when: dayTime(e.submittedAt ?? e.createdAt, now),
    status: e.status,
    statusColor: e.statusColor,
    unread: !e.read,
  }));
}
