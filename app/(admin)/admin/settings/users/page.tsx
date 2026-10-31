import Link from 'next/link';
import { StatusChip } from '@/components/ui/StatusChip';
import { buttonClass, tableClass, tableWrapClass, theadClass } from '@/components/ui/styles';
import { RemoveUserButton } from '@/components/users/RemoveUserButton';
import { SettingsTabs } from '@/components/users/SettingsTabs';
import { formatDateTime } from '@/lib/admin/grid';
import { loadOrg } from '@/lib/forms/org';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { inviteState, PRESET_LABEL, STATUS_COLOR, STATUS_LABEL, USER_ERRORS } from '@/lib/users/rules';
import { listMembers } from '@/lib/users/service';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users & access · Trailers & Tankers' };

export default async function Users({ searchParams }: { searchParams: Promise<{ removed?: string; error?: string }> }) {
  const member = await requirePerm('users.read');
  const sp = await searchParams;
  const db = await createClient();
  const [members, org] = await Promise.all([listMembers(db, member.orgId), loadOrg(db, member.orgId)]);
  const tz = org.timezone;
  const manage = can(member, 'users.manage');

  return (
    <section className="max-w-5xl space-y-6">
      <h1 className="text-h1">Settings</h1>
      <SettingsTabs member={member} current="users" />
      {sp.removed ? <p role="status" className="rounded-sm bg-status-green-bg p-3 text-status-green-fg">Removed from the organisation. Their history stays in the activity log.</p> : null}
      {sp.error ? <p role="alert" className="rounded-sm bg-status-red-bg p-3 text-status-red-fg">{USER_ERRORS[sp.error] ?? USER_ERRORS.input}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-fg-muted">{members.length} {members.length === 1 ? 'member' : 'members'}. Each has an access level per menu: None, Read or Write.</p>
        {manage ? (
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/settings/users/invite" className={buttonClass('primary', 44)}>Invite user</Link>
            <Link href="/admin/settings/users/add" className={buttonClass('secondary', 44)}>Add user</Link>
          </div>
        ) : null}
      </div>

      <div className={tableWrapClass}>
        <table className={`${tableClass} min-w-[720px]`}>
          <thead className={theadClass}>
            <tr>
              <th className="p-2.5">Name</th>
              <th className="p-2.5">Email</th>
              <th className="p-2.5">Access</th>
              <th className="p-2.5">Status</th>
              <th className="p-2.5">Invite</th>
              <th className="p-2.5">Last sign-in</th>
              <th className="p-2.5">Last seen</th>
              {manage ? <th className="p-2.5"><span className="sr-only">Actions</span></th> : null}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const inv = inviteState(m);
              // Same guards as the server: not yourself, and only an admin removes an admin.
              const canRemove = manage && m.userId !== member.userId && (member.role === 'admin' || m.role !== 'admin');
              return (
              <tr key={m.userId} className="border-t border-border" data-testid={`user-row-${m.userId}`}>
                <td className="p-2.5"><Link href={`/admin/settings/users/${m.userId}`} className="font-semibold underline">{m.name}</Link>{m.userId === member.userId ? <span className="ml-1 text-fg-muted">(you)</span> : null}</td>
                <td className="p-2.5 break-all">{m.email ?? '-'}</td>
                <td className="p-2.5">{PRESET_LABEL(m.preset)}</td>
                <td className="p-2.5"><StatusChip status={STATUS_LABEL[m.status]} color={STATUS_COLOR[m.status]} size="sm" /></td>
                <td className="p-2.5 whitespace-nowrap" data-testid={`invite-${m.userId}`}>
                  <StatusChip status={inv.label} color={inv.color} size="sm" />
                  {inv.at ? <span className="mt-0.5 block text-small text-fg-muted">{inv.label === 'Pending' ? 'Sent' : 'On'} {formatDateTime(inv.at, tz)}</span> : null}
                </td>
                <td className="p-2.5 whitespace-nowrap">{m.lastSignInAt ? formatDateTime(m.lastSignInAt, tz) : '-'}</td>
                <td className="p-2.5 whitespace-nowrap">{m.lastSeenAt ? formatDateTime(m.lastSeenAt, tz) : '-'}</td>
                {manage ? <td className="p-2.5 text-right">{canRemove ? <RemoveUserButton userId={m.userId} name={m.name} /> : null}</td> : null}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
