import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Input, Label, Select } from '@/components/ui/Field';
import { buttonClass, cardClass } from '@/components/ui/styles';
import { AccessMatrix } from '@/components/users/AccessMatrix';
import { requirePerm } from '@/lib/security/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { USER_ERRORS } from '@/lib/users/rules';
import { loadMember } from '@/lib/users/service';
import { saveUser } from '../../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit user · Trailers & Tankers' };

export default async function EditUser({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const member = await requirePerm('users.manage');
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const target = await loadMember(await createClient(), member.orgId, id);
  if (!target) notFound();
  const { data } = await createAdminClient().from('stock_locations').select('id, name, is_factory').eq('org_id', member.orgId).order('sort_order');
  const branches = ((data ?? []) as Array<{ id: string; name: string; is_factory: boolean }>).filter((b) => !b.is_factory);
  const self = target.userId === member.userId;

  return (
    <section className="max-w-3xl space-y-4">
      <p className="text-small text-fg-muted">
        <Link href="/admin/settings/users" className="underline">Users & access</Link> / <Link href={`/admin/settings/users/${target.userId}`} className="underline">{target.name}</Link> / Edit
      </p>
      <h1 className="text-h1">Edit {target.name}</h1>
      {sp.error ? <p role="alert" className="rounded-sm bg-status-red-bg p-3 text-status-red-fg">{USER_ERRORS[sp.error] ?? USER_ERRORS.input}</p> : null}
      <form action={saveUser.bind(null, target.userId)} className={`${cardClass} space-y-4 p-4`}>
        <div>
          <Label htmlFor="name" required>Name</Label>
          <Input id="name" name="name" defaultValue={target.name} required maxLength={120} />
        </div>
        <AccessMatrix
          initialRole={target.role}
          initialAccess={target.access}
          lockedReason={self ? 'You cannot change your own access. Ask another admin.' : undefined}
        />
        {branches.length ? (
          <div>
            <Label htmlFor="branch">Branch (optional)</Label>
            <Select id="branch" name="branch" defaultValue={target.branch ?? ''} className="max-w-xs">
              <option value="">All branches</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass('primary', 44)}>Save</button>
          <Link href={`/admin/settings/users/${target.userId}`} className={buttonClass('secondary', 44)}>Cancel</Link>
        </div>
      </form>
    </section>
  );
}
