'use server';

import { revalidatePath } from 'next/cache';
import { FX_SETTING_KEY, fxInputValue } from '@/lib/settings/fx';
import { orgChanges, parseOrgForm, type OrgFieldErrors } from '@/lib/settings/org';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export type OrgState = { ok?: boolean; errors?: OrgFieldErrors; error?: string };

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : undefined);

/**
 * Settings > Organisation: name, display currency (USD/ZAR), timezone and the manual ZAR -> USD rate
 * (app_settings 'fx.zar_usd', a positive decimal string, USD per 1 ZAR; blank removes it). settings.manage only.
 * Writes go through the caller's client, so RLS (Settings write) applies too. Audited: field names, currency,
 * timezone and the rate; never anything personal.
 */
export async function saveOrg(_prev: OrgState, fd: FormData): Promise<OrgState> {
  const member = await requirePerm('settings.manage');
  const parsed = parseOrgForm({
    name: str(fd.get('name')), timezone: str(fd.get('timezone')), currency: str(fd.get('currency')),
    fxSource: str(fd.get('fxSource')), fxRate: str(fd.get('fxRate')) ?? null,
  });
  if (!parsed.ok) return { errors: parsed.errors };
  const v = parsed.value;
  const db = await createClient();
  const [{ data: org }, { data: fx }] = await Promise.all([
    db.from('orgs').select('name, timezone, currency_code').eq('id', member.orgId).maybeSingle(),
    db.from('app_settings').select('value').eq('org_id', member.orgId).eq('key', FX_SETTING_KEY).maybeSingle(),
  ]);
  if (!org) return { error: 'The organisation could not be read. Reload and try again.' };
  const beforeFx = fxInputValue(fx?.value) || null;
  const { changed, fxChanged } = orgChanges({ name: org.name, timezone: org.timezone, currency: org.currency_code, fxRate: beforeFx }, v);

  if (changed.length) {
    const { error } = await db.from('orgs').update({ name: v.name, timezone: v.timezone, currency_code: v.currency }).eq('id', member.orgId);
    if (error) return { error: 'The settings could not be saved.' };
  }
  if (fxChanged) {
    const { error } = v.fxRate === null
      ? await db.from('app_settings').delete().eq('org_id', member.orgId).eq('key', FX_SETTING_KEY)
      : await db.from('app_settings').upsert(
        { org_id: member.orgId, key: FX_SETTING_KEY, value: v.fxRate, updated_by: member.userId, updated_at: new Date().toISOString() },
        { onConflict: 'org_id,key' },
      );
    if (error) return { error: 'The rate could not be saved.' };
  }

  // audit_log is append-only and server-written.
  const admin = createAdminClient();
  if (changed.length) {
    await admin.from('audit_log').insert({ org_id: member.orgId, actor_user: member.userId, action: 'settings.org', entity: 'org', entity_id: member.orgId, meta: { changed, timezone: v.timezone, currency: v.currency } });
  }
  if (fxChanged) {
    await admin.from('audit_log').insert({
      org_id: member.orgId, actor_user: member.userId, action: 'settings.fx', entity: 'app_setting', entity_id: FX_SETTING_KEY, meta: { from: beforeFx, to: v.fxRate, source: 'manual' },
    });
  }
  revalidatePath('/admin', 'layout');
  return { ok: true };
}
