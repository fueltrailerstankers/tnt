import { describe, expect, it } from 'vitest';
import { dealImportFields } from '@/lib/forms/deal-import';
import { dealFieldsFromQuote } from '@/lib/integrations/xero/write/plan-deal';

const line = (line_no: number, item_code: string | null, description: string | null) => ({ line_no, item_code, description, quantity: 1, unit_amount: 1 });

describe('DEAL import from Xero', () => {
  it('fills lines in line order, at most 8, and clears the rest', () => {
    const { target, linesImported } = dealFieldsFromQuote({ total: '486750.00' }, [line(2, 'BLK-KIT', 'Bottom-loading kit'), line(1, 'TT-45K', 'Fuel tanker 45 000 L')]);
    expect(linesImported).toBe(2);
    const f = dealImportFields(target);
    expect([f.PARTNO1, f.LINE1, f.PARTNO2, f.LINE2]).toEqual(['TT-45K', 'Fuel tanker 45 000 L', 'BLK-KIT', 'Bottom-loading kit']);
    expect(f.PARTNO3).toBe('');
    expect(f.LINE8).toBe('');
    expect(f.Total).toBe('486750');
  });

  it('takes only the first 8 lines and rounds a total with cents', () => {
    const lines = Array.from({ length: 10 }, (_, i) => line(i + 1, `P${i + 1}`, `Line ${i + 1}`));
    const { target, linesImported } = dealFieldsFromQuote({ total: 1234.5 }, lines);
    expect(linesImported).toBe(8);
    const f = dealImportFields(target);
    expect(f.PARTNO8).toBe('P8');
    expect(Object.keys(f)).not.toContain('PARTNO9');
    expect(f.Total).toBe('1235');
  });

  it('leaves Total out when the quote has none', () => {
    expect(dealImportFields(dealFieldsFromQuote({ total: null }, []).target).Total).toBeUndefined();
  });
});
