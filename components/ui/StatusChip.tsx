import { toneFor, type Tone } from '@/lib/ui/status';

const TONE_CLASS: Record<Tone, string> = {
  gray: 'bg-status-gray-bg text-status-gray-fg',
  teal: 'bg-status-teal-bg text-status-teal-fg',
  yellow: 'bg-status-yellow-bg text-status-yellow-fg',
  green: 'bg-status-green-bg text-status-green-fg',
  red: 'bg-status-red-bg text-status-red-fg',
};

/** Dot + label + tone, never colour alone. `color` is the spec's colour name; unknown values fall back to the status label's tone. */
export function StatusChip({ status, color, size = 'md' }: { status: string; color?: string | null; size?: 'sm' | 'md' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill font-semibold ${size === 'sm' ? 'h-5 px-2 text-[11px]' : 'h-[22px] px-2 text-label tracking-normal'} ${TONE_CLASS[toneFor(status, color)]}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}
