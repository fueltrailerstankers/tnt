import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findOutcome, type FindOutcome, type FoundDealRow, type VinUnitRow } from './dispatch';
import type { LocationRow } from './kpi';
import { createAdminClient } from '@/lib/supabase/admin';

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

export interface DismissalHistoryItem {
  id: string;
  reason: string;
  dismissedAt: string;
  /** The admin's display name (full name only), or null. */
  by: string | null;
  deal: { year: number; number: number; status: 'awaiting_dispatch' | 'dispatched' | 'dismissed' } | null;
}

/**
 * Latest dismissals (stock_deal_dismissals, append-only) with their deal and who dismissed it. Dismissals and deals
 * are read through the caller's RLS. Names: members cannot read other members' profiles through RLS, so the full
 * names of the org's own members are read with the service role (call only after requirePerm('stock.read')).
 */
export async function loadDismissalHistory(db: SupabaseClient, orgId: string, limit: number): Promise<DismissalHistoryItem[]> {
  const { data, error } = await db.from('stock_deal_dismissals')
    .select('id, deal_id, reason, dismissed_by, dismissed_at')
    .eq('org_id', orgId).order('dismissed_at', { ascending: false }).limit(limit);
  if (error) throw new Error('stock dismissals unreadable');
  const rows = (data ?? []) as Array<{ id: string; deal_id: string; reason: string; dismissed_by: string | null; dismissed_at: string }>;
  if (!rows.length) return [];
  const dealIds = [...new Set(rows.map((r) => r.deal_id))];
  const userIds = [...new Set(rows.map((r) => r.dismissed_by).filter((u): u is string => !!u))];
  const [deals, names] = await Promise.all([
    db.from('stock_deals').select('id, year, number, status').eq('org_id', orgId).in('id', dealIds),
    memberNames(orgId, userIds),
  ]);
  if (deals.error) throw new Error('stock deals unreadable');
  const byId = new Map(((deals.data ?? []) as Array<{ id: string } & NonNullable<DismissalHistoryItem['deal']>>).map((d) => [d.id, d]));
  return rows.map((r) => {
    const d = byId.get(r.deal_id);
    return {
      id: r.id, reason: r.reason, dismissedAt: r.dismissed_at, by: (r.dismissed_by && names.get(r.dismissed_by)) || null,
      deal: d ? { year: d.year, number: d.number, status: d.status } : null,
    };
  });
}

async function memberNames(orgId: string, userIds: readonly string[]): Promise<Map<string, string>> {
  if (!userIds.length) return new Map();
  const admin = createAdminClient();
  const { data: ms } = await admin.from('memberships').select('user_id').eq('org_id', orgId).in('user_id', [...userIds]);
  const members = (ms ?? []).map((m) => m.user_id as string);
  if (!members.length) return new Map();
  const { data: ps } = await admin.from('profiles').select('id, full_name').in('id', members);
  return new Map((ps ?? []).filter((p) => p.full_name).map((p) => [p.id as string, p.full_name as string]));
}
