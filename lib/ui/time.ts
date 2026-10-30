// Display times. Stored times are UTC; everything shown is Africa/Johannesburg (SAST, UTC+2, no DST). Pure.
// Month names are fixed English abbreviations so output does not drift with the ICU version ('Sept' vs 'Sep').

export const SAST_ZONE = 'Africa/Johannesburg';

export type TimeInput = string | number | Date | null | undefined;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: SAST_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

interface Parts { year: number; month: number; day: number; hh: string; mm: string }

function toDate(v: TimeInput): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? new Date(v.getTime()) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parts(v: TimeInput): Parts | null {
  const d = toDate(v);
  if (!d) return null;
  const p: Record<string, string> = {};
  for (const { type, value } of FORMAT.formatToParts(d)) p[type] = value;
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hh: p.hour.padStart(2, '0'), mm: p.minute.padStart(2, '0') };
}

const dayNumber = (p: Parts) => Date.UTC(p.year, p.month - 1, p.day) / 86_400_000;
const dayMonth = (p: Parts) => `${p.day} ${MONTHS[p.month - 1]}`;

/** "09:14" in SAST. Empty for a missing or invalid time. */
export function clock(v: TimeInput): string {
  const p = parts(v);
  return p ? `${p.hh}:${p.mm}` : '';
}

/** "09:14 SAST". */
export function sastClock(v: TimeInput): string {
  const c = clock(v);
  return c ? `${c} SAST` : '';
}

/** Table cell: "29 Oct, 09:14". */
export function shortDateTime(v: TimeInput): string {
  const p = parts(v);
  return p ? `${dayMonth(p)}, ${p.hh}:${p.mm}` : '';
}

/** "29 Oct 2026". */
export function shortDate(v: TimeInput): string {
  const p = parts(v);
  return p ? `${dayMonth(p)} ${p.year}` : '';
}

/** "Thursday 29 October 2026" (page headers, signed-on lines). The weekday is the SAST calendar day's. */
export function longDate(v: TimeInput): string {
  const p = parts(v);
  if (!p) return '';
  const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `${weekday} ${p.day} ${MONTHS_LONG[p.month - 1]} ${p.year}`;
}

/** "29 Oct 2026, 14:31 SAST" (signature stamps, audit lines). */
export function longDateTime(v: TimeInput): string {
  const p = parts(v);
  return p ? `${dayMonth(p)} ${p.year}, ${p.hh}:${p.mm} SAST` : '';
}

/**
 * Relative day plus clock, by SAST calendar day: "Today 09:14", "Yesterday 15:40", "27 Oct 15:40",
 * and "27 Oct 2025 15:40" when the year differs from `now`. Future days use the date form.
 */
export function dayTime(v: TimeInput, now: TimeInput): string {
  const p = parts(v);
  if (!p) return '';
  const n = parts(now);
  const time = `${p.hh}:${p.mm}`;
  if (!n) return `${dayMonth(p)} ${time}`;
  const diff = dayNumber(n) - dayNumber(p);
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  return p.year === n.year ? `${dayMonth(p)} ${time}` : `${dayMonth(p)} ${p.year} ${time}`;
}
