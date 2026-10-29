import { createClient } from '@/lib/supabase/server';
import { requirePerm } from '@/lib/security/require';

export const metadata = { title: 'Admin · Trailers & Tankers' };

export default async function AdminHome() {
  const member = await requirePerm('admin.access');
  const supabase = await createClient();
  const [{ data: org }, { count: forms }] = await Promise.all([
    supabase.from('orgs').select('name, currency_code, timezone').eq('id', member.orgId).single(),
    supabase.from('forms').select('id', { count: 'exact', head: true }),
  ]);
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <dl className="grid grid-cols-2 gap-4 rounded-lg border bg-white p-4 text-sm sm:grid-cols-4">
        <div><dt className="text-neutral-500">Organisation</dt><dd data-testid="org-name">{org?.name ?? '-'}</dd></div>
        <div><dt className="text-neutral-500">Role</dt><dd data-testid="role">{member.role}</dd></div>
        <div><dt className="text-neutral-500">Forms</dt><dd data-testid="forms-count">{forms ?? 0}</dd></div>
        <div><dt className="text-neutral-500">Display</dt><dd>{org ? `${org.currency_code} · ${org.timezone}` : '-'}</dd></div>
      </dl>
    </section>
  );
}
