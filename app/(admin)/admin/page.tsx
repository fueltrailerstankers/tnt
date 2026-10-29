import Link from 'next/link';
import { formatDateTime } from '@/lib/admin/grid';
import { loadOrg } from '@/lib/forms/org';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';

export const metadata = { title: 'Admin · Trailers & Tankers' };

interface Overview {
  form_id: string;
  slug: string;
  name: string;
  is_active: boolean;
  entries: number;
  unread: number;
  last_activity: string | null;
}

export default async function AdminHome() {
  const member = await requirePerm('admin.access');
  const supabase = await createClient();
  const [org, { data }] = await Promise.all([loadOrg(supabase, member.orgId), supabase.rpc('form_overview')]);
  const forms = (data ?? []) as Overview[];
  const recent = forms.filter((f) => f.last_activity).sort((a, b) => b.last_activity!.localeCompare(a.last_activity!)).slice(0, 3);

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <dl className="grid grid-cols-2 gap-4 rounded-lg border bg-white p-4 text-sm sm:grid-cols-4">
        <div><dt className="text-neutral-500">Organisation</dt><dd data-testid="org-name">{org.name}</dd></div>
        <div><dt className="text-neutral-500">Role</dt><dd data-testid="role">{member.role}</dd></div>
        <div><dt className="text-neutral-500">Forms</dt><dd data-testid="forms-count">{forms.length}</dd></div>
        <div><dt className="text-neutral-500">Display</dt><dd>{`${org.currency} · ${org.timezone}`}</dd></div>
      </dl>

      {recent.length ? (
        <div>
          <h2 className="mb-2 text-lg font-semibold">Recent</h2>
          <ul className="grid gap-2 sm:grid-cols-3">
            {recent.map((f) => (
              <li key={f.form_id} className="rounded-lg border bg-white p-3">
                <Link href={`/admin/forms/${f.slug}`} className="font-medium hover:underline">{f.name}</Link>
                <p className="text-xs text-neutral-600">Last activity {formatDateTime(f.last_activity, org.timezone)}</p>
                <p className="mt-1 text-xs">
                  <Link href={`/admin/forms/${f.slug}`} className="underline">All Entries</Link>
                  {' · '}
                  <Link href={`/admin/forms/${f.slug}?view=status:Submitted`} className="underline">Submitted</Link>
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h2 className="mb-2 text-lg font-semibold">Forms</h2>
        <table className="w-full overflow-hidden rounded-lg border bg-white text-sm">
          <thead className="bg-neutral-100 text-left">
            <tr>
              <th className="p-2">Form</th>
              <th className="p-2 text-right">Entries</th>
              <th className="p-2 text-right">Unread</th>
              <th className="hidden p-2 sm:table-cell">Public link</th>
            </tr>
          </thead>
          <tbody>
            {forms.map((f) => (
              <tr key={f.form_id} className="border-t" data-testid={`form-row-${f.slug}`}>
                <td className="p-2">
                  <Link href={`/admin/forms/${f.slug}`} className="font-medium hover:underline">{f.name}</Link>
                </td>
                <td className="p-2 text-right tabular-nums">{f.entries}</td>
                <td className="p-2 text-right tabular-nums">
                  {f.unread ? (
                    <Link href={`/admin/forms/${f.slug}?view=unread`} className="rounded-full bg-neutral-900 px-2 py-0.5 text-xs text-white" data-testid={`unread-${f.slug}`}>
                      {f.unread}
                    </Link>
                  ) : (
                    <span className="text-neutral-500">0</span>
                  )}
                </td>
                <td className="hidden p-2 sm:table-cell">
                  {f.is_active ? <Link href={`/f/${f.slug}`} className="underline">/f/{f.slug}</Link> : <span className="text-neutral-500">Off</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
