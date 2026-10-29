// Quote fields on forms and the Xero quote picker helpers. Pure (no I/O), safe for client and server.
//
// The stored value is the quote number WITHOUT the "QU-" prefix ("QU-12345" -> "12345"), exactly as staff
// typed it in Cognito, because Make prepends "QU-" when it looks the quote up. xero_quotes.quote_no holds
// the same form (quoteNoOf in lib/integrations/xero/mappers.ts).
import { formatMoney, searchTerm } from '@/lib/admin/format';
import { quoteNoOf } from '@/lib/integrations/xero/mappers';
import type { FormSpec } from '@/lib/spec/types';

/** Form slug -> quote field name (the Cognito FieldName; never rename). */
export const QUOTE_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  deal: 'QUOTENO',
  'request-for-invoice': 'QuoteNo',
  'job-card': 'QuoteNo',
});

export const QUOTE_SEARCH_MIN = 2;
export const QUOTE_SEARCH_MAX = 15;

/** The quote field of this form, only when the spec really has it as a text field. */
export function quoteFieldOf(spec: Pick<FormSpec, 'slug' | 'fields'>): string | null {
  const name = Object.prototype.hasOwnProperty.call(QUOTE_FIELDS, spec.slug) ? QUOTE_FIELDS[spec.slug] : undefined;
  if (!name) return null;
  return spec.fields.some((f) => f.type === 'text' && 'name' in f && f.name === name) ? name : null;
}

export function isQuoteField(slug: string, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(QUOTE_FIELDS, slug) && QUOTE_FIELDS[slug] === name;
}

/** "qu-123 " -> "123". The bare form stored on entries and in xero_quotes.quote_no. */
export function bareQuoteNo(v: string | null | undefined): string | null {
  return quoteNoOf(typeof v === 'string' ? v : null);
}

export interface QuoteOption {
  /** Bare number: the value stored in the form field. */
  quoteNo: string;
  /** Xero quote number, e.g. "QU-12345". */
  quoteNumber: string;
  contact: string | null;
  status: string | null;
  total: number | null;
  currency: string | null;
}

export interface QuoteRow {
  quote_no: string | null;
  quote_number: string | null;
  contact_name: string | null;
  status: string | null;
  total: number | string | null;
  currency_code: string | null;
}

export const QUOTE_COLUMNS = 'quote_no, quote_number, contact_name, status, total, currency_code';

export function quoteOptionOf(r: QuoteRow): QuoteOption | null {
  const quoteNo = r.quote_no ?? bareQuoteNo(r.quote_number);
  if (!quoteNo) return null;
  const total = r.total === null || r.total === '' ? null : Number(r.total);
  return {
    quoteNo,
    quoteNumber: r.quote_number ?? `QU-${quoteNo}`,
    contact: r.contact_name,
    status: r.status,
    total: total !== null && Number.isFinite(total) ? total : null,
    currency: r.currency_code ? r.currency_code.trim() : null,
  };
}

/** Rows -> options, dropping rows without a number and repeated numbers (first one wins: newest first). */
export function quoteOptions(rows: QuoteRow[]): QuoteOption[] {
  const seen = new Set<string>();
  const out: QuoteOption[] = [];
  for (const r of rows) {
    const o = quoteOptionOf(r);
    if (!o || seen.has(o.quoteNo)) continue;
    seen.add(o.quoteNo);
    out.push(o);
    if (out.length >= QUOTE_SEARCH_MAX) break;
  }
  return out;
}

/** "QU-12345 · Customer · Status · 1 000,00 ZAR" (missing parts are left out). */
export function quoteOptionLabel(o: QuoteOption): string {
  const amount = o.total === null ? '' : `${formatMoney(o.total, null)}${o.currency ? ` ${o.currency}` : ''}`;
  return [o.quoteNumber, o.contact, o.status, amount].filter((x) => x && x.trim()).join(' · ');
}

/**
 * PostgREST or=() filter for a staff search: bare quote number or customer name. Null when the term is
 * shorter than QUOTE_SEARCH_MIN after sanitising (searchTerm strips separators, wildcards and quotes).
 */
export function quoteSearchFilter(q: unknown): string | null {
  const term = typeof q === 'string' ? searchTerm(q) : null;
  if (!term || term.length < QUOTE_SEARCH_MIN) return null;
  const no = bareQuoteNo(term);
  const parts = [`contact_name.ilike.*${term}*`];
  if (no) parts.unshift(`quote_no.ilike.*${no}*`);
  return parts.join(',');
}

/** Exact match of a typed value (with or without "QU-") against the options. */
export function hasExactQuote(value: string, options: QuoteOption[]): boolean {
  const no = bareQuoteNo(value);
  return !!no && options.some((o) => o.quoteNo === no);
}

/** Validates the public check input: a short bare quote number, or null. */
export function checkableQuoteNo(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const no = bareQuoteNo(v);
  return no && /^[A-Z0-9][A-Z0-9 ._/-]{0,29}$/.test(no) ? no : null;
}
