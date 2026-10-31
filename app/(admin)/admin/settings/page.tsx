import { forbidden, redirect } from 'next/navigation';
import { OrgForm } from '@/components/settings/OrgForm';
import { SettingsTabs } from '@/components/users/SettingsTabs';
import { loadOrg } from '@/lib/forms/org';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';
import { FX_SETTING_KEY, fxInputValue } from '@/lib/settings/fx';
import { FX_AUTO_KEY, FX_SOURCE_KEY, FX_UPDATED_AT_KEY, fxAutoOn, fxFeedUrl, fxUpdatedLabel } from '@/lib/settings/fx-feed';
import { FxFeedForm } from '@/components/settings/FxFeedForm';
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
  const [org, { data: fxRows }] = await Promise.all([
    loadOrg(db, member.orgId),
    db.from('app_settings').select('key, value').eq('org_id', member.orgId).in('key', [FX_SETTING_KEY, FX_AUTO_KEY, FX_UPDATED_AT_KEY, FX_SOURCE_KEY]),
  ]);
  const fxValue = (key: string) => (fxRows ?? []).find((r) => r.key === key)?.value;
  const fx = { value: fxValue(FX_SETTING_KEY) };
  const feedConfigured = fxFeedUrl(process.env.FX_RATE_URL, process.env.NODE_ENV === 'production') !== null;
  const fxUpdated = fx.value === undefined ? null : fxUpdatedLabel(fxValue(FX_UPDATED_AT_KEY), fxValue(FX_SOURCE_KEY), org.timezone);
  const all = Intl.supportedValuesOf('timeZone');
  const zones = ['Africa/Johannesburg', ...all.filter((z) => z !== 'Africa/Johannesburg')];
  if (!zones.includes(org.timezone)) zones.push(org.timezone);

  return (
    <section className="flex w-full min-w-0 max-w-[1360px] flex-col gap-4">
      <h1 className="text-h1">Settings</h1>
      <SettingsTabs member={member} current="organisation" />
      <OrgForm manage={manage} zones={zones} values={{ name: org.name, currency: org.currency, timezone: org.timezone, fxRate: fxInputValue(fx?.value) }} />
      <FxFeedForm manage={manage} auto={fxAutoOn(fxValue(FX_AUTO_KEY))} configured={feedConfigured} updated={fxUpdated} />
    </section>
  );
}
