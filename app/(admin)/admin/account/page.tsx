import Link from 'next/link';
import { Input, Label } from '@/components/ui/Field';
import { buttonClass, cardClass } from '@/components/ui/styles';
import { ActivityList } from '@/components/users/ActivityList';
import type { AuditRow } from '@/lib/activity/describe';
import { loadOrg } from '@/lib/forms/org';
import { accessOf, AREA_LABELS, AREAS, LEVEL_LABELS } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { PRESET_LABEL } from '@/lib/users/rules';
import { loadMember } from '@/lib/users/service';
import { saveMyName } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My account · Trailers & Tankers' };

export default async function Account({ searchParams }: { searchParams: Promise<{ saved?: string; password?: string; error?: string }> }) {
  const member = await requirePerm('admin.access');
  const sp = await searchParams;
  const db = await createClient();
  const [me, org, { data: rows }] = await Promise.all([
    loadMember(db, member.orgId, member.userId),
    loadOrg(db, member.orgId),
    // Own rows only (0021 audit_own_select lets every member read what they did).
    db.from('audit_log').select('id, created_at, actor_user, action, entity, entity_id, meta').eq('org_id', member.orgId)
      .eq('actor_user', member.userId).order('created_at', { ascending: false }).limit(20),
  ]);
  const access = accessOf(member);
  const names = new Map([[member.userId, me?.name ?? 'You']]);

  return (
    <section className="max-w-3xl space-y-5">
      <h1 className="text-h1">My account</h1>
      {sp.saved ? <p role="status" className="rounded-sm bg-status-green-bg p-3 text-status-green-fg">Saved.</p> : null}
      {sp.password ? <p role="status" className="rounded-sm bg-status-green-bg p-3 text-status-green-fg">Password changed.</p> : null}
      {sp.error ? <p role="alert" className="rounded-sm bg-status-red-bg p-3 text-status-red-fg">Enter a name of up to 120 characters.</p> : null}

      <form action={saveMyName} className={`${cardClass} space-y-3 p-4`}>
        <h2 className="text-h2">Profile</h2>
        <div>
          <Label htmlFor="name" required>Name</Label>
          <Input id="name" name="name" defaultValue={me?.name ?? ''} required maxLength={120} autoComplete="name" />
        </div>
        <p className="text-fg-muted">Email: <span className="break-all">{me?.email ?? '-'}</span></p>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass('primary', 44)}>Save name</button>
          <Link href="/admin/account/password" className={buttonClass('secondary', 44)}>Change password</Link>
        </div>
      </form>

      <div className={`${cardClass} p-4`}>
        <h2 className="mb-1 text-h2">Your access</h2>
        <p className="mb-2 text-fg-muted">{PRESET_LABEL(me?.preset ?? member.role)}. Ask an admin to change it.</p>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {AREAS.map((a) => <li key={a} className="flex justify-between gap-2"><span>{AREA_LABELS[a]}</span><span className="font-semibold">{LEVEL_LABELS[access[a]]}</span></li>)}
        </ul>
      </div>

      <div className={`${cardClass} p-4`}>
        <h2 className="mb-2 text-h2">Your recent activity</h2>
        <ActivityList rows={(rows ?? []) as AuditRow[]} names={names} timeZone={org.timezone} empty="No activity yet." />
      </div>
    </section>
  );
}
