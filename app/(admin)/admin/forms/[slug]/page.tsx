import Link from 'next/link';
import { StatusChip } from '@/components/admin/StatusChip';
import { adminForm } from '@/lib/admin/context';
import { columnChoices, formatDateTime, PAGE_SIZE, parseGridQuery } from '@/lib/admin/grid';
import { listEntries } from '@/lib/admin/list';
import { can } from '@/lib/security/can';
import { inputFields } from '@/lib/spec/types';
import { displayValue } from '@/lib/spec/values';
import { NEW_ENTRY_STATUS, statusColor } from '@/lib/workflow/rules';
import { markRead } from './actions';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

export default async function EntriesGrid({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SP> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const { member, userDb, form, org } = await adminForm(slug, 'entries.read');
  const spec = form.spec;
  const q = parseGridQuery(spec, sp);
  const { rows, total } = await listEntries(userDb, form, q, org.timezone, PAGE_SIZE, (q.page - 1) * PAGE_SIZE);
  const choices = columnChoices(spec);
  const label = Object.fromEntries(choices.map((c) => [c.name, c.label]));
  const protectedFields = new Set(inputFields(spec).filter((f) => f.type === 'email' && f.protected).map((f) => f.name));
  const reveal = member.role === 'admin';
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const qs = (over: Record<string, string | null>) => {
    const u = new URLSearchParams();
    const base: Record<string, string | null> = {
      view: q.view === 'status' ? `status:${q.status}` : q.view === 'unread' ? 'unread' : null,
      q: q.q, from: q.from, to: q.to, cols: q.cols.join(','), page: q.page > 1 ? String(q.page) : null,
    };
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `?${s}` : '';
  };
  const views: Array<[string, string | null]> = [
    ['All Entries', null],
    ['Unread', 'unread'],
    ...spec.workflow.statuses.filter((s) => !s.archived).map((s) => [s.name, `status:${s.name}`] as [string, string]),
  ];
  const currentView = q.view === 'status' ? `status:${q.status}` : q.view === 'unread' ? 'unread' : null;
  const back = `/admin/forms/${slug}${qs({})}`;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-neutral-600"><Link href="/admin" className="underline">Home</Link> / Forms</p>
          <h1 className="text-2xl font-semibold">{spec.name}</h1>
          <p className="text-sm text-neutral-600">{total} entr{total === 1 ? 'y' : 'ies'}{form.encrypt ? ' · encrypted form: search covers the summary only' : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {can(member, 'entries.write') ? <Link href={`/admin/forms/${slug}/new`} className="rounded bg-neutral-900 px-3 py-2 text-white">New entry</Link> : null}
          {can(member, 'entries.export') ? (
            <>
              <a href={`/admin/forms/${slug}/export${qs({ format: 'csv', page: null })}`} className="rounded border bg-white px-3 py-2">Export CSV</a>
              <a href={`/admin/forms/${slug}/export${qs({ format: 'xlsx', page: null })}`} className="rounded border bg-white px-3 py-2">Export XLSX</a>
            </>
          ) : null}
          {form.isActive ? <Link href={`/f/${slug}`} className="rounded border bg-white px-3 py-2">Public link</Link> : null}
          {can(member, 'forms.manage') ? <Link href={`/admin/forms/${slug}/settings`} className="rounded border bg-white px-3 py-2">Form settings</Link> : null}
        </div>
      </div>

      <nav aria-label="Views" className="flex flex-wrap gap-1 text-sm">
        {views.map(([name, v]) => (
          <Link key={name} href={`/admin/forms/${slug}${qs({ view: v, page: null })}`} aria-current={v === currentView ? 'page' : undefined}
            className={`rounded-full px-3 py-1 ${v === currentView ? 'bg-neutral-900 text-white' : 'border bg-white'}`}>
            {name}
          </Link>
        ))}
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-3 text-sm">
        {currentView ? <input type="hidden" name="view" value={currentView} /> : null}
        <label className="flex flex-col">
          <span className="text-xs text-neutral-600">Search</span>
          <input name="q" defaultValue={q.q ?? ''} className="rounded border px-2 py-1" placeholder="Search entries" />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-neutral-600">From</span>
          <input type="date" name="from" defaultValue={q.from ?? ''} className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-neutral-600">To</span>
          <input type="date" name="to" defaultValue={q.to ?? ''} className="rounded border px-2 py-1" />
        </label>
        <details className="relative">
          <summary className="cursor-pointer rounded border px-2 py-1">Columns</summary>
          <div className="absolute z-10 mt-1 max-h-72 w-72 overflow-y-auto rounded border bg-white p-2 shadow">
            {choices.map((c) => (
              <label key={c.name} className="flex items-center gap-2 py-0.5">
                <input type="checkbox" name="cols" value={c.name} defaultChecked={q.cols.includes(c.name)} /> {c.label}
              </label>
            ))}
          </div>
        </details>
        <button className="rounded bg-neutral-900 px-3 py-1 text-white">Apply</button>
        <Link href={`/admin/forms/${slug}`} className="px-2 py-1 underline">Clear</Link>
      </form>

      <form action={markRead.bind(null, slug)}>
        <input type="hidden" name="back" value={back} />
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-100 text-left">
              <tr>
                <th className="p-2"><span className="sr-only">Select</span></th>
                <th className="p-2">#</th>
                <th className="p-2">Summary</th>
                <th className="p-2">Status</th>
                {q.cols.map((c) => <th key={c} className="p-2">{label[c]}</th>)}
                <th className="p-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className={`border-t ${!e.isRead && e.status !== NEW_ENTRY_STATUS ? 'font-semibold' : ''}`} data-testid={`entry-${e.number}`}>
                  <td className="p-2"><input type="checkbox" name="id" value={e.id} aria-label={`Select entry ${e.number}`} /></td>
                  <td className="p-2 tabular-nums"><Link href={`/admin/forms/${slug}/entries/${e.number}`} className="underline">{e.number}</Link></td>
                  <td className="p-2"><Link href={`/admin/forms/${slug}/entries/${e.number}`} className="hover:underline">{e.summary || '(no summary)'}</Link></td>
                  <td className="p-2"><StatusChip status={e.status} color={statusColor(spec, e.status)} /></td>
                  {q.cols.map((c) => (
                    <td key={c} className="max-w-xs truncate p-2">
                      {protectedFields.has(c) && !reveal && e.data[c] ? '(protected)' : displayValue(e.data[c])}
                    </td>
                  ))}
                  <td className="whitespace-nowrap p-2 text-neutral-600">{formatDateTime(e.createdAt, org.timezone)}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr><td colSpan={5 + q.cols.length} className="p-6 text-center text-neutral-600">No entries.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {rows.length ? (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex gap-2">
              <button name="mode" value="read" className="rounded border bg-white px-3 py-1">Mark read</button>
              <button name="mode" value="unread" className="rounded border bg-white px-3 py-1">Mark unread</button>
            </div>
            <div className="flex items-center gap-2">
              {q.page > 1 ? <Link href={`/admin/forms/${slug}${qs({ page: String(q.page - 1) })}`} className="underline">Previous</Link> : null}
              <span>Page {q.page} of {pages}</span>
              {q.page < pages ? <Link href={`/admin/forms/${slug}${qs({ page: String(q.page + 1) })}`} className="underline">Next</Link> : null}
            </div>
          </div>
        ) : null}
      </form>
    </section>
  );
}
