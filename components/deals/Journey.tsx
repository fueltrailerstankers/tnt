import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { StatusChip } from '@/components/ui/StatusChip';
import type { Journey as JourneyData, StepState } from '@/lib/deal-view/journey';
import { longDateTime } from '@/lib/ui/time';

const MARK: Record<StepState, string> = {
  done: 'bg-status-green-fg text-surface',
  current: 'border-2 border-accent text-accent-text',
  todo: 'border border-border-strong text-fg-muted',
};
const STATE_TEXT: Record<StepState, string> = { done: 'done', current: 'current step', todo: 'not started' };

/**
 * Horizontal trailer journey (wraps to one column on phones). Each step: mark (check when done), name, status chip,
 * when and who, and a link to the entry. State is in text too (screen-reader label), never colour alone.
 */
export function Journey({ journey, entriesHidden }: { journey: JourneyData; entriesHidden: boolean }) {
  const n = journey.steps.length;
  return (
    <Card aria-labelledby="journey-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="journey-h" className="m-0 text-[15px] font-semibold leading-[22px]">Trailer journey</h2>
        {journey.jobCard ? (
          <p className="m-0 text-small text-fg-muted">
            Also linked: {journey.jobCard.href
              ? <Link href={journey.jobCard.href} className="font-semibold text-accent-text">{journey.jobCard.label}</Link>
              : journey.jobCard.label}
          </p>
        ) : null}
      </div>
      {entriesHidden ? (
        <p className="m-0 text-small text-fg-muted">You can see which forms are linked, but not the entries themselves (Forms access is needed).</p>
      ) : null}
      <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(190px,100%),1fr))] gap-y-5 p-0" data-testid="deal-journey">
        {journey.steps.map((s, i) => (
          <li
            key={s.key}
            className="flex min-w-0 flex-col gap-2.5 pr-3"
            aria-current={s.state === 'current' ? 'step' : undefined}
            data-testid={`journey-step-${s.key}`}
            data-state={s.state}
          >
            <div className="flex items-center" aria-hidden="true">
              <span className={`flex size-8 flex-none items-center justify-center rounded-full text-[13px] font-bold ${MARK[s.state]}`}>
                {s.state === 'done' ? <Icon name="check" size={16} strokeWidth={2.5} /> : i + 1}
              </span>
              <span className={`ml-2 h-[3px] flex-1 rounded-[2px] ${i === n - 1 ? 'bg-transparent' : s.state === 'done' ? 'bg-status-green-fg' : 'bg-border'}`} />
            </div>
            <h3 className="m-0 text-[15px] font-semibold leading-[22px]">
              {s.label}
              <span className="sr-only">{`, step ${i + 1} of ${n}, ${STATE_TEXT[s.state]}`}</span>
            </h3>
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusChip status={s.status} color={s.tone} />
              {s.auto ? <Badge variant="auto" /> : null}
            </span>
            <span className="text-small text-fg-muted">
              {s.at ? [longDateTime(s.at), s.who].filter(Boolean).join(' · ') : s.state === 'current' ? 'Now' : '—'}
            </span>
            {s.href && s.linkLabel ? (
              <Link href={s.href} className="self-start text-small font-semibold text-accent-text">{s.linkLabel}</Link>
            ) : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}
