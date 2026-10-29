import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { serverEnv } from '@/lib/env';

/**
 * Service-role client: bypasses RLS. Only call it after can()/requirePerm has passed
 * (or for flows with no user, such as signed webhooks). Never expose its results unfiltered.
 */
export function createAdminClient() {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
