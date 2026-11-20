import { createAdminClient } from '@/lib/supabase/admin';
import { drainOutbox, refreshFx, scheduledSync } from '@/lib/jobs/handlers';
import { drainImportJobs } from '@/lib/import/cognito/job';
import { safeEqual } from '@/lib/security/crypto';

// Job runner endpoint, called by the scheduler (Supabase pg_cron + pg_net) with Authorization: Bearer JOB_SECRET.
//   POST /api/jobs/xero-sync   {"mode":"quick"|"full"}   mirror sync (quick: invoices + payments)
//   POST /api/jobs/outbox                               drain queued jobs (webhook fetches, deal-file rebuilds)
//   POST /api/jobs/cognito-import                       drain only in-app Cognito import slices (every minute while importing)
//   POST /api/jobs/fx-refresh                           daily ZAR -> USD rate from FX_RATE_URL (orgs with fx.auto = 'on')
// Each run stays inside the function time limit and logs to job_runs.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BUDGET_MS = 45_000;

export async function POST(req: Request, { params }: { params: Promise<{ queue: string }> }) {
  const secret = process.env.JOB_SECRET ?? '';
  const auth = req.headers.get('authorization') ?? '';
  if (secret.length < 32 || !safeEqual(auth, `Bearer ${secret}`)) return new Response('unauthorized', { status: 401 });

  const { queue } = await params;
  const db = createAdminClient();
  if (queue === 'xero-sync') {
    const body = (await req.json().catch(() => ({}))) as { mode?: string };
    const mode = body.mode === 'full' ? 'full' : 'quick';
    const results = await scheduledSync(db, mode, BUDGET_MS - 10_000);
    const outbox = await drainOutbox(db, 8_000);
    return Response.json({ ok: true, mode, results, outbox });
  }
  if (queue === 'outbox') {
    return Response.json({ ok: true, outbox: await drainOutbox(db, BUDGET_MS) });
  }
  if (queue === 'fx-refresh') {
    const fx = await refreshFx(db);
    return Response.json({ ok: fx.status !== 'error', fx });
  }
  if (queue === 'cognito-import') {
    return Response.json({ ok: true, outbox: await drainImportJobs(db, BUDGET_MS) });
  }
  return new Response('unknown queue', { status: 404 });
}
