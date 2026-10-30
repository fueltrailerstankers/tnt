import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LocationRow } from './kpi';
import {
  ALL_BRANCHES, EXPORT_CHUNK, EXPORT_MAX_ROWS, parseRegisterSearch, registerOrFilter, sortNewestFirst, statusesFor, UNIT_COLUMNS,
  type RegisterQuery, type UnitRow,
} from './register';

// Register reads through the caller's RLS-scoped client (stock.read roles may select stock_units).
// Loaders report a failed read (`error: true`) instead of returning an empty list: an empty location list would
// silently drop the location filter of the register and the export.

export interface Loaded<T> { data: T[]; error: boolean }

export async function loadLocations(db: SupabaseClient, orgId: string): Promise<Loaded<LocationRow>> {
  const { data, error } = await db.from('stock_locations').select('id, name, is_factory, sort_order').eq('org_id', orgId).order('sort_order');
  return { data: (data ?? []) as LocationRow[], error: !!error };
}

export interface ModelOption { part_number: string; description: string; active: boolean }

export async function loadModels(db: SupabaseClient, orgId: string): Promise<Loaded<ModelOption>> {
  const { data, error } = await db.from('stock_models').select('part_number, description, active').eq('org_id', orgId).order('sort_order');
  return { data: (data ?? []) as ModelOption[], error: !!error };
}

/** The filter methods withFilters uses (PostgREST filter builders return `this`). */
interface Filterable<Self> {
  eq(column: string, value: string | number): Self;
  in(column: string, values: readonly string[]): Self;
  or(filters: string): Self;
}

/** The register filters (search, model, location, status) on a stock_units query of the org. */
function withFilters<Q extends Filterable<Q>>(query: Q, rq: RegisterQuery, locations: readonly LocationRow[]): Q {
  let q = query;
  const s = parseRegisterSearch(rq.q);
  if (s.kind === 'deal') q = q.eq('deal_year', s.year).eq('sequence', s.sequence);
  else if (s.kind === 'text') q = q.or(registerOrFilter(s));
  if (rq.model) q = q.eq('model_part', rq.model);
  if (rq.location === ALL_BRANCHES) q = q.in('location_id', locations.filter((l) => !l.is_factory).map((l) => l.id));
  else if (rq.location) q = q.eq('location_id', rq.location);
  if (rq.status) {
    const st = statusesFor(rq.status);
    q = st.length === 1 ? q.eq('status', st[0]) : q.in('status', st);
  }
  return q;
}

/** One register page (newest first). `range` is inclusive, as PostgREST's. */
export async function selectUnits(
  db: SupabaseClient, orgId: string, rq: RegisterQuery, locations: readonly LocationRow[],
  opts: { from: number; to: number; count?: boolean },
): Promise<{ rows: UnitRow[]; count: number | null; error: boolean }> {
  const base = db.from('stock_units').select(UNIT_COLUMNS, opts.count ? { count: 'exact' } : undefined).eq('org_id', orgId);
  const { data, count, error } = await withFilters(base, rq, locations)
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(opts.from, opts.to);
  return { rows: (data ?? []) as unknown as UnitRow[], count: count ?? null, error: !!error };
}

/** How many units the filter selects; null when the read failed. */
export async function countUnits(db: SupabaseClient, orgId: string, rq: RegisterQuery, locations: readonly LocationRow[]): Promise<number | null> {
  const base = db.from('stock_units').select('id', { count: 'exact', head: true }).eq('org_id', orgId);
  const { count, error } = await withFilters(base, rq, locations);
  return error || count === null || count === undefined ? null : count;
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

export type ExportRead =
  | { kind: 'ok'; rows: UnitRow[] }
  | { kind: 'too_many'; count: number }
  | { kind: 'error' };

/**
 * Every unit of the filter for the CSV, newest first. Counts first and refuses above `max` (never a silently cut
 * file). Reads in chunks with an id keyset (id > last id seen, ascending), which neither repeats nor skips a row
 * when units are added or changed between chunks, as offset paging over "newest first" would; then sorts in memory.
 */
export async function readExport(
  db: SupabaseClient, orgId: string, rq: RegisterQuery, locations: readonly LocationRow[],
  opts: { max?: number; chunk?: number } = {},
): Promise<ExportRead> {
  const max = opts.max ?? EXPORT_MAX_ROWS;
  const chunk = opts.chunk ?? EXPORT_CHUNK;
  const count = await countUnits(db, orgId, rq, locations);
  if (count === null) return { kind: 'error' };
  if (count > max) return { kind: 'too_many', count };

  const rows: UnitRow[] = [];
  let after = NIL_UUID;   // below every generated id
  for (;;) {
    const page$ = db.from('stock_units').select(UNIT_COLUMNS).eq('org_id', orgId).gt('id', after);
    const { data, error } = await withFilters(page$, rq, locations).order('id', { ascending: true }).limit(chunk);
    if (error) return { kind: 'error' };
    const page = (data ?? []) as unknown as UnitRow[];
    rows.push(...page);
    if (rows.length > max) return { kind: 'too_many', count: rows.length };   // units added since the count
    if (page.length < chunk) break;
    after = page[page.length - 1].id;
  }
  return { kind: 'ok', rows: sortNewestFirst(rows) };
}

/** One unit of the caller's org, or null (unknown id, another org, or no access). */
export async function loadUnit(db: SupabaseClient, orgId: string, id: string): Promise<UnitRow | null> {
  const { data } = await db.from('stock_units').select(UNIT_COLUMNS).eq('org_id', orgId).eq('id', id).maybeSingle();
  return (data ?? null) as UnitRow | null;
}
