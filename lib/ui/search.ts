// Global search routing. Quote no, invoice no or VIN go to the page that lists them. Pure.

import { can, type Member } from '@/lib/security/can';

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/i;

/** What the searcher may open: the Xero pages and deal files (xero.read), the stock register (stock.read). */
export interface SearchAccess { xero: boolean; stock: boolean }

/** Default for callers that do not pass access: the office routing (Xero pages and deal files). */
const OFFICE: SearchAccess = { xero: true, stock: false };

export function searchAccessOf(member: Member | null): SearchAccess {
  return { xero: can(member, 'xero.read'), stock: can(member, 'stock.read') };
}

export function searchTarget(raw: string, access: SearchAccess = OFFICE): string | null {
  const q = raw.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!q) return null;
  const enc = encodeURIComponent(q);
  // Stock-only members (factory) cannot open Xero pages or deal files; the unit register matches VIN, sequence,
  // model and invoice number, so every search goes there.
  if (!access.xero && access.stock) return `/admin/stock/units?q=${enc}`;
  if (/^INV[-\s]?\d/i.test(q)) return `/admin/xero/invoices?q=${enc}`;
  if (/^QU[-\s]?\d/i.test(q)) return `/admin/xero/quotes?q=${enc}`;
  if (VIN.test(q)) return `/admin/deal-files?q=${enc}`;
  // Deal files match quote no, VIN and customer, so they are the safe default.
  return `/admin/deal-files?q=${enc}`;
}
