import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { FX_SETTING_KEY, parseFxRate } from './fx';

/**
 * The org's ZAR -> USD display rate (app_settings 'fx.zar_usd'), or null. Service role, because app_settings rows are
 * readable through RLS only with Settings read, while the rate is shown to anyone who may see Xero money. Call only
 * after requirePerm; reads one non-secret key of the caller's own org.
 */
export async function loadFxRate(orgId: string): Promise<number | null> {
  try {
    const { data } = await createAdminClient().from('app_settings').select('value').eq('org_id', orgId).eq('key', FX_SETTING_KEY).maybeSingle();
    return parseFxRate(data?.value);
  } catch {
    return null;
  }
}
