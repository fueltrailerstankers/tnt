// Global search routing. Quote no, invoice no or VIN go to the page that lists them. Pure.
// The scope is the areas the member can read: search never routes to a page the member would get a 403 on.

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/i;

export interface SearchScope { deals: boolean; quotes: boolean; invoices: boolean; stock: boolean }

/** Everything the search knows about except stock (the scope before M7). */
export const DEFAULT_SCOPE: SearchScope = { deals: true, quotes: true, invoices: true, stock: false };

export const canSearch = (scope: SearchScope | null | undefined) => !!scope && Object.values(scope).some(Boolean);

export function searchTarget(raw: string, scope: SearchScope = DEFAULT_SCOPE): string | null {
  const q = raw.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!q) return null;
  const enc = encodeURIComponent(q);
  if (/^INV[-\s]?\d/i.test(q) && scope.invoices) return `/admin/xero/invoices?q=${enc}`;
  if (/^QU[-\s]?\d/i.test(q) && scope.quotes) return `/admin/xero/quotes?q=${enc}`;
  // Deal files match quote no, VIN and customer, so they are the safe default; then the stock register (VIN,
  // sequence, model, invoice); then whichever mirror list the member can read.
  if (scope.deals) return `/admin/deal-files?q=${enc}`;
  if (scope.stock) return `/admin/stock/units?q=${enc}`;
  if (VIN.test(q)) return null;
  if (scope.quotes) return `/admin/xero/quotes?q=${enc}`;
  if (scope.invoices) return `/admin/xero/invoices?q=${enc}`;
  return null;
}
