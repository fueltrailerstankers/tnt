import Link from 'next/link';
import { AddUserForm } from '@/components/users/AddUserForm';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Add user · Trailers & Tankers' };

export default async function AddUser() {
  const member = await requirePerm('users.manage');
  const { data } = await createAdminClient().from('stock_locations').select('id, name, is_factory').eq('org_id', member.orgId).order('sort_order');
  const branches = ((data ?? []) as Array<{ id: string; name: string; is_factory: boolean }>).filter((b) => !b.is_factory);
  return (
    <section className="max-w-3xl space-y-4">
      <p className="text-small text-fg-muted"><Link href="/admin/settings/users" className="underline">Users & access</Link> / Add</p>
      <h1 className="text-h1">Add user</h1>
      <p className="text-fg-muted">Create the account yourself with a temporary password, for when invite emails are not an option.</p>
      <AddUserForm branches={branches} allowAdmin={member.role === 'admin'} />
    </section>
  );
}
