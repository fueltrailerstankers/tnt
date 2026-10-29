// Global search routing. Quote no, invoice no or VIN go to the page that lists them. Pure.

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/i;

export function searchTarget(raw: string): string | null {
  const q = raw.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!q) return null;
  const enc = encodeURIComponent(q);
  if (/^INV[-\s]?\d/i.test(q)) return `/admin/xero/invoices?q=${enc}`;
  if (/^QU[-\s]?\d/i.test(q)) return `/admin/xero/quotes?q=${enc}`;
  if (VIN.test(q)) return `/admin/deal-files?q=${enc}`;
  // Deal files match quote no, VIN and customer, so they are the safe default.
  return `/admin/deal-files?q=${enc}`;
}
