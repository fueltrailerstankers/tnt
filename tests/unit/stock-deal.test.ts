import { describe, expect, it } from 'vitest';
import { dealFromEntry, dealLocation, dealYear, detectModel, johannesburgYear } from '@/lib/stock/deal';
import { STOCK_MODELS } from '@/lib/stock/models';

// Synthetic DEAL data only (no customer fields: they never reach stock).
const PARTS = STOCK_MODELS.map((m) => m.partNumber);
const ENTRY = { id: '00000000-0000-0000-0000-00000000de01', number: 260, created_at: '2026-03-10T08:00:00Z' };

describe('dealFromEntry', () => {
  it('maps a DEAL entry to stock deal columns', () => {
    const d = dealFromEntry({
      DATECREATED: '2026-03-09',
      COLLECTIONLOCATION: ['CPT'],
      QUOTENO: ' SAMPLE-Q-260 ',
      PARTNO1: 'hose', LINE1: 'Sample hose reel',
      PARTNO2: ' 1000 db', LINE2: '1000 litre metal bowser',
      PARTNO3: '', LINE3: 'Sample spare wheel',
      LINE4: '   ',
    }, ENTRY, PARTS);
    expect(d).toEqual({
      entry_id: ENTRY.id,
      year: 2026,
      number: 260,
      location_id: 'CPT',
      model_part: '1000DB',
      quote_number: 'SAMPLE-Q-260',
      accessories: ['Sample hose reel', 'Sample spare wheel'],
    });
  });

  it('maps DUR to DBN and JHB/CPT as is, taking the first known location', () => {
    expect(dealLocation(['DUR'])).toBe('DBN');
    expect(dealLocation(['JHB', 'CPT'])).toBe('JHB');
    expect(dealLocation(['XYZ', ' cpt '])).toBe('CPT');
    expect(dealLocation('DUR')).toBe('DBN');
    expect(dealLocation([])).toBeNull();
    expect(dealLocation(undefined)).toBeNull();
  });

  it('detects the model on the first matching PARTNO1..8, case and space insensitive', () => {
    expect(detectModel({ PARTNO5: 'ctll 3d', PARTNO7: '3000D' }, PARTS)).toEqual({ modelPart: 'CTLL3D', line: 5 });
    expect(detectModel({ PARTNO8: '3000d' }, PARTS)).toEqual({ modelPart: '3000D', line: 8 });
    expect(detectModel({ PARTNO9: '3000D' }, PARTS)).toEqual({ modelPart: null, line: null });
  });

  it('leaves the model null (Model not recognised) and keeps every line as an accessory when nothing matches', () => {
    const d = dealFromEntry({ DATECREATED: '2026-01-02', PARTNO1: 'UNKNOWN', LINE1: 'Mystery trailer', LINE2: 'Sample jockey wheel' }, ENTRY, PARTS);
    expect(d.model_part).toBeNull();
    expect(d.accessories).toEqual(['Mystery trailer', 'Sample jockey wheel']);
    expect(d.location_id).toBeNull();
    expect(d.quote_number).toBeNull();
  });

  it('keeps at most 10 accessories of at most 200 characters', () => {
    const data: Record<string, unknown> = { DATECREATED: '2026-01-02' };
    for (let i = 1; i <= 8; i++) data[`LINE${i}`] = `Line ${i} ${'x'.repeat(250)}`;
    const d = dealFromEntry(data, ENTRY, PARTS);
    expect(d.accessories).toHaveLength(8);
    expect(d.accessories.every((a) => a.length === 200)).toBe(true);
  });
});

describe('deal year', () => {
  it('takes the year of DATE CREATED', () => {
    expect(dealYear('2025-12-31', '2026-01-05T10:00:00Z')).toBe(2025);
  });

  it('reads a full timestamp in Africa/Johannesburg', () => {
    // 22:30 UTC on 31 Dec is 00:30 on 1 Jan in Johannesburg (UTC+2).
    expect(dealYear('2025-12-31T22:30:00Z', '2026-02-01T00:00:00Z')).toBe(2026);
  });

  it('falls back to the entry created date in Africa/Johannesburg', () => {
    expect(dealYear(undefined, '2025-12-31T22:30:00Z')).toBe(2026);
    expect(dealYear('', '2025-12-31T21:59:00Z')).toBe(2025);
    expect(dealYear('not a date', '2024-06-01T00:00:00Z')).toBe(2024);
    expect(dealYear('1899-01-01', '2024-06-01T00:00:00Z')).toBe(2024);
  });

  it('throws when neither date is usable', () => {
    expect(() => dealYear(null, 'garbage')).toThrow();
    expect(johannesburgYear('garbage')).toBeNull();
  });
});
