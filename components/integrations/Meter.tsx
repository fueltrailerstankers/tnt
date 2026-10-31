import type { Meter as MeterValue } from '@/lib/settings/xero-page';
import type { Tone } from '@/lib/ui/status';

const FILL: Record<Tone, string> = {
  gray: 'bg-status-gray-fg',
  teal: 'bg-status-teal-fg',
  yellow: 'bg-status-yellow-fg',
  green: 'bg-status-green-fg',
  red: 'bg-danger',
};

/** Labelled bar (token expiry, rate-limit headroom). The value is always in the text too, never colour alone. */
export function Meter({ title, meter, mono = false, testId }: { title: string; meter: MeterValue; mono?: boolean; testId?: string }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <div className="flex flex-wrap justify-between gap-x-3 text-small">
        <span>{title}</span>
        <span className={`font-semibold ${mono ? 'font-mono' : ''}`}>{meter.label}</span>
      </div>
      <div
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={meter.pct ?? 0}
        aria-valuetext={meter.label}
        className="h-1.5 w-full overflow-hidden rounded-pill bg-border"
      >
        {meter.pct !== null ? <div className={`h-full rounded-pill ${FILL[meter.tone]}`} style={{ width: `${meter.pct}%` }} /> : null}
      </div>
    </div>
  );
}
