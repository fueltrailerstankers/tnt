import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findOutcome, type FindOutcome, type FoundDealRow, type VinUnitRow } from './dispatch';
import type { LocationRow } from './kpi';

// Stock reads for the Deals and Dispatch pages. Called with the signed-in user's client: RLS (stock.read roles)
// scopes every read to the member's org; each query also filters on org_id. Errors throw (the page shows Next's
// error page) rather than being read as "not found".

export interface ModelRow {
  part_number: string;
  description: string;
  active: boolean;
  sort_order: number;
}

export async function loadLocations(db: SupabaseClient, orgId: string): Promise<LocationRow[]> {
  const { data, error } = await db.from('stock_locations').select('id, name, is_factory, sort_order').eq('org_id', orgId).order('sort_order');
  if (error) throw new Error('stock locations unreadable');
  return (data ?? []) as LocationRow[];
}

export async function loadModels(db: SupabaseClient, orgId: string): Promise<ModelRow[]> {
  const { data, error } = await db.from('stock_models').select('part_number, description, active, sort_order').eq('org_id', orgId).order('sort_order');
  if (error) throw new Error('stock models unreadable');
  return (data ?? []) as ModelRow[];
}

export const locationNamer = (locations: readonly LocationRow[]) => {
  const names = new Map(locations.map((l) => [l.id, l.name]));
  return (id: string) => names.get(id);
};

/** Find unit: the deal with this year and number in the member's org, and the VIN it went out with if dispatched. */
export async function lookupDeal(db: SupabaseClient, orgId: string, year: number, number: number, locations: readonly LocationRow[]): Promise<FindOutcome> {
  const { data, error } = await db.from('stock_deals')
    .select('year, number, status, model_part, location_id, accessories, quote_number, unit_id')
    .eq('org_id', orgId).eq('year', year).eq('number', number).maybeSingle();
  if (error) throw new Error('stock deal unreadable');
  const deal = data as (FoundDealRow & { unit_id: string | null }) | null;
  let unitVin: string | null = null;
  if (deal?.status === 'dispatched' && deal.unit_id) {
    const u = await db.from('stock_units').select('vin_norm').eq('org_id', orgId).eq('id', deal.unit_id).maybeSingle();
    if (u.error) throw new Error('stock unit unreadable');
    unitVin = (u.data?.vin_norm as string | undefined) ?? null;
  }
  return findOutcome(year, number, deal, { unitVin, locationName: locationNamer(locations) });
}

/** VIN check on blur: the unit already registered with this (normalised) VIN, sold included. */
export async function lookupVin(db: SupabaseClient, orgId: string, vinNorm: string): Promise<VinUnitRow | null> {
  const { data, error } = await db.from('stock_units')
    .select('vin_norm, model_part, sequence, location_id, status')
    .eq('org_id', orgId).eq('vin_norm', vinNorm).maybeSingle();
  if (error) throw new Error('stock unit unreadable');
  return (data as VinUnitRow | null) ?? null;
}
