import { forbidden, redirect } from 'next/navigation';
import { OrgForm } from '@/components/settings/OrgForm';
import { SettingsTabs } from '@/components/users/SettingsTabs';
import { loadOrg } from '@/lib/forms/org';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { FX_SETTING_KEY, fxInputValue } from '@/lib/settings/fx';
import { createClient } from '@/lib/supabase/server';
import { settingsTabs } from '@/lib/ui/settings-tabs';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings · Trailers & Tankers' };

export default async function Settings() {
  const member = await requirePerm('admin.access');
  if (!can(member, 'settings.read')) {
    // Settings is one menu with tabs from three areas: open the first tab this member can read.
    const first = settingsTabs(member)[0];
    if (first) redirect(first.href);
    forbidden();
  }
  const manage = can(member, 'settings.manage');
  // Caller's client: orgs and app_settings are readable with Settings read (RLS).
  const db = await createClient();
  const [org, { data: fx }] = await Promise.all([
    loadOrg(db, member.orgId),
    db.from('app_settings').select('value').eq('org_id', member.orgId).eq('key', FX_SETTING_KEY).maybeSingle(),
  ]);
  const all = Intl.supportedValuesOf('timeZone');
  const zones = ['Africa/Johannesburg', ...all.filter((z) => z !== 'Africa/Johannesburg')];
  if (!zones.includes(org.timezone)) zones.push(org.timezone);

  return (
    <section className="flex w-full max-w-[1360px] flex-col gap-4">
      <h1 className="text-h1">Settings</h1>
      <SettingsTabs member={member} current="organisation" />
      <OrgForm manage={manage} zones={zones} values={{ name: org.name, currency: org.currency, timezone: org.timezone, fxRate: fxInputValue(fx?.value) }} />
    </section>
  );
}
