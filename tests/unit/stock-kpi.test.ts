import { describe, expect, it } from 'vitest';
import {
  buildMatrix, cellLabel, cellsFromUnits, matrixFooter, outstandingDeals, stockKpis,
  type LocationRow, type MatrixCellRow, type UnitCountRow,
} from '@/lib/stock/kpi';

const LOCATIONS: LocationRow[] = [
  { id: 'DBN', name: 'Durban', is_factory: false, sort_order: 3 },
  { id: 'FACTORY', name: 'Factory', is_factory: true, sort_order: 0 },
  { id: 'JHB', name: 'Johannesburg', is_factory: false, sort_order: 1 },
  { id: 'CPT', name: 'Cape Town', is_factory: false, sort_order: 2 },
];
const MODELS = [
  { part_number: '3000D', description: '3000 litre metal bowser', sort_order: 14, active: true },
  { part_number: '1000D', description: '1000 litre metal bowser', sort_order: 10, active: true },
  { part_number: 'CTLL1', description: '3 meter animal trailer NO BRAKES 750 KGS GWM', sort_order: 1, active: true },
  { part_number: 'OLD1', description: 'Retired model', sort_order: 99, active: false },
];
const UNITS: UnitCountRow[] = [
  { model_part: '3000D', location_id: 'JHB', status: 'available' },
  { model_part: '3000D', location_id: 'JHB', status: 'reserved' },
  { model_part: '3000D', location_id: 'CPT', status: 'available' },
  { model_part: '3000D', location_id: 'DBN', status: 'sold' },
  { model_part: '1000D', location_id: 'DBN', status: 'available' },
  { model_part: '1000D', location_id: 'FACTORY', status: 'available' },
  { model_part: '1000D', location_id: 'FACTORY', status: 'reserved' },
  { model_part: '1000D', location_id: 'FACTORY', status: 'sold' },
];

describe('stockKpis', () => {
  it('counts branch stock incl. reserved, ready to sell, reserved anywhere and factory stock; sold excluded', () => {
    const k = stockKpis(cellsFromUnits(UNITS, MODELS), LOCATIONS);
    expect(k).toEqual({ stockAcrossBranches: 4, branchReserved: 1, readyToSell: 3, reserved: 2, atFactory: 2 });
  });
  it('is all zero without units', () => {
    expect(stockKpis(cellsFromUnits([], MODELS), LOCATIONS)).toEqual({ stockAcrossBranches: 0, branchReserved: 0, readyToSell: 0, reserved: 0, atFactory: 0 });
  });
});

describe('buildMatrix', () => {
  const cells = cellsFromUnits(UNITS, MODELS);

  it('has one column per branch in order, no Factory column, and rows in model order', () => {
    const m = buildMatrix(cells, LOCATIONS);
    expect(m.branches.map((b) => b.id)).toEqual(['JHB', 'CPT', 'DBN']);
    expect(m.rows.map((r) => r.partNumber)).toEqual(['CTLL1', '1000D', '3000D']); // OLD1 inactive, no stock
    expect(m.total).toBe(3);
    expect(m.shown).toBe(3);
  });

  it('counts available + reserved per branch with the amber marker when reserved are included', () => {
    const row = buildMatrix(cells, LOCATIONS).rows.find((r) => r.partNumber === '3000D')!;
    expect(row.cells.JHB).toEqual({ qty: 2, reserved: 1, amber: true });
    expect(row.cells.CPT).toEqual({ qty: 1, reserved: 0, amber: false });
    expect(row.cells.DBN).toEqual({ qty: 0, reserved: 0, amber: false }); // sold excluded
    expect(row.total).toBe(3);
    expect(row.amber).toBe(true);
  });

  it('keeps factory stock out of branch columns and totals', () => {
    const row = buildMatrix(cells, LOCATIONS).rows.find((r) => r.partNumber === '1000D')!;
    expect(row.total).toBe(1);
    expect(row.amber).toBe(false);
  });

  it('"In stock only" hides models with no branch stock; the footer counts shown of listed', () => {
    const m = buildMatrix(cells, LOCATIONS, { inStockOnly: true });
    expect(m.rows.map((r) => r.partNumber)).toEqual(['1000D', '3000D']);
    expect(matrixFooter(m)).toBe('2 of 3 models');
  });

  it('lists an inactive model while it still has branch stock', () => {
    const extra: MatrixCellRow[] = [...cells, { part_number: 'OLD1', description: 'Retired model', sort_order: 99, active: false, location_id: 'CPT', qty: 1, reserved: 0 }];
    expect(buildMatrix(extra, LOCATIONS).rows.map((r) => r.partNumber)).toContain('OLD1');
  });

  it('accepts stock_matrix view rows directly', () => {
    const view: MatrixCellRow[] = [
      { part_number: '3000D', description: 'x', sort_order: 1, active: true, location_id: 'JHB', qty: 5, reserved: 2 },
      { part_number: '3000D', description: 'x', sort_order: 1, active: true, location_id: 'FACTORY', qty: 4, reserved: 0 },
      { part_number: 'CT1', description: 'y', sort_order: 2, active: true, location_id: null, qty: 0, reserved: 0 },
    ];
    const m = buildMatrix(view, LOCATIONS);
    expect(m.rows.map((r) => [r.partNumber, r.total])).toEqual([['3000D', 5], ['CT1', 0]]);
    expect(stockKpis(view, LOCATIONS)).toEqual({ stockAcrossBranches: 5, branchReserved: 2, readyToSell: 3, reserved: 2, atFactory: 4 });
  });
});

describe('labels and deal KPIs', () => {
  it('shows an em dash for zero', () => {
    expect(cellLabel(0)).toBe('—');
    expect(cellLabel(3)).toBe('3');
  });

  it('counts deals awaiting dispatch in the year, per branch', () => {
    const r = outstandingDeals([
      { year: 2026, location_id: 'JHB', status: 'awaiting_dispatch' },
      { year: 2026, location_id: 'JHB', status: 'awaiting_dispatch' },
      { year: 2026, location_id: 'CPT', status: 'dismissed' },
      { year: 2026, location_id: 'DBN', status: 'dispatched' },
      { year: 2025, location_id: 'DBN', status: 'awaiting_dispatch' },
      { year: 2026, location_id: null, status: 'awaiting_dispatch' },
    ], 2026, LOCATIONS);
    expect(r).toEqual({ all: 3, byBranch: { DBN: 0, JHB: 2, CPT: 0 } });
  });
});
