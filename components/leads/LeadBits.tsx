import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { ZarAmount } from '@/components/ui/ZarAmount';
import { sourceBadge, statusLabel, statusTone, type Money, type StageTone } from '@/lib/leads-view/model';

// Small presentational pieces shared by the inbox, pipeline and phone views. Tokens only.

const CHIP: Record<StageTone, string> = {
  teal: 'bg-status-teal-bg text-status-teal-fg',
  yellow: 'bg-status-yellow-bg text-status-yellow-fg',
  accent: 'bg-accent-soft text-accent-text',
  green: 'bg-status-green-bg text-status-green-fg',
  gray: 'bg-status-gray-bg text-status-gray-fg',
  red: 'bg-status-red-bg text-status-red-fg',
};

/** Column dot colours (design: teal, yellow, orange, green, muted). */
export const STAGE_DOT: Record<StageTone, string> = {
  teal: 'bg-status-teal-fg',
  yellow: 'bg-status-yellow-fg',
  accent: 'bg-accent',
  green: 'bg-status-green-fg',
  gray: 'bg-fg-muted',
  red: 'bg-status-red-fg',
};

/** Lead status chip: dot + label + tone (never colour alone). */
export function LeadStatusChip({ status, size = 'sm', testId }: { status: string; size?: 'sm' | 'md'; testId?: string }) {
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill font-semibold ${size === 'sm' ? 'h-5 px-[7px] text-[11px]' : 'h-[22px] px-2 text-label tracking-normal'} ${CHIP[statusTone(status)]}`}
    >
      <span aria-hidden="true" className="size-[5px] rounded-full bg-current" />
      {statusLabel(status)}
    </span>
  );
}

export function SourceTag({ source, names, prefix }: { source: string; names?: ReadonlyMap<string, string>; prefix?: string }) {
  const b = sourceBadge(source, names);
  return <Badge variant={b.variant}>{prefix ? `${prefix}${b.label}` : b.label}</Badge>;
}

export function DuplicateTag() {
  return <Badge variant="warning">Duplicate?</Badge>;
}

/** Matched quote sums ("R 198,400.00 ZAR"), or a dash. Several currencies are listed separately. */
export function QuoteSums({ sums, size = 'sm' }: { sums: readonly Money[]; size?: 'sm' | 'md' }) {
  if (!sums.length) return <span className="text-[12px] text-fg-muted"><span aria-hidden="true">—</span><span className="sr-only">no matched quotes</span></span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {sums.map((s) => <ZarAmount key={s.currency} amount={s.total} currency={s.currency} size={size} />)}
    </span>
  );
}

/** Inbox / Pipeline switch: two links styled as a segmented control; the current one has aria-current. */
export function LeadsViewSwitch({ current, inboxHref = '/admin/leads' }: { current: 'inbox' | 'pipeline'; inboxHref?: string }) {
  const item = (on: boolean) => `inline-flex h-[30px] items-center rounded-pill px-3.5 text-small font-semibold no-underline ${on ? 'bg-surface text-fg shadow-card' : 'text-fg-muted hover:text-fg'}`;
  return (
    <nav aria-label="Leads view" className="inline-flex gap-0.5 rounded-pill border border-border bg-surface-2 p-[3px]">
      <Link href={inboxHref} aria-current={current === 'inbox' ? 'page' : undefined} className={item(current === 'inbox')}>Inbox</Link>
      <Link href="/admin/leads/pipeline" aria-current={current === 'pipeline' ? 'page' : undefined} className={item(current === 'pipeline')}>Pipeline</Link>
    </nav>
  );
}
