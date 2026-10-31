import type { Tone } from '@/lib/ui/status';

/** Filled step dot per status tone (tokens only). Text on the dot is the surface colour, or white on red. */
export const DOT_FILL: Record<Tone, string> = {
  gray: 'bg-status-gray-fg text-surface',
  teal: 'bg-status-teal-fg text-surface',
  yellow: 'bg-status-yellow-fg text-surface',
  green: 'bg-status-green-fg text-surface',
  red: 'bg-danger text-white',
};

export const STEP_STATE_TEXT = { done: 'done', current: 'current status', todo: 'not reached' } as const;
