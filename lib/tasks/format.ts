// Relative times for task lists and the home dashboard. Pure. Stored times are UTC; days are SAST calendar days.
import { clock, dayTime, SAST_ZONE, sastClock, type TimeInput } from '@/lib/ui/time';

const DAY = new Intl.DateTimeFormat('en-GB', { timeZone: SAST_ZONE, year: 'numeric', month: 'numeric', day: 'numeric' });

function toDate(v: TimeInput): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? new Date(v.getTime()) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Days since the epoch of the SAST calendar day the instant falls on. */
export function sastDay(v: TimeInput): number | null {
  const d = toDate(v);
  if (!d) return null;
  const p: Record<string, string> = {};
  for (const { type, value } of DAY.formatToParts(d)) p[type] = value;
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / 86_400_000;
}

/** Whole SAST calendar days between v and now (0 = same day). Null for a missing time. */
export function daysAgo(v: TimeInput, now: TimeInput): number | null {
  const a = sastDay(v);
  const b = sastDay(now);
  return a === null || b === null ? null : b - a;
}

/** Task age: "Today 09:14", "Yesterday 15:40", then "2 days", "9 days". Empty for a missing time. */
export function ageLabel(v: TimeInput, now: TimeInput): string {
  const days = daysAgo(v, now);
  if (days === null) return '';
  if (days < 2) return dayTime(v, now);
  return `${days} days`;
}

/** Inline "when" in running text: "09:14" today, "yesterday 16:40", "27 Oct 15:48". */
export function sinceLabel(v: TimeInput, now: TimeInput): string {
  const days = daysAgo(v, now);
  if (days === null) return '';
  if (days === 0) return clock(v);
  const t = dayTime(v, now);
  return days === 1 ? t.replace(/^Yesterday/, 'yesterday') : t;
}

/** Short "when" on its own: "09:14" today, else "Yesterday 16:40" / "27 Oct 15:48". */
export function whenLabel(v: TimeInput, now: TimeInput): string {
  return daysAgo(v, now) === 0 ? clock(v) : dayTime(v, now);
}

/** A sync or run stamp: "14:30 SAST" today, else "Yesterday 14:30 SAST" / "27 Oct 14:30 SAST". */
export function stampLabel(v: TimeInput, now: TimeInput): string {
  const days = daysAgo(v, now);
  if (days === null) return '';
  return days === 0 ? sastClock(v) : `${dayTime(v, now)} SAST`;
}

/** "1 failure" / "3 failures". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
