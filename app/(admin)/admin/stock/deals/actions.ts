'use server';

import { revalidatePath } from 'next/cache';
import { DismissInput, RestoreInput } from '@/lib/stock/deals-view';
import { stockMessageFor } from '@/lib/stock/errors';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';

// Dismiss / restore (admin, stock.manage). requirePerm first, Zod next, then the RPC as the signed-in user: it checks
// the admin role again, locks the deal, keeps the reason in stock_deal_dismissals and writes the audit row (ids
// only; the reason never goes into audit meta).

export type DealActionState = { ok?: string; error?: string };

const PAGE = '/admin/stock/deals';

export async function dismissDeal(_prev: DealActionState, fd: FormData): Promise<DealActionState> {
  const member = await requirePerm('stock.manage');
  const parsed = DismissInput.safeParse({ deal_id: fd.get('deal_id'), reason: fd.get('reason') ?? '' });
  if (!parsed.success) return { error: parsed.error.issues[0]?.path[0] === 'reason' ? parsed.error.issues[0].message : 'Choose a deal.' };
  const db = await createClient();
  const { error } = await db.rpc('stock_dismiss_deal', { p_org: member.orgId, p_deal: parsed.data.deal_id, p_reason: parsed.data.reason });
  if (error) return { error: stockMessageFor(error) };
  revalidatePath(PAGE);
  return { ok: 'Deal dismissed.' };
}

export async function restoreDeal(_prev: DealActionState, fd: FormData): Promise<DealActionState> {
  const member = await requirePerm('stock.manage');
  const parsed = RestoreInput.safeParse({ deal_id: fd.get('deal_id') });
  if (!parsed.success) return { error: 'Choose a deal.' };
  const db = await createClient();
  const { error } = await db.rpc('stock_restore_deal', { p_org: member.orgId, p_deal: parsed.data.deal_id });
  if (error) return { error: stockMessageFor(error) };
  revalidatePath(PAGE);
  return { ok: 'Deal restored.' };
}
