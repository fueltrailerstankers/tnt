import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '@/lib/spec/content.generated';
import { contentBlocks, htmlBlocks, markdownBlocks } from '@/lib/spec/content';
import { errorMessage, parseAllowedWhen, parseErrorWhen } from '@/lib/spec/expressions';
import { pages } from '@/lib/spec/layout';
import { inputFields } from '@/lib/spec/types';
import { defaultData, displayValue, readFormData, renderSummary, todayIn, validateEntry } from '@/lib/spec/values';
import { fd, SLUGS, spec } from './specs';

describe('specs', () => {
  it('all 7 kit specs parse', () => {
    expect(SLUGS).toEqual([
      'deal', 'delivery-note', 'job-card', 'release-form', 'request-for-invoice', 'store-room', 'trailer-inspection-checklist',
    ]);
    for (const s of SLUGS) expect(spec(s).slug).toBe(s);
  });

  it('every allowedWhen and customError expression parses', () => {
    for (const s of SLUGS) {
      const sp = spec(s);
      for (const a of sp.workflow.actions) expect(() => parseAllowedWhen(a.allowedWhen)).not.toThrow();
      for (const f of inputFields(sp)) if ('customError' in f && f.customError) expect(() => parseErrorWhen(f.customError!.when)).not.toThrow();
    }
  });

  it('field names are unique per form (they are the entries.data keys)', () => {
    for (const s of SLUGS) {
      const names = inputFields(spec(s)).map((f) => f.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('every content block resolves', () => {
    for (const s of SLUGS) for (const f of spec(s).fields) if (f.type === 'content') expect(contentBlocks(f).length).toBeGreaterThan(0);
  });
});

describe('layout', () => {
  it('store room has three pages with Cognito titles and buttons', () => {
    const p = pages(spec('store-room'));
    expect(p.map((x) => [x.title, x.nextButton, x.backButton])).toEqual([
      ['Page 1', 'Next', undefined],
      ['Page 2', 'Next', 'Back'],
      ['Page 3', 'Submit', 'Back'],
    ]);
    expect(p[0].rows[0].cells[0].field).toMatchObject({ name: '_14INCX5HoleTIRESMIN50' });
  });

  it('single-page forms end in Submit and keep row order and widths', () => {
    const p = pages(spec('delivery-note'));
    expect(p).toHaveLength(1);
    expect(p[0].nextButton).toBe('Submit');
    const row2 = p[0].rows.find((r) => r.row === 2)!;
    expect(row2.cells.map((c) => [c.col, c.span])).toEqual([[1, 12], [13, 12]]);
    expect(p[0].rows.map((r) => r.row)).toEqual([...p[0].rows.map((r) => r.row)].sort((a, b) => a - b));
  });

  it('every input field appears on exactly one page', () => {
    for (const s of SLUGS) {
      const sp = spec(s);
      const placed = pages(sp).flatMap((p) => p.rows.flatMap((r) => r.cells.map((c) => c.field)));
      expect(placed.length).toBe(sp.fields.filter((f) => f.type !== 'pagebreak').length);
    }
  });
});

describe('expressions', () => {
  it('allowedWhen', () => {
    const p = parseAllowedWhen("status == 'Submitted' AND role == 'Form Creator / Internal Reviewer'");
    expect(p({ status: 'Submitted', role: 'Form Creator / Internal Reviewer' })).toBe(true);
    expect(p({ status: 'Submitted', role: 'Inspector' })).toBe(false);
    expect(parseAllowedWhen("status != 'Incomplete'")({ status: 'Incomplete', role: 'x' })).toBe(false);
    expect(parseAllowedWhen('always')({ status: 'x', role: 'y' })).toBe(true);
    expect(() => parseAllowedWhen("status ~= 'x'")).toThrow(/Unsupported/);
  });

  it('customError message uses the suggested copy when the kit only has a note', () => {
    expect(errorMessage("(Cognito default) suggest: 'Enter the Trailer VIN or the Invoice No'")).toBe('Enter the Trailer VIN or the Invoice No');
    expect(errorMessage('NO PAYMENT LOADED FORM NOT SUBMITTED')).toBe('NO PAYMENT LOADED FORM NOT SUBMITTED');
  });
});

describe('validation', () => {
  it('RFI blocks with the Cognito message when there is no quote no and no first deposit', () => {
    const sp = spec('request-for-invoice');
    const r = readFormData(sp, fd({}));
    expect(validateEntry(sp, r.data, {})).toEqual({ _1stDeposit: 'NO PAYMENT LOADED FORM NOT SUBMITTED' });
    expect(validateEntry(sp, { QuoteNo: 'Q1' }, {})).toEqual({});
    expect(validateEntry(sp, {}, { _1stDeposit: 1 })).toEqual({});
  });

  it('RFI first deposit allows at most 5 files', () => {
    expect(validateEntry(spec('request-for-invoice'), { QuoteNo: 'Q' }, { _1stDeposit: 6 })._1stDeposit).toMatch(/at most 5/);
  });

  it('Delivery Note needs a VIN or an email, and a VIN or an invoice no', () => {
    const sp = spec('delivery-note');
    expect(validateEntry(sp, {}, {})).toEqual({
      TrailerVinNO: 'Enter the Trailer VIN or an Email',
      INVOICENO: 'Enter the Trailer VIN or the Invoice No',
    });
    expect(validateEntry(sp, { TrailerVinNO: 'VIN' }, {})).toEqual({});
    expect(validateEntry(sp, { Email: 'a@example.invalid' }, {})).toEqual({ INVOICENO: 'Enter the Trailer VIN or the Invoice No' });
  });

  it('Inspection requires the inspector name (both parts) and email', () => {
    const sp = spec('trailer-inspection-checklist');
    expect(validateEntry(sp, {}, {})).toEqual({ InspectedByName: 'This field is required.', InspectorEmail: 'This field is required.' });
    expect(validateEntry(sp, { InspectedByName: { First: 'Test' }, InspectorEmail: 'x@example.invalid' }, {})).toEqual({
      InspectedByName: 'This field is required.',
    });
  });

  it('reads typed values and rejects bad ones', () => {
    const sp = spec('deal');
    const r = readFormData(sp, fd({ 'f.MONTH': 'MARCH', 'f.COLLECTIONLOCATION': ['JHB', 'CPT'], 'f.Total': '1200', 'f.DATECREATED': '2026-02-30' }));
    expect(r.data).toMatchObject({ MONTH: 'MARCH', COLLECTIONLOCATION: ['JHB', 'CPT'], Total: 1200 });
    expect(r.errors).toEqual({ DATECREATED: 'Enter a valid date.' });
    expect(readFormData(sp, fd({ 'f.MONTH': 'SMARCH' })).errors.MONTH).toBeDefined();
    expect(readFormData(sp, fd({ 'f.Total': '12.5' })).errors.Total).toBe('Enter a whole number.');
  });

  it('reads the inspection checklist into data.checklist', () => {
    const r = readFormData(spec('trailer-inspection-checklist'), fd({ 'cl.1.pass': 'on', 'cl.2.fail': 'on', 'cl.2.comments': 'loose bolt' }));
    const cl = r.data.checklist as Array<{ itemNo: number; fail: boolean; pass: boolean; comments: string }>;
    expect(cl).toHaveLength(20);
    expect(cl[0]).toMatchObject({ itemNo: 1, pass: true, fail: false });
    expect(cl[1]).toMatchObject({ itemNo: 2, pass: false, fail: true, comments: 'loose bolt' });
  });

  it('accepts only staged paths of the expected shape for files', () => {
    const sp = spec('deal');
    const ok = JSON.stringify([{ kind: 'staged', path: `staging/${'1'.repeat(8)}-1111-1111-1111-${'1'.repeat(12)}/POP/${'2'.repeat(8)}-2222-2222-2222-${'2'.repeat(12)}-pop.pdf`, name: 'pop.pdf', size: 10, type: 'application/pdf' }]);
    expect(readFormData(sp, fd({ 'file.POP': ok })).files.POP).toHaveLength(1);
    const evil = JSON.stringify([{ kind: 'staged', path: 'deal/other-entry/POP/x.pdf', name: 'x', size: 1, type: 'x' }]);
    expect(readFormData(sp, fd({ 'file.POP': evil })).errors.POP).toBeDefined();
  });

  it('signatures accept PNG data URLs or keep references only', () => {
    const sp = spec('delivery-note');
    expect(readFormData(sp, fd({ 'sig.Signature': 'data:image/png;base64,iVBORw0KGgo=' })).signatures.Signature).toMatchObject({ kind: 'new' });
    expect(readFormData(sp, fd({ 'sig.Signature': 'data:text/html;base64,PHNjcmlwdD4=' })).errors.Signature).toBeDefined();
  });

  it('defaults come from the spec', () => {
    expect(defaultData(spec('deal'))).toEqual({ MONTH: 'JAN', SALESREP: 'MELINDA' });
    // DATE CREATED is pre-filled with today when the caller knows the org's date; it stays a normal editable value.
    expect(defaultData(spec('deal'), { today: '2026-10-29' })).toEqual({ MONTH: 'JAN', SALESREP: 'MELINDA', DATECREATED: '2026-10-29' });
    // 22:30 UTC on 29 Oct is already 30 Oct in Johannesburg (UTC+2).
    expect(todayIn('Africa/Johannesburg', new Date('2026-10-29T22:30:00Z'))).toBe('2026-10-30');
    expect(defaultData(spec('trailer-inspection-checklist'))).toEqual({ InspectorEmail: 'admin@trailersandtankers.co.za' });
  });
});

describe('summary and display', () => {
  it('renders summary templates', () => {
    expect(renderSummary('[QUOTENO]', { QUOTENO: '12345' })).toBe('12345');
    expect(renderSummary('[Name]', { Name: { First: 'Test', Last: 'Person' } })).toBe('Test Person');
    expect(renderSummary('[Missing]', {})).toBe('');
    expect(displayValue(['JHB', 'CPT'])).toBe('JHB, CPT');
  });
});

describe('content', () => {
  it('generated content module is byte-identical to the kit files (legal text is verbatim)', () => {
    for (const [ref, text] of Object.entries(CONTENT)) {
      expect(text).toBe(readFileSync(path.resolve(__dirname, '../../docs/source/tt-forms', ref), 'utf8'));
    }
    expect(Object.keys(CONTENT).sort()).toEqual(['content/polyurethane-tanks-waiver.md', 'content/terms-and-conditions.md']);
  });

  it('markdown keeps every word, drops the comment and keeps bold', () => {
    const md = CONTENT['content/terms-and-conditions.md'];
    const blocks = markdownBlocks(md);
    const text = blocks.map((b) => b.spans.map((s) => s.text).join('')).join(' ');
    expect(text).not.toContain('Verbatim from Cognito');
    expect(blocks[0].spans[0]).toEqual({ text: 'STANDARD TRADING TERMS AND CONDITIONS.', bold: true });
    const words = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\*\*/g, '').split(/\s+/).filter(Boolean);
    expect(words(text)).toEqual(words(md));
  });

  it('inline HTML snippets become plain text', () => {
    expect(htmlBlocks('<p>the above documetns have been ready by myself&nbsp;</p>')).toEqual([
      { kind: 'paragraph', spans: [{ text: 'the above documetns have been ready by myself', bold: false }] },
    ]);
  });
});
