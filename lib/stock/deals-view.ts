// Deals awaiting dispatch (stock plan 5.3 / 7.2): filters, labels, copy. Pure.

import { z } from 'zod';
import type { DealStatus } from './deal-sync';

export const DEALS_PAGE_SIZE = 50;

export const DEALS_COPY = {
  eyebrow: 'DEALS AWAITING DISPATCH',
  refresh: 'Refresh dismissals',
  title: 'Outstanding deals',
  tableTitle: 'Awaiting factory dispatch',
  tableHint: 'Created deals stay here until linked to a completed dispatch.',
  dismissedTitle: 'Dismissed deals',
  dismissedHint: 'Only dismissed deals are shown. Restore a deal to put it back on the list.',
  kpiSub: (year: number) => `Awaiting dispatch · ${year}`,
  allBranches: 'All branches',
  showDismissed: 'Show dismissed',
  empty: 'No deals awaiting dispatch.',
  emptyDismissed: 'No dismissed deals.',
  dispatch: 'Dispatch →',
  dismiss: 'Dismiss',
  restore: 'Restore',
  reasonLabel: 'Reason',
  reasonHint: 'Required. Shown on the deal and kept in the dismissal history.',
  dismissTitle: (year: number, number: number) => `Dismiss deal ${year} / ${number}`,
  noBranch: 'No branch',
  importOff: 'Deal import is off: no start date is set.',
  importFrom: (date: string) => `DEAL entries from ${date}`,
} as const;

export const DEAL_STATUS_LABEL: Record<DealStatus, string> = {
  awaiting_dispatch: 'Awaiting dispatch',
  dispatched: 'Dispatched',
  dismissed: 'Dismissed',
};

/** StatusChip colour per deal status (dot + label, never colour alone). */
export const DEAL_STATUS_TONE: Record<DealStatus, 'yellow' | 'green' | 'gray'> = {
  awaiting_dispatch: 'yellow',
  dispatched: 'green',
  dismissed: 'gray',
};

/** "View access · Only an admin can dismiss or restore deals." (the stock plan names its superuser). */
export function permissionLine(canManage: boolean): string {
  return canManage ? 'Admin access · You can dismiss or restore deals.' : 'View access · Only an admin can dismiss or restore deals.';
}

/** "{n} outstanding deals · Dispatches without a deal number do not clear this list." */
export function outstandingFooter(n: number): string {
  return `${n} outstanding deal${n === 1 ? '' : 's'} · Dispatches without a deal number do not clear this list.`;
}

export interface DealsQuery {
  year: number;
  /** A branch location id, or null for all branches. */
  branch: string | null;
  /** Show dismissed: when ticked the table shows only dismissed deals. */
  dismissed: boolean;
  page: number;
}

type Param = string | string[] | undefined;
const one = (v: Param) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Reads ?year=&branch=&dismissed=1&page= ; unknown values fall back to the current year, all branches, page 1. */
export function parseDealsQuery(sp: Record<string, Param>, currentYear: number, branchIds: readonly string[]): DealsQuery {
  const y = Number(one(sp.year));
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : currentYear;
  const b = one(sp.branch).toUpperCase();
  const p = Number.parseInt(one(sp.page), 10);
  return {
    year,
    branch: branchIds.includes(b) ? b : null,
    dismissed: one(sp.dismissed) === '1',
    page: Number.isFinite(p) && p > 0 && p < 100_000 ? p : 1,
  };
}

/** Pages for a row count (at least 1). */
export function pageCount(total: number, size = DEALS_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / size));
}

/** The requested page, or the last page when it is past the end (PostgREST answers 416 for a range past the rows). */
export function clampPage(page: number, total: number, size = DEALS_PAGE_SIZE): number {
  return Math.min(Math.max(1, page), pageCount(total, size));
}

/** Query string for the deals page (defaults left out). */
export function dealsHref(q: DealsQuery, currentYear: number, over: Partial<DealsQuery> = {}): string {
  const v = { ...q, ...over };
  const u = new URLSearchParams();
  if (v.year !== currentYear) u.set('year', String(v.year));
  if (v.branch) u.set('branch', v.branch);
  if (v.dismissed) u.set('dismissed', '1');
  if (v.page > 1) u.set('page', String(v.page));
  const s = u.toString(); // URLSearchParams.size is missing before Safari 17
  return `/admin/stock/deals${s ? `?${s}` : ''}`;
}

/** Year select: every year from the earliest deal to the later of the newest deal and this year, newest first. */
export function yearOptions(minYear: number | null, maxYear: number | null, currentYear: number, selected: number): number[] {
  const lo = Math.min(minYear ?? currentYear, currentYear, selected);
  const hi = Math.max(maxYear ?? currentYear, currentYear, selected);
  const out: number[] = [];
  for (let y = hi; y >= lo && out.length < 50; y--) out.push(y);
  return out;
}

export const DismissInput = z.object({
  deal_id: z.guid(),
  reason: z.string().trim().min(1, 'Enter a reason.').max(200, 'The reason is too long (200 characters at most).'),
});

export const RestoreInput = z.object({ deal_id: z.guid() });
