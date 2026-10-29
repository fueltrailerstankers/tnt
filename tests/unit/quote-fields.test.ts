import { describe, expect, it } from 'vitest';
import {
  bareQuoteNo, checkableQuoteNo, hasExactQuote, isQuoteField, QUOTE_FIELDS, QUOTE_SEARCH_MAX, quoteFieldOf,
  quoteOptionLabel, quoteOptions, quoteSearchFilter, type QuoteRow,
} from '@/lib/forms/quote-fields';
import { SLUGS, spec } from './specs';

const row = (n: number, over: Partial<QuoteRow> = {}): QuoteRow => ({
  quote_no: String(n), quote_number: `QU-${n}`, contact_name: 'Synthetic Haulage', status: 'SENT', total: '1000.5', currency_code: 'ZAR', ...over,
});

describe('quote field map', () => {
  it('names the kit fields exactly (Cognito FieldNames)', () => {
    expect(QUOTE_FIELDS).toEqual({ deal: 'QUOTENO', 'request-for-invoice': 'QuoteNo', 'job-card': 'QuoteNo' });
  });

  it('every mapped field exists in its spec as a text field', () => {
    for (const [slug, name] of Object.entries(QUOTE_FIELDS)) {
      const f = spec(slug).fields.find((x) => 'name' in x && x.name === name);
      expect(f?.type, `${slug}.${name}`).toBe('text');
      expect(quoteFieldOf(spec(slug))).toBe(name);
    }
  });

  it('other forms have no quote field (Delivery Note QuoteNo is a lookup, not a quote field)', () => {
    for (const slug of SLUGS.filter((s) => !(s in QUOTE_FIELDS))) expect(quoteFieldOf(spec(slug)), slug).toBeNull();
    expect(isQuoteField('delivery-note', 'QuoteNo')).toBe(false);
    expect(isQuoteField('job-card', 'QuoteNo')).toBe(true);
    expect(isQuoteField('job-card', 'Line1')).toBe(false);
    expect(isQuoteField('constructor', 'QuoteNo')).toBe(false);
  });

  it('ignores a mapped slug whose spec lacks the field', () => {
    expect(quoteFieldOf({ slug: 'job-card', fields: [] })).toBeNull();
  });
});

describe('quote numbers', () => {
  it('stores the bare number, as staff type it', () => {
    expect(bareQuoteNo('QU-12345')).toBe('12345');
    expect(bareQuoteNo(' qu-77 ')).toBe('77');
    expect(bareQuoteNo('12345')).toBe('12345');
    expect(bareQuoteNo('')).toBeNull();
    expect(bareQuoteNo(null)).toBeNull();
  });

  it('public check accepts short plain numbers only', () => {
    expect(checkableQuoteNo('QU-123')).toBe('123');
    expect(checkableQuoteNo('123')).toBe('123');
    expect(checkableQuoteNo('')).toBeNull();
    expect(checkableQuoteNo('1'.repeat(41))).toBeNull();
    expect(checkableQuoteNo('12,quote_no.neq.x')).toBeNull();
    expect(checkableQuoteNo(42 as unknown as string)).toBeNull();
  });

  it('exact match ignores the QU- prefix and case', () => {
    const opts = quoteOptions([row(123), row(1234)]);
    expect(hasExactQuote('123', opts)).toBe(true);
    expect(hasExactQuote('qu-1234', opts)).toBe(true);
    expect(hasExactQuote('12', opts)).toBe(false);
    expect(hasExactQuote('', opts)).toBe(false);
  });
});

describe('search', () => {
  it('needs at least 2 characters after sanitising', () => {
    expect(quoteSearchFilter('1')).toBeNull();
    expect(quoteSearchFilter(' * ')).toBeNull();
    expect(quoteSearchFilter(undefined)).toBeNull();
    expect(quoteSearchFilter('12')).toBe('quote_no.ilike.*12*,contact_name.ilike.*12*');
  });

  it('searches the bare number and the customer name, without PostgREST separators', () => {
    expect(quoteSearchFilter('QU-45')).toBe('quote_no.ilike.*45*,contact_name.ilike.*QU-45*');
    const f = quoteSearchFilter('a,b)(*%"x')!;
    expect(f.split(',')).toHaveLength(2);
    expect(f).not.toMatch(/[()%"]/);
  });

  it('maps rows to options, dedupes by number and caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => row(100 + i));
    expect(quoteOptions(many)).toHaveLength(QUOTE_SEARCH_MAX);
    const o = quoteOptions([row(5), row(5, { contact_name: 'Other' }), row(0, { quote_no: null, quote_number: null })]);
    expect(o).toEqual([{ quoteNo: '5', quoteNumber: 'QU-5', contact: 'Synthetic Haulage', status: 'SENT', total: 1000.5, currency: 'ZAR' }]);
    expect(quoteOptions([row(9, { quote_no: null, quote_number: 'QU-9' })])[0].quoteNo).toBe('9');
  });

  it('labels as "QU-n · Customer · Status · Total (currency)"', () => {
    const [o] = quoteOptions([row(12345)]);
    const label = quoteOptionLabel(o);
    expect(label.startsWith('QU-12345 · Synthetic Haulage · SENT · ')).toBe(true);
    expect(label).toMatch(/1.000,50 ZAR$/);
    expect(quoteOptionLabel({ ...o, contact: null, total: null })).toBe('QU-12345 · SENT');
  });
});
