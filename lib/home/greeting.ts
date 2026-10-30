// Home header: greeting by SAST hour and the date lines. Pure.
import { longDate, SAST_ZONE, sastClock, type TimeInput } from '@/lib/ui/time';

const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: SAST_ZONE, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', hourCycle: 'h23',
});
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function sastParts(v: TimeInput): { year: number; month: number; day: number; hour: number } | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const p: Record<string, string> = {};
  for (const { type, value } of PARTS.formatToParts(d)) p[type] = value;
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour) % 24 };
}

/** First word of a profile name ("Zanele Dlamini" -> "Zanele"); null when there is none. */
export function firstName(fullName: string | null | undefined): string | null {
  const w = (fullName ?? '').trim().split(/\s+/)[0];
  return w ? w : null;
}

/** "Good morning" before 12:00 SAST, "Good afternoon" before 17:00, then "Good evening"; with ", Name" when known. */
export function greeting(now: TimeInput, fullName: string | null | undefined): string {
  const p = sastParts(now);
  const h = p?.hour ?? 12;
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const name = firstName(fullName);
  return name ? `${part}, ${name}` : part;
}

/** Desktop: "Thursday 29 October 2026 · 14:32 SAST". */
export function homeDateLine(now: TimeInput): string {
  const d = longDate(now);
  return d ? `${d} · ${sastClock(now)}` : '';
}

/** Phone: "Thu 29 Oct · 14:32 SAST". */
export function phoneDateLine(now: TimeInput): string {
  const p = sastParts(now);
  if (!p) return '';
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `${weekday} ${p.day} ${MONTHS[p.month - 1]} · ${sastClock(now)}`;
}
