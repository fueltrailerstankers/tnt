// Stock KPIs and the model x branch matrix (stock plan 5.2 / 7.1). Pure.
// Inputs are database row shapes: stock_locations rows and stock_matrix view rows (or units folded into the same
// shape with cellsFromUnits). Sold units are excluded from every count; they stay searchable in the register.

export const UNIT_STATUSES = ['available', 'reserved', 'sold'] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];

export interface LocationRow {
  id: string;
  name: string;
  is_factory: boolean;
  sort_order: number;
}

/** One stock_matrix row: a model at a location (location_id null = model with no unsold units). */
export interface MatrixCellRow {
  part_number: string;
  description: string;
  sort_order: number;
  active: boolean;
  location_id: string | null;
  /** available + reserved */
  qty: number;
  reserved: number;
}

export interface UnitCountRow {
  model_part: string;
  location_id: string;
  status: UnitStatus;
}

export interface StockKpis {
  /** Units at a branch (not the Factory) that are available or reserved. */
  stockAcrossBranches: number;
  /** Of those, reserved: "Includes N reserved". */
  branchReserved: number;
  /** Branch units that are available. */
  readyToSell: number;
  /** All reserved units, wherever they are: "Awaiting full payment". */
  reserved: number;
  /** Units at the Factory that are not sold: "Not in branch quantities". */
  atFactory: number;
}

type CountCell = Pick<MatrixCellRow, 'location_id' | 'qty' | 'reserved'>;

/** Folds unit rows into matrix cells (sold units dropped), for callers that read units directly. */
export function cellsFromUnits(
  units: readonly UnitCountRow[],
  models: readonly Pick<MatrixCellRow, 'part_number' | 'description' | 'sort_order' | 'active'>[],
): MatrixCellRow[] {
  const byKey = new Map<string, MatrixCellRow>();
  const model = new Map(models.map((m) => [m.part_number, m]));
  for (const u of units) {
    if (u.status === 'sold') continue;
    const m = model.get(u.model_part) ?? { part_number: u.model_part, description: u.model_part, sort_order: Number.MAX_SAFE_INTEGER, active: false };
    const key = `${u.model_part}\u0000${u.location_id}`;
    const cell = byKey.get(key) ?? { ...m, location_id: u.location_id, qty: 0, reserved: 0 };
    cell.qty += 1;
    if (u.status === 'reserved') cell.reserved += 1;
    byKey.set(key, cell);
  }
  const out = [...byKey.values()];
  for (const m of models) {
    if (!out.some((c) => c.part_number === m.part_number)) out.push({ ...m, location_id: null, qty: 0, reserved: 0 });
  }
  return out;
}

export function stockKpis(cells: readonly CountCell[], locations: readonly LocationRow[]): StockKpis {
  const loc = new Map(locations.map((l) => [l.id, l]));
  const k: StockKpis = { stockAcrossBranches: 0, branchReserved: 0, readyToSell: 0, reserved: 0, atFactory: 0 };
  for (const c of cells) {
    const l = c.location_id ? loc.get(c.location_id) : undefined;
    if (!l) continue;
    k.reserved += c.reserved;
    if (l.is_factory) {
      k.atFactory += c.qty;
    } else {
      k.stockAcrossBranches += c.qty;
      k.branchReserved += c.reserved;
      k.readyToSell += c.qty - c.reserved;
    }
  }
  return k;
}

export interface MatrixCell {
  qty: number;
  reserved: number;
  /** Amber marker: the count includes reserved units. */
  amber: boolean;
}

export interface MatrixRow {
  partNumber: string;
  description: string;
  /** Keyed by branch location id; every branch is present. */
  cells: Record<string, MatrixCell>;
  total: number;
  reserved: number;
  amber: boolean;
}

export interface Matrix {
  /** Branch columns in display order (the Factory is not a column). */
  branches: LocationRow[];
  rows: MatrixRow[];
  /** Rows shown after the "In stock only" filter. */
  shown: number;
  /** Models listed before the filter: "N of {total} models". */
  total: number;
}

const bySort = <T extends { sort_order: number }>(a: T, b: T, ka: string, kb: string) => a.sort_order - b.sort_order || ka.localeCompare(kb);

/**
 * Stock by model: one row per model, one column per branch plus Total. Active models are always listed; an
 * inactive model only while it still has branch stock. inStockOnly hides rows whose branch total is zero.
 */
export function buildMatrix(cells: readonly MatrixCellRow[], locations: readonly LocationRow[], opts: { inStockOnly?: boolean } = {}): Matrix {
  const branches = locations.filter((l) => !l.is_factory).sort((a, b) => bySort(a, b, a.id, b.id));
  const branchIds = new Set(branches.map((b) => b.id));
  const rows = new Map<string, MatrixRow & { sort_order: number; active: boolean }>();
  for (const c of cells) {
    let row = rows.get(c.part_number);
    if (!row) {
      row = {
        partNumber: c.part_number, description: c.description, sort_order: c.sort_order, active: c.active,
        cells: Object.fromEntries(branches.map((b) => [b.id, { qty: 0, reserved: 0, amber: false }])),
        total: 0, reserved: 0, amber: false,
      };
      rows.set(c.part_number, row);
    }
    if (!c.location_id || !branchIds.has(c.location_id)) continue;
    const cell = row.cells[c.location_id];
    cell.qty += c.qty;
    cell.reserved += c.reserved;
    cell.amber = cell.reserved > 0;
    row.total += c.qty;
    row.reserved += c.reserved;
    row.amber = row.reserved > 0;
  }
  const listed = [...rows.values()]
    .filter((r) => r.active || r.total > 0)
    .sort((a, b) => bySort(a, b, a.partNumber, b.partNumber));
  const shownRows = opts.inStockOnly ? listed.filter((r) => r.total > 0) : listed;
  return {
    branches,
    rows: shownRows.map((r) => ({ partNumber: r.partNumber, description: r.description, cells: r.cells, total: r.total, reserved: r.reserved, amber: r.amber })),
    shown: shownRows.length,
    total: listed.length,
  };
}

/** Matrix cell text: the count, or an em dash for zero. */
export function cellLabel(n: number): string {
  return n > 0 ? String(n) : '—';
}

/** Footer: "12 of 52 models". */
export function matrixFooter(m: Pick<Matrix, 'shown' | 'total'>): string {
  return `${m.shown} of ${m.total} models`;
}

export interface DealCountRow {
  year: number;
  location_id: string | null;
  status: 'awaiting_dispatch' | 'dispatched' | 'dismissed';
}

/** Deals page KPIs: deals awaiting dispatch in the year, for all branches and per branch. */
export function outstandingDeals(deals: readonly DealCountRow[], year: number, locations: readonly LocationRow[]): { all: number; byBranch: Record<string, number> } {
  const byBranch: Record<string, number> = Object.fromEntries(locations.filter((l) => !l.is_factory).map((l) => [l.id, 0]));
  let all = 0;
  for (const d of deals) {
    if (d.year !== year || d.status !== 'awaiting_dispatch') continue;
    all += 1;
    if (d.location_id && d.location_id in byBranch) byBranch[d.location_id] += 1;
  }
  return { all, byBranch };
}
