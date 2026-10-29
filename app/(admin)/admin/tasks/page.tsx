import Link from 'next/link';
import { StatusChip } from '@/components/admin/StatusChip';
import { formatDateTime } from '@/lib/admin/grid';
import { loadForms } from '@/lib/forms/forms';
import { loadOrg } from '@/lib/forms/org';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';
import { statusColor, taskStatuses } from '@/lib/workflow/rules';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tasks · Trailers & Tankers' };

/** Entries waiting on staff: a non-generic action is open for the internal role, or a manual-approval status. */
export default async function Tasks() {
  const member = await requirePerm('tasks.read');
  const db = await createClient();
  const [forms, org] = await Promise.all([loadForms(db, member.orgId), loadOrg(db, member.orgId)]);
  const groups = await Promise.all(
    forms.map(async (form) => {
      const statuses = taskStatuses(form.spec);
      if (!statuses.length) return { form, statuses, rows: [] as Array<{ id: string; number: number; status: string; summary: string | null; updated_at: string }> };
      const { data } = await db.from('entries').select('id, number, status, summary, updated_at').eq('form_id', form.id).in('status', statuses).order('updated_at', { ascending: true }).limit(200);
      return { form, statuses, rows: data ?? [] };
    }),
  );
  const open = groups.filter((g) => g.statuses.length);
  const total = open.reduce((n, g) => n + g.rows.length, 0);

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Tasks</h1>
      <p className="text-sm text-neutral-600">{total} entr{total === 1 ? 'y waits' : 'ies wait'} on staff, oldest first.</p>
      {open.map(({ form, statuses, rows }) => (
        <div key={form.id} className="rounded-lg border bg-white" data-testid={`tasks-${form.slug}`}>
          <h2 className="border-b p-3 font-semibold">
            {form.spec.name} <span className="text-sm font-normal text-neutral-600">· {statuses.join(', ')}</span>
          </h2>
          {rows.length ? (
            <ul>
              {rows.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-t p-3 first:border-t-0">
                  <Link href={`/admin/forms/${form.slug}/entries/${e.number}`} className="underline">
                    #{e.number} {e.summary ?? ''}
                  </Link>
                  <span className="flex items-center gap-2 text-xs text-neutral-600">
                    <StatusChip status={e.status} color={statusColor(form.spec, e.status)} /> since {formatDateTime(e.updated_at, org.timezone)}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="p-3 text-sm text-neutral-600">Nothing waiting.</p>}
        </div>
      ))}
    </section>
  );
}
