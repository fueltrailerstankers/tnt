// Toast queue rules. Pure. Toast text must never contain personal data, file names, emails or tokens.

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastInput {
  tone?: ToastTone;
  title: string;
  body?: string;
  /** Optional link, e.g. { label: 'View job', href: '/admin/settings?tab=jobs' }. */
  action?: { label: string; href: string };
  /** Milliseconds before auto-dismiss; null keeps it until dismissed. Errors always stay. */
  duration?: number | null;
}

export interface ToastItem extends ToastInput {
  id: number;
  tone: ToastTone;
}

export const MAX_TOASTS = 3;
export const TOAST_MS = 5000;

/** Auto-dismiss delay, or null when the toast stays until dismissed. */
export function toastDuration(t: Pick<ToastInput, 'tone' | 'duration'>): number | null {
  if (t.tone === 'error') return null;
  if (t.duration === null) return null;
  return typeof t.duration === 'number' && t.duration > 0 ? t.duration : TOAST_MS;
}

/** Success and info are polite status messages; errors interrupt. */
export function toastRole(tone: ToastTone): 'status' | 'alert' {
  return tone === 'error' ? 'alert' : 'status';
}

/** The live region a toast is announced in: success and info wait their turn (polite), errors interrupt. */
export function toastPoliteness(tone: ToastTone): 'polite' | 'assertive' {
  return tone === 'error' ? 'assertive' : 'polite';
}

/** What a screen reader hears: the title, then the body. The action link is reachable in the card itself. */
export function toastAnnouncement(t: Pick<ToastInput, 'title' | 'body'>): string {
  const title = t.title.trim();
  const body = (t.body ?? '').trim();
  if (!body) return title;
  return /[.!?…]$/.test(title) ? `${title} ${body}` : `${title}. ${body}`;
}

/** Appends a toast and keeps the newest `max`. */
export function pushToast(list: readonly ToastItem[], item: ToastItem, max = MAX_TOASTS): ToastItem[] {
  return [...list, item].slice(-Math.max(1, max));
}
