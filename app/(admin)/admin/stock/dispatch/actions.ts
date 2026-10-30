'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requirePerm } from '@/lib/security/require';
import {
  dealQuery, errorField, fieldMessage, parseDispatch, dispatchRpcArgs, savedUrl, vinCheck, type DispatchField, type FindOutcome,
} from '@/lib/stock/dispatch';
import { parseStockError, stockErrorMessage, stockMessageFor } from '@/lib/stock/errors';
import { loadLocations, locationNamer, lookupDeal, lookupVin } from '@/lib/stock/lookup';
import { isValidVin, normalizeVin } from '@/lib/stock/vin';
import { createClient } from '@/lib/supabase/server';

// Factory dispatch (stock plan 5.4 / 7.4). Every action: requirePerm('stock.dispatch') first, Zod next, then the
// signed-in user's client: reads go through RLS and the writes are the stock_dispatch_unit / stock_move_unit RPCs,
// which check the role again, lock the deal and write the audit row (ids, VIN, model and locations only).

export interface MoveOffer {
  unitId: string;
  vin: string;
  /** Destination branch id and name. */
  to: string;
  toName: string;
  /** Set in deal mode: the move clears the deal. */
  dealYear: number | null;
  dealNumber: number | null;
}

export type DispatchResult = { field: DispatchField; message: string; move?: MoveOffer };
export type VinNote = { tone: 'error' | 'info'; message: string } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCATION = /^[A-Z][A-Z0-9_]{1,15}$/;

const strings = (fd: FormData): Record<string, string | undefined> =>
  Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v as string]));

/** Find unit: the deal with this year and sequence number, and whether it can be dispatched. */
export async function findDeal(year: string, number: string): Promise<FindOutcome | { kind: 'invalid'; message: string }> {
  const member = await requirePerm('stock.dispatch');
  const q = dealQuery(String(year ?? '').slice(0, 10), String(number ?? '').slice(0, 12));
  if (!q) return { kind: 'invalid', message: fieldMessage('deal') };
  const db = await createClient();
  const locations = await loadLocations(db, member.orgId);
  return lookupDeal(db, member.orgId, q.year, q.number, locations);
}

/** VIN check on blur: any unit already registered with this VIN, sold included. */
export async function checkVin(vin: string): Promise<VinNote> {
  const member = await requirePerm('stock.dispatch');
  const raw = String(vin ?? '').slice(0, 80);
  if (!isValidVin(raw)) return null;
  const db = await createClient();
  const [locations, unit] = await Promise.all([loadLocations(db, member.orgId), lookupVin(db, member.orgId, normalizeVin(raw)!)]);
  const factory = new Set(locations.filter((l) => l.is_factory).map((l) => l.id));
  return vinCheck(unit, unit ? factory.has(unit.location_id) : false, locationNamer(locations));
}

/** Complete dispatch. Redirects to the Units register (searched for the VIN) on success; returns the error otherwise. */
export async function dispatchUnit(fd: FormData): Promise<DispatchResult> {
  const member = await requirePerm('stock.dispatch');
  const parsed = parseDispatch(strings(fd));
  if (!parsed.ok) return { field: parsed.field, message: parsed.message };
  const v = parsed.value;
  const db = await createClient();
  const { error } = await db.rpc('stock_dispatch_unit', dispatchRpcArgs(member.orgId, v));
  if (error) {
    const e = parseStockError(error);
    if (!e) return { field: 'form', message: stockMessageFor(error) };
    const locations = await loadLocations(db, member.orgId);
    const locationName = locationNamer(locations);
    const message = stockErrorMessage(e, { locationName });
    const unitId = typeof e.detail.unit_id === 'string' && UUID.test(e.detail.unit_id) ? e.detail.unit_id : null;
    if (e.code === 'FACTORY_UNIT_EXISTS' && unitId) {
      return {
        field: 'vin', message,
        move: { unitId, vin: v.vin, to: v.location, toName: locationName(v.location) ?? v.location, dealYear: v.dealYear, dealNumber: v.dealNumber },
      };
    }
    return { field: errorField(e), message };
  }
  revalidatePath('/admin/stock', 'layout');
  redirect(savedUrl(v.vin, 'dispatch'));
}

const MoveInput = z.object({
  unit_id: z.string().regex(UUID),
  location: z.string().regex(LOCATION),
  deal_year: z.coerce.number().int().min(2000).max(2100).nullable(),
  deal_number: z.coerce.number().int().min(1).max(2_147_483_647).nullable(),
}).refine((v) => (v.deal_year === null) === (v.deal_number === null));

/** "Move this factory unit to {branch}": a unit registered at the Factory goes to its branch (and clears the deal). */
export async function moveFactoryUnit(fd: FormData): Promise<DispatchResult> {
  const member = await requirePerm('stock.dispatch');
  const blank = (k: string) => { const s = fd.get(k); return typeof s === 'string' && s.trim() ? s.trim() : null; };
  const parsed = MoveInput.safeParse({ unit_id: fd.get('unit_id'), location: fd.get('location'), deal_year: blank('deal_year'), deal_number: blank('deal_number') });
  if (!parsed.success) return { field: 'form', message: fieldMessage('form') };
  const m = parsed.data;
  const db = await createClient();
  const [locations, unit] = await Promise.all([
    loadLocations(db, member.orgId),
    db.from('stock_units').select('id, vin_norm, location_id, status').eq('org_id', member.orgId).eq('id', m.unit_id).maybeSingle(),
  ]);
  if (unit.error) throw new Error('stock unit unreadable');
  const u = unit.data as { id: string; vin_norm: string; location_id: string; status: string } | null;
  const factory = new Set(locations.filter((l) => l.is_factory).map((l) => l.id));
  // Only a Factory unit that is not sold is offered the move; anything else is a transfer (admin, Units page).
  if (!u || !factory.has(u.location_id) || u.status === 'sold') return { field: 'vin', message: stockErrorMessage({ code: 'UNIT_NOT_FOUND', detail: {} }) };
  const { error } = await db.rpc('stock_move_unit', {
    p_org: member.orgId, p_unit: u.id, p_location: m.location, p_reason: null, p_deal_year: m.deal_year, p_deal_number: m.deal_number,
  });
  if (error) {
    const e = parseStockError(error);
    return e ? { field: errorField(e), message: stockErrorMessage(e, { locationName: locationNamer(locations) }) } : { field: 'form', message: stockMessageFor(error) };
  }
  revalidatePath('/admin/stock', 'layout');
  redirect(savedUrl(u.vin_norm, 'move'));
}
