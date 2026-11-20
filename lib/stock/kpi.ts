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
  /** Units at the Factory (not sold). Shown in its own column, never part of `total`. */
  factory: MatrixCell;
  /** Total at branches: the branch cells only. */
  total: number;
  reserved: number;
  amber: boolean;
}

export interface Matrix {
  /** Branch columns in display order. */
  branches: LocationRow[];
  /** The Factory column (after the branches), or null when the org has no factory location. */
  factory: LocationRow | null;
  rows: MatrixRow[];
  /** Rows shown after the search and "In stock only" filters. */
  shown: number;
  /** Models listed before the filters: "N of {total} models". */
  total: number;
}

export interface MatrixOptions {
  /** Keep only models with stock at a branch or the Factory. */
  inStockOnly?: boolean;
  /** Model search: part number or description contains the text (case-insensitive, trimmed). */
  q?: string;
}

const bySort = <T extends { sort_order: number }>(a: T, b: T, ka: string, kb: string) => a.sort_order - b.sort_order || ka.localeCompare(kb);

/** The overview's model search, normalised: trimmed, lower case, inner whitespace collapsed. Empty = no search. */
export function normalizeModelSearch(q: string | null | undefined): string {
  return (q ?? '').trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 100);
}

/** Does a model match the overview search (part number or description contains it)? */
export function modelMatches(m: { partNumber: string; description: string }, q: string): boolean {
  const n = normalizeModelSearch(q);
  if (!n) return true;
  return m.partNumber.toLowerCase().includes(n) || m.description.replace(/\s+/g, ' ').toLowerCase().includes(n);
}

const emptyCell = (): MatrixCell => ({ qty: 0, reserved: 0, amber: false });

/**
 * Stock by model: one row per model, one column per branch, then Factory, then Total at branches (the Factory is
 * never added to the total). Active models are always listed; an inactive model only while it still has stock at a
 * branch or the Factory. inStockOnly hides rows with no stock at any branch or the Factory; q filters by model.
 */
export function buildMatrix(cells: readonly MatrixCellRow[], locations: readonly LocationRow[], opts: MatrixOptions = {}): Matrix {
  const branches = locations.filter((l) => !l.is_factory).sort((a, b) => bySort(a, b, a.id, b.id));
  const factory = [...locations].filter((l) => l.is_factory).sort((a, b) => bySort(a, b, a.id, b.id))[0] ?? null;
  const branchIds = new Set(branches.map((b) => b.id));
  const rows = new Map<string, MatrixRow & { sort_order: number; active: boolean }>();
  for (const c of cells) {
    let row = rows.get(c.part_number);
    if (!row) {
      row = {
        partNumber: c.part_number, description: c.description, sort_order: c.sort_order, active: c.active,
        cells: Object.fromEntries(branches.map((b) => [b.id, emptyCell()])),
        factory: emptyCell(), total: 0, reserved: 0, amber: false,
      };
      rows.set(c.part_number, row);
    }
    if (!c.location_id) continue;
    if (factory && c.location_id === factory.id) {
      row.factory.qty += c.qty;
      row.factory.reserved += c.reserved;
      row.factory.amber = row.factory.reserved > 0;
      continue;
    }
    if (!branchIds.has(c.location_id)) continue;
    const cell = row.cells[c.location_id];
    cell.qty += c.qty;
    cell.reserved += c.reserved;
    cell.amber = cell.reserved > 0;
    row.total += c.qty;
    row.reserved += c.reserved;
    row.amber = row.reserved > 0;
  }
  const inStock = (r: MatrixRow) => r.total > 0 || r.factory.qty > 0;
  const listed = [...rows.values()]
    .filter((r) => r.active || inStock(r))
    .sort((a, b) => bySort(a, b, a.partNumber, b.partNumber));
  const q = normalizeModelSearch(opts.q);
  const shownRows = listed.filter((r) => (!opts.inStockOnly || inStock(r)) && modelMatches(r, q));
  return {
    branches,
    factory,
    rows: shownRows.map((r) => ({ partNumber: r.partNumber, description: r.description, cells: r.cells, factory: r.factory, total: r.total, reserved: r.reserved, amber: r.amber })),
    shown: shownRows.length,
    total: listed.length,
  };
}

/** The chip over the matrix: "3 branches + factory". */
export function matrixScopeLabel(m: Pick<Matrix, 'branches' | 'factory'>): string {
  const n = m.branches.length;
  return `${n} ${n === 1 ? 'branch' : 'branches'}${m.factory ? ' + factory' : ''}`;
}

/** Overview URL with its view state (?q=, ?instock=1), so a filtered view can be shared. */
export function overviewHref(view: { q?: string | null; inStockOnly?: boolean }): string {
  const p = new URLSearchParams();
  const q = (view.q ?? '').trim();
  if (q) p.set('q', q.slice(0, 100));
  if (view.inStockOnly) p.set('instock', '1');
  const s = p.toString();
  return s ? `/admin/stock?${s}` : '/admin/stock';
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
