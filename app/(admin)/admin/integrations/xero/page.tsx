import Link from 'next/link';
import { formatDateTime } from '@/lib/admin/grid';
import { appEnv } from '@/lib/env';
import { loadOrg } from '@/lib/forms/org';
import { xeroConfig, xeroConfigured } from '@/lib/integrations/xero/config';
import { loadConnection } from '@/lib/integrations/xero/connection';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { disconnectXero, syncNow } from './actions';
import { MonthCheck } from './month-check';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Xero · Trailers & Tankers' };

const ERRORS: Record<string, string> = {
  config: 'Xero is not configured: set XERO_CLIENT_ID and XERO_CLIENT_SECRET.',
  denied: 'Xero access was not granted.',
  state: 'The connection request expired or did not match. Start again.',
  tenant: 'No matching Xero organisation was found for this login.',
  exchange: 'Xero did not accept the connection. Start again.',
};

export default async function XeroHealth({ searchParams }: { searchParams: Promise<{ error?: string; connected?: string; synced?: string }> }) {
  const member = await requirePerm('xero.read');
  const sp = await searchParams;
  // xero_connections, job_runs and integration_events are service-only tables: read after the permission check.
  const db = createAdminClient();
  const [org, conn] = await Promise.all([loadOrg(db, member.orgId), loadConnection(db, member.orgId)]);
  const tz = org.timezone;
  const [{ data: states }, { data: runs }, { data: rate }, { count: queued }, { count: failedJobs }, { data: lastEvent }, { count: eventsDay }] = await Promise.all([
    db.from('xero_sync_state').select('entity, backfill_done, pass, page, modified_since, last_run_at, last_ok_at, last_error, records_synced').eq('org_id', member.orgId).order('entity'),
    db.from('job_runs').select('id, job, started_at, finished_at, ok, processed, error').or(`org_id.eq.${member.orgId},org_id.is.null`).order('started_at', { ascending: false }).limit(12),
    conn ? db.from('xero_connections').select('rate_min_remaining, rate_day_remaining, rate_seen_at, last_refreshed_at').eq('id', conn.id).single() : Promise.resolve({ data: null }),
    db.from('outbox_jobs').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    db.from('outbox_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
    db.from('integration_events').select('received_at').eq('source', 'xero').order('received_at', { ascending: false }).limit(1),
    db.from('integration_events').select('id', { count: 'exact', head: true }).eq('source', 'xero').gte('received_at', new Date(Date.now() - 86_400_000).toISOString()),
  ]);
  const manage = can(member, 'integrations.manage');
  const configured = xeroConfigured();
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);

  return (
    <section className="max-w-4xl space-y-4">
      <h1 className="text-h1">Xero</h1>
      <p className="text-sm text-fg-muted">Read-only mirror. Xero stays the book of record; this phase never writes to Xero.</p>
      {sp.error ? <p role="alert" className="rounded bg-status-red-bg p-3 text-sm text-status-red-fg">{ERRORS[sp.error] ?? 'Something went wrong.'}</p> : null}
      {sp.connected ? <p role="status" className="rounded bg-status-green-bg p-3 text-sm">Connected. The first sync runs on the next schedule, or use Sync now.</p> : null}
      {sp.synced ? <p role="status" className="rounded bg-status-green-bg p-3 text-sm">Sync step finished.</p> : null}

      <div className="rounded-md border bg-surface shadow-card p-4 text-sm" data-testid="xero-connection">
        <h2 className="mb-2 font-semibold">Connection</h2>
        {conn && conn.status === 'connected' ? (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div><dt className="text-xs text-fg-muted">Organisation</dt><dd data-testid="xero-tenant">{conn.tenantName ?? conn.tenantId}</dd></div>
            <div><dt className="text-xs text-fg-muted">Access token expires</dt><dd>{formatDateTime(conn.expiresAt, tz)}</dd></div>
            <div><dt className="text-xs text-fg-muted">Last token refresh</dt><dd>{formatDateTime(rate?.last_refreshed_at ?? null, tz)}</dd></div>
            <div><dt className="text-xs text-fg-muted">Scopes</dt><dd className="break-words text-xs">{conn.scopes.join(' ')}</dd></div>
            <div><dt className="text-xs text-fg-muted">Calls left this minute</dt><dd>{rate?.rate_min_remaining ?? '-'}</dd></div>
            <div><dt className="text-xs text-fg-muted">Calls left today</dt><dd>{rate?.rate_day_remaining ?? '-'}</dd></div>
            <div><dt className="text-xs text-fg-muted">Webhook events (24 h)</dt><dd>{eventsDay ?? 0}</dd></div>
            <div><dt className="text-xs text-fg-muted">Last webhook</dt><dd>{formatDateTime(lastEvent?.[0]?.received_at ?? null, tz) || '-'}</dd></div>
          </dl>
        ) : (
          <p>{conn?.status === 'disconnected' ? 'Disconnected. Connect again to resume the mirror.' : 'Not connected.'}</p>
        )}
        {manage ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {configured ? <a href="/admin/integrations/xero/connect" className="rounded-pill bg-accent px-3.5 py-1.5 font-semibold text-accent-fg">{conn?.status === 'connected' ? 'Reconnect' : 'Connect to Xero'}</a> : <span className="text-status-red-fg">{ERRORS.config}</span>}
            {conn?.status === 'connected' ? (
              <>
                <form action={syncNow}><button className="rounded-pill border border-border-strong bg-surface font-semibold text-fg no-underline px-3 py-1">Sync now</button></form>
                <form action={disconnectXero}><button className="rounded-pill border border-border-strong bg-surface font-semibold no-underline px-3 py-1 text-status-red-fg">Disconnect</button></form>
              </>
            ) : null}
          </div>
        ) : null}
        {configured && manage ? (
          <p className="mt-2 text-xs text-fg-muted">
            Redirect URI to register in the Xero app: <code>{xeroConfig().redirectUri}</code>. Webhook URL: <code>{appEnv().APP_URL}/api/webhooks/xero</code>.
          </p>
        ) : null}
      </div>

      <div className="rounded-md border bg-surface shadow-card p-4 text-sm">
        <h2 className="mb-2 font-semibold">Sync</h2>
        <table className="w-full" data-testid="sync-state">
          <thead className="text-left text-xs text-fg-muted">
            <tr><th>Entity</th><th>Stage</th><th className="text-right">Records</th><th>Last success</th><th>Last error</th></tr>
          </thead>
          <tbody>
            {(states ?? []).map((s) => (
              <tr key={s.entity} className="border-t">
                <td>{s.entity}</td>
                <td>{s.backfill_done ? 'incremental' : `backfill (pass ${s.pass + 1}, page ${s.page})`}</td>
                <td className="text-right tabular-nums">{s.records_synced}</td>
                <td>{formatDateTime(s.last_ok_at, tz) || '-'}</td>
                <td className="text-status-red-fg">{s.last_error ?? ''}</td>
              </tr>
            ))}
            {!states?.length ? <tr><td colSpan={5} className="py-2 text-fg-muted">No sync has run yet.</td></tr> : null}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-fg-muted">Queued jobs: {queued ?? 0} · failed jobs: {failedJobs ?? 0}</p>
      </div>

      <div className="rounded-md border bg-surface shadow-card p-4 text-sm">
        <h2 className="mb-2 font-semibold">Recent runs</h2>
        <ul className="divide-y">
          {(runs ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap justify-between gap-2 py-1">
              <span>{r.job}</span>
              <span className={r.ok === false ? 'text-status-red-fg' : 'text-fg-muted'}>
                {formatDateTime(r.started_at, tz)} · {r.ok === null ? 'running' : r.ok ? `ok, ${r.processed}` : `failed${r.error ? `: ${r.error}` : ''}`}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {manage ? (
        <div className="rounded-md border bg-surface shadow-card p-4 text-sm">
          <h2 className="mb-2 font-semibold">Check a month against Xero</h2>
          <p className="mb-2 text-xs text-fg-muted">Counts and totals per currency for quotes, invoices and payments: live from Xero (read only) and from the mirror.</p>
          <MonthCheck defaultMonth={lastMonth} />
        </div>
      ) : null}

      <p className="text-sm">
        <Link href="/admin/xero/quotes" className="underline">Quotes</Link> · <Link href="/admin/xero/invoices" className="underline">Invoices</Link> · <Link href="/admin/deal-files" className="underline">Deal files</Link> · <Link href="/admin/integrations/xero/actions" className="underline">Xero actions</Link>
      </p>
    </section>
  );
}
