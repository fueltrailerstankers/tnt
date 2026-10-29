import Link from 'next/link';
import { loadForms } from '@/lib/forms/forms';
import { loadOrg } from '@/lib/forms/org';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { saveOrg } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings · Trailers & Tankers' };

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const member = await requirePerm('settings.manage');
  const sp = await searchParams;
  const db = await createClient();
  const [org, forms, { data: members }, { data: profiles }] = await Promise.all([
    loadOrg(db, member.orgId),
    loadForms(db, member.orgId),
    db.from('memberships').select('user_id, role, branch, created_at').eq('org_id', member.orgId),
    db.from('profiles').select('id, full_name'),
  ]);
  const zones = Intl.supportedValuesOf('timeZone');

  return (
    <section className="max-w-3xl space-y-6">
      <h1 className="text-h1">Settings</h1>
      {sp.saved ? <p role="status" className="rounded bg-status-green-bg p-3 text-sm">Saved.</p> : null}
      {sp.error ? <p role="alert" className="rounded bg-status-red-bg p-3 text-sm">Check the values and try again.</p> : null}

      <form action={saveOrg} className="space-y-3 rounded-md border bg-surface shadow-card p-4 text-sm">
        <h2 className="font-semibold">Organisation</h2>
        <label className="block">
          <span className="text-xs text-fg-muted">Name</span>
          <input name="name" defaultValue={org.name} required maxLength={120} className="w-full rounded-sm border px-2 py-1" />
        </label>
        <label className="block">
          <span className="text-xs text-fg-muted">Display timezone</span>
          <select name="timezone" defaultValue={org.timezone} className="w-full rounded-sm border px-2 py-1">
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-fg-muted">Default currency (display and entry fallback; money rows keep their own code)</span>
          <input name="currency" defaultValue={org.currency} required pattern="[A-Z]{3}" maxLength={3} className="w-24 rounded-sm border px-2 py-1 uppercase" />
        </label>
        <button className="rounded-pill bg-accent px-3.5 py-1.5 font-semibold text-accent-fg">Save</button>
      </form>

      <div className="rounded-md border bg-surface shadow-card p-4 text-sm">
        <h2 className="mb-2 font-semibold">Users and roles</h2>
        <p className="mb-2 text-fg-muted">One admin for now. Roles (admin, staff, reviewer, inspector, factory) are modelled; inviting users comes with access setup.</p>
        <ul className="divide-y">
          {(members ?? []).map((m) => (
            <li key={m.user_id} className="flex justify-between py-2">
              <span>{(profiles ?? []).find((p) => p.id === m.user_id)?.full_name ?? 'User'}</span>
              <span className="text-fg-muted">{m.role}{m.branch ? ` · ${m.branch}` : ''}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-md border bg-surface shadow-card p-4 text-sm">
        <h2 className="mb-2 font-semibold">Forms</h2>
        <ul className="divide-y">
          {forms.map((f) => (
            <li key={f.id} className="flex justify-between py-2">
              <span>{f.spec.name}</span>
              <Link href={`/admin/forms/${f.slug}/settings`} className="underline">Public link and recipients</Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
