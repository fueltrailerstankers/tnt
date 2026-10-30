import { redirect } from 'next/navigation';
import { SettingsTabs } from '@/components/users/SettingsTabs';
import { loadOrg } from '@/lib/forms/org';
import { assertPerm, can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { settingsTabs } from '@/lib/ui/settings-tabs';
import { saveOrg } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings · Trailers & Tankers' };

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const member = await requirePerm('admin.access');
  if (!can(member, 'settings.read')) {
    // Settings is one menu with tabs from three areas: open the first tab this member can read.
    const first = settingsTabs(member)[0];
    if (first) redirect(first.href);
    assertPerm(member, 'settings.read');
  }
  const manage = can(member, 'settings.manage');
  const sp = await searchParams;
  const db = await createClient();
  const org = await loadOrg(db, member.orgId);
  const zones = Intl.supportedValuesOf('timeZone');

  return (
    <section className="max-w-3xl space-y-6">
      <h1 className="text-h1">Settings</h1>
      <SettingsTabs member={member} current="organisation" />
      {sp.saved ? <p role="status" className="rounded bg-status-green-bg p-3 text-sm">Saved.</p> : null}
      {sp.error ? <p role="alert" className="rounded bg-status-red-bg p-3 text-sm">Check the values and try again.</p> : null}

      <form action={saveOrg} className="space-y-3 rounded-md border bg-surface shadow-card p-4 text-sm">
        <h2 className="font-semibold">Organisation</h2>
        <fieldset disabled={!manage} className="space-y-3">
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
        </fieldset>
        {manage ? <button className="rounded-pill bg-accent px-3.5 py-1.5 font-semibold text-accent-fg">Save</button>
          : <p className="text-fg-muted">Read only: you can view these settings but not change them.</p>}
      </form>
    </section>
  );
}
