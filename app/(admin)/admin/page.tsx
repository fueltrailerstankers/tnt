import Link from 'next/link';
import { formatDateTime } from '@/lib/admin/grid';
import { loadOrg } from '@/lib/forms/org';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { homeShowsForms } from '@/lib/ui/nav';

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
  // Factory staff have admin access but no entries: no form list, whose links would all be forbidden.
  const showForms = homeShowsForms(member);
  const loadForms = async () => (showForms ? (((await supabase.rpc('form_overview')).data ?? []) as Overview[]) : []);
  const [org, forms] = await Promise.all([loadOrg(supabase, member.orgId), loadForms()]);
  const recent = forms.filter((f) => f.last_activity).sort((a, b) => b.last_activity!.localeCompare(a.last_activity!)).slice(0, 3);

  return (
    <section className="space-y-6">
      <h1 className="text-h1">Admin</h1>
      <dl className="grid grid-cols-2 gap-4 rounded-md border bg-surface shadow-card p-4 text-sm sm:grid-cols-4">
        <div><dt className="text-fg-muted">Organisation</dt><dd data-testid="org-name">{org.name}</dd></div>
        <div><dt className="text-fg-muted">Role</dt><dd data-testid="role">{member.role}</dd></div>
        {showForms ? <div><dt className="text-fg-muted">Forms</dt><dd data-testid="forms-count">{forms.length}</dd></div> : null}
        <div><dt className="text-fg-muted">Display</dt><dd>{`${org.currency} · ${org.timezone}`}</dd></div>
      </dl>

      {recent.length ? (
        <div>
          <h2 className="mb-2 text-h2">Recent</h2>
          <ul className="grid gap-2 sm:grid-cols-3">
            {recent.map((f) => (
              <li key={f.form_id} className="rounded-md border bg-surface shadow-card p-3">
                <Link href={`/admin/forms/${f.slug}`} className="font-medium hover:underline">{f.name}</Link>
                <p className="text-xs text-fg-muted">Last activity {formatDateTime(f.last_activity, org.timezone)}</p>
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

      {showForms ? (
        <div>
          <h2 className="mb-2 text-h2">Forms</h2>
          <table className="w-full overflow-hidden rounded-md border bg-surface shadow-card text-sm">
            <thead className="bg-surface-2 text-left text-label tracking-normal text-fg-muted">
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
                      <Link href={`/admin/forms/${f.slug}?view=unread`} className="rounded-pill bg-accent px-2 py-0.5 text-xs font-semibold text-accent-fg" data-testid={`unread-${f.slug}`}>
                        {f.unread}
                      </Link>
                    ) : (
                      <span className="text-fg-muted">0</span>
                    )}
                  </td>
                  <td className="hidden p-2 sm:table-cell">
                    {f.is_active ? <Link href={`/f/${f.slug}`} className="underline">/f/{f.slug}</Link> : <span className="text-fg-muted">Off</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
