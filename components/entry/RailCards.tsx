import { Card, CardHeader } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { Timeline } from '@/components/ui/Timeline';
import type { LowItem, PdfVersion } from '@/lib/entry-view/rail';
import type { TimelineItem } from '@/lib/ui/timeline';
import { dayTime } from '@/lib/ui/time';

/** Timeline card: who did what and which fields changed (names only, never values). */
export function TimelineCard({ items, now }: { items: TimelineItem[]; now: string }) {
  return (
    <Card padding="sm" aria-labelledby="entry-timeline-h">
      <CardHeader id="entry-timeline-h" title="Timeline" />
      <Timeline items={items} now={now} />
    </Card>
  );
}

export interface EmailRow {
  id: string;
  subject: string;
  /** Already masked where a recipient is a protected value. */
  to: string[];
  status: string;
  /** Provider or log-only note, shown muted under the status. */
  error: string | null;
  failed: boolean;
  at: string;
}

/** Emails sent for the entry: recipients and subject only (email_log never stores bodies). */
export function EmailsCard({ emails, now }: { emails: EmailRow[]; now: string }) {
  return (
    <Card padding="sm" aria-labelledby="entry-emails-h">
      <CardHeader id="entry-emails-h" title="Emails sent" />
      {emails.length ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-small" data-testid="emails">
          {emails.map((m) => (
            <li key={m.id} className="flex flex-col gap-0.5">
              <span className="min-w-0 break-words text-fg">
                {m.subject} <span aria-hidden="true">→</span><span className="sr-only">to</span> {m.to.join(', ')}
              </span>
              <span className="flex flex-wrap items-center gap-x-2 text-[12px] leading-4 text-fg-muted">
                <span className={`inline-flex items-center gap-1 font-semibold ${m.failed ? 'text-status-red-fg' : 'text-status-green-fg'}`}>
                  <Icon name={m.failed ? 'warning' : 'check'} size={12} strokeWidth={2.5} />
                  {m.status}
                </span>
                <time dateTime={m.at}>{dayTime(m.at, now)} SAST</time>
              </span>
              {m.error ? <span className="break-words text-[12px] leading-4 text-fg-muted">{m.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-small text-fg-muted" data-testid="emails">None.</p>
      )}
    </Card>
  );
}

/** Generated PDFs: current download per template, then stored versions v1, v2… with sha256 truncated. */
export function PdfsCard({ base, templates, versions, now }: { base: string; templates: Array<{ number: number; label: string }>; versions: PdfVersion[]; now: string }) {
  const many = templates.length > 1 || versions.some((v) => !templates.some((t) => t.number === v.template));
  return (
    <Card padding="sm" aria-labelledby="entry-pdfs-h">
      <CardHeader id="entry-pdfs-h" title="Generated PDFs" />
      {templates.length ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {templates.map((t) => (
            <li key={t.number}>
              <a href={`${base}/documents/${t.number}`} className="inline-flex items-center gap-1.5 text-small font-semibold text-accent-text underline-offset-2 hover:underline">
                <Icon name="download" size={14} strokeWidth={2} />
                {t.label} (PDF)
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {versions.length ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="pdf-versions">
          {versions.map((d) => (
            <li key={d.id} className="flex items-center gap-2.5 text-small">
              <span className="w-[26px] flex-none font-mono font-semibold">{d.v}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">
                  {many ? `${d.templateLabel} · ` : ''}
                  <time dateTime={d.at}>{dayTime(d.at, now)} SAST</time>
                </span>
                <span className="font-mono text-[11px] leading-4 text-fg-muted">sha256 {d.hash}</span>
              </span>
              <a
                href={`${base}/documents/${d.template}?version=${encodeURIComponent(d.id)}`}
                aria-label={`Download PDF ${d.v}${many ? ` of ${d.templateLabel}` : ''}`}
                className="flex-none font-semibold text-accent-text underline-offset-2 hover:underline"
              >
                PDF
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-small text-fg-muted">No stored versions yet.</p>
      )}
    </Card>
  );
}

/** Store Room counts below their minimum (value / minimum). */
export function BelowMinimumCard({ items }: { items: LowItem[] }) {
  return (
    <Card padding="sm" aria-labelledby="entry-low-h" data-testid="below-minimum">
      <CardHeader id="entry-low-h" title={`Below minimum · ${items.length}`} />
      {items.length ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((l) => (
            <li key={l.name} className="flex justify-between gap-2 border-t border-border py-1.5 text-small">
              <span className="min-w-0">{l.label}</span>
              <span className="whitespace-nowrap font-mono font-semibold text-status-red-fg">
                {l.value} / {l.min}
                <span className="sr-only"> (short by {l.short})</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-small text-fg-muted">Every count is at or above its minimum.</p>
      )}
    </Card>
  );
}
