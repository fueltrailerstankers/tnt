import { RecipientDialog } from '@/components/settings/RecipientDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusChip } from '@/components/ui/StatusChip';
import { tableClass, tableWrapClass, theadClass } from '@/components/ui/styles';
import { SettingsTabs } from '@/components/users/SettingsTabs';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { branchLabel, knownEventKeys, sortRecipients, type RecipientRow } from '@/lib/settings/recipients';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notification recipients · Trailers & Tankers' };

export default async function NotificationRecipients() {
  const member = await requirePerm('settings.read');
  const manage = can(member, 'settings.manage');
  // Caller's client: notification_recipients is readable with Settings read and writable with Settings write (RLS).
  const db = await createClient();
  const { data } = await db.from('notification_recipients').select('id, event_key, address, branch, active').eq('org_id', member.orgId).order('event_key').limit(500);
  const rows = sortRecipients((data ?? []) as RecipientRow[]);
  const keys = knownEventKeys(rows);

  return (
    <section className="flex w-full max-w-[1360px] flex-col gap-4">
      <h1 className="text-h1">Settings</h1>
      <SettingsTabs member={member} current="notifications" />
      <div className={tableWrapClass}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3.5">
          <p className="m-0 text-small text-fg-muted">Who gets emailed for each event. Branch blank = all branches. Every active recipient of an event is emailed.</p>
          {manage ? <RecipientDialog eventKeys={keys} /> : null}
        </div>
        {rows.length ? (
          <table className={`${tableClass} min-w-[720px]`} data-testid="recipients">
            <thead className={theadClass}>
              <tr><th className="px-4 py-2.5">Event key</th><th className="p-2.5">Address</th><th className="p-2.5">Branch</th><th className="p-2.5">State</th>{manage ? <th className="py-2.5 pl-2 pr-4 text-right">Actions</th> : null}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="h-11 border-t border-border" data-testid={`recipient-${r.id}`}>
                  <td className="px-4 font-mono text-small">{r.event_key}</td>
                  <td className="break-all px-2.5">{r.address}</td>
                  <td className="px-2.5 text-fg-muted">{branchLabel(r.branch)}</td>
                  <td className="px-2.5"><StatusChip status={r.active ? 'Active' : 'Paused'} color={r.active ? 'green' : 'gray'} size="sm" /></td>
                  {manage ? (
                    <td className="py-1.5 pl-2 pr-4 text-right">
                      <RecipientDialog eventKeys={keys} label={`Edit recipient ${r.event_key} ${r.address}`} recipient={{ id: r.id, eventKey: r.event_key, address: r.address, branch: r.branch, active: r.active }} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState variant="plain" icon="mail" title="No recipients yet" body="Add who should be emailed when forms are submitted, releases are created or jobs fail." />
        )}
      </div>
    </section>
  );
}
