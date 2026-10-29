import Link from 'next/link';
import { formatDateTime } from '@/lib/admin/grid';
import { loadOrg } from '@/lib/forms/org';
import { loadConnection } from '@/lib/integrations/xero/connection';
import { hasWriteScopes, parseMode, PLAN_ONLY, resolveMode, settingKey, WRITE_SCOPES, WRITES_TO_XERO } from '@/lib/integrations/xero/write/modes';
import { ACTIONS } from '@/lib/integrations/xero/write/types';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { MergePlanForm, ModeSwitch } from './forms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Xero actions · Trailers & Tankers' };

const ABOUT: Record<string, string> = {
  'deal.import_quote': 'DEAL Submit: copy quote lines 1-8 (description, item code) and the total from Xero into the DEAL.',
  'rfi.create_invoice': 'RFI Submit/Update: contact, quote SENT > ACCEPTED > INVOICED, invoice from the quote (once), attach RFI PDF and deposits.',
  'delivery.update_invoice': 'Delivery Note Submit/Update: VIN to the invoice Reference, attach delivery PDF, ID, payments, NATIS, photos, RFI PDF.',
  'release.on_paid': 'Invoice fully paid: create or update the RELEASE FORM entry and email the branches with the invoice and release PDFs.',
  'invoice.merge_attachments': 'On demand: plan merging an invoice\'s attachments into one PDF (plan only; needs pdf-lib).',
};

type RunRow = {
  id: string; action: string; mode: string; status: string; idempotency_key: string; reason: string | null; error: string | null;
  planned_requests: unknown; effects: unknown; expected: unknown; response_summary: unknown; created_at: string;
};

export default async function XeroActions() {
  const member = await requirePerm('integrations.manage');
  // xero_action_runs is admin-readable; the service client is used after the permission check, scoped by org.
  const db = createAdminClient();
  const [org, conn, { data: settings }, { data: runs }] = await Promise.all([
    loadOrg(db, member.orgId),
    loadConnection(db, member.orgId),
    db.from('app_settings').select('key, value, updated_at').eq('org_id', member.orgId).like('key', 'xero.action.%'),
    db.from('xero_action_runs')
      .select('id, action, mode, status, idempotency_key, reason, error, planned_requests, effects, expected, response_summary, created_at')
      .eq('org_id', member.orgId).order('created_at', { ascending: false }).limit(200),
  ]);
  const tz = org.timezone;
  const configure = can(member, 'xero.actions.configure');
  const writeScopes = hasWriteScopes(conn?.scopes);
  const setting = (a: string) => settings?.find((s) => s.key === settingKey(a as (typeof ACTIONS)[number]))?.value;
  const all = (runs ?? []) as RunRow[];

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Xero actions</h1>
      <div className="rounded-md border bg-surface shadow-card p-4 text-sm">
        <p>
          Every action starts <b>off</b>. <b>Dry run</b> records the Xero requests it would send and changes nothing in Xero.
          <b> Live</b> sends them, each claimed once. Live needs a connection with the write scopes ({WRITE_SCOPES.join(', ')}) and a typed confirmation; every change is audited.
        </p>
        <p className="mt-1 text-xs text-fg-muted">
          Connection: {conn?.status ?? 'not connected'} · write scopes: {writeScopes ? 'granted' : 'not granted (read-only)'} · <Link href="/admin/integrations/xero" className="underline">Xero health</Link>
        </p>
      </div>

      {ACTIONS.map((a) => {
        const r = resolveMode(a, setting(a), conn);
        const mine = all.filter((x) => x.action === a);
        const lastDry = mine.find((x) => x.mode === 'dry_run' && x.status !== 'skipped');
        const canLive = configure && !PLAN_ONLY[a] && (!WRITES_TO_XERO[a] || writeScopes);
        return (
          <div key={a} className="rounded-md border bg-surface shadow-card p-4 text-sm" data-testid={`action-${a}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold"><code>{a}</code></h2>
              <span className="text-xs">
                setting <b>{parseMode(setting(a))}</b> · runs as <b>{r.mode}</b>{r.downgraded ? ` (${r.downgraded})` : ''}
                {WRITES_TO_XERO[a] ? '' : ' · no Xero writes (dry run and live behave the same)'}
              </span>
            </div>
            <p className="mt-1 text-fg-muted">{ABOUT[a]}</p>
            {PLAN_ONLY[a] ? <p className="mt-1 text-xs text-status-yellow-fg">{PLAN_ONLY[a]}</p> : null}
            {configure ? <div className="mt-2"><ModeSwitch action={a} current={parseMode(setting(a))} canLive={canLive} /></div> : null}
            {a === 'invoice.merge_attachments' && configure ? <div className="mt-2"><MergePlanForm /></div> : null}

            <h3 className="mt-3 text-xs font-semibold uppercase text-fg-muted">Last runs</h3>
            <table className="w-full text-xs">
              <thead className="text-left text-fg-muted"><tr><th>When</th><th>Mode</th><th>Status</th><th>Key</th><th>Note</th></tr></thead>
              <tbody>
                {mine.slice(0, 8).map((x) => (
                  <tr key={x.id} className="border-t">
                    <td>{formatDateTime(x.created_at, tz)}</td><td>{x.mode}</td>
                    <td className={x.status === 'failed' ? 'text-status-red-fg' : ''}>{x.status}</td>
                    <td className="font-mono">{x.idempotency_key}</td>
                    <td>{x.error ?? x.reason ?? ''}</td>
                  </tr>
                ))}
                {!mine.length ? <tr><td colSpan={5} className="py-1 text-fg-muted">No runs yet.</td></tr> : null}
              </tbody>
            </table>

            {lastDry ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs">Latest dry run ({formatDateTime(lastDry.created_at, tz)}): planned requests (redacted)</summary>
                <pre className="mt-1 max-h-96 overflow-auto rounded bg-surface-2 p-2 text-[11px]" data-testid={`dry-run-${a}`}>
                  {JSON.stringify({ requests: lastDry.planned_requests, effects: lastDry.effects, expected: lastDry.expected }, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
