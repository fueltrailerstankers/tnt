import { describe, expect, it } from 'vitest';
import { pages } from '@/lib/spec/layout';
import { cellId, minimumOf, packRows, present, shortBy, stepOf } from '@/lib/spec/presentation';
import { SLUGS, spec } from './specs';

describe('presentation', () => {
  it.each(SLUGS)('%s shows every spec cell exactly once', (slug) => {
    const s = spec(slug);
    const expected = pages(s).flatMap((p) => p.rows.flatMap((r) => r.cells.map(cellId))).sort();
    const shown = present(s).flatMap((st) => st.sections.flatMap((sec) => sec.rows.flatMap((r) => r.cells.map((c) => cellId(c.cell))))).sort();
    expect(shown).toEqual(expected);
  });

  it.each(SLUGS)('%s keeps rows within 24 columns', (slug) => {
    for (const st of present(spec(slug))) {
      for (const sec of st.sections) {
        if (sec.kind !== 'grid') continue;
        for (const r of sec.rows) expect(r.cells.reduce((n, c) => n + c.span, 0)).toBeLessThanOrEqual(24);
      }
    }
  });

  it('packs narrow single-field rows side by side and widens them', () => {
    const release = pages(spec('release-form'))[0];
    const rows = packRows(release.rows);
    expect(rows.map((r) => r.cells.map((c) => [cellId(c.cell), c.span]))).toEqual([
      [['VINNO', 12], ['Email', 12]],
      [['INVNO', 12], ['COSTOMERDETAILS', 12]],
    ]);
  });

  it('keeps the Store Room spec pages (Back/Next, page titles) and marks them as count sheets', () => {
    const steps = present(spec('store-room'));
    expect(steps.map((s) => [s.title, s.nextButton])).toEqual([['Page 1', 'Next'], ['Page 2', 'Next'], ['Page 3', 'Submit']]);
    expect(steps.every((s) => s.sections[0].kind === 'count')).toBe(true);
  });

  it('turns the Delivery Note into the 5-step signing flow with gates', () => {
    const steps = present(spec('delivery-note'));
    expect(steps.map((s) => s.title)).toEqual(['Trailer and customer', 'Terms and warranty', 'Waiver and receipt', 'Documents and delivery', 'Photos and review']);
    expect(steps.map((s) => s.nextButton)).toEqual(['Next', 'Next', 'Next', 'Next', 'Submit']);
    expect(steps.flatMap((s) => s.requireSigned)).toEqual(['Signature4', 'Signature', 'Signature2', 'Signature3', 'SalesRepSignature']);
    expect(steps[1].gate).toEqual({ content: 'content@4', signature: 'Signature4' });
    expect(stepOf(steps, 'TrailerVinNO')).toBe(0);
    expect(stepOf(steps, 'Email')).toBe(3);
    expect(stepOf(steps, 'Pic4REAR')).toBe(4);
    expect(steps[4].review).toBe(true);
  });

  it('lays the Deal lines out as eight part number / description pairs, then the manual Total', () => {
    const lines = present(spec('deal'))[0].sections.find((s) => s.kind === 'lines')!;
    expect(lines.rows).toHaveLength(9);
    expect(lines.rows[7].cells.map((c) => cellId(c.cell))).toEqual(['PARTNO8', 'LINE8']);
    expect(lines.rows[8].cells.map((c) => cellId(c.cell))).toEqual(['Total']);
  });
});

describe('store room minimums', () => {
  it('reads MIN, MOQ and MIN ON SHELF from labels', () => {
    expect(minimumOf('14INC x 5 hole TIRES MIN 50')).toBe(50);
    expect(minimumOf('1450 45 5 HOLE BRAKED MOQ 12')).toBe(12);
    expect(minimumOf('2 TON COUPLER MIN ON SHELF 10')).toBe(10);
    expect(minimumOf('16INCH X 6 HOLE TIRES 5')).toBeNull();
    expect(minimumOf('OTHER ')).toBeNull();
  });

  it('computes the shortfall only for numbers below the minimum', () => {
    expect(shortBy('42', 50)).toBe(8);
    expect(shortBy('50', 50)).toBe(0);
    expect(shortBy('', 50)).toBe(0);
    expect(shortBy('n/a', 50)).toBe(0);
    expect(shortBy('3', null)).toBe(0);
  });
});
