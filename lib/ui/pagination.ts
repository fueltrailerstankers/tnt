// Pagination arithmetic for tables. Pages are 1-based. Pure.

/** At least one page, so "Page 1 of 1" shows for an empty table. */
export function pageCount(total: number, pageSize: number): number {
  if (!(pageSize > 0) || !(total > 0)) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

export function clampPage(page: number, count: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.floor(page)), Math.max(1, count));
}

/** Rows shown on a page, for "Showing 1–50 of 214". `from` and `to` are 0 when there are no rows. */
export function pageRange(page: number, pageSize: number, total: number): { from: number; to: number } {
  if (!(total > 0) || !(pageSize > 0)) return { from: 0, to: 0 };
  const p = clampPage(page, pageCount(total, pageSize));
  const from = (p - 1) * pageSize + 1;
  return { from, to: Math.min(total, p * pageSize) };
}
