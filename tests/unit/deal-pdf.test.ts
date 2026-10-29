import { describe, expect, it } from 'vitest';
import { dealSlipBlocks } from '@/lib/pdf/deal-slip';

describe('DEAL slip (Cognito template #3)', () => {
  it('prints only filled fields, in template order, collection one per line', () => {
    const blocks = dealSlipBlocks({ QUOTENO: 'QTEST-1', MONTH: 'MARCH', COLLECTIONLOCATION: ['JHB', 'CPT'], LINE1: 'Line one', Total: 99 });
    expect(blocks).toEqual([
      { label: 'MONTH', value: 'MARCH', wide: false },
      { label: 'COLLECTION LOCATION', value: 'JHB\nCPT', wide: true },
      { label: 'QUOTE NO', value: 'QTEST-1', wide: false },
      { label: 'LINE 1', value: 'Line one', wide: false },
    ]);
  });
  it('has no Total (the template has none)', () => {
    expect(dealSlipBlocks({ Total: 1 })).toEqual([]);
  });
});
