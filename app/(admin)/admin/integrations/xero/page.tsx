import Link from 'next/link';
import { ActionModeControl } from '@/components/integrations/ActionModeControl';
import { DisconnectXero } from '@/components/integrations/DisconnectXero';
import { DryRunDiff } from '@/components/integrations/DryRunDiff';
import { Meter } from '@/components/integrations/Meter';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusChip } from '@/components/ui/StatusChip';
import { buttonClass, tableClass, theadClass } from '@/components/ui/styles';
import { appEnv } from '@/lib/env';
import { xeroConfig, xeroConfigured, webhookKey } from '@/lib/integrations/xero/config';
import { dryRunDoesNothing, NO_XERO_WRITES_NOTE, WRITES_TO_XERO } from '@/lib/integrations/xero/write/modes';
import { isActionName } from '@/lib/integrations/xero/write/types';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { loadActions, loadConnectionInfo, loadHealth, loadRunRequests } from '@/lib/settings/xero-load';
import {
  accessTokenMeter, ACTION_TRIGGER, actionStats, entityRows, failureItems, MODE_LABEL, pickDryRun, rateMeters, refreshTokenMeter, runStamp,
} from '@/lib/settings/xero-page';
import { stampLabel } from '@/lib/tasks/format';
import { shortDate } from '@/lib/ui/time';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncNow } from './actions';
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

const CONN_CHIP: Record<string, { label: string; color: string }> = {
  connected: { label: 'Connected', color: 'green' },
  disconnected: { label: 'Disconnected', color: 'gray' },
  error: { label: 'Error', color: 'red' },
};

type SP = { error?: string; connected?: string; synced?: string; diff?: string; run?: string };

export default async function XeroIntegration({ searchParams }: { searchParams: Promise<SP> }) {
  const member = await requirePerm('integrations.read');
  const sp = await searchParams;
  const manage = can(member, 'integrations.manage');
  const configure = can(member, 'xero.actions.configure');
  const now = Date.now();
  // Service-only tables (xero_connections, job_runs, outbox_jobs, integration_events): read after the permission check.
  const db = createAdminClient();
  const info = await loadConnectionInfo(db, member.orgId);
  const { conn } = info;
  const [health, acts] = await Promise.all([loadHealth(db, member.orgId, now), loadActions(db, member.orgId, conn, now)]);
  const connected = conn?.status === 'connected';
  const configured = xeroConfigured();

  const access = connected ? accessTokenMeter(conn.expiresAt, now) : { label: '—', pct: null, tone: 'gray' as const };
  const refresh = connected ? refreshTokenMeter(info.lastRefreshedAt ?? info.connectedAt, now) : { label: '—', pct: null, tone: 'gray' as const, daysLeft: null };
  const rate = rateMeters(info.rate, now);
  const entities = entityRows(health.states, now);
  const failures = failureItems(health, now);

  // Dry-run diff: the chosen action (?diff=) or the first with a recorded dry run.
  const diffAction = isActionName(sp.diff) ? sp.diff : acts.actions.find((a) => pickDryRun(acts.runs.map((r) => ({ ...r, planned_requests: null })), a.action))?.action ?? acts.actions[0].action;
  const picked = pickDryRun(acts.runs.map((r) => ({ ...r, planned_requests: null })), diffAction, typeof sp.run === 'string' ? sp.run : null);
  const diffRun = manage && picked ? await loadRunRequests(db, member.orgId, picked.id) : null;
  const diffRequests = Array.isArray(diffRun?.planned_requests) ? (diffRun.planned_requests as unknown[]) : [];
  const recentDry = acts.runs.filter((r) => r.action === diffAction && r.mode === 'dry_run' && r.status !== 'skipped').slice(0, 10);
  const lastMonth = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - 1, 1)).toISOString().slice(0, 7);

  const chip = conn ? CONN_CHIP[conn.status] ?? CONN_CHIP.error : { label: 'Not connected', color: 'gray' };
  const banner = sp.error ? <Alert tone="error">{ERRORS[sp.error] ?? 'Something went wrong.'}</Alert>
    : sp.connected ? <Alert tone="success">Connected. The first sync runs on the next schedule, or use Sync all now.</Alert>
      : sp.synced ? <Alert tone="success">Sync step finished.</Alert> : null;

  return (
    <section className="flex w-full min-w-0 max-w-[1360px] flex-col gap-5">
      <div className="flex flex-col gap-1">
        <nav aria-label="Breadcrumb" className="text-small text-fg-muted">
          <ol className="m-0 flex list-none gap-1.5 p-0"><li>Integrations</li><li aria-hidden="true">/</li><li aria-current="page" className="text-fg">Xero</li></ol>
        </nav>
        <h1 className="text-h1">Xero</h1>
        <p className="m-0 text-small text-fg-muted">Xero is the book of record. The portal mirrors it and writes only through the gated actions below.</p>
      </div>
      {banner}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-4">
        <Card padding="md" className="gap-3" data-testid="xero-connection" aria-labelledby="conn-h">
          <CardHeader id="conn-h" title="Connection" action={<StatusChip status={chip.label} color={chip.color} />} />
          {connected ? (
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-small">
              <dt className="text-fg-muted">Organisation</dt><dd className="m-0 font-medium" data-testid="xero-tenant">{conn.tenantName ?? conn.tenantId}</dd>
              <dt className="text-fg-muted">Connected</dt><dd className="m-0">{[info.connectedBy, shortDate(info.connectedAt)].filter(Boolean).join(' · ') || '—'}</dd>
              <dt className="text-fg-muted">Scopes</dt><dd className="m-0 break-words font-mono text-[12px]">{conn.scopes.join(', ') || '—'}</dd>
            </dl>
          ) : (
            <p className="m-0 text-small">{conn?.status === 'disconnected' ? 'Disconnected. Connect again to resume the mirror.' : 'Not connected.'}</p>
          )}
          {manage ? (
            <div className="mt-auto flex flex-wrap gap-2">
              {configured
                ? <a href="/admin/integrations/xero/connect" className={buttonClass('primary', 38, 'flex-1')}>{connected ? 'Reconnect with Xero (OAuth)' : 'Connect to Xero'}</a>
                : <p className="m-0 text-small text-status-red-fg">{ERRORS.config}</p>}
              {connected ? <DisconnectXero /> : null}
            </div>
          ) : null}
          {configured && manage ? (
            <p className="m-0 break-words text-[12px] text-fg-muted">
              Redirect URI for the Xero app: <code className="font-mono">{xeroConfig().redirectUri}</code>. Webhook URL: <code className="font-mono">{appEnv().APP_URL}/api/webhooks/xero</code>.
            </p>
          ) : null}
        </Card>

        <Card padding="md" className="gap-3.5" aria-labelledby="tokens-h" data-testid="xero-tokens">
          <CardHeader id="tokens-h" title="Tokens" />
          <Meter title="Access token" meter={access} />
          <Meter title="Refresh token" meter={refresh} />
          <p className="m-0 text-[12px] text-fg-muted">
            {connected && info.lastRefreshedAt ? `Last refreshed ${stampLabel(info.lastRefreshedAt, now)}` : 'Not refreshed yet'} · refresh tokens last 60 days; reconnect before they run out.
          </p>
        </Card>

        <Card padding="md" className="gap-3.5" aria-labelledby="rate-h" data-testid="xero-rate">
          <CardHeader id="rate-h" title="Rate-limit headroom" />
          <Meter title="This minute" meter={rate.minute} mono />
          <Meter title="Today" meter={rate.day} mono />
          <p className="m-0 text-[12px] text-fg-muted">{rate.seen ? `From Xero's last response, ${rate.seen}. ` : ''}Jobs back off automatically under 10 / min.</p>
        </Card>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <Card padding="none" className="min-w-0 flex-[1_1_460px]" aria-labelledby="sync-h">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3.5">
            <h2 id="sync-h" className="m-0 text-[15px] font-semibold">Last sync per entity</h2>
            {manage && connected ? <form action={syncNow}><Button type="submit" variant="secondary" size={32}>Sync all now</Button></form> : null}
          </div>
          <div className="relative overflow-x-auto">
            <table className={`${tableClass} text-small`} data-testid="sync-state">
              <thead className={theadClass}><tr><th className="px-4 py-2">Entity</th><th className="p-2">Last success</th><th className="p-2 text-right">Records</th><th className="py-2 pl-2 pr-4">State</th></tr></thead>
              <tbody>
                {entities.map((e) => (
                  <tr key={e.entity} className="h-10 border-t border-border" data-testid={`sync-${e.entity}`}>
                    <td className="px-4 font-medium">{e.name}</td>
                    <td className="px-2 text-fg-muted">{e.when}</td>
                    <td className="px-2 text-right font-mono tabular-nums">{e.records}</td>
                    <td className="py-1.5 pl-2 pr-4"><StatusChip status={e.state} color={e.tone} />{e.detail ? <span className="ml-2 text-[12px] text-fg-muted">{e.detail}</span> : null}</td>
                  </tr>
                ))}
                {!entities.length ? <tr><td colSpan={4} className="px-4 py-3 text-fg-muted">No sync has run yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <p className="m-0 border-t border-border px-4 py-2 text-[12px] text-fg-muted">Queued jobs: {health.queued}</p>
        </Card>

        <Card padding="none" className="min-w-0 flex-[1_1_460px]" aria-labelledby="fail-h" data-testid="xero-failures">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3.5">
            <h2 id="fail-h" className="m-0 text-[15px] font-semibold">Failures · 24 h</h2>
            <span className="text-[12px] text-fg-muted">
              {webhookKey() ? 'Webhook key set' : 'Webhook key not set'} · {health.lastEventAt ? `last event ${stampLabel(health.lastEventAt, now)}` : 'no events yet'} · {health.eventsDay} in 24 h
            </span>
          </div>
          {failures.length ? (
            <ul className="m-0 list-none p-0">
              {failures.map((f) => (
                <li key={f.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-4 py-3 first:border-t-0" data-testid={`failure-${f.key}`}>
                  <span className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
                    <span className="text-small font-semibold"><span className="font-mono">{f.job}</span> · {f.error}</span>
                    <span className="text-[12px] text-fg-muted">{f.meta}</span>
                  </span>
                  {manage && connected && f.action ? (
                    <form action={syncNow}>
                      <Button type="submit" variant="secondary" size={32} aria-describedby={f.action === 'replay' ? 'replay-note' : undefined}>
                        {f.action === 'retry' ? 'Retry' : 'Replay webhook'}
                      </Button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState variant="plain" icon="check" title="No failures in the last 24 hours" />
          )}
          {failures.some((f) => f.action === 'replay') && manage ? (
            <p id="replay-note" className="m-0 border-t border-border px-4 py-2 text-[12px] text-fg-muted">
              Retry and Replay webhook run Sync now: the changed records are fetched from Xero again. Webhook processing is idempotent, so a replay never duplicates anything.
            </p>
          ) : null}
        </Card>
      </div>

      <Card padding="none" aria-labelledby="actions-h">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3.5">
          <div className="flex flex-col gap-0.5">
            <h2 id="actions-h" className="m-0 text-[15px] font-semibold">Write actions</h2>
            <p className="m-0 text-small text-fg-muted">Replace Make.com one action at a time. Dry-run records the requests without sending them. Live needs an admin and the typed phrase.</p>
          </div>
          {manage ? <Link href="/admin/integrations/xero/actions" className="text-small font-semibold text-accent-text">Runs and details</Link> : null}
        </div>
        <div className="relative overflow-x-auto">
          <table className={`${tableClass} min-w-[860px] text-small`}>
            <thead className={theadClass}><tr><th className="px-4 py-2">Action</th><th className="p-2">Trigger</th><th className="p-2">Last 7 days</th><th className="p-2">Mode</th><th className="py-2 pl-2 pr-4"><span className="sr-only">Diff</span></th></tr></thead>
            <tbody>
              {acts.actions.map((a) => (
                <tr key={a.action} className={`border-t border-border align-top ${manage && a.action === diffAction ? 'bg-accent-soft' : ''}`} data-testid={`action-${a.action}`}>
                  <td className="px-4 py-2.5"><span className="font-mono font-semibold">{a.action}</span>
                    {!WRITES_TO_XERO[a.action] ? <span className="mt-0.5 block text-[12px] text-fg-muted">{NO_XERO_WRITES_NOTE}</span> : null}
                    {dryRunDoesNothing(a.action, a.resolved.mode) ? <span className="mt-1 block rounded-xs bg-status-yellow-bg px-2 py-1 text-[12px] text-status-yellow-fg" data-testid={`dry-run-note-${a.action}`}>Dry run currently does nothing for this action: it only records what it would do.</span> : null}
                  </td>
                  <td className="px-2 py-2.5 text-fg-muted">{ACTION_TRIGGER[a.action]}</td>
                  <td className="px-2 py-2.5 text-fg-muted">{actionStats(acts.runs, a.action, now)}</td>
                  <td className="px-2 py-2.5">
                    <ActionModeControl action={a.action} mode={a.setting} canConfigure={configure} liveBlocked={a.liveBlocked} />
                    {a.resolved.downgraded ? <span className="mt-1 block text-[12px] text-status-yellow-fg">Runs as {MODE_LABEL[a.resolved.mode]}: {a.resolved.downgraded}</span> : null}
                  </td>
                  <td className="py-2.5 pl-2 pr-4 text-right">
                    {manage ? <Link href={`/admin/integrations/xero?diff=${encodeURIComponent(a.action)}#diff`} scroll={false} className={buttonClass('secondary', 30)} aria-label={`View dry-run diff for ${a.action}`}>View dry-run diff</Link> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {manage ? (
        <Card padding="none" id="diff" aria-labelledby="diff-h" data-testid="dry-run-diff">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3.5">
            <h2 id="diff-h" className="m-0 text-[15px] font-semibold">Dry-run diff · <span className="font-mono">{diffAction}</span></h2>
            {diffRun ? (
              <span className="text-[12px] text-fg-muted" data-testid="diff-run">
                Run <span className="font-mono">{diffRun.id.slice(0, 8)}</span> · <span className="font-mono">{diffRun.idempotency_key}</span> · {runStamp(diffRun.created_at, now)} · {diffRequests.length} {diffRequests.length === 1 ? 'request' : 'requests'}
              </span>
            ) : null}
          </div>
          {recentDry.length > 1 ? (
            <nav aria-label="Recent dry runs" className="flex flex-wrap gap-1.5 border-b border-border px-4 py-2 text-[12px]">
              {recentDry.map((r) => (
                <Link key={r.id} href={`/admin/integrations/xero?diff=${encodeURIComponent(diffAction)}&run=${r.id}#diff`} scroll={false}
                  aria-current={r.id === diffRun?.id ? 'true' : undefined}
                  className={`rounded-pill border px-2.5 py-1 font-mono no-underline ${r.id === diffRun?.id ? 'border-accent bg-accent-soft text-fg' : 'border-border text-fg-muted hover:text-fg'}`}>
                  {runStamp(r.created_at, now)}
                </Link>
              ))}
            </nav>
          ) : null}
          {!diffRun ? (
            <EmptyState variant="plain" icon="file" title="No dry run recorded yet" body={`Set ${diffAction} to Dry-run; the next trigger records what the portal would send to Xero here.`} />
          ) : diffRequests.length ? (
            <DryRunDiff key={diffRun.id} action={diffAction} requests={diffRequests} />
          ) : (
            <EmptyState variant="plain" icon="file" title="This dry run planned no Xero requests" body={WRITES_TO_XERO[diffAction] ? 'Nothing needed changing in Xero for this trigger.' : 'This action writes only our own entries and emails.'} />
          )}
        </Card>
      ) : null}

      {manage ? (
        <Card padding="md" as="div">
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-[15px] font-semibold">Check a month against Xero</h2>
            <p className="m-0 text-small text-fg-muted">Counts and totals per currency for quotes, invoices and payments: live from Xero (read only) and from the mirror.</p>
          </div>
          <MonthCheck defaultMonth={lastMonth} />
        </Card>
      ) : null}

      <p className="m-0 flex flex-wrap gap-x-3 gap-y-1 text-small">
        <Link href="/admin/xero/quotes" className="text-accent-text underline">Quotes</Link>
        <Link href="/admin/xero/invoices" className="text-accent-text underline">Invoices</Link>
        <Link href="/admin/deal-files" className="text-accent-text underline">Deal files</Link>
        {manage ? <Link href="/admin/integrations/xero/actions" className="text-accent-text underline">Xero actions</Link> : null}
        {can(member, 'settings.read') ? <Link href="/admin/settings/jobs" className="text-accent-text underline">Job runs</Link> : null}
      </p>
    </section>
  );
}
