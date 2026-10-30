import Link from 'next/link';
import { InviteForm } from '@/components/users/InviteForm';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Invite user · Trailers & Tankers' };

export default async function InviteUser() {
  const member = await requirePerm('users.manage');
  // Branch choices are the org's stock locations (service role after users.manage: the inviter may lack Stock read).
  const { data } = await createAdminClient().from('stock_locations').select('id, name, is_factory').eq('org_id', member.orgId).order('sort_order');
  const branches = ((data ?? []) as Array<{ id: string; name: string; is_factory: boolean }>).filter((b) => !b.is_factory);

  return (
    <section className="max-w-3xl space-y-4">
      <p className="text-small text-fg-muted"><Link href="/admin/settings/users" className="underline">Users & access</Link> / Invite</p>
      <h1 className="text-h1">Invite user</h1>
      <p className="text-fg-muted">Pick a preset, then change any area. The person gets no access until they accept the invite and set a password.</p>
      <InviteForm branches={branches} allowAdmin={member.role === 'admin'} />
    </section>
  );
}
