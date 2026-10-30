import type { Tone } from '@/lib/ui/status';

/** Tinted surface + text for a status tone (icon boxes, banners). Tokens only. */
export const TONE_FILL: Record<Tone, string> = {
  gray: 'bg-status-gray-bg text-status-gray-fg',
  teal: 'bg-status-teal-bg text-status-teal-fg',
  yellow: 'bg-status-yellow-bg text-status-yellow-fg',
  green: 'bg-status-green-bg text-status-green-fg',
  red: 'bg-status-red-bg text-status-red-fg',
};
