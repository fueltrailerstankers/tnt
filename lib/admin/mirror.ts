// Shared list paging for the Xero mirror pages. Pure.
export const MIRROR_PAGE = 50;

export function pageOf(p: string | string[] | undefined): number {
  const n = Number.parseInt(Array.isArray(p) ? p[0] : p ?? '', 10);
  return Number.isFinite(n) && n > 0 && n < 100_000 ? n : 1;
}

export function oneOf<T extends string>(v: string | string[] | undefined, allowed: readonly T[]): T | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && (allowed as readonly string[]).includes(s) ? (s as T) : null;
}
