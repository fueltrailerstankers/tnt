import { describe, expect, it } from 'vitest';
import { mapChecklist } from '@/lib/import/cognito/checklist';
import { lookupExternalId, mapEntry, mapStatus, reportableKey, type MapResult } from '@/lib/import/cognito/map';
import { toChoice, toDate, toNumber, toParts, toText, toTimestamp, toYesNo } from '@/lib/import/cognito/values';
import { renderSummary } from '@/lib/spec/values';
import { entryOf } from './cognito-fake';
import { spec } from './specs';

function ok(r: MapResult) {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r;
}

describe('cognito value converters', () => {
  it('dates: ISO, ISO date-time and US M/D/YYYY become YYYY-MM-DD; impossible dates are dropped and flagged', () => {
    expect(toDate('2026-01-05').value).toBe('2026-01-05');
    expect(toDate('2026-01-04T00:00:00').value).toBe('2026-01-04');
    expect(toDate('1/7/2026').value).toBe('2026-01-07');
    expect(toDate('2026-02-30')).toEqual({ value: undefined, issue: 'invalid_date' });
    expect(toDate('next tuesday').issue).toBe('invalid_date');
    expect(toDate(null)).toEqual({ value: undefined });
  });

  it('timestamps become ISO UTC; a value without an offset is read as UTC', () => {
    expect(toTimestamp('2026-01-07T10:00:00')).toBe('2026-01-07T10:00:00.000Z');
    expect(toTimestamp('2026-01-07T12:00:00+02:00')).toBe('2026-01-07T10:00:00.000Z');
    expect(toTimestamp('')).toBeUndefined();
    expect(toTimestamp('garbage')).toBeUndefined();
  });

  it('numbers, yes/no, text', () => {
    expect(toNumber('12,500').value).toBe(12500);
    expect(toNumber('12,500.5', true)).toEqual({ value: 12500.5, issue: 'not_integer' });
    expect(toNumber('abc').issue).toBe('invalid_number');
    expect(toYesNo(true).value).toBe(true);
    expect(toYesNo('Yes').value).toBe(true);
    expect(toYesNo(null).value).toBe(false);
    expect(toText('  x  ').value).toBe('x');
    expect(toText(42).value).toBe('42');
    expect(toText('y'.repeat(10_001))).toMatchObject({ issue: 'truncated' });
  });

  it('choices keep historic values outside the option list and flag them', () => {
    expect(toChoice('JAN', ['JAN'], false)).toEqual({ value: 'JAN', issue: undefined });
    expect(toChoice('SEPT', ['SEP'], false)).toEqual({ value: 'SEPT', issue: 'not_in_options' });
    expect(toChoice(['JHB', 'CPT'], ['JHB', 'DUR', 'CPT'], true)).toEqual({ value: ['JHB', 'CPT'], issue: undefined });
    expect(toChoice([], ['JHB'], true).value).toBeUndefined();
  });

  it('name/address keep only spec parts; derived parts are dropped silently, others reported', () => {
    const r = toParts({ First: 'A', Last: 'B', FirstAndLast: 'A B', Middle: 'C', Prefix: null }, ['First', 'Last'], 'name');
    expect(r.value).toEqual({ First: 'A', Last: 'B' });
    expect(r.dropped).toEqual(['Middle']);
    expect(toParts({ Line1: null, City: null }, ['Line1', 'City'], 'address').value).toBeUndefined();
  });
});

describe('cognito entry mapping per form', () => {
  it('request-for-invoice: name, address, dates, files, metadata; unknown fields reported, not stored', () => {
    const r = ok(mapEntry(spec('request-for-invoice'), entryOf('request-for-invoice', '4-1')));
    const e = r.entry;
    expect(e).toMatchObject({
      externalId: '4-1', number: 1, status: 'Submitted',
      created_at: '2026-01-05T08:00:00.000Z', submitted_at: '2026-01-05T08:01:00.000Z', updated_at: '2026-01-06T09:00:00.000Z',
    });
    expect(e.data).toEqual({
      QuoteNo: 'QU-90001', DATE: '2026-01-05', SalesRep: 'Fake Rep One', CostomerVatNo: 'FAKE-VAT-0001', CONTACTNO: '000 000 0001',
      Name: { First: 'Testy', Last: 'Fakeperson' }, IDNO: 'FAKE-ID-0000000000001',
      Address: { Line1: '1 Example Street', City: 'Testville', State: 'Nowhere', PostalCode: '0000', Country: 'Testland' },
    });
    expect(e.files.map((f) => [f.field, f.kind, f.key, f.size])).toEqual([
      ['_1stDeposit', 'file', 'F-rfi1-a', 2048],
      ['_2ndDeposit', 'file', 'F-rfi1-b', 1024],
    ]);
    expect(e.signatures).toEqual([]);
    expect(r.unknownWithValue).toEqual(['Name.Middle']);
    expect(renderSummary(spec('request-for-invoice').settings.entrySummary, e.data)).toBe('Testy Fakeperson');

    const r2 = ok(mapEntry(spec('request-for-invoice'), entryOf('request-for-invoice', '4-2')));
    expect(r2.entry.status).toBe('Submitted'); // case-insensitive status match
    expect(r2.entry.data.DATE).toBe('2026-01-07');
    expect(r2.entry.created_at).toBe('2026-01-07T10:00:00.000Z');
    expect(r2.unknownFields.sort()).toEqual(['LegacyVinAsOnUnit', 'OldNotes']);
    expect(r2.unknownWithValue).toEqual(['LegacyVinAsOnUnit']);
    expect(r2.entry.data).not.toHaveProperty('LegacyVinAsOnUnit');
  });

  it('unknown status is skipped with a reason', () => {
    const r = mapEntry(spec('request-for-invoice'), entryOf('request-for-invoice', '4-3'));
    expect(r).toMatchObject({ ok: false, reason: 'unknown_status', externalId: '4-3' });
  });

  it('deal: multi-choice array, dropdowns, integer total, POP file; incomplete entries keep their status', () => {
    const e = ok(mapEntry(spec('deal'), entryOf('deal', '9-1'))).entry;
    expect(e.data).toEqual({
      MONTH: 'JAN', DATECREATED: '2026-01-04', COLLECTIONLOCATION: ['JHB', 'CPT'], QUOTENO: 'QU-90001', SALESREP: 'MELINDA',
      PARTNO1: 'FAKE-PART-1', LINE1: 'Synthetic trailer line one', Total: 125000,
    });
    expect(e.files).toHaveLength(1);
    const r2 = ok(mapEntry(spec('deal'), entryOf('deal', '9-2')));
    expect(r2.entry.status).toBe('Incomplete');
    expect(r2.entry.submitted_at).toBeNull();
    expect(r2.entry.data).toMatchObject({ MONTH: 'SEPT', Total: 12500.5 });
    expect(r2.issues).toEqual(expect.arrayContaining([{ field: 'MONTH', code: 'not_in_options' }, { field: 'Total', code: 'not_integer' }]));
  });

  it('job-card and release-form: text, date and email fields', () => {
    expect(ok(mapEntry(spec('job-card'), entryOf('job-card', '6-1'))).entry.data).toEqual({
      Date: '2026-02-02', QuoteNo: 'QU-90001', Line1: 'Synthetic build line', Text: 'a', Text3: 'c', Text6: 'f',
    });
    const rel = ok(mapEntry(spec('release-form'), entryOf('release-form', '8-1')));
    expect(rel.entry.data).toEqual({ VINNO: 'FAKEVIN0000000001', Email: 'buyer-one@example.invalid', INVNO: 'INV-90001', COSTOMERDETAILS: 'Fake Customer One' });
    expect(rel.unknownFields).toEqual([]);
  });

  it('store-room: workflow statuses APPROVAL and APPROVED EMAILED; numbers stored as text like the form', () => {
    const a = ok(mapEntry(spec('store-room'), entryOf('store-room', '12-1'))).entry;
    expect(a.status).toBe('APPROVAL');
    expect(a.data).toEqual({ _14INCX5HoleTIRESMIN50: '42', NUTS12MM: '100' });
    expect(ok(mapEntry(spec('store-room'), entryOf('store-room', '12-2'))).entry.status).toBe('APPROVED EMAILED');
  });

  it('delivery-note: lookup becomes an RFI reference, signatures are signature files, table key is known', () => {
    const r = ok(mapEntry(spec('delivery-note'), entryOf('delivery-note', '5-1')));
    expect(r.entry.lookups).toEqual([{ field: 'QuoteNo', sourceSlug: 'request-for-invoice', externalId: '4-1' }]);
    expect(r.entry.data).not.toHaveProperty('QuoteNo');
    expect(r.entry.data).toEqual({ TrailerVinNO: 'FAKEVIN0000000001', INVOICENO: 'INV-90001', DeliveryDate: '2026-02-10', Email: 'buyer-one@example.invalid' });
    expect(r.entry.signatures.map((s) => [s.field, s.kind, s.ref.url !== null])).toEqual([
      ['Signature4', 'signature', true], ['Signature', 'signature', true], ['Signature2', 'signature', true],
      ['Signature3', 'signature', true], ['SalesRepSignature', 'signature', true],
    ]);
    expect(r.entry.files.map((f) => f.field)).toEqual(['COPYOfSignatoryID', 'NATIS', 'Pic1FRONT', 'Pic1FRONT']);
    expect(r.entry.files.map((f) => f.index)).toEqual([0, 0, 0, 1]);
    expect(r.unknownFields).toEqual([]);

    expect(ok(mapEntry(spec('delivery-note'), entryOf('delivery-note', '5-2'))).entry.lookups[0].externalId).toBe('4-99');
    const svg = ok(mapEntry(spec('delivery-note'), entryOf('delivery-note', '5-3')));
    expect(svg.entry.signatures[0]).toMatchObject({ field: 'Signature4', contentType: 'image/svg+xml', name: 'signature.svg' });
    expect(svg.issues).toContainEqual({ field: 'Signature4', code: 'signature_svg_only' });
  });

  it('lookup references: object, "form-number" string, bare number', () => {
    expect(lookupExternalId({ Id: '4-12', Label: 'x' }, 4)).toBe('4-12');
    expect(lookupExternalId('4-12', 4)).toBe('4-12');
    expect(lookupExternalId(12, 4)).toBe('4-12');
    expect(lookupExternalId('QU-1', 4)).toBeNull();
  });

  it('status names match the spec spelling', () => {
    expect(mapStatus(spec('trailer-inspection-checklist'), 'reviewed')).toEqual({ status: 'Reviewed' });
    expect(mapStatus(spec('deal'), '')).toEqual({ reason: 'missing_status' });
  });

  it('report keys never echo something that is not a field name', () => {
    expect(reportableKey('LegacyField')).toBe('LegacyField');
    expect(reportableKey('someone@example.invalid')).toBe('<unprintable-key>');
  });
});

describe('inspection checklist', () => {
  const sp = spec('trailer-inspection-checklist');

  it('nested object layout: all 20 rows; items 1 and 11 share the Cognito name "Pass" and stay distinct', () => {
    const r = ok(mapEntry(sp, entryOf('trailer-inspection-checklist', '13-1')));
    const rows = r.entry.data.checklist as Array<{ itemNo: number; fail: boolean; pass: boolean; comments: string; label: string }>;
    expect(rows).toHaveLength(20);
    expect(rows.map((x) => x.itemNo)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(rows[0]).toMatchObject({ itemNo: 1, pass: true, fail: false, label: sp.checklist![0].label });
    expect(rows[4]).toMatchObject({ itemNo: 5, pass: false, fail: true, comments: 'Synthetic comment 5' });
    expect(rows[10]).toMatchObject({ itemNo: 11, pass: true, comments: 'Synthetic comment 11' });
    expect(r.entry.data).toMatchObject({
      TRAILERVINNUMBER: 'FAKEVIN0000000001', _1STDATEINSPECTION: '2026-02-03', InspectionDate: '2026-02-03',
      InspectedByName: { First: 'Inspecta', Last: 'Fakeinspector' }, InspectorEmail: 'inspector@example.invalid',
    });
    expect(r.entry.status).toBe('Approved');
    expect(r.entry.signatures[0]).toMatchObject({ field: 'InspectorSignature', kind: 'signature', key: 'inline-png' });
    expect(r.entry.signatures[0].ref.inline?.contentType).toBe('image/png');
    expect(r.unknownFields).toEqual([]);
    expect(r.issues).toEqual([]);
  });

  it('array layout: item 11 pass does not leak into item 1', () => {
    const r = ok(mapEntry(sp, entryOf('trailer-inspection-checklist', '13-2')));
    const rows = r.entry.data.checklist as Array<{ itemNo: number; fail: boolean; pass: boolean; comments: string }>;
    expect(rows[0]).toMatchObject({ pass: false, fail: true, comments: 'Synthetic comment 1' });
    expect(rows[10]).toMatchObject({ pass: true, fail: false });
    expect(rows.filter((x) => x.pass)).toHaveLength(1);
    expect(r.entry.data).not.toHaveProperty('InspectionDate'); // 2026-02-30 is not a date
    expect(r.issues).toContainEqual({ field: 'InspectionDate', code: 'invalid_date' });
  });

  it('top-level sub-sections are recognised by their unique Comments/Pass names', () => {
    const raw = {
      SectionEleven: { Fail: false, Pass: true, Comments10: 'eleven' },
      SectionOne: { Fail: true, Pass: false, Comments: 'one' },
      SectionTwo: { Fail: false, Pass1: true, Comments1: null },
    };
    const cl = mapChecklist(raw, sp.checklist!, 'TrailerInspectionResults', new Set());
    expect(cl.rows[0]).toMatchObject({ fail: true, pass: false, comments: 'one' });
    expect(cl.rows[1]).toMatchObject({ pass: true });
    expect(cl.rows[10]).toMatchObject({ pass: true, comments: 'eleven' });
    expect(cl.consumedKeys.sort()).toEqual(['SectionEleven', 'SectionOne', 'SectionTwo']);
  });

  it('a missing checklist still yields 20 empty rows and is flagged', () => {
    const cl = mapChecklist({}, sp.checklist!, 'TrailerInspectionResults', new Set());
    expect(cl.rows).toHaveLength(20);
    expect(cl.rows.every((x) => !x.pass && !x.fail && x.comments === '')).toBe(true);
    expect(cl.issues).toEqual(['checklist_missing']);
  });
});
