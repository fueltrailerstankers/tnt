// Security review of M8 (H1, M1-M4, lows): each case is a test that would have caught the issue. Synthetic data only.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fieldNameFromLabel, FIELD_NAME_RE, slugFromName, slugProblem } from '@/lib/forms/builder/names';
import { changeProblems, specProblems } from '@/lib/forms/builder/spec';
import { pickPublic, publicFieldNames, publicLookupOf, publicUploadAllowed, PUBLIC_LOOKUPS } from '@/lib/forms/public-policy';
import { parseSpec, type FormSpec } from '@/lib/spec/types';
import { defaultData, prepareSave, publicSpec, readFormData } from '@/lib/spec/values';
import { buildEmail } from '@/lib/workflow/email-template';
import { fd, SLUGS, spec as kitSpec } from './specs';

const RAW = JSON.parse(readFileSync(path.resolve(__dirname, '../fixtures/m8/engine-types.json'), 'utf8'));
const S: FormSpec = parseSpec(RAW);
const mk = (fields: unknown[], extra: Record<string, unknown> = {}) => parseSpec({ ...RAW, settings: { entrySummary: '' }, fields, ...extra });

describe('H1: role links only carry public fields, files, signatures and lookups', () => {
  it('pickPublic drops files/signatures of internalOnly fields', () => {
    const sp = mk([
      { name: 'Photo', label: 'Photo', type: 'file', row: 1 },
      { name: 'Secret', label: 'Secret', type: 'file', row: 2, internalOnly: true },
      { name: 'Sig', label: 'Sig', type: 'signature', row: 3, internalOnly: true },
    ]);
    expect(Object.keys(pickPublic(sp, { Photo: [1], Secret: [2] }))).toEqual(['Photo']);
    expect(pickPublic(sp, { Sig: { id: 'x' } })).toEqual({});
    expect(publicFieldNames(sp)).toEqual(new Set(['Photo']));
  });

  it('an internalOnly lookup is never public; only allow-listed lookups are', () => {
    expect(publicLookupOf(kitSpec('delivery-note'))?.name).toBe('QuoteNo');
    const lk = (extra: Record<string, unknown>, slug = 'delivery-note') => ({ ...kitSpec(slug), fields: kitSpec(slug).fields.map((f) => (f.type === 'lookup' ? { ...f, ...extra } : f)) }) as FormSpec;
    expect(publicLookupOf(lk({ internalOnly: true }))).toBeNull();
    expect(publicLookupOf(lk({ lookup: { sourceForm: 'request-for-invoice', displayField: 'IDNO' } }))).toBeNull();
    const builder = mk([{ name: 'Pick', label: 'Pick', type: 'lookup', style: 'dropdown', row: 1, lookup: { sourceForm: 'request-for-invoice', displayField: 'QuoteNo' } }]);
    expect(publicLookupOf(builder)).toBeNull();
    expect(PUBLIC_LOOKUPS).toHaveLength(1);
  });
});

describe('M1: a public post cannot erase locked values, even when a rule hides them', () => {
  it('a hidden readOnly/internalOnly field keeps the previous value for the public role', () => {
    const sp = mk([
      { name: 'Show', label: 'Show', type: 'yesno', row: 1 },
      { name: 'StaffNote', label: 'Staff note', type: 'text', row: 2, internalOnly: true, showWhen: 'Show = true' },
      { name: 'Ref', label: 'Ref', type: 'text', row: 3, readOnly: true, showWhen: 'Show = true' },
    ]);
    const prev = { StaffNote: 'kept', Ref: 'R-1', Show: true };
    const p = prepareSave(sp, readFormData(sp, fd({ 'f.Show': 'no' })), { audience: 'public', previous: prev, stored: prev });
    expect(p.data).toMatchObject({ StaffNote: 'kept', Ref: 'R-1', Show: false });
  });
});

describe('M2: the builder never loses data', () => {
  it('a field hidden by show-when keeps its stored value on save; a new entry stores nothing for it', () => {
    const sp = mk([
      { name: 'Show', label: 'Show', type: 'yesno', row: 1 },
      { name: 'Detail', label: 'Detail', type: 'text', row: 2, showWhen: 'Show = true' },
    ]);
    const read = readFormData(sp, fd({ 'f.Show': 'no', 'f.Detail': 'typed while hidden' }));
    expect(prepareSave(sp, read, { audience: 'staff', previous: {}, stored: { Show: true, Detail: 'saved before' } }).data).toEqual({ Show: false, Detail: 'saved before' });
    expect(prepareSave(sp, read, { audience: 'staff', previous: {}, stored: null }).data).toEqual({ Show: false });
  });

  it('the guard suggests internal only / read only, never "hide it"', () => {
    const without = { ...S, fields: S.fields.filter((f) => !('name' in f) || f.name !== 'Title') };
    const msg = changeProblems(S, without, { withData: new Set(['Title']), hasEntries: true, encrypted: false }).join();
    expect(msg).toMatch(/internal only or read only/);
    expect(msg).not.toMatch(/show-when/);
  });

  it('removing a part of a name or address field with data is refused', () => {
    const fewer = { ...S, fields: S.fields.map((f) => (f.type === 'address' ? { ...f, parts: ['Line1'] } : f.type === 'name' ? { ...f, parts: ['First'] } : f)) };
    const msg = changeProblems(S, fewer, { withData: new Set(['Contact', 'Site']), hasEntries: true, encrypted: false }).join();
    expect(msg).toMatch(/"Contact" has data: its parts cannot be removed \(Last\)/);
    expect(msg).toMatch(/"Site" has data: its parts cannot be removed \(City\)/);
    const more = { ...S, fields: S.fields.map((f) => (f.type === 'name' ? { ...f, parts: ['Title', 'First', 'Last'] } : f)) };
    expect(changeProblems(S, more, { withData: new Set(['Contact']), hasEntries: true, encrypted: false })).toEqual([]);
  });

  it('a status that entries are in, or a role with live links, cannot be removed', () => {
    const next = { ...S, workflow: { ...S.workflow, statuses: S.workflow.statuses.filter((s) => s.name !== 'Submitted'), roles: S.workflow.roles.map((r) => (r.public ? { ...r, name: 'Customer' } : r)) } };
    const msg = changeProblems(S, next, { withData: new Set(), hasEntries: true, encrypted: false, statusesInUse: new Set(['Submitted']), rolesWithLinks: new Set(['Public']) }).join();
    expect(msg).toMatch(/Status "Submitted" has entries/);
    expect(msg).toMatch(/Role "Public" has live role links/);
  });
});

describe('M3: the public pages get the public spec only; public rules cannot use internal fields', () => {
  it('publicSpec and the public defaults carry nothing internal', () => {
    const pub = publicSpec(S);
    expect(JSON.stringify(pub)).not.toContain('InternalNote');
    expect(defaultData(pub)).not.toHaveProperty('InternalNote');
  });

  it('a public field may not show-when on an internalOnly field', () => {
    const sp = { ...S, fields: [...S.fields, { name: 'Leak', label: 'Leak', type: 'text', row: 99, showWhen: 'InternalNote = "x"' }] };
    expect(specProblems(sp, S.slug).problems.join()).toMatch(/cannot use the internal-only field InternalNote/);
    const internal = { ...S, fields: [...S.fields, { name: 'Ok', label: 'Ok', type: 'text', row: 99, internalOnly: true, showWhen: 'InternalNote = "x"' }] };
    expect(specProblems(internal, S.slug).problems.join()).not.toMatch(/internal-only field/);
  });

  it('errors for the public role never name an internal field', () => {
    const sp = mk([
      { name: 'Pub', label: 'Pub', type: 'text', row: 1, required: true },
      { name: 'Hidden', label: 'Hidden', type: 'email', row: 2, required: true, internalOnly: true },
    ]);
    const p = prepareSave(sp, readFormData(sp, fd({ 'f.Hidden': 'not-an-email' })), { audience: 'public', previous: {} });
    expect(Object.keys(p.errors)).not.toContain('Hidden');
    expect(p.skip.has('Hidden')).toBe(true);
  });
});

describe('M4: lookup fields name real fields', () => {
  it('displayField must be a field name of the source form', () => {
    const sources = new Map([['request-for-invoice', new Set(['QuoteNo'])]]);
    const lk = (display: string) => ({ ...S, fields: [...S.fields, { name: 'Pick', label: 'Pick', type: 'lookup', style: 'dropdown', row: 99, lookup: { sourceForm: 'request-for-invoice', displayField: display } }] });
    expect(specProblems(lk('QuoteNo'), S.slug, sources).problems).toEqual([]);
    expect(specProblems(lk('Nope'), S.slug, sources).problems.join()).toMatch(/not a field of the chosen form/);
    expect(specProblems(lk('a,b'), S.slug).problems.join()).toMatch(/not a field of the chosen form/);
  });
});

describe('lows', () => {
  it('url defaults go through normaliseUrl (an invalid one is not stored)', () => {
    const sp = mk([{ name: 'U', label: 'U', type: 'url', row: 1, default: 'javascript:alert(1)' }]);
    expect(defaultData(sp)).toEqual({});
    expect(specProblems(sp, S.slug).problems.join()).toMatch(/default must be an https:\/\/ link/);
  });

  it('field names __proto__, constructor and prototype are refused', () => {
    for (const n of ['__proto__', 'constructor', 'prototype']) {
      expect(FIELD_NAME_RE.test(n)).toBe(false);
      expect(() => mk([{ name: n, label: n, type: 'text', row: 1 }])).toThrow(/not allowed/);
    }
    expect(fieldNameFromLabel('constructor', [])).toBe('ConstructorField');
  });

  it('bounds: datetime years 1900-2100, currency non-negative unless min < 0 and at most 1e12, phone at most 40 characters', () => {
    expect(readFormData(S, fd({ 'f.Appointment': '1899-12-31T10:00' })).errors.Appointment).toBeDefined();
    expect(readFormData(S, fd({ 'f.Appointment': '2101-01-01T10:00' })).errors.Appointment).toBeDefined();
    expect(readFormData(S, fd({ 'f.Appointment': '2100-12-31T10:00' })).errors.Appointment).toBeUndefined();
    const cur = mk([{ name: 'M', label: 'M', type: 'currency', row: 1 }, { name: 'N', label: 'N', type: 'currency', row: 2, min: -100 }]);
    expect(readFormData(cur, fd({ 'f.M': '-5' })).errors.M).toBe('Enter an amount of 0 or more.');
    expect(readFormData(cur, fd({ 'f.N': '-5' })).data.N).toEqual({ amount: -5, currency: 'USD' });
    expect(readFormData(cur, fd({ 'f.M': '1000000000001' })).errors.M).toBeDefined();
    expect(readFormData(S, fd({ 'f.Phone': `082 ${'0'.repeat(37)}` })).errors.Phone).toBeDefined();
  });

  it('external emails drop internalOnly [Field] tokens and values', () => {
    const built = buildEmail({ to: ['[Email]'], subject: 'Re [Title] [InternalNote]', body: '<p>[InternalNote]</p>', includeEntryDetails: true }, 'Submit', {
      spec: S, data: { Title: 'T', InternalNote: 'staff secret', Email: 'a@example.invalid' }, entryNumber: 1, status: 'Submitted', adminLink: '', configuredRecipients: [], fileCounts: {},
    });
    expect(built.subject.trim()).toBe('Re T');
    expect(`${built.html}${built.text}`).not.toMatch(/staff secret|InternalNote|Internal note/);
    const staff = buildEmail({ to: ['office@example.invalid'], subject: '[InternalNote]' }, 'Submit', {
      spec: S, data: { InternalNote: 'staff secret' }, entryNumber: 1, status: 'Submitted', adminLink: '', configuredRecipients: ['office@example.invalid'], fileCounts: {},
    });
    expect(staff.subject).toBe('staff secret');
  });

  it('upload tickets for the public role: visible unlocked file fields only', () => {
    const sp = mk([
      { name: 'Open', label: 'Open', type: 'file', row: 1 },
      { name: 'Locked', label: 'Locked', type: 'file', row: 2, readOnly: true },
      { name: 'Staff', label: 'Staff', type: 'file', row: 3, internalOnly: true },
    ]);
    expect(publicUploadAllowed(sp, 'Open')).toBe(true);
    expect(publicUploadAllowed(sp, 'Locked')).toBe(false);
    expect(publicUploadAllowed(sp, 'Staff')).toBe(false);
  });

  it('kit slugs are kept by the kit forms but never given to a new builder form', () => {
    for (const s of SLUGS) {
      expect(slugProblem(s, [])).toMatch(/standard form/);
      expect(slugFromName(s, [])).not.toBe(s);
      expect(() => kitSpec(s)).not.toThrow();
    }
  });

  it('deal and delivery-note must stay encrypted', () => {
    const d = kitSpec('deal');
    expect(specProblems({ ...d, settings: { ...d.settings, encryptEntries: false } }, 'deal').problems).toContain('This form is always encrypted.');
  });
});
