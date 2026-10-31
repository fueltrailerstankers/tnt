import Link from 'next/link';
import { ActionModeControl } from '@/components/integrations/ActionModeControl';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusChip } from '@/components/ui/StatusChip';
import { buttonClass, tableClass, theadClass } from '@/components/ui/styles';
import { loadConnection } from '@/lib/integrations/xero/connection';
import { dryRunDoesNothing, hasWriteScopes, NO_XERO_WRITES_NOTE, PLAN_ONLY, WRITE_SCOPES, WRITES_TO_XERO } from '@/lib/integrations/xero/write/modes';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { loadActions } from '@/lib/settings/xero-load';
import { ACTION_ABOUT, ACTION_TRIGGER, MODE_LABEL, runStamp } from '@/lib/settings/xero-page';
import { createAdminClient } from '@/lib/supabase/admin';
import { MergePlanForm } from './forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Xero actions · Trailers & Tankers' };

const STATUS_COLOR: Record<string, string> = { planned: 'yellow', sent: 'teal', succeeded: 'green', failed: 'red', skipped: 'gray' };

export default async function XeroActions() {
  const member = await requirePerm('integrations.manage');
  // xero_action_runs is admin-readable; the service client is used after the permission check, scoped by org.
  const db = createAdminClient();
  const now = Date.now();
  const conn = await loadConnection(db, member.orgId);
  const { actions, runs } = await loadActions(db, member.orgId, conn, now);
  const { data: errs } = await db.from('xero_action_runs').select('id, reason, error').eq('org_id', member.orgId)
    .gte('created_at', new Date(now - 30 * 86_400_000).toISOString()).order('created_at', { ascending: false }).limit(500);
  const note = new Map((errs ?? []).map((r) => [r.id as string, (r.error ?? r.reason ?? '') as string]));
  const configure = can(member, 'xero.actions.configure');
  const writeScopes = hasWriteScopes(conn?.scopes);

  return (
    <section className="flex w-full min-w-0 max-w-[1360px] flex-col gap-5">
      <div className="flex flex-col gap-1">
        <nav aria-label="Breadcrumb" className="text-small text-fg-muted">
          <ol className="m-0 flex list-none gap-1.5 p-0">
            <li>Integrations</li><li aria-hidden="true">/</li><li><Link href="/admin/integrations/xero" className="text-fg-muted underline">Xero</Link></li><li aria-hidden="true">/</li><li aria-current="page" className="text-fg">Actions</li>
          </ol>
        </nav>
        <h1 className="text-h1">Xero actions</h1>
      </div>
      <Card padding="sm">
        <p className="m-0 text-body">
          Every action starts <b>Off</b>. <b>Dry-run</b> records the Xero requests it would send and changes nothing in Xero.
          <b> Live</b> sends them, each claimed once. Live needs an admin, a connection with the write scopes ({WRITE_SCOPES.join(', ')}) and the typed phrase <code className="rounded-xs bg-surface-2 px-1 font-mono">LIVE &lt;action&gt;</code>; every change is audited.
        </p>
        <p className="m-0 text-small text-fg-muted">
          Connection: {conn?.status ?? 'not connected'} · write scopes: {writeScopes ? 'granted' : 'not granted (read-only)'} · <Link href="/admin/integrations/xero" className="text-accent-text underline">Xero integration</Link>
        </p>
      </Card>

      {actions.map((a) => {
        const mine = runs.filter((x) => x.action === a.action);
        const lastDry = mine.find((x) => x.mode === 'dry_run' && x.status !== 'skipped');
        return (
          <Card key={a.action} padding="md" className="gap-3" data-testid={`action-${a.action}`} aria-labelledby={`h-${a.action}`}>
            <CardHeader
              id={`h-${a.action}`}
              title={<span className="font-mono">{a.action}</span>}
              action={<span className="text-[12px] text-fg-muted">setting <b>{MODE_LABEL[a.setting]}</b> · runs as <b>{MODE_LABEL[a.resolved.mode]}</b>{a.resolved.downgraded ? ` (${a.resolved.downgraded})` : ''}</span>}
            />
            <p className="m-0 text-small text-fg-muted">{ACTION_ABOUT[a.action]} Trigger: {ACTION_TRIGGER[a.action]}.</p>
            {WRITES_TO_XERO[a.action] ? null : <p className="m-0 text-[12px] text-fg-muted">Note: {NO_XERO_WRITES_NOTE}.</p>}
            {dryRunDoesNothing(a.action, a.resolved.mode) ? (
              <p className="m-0 rounded-xs bg-status-yellow-bg px-2 py-1 text-[12px] text-status-yellow-fg" data-testid={`dry-run-note-${a.action}`}>
                Dry run currently does nothing for this action: it saves no entries and sends no emails, it only records what it would do. Live applies them.
              </p>
            ) : null}
            {PLAN_ONLY[a.action] ? <p className="m-0 text-[12px] text-status-yellow-fg">{PLAN_ONLY[a.action]}</p> : null}
            <ActionModeControl action={a.action} mode={a.setting} canConfigure={configure} liveBlocked={a.liveBlocked} />
            {a.action === 'invoice.merge_attachments' && configure ? <MergePlanForm /> : null}

            <h3 className="m-0 text-label font-semibold uppercase text-fg-muted">Last runs</h3>
            <div className="overflow-x-auto rounded-sm border border-border">
              <table className={`${tableClass} min-w-[640px] text-small`}>
                <thead className={theadClass}><tr><th className="p-2">When</th><th className="p-2">Mode</th><th className="p-2">Status</th><th className="p-2">Key</th><th className="p-2">Note</th></tr></thead>
                <tbody>
                  {mine.slice(0, 8).map((x) => (
                    <tr key={x.id} className="border-t border-border">
                      <td className="whitespace-nowrap p-2">{runStamp(x.created_at, now)}</td>
                      <td className="p-2">{MODE_LABEL[x.mode as keyof typeof MODE_LABEL] ?? x.mode}</td>
                      <td className="p-2"><StatusChip status={x.status} color={STATUS_COLOR[x.status] ?? 'gray'} size="sm" /></td>
                      <td className="p-2 font-mono">{x.idempotency_key}</td>
                      <td className="p-2">{note.get(x.id) ?? ''}</td>
                    </tr>
                  ))}
                  {!mine.length ? <tr><td colSpan={5} className="p-2 text-fg-muted">No runs in the last 30 days.</td></tr> : null}
                </tbody>
              </table>
            </div>
            {lastDry ? (
              <p className="m-0 text-small">
                <Link href={`/admin/integrations/xero?diff=${encodeURIComponent(a.action)}&run=${lastDry.id}#diff`} className={buttonClass('secondary', 32)}>View dry-run diff</Link>
              </p>
            ) : null}
          </Card>
        );
      })}
    </section>
  );
}
