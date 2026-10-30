// M8 Part A: every field type and option, in the pure engine (lib/spec) and its consumers (grid/export,
// email rows, renderer markup, PDF). Synthetic data only.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { columnChoices, exportTable, gridCell } from '@/lib/admin/grid';
import { htmlBlocks } from '@/lib/spec/content';
import { parseShowWhen, type ShowContext } from '@/lib/spec/expressions';
import { pages } from '@/lib/spec/layout';
import { cellId, present } from '@/lib/spec/presentation';
import { formatZoned, timeIn, utcToZoned, zonedToUtc } from '@/lib/spec/time';
import { isReservedFormSlug, parseSpec, type FormSpec } from '@/lib/spec/types';
import {
  applyLocks, checkPost, defaultData, displayValue, formatValue, lockedFor, normaliseUrl, OTHER_VALUE, postedFileCounts,
  prepareSave, publicData, publicSpec, readFormData, renderSummary, validateEntry,
} from '@/lib/spec/values';
import { hiddenFields, hiddenNames, isHeading, showWhenProblems } from '@/lib/spec/visibility';
import { entryDetailRows, isExternalEmail } from '@/lib/workflow/email-template';
import { normalisePdf, pdfHash, renderHtml, sha } from './kit-snapshot';
import { fd, SLUGS, spec as kitSpec } from './specs';

const RAW = JSON.parse(readFileSync(path.resolve(__dirname, '../fixtures/m8/engine-types.json'), 'utf8'));
const S: FormSpec = parseSpec(RAW);
const TZ = 'Africa/Johannesburg';

/** Synthetic spec with the given fields (and the fixture's workflow). */
function mk(fields: unknown[], settings: Record<string, unknown> = {}): FormSpec {
  return parseSpec({ ...RAW, settings: { entrySummary: '', ...settings }, fields });
}
const read = (spec: FormSpec, values: Record<string, string | string[]>, opts = {}) => readFormData(spec, fd(values), opts);
const field = (name: string) => S.fields.find((f) => 'name' in f && f.name === name)!;

/** A valid post for the fixture (public role). */
function goodPost(over: Record<string, string | string[]> = {}): Record<string, string | string[]> {
  return {
    'f.Title': 'Synthetic job', 'f.Email': 'test@example.invalid', 'f.Phone': '082 000 0001', 'f.Price': '1500',
    'f.Urgent': 'no', 'f.Agree': 'yes', 'f.Score': '4', ...over,
  };
}

describe('spec: new types and options parse; kit specs unchanged', () => {
  it('the all-types fixture parses with every new type', () => {
    const types = new Set(S.fields.map((f) => f.type));
    for (const t of ['phone', 'url', 'currency', 'time', 'datetime', 'yesno', 'rating', 'section', 'choice', 'content', 'pagebreak']) expect(types.has(t as never)).toBe(true);
    expect(field('Price')).toMatchObject({ type: 'currency', currency: 'ZAR', min: 0, max: 100000, required: true });
  });

  it('all 7 kit specs still parse, with no M8 option set', () => {
    for (const s of SLUGS) {
      const sp = kitSpec(s);
      expect(showWhenProblems(sp)).toEqual([]);
      for (const f of sp.fields) for (const k of ['help', 'readOnly', 'internalOnly', 'showWhen', 'placeholder', 'other']) expect(f).not.toHaveProperty(k);
    }
  });

  it('rejects bad option values', () => {
    const base = { name: 'X', label: 'X', row: 1 };
    expect(() => mk([{ ...base, type: 'rating', default: 6 }])).toThrow();
    expect(() => mk([{ ...base, type: 'currency', currency: 'zar' }])).toThrow();
    expect(() => mk([{ ...base, type: 'time', default: '25:00' }])).toThrow();
    expect(() => mk([{ ...base, type: 'date', default: 'tomorrow' }])).toThrow();
    expect(() => mk([{ ...base, type: 'text', pattern: 'digits' }])).toThrow();
    expect(() => mk([{ ...base, type: 'textarea', rows: 0 }])).toThrow();
    expect(() => mk([{ ...base, type: 'yesno', style: 'dropdown' }])).toThrow();
  });

  it('rejects showWhen rules that do not parse, name unknown fields or form a cycle', () => {
    const t = (name: string, showWhen?: string, row = 1) => ({ name, label: name, type: 'text', row, ...(showWhen ? { showWhen } : {}) });
    expect(() => mk([t('A', 'A = ')])).toThrow(/Missing value/);
    expect(() => mk([t('A', 'Nope = "x"')])).toThrow(/unknown field: Nope/);
    expect(() => mk([t('A', 'B = "x"'), t('B', 'A = "y"', 2)])).toThrow(/cycle/);
    expect(() => mk([t('A', 'A is empty')])).toThrow(/cycle/);
    // A heading's rule may not read a field in its own group.
    expect(() => mk([{ name: 'H', label: 'H', type: 'section', row: 1, showWhen: 'B = "x"' }, t('B', undefined, 2)])).toThrow(/cycle/);
    expect(() => mk([t('A'), t('B', 'A = "x" OR (A = "y" AND A != "z")', 2)])).not.toThrow();
  });
});

describe('showWhen expressions', () => {
  const ctx = (data: Record<string, unknown>): ShowContext => ({
    value: (k) => data[k],
    isEmpty: (k) => data[k] === undefined || data[k] === '' || (Array.isArray(data[k]) && (data[k] as unknown[]).length === 0),
  });
  const ok = (expr: string, data: Record<string, unknown>) => parseShowWhen(expr).test(ctx(data));

  it('compares text, numbers and booleans', () => {
    expect(ok('MONTH = "JAN"', { MONTH: 'JAN' })).toBe(true);
    expect(ok("MONTH == 'JAN'", { MONTH: 'FEB' })).toBe(false);
    expect(ok('MONTH != "JAN"', { MONTH: 'FEB' })).toBe(true);
    expect(ok('MONTH <> "JAN"', {})).toBe(true);
    expect(ok('YesNo1 = true', { YesNo1: true })).toBe(true);
    expect(ok('YesNo1 = true', {})).toBe(false);
    expect(ok('YesNo1 = FALSE', { YesNo1: false })).toBe(true);
    expect(ok('Qty > 3', { Qty: 4 })).toBe(true);
    expect(ok('Qty >= 4', { Qty: 4 })).toBe(true);
    expect(ok('Qty < 4', { Qty: 4 })).toBe(false);
    expect(ok('Qty <= -1', { Qty: -2 })).toBe(true);
    expect(ok('Qty > 3', {})).toBe(false);
    expect(ok('Qty = 2', { Qty: 2 })).toBe(true);
    expect(ok('Due >= "2026-06-01"', { Due: '2026-07-01' })).toBe(true);
  });

  it('reads currency as its amount, phone as typed and multi choices as lists', () => {
    expect(ok('Price > 1000', { Price: { amount: 1500, currency: 'ZAR' } })).toBe(true);
    expect(ok('Phone = "082 000 0001"', { Phone: { phone: '082 000 0001', digits: '0820000001' } })).toBe(true);
    expect(ok('Extras = "Ramp"', { Extras: ['Lights', 'Ramp'] })).toBe(true);
    expect(ok('Extras != "Ramp"', { Extras: ['Lights'] })).toBe(true);
    expect(ok('Extras contains "Ramp"', { Extras: ['Ramp'] })).toBe(true);
    expect(ok('Notes contains "urgent"', { Notes: 'Very URGENT job' })).toBe(true);
  });

  it('supports is empty / is not empty, AND before OR, parentheses, any keyword case', () => {
    expect(ok('Notes is empty', {})).toBe(true);
    expect(ok('Notes IS NOT EMPTY', { Notes: 'x' })).toBe(true);
    expect(ok('A = 1 OR A = 2 AND B = 3', { A: 1 })).toBe(true); // A=1 OR (A=2 AND B=3)
    expect(ok('(A = 1 OR A = 2) AND B = 3', { A: 1 })).toBe(false);
    expect(ok('A = 1 and B = 2 or C = 3', { C: 3 })).toBe(true);
    expect(parseShowWhen('A = 1 AND (B is empty OR C contains "x")').fields).toEqual(['A', 'B', 'C']);
  });

  it('throws on unknown syntax', () => {
    for (const bad of ['', 'A', 'A =', 'A = "x', 'A ~ 1', 'A = 1 AND', '(A = 1', 'A = 1)', 'A is', 'A is full', 'A = 1 B = 2', 'A = x']) {
      expect(() => parseShowWhen(bad), bad).toThrow();
    }
  });
});

describe('visibility', () => {
  it('hides a field whose rule is false and the whole group of a hidden heading', () => {
    const hidden = hiddenNames(S, { Urgent: false, Colour: 'Blue' });
    expect(hidden).toEqual(new Set(['UrgentReason', 'RedHeading', 'RedNote']));
    expect(hiddenNames(S, { Urgent: true, Colour: 'Red' })).toEqual(new Set());
    // The heading group ends at the page break: page 2 fields stay visible.
    expect(hidden.has('InternalNote')).toBe(false);
  });

  it('a hidden field reads as empty for the rules that depend on it', () => {
    const sp = mk([
      { name: 'A', label: 'A', type: 'yesno', row: 1 },
      { name: 'B', label: 'B', type: 'text', row: 2, showWhen: 'A = true' },
      { name: 'C', label: 'C', type: 'text', row: 3, showWhen: 'B is not empty' },
    ]);
    expect(hiddenNames(sp, { A: false, B: 'typed', C: 'x' })).toEqual(new Set(['B', 'C']));
    expect(hiddenNames(sp, { A: true, B: 'typed' })).toEqual(new Set());
  });

  it('is the same before and after hidden values are dropped (save is idempotent)', () => {
    const data = readFormData(S, fd(goodPost({ 'f.UrgentReason': 'x', 'f.Colour': 'Blue', 'f.RedNote': 'y' }))).data;
    const prep = prepareSave(S, { data, errors: {} }, { audience: 'staff', previous: {} });
    expect(prep.data).not.toHaveProperty('UrgentReason');
    expect(prep.data).not.toHaveProperty('RedNote');
    expect(hiddenNames(S, prep.data)).toEqual(hiddenNames(S, data));
  });

  it('covers content blocks and fields under a hidden heading', () => {
    const sp = mk([
      { name: 'X', label: 'X', type: 'yesno', row: 1 },
      { name: 'H', label: 'H', type: 'section', row: 2, showWhen: 'X = true' },
      { type: 'content', html: '<p>Hi</p>', row: 3 },
      { name: 'Y', label: 'Y', type: 'text', row: 4 },
    ]);
    const hidden = hiddenFields(sp, { X: false, Y: 'y' });
    expect([...hidden].map((f) => ('name' in f ? f.name : f.type))).toEqual(['H', 'content', 'Y']);
    expect(hiddenFields(sp, { X: true }).size).toBe(0);
  });

  it('isHeading tells the M8 heading from the kit checklist section', () => {
    expect(isHeading(field('AboutHeading'))).toBe(true);
    const cl = kitSpec('trailer-inspection-checklist').fields.find((f) => f.type === 'section')!;
    expect(isHeading(cl)).toBe(false);
  });
});

describe('readFormData: every new type', () => {
  it('text patterns: uppercase stores upper case, alphanumeric rejects symbols', () => {
    const r = read(S, { 'f.Code': 'ab-12', 'f.Ref': 'AB 12' });
    expect(r.data).toMatchObject({ Code: 'AB-12', Ref: 'AB 12' });
    expect(read(S, { 'f.Ref': 'AB-12' }).errors.Ref).toBe('Use letters and numbers only.');
  });

  it('phone: stored as typed plus digits; 9-15 digits', () => {
    expect(read(S, { 'f.Phone': '+27 (82) 000-0001' }).data.Phone).toEqual({ phone: '+27 (82) 000-0001', digits: '27820000001' });
    expect(read(S, { 'f.Phone': '0820001' }).errors.Phone).toMatch(/valid phone/);
    expect(read(S, { 'f.Phone': '082 000 0001 ext 2' }).errors.Phone).toMatch(/valid phone/);
    expect(read(S, { 'f.Phone': '1234567890123456' }).errors.Phone).toMatch(/valid phone/);
  });

  it('url: https only; a bare host gets https://', () => {
    expect(read(S, { 'f.Website': 'example.invalid/page' }).data.Website).toBe('https://example.invalid/page');
    expect(read(S, { 'f.Website': 'https://example.invalid' }).data.Website).toBe('https://example.invalid/');
    for (const bad of ['http://example.invalid', 'javascript:alert(1)', 'https://localhost', 'https://user:pw@example.invalid', 'ftp://example.invalid', 'https://exa mple.invalid']) {
      expect(read(S, { 'f.Website': bad }).errors.Website, bad).toBe('Enter a valid https:// link.');
    }
    expect(normaliseUrl('x'.repeat(2001) + '.invalid')).toBeNull();
  });

  it('currency: { amount, currency }; the field code, else the org code, else USD', () => {
    expect(read(S, { 'f.Price': '1 234.5' }).data.Price).toEqual({ amount: 1234.5, currency: 'ZAR' });
    expect(read(S, { 'f.Price': '1,500' }).data.Price).toEqual({ amount: 1500, currency: 'ZAR' });
    for (const bad of ['12.345', 'abc', '1e5', 'R100']) expect(read(S, { 'f.Price': bad }).errors.Price, bad).toMatch(/Enter an amount/);
    const sp = mk([{ name: 'M', label: 'M', type: 'currency', row: 1 }]);
    expect(read(sp, { 'f.M': '10' }, { currency: 'ZAR' }).data.M).toEqual({ amount: 10, currency: 'ZAR' });
    expect(read(sp, { 'f.M': '-10' }).data.M).toEqual({ amount: -10, currency: 'USD' });
  });

  it('time: HH:MM (seconds dropped); datetime: entered in the org timezone, stored UTC', () => {
    expect(read(S, { 'f.StartTime': '07:30:15' }).data.StartTime).toBe('07:30');
    expect(read(S, { 'f.StartTime': '24:00' }).errors.StartTime).toMatch(/valid time/);
    expect(read(S, { 'f.Appointment': '2026-10-29T14:30' }, { timeZone: TZ }).data.Appointment).toBe('2026-10-29T12:30:00.000Z');
    expect(read(S, { 'f.Appointment': '2026-10-29T14:30' }).data.Appointment).toBe('2026-10-29T14:30:00.000Z');
    expect(read(S, { 'f.Appointment': '2026-02-30T10:00' }).errors.Appointment).toMatch(/valid date and time/);
    expect(read(S, { 'f.Appointment': 'soon' }).errors.Appointment).toMatch(/valid date and time/);
  });

  it('yesno: radio yes/no/blank; toggle on = true, off = false', () => {
    expect(read(S, { 'f.Urgent': 'yes' }).data.Urgent).toBe(true);
    expect(read(S, { 'f.Urgent': 'no' }).data.Urgent).toBe(false);
    expect(read(S, {}).data).not.toHaveProperty('Urgent');
    expect(read(S, { 'f.Urgent': 'maybe' }).errors.Urgent).toBe('Choose Yes or No.');
    expect(read(S, { 'f.Agree': 'yes' }).data.Agree).toBe(true);
    expect(read(S, {}).data.Agree).toBe(false);
  });

  it('rating: 1-5', () => {
    expect(read(S, { 'f.Score': '5' }).data.Score).toBe(5);
    for (const bad of ['0', '6', '4.5', 'x']) expect(read(S, { 'f.Score': bad }).errors.Score, bad).toBe('Choose a rating from 1 to 5.');
  });

  it('choice Other: the typed text is stored; listed options still checked', () => {
    expect(read(S, { 'f.Colour': OTHER_VALUE, 'f.Colour.other': 'Orange' }).data.Colour).toBe('Orange');
    expect(read(S, { 'f.Colour': 'Red', 'f.Colour.other': 'ignored' }).data.Colour).toBe('Red');
    expect(read(S, { 'f.Colour': OTHER_VALUE }).errors.Colour).toBe('Enter a value for Other.');
    expect(read(S, { 'f.Colour': 'Purple' }).errors.Colour).toBe('Choose one of the listed options.');
    expect(read(S, { 'f.Extras': ['Ramp', OTHER_VALUE], 'f.Extras.other': 'Toolbox' }).data.Extras).toEqual(['Ramp', 'Toolbox']);
    expect(read(S, { 'f.Extras': ['Nope', OTHER_VALUE], 'f.Extras.other': 'Toolbox' }).errors.Extras).toBe('Choose one of the listed options.');
    // Without "other" the sentinel is just an unknown option.
    expect(read(S, { 'f.Size': OTHER_VALUE }).errors.Size).toBe('Choose one of the listed options.');
  });

  it('headings hold no value', () => {
    expect(read(S, { 'f.AboutHeading': 'x' }).data).not.toHaveProperty('AboutHeading');
  });
});

describe('validateEntry: required on every input type, lengths and ranges', () => {
  const types: Array<[Record<string, unknown>, Record<string, string | string[]>, Record<string, number>?]> = [
    [{ type: 'text' }, { 'f.X': 'a' }],
    [{ type: 'textarea' }, { 'f.X': 'a' }],
    [{ type: 'email' }, { 'f.X': 'a@example.invalid' }],
    [{ type: 'phone' }, { 'f.X': '0820000001' }],
    [{ type: 'url' }, { 'f.X': 'example.invalid' }],
    [{ type: 'number' }, { 'f.X': '0' }],
    [{ type: 'currency' }, { 'f.X': '0' }],
    [{ type: 'date' }, { 'f.X': '2026-10-29' }],
    [{ type: 'time' }, { 'f.X': '00:00' }],
    [{ type: 'datetime' }, { 'f.X': '2026-10-29T00:00' }],
    [{ type: 'yesno' }, { 'f.X': 'no' }],
    [{ type: 'yesno', style: 'toggle' }, { 'f.X': 'yes' }],
    [{ type: 'rating' }, { 'f.X': '1' }],
    [{ type: 'choice', style: 'dropdown', options: ['A'] }, { 'f.X': 'A' }],
    [{ type: 'choice', style: 'radio', options: ['A'], other: true }, { 'f.X': OTHER_VALUE, 'f.X.other': 'B' }],
    [{ type: 'choice', style: 'checkboxes', multi: true, options: ['A'] }, { 'f.X': ['A'] }],
    [{ type: 'name', parts: ['First', 'Last'] }, { 'f.X.First': 'a', 'f.X.Last': 'b' }],
    [{ type: 'address', parts: ['Line1', 'City'] }, { 'f.X.City': 'c' }],
    [{ type: 'lookup', style: 'dropdown', lookup: { sourceForm: 'request-for-invoice', displayField: 'QuoteNo' } }, { 'f.X': '11111111-1111-4111-8111-111111111111' }],
    [{ type: 'file' }, {}, { X: 1 }],
    [{ type: 'signature' }, {}, { X: 1 }],
  ];
  it.each(types.map(([f, good, counts]) => [f.type + (f.style ? `/${f.style}` : ''), f, good, counts ?? {}] as const))('%s', (_, f, good, counts) => {
    const sp = mk([{ name: 'X', label: 'X', row: 1, required: true, ...f }]);
    expect(validateEntry(sp, read(sp, {}).data, {})).toEqual({ X: 'This field is required.' });
    const r = read(sp, good);
    expect(r.errors).toEqual({});
    expect(validateEntry(sp, r.data, counts)).toEqual({});
  });

  it('a required toggle must be on; a toggle that is off is still a value when not required', () => {
    const sp = mk([{ name: 'X', label: 'X', row: 1, type: 'yesno', style: 'toggle', required: true }]);
    expect(validateEntry(sp, { X: false }, {})).toEqual({ X: 'This field is required.' });
  });

  it('a name needs every part; an address any part', () => {
    const sp = mk([{ name: 'X', label: 'X', row: 1, type: 'name', parts: ['First', 'Last'], required: true }]);
    expect(validateEntry(sp, { X: { First: 'a' } }, {})).toEqual({ X: 'This field is required.' });
  });

  it('min/max length and value', () => {
    const msgs = (v: Record<string, string>) => validateEntry(S, read(S, v).data, {}, { skip: ['Title', 'Email', 'Phone', 'Price', 'Urgent', 'Agree', 'Score', 'RedNote'] });
    expect(validateEntry(S, read(S, { 'f.Title': 'a' }).data, {}).Title).toBe('Enter at least 2 characters.');
    expect(validateEntry(S, read(S, { 'f.Title': 'a'.repeat(41) }).data, {}).Title).toBe('Enter at most 40 characters.');
    expect(msgs({ 'f.Notes': 'n'.repeat(201) }).Notes).toBe('Enter at most 200 characters.');
    expect(msgs({ 'f.Qty': '0' }).Qty).toBe('Enter 1 or more.');
    expect(msgs({ 'f.Qty': '11' }).Qty).toBe('Enter 10 or less.');
    expect(msgs({ 'f.Qty': '10' }).Qty).toBeUndefined();
    expect(validateEntry(S, read(S, { 'f.Price': '-1' }).data, {}).Price).toBe('Enter 0 or more.');
    expect(validateEntry(S, read(S, { 'f.Price': '100000.01' }).data, {}).Price).toBe('Enter 100000 or less.');
    expect(msgs({ 'f.Due': '2025-12-31' }).Due).toBe('Enter a date on or after 2026-01-01.');
    const sp = mk([{ name: 'T', label: 'T', type: 'time', row: 1, min: '08:00', max: '17:00' }]);
    expect(validateEntry(sp, { T: '07:59' }, {}).T).toBe('Enter a time on or after 08:00.');
    expect(validateEntry(sp, { T: '17:01' }, {}).T).toBe('Enter a time on or before 17:00.');
  });

  it('skip: hidden and locked fields are not validated', () => {
    expect(validateEntry(S, {}, {}, { skip: ['Title'] })).not.toHaveProperty('Title');
    expect(validateEntry(S, {}, {})).toHaveProperty('Title');
  });
});

describe('prepareSave: readOnly, internalOnly and showWhen on the server', () => {
  it('public role: readOnly and internalOnly fields keep the previous value whatever is posted', () => {
    expect(lockedFor(S, 'public')).toEqual(new Set(['InternalNote', 'FixedRef']));
    expect(lockedFor(S, 'staff')).toEqual(new Set());
    const r = read(S, goodPost({ 'f.InternalNote': 'hacked', 'f.FixedRef': 'hacked' }));
    const prev = { InternalNote: 'kept', FixedRef: 'REF-001' };
    expect(prepareSave(S, r, { audience: 'public', previous: prev }).data).toMatchObject(prev);
    expect(prepareSave(S, r, { audience: 'public', previous: {} }).data).not.toHaveProperty('InternalNote');
    expect(prepareSave(S, r, { audience: 'staff', previous: prev }).data).toMatchObject({ InternalNote: 'hacked', FixedRef: 'hacked' });
    expect(applyLocks(S, { FixedRef: 'x' }, { audience: 'public', previous: { FixedRef: 'REF-001' } })).toEqual({ FixedRef: 'REF-001' });
  });

  it('hidden fields are dropped, skipped and their read errors ignored', () => {
    const r = read(S, goodPost({ 'f.Urgent': 'no', 'f.UrgentReason': 'x', 'f.Colour': 'Blue', 'f.RedNote': 'y', 'f.InternalNote': 'z' }));
    const p = prepareSave(S, r, { audience: 'public', previous: {} });
    expect(p.data).not.toHaveProperty('UrgentReason');
    expect(p.data).not.toHaveProperty('RedNote');
    expect(p.skip).toEqual(new Set(['InternalNote', 'FixedRef', 'UrgentReason', 'RedHeading', 'RedNote']));
    const bad = { data: { Urgent: false }, errors: { UrgentReason: 'x', Title: 'y' } };
    expect(prepareSave(S, bad, { audience: 'staff', previous: {} }).errors).toEqual({ Title: 'y' });
  });

  it('checkPost (the browser check) enforces required only where shown', () => {
    expect(checkPost(S, fd(goodPost()), { audience: 'public', previous: defaultData(S) })).toEqual({});
    expect(checkPost(S, fd(goodPost({ 'f.Urgent': 'yes' })), { audience: 'public', previous: {} })).toEqual({ UrgentReason: 'This field is required.' });
    expect(checkPost(S, fd(goodPost({ 'f.Colour': 'Red' })), { audience: 'public', previous: {} })).toEqual({ RedNote: 'This field is required.' });
    expect(checkPost(S, fd({}), { audience: 'public', previous: {} })).toEqual({
      Title: 'This field is required.', Email: 'This field is required.', Phone: 'This field is required.', Price: 'This field is required.',
      Urgent: 'This field is required.', Agree: 'This field is required.', Score: 'This field is required.',
    });
    expect(checkPost(S, fd(goodPost({ 'f.Phone': '12' })), { audience: 'public', previous: {} })).toEqual({ Phone: 'Enter a valid phone number (at least 9 digits).' });
  });

  it('postedFileCounts counts staged/kept files and signatures', () => {
    expect(postedFileCounts({ files: { F: [{ kind: 'existing', id: 'a' }, { kind: 'existing', id: 'b' }] }, signatures: { S1: null, S2: { kind: 'keep', id: 'c' } } }))
      .toEqual({ F: 2, S1: 0, S2: 1 });
  });

  it('publicSpec/publicData drop internalOnly fields and values; kit specs come back as is', () => {
    expect(publicSpec(S).fields.some((f) => 'name' in f && f.name === 'InternalNote')).toBe(false);
    expect(publicData(S, { InternalNote: 'x', Title: 't' })).toEqual({ Title: 't' });
    for (const s of SLUGS) {
      const k = kitSpec(s);
      expect(publicSpec(k)).toBe(k);
    }
  });
});

describe('defaults, display and summary', () => {
  it('every type default; now/today in the org timezone; currency from the org', () => {
    const now = new Date('2026-10-29T22:15:42Z');
    const sp = mk([
      { name: 'T', label: 'T', type: 'text', row: 1, default: 'abc', pattern: 'uppercase' },
      { name: 'TA', label: 'TA', type: 'textarea', row: 2, default: 'long' },
      { name: 'P', label: 'P', type: 'phone', row: 3, default: '082 000 0001' },
      { name: 'U', label: 'U', type: 'url', row: 4, default: 'example.invalid' },
      { name: 'N', label: 'N', type: 'number', row: 5, default: 0 },
      { name: 'C', label: 'C', type: 'currency', row: 6, default: 99.5 },
      { name: 'D', label: 'D', type: 'date', row: 7, default: 'today' },
      { name: 'D2', label: 'D2', type: 'date', row: 8, default: '2026-01-31' },
      { name: 'TI', label: 'TI', type: 'time', row: 9, default: 'now' },
      { name: 'TI2', label: 'TI2', type: 'time', row: 10, default: '08:00' },
      { name: 'DT', label: 'DT', type: 'datetime', row: 11, default: 'now' },
      { name: 'Y', label: 'Y', type: 'yesno', row: 12, default: false },
      { name: 'R', label: 'R', type: 'rating', row: 13, default: 3 },
      { name: 'CH', label: 'CH', type: 'choice', style: 'radio', options: ['A', 'B'], row: 14, default: 'B' },
    ]);
    expect(defaultData(sp, { today: '2026-10-30', now, timeZone: TZ, currency: 'ZAR' })).toEqual({
      T: 'ABC', TA: 'long', P: { phone: '082 000 0001', digits: '0820000001' }, U: 'https://example.invalid/', N: 0,
      C: { amount: 99.5, currency: 'ZAR' }, D: '2026-10-30', D2: '2026-01-31', TI: '00:15', TI2: '08:00', DT: '2026-10-29T22:15:00.000Z',
      Y: false, R: 3, CH: 'B',
    });
    // Without now/today the dynamic defaults are left empty (as the kit's date 'today').
    expect(defaultData(sp)).not.toHaveProperty('TI');
    expect(defaultData(sp)).not.toHaveProperty('DT');
    expect(defaultData(sp).C).toEqual({ amount: 99.5, currency: 'USD' });
  });

  it('display: currency, phone, datetime in the org timezone, rating, yes/no', () => {
    // Money uses the app's display rule (lib/money/fx formatAmount): ZAR as R, USD as $, other codes in front.
    expect(displayValue({ amount: 1500, currency: 'ZAR' })).toBe('R 1,500.00');
    expect(displayValue({ amount: 1234.5, currency: 'USD' })).toBe('$1,234.50');
    expect(displayValue({ amount: -3, currency: 'EUR' })).toBe('-EUR 3.00');
    expect(displayValue({ phone: '082 000 0001', digits: '0820000001' })).toBe('082 000 0001');
    expect(displayValue(true)).toBe('Yes');
    expect(formatValue(field('Appointment'), '2026-10-29T12:30:00.000Z', { timeZone: TZ })).toBe('2026-10-29 14:30');
    expect(formatValue(field('Appointment'), '2026-10-29T12:30:00.000Z')).toBe('2026-10-29 12:30');
    expect(formatValue(field('Score'), 4)).toBe('4/5');
    expect(formatValue(field('Urgent'), false)).toBe('No');
    expect(formatValue(field('Title'), undefined)).toBe('');
    expect(formatValue(undefined, 'x')).toBe('x');
  });

  it('summary renders typed values when given the spec', () => {
    const data = { Title: 'Job', Phone: { phone: '082 000 0001', digits: '0820000001' } };
    expect(renderSummary(S.settings.entrySummary, data, { spec: S })).toBe('Job 082 000 0001');
    expect(renderSummary(S.settings.entrySummary, data)).toBe('Job 082 000 0001');
    const sp = mk([{ name: 'DT', label: 'DT', type: 'datetime', row: 1 }], { entrySummary: '[DT]' });
    expect(renderSummary('[DT]', { DT: '2026-10-29T12:30:00.000Z' }, { spec: sp, timeZone: TZ })).toBe('2026-10-29 14:30');
  });
});

describe('time helpers', () => {
  it('round-trips through a timezone, including a daylight-saving zone', () => {
    expect(zonedToUtc('2026-10-29T14:30', TZ)).toBe('2026-10-29T12:30:00.000Z');
    expect(utcToZoned('2026-10-29T12:30:00.000Z', TZ)).toBe('2026-10-29T14:30');
    expect(zonedToUtc('2026-07-01T09:00', 'Europe/London')).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToUtc('2026-01-01T09:00', 'Europe/London')).toBe('2026-01-01T09:00:00.000Z');
    expect(zonedToUtc('2026-13-01T09:00', TZ)).toBeNull();
    expect(zonedToUtc('2026-01-01T24:00', TZ)).toBeNull();
    expect(utcToZoned('nope', TZ)).toBe('');
    expect(formatZoned('nope', TZ)).toBe('nope');
    expect(timeIn(TZ, new Date('2026-10-29T23:05:00Z'))).toBe('01:05');
  });
});

describe('rich content: sanitised HTML allow-list', () => {
  it('keeps bold, italic, https links, lists and headings; drops scripts, other tags and unsafe links', () => {
    const blocks = htmlBlocks('<h3>Terms</h3><p><strong>Bold</strong> and <em>it</em> <a href="https://example.invalid/t" onclick="x()">link</a> <a href="javascript:alert(1)">bad</a></p><ul><li>One</li><li><b>Two</b></li></ul><ol><li>First</li></ol><script>alert(1)</script><style>p{}</style><img src=x onerror=alert(1)><p>a &amp; b &#169; &#x41;</p>');
    expect(blocks).toEqual([
      { kind: 'heading', spans: [{ text: 'Terms', bold: false }] },
      { kind: 'paragraph', spans: [
        { text: 'Bold', bold: true }, { text: ' and ', bold: false }, { text: 'it', bold: false, italic: true }, { text: ' ', bold: false },
        { text: 'link', bold: false, href: 'https://example.invalid/t' }, { text: ' ', bold: false }, { text: 'bad', bold: false },
      ] },
      { kind: 'list', ordered: false, items: [[{ text: 'One', bold: false }], [{ text: 'Two', bold: true }]] },
      { kind: 'list', ordered: true, items: [[{ text: 'First', bold: false }]] },
      { kind: 'paragraph', spans: [{ text: 'a & b © A', bold: false }] },
    ]);
    expect(JSON.stringify(blocks)).not.toMatch(/alert|script|onerror|javascript/);
  });

  it('the kit snippet is unchanged', () => {
    expect(htmlBlocks('<p>the above documetns have been ready by myself&nbsp;</p>')).toEqual([
      { kind: 'paragraph', spans: [{ text: 'the above documetns have been ready by myself', bold: false }] },
    ]);
  });
});

describe('grid, export and email rows', () => {
  const data = readFormData(S, fd(goodPost({
    'f.Appointment': '2026-10-29T14:30', 'f.Score': '5', 'f.Colour': OTHER_VALUE, 'f.Colour.other': 'Orange', 'f.Website': 'example.invalid',
    'f.InternalNote': 'staff only', 'f.UrgentReason': 'dropped',
  })), { timeZone: TZ }).data;
  const saved = prepareSave(S, { data, errors: {} }, { audience: 'staff', previous: {} }).data;

  it('columns: every value type, not headings', () => {
    const names = columnChoices(S).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['Phone', 'Website', 'Price', 'StartTime', 'Appointment', 'Urgent', 'Agree', 'Score', 'Colour']));
    expect(names).not.toContain('AboutHeading');
    expect(names).not.toContain('RedHeading');
    expect(gridCell(S, 'Appointment', saved.Appointment, TZ)).toBe('2026-10-29 14:30');
    expect(gridCell(S, 'Price', saved.Price, TZ)).toBe('R 1,500.00');
  });

  it('export: currency as amount + code columns, datetime in the org timezone, rating as a number', () => {
    const t = exportTable(S, [{ number: 3, status: 'Submitted', createdAt: '2026-10-29T08:00:00Z', updatedAt: '2026-10-29T08:00:00Z', data: saved }], TZ, false);
    const row = Object.fromEntries(t[0].map((h, i) => [h, t[1][i]]));
    expect(row).toMatchObject({
      Price: '1500.00', 'Price currency': 'ZAR', Appointment: '2026-10-29 14:30', Score: '5', 'Urgent?': 'No', 'I agree to the terms': 'Yes',
      Phone: '082 000 0001', Website: 'https://example.invalid/', Colour: 'Orange', 'Why is it urgent?': '', 'Internal note': 'staff only',
    });
  });

  it('email details: no headings, no hidden fields; internalOnly left out of emails to entry addresses', () => {
    const rows = entryDetailRows(S, saved, {}, { timeZone: TZ });
    const labels = rows.map(([k]) => k);
    expect(labels).not.toContain('About the job');
    expect(labels).not.toContain('Why is it urgent?');
    expect(labels).toContain('Internal note');
    expect(Object.fromEntries(rows)).toMatchObject({ Appointment: '2026-10-29 14:30', Price: 'R 1,500.00', Score: '5/5' });
    expect(entryDetailRows(S, saved, {}, { external: true }).map(([k]) => k)).not.toContain('Internal note');
    expect(isExternalEmail({ to: ['[Email]'] })).toBe(true);
    expect(isExternalEmail({ to: ['office@example.invalid'] })).toBe(false);
  });
});

describe('renderer markup (server render)', () => {
  const props = (over: Record<string, unknown> = {}) => ({
    spec: S, initial: defaultData(S, { today: '2026-10-29' }), files: {}, signatures: {}, actions: [{ name: 'Submit', label: 'Submit' }],
    submit: async () => ({}), upload: async () => ({}), supabase: { url: 'http://127.0.0.1:1', anonKey: 'stub' }, ...over,
  });

  it('public: internalOnly absent, readOnly not editable, required marked, help described', () => {
    const html = renderHtml(props({ audience: 'public', timeZone: TZ }));
    expect(html).not.toContain('Internal note');
    expect(html).toMatch(/<input id="f-FixedRef" type="text"[^>]*readOnly=""[^>]*value="REF-001"/);
    expect(html).toContain('Title<span class="ml-0.5 text-danger" aria-hidden="true">*</span></label>');
    expect(html).toMatch(/id="f-Title"[^>]*placeholder="Short title"[^>]*aria-describedby="f-Title-help" aria-required="true"/);
    expect(html).toContain('<fieldset role="radiogroup" aria-required="true"><legend class="mb-1.5 block text-small font-semibold text-fg">Urgent?');
    expect(html).toContain('<p id="f-Title-help" class="mt-1.5 text-small text-fg-muted">Two to forty characters.</p>');
    for (const t of ['type="tel"', 'type="url"', 'type="time"', 'type="datetime-local"', 'role="switch"', 'inputMode="decimal"']) expect(html).toContain(t);
    expect(html).toContain(`value="${OTHER_VALUE}"`);
    expect(html).toContain('<span class="sr-only">5 stars</span>');
    // A heading becomes a section card titled by it (lib/spec/presentation).
    expect(html).toContain('<h2 id="sec-0-h1" class="text-h2 text-fg">About the job</h2>');
    expect(html).toContain('Synthetic test form: every M8 field type.');
    expect(html).toContain('<a href="https://example.invalid/terms" target="_blank" rel="noopener noreferrer" class="font-medium text-accent-text underline underline-offset-2">');
    expect(html).not.toContain('alert(1)');
  });

  it('show-when: hidden cells carry the hidden attribute from the initial values', () => {
    const html = renderHtml(props());
    expect(html).toMatch(/hidden=""><div><label for="f-UrgentReason"/);
    // The heading's rule hides its whole card.
    expect(html).toMatch(/<section aria-labelledby="sec-0-h2" class="[^"]*" hidden="">/);
    expect(renderHtml(props({ initial: { Urgent: true, Colour: 'Red' } }))).not.toMatch(/hidden=""><div><label for="f-UrgentReason"/);
  });

  it('staff: internalOnly shown; datetime shown in the org timezone; currency code prefix', () => {
    const html = renderHtml(props({ initial: { Appointment: '2026-10-29T12:30:00.000Z', Price: { amount: 15, currency: 'ZAR' } }, timeZone: TZ }));
    expect(html).toContain('Internal note');
    expect(html).toContain('value="2026-10-29T14:30"');
    expect(html).toMatch(/<span id="f-Price-cur"[^>]*>ZAR<\/span>/);
    expect(html).toContain('value="15.00"');
  });

  it('kit forms render the same for the public audience (no M8 options)', () => {
    for (const s of SLUGS) {
      const p = { ...props(), spec: kitSpec(s), initial: {} };
      expect(sha(renderHtml({ ...p, audience: 'public' } as never))).toBe(sha(renderHtml(p as never)));
    }
  });

  it('pages: the fixture has two pages; headings start section cards', () => {
    const p = pages(S);
    expect(p).toHaveLength(2);
    expect(p[0].rows[0].cells[0].field).toMatchObject({ name: 'AboutHeading' });
    const steps = present(S);
    expect(steps[0].sections.map((x) => [x.key, x.title, x.heading && 'name' in x.heading ? x.heading.name : null])).toEqual([
      ['0-h1', 'About the job', 'AboutHeading'], ['0-h2', 'Red delivery', 'RedHeading'],
    ]);
    // Every field except the headings is in exactly one card.
    const placed = steps.flatMap((st) => st.sections.flatMap((x) => x.rows.flatMap((r) => r.cells.map((c) => cellId(c.cell)))));
    const named = S.fields.filter((f) => f.type !== 'pagebreak' && !isHeading(f)).map((f) => ('name' in f ? f.name : `content@${f.row}`));
    expect([...placed].sort()).toEqual([...named].sort());
  });

  it('reserved slugs: a form can never take a fixed /admin/forms/* segment', () => {
    for (const slug of ['import', 'new', 'design']) {
      expect(isReservedFormSlug(slug)).toBe(true);
      expect(() => parseSpec({ ...RAW, slug })).toThrow(/reserved/);
    }
    expect(isReservedFormSlug('engine-types-test')).toBe(false);
    for (const s of SLUGS) expect(isReservedFormSlug(s)).toBe(false);
  });
});

describe('entry PDF', () => {
  it('renders every type; a field hidden by showWhen is left out', async () => {
    const data = prepareSave(S, readFormData(S, fd(goodPost({ 'f.Appointment': '2026-10-29T14:30', 'f.Colour': 'Red', 'f.RedNote': 'note' })), { timeZone: TZ }), { audience: 'staff', previous: {} }).data;
    const withRed = await pdfHash(S, data);
    const rest = { ...data };
    delete rest.RedNote;
    const notRed = await pdfHash(S, { ...rest, Colour: 'Blue' });
    expect(withRed).toMatch(/^[0-9a-f]{64}$/);
    expect(withRed).not.toBe(notRed);
    expect(normalisePdf(Buffer.from('(D:20261029120000Z)'))).toBe('(D:0)');
    expect(hiddenFields(S, { Colour: 'Blue' }).size).toBeGreaterThan(0);
  });
});
