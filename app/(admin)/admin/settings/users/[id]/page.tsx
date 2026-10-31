import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { StatusChip } from '@/components/ui/StatusChip';
import { buttonClass, cardClass } from '@/components/ui/styles';
import { InviteLinkButton } from '@/components/users/InviteLinkButton';
import { ActivityList } from '@/components/users/ActivityList';
import { formatDateTime } from '@/lib/admin/grid';
import type { AuditRow } from '@/lib/activity/describe';
import { loadOrg } from '@/lib/forms/org';
import { AREA_LABELS, AREAS, can, LEVEL_LABELS } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { PRESET_LABEL, STATUS_COLOR, STATUS_LABEL, USER_ERRORS } from '@/lib/users/rules';
import { loadMember, memberNames } from '@/lib/users/service';
import { disableUser, enableUser, removeUser, resendInvite } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'User · Trailers & Tankers' };

const SAVED: Record<string, string> = { '1': 'Saved.', disabled: 'Disabled. Their access stopped and their sessions are signed out.', enabled: 'Enabled.' };
const AUDIT_COLS = 'id, created_at, actor_user, action, entity, entity_id, meta';

export default async function UserDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; sent?: string; error?: string }> }) {
  const member = await requirePerm('users.read');
  const { id } = await params;
  if (!z.guid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const db = await createClient();
  const [target, org] = await Promise.all([loadMember(db, member.orgId, id), loadOrg(db, member.orgId)]);
  if (!target) notFound();
  const tz = org.timezone;
  const manage = can(member, 'users.manage');
  const self = target.userId === member.userId;
  const history = can(member, 'audit.read');

  // Their history: what they did, and sign-ins (failed ones carry no actor, only the account id). RLS: Activity read.
  const [names, actions, signIns] = history
    ? await Promise.all([
      memberNames(member.orgId),
      db.from('audit_log').select(AUDIT_COLS).eq('org_id', member.orgId).eq('actor_user', target.userId).order('created_at', { ascending: false }).limit(20),
      db.from('audit_log').select(AUDIT_COLS).eq('org_id', member.orgId).like('action', 'auth.%')
        .or(`actor_user.eq.${target.userId},entity_id.eq.${target.userId}`).order('created_at', { ascending: false }).limit(20),
    ])
    : [new Map<string, string>(), { data: [] }, { data: [] }];

  const dates: Array<[string, string | null]> = [
    ['Invited', target.invitedAt], ['Accepted', target.acceptedAt], ['Last sign-in', target.lastSignInAt],
    ['Last seen', target.lastSeenAt], ['Disabled', target.disabledAt],
  ];

  return (
    <section className="max-w-4xl space-y-5">
      <p className="text-small text-fg-muted"><Link href="/admin/settings/users" className="underline">Users & access</Link> / {target.name}</p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-h1">{target.name}</h1>
        <StatusChip status={STATUS_LABEL[target.status]} color={STATUS_COLOR[target.status]} />
        {self ? <span className="text-fg-muted">(you)</span> : null}
      </div>
      {sp.saved ? <p role="status" className="rounded-sm bg-status-green-bg p-3 text-status-green-fg">{SAVED[sp.saved] ?? 'Saved.'}</p> : null}
      {sp.sent ? <p role="status" className="rounded-sm bg-status-green-bg p-3 text-status-green-fg">Invite email sent again.</p> : null}
      {sp.error ? <p role="alert" className="rounded-sm bg-status-red-bg p-3 text-status-red-fg">{USER_ERRORS[sp.error] ?? USER_ERRORS.input}</p> : null}

      <dl className={`${cardClass} grid grid-cols-2 gap-3 p-4 sm:grid-cols-4`}>
        <div className="col-span-2"><dt className="text-small text-fg-muted">Email</dt><dd className="break-all">{target.email ?? '-'}</dd></div>
        <div><dt className="text-small text-fg-muted">Access</dt><dd data-testid="user-preset">{PRESET_LABEL(target.preset)}</dd></div>
        <div><dt className="text-small text-fg-muted">Branch</dt><dd>{target.branch ?? 'All branches'}</dd></div>
        {dates.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><dt className="text-small text-fg-muted">{k}</dt><dd>{formatDateTime(v, tz)}</dd></div>
        ))}
      </dl>

      {manage ? (
        <div className={`${cardClass} space-y-3 p-4`}>
          <h2 className="text-h2">Manage</h2>
          <div className="flex flex-wrap gap-2">
            <Link href={`/admin/settings/users/${target.userId}/edit`} className={buttonClass('primary', 44)}>Edit access</Link>
            {target.status === 'invited' && target.inviteNewAccount ? (
              <form action={resendInvite.bind(null, target.userId)}><button className={buttonClass('secondary', 44)}>Resend invite</button></form>
            ) : null}
            {!self && target.status !== 'disabled' ? (
              <form action={disableUser.bind(null, target.userId)}><button className={buttonClass('secondary', 44)}>Disable</button></form>
            ) : null}
            {target.status === 'disabled' ? (
              <form action={enableUser.bind(null, target.userId)}><button className={buttonClass('secondary', 44)}>Enable</button></form>
            ) : null}
          </div>
          {target.status === 'invited' && target.inviteNewAccount ? <InviteLinkButton userId={target.userId} /> : null}
          {target.status === 'invited' && !target.inviteNewAccount ? <p className="text-fg-muted">This person already had an account: they accept by signing in with their own password. No invite link is made for existing accounts.</p> : null}
          {!self ? (
            <details className="rounded-sm border border-border p-3">
              <summary className="cursor-pointer font-semibold">{target.status === 'invited' ? 'Cancel invite' : 'Remove from organisation'}</summary>
              <form action={removeUser.bind(null, target.userId)} className="mt-3 space-y-3">
                <p className="text-fg-muted">{target.status === 'invited' ? 'The invite link stops working. You can invite them again later.' : 'They lose access to this organisation. Their history stays in the activity log.'}</p>
                <label className="flex items-center gap-2"><input type="checkbox" name="confirm" value="remove" required className="size-5" /> Yes, {target.status === 'invited' ? 'cancel the invite for' : 'remove'} {target.name}</label>
                <button className={buttonClass('destructive', 44)}>{target.status === 'invited' ? 'Cancel invite' : 'Remove'}</button>
              </form>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className={`${cardClass} p-4`}>
        <h2 className="mb-2 text-h2">Access</h2>
        <table className="w-full text-body">
          <tbody>
            {AREAS.map((a) => (
              <tr key={a} className="border-t border-border first:border-t-0">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal">{AREA_LABELS[a]}</th>
                <td className="py-1.5 text-right font-semibold" data-testid={`access-${a}`}>{LEVEL_LABELS[target.access[a]]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {history ? (
        <>
          <div className={`${cardClass} p-4`}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-h2">History</h2>
              <Link href={`/admin/settings/activity?user=${target.userId}`} className="underline">Full activity log</Link>
            </div>
            <ActivityList rows={(actions.data ?? []) as AuditRow[]} names={names} timeZone={tz} empty="No activity yet." />
          </div>
          <div className={`${cardClass} p-4`}>
            <h2 className="mb-2 text-h2">Sign-ins</h2>
            <ActivityList rows={(signIns.data ?? []) as AuditRow[]} names={names} timeZone={tz} empty="No sign-ins yet." />
          </div>
        </>
      ) : <p className="text-fg-muted">History is in the activity log, which needs Activity log access.</p>}
    </section>
  );
}
