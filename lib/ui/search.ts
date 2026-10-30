// Global search routing. Quote no, invoice no or VIN go to the page that lists them. Pure.
// The access is the areas the member can read: search never routes to a page the member would get a 403 on.

import { can, type Member } from '@/lib/security/can';

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/i;

/** What the searcher may open: deal files, the Xero quote and invoice lists, the stock register. */
export interface SearchAccess { deals: boolean; quotes: boolean; invoices: boolean; stock: boolean }
/** @deprecated Same as SearchAccess. */
export type SearchScope = SearchAccess;

/** Default for callers that do not pass access: the office routing (Xero pages and deal files). */
export const DEFAULT_SCOPE: SearchAccess = { deals: true, quotes: true, invoices: true, stock: false };

export function searchAccessOf(member: Member | null): SearchAccess {
  return { deals: can(member, 'deals.read'), quotes: can(member, 'quotes.read'), invoices: can(member, 'invoices.read'), stock: can(member, 'stock.read') };
}

export const canSearch = (scope: SearchAccess | null | undefined) => !!scope && Object.values(scope).some(Boolean);

export function searchTarget(raw: string, scope: SearchAccess = DEFAULT_SCOPE): string | null {
  const q = raw.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!q) return null;
  const enc = encodeURIComponent(q);
  if (/^INV[-\s]?\d/i.test(q) && scope.invoices) return `/admin/xero/invoices?q=${enc}`;
  if (/^QU[-\s]?\d/i.test(q) && scope.quotes) return `/admin/xero/quotes?q=${enc}`;
  // Deal files match quote no, VIN and customer, so they are the safe default; then the stock register (VIN,
  // sequence, model, invoice; stock-only members such as factory search there); then whichever mirror list is readable.
  if (scope.deals) return `/admin/deal-files?q=${enc}`;
  if (scope.stock) return `/admin/stock/units?q=${enc}`;
  if (VIN.test(q)) return null;
  if (scope.quotes) return `/admin/xero/quotes?q=${enc}`;
  if (scope.invoices) return `/admin/xero/invoices?q=${enc}`;
  return null;
}
