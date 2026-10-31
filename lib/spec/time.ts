// Timezone helpers for the time and datetime field types (M8). Pure; no dependencies, so the browser
// renderer uses the same conversions as the server. Stored datetimes are UTC ISO instants; people enter and
// read them in the org timezone.

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

function parts(ms: number, timeZone: string): Record<string, number> {
  return new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
    .formatToParts(new Date(ms))
    .reduce<Record<string, number>>((a, x) => (x.type !== 'literal' ? { ...a, [x.type]: Number(x.value) } : a), {});
}

/** Offset (ms) of a timezone from UTC at an instant. */
function offsetAt(ms: number, timeZone: string): number {
  const p = parts(ms, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DDTHH:MM" (a datetime-local value) in `timeZone` -> UTC ISO. Null when not a real date/time. */
export function zonedToUtc(local: string, timeZone: string): string | null {
  const m = LOCAL_RE.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
  if (h > 23 || mi > 59) return null;
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const check = new Date(guess);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  let ms = guess - offsetAt(guess, timeZone);
  // Second pass for instants next to a daylight-saving change.
  ms = guess - offsetAt(ms, timeZone);
  return new Date(ms).toISOString();
}

/** UTC ISO -> "YYYY-MM-DDTHH:MM" in `timeZone` (for a datetime-local input). Empty when not a date. */
export function utcToZoned(iso: string, timeZone: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const p = parts(ms, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** UTC ISO -> "YYYY-MM-DD HH:MM" in `timeZone`, for display. The raw value when it is not a date. */
export function formatZoned(iso: string, timeZone: string): string {
  const local = utcToZoned(iso, timeZone);
  return local ? local.replace('T', ' ') : iso;
}

/** Current wall-clock time HH:MM in `timeZone`. */
export function timeIn(timeZone: string, now: Date = new Date()): string {
  const p = parts(now.getTime(), timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}
