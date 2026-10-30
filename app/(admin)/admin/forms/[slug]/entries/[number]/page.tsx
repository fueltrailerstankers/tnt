import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusChip } from '@/components/ui/StatusChip';
import { adminForm } from '@/lib/admin/context';
import { formatDateTime } from '@/lib/admin/grid';
import { loadEntryByNumber } from '@/lib/forms/entries';
import { customerPanel, lookupOptions } from '@/lib/forms/lookup';
import { rendererFiles } from '@/lib/forms/view';
import { templatesFor } from '@/lib/pdf/documents';
import { can } from '@/lib/security/can';
import { actionPermission, allowedActions, internalRole, manualStatuses, statusColor } from '@/lib/workflow/rules';
import { deleteEntry, setStatus } from '../../actions';
import { StaffForm } from '../../staff-form';

export const dynamic = 'force-dynamic';

export default async function EntryPage({
  params, searchParams,
}: { params: Promise<{ slug: string; number: string }>; searchParams: Promise<{ saved?: string; delete?: string }> }) {
  const { slug, number: raw } = await params;
  const sp = await searchParams;
  const { member, userDb, db, form, org } = await adminForm(slug, 'entries.read');
  const number = Number.parseInt(raw, 10);
  // Read through the user's RLS-scoped client: proves the caller may see this entry.
  const entry = await loadEntryByNumber(userDb, form, number);
  if (!entry) notFound();
  const spec = form.spec;

  await userDb.from('entry_reads').upsert({ entry_id: entry.id, user_id: member.userId }, { onConflict: 'entry_id,user_id', ignoreDuplicates: true });

  const actions = allowedActions(spec, entry.status, internalRole(spec).name)
    .filter((a) => can(member, actionPermission(a)))
    .map((a) => ({ name: a.name, label: a.button }));
  const { files, signatures } = await rendererFiles(db, entry, true);
  const lookup = spec.fields.find((f) => f.type === 'lookup');
  let options = null;
  let panel: Array<[string, string]> = [];
  if (lookup && lookup.type === 'lookup') {
    options = await lookupOptions(db, form.orgId, lookup.lookup.sourceForm, lookup.lookup.displayField);
    const id = entry.data[lookup.name];
    if (typeof id === 'string') panel = await customerPanel(db, form.orgId, lookup.lookup.sourceForm, id, false);
  }

  const [{ data: events }, { data: emails }, { data: docs }, { data: people }] = await Promise.all([
    userDb.from('entry_events').select('id, action, from_status, to_status, actor_user, actor_role, diff, created_at').eq('entry_id', entry.id).order('created_at', { ascending: false }),
    userDb.from('email_log').select('id, action, to_addresses, subject, status, error, created_at').eq('entry_id', entry.id).order('created_at', { ascending: false }),
    userDb.from('entry_documents').select('id, template_number, name, sha256, created_at').eq('entry_id', entry.id).order('created_at', { ascending: false }),
    userDb.from('profiles').select('id, full_name'),
  ]);
  const who = (id: string | null) => (id ? (people ?? []).find((p) => p.id === id)?.full_name ?? 'Staff' : null);
  const statuses = manualStatuses(spec);
  const base = `/admin/forms/${slug}/entries/${entry.number}`;

  return (
    <section className="space-y-4">
      <p className="text-xs text-fg-muted">
        <Link href="/admin" className="underline">Home</Link> / <Link href={`/admin/forms/${slug}`} className="underline">{spec.name}</Link> / Entry #{entry.number}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-h1">{entry.summary || `Entry #${entry.number}`}</h1>
        <span data-testid="entry-status"><StatusChip status={entry.status} color={statusColor(spec, entry.status)} /></span>
      </div>
      <p className="text-sm text-fg-muted">
        #{entry.number} · created {formatDateTime(entry.createdAt, org.timezone)} · updated {formatDateTime(entry.updatedAt, org.timezone)}
      </p>
      {sp.saved ? <p role="status" className="rounded bg-status-green-bg p-3 text-sm text-status-green-fg">Saved. Status: {sp.saved}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-4">
          {actions.length === 0 ? <p className="rounded-md bg-surface-2 px-4 py-3 text-body text-fg-muted">No action is available for this entry at its current status.</p> : null}
          <StaffForm
            form={form} number={entry.number} initial={entry.data} files={files} signatures={signatures}
            actions={actions} lookupOptions={options} lookupPanel={panel} version={entry.updatedAt}
          />
        </div>

        <aside className="space-y-4 text-sm">
          {can(member, 'entries.write') && statuses.length > 1 ? (
            <form action={setStatus.bind(null, slug, entry.number)} className="space-y-2 rounded-md border bg-surface shadow-card p-3">
              <h2 className="font-semibold">Status</h2>
              <label htmlFor="status" className="sr-only">Set status</label>
              <select id="status" name="status" defaultValue={entry.status} className="w-full rounded-sm border px-2 py-1">
                {[...new Set([entry.status, ...statuses])].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="rounded-pill border border-border-strong bg-surface font-semibold text-fg no-underline px-3 py-1">Set status</button>
            </form>
          ) : null}

          <div className="rounded-md border bg-surface shadow-card p-3">
            <h2 className="mb-2 font-semibold">Documents</h2>
            <ul className="space-y-1">
              {templatesFor(form).map((t) => (
                <li key={t.number}><a href={`${base}/documents/${t.number}`} className="underline">{t.label} (PDF)</a></li>
              ))}
            </ul>
            {docs?.length ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-fg-muted">Stored versions ({docs.length})</summary>
                <ul className="mt-1 space-y-1 text-xs">
                  {docs.map((d) => (
                    <li key={d.id}>
                      <a href={`${base}/documents/${d.template_number}?version=${d.id}`} className="underline">{d.name}</a>
                      <span className="text-fg-muted"> · {formatDateTime(d.created_at, org.timezone)} · sha256 {String(d.sha256).slice(0, 12)}…</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>

          <div className="rounded-md border bg-surface shadow-card p-3">
            <h2 className="mb-2 font-semibold">Emails sent</h2>
            {emails?.length ? (
              <ul className="space-y-2" data-testid="emails">
                {emails.map((m) => (
                  <li key={m.id}>
                    <p>{m.subject}</p>
                    <p className="text-xs text-fg-muted">{(m.to_addresses as string[]).join(', ')} · {m.status}{m.error ? ` (${m.error})` : ''} · {formatDateTime(m.created_at, org.timezone)}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="text-fg-muted">None.</p>}
          </div>

          <div className="rounded-md border bg-surface shadow-card p-3">
            <h2 className="mb-2 font-semibold">Timeline</h2>
            <ol className="space-y-2" data-testid="timeline">
              {(events ?? []).map((e) => (
                <li key={e.id}>
                  <p><span className="font-medium">{e.action}</span>{e.to_status ? ` → ${e.to_status}` : ''}</p>
                  <p className="text-xs text-fg-muted">
                    {who(e.actor_user) ?? e.actor_role} · {formatDateTime(e.created_at, org.timezone)}
                    {(e.diff as { changed?: string[] })?.changed?.length ? ` · ${(e.diff as { changed: string[] }).changed.length} field(s) changed` : ''}
                  </p>
                </li>
              ))}
            </ol>
          </div>

          {can(member, 'entries.delete') ? (
            <form action={deleteEntry.bind(null, slug, entry.number)} className="space-y-2 rounded-lg border border-danger bg-surface p-3">
              <h2 className="font-semibold text-status-red-fg">Delete entry</h2>
              <p className="text-xs text-fg-muted">Removes the entry, its files and documents. Type the entry number to confirm.</p>
              {sp.delete === 'confirm' ? <p className="text-xs text-status-red-fg">The number did not match.</p> : null}
              <label htmlFor="confirm" className="sr-only">Entry number</label>
              <input id="confirm" name="confirm" inputMode="numeric" className="w-full rounded-sm border px-2 py-1" autoComplete="off" />
              <button className="rounded-pill border border-danger bg-surface font-semibold no-underline px-3 py-1 text-status-red-fg">Delete</button>
            </form>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
