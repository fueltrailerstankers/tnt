import { dayTime, shortDateTime } from '@/lib/ui/time';
import { timelineText, type TimelineItem, type TimelineTone } from '@/lib/ui/timeline';

const DOT: Record<TimelineTone, string> = {
  teal: 'bg-status-teal-fg',
  yellow: 'bg-status-yellow-fg',
  green: 'bg-status-green-fg',
  red: 'bg-danger',
  neutral: 'bg-border-strong',
};

export const TIMELINE_NOTE = 'Field names only. Values are never stored in the timeline.';

export interface TimelineProps {
  /** Build items with timelineItem() from lib/ui/timeline: they carry field names, never values. */
  items: readonly TimelineItem[];
  /** ISO "now" for "Today 09:14 SAST" / "Yesterday …"; without it times read "29 Oct, 09:14 SAST". */
  now?: string;
  /** Footer note; null hides it. */
  note?: string | null;
  emptyText?: string;
  testId?: string;
}

/** Who did what, which fields changed (names only) and when, in SAST. Newest first is the caller's order. */
export function Timeline({ items, now, note = TIMELINE_NOTE, emptyText = 'No activity yet.', testId = 'timeline' }: TimelineProps) {
  return (
    <div className="flex flex-col gap-3">
      {items.length ? (
        <ol data-testid={testId} className="m-0 flex list-none flex-col gap-3 p-0">
          {items.map((e) => (
            <li key={e.id} className="flex gap-2.5">
              <span aria-hidden="true" className={`mt-1.5 size-2 flex-none rounded-full ${DOT[e.tone]}`} />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="m-0 text-small text-fg">
                  <strong className="font-semibold">{e.who}</strong> {timelineText(e)}
                </p>
                <p className="m-0 text-[12px] leading-4 text-fg-muted">
                  <time dateTime={e.at}>{`${now ? dayTime(e.at, now) : shortDateTime(e.at)} SAST`}</time>
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p data-testid={testId} className="m-0 text-small text-fg-muted">{emptyText}</p>
      )}
      {note ? <p className="m-0 text-[12px] leading-4 text-fg-muted">{note}</p> : null}
    </div>
  );
}
