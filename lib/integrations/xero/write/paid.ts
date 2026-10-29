import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { enqueue } from '@/lib/jobs/outbox';
import { paidTransitions } from './triggers';
import { queueOf, type InvoiceIn } from './types';

// ---------------------------------------------------------------------------------------------------
// Sync hook (lib/integrations/xero/sync.ts): enqueue release.on_paid for invoices whose amount due became 0.
// ---------------------------------------------------------------------------------------------------

/** amount_due per invoice id as stored before an upsert. */
export async function amountDueBefore(db: SupabaseClient, orgId: string, ids: string[]): Promise<Map<string, number | string | null>> {
  const m = new Map<string, number | string | null>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from('xero_invoices').select('invoice_id, amount_due').eq('org_id', orgId).in('invoice_id', ids.slice(i, i + 200));
    for (const r of data ?? []) m.set(r.invoice_id as string, r.amount_due as number | string | null);
  }
  return m;
}

export async function enqueuePaid(
  db: SupabaseClient, orgId: string, before: Map<string, number | string | null>,
  rows: Array<Pick<InvoiceIn, 'invoice_id' | 'amount_due' | 'status' | 'invoice_type' | 'total'>>,
): Promise<number> {
  const { data: st } = await db.from('xero_sync_state').select('backfill_done').eq('org_id', orgId).eq('entity', 'invoices').maybeSingle();
  const ids = paidTransitions(before, rows, st?.backfill_done === true);
  for (const invoiceId of ids) await enqueue(db, orgId, queueOf('release.on_paid'), { invoiceId });
  return ids.length;
}
