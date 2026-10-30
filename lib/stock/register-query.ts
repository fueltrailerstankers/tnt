import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LocationRow } from './kpi';
import { ALL_BRANCHES, parseRegisterSearch, registerOrFilter, statusesFor, UNIT_COLUMNS, type RegisterQuery, type UnitRow } from './register';

// Register reads through the caller's RLS-scoped client (stock.read roles may select stock_units).

export async function loadLocations(db: SupabaseClient, orgId: string): Promise<LocationRow[]> {
  const { data } = await db.from('stock_locations').select('id, name, is_factory, sort_order').eq('org_id', orgId).order('sort_order');
  return (data ?? []) as LocationRow[];
}

export interface ModelOption { part_number: string; description: string; active: boolean }

export async function loadModels(db: SupabaseClient, orgId: string): Promise<ModelOption[]> {
  const { data } = await db.from('stock_models').select('part_number, description, active').eq('org_id', orgId).order('sort_order');
  return (data ?? []) as ModelOption[];
}

/** The register query (filters, newest first). `range` is inclusive, as PostgREST's. */
export async function selectUnits(
  db: SupabaseClient, orgId: string, rq: RegisterQuery, locations: readonly LocationRow[],
  opts: { from: number; to: number; count?: boolean },
): Promise<{ rows: UnitRow[]; count: number | null; error: boolean }> {
  let query = db.from('stock_units').select(UNIT_COLUMNS, opts.count ? { count: 'exact' } : undefined).eq('org_id', orgId);
  const s = parseRegisterSearch(rq.q);
  if (s.kind === 'deal') query = query.eq('deal_year', s.year).eq('sequence', s.sequence);
  else if (s.kind === 'text') query = query.or(registerOrFilter(s));
  if (rq.model) query = query.eq('model_part', rq.model);
  if (rq.location === ALL_BRANCHES) query = query.in('location_id', locations.filter((l) => !l.is_factory).map((l) => l.id));
  else if (rq.location) query = query.eq('location_id', rq.location);
  if (rq.status) {
    const st = statusesFor(rq.status);
    query = st.length === 1 ? query.eq('status', st[0]) : query.in('status', st);
  }
  const { data, count, error } = await query
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range(opts.from, opts.to);
  return { rows: (data ?? []) as UnitRow[], count: count ?? null, error: !!error };
}

/** One unit of the caller's org, or null (unknown id, another org, or no access). */
export async function loadUnit(db: SupabaseClient, orgId: string, id: string): Promise<UnitRow | null> {
  const { data } = await db.from('stock_units').select(UNIT_COLUMNS).eq('org_id', orgId).eq('id', id).maybeSingle();
  return (data ?? null) as UnitRow | null;
}
