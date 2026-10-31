// Deal file list search and route params. Pure.
import { searchTerm } from '@/lib/admin/format';
import { normaliseQuoteNo } from '@/lib/integrations/xero/mappers';

/**
 * Search text for deal files. Deal files key on the bare quote no ("10482"), so "QU-10482" (what the global search
 * sends) is searched as "10482". Safe inside a PostgREST or=() filter (searchTerm strips separators).
 */
export function dealSearchTerm(q: string | string[] | undefined): string | null {
  const s = searchTerm(q);
  if (!s) return null;
  return /^QU[-\s]?\d/i.test(s) ? normaliseQuoteNo(s.replace(/\s+/g, '')) : s;
}

/** Route param: the bare quote no, also accepting the "QU-" form. Null when malformed. */
export function dealParam(raw: string): string | null {
  let s: string;
  try {
    s = decodeURIComponent(raw).trim();
  } catch {
    return null;
  }
  if (!/^[A-Za-z0-9-]{1,40}$/.test(s)) return null;
  return /^QU-?\d/i.test(s) ? normaliseQuoteNo(s) : s;
}

/** Display form of a quote no: "QU-10482" for numeric keys (as Xero shows them), else as stored. */
export function quoteLabel(quoteNo: string, quoteNumber?: string | null): string {
  if (quoteNumber) return quoteNumber;
  return /^\d+$/.test(quoteNo) ? `QU-${quoteNo}` : quoteNo;
}
