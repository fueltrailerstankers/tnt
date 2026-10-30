import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { rebuildDealFiles } from '@/lib/deal-files/job';
import { fetchOne, runXeroSync, type SyncMode } from '@/lib/integrations/xero/sync';
import { processLeadEvent } from '@/lib/leads/intake-job';
import { rematchOpenLeads } from '@/lib/leads/service';
import { XERO_ACTION_HANDLERS } from '@/lib/integrations/xero/write/handlers';
import { runImportJob } from '@/lib/import/cognito/job';
import { STOCK_DEAL_HANDLERS } from '@/lib/stock/deal-jobs';
import { drain, enqueue, recordRun, releaseStuck, type Handler } from './outbox';

export const HANDLERS: Record<string, Handler> = {
  // M3 Xero actions ("xero.<action>"); each checks its mode (off / dry_run / live) itself.
  ...XERO_ACTION_HANDLERS,
  // M6 stock deals: 'stock.deal-sync' (one DEAL entry) and 'stock.deals-backfill' (all, resumable).
  ...STOCK_DEAL_HANDLERS,
  // A webhook named a changed invoice/contact: fetch it, then refresh deal files once.
  'xero.fetch': async (db, job) => {
    const { entity, id, event_id } = job.payload as { entity: 'invoices' | 'contacts'; id: string; event_id?: string };
    if (!job.org_id) throw new Error('job has no org');
    await fetchOne(db, job.org_id, entity, id);
    if (event_id) await db.from('integration_events').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('id', event_id);
    await enqueue(db, job.org_id, 'deal-files.rebuild', {}, { uniquePending: true });
  },
  'deal-files.rebuild': async (db, job) => {
    if (!job.org_id) throw new Error('job has no org');
    await recordRun(db, job.org_id, 'deal-files.rebuild', async () => {
      const n = await rebuildDealFiles(db, job.org_id!);
      return { ok: true, processed: n, result: n };
    });
  },
  // A stored lead intake event ({ event_id }) becomes a lead (M4). Resumable; the email is sent at most once.
  'leads.intake': async (db, job) => {
    if (!job.org_id) throw new Error('job has no org');
    const eventId = (job.payload as { event_id?: unknown }).event_id;
    if (typeof eventId !== 'string' || !eventId) throw new Error('job has no event');
    await processLeadEvent(db, job.org_id, eventId);
  },
  // Re-run lead to Xero matching for the org's open leads (M4). Idempotent; continues itself when out of time.
  'leads.rematch': async (db, job) => {
    if (!job.org_id) throw new Error('job has no org');
    const r = await recordRun(db, job.org_id, 'leads.rematch', async () => {
      const from = Number((job.payload as { from?: number }).from ?? 0) || 0;
      const res = await rematchOpenLeads(db, job.org_id!, { budgetMs: 15_000, from });
      return { ok: true, processed: res.changed, result: res };
    });
    if (!r.complete) await enqueue(db, job.org_id, 'leads.rematch', { from: r.next });
  },
  // In-app Cognito import: one time-boxed slice of an import run ({ run_id }); re-enqueues itself until done.
  'cognito.import': runImportJob,
};

export async function drainOutbox(db: SupabaseClient, budgetMs: number) {
  await releaseStuck(db);
  return recordRun(db, null, 'outbox', async () => {
    const r = await drain(db, HANDLERS, Date.now() + budgetMs);
    return { ok: r.failed === 0, processed: r.ran, error: r.failed ? `${r.failed} failed` : undefined, result: r };
  });
}

/** Scheduled sync for every connected org, then a deal-files rebuild when anything changed. */
export async function scheduledSync(db: SupabaseClient, mode: SyncMode, budgetMs: number) {
  const { data } = await db.from('xero_connections').select('org_id').eq('status', 'connected');
  const results = [];
  for (const { org_id } of data ?? []) {
    const r = await recordRun(db, org_id, `xero.sync.${mode}`, async () => {
      const res = await runXeroSync(db, org_id, mode, budgetMs);
      return { ok: res.status === 'ok' || res.status === 'partial', processed: res.processed, error: res.status === 'error' ? res.reason : undefined, result: res };
    });
    if (r.processed > 0 || mode === 'full') await enqueue(db, org_id, 'deal-files.rebuild', {}, { uniquePending: true });
    // Leads are matched against the mirror: refresh the matches after each nightly full sync (M4).
    if (mode === 'full') await enqueue(db, org_id, 'leads.rematch', {}, { uniquePending: true });
    results.push({ org: org_id, status: r.status, processed: r.processed, calls: r.calls, reason: r.reason });
  }
  return results;
}
