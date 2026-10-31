import { describe, expect, it } from 'vitest';
import { STOCK_LOCATIONS, STOCK_MODELS } from '@/lib/stock/models';
import {
  detectDelimiter, lineList, matchLocation, OPENING_MAX_ROWS, OPENING_TEMPLATE_HEADER, openingReport, parseCsv, parseDispatchDate,
  parseOpeningCsv, planOpening, unitInsert, type ExistingUnit,
} from '@/lib/stock/opening';

// Synthetic VINs and invoice numbers only.
const CTX = { models: STOCK_MODELS.map((m) => m.partNumber), locations: STOCK_LOCATIONS.map((l) => ({ id: l.id, name: l.name })) };
const HEAD = 'VIN,Model,Location,Status,Invoice,Deal year,Sequence,Dispatch date,Notes';
const csv = (...rows: string[]) => [HEAD, ...rows].join('\r\n');

describe('parseCsv', () => {
  it('reads quoted fields with commas, escaped quotes and line breaks, and keeps start line numbers', () => {
    const recs = parseCsv('a,b,c\n1,"x, y","say ""hi"""\n2,"multi\nline",z\n\n3,,\n');
    expect(recs).toEqual([
      { line: 1, cells: ['a', 'b', 'c'] },
      { line: 2, cells: ['1', 'x, y', 'say "hi"'] },
      { line: 3, cells: ['2', 'multi\nline', 'z'] },
      { line: 6, cells: ['3', '', ''] },
    ]);
  });

  it('handles CRLF, a BOM, a last line without a newline and blank records', () => {
    expect(parseCsv('﻿a,b\r\n\r\n1,2')).toEqual([{ line: 1, cells: ['a', 'b'] }, { line: 3, cells: ['1', '2'] }]);
    expect(parseCsv(',,\n')).toEqual([]);
  });

  it('detects a semicolon delimiter from the header', () => {
    expect(detectDelimiter('VIN;Model;Location')).toBe(';');
    expect(detectDelimiter('VIN,Model;x,y')).toBe(',');
    expect(parseCsv('a;b\n"1;2";3')).toEqual([{ line: 1, cells: ['a', 'b'] }, { line: 2, cells: ['1;2', '3'] }]);
  });
});

describe('field parsing', () => {
  it('dates: ISO, slashes, day first; rejects impossible dates', () => {
    expect(parseDispatchDate('2026-03-01')).toBe('2026-03-01');
    expect(parseDispatchDate('2026/3/1')).toBe('2026-03-01');
    expect(parseDispatchDate('01/03/2026')).toBe('2026-03-01');
    expect(parseDispatchDate('31/02/2026')).toBeNull();
    expect(parseDispatchDate('2026-13-01')).toBeNull();
    expect(parseDispatchDate('1999-01-01')).toBeNull();
    expect(parseDispatchDate('March 1')).toBeNull();
  });

  it('locations by id, DEAL code or name, any case', () => {
    expect(matchLocation('cpt', CTX.locations)).toBe('CPT');
    expect(matchLocation('DUR', CTX.locations)).toBe('DBN');
    expect(matchLocation(' cape town ', CTX.locations)).toBe('CPT');
    expect(matchLocation('Factory', CTX.locations)).toBe('FACTORY');
    expect(matchLocation('Pretoria', CTX.locations)).toBeNull();
    expect(matchLocation('', CTX.locations)).toBeNull();
  });

  it('lineList shortens long lists', () => {
    expect(lineList([2, 3])).toBe('2, 3');
    expect(lineList([1, 2, 3, 4], 2)).toBe('1, 2 and 2 more');
  });
});

describe('parseOpeningCsv', () => {
  it('the template header maps to every column', () => {
    expect(OPENING_TEMPLATE_HEADER).toBe(HEAD);
    const p = parseOpeningCsv(csv('testvin 0000000001,3000d,jhb,Available,,,,,'), CTX);
    expect(p.missingColumns).toEqual([]);
    expect(p.rows).toHaveLength(1);
  });

  it('normalises VIN, model, location, status, invoice and dates', () => {
    const p = parseOpeningCsv(csv(' testvin 0000000001 ,ctll 3d,Cape Town,RESERVED, inv-0042 ,2026,260,01/03/2026,Synthetic note'), CTX);
    expect(p.errors).toEqual([]);
    expect(p.rows).toEqual([{
      line: 2, vin: 'TESTVIN0000000001', model: 'CTLL3D', location: 'CPT', status: 'reserved', invoice: 'INV-0042',
      dealYear: 2026, sequence: 260, dispatchDate: '2026-03-01', notes: 'Synthetic note',
    }]);
  });

  it('header aliases, any order, semicolons; optional columns may be missing', () => {
    const p = parseOpeningCsv('Status;Branch;Part number;VIN number\nsold;DBN;500D;TESTVIN0000000009', CTX);
    expect(p.missingColumns).toEqual([]);
    expect(p.rows[0]).toMatchObject({ vin: 'TESTVIN0000000009', model: '500D', location: 'DBN', status: 'sold', invoice: null, dealYear: null });
    expect(p.noInvoiceLines).toEqual([2]);
  });

  it('reports missing required columns and an empty file', () => {
    expect(parseOpeningCsv('VIN,Notes\nTESTVIN0000000001,x', CTX).missingColumns).toEqual(['model', 'location', 'status']);
    expect(parseOpeningCsv('', CTX).missingColumns).toEqual(['vin', 'model', 'location', 'status']);
  });

  it('refuses more rows than the limit', () => {
    const rows = Array.from({ length: OPENING_MAX_ROWS + 1 }, (_, i) => `TESTVIN${String(i).padStart(10, '0')},3000D,JHB,available`);
    const p = parseOpeningCsv(['VIN,Model,Location,Status', ...rows].join('\n'), CTX);
    expect(p.tooManyRows).toBe(true);
    expect(p.rows).toEqual([]);
  });

  it('lists errors by line number without echoing values (VIN and model only)', () => {
    const p = parseOpeningCsv(csv(
      'ABC,3000D,JHB,available,,,,,',                        // 2: VIN too short
      'TESTVIN0000000002,NOPE-1,JHB,available,,,,,',         // 3: unknown model
      'TESTVIN0000000003,3000D,Pretoria,available,,,,,',     // 4: unknown location
      'TESTVIN0000000004,3000D,JHB,on hold,,,,,',            // 5: bad status
      'TESTVIN0000000005,3000D,JHB,available,,2026,,,',      // 6: year without sequence
      'TESTVIN0000000006,3000D,JHB,available,,20x6,0,,',     // 7: bad year, bad sequence
      'TESTVIN0000000007,3000D,JHB,available,,,,31/02/2026,', // 8: bad date
      ',3000D,JHB,available,,,,,',                           // 9: VIN missing
      `TESTVIN0000000010,3000D,JHB,available,,,,,${'n'.repeat(2001)}`, // 10: notes too long
      'TESTVIN0000000011,,,,,,,,',                            // 11: model, location, status missing
    ), CTX);
    expect(p.rows).toEqual([]);
    const byLine = (l: number) => p.errors.filter((e) => e.line === l).map((e) => e.field);
    expect(byLine(2)).toEqual(['vin']);
    expect(byLine(3)).toEqual(['model']);
    expect(byLine(4)).toEqual(['location']);
    expect(byLine(5)).toEqual(['status']);
    expect(byLine(6)).toEqual(['row']);
    expect(byLine(7)).toEqual(['deal_year', 'sequence']);
    expect(byLine(8)).toEqual(['dispatch_date']);
    expect(byLine(9)).toEqual(['vin']);
    expect(byLine(10)).toEqual(['notes']);
    expect(byLine(11)).toEqual(['model', 'location', 'status']);
    expect(p.unknownModels).toEqual([{ model: 'NOPE-1', lines: [3] }]);
    expect(p.unknownLocationLines).toEqual([4]);
    for (const e of p.errors) {
      expect(e.message).not.toContain('Pretoria');
      expect(e.message).not.toContain('on hold');
      expect(e.message).not.toContain('nnnn');
    }
  });

  it('flags VINs and invoice numbers repeated in the file (all their lines)', () => {
    const p = parseOpeningCsv(csv(
      'TESTVIN0000000001,3000D,JHB,available,,,,,',
      'testvin 0000000001,2000D,CPT,available,,,,,',
      'TESTVIN0000000002,3000D,JHB,reserved,INV-1,,,,',
      'TESTVIN0000000003,3000D,JHB,reserved,inv-1,,,,',
      'TESTVIN0000000004,3000D,JHB,available,,,,,',
    ), CTX);
    expect(p.duplicates).toEqual([{ vin: 'TESTVIN0000000001', lines: [2, 3] }]);
    expect(p.duplicateInvoiceLines).toEqual([4, 5]);
    expect(p.rows.map((r) => r.line)).toEqual([6]);
  });
});

describe('planOpening and the report', () => {
  const existing: ExistingUnit[] = [
    { vin_norm: 'TESTVIN0000000001', model_part: '3000D', location_id: 'JHB', status: 'available', invoice_number: null },
    { vin_norm: 'TESTVIN0000000002', model_part: '3000D', location_id: 'JHB', status: 'sold', invoice_number: 'INV-9' },
    { vin_norm: 'TESTVIN0000000003', model_part: '1000D', location_id: 'CPT', status: 'reserved', invoice_number: 'INV-7' },
  ];

  it('is idempotent by VIN: registered VINs are left unchanged (and said whether they differ)', () => {
    const p = parseOpeningCsv(csv(
      'TESTVIN0000000001,3000D,JHB,available,,,,,',  // same
      'TESTVIN0000000002,3000D,CPT,available,,,,,',  // differs
      'TESTVIN0000000004,2000D,DBN,available,,,,,',  // new
    ), CTX);
    const plan = planOpening(p, existing);
    expect(plan.insert.map((r) => r.vin)).toEqual(['TESTVIN0000000004']);
    expect(plan.existing).toEqual([{ line: 2, vin: 'TESTVIN0000000001', same: true }, { line: 3, vin: 'TESTVIN0000000002', same: false }]);
    const report = openingReport(p, plan);
    expect(report).toMatchObject({ totalRows: 3, toInsert: 1, alreadyRegistered: 2, differing: 1, differingVins: ['TESTVIN0000000002'], errorCount: 0, canApply: true });
    // Applying again: everything is registered, nothing to insert.
    const again = openingReport(p, planOpening(p, [...existing, { vin_norm: 'TESTVIN0000000004', model_part: '2000D', location_id: 'DBN', status: 'available', invoice_number: null }]));
    expect(again).toMatchObject({ toInsert: 0, alreadyRegistered: 3, canApply: false });
  });

  it('an invoice number already on another unit is a conflict that blocks apply', () => {
    const p = parseOpeningCsv(csv('TESTVIN0000000005,3000D,JHB,reserved,inv-7,,,,', 'TESTVIN0000000006,3000D,JHB,available,,,,,'), CTX);
    const report = openingReport(p, planOpening(p, existing));
    expect(report.invoiceConflicts).toEqual([{ line: 2, vin: 'TESTVIN0000000005' }]);
    expect(report).toMatchObject({ toInsert: 1, errorCount: 1, canApply: false });
  });

  it('any error blocks apply, even with valid new rows', () => {
    const p = parseOpeningCsv(csv('TESTVIN0000000007,3000D,JHB,available,,,,,', 'TESTVIN0000000008,3000D,JHB,maybe,,,,,'), CTX);
    const report = openingReport(p, planOpening(p, existing));
    expect(report).toMatchObject({ toInsert: 1, errorCount: 1, canApply: false });
    expect(report.errors).toEqual([{ line: 3, field: 'status', message: 'Status must be available, reserved or sold.' }]);
  });

  it('missing columns block apply', () => {
    const p = parseOpeningCsv('VIN\nTESTVIN0000000001', CTX);
    expect(openingReport(p, planOpening(p, []))).toMatchObject({ missingColumns: ['Model', 'Location', 'Status'], canApply: false });
  });

  it('unitInsert sets org and creator from the server and sold_at only for sold units', () => {
    const p = parseOpeningCsv(csv('TESTVIN0000000009,3000D,JHB,sold,INV-10,2026,12,2026-02-01,', 'TESTVIN0000000010,3000D,FACTORY,available,,,,,'), CTX);
    const [sold, avail] = p.rows.map((r) => unitInsert(r, 'org-1', 'user-1', '2026-10-30T00:00:00.000Z'));
    expect(sold).toEqual({
      org_id: 'org-1', vin: 'TESTVIN0000000009', model_part: '3000D', location_id: 'JHB', status: 'sold', invoice_number: 'INV-10',
      deal_year: 2026, sequence: 12, dispatch_date: '2026-02-01', notes: null, sold_at: '2026-10-30T00:00:00.000Z', created_by: 'user-1',
    });
    expect(avail).toMatchObject({ location_id: 'FACTORY', status: 'available', sold_at: null, invoice_number: null });
  });
});

describe('item 9: VIN characters', () => {
  it('a VIN must be letters and digits only after normalising', () => {
    const p = parseOpeningCsv(csv('TESTVIN-000000001,3000D,JHB,available,,,,,', 'TEST VIN 000000002,3000D,JHB,available,,,,,', 'TESTVIN/0000003,3000D,JHB,available,,,,,'), CTX);
    expect(p.errors.map((e) => [e.line, e.field])).toEqual([[2, 'vin'], [4, 'vin']]);
    expect(p.errors[0].message).toBe('VIN may contain only letters and digits.');
    expect(p.rows.map((r) => r.vin)).toEqual(['TESTVIN000000002']);
  });
});
