import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface OrgSettings {
  id: string;
  name: string;
  currency: string;
  timezone: string;
}

export async function loadOrg(db: SupabaseClient, orgId: string): Promise<OrgSettings> {
  const { data } = await db.from('orgs').select('id, name, currency_code, timezone').eq('id', orgId).maybeSingle();
  return {
    id: orgId,
    name: data?.name ?? 'Trailers & Tankers',
    currency: data?.currency_code ?? 'USD',
    timezone: data?.timezone ?? 'Africa/Johannesburg',
  };
}
