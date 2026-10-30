import { StockHeader } from '@/components/stock/StockHeader';
import { StatusChip } from '@/components/ui/StatusChip';
import { cardClass } from '@/components/ui/styles';
import { formatDateTime } from '@/lib/admin/grid';
import { loadOrg } from '@/lib/forms/org';
import { loadStockSettings } from '@/lib/stock/invoice-job';
import { RULE_MODE_LABEL } from '@/lib/stock/settings';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { InvoiceRulesForm, OpeningStockImport, RebuildDealsForm, StartDateForm } from './forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Pilot setup · Trailers & Tankers' };

const STOCK_JOBS = ['stock.invoices', 'stock.deals-backfill', 'stock.deal-sync'];
const JOB_LABEL: Record<string, string> = {
  'stock.invoices': 'Invoice rules',
  'stock.deals-backfill': 'Rebuild deals',
  'stock.deal-sync': 'Deal sync',
};

/**
 * Pilot setup (docs/M6.md section 4), stock.manage (admin). Settings are read and written with the service role
 * after the permission check (job_runs and outbox_jobs are service-only tables), always scoped to the org.
 */
export default async function StockSetup() {
  const member = await requirePerm('stock.manage');
  const db = createAdminClient();
  const [org, settings, { data: runs }, { count: queued }] = await Promise.all([
    loadOrg(db, member.orgId),
    loadStockSettings(db, member.orgId),
    db.from('job_runs').select('id, job, started_at, finished_at, ok, processed, error').eq('org_id', member.orgId).in('job', STOCK_JOBS)
      .order('started_at', { ascending: false }).limit(8),
    db.from('outbox_jobs').select('id', { count: 'exact', head: true }).eq('org_id', member.orgId).eq('status', 'pending').in('queue', STOCK_JOBS),
  ]);
  const tz = org.timezone;

  return (
    <section className="space-y-5">
      <StockHeader eyebrow="Stock control" title="Pilot setup" subtitle="Start date, invoice rules and opening stock." />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${cardClass} space-y-3 p-4`}>
          <div>
            <h2 className="text-h2">Stock start date</h2>
            <p className="text-small text-fg-muted">
              DEAL entries created on or after this date become stock deals, and Xero invoices changed on or after it are checked against stock.
              Leave it empty to import no deals and check no invoices (older deals and sales stay out of the lists).
            </p>
          </div>
          <p className="text-body">Current: <b data-testid="current-start">{settings.start ?? 'not set'}</b></p>
          <StartDateForm current={settings.start} />
        </div>

        <div className={`${cardClass} space-y-3 p-4`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-h2">Invoice rules</h2>
              <p className="text-small text-fg-muted">How Xero invoices change units: unpaid reserves, fully paid sells, doubtful ones go to the exceptions queue.</p>
            </div>
            <span data-testid="current-rules"><StatusChip status={RULE_MODE_LABEL[settings.rules]} color={settings.rules === 'live' ? 'green' : settings.rules === 'preview' ? 'teal' : 'gray'} /></span>
          </div>
          <InvoiceRulesForm current={settings.rules} />
        </div>
      </div>

      <div className={`${cardClass} space-y-3 p-4`}>
        <div>
          <h2 className="text-h2">Deals</h2>
          <p className="text-small text-fg-muted">
            Re-reads every DEAL entry since the stock start date and creates or updates its stock deal. Dispatched and dismissed deals keep their state.
          </p>
        </div>
        <RebuildDealsForm />
      </div>

      <div className={`${cardClass} space-y-3 p-4`}>
        <div>
          <h2 className="text-h2">Opening stock</h2>
          <p className="text-small text-fg-muted">
            Register the units already at the Factory and the branches from a CSV file. Check the file first: the report lists new units, VINs already
            registered (left unchanged) and every problem by line. Import is possible once the file is clean, and importing the same file again adds nothing.
          </p>
        </div>
        <OpeningStockImport />
      </div>

      <div className={cardClass}>
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border p-4">
          <h2 className="text-h2">Background jobs</h2>
          <span className="text-small text-fg-muted">{queued ?? 0} queued</span>
        </div>
        {runs?.length ? (
          <ul className="divide-y divide-border" data-testid="job-runs">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-body">
                <span className="font-semibold">{JOB_LABEL[r.job as string] ?? r.job}</span>
                <span className="text-small text-fg-muted">
                  {formatDateTime(r.started_at as string, tz)} · {r.finished_at ? (r.ok ? `${r.processed} processed` : `failed${r.error ? `: ${r.error}` : ''}`) : 'running'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-body text-fg-muted">No stock jobs have run yet.</p>
        )}
      </div>
    </section>
  );
}
