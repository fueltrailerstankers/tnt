/**
 * Creates (or repairs) the first admin: auth user, profile and admin membership.
 *
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm create-admin
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (load them from .env.local or your shell).
 * Prints only the user id. Never prints or stores the email or password.
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

config({ path: '.env.local' });

const input = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(12, 'ADMIN_PASSWORD must be at least 12 characters'),
  ADMIN_NAME: z.string().min(1).default('Administrator'),
  ORG_ID: z.string().uuid().optional(),
});

async function main() {
  const env = input.parse(process.env);
  const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const orgQuery = db.from('orgs').select('id');
  const { data: orgs, error: orgErr } = await (env.ORG_ID ? orgQuery.eq('id', env.ORG_ID) : orgQuery);
  if (orgErr) throw new Error(`Could not read orgs: ${orgErr.message}`);
  if (!orgs || orgs.length !== 1) throw new Error('Expected exactly one org; set ORG_ID to choose.');
  const orgId = orgs[0].id as string;

  let userId: string;
  const created = await db.auth.admin.createUser({
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
    email_confirm: true,
  });
  if (created.data.user) {
    userId = created.data.user.id;
  } else {
    // Already exists: look it up and reset the password so the script is re-runnable.
    const { data: list, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw new Error(`Could not create or find user: ${created.error?.message ?? error.message}`);
    const existing = list.users.find((u) => u.email?.toLowerCase() === env.ADMIN_EMAIL.toLowerCase());
    if (!existing) throw new Error(`Could not create user: ${created.error?.message}`);
    userId = existing.id;
    const upd = await db.auth.admin.updateUserById(userId, { password: env.ADMIN_PASSWORD, email_confirm: true });
    if (upd.error) throw new Error(`Could not update user: ${upd.error.message}`);
  }

  const profile = await db
    .from('profiles')
    .upsert({ id: userId, email: env.ADMIN_EMAIL, full_name: env.ADMIN_NAME, role: 'admin' }, { onConflict: 'id' });
  if (profile.error) throw new Error(`profiles upsert failed: ${profile.error.message}`);

  const member = await db
    .from('memberships')
    // Active admin with the admin preset (0014 fills the access map); also re-enables a disabled admin.
    .upsert({ org_id: orgId, user_id: userId, role: 'admin', status: 'active', disabled_at: null }, { onConflict: 'org_id,user_id' });
  if (member.error) throw new Error(`memberships upsert failed: ${member.error.message}`);

  const audit = await db.from('audit_log').insert({ org_id: orgId, actor_user: null, action: 'admin.provisioned', entity: 'user', entity_id: userId });
  if (audit.error) throw new Error(`audit insert failed: ${audit.error.message}`);

  console.log(`Admin ready. user id: ${userId}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'create-admin failed');
  process.exit(1);
});
