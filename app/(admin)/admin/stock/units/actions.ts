'use server';

import { revalidatePath } from 'next/cache';
import { stockErrorMessage, stockMessageFor } from '@/lib/stock/errors';
import {
  changedSummary, correctionFields, CorrectInput, invalidField, TransferInput, transferArgs, type ActionState,
} from '@/lib/stock/register';
import { loadLocations, loadUnit } from '@/lib/stock/register-query';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';

// Admin unit edits (stock.manage). Each action: requirePerm, Zod, then the stock RPC with the caller's own client:
// the RPC checks the role again (auth.uid()), writes the unit and its audit row (ids and codes only). No service role.

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : undefined;
};

const invalid = (path: readonly PropertyKey[]) => stockErrorMessage({ code: 'INVALID_INPUT', detail: { field: invalidField(path) } });

async function nameOf(db: Awaited<ReturnType<typeof createClient>>, orgId: string) {
  const locations = await loadLocations(db, orgId);
  const names = new Map(locations.map((l) => [l.id, l.name]));
  return (id: string) => names.get(id);
}

/** Correct record: sends only the changed fields to stock_correct_unit. */
export async function correctUnit(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const member = await requirePerm('stock.manage');
  const parsed = CorrectInput.safeParse({
    unit: str(fd, 'unit'), vin: str(fd, 'vin'), model: str(fd, 'model'), location: str(fd, 'location'),
    status: str(fd, 'status'), invoice: str(fd, 'invoice') ?? '', dispatch_date: str(fd, 'dispatch_date') ?? '',
    accessories: fd.getAll('accessories').filter((v): v is string => typeof v === 'string'),
    notes: str(fd, 'notes') ?? '', deal_year: str(fd, 'deal_year') ?? '', deal_number: str(fd, 'deal_number') ?? '',
    link_deal: str(fd, 'link_deal') || undefined, unlink_deal: str(fd, 'unlink_deal') || undefined,
  });
  if (!parsed.success) return { error: invalid(parsed.error.issues[0]?.path ?? []) };

  const db = await createClient();
  const unit = await loadUnit(db, member.orgId, parsed.data.unit);
  if (!unit) return { error: stockErrorMessage({ code: 'UNIT_NOT_FOUND', detail: {} }) };
  const diff = correctionFields(unit, parsed.data);
  if ('error' in diff) {
    return { error: diff.error === 'deal_link_needs_deal' ? 'Enter the deal year and sequence number to link.' : invalid(['deal_year']) };
  }
  if (!Object.keys(diff.fields).length) return { ok: 'No changes to save.' };

  const { error } = await db.rpc('stock_correct_unit', { p_org: member.orgId, p_unit: unit.id, p_fields: diff.fields });
  if (error) return { error: stockMessageFor(error, { locationName: await nameOf(db, member.orgId) }) };
  revalidatePath('/admin/stock', 'layout');
  return { ok: `Record corrected: ${changedSummary(diff.fields)}.` };
}

/** Transfer: stock_move_unit to another location, with a reason (required except Factory -> branch). */
export async function transferUnit(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const member = await requirePerm('stock.manage');
  const parsed = TransferInput.safeParse({
    unit: str(fd, 'unit'), location: str(fd, 'location'), reason: str(fd, 'reason') ?? '',
    deal_year: str(fd, 'deal_year') ?? '', deal_number: str(fd, 'deal_number') ?? '',
  });
  if (!parsed.success) return { error: invalid(parsed.error.issues[0]?.path ?? []) };
  const args = transferArgs(member.orgId, parsed.data);
  if (!args) return { error: invalid(['deal_year']) };

  const db = await createClient();
  const locationName = await nameOf(db, member.orgId);
  const { error } = await db.rpc('stock_move_unit', args);
  if (error) return { error: stockMessageFor(error, { locationName }) };
  revalidatePath('/admin/stock', 'layout');
  const to = locationName(args.p_location) ?? args.p_location;
  return { ok: args.p_deal_year ? `Moved to ${to} and linked to deal ${args.p_deal_year} / ${args.p_deal_number}.` : `Moved to ${to}.` };
}
