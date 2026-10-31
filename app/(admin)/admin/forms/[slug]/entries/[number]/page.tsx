import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DeleteEntryCard } from '@/components/entry/DeleteEntryCard';
import { FilesCard } from '@/components/entry/FilesCard';
import { ProtectedFieldsCard } from '@/components/entry/ProtectedFieldsCard';
import { RailActions } from '@/components/entry/RailActions';
import { BelowMinimumCard, EmailsCard, PdfsCard, TimelineCard, type EmailRow } from '@/components/entry/RailCards';
import { StatusFlow } from '@/components/entry/StatusFlow';
import { StatusStepper } from '@/components/entry/StatusStepper';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { StatusChip } from '@/components/ui/StatusChip';
import { buttonClass } from '@/components/ui/styles';
import { adminForm } from '@/lib/admin/context';
import { canReveal, decryptAuditRow, formSpecForPage, maskRecipients, protectedNames, protectedView, withoutProtected } from '@/lib/entry-view/protected';
import { belowMinimum, entryTimeline, fieldLabels, fileRows, pdfVersions } from '@/lib/entry-view/rail';
import { availableActions, MANUAL_FINAL, railActions, roleNote, statusFlow, statusPath } from '@/lib/entry-view/status';
import { loadEntryByNumber, loadFiles } from '@/lib/forms/entries';
import { customerPanel, lookupOptions } from '@/lib/forms/lookup';
import { rendererFiles } from '@/lib/forms/view';
import { templatesFor } from '@/lib/pdf/documents';
import { can } from '@/lib/security/can';
import type { EntryEventRow } from '@/lib/ui/timeline';
import { shortDateTime } from '@/lib/ui/time';
import { manualStatuses, statusColor } from '@/lib/workflow/rules';
import { deleteEntry, setStatus } from '../../actions';
import { StaffForm } from '../../staff-form';
import { previewEntryFile, revealProtectedField } from './actions';
import { ProtectedEntryForm } from './protected-form';

export const dynamic = 'force-dynamic';

const FORM_HOST = 'entry-form';

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

  // Encrypted forms (DEAL, Delivery Note): opening the entry decrypts it, and that is audited (ids only). If the
  // row cannot be written the page is not shown.
  if (form.encrypt) {
    const { error } = await db.from('audit_log').insert(decryptAuditRow(member, entry.id, form.slug, entry.number));
    if (error) throw new Error('Could not record opening this encrypted entry.');
  }

  await userDb.from('entry_reads').upsert({ entry_id: entry.id, user_id: member.userId }, { onConflict: 'entry_id,user_id', ignoreDuplicates: true });

  const actions = availableActions(spec, entry.status, member).map((a) => ({ name: a.name, label: a.button }));
  const rail = railActions(spec, entry.status, member);
  const [{ files, signatures }, stored] = await Promise.all([rendererFiles(db, entry, true), loadFiles(db, entry.id)]);
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
  const names = Object.fromEntries((people ?? []).filter((p) => p.full_name).map((p) => [p.id as string, p.full_name as string]));
  const now = new Date().toISOString();
  const timeline = entryTimeline((events ?? []) as EntryEventRow[], { names, labels: fieldLabels(spec) });
  const emailRows: EmailRow[] = (emails ?? []).map((m) => ({
    id: String(m.id),
    subject: String(m.subject ?? ''),
    to: maskRecipients(spec, entry.data, (m.to_addresses as string[] | null) ?? []),
    status: String(m.status ?? ''),
    error: m.error ? String(m.error) : null,
    failed: m.status === 'failed',
    at: m.created_at as string,
  }));
  const templates = templatesFor(form);
  const versions = pdfVersions((docs ?? []) as Parameters<typeof pdfVersions>[0], templates);

  const statuses = manualStatuses(spec);
  const canWrite = can(member, 'entries.write');
  const manual = MANUAL_FINAL[form.slug];
  const isStoreRoom = !!manual;
  const low = isStoreRoom ? belowMinimum(spec, entry.data) : [];
  const base = `/admin/forms/${slug}/entries/${entry.number}`;

  // Protected fields: masked on the server; the form never holds their values.
  const hasProtected = protectedNames(spec).length > 0;
  const prot = hasProtected ? protectedView(spec, entry.data) : [];
  const revealer = hasProtected && canReveal(member) ? revealProtectedField.bind(null, slug, entry.number) : undefined;

  const statusCard = (
    <Card padding="sm" aria-labelledby="entry-status-h">
      <CardHeader
        id="entry-status-h"
        title="Status"
        action={<span data-testid="entry-status"><StatusChip status={entry.status} color={statusColor(spec, entry.status)} /></span>}
      />
      {isStoreRoom ? <StatusFlow steps={statusFlow(spec, entry.status)} /> : <StatusStepper steps={statusPath(spec, entry.status)} />}
      {isStoreRoom && canWrite && entry.status === manual.from ? (
        <form action={setStatus.bind(null, slug, entry.number)} className="flex flex-col gap-1.5">
          <input type="hidden" name="status" value={manual.status} />
          <button className={buttonClass('primary', 38, 'w-full')}>{manual.button}</button>
          <span className="text-[12px] leading-4 text-fg-muted">{manual.note}</span>
        </form>
      ) : null}
      <RailActions actions={rail} formHost={FORM_HOST} />
      {isStoreRoom && canWrite && entry.status === manual.from && rail.length === 0 ? null : (
        <p className="m-0 text-[12px] leading-4 text-fg-muted">{roleNote({ anyAction: actions.length > 0, railCount: rail.length })}</p>
      )}
      {canWrite && statuses.length > 1 ? (
        <form action={setStatus.bind(null, slug, entry.number)} className="flex flex-col gap-1.5 border-t border-border pt-3">
          <label htmlFor="status" className="text-small font-semibold text-fg">Set status</label>
          <div className="flex gap-2">
            <select id="status" name="status" defaultValue={entry.status} className="h-9 min-w-0 flex-1 rounded-sm border border-border-strong bg-surface px-3 text-base text-fg outline-none focus:border-focus focus:ring-2 focus:ring-focus/25 sm:text-body">
              {[...new Set([entry.status, ...statuses])].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className={buttonClass('secondary', 36, 'flex-none')}>Set status</button>
          </div>
        </form>
      ) : null}
    </Card>
  );

  return (
    <section className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="flex flex-wrap gap-1.5 text-small text-fg-muted">
        <Link href="/admin/forms" className="text-fg-muted underline-offset-2 hover:underline">Forms</Link>
        <span aria-hidden="true">/</span>
        <Link href={`/admin/forms/${slug}`} className="text-fg-muted underline-offset-2 hover:underline">{spec.name}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className="text-fg">Entry #{entry.number}</span>
      </nav>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="m-0 text-h1">{spec.name} #{entry.number}</h1>
          {entry.summary ? <span className="break-all font-mono text-body text-fg-muted">{entry.summary}</span> : null}
          {form.encrypt ? <Badge variant="encrypted" /> : null}
        </div>
        <p className="m-0 text-small text-fg-muted">
          Created <time dateTime={entry.createdAt}>{shortDateTime(entry.createdAt)} SAST</time> · updated <time dateTime={entry.updatedAt}>{shortDateTime(entry.updatedAt)} SAST</time>
        </p>
      </header>

      {form.encrypt ? (
        <p className="m-0 flex items-center gap-1.5 text-small text-fg-muted">This entry is encrypted at rest. It was decrypted for you, and opening it is recorded in the activity log.</p>
      ) : null}
      {sp.saved ? <Alert tone="success">Saved. Status: {sp.saved}</Alert> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr]">
        {/* Phone: status and actions come first, above the long form. Desktop: right rail, top. */}
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">{statusCard}</div>

        <div id={FORM_HOST} className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <ProtectedFieldsCard fields={prot} reveal={revealer} />
          {hasProtected ? (
            <ProtectedEntryForm
              form={form} spec={formSpecForPage(spec)} number={entry.number} initial={withoutProtected(spec, entry.data)} files={files} signatures={signatures}
              actions={actions} lookupOptions={options} lookupPanel={panel} version={entry.updatedAt} timeZone={org.timezone} currency={org.currency}
            />
          ) : (
            <StaffForm
              form={form} number={entry.number} initial={entry.data} files={files} signatures={signatures}
              actions={actions} lookupOptions={options} lookupPanel={panel} version={entry.updatedAt}
              timeZone={org.timezone} currency={org.currency}
            />
          )}
        </div>

        <aside aria-label="Entry details" className="flex min-w-0 flex-col gap-4 self-start lg:col-start-2 lg:row-start-2">
          {isStoreRoom ? <BelowMinimumCard items={low} /> : null}
          <TimelineCard items={timeline} now={now} />
          <FilesCard files={fileRows(spec, stored)} preview={previewEntryFile.bind(null, slug, entry.number)} />
          <EmailsCard emails={emailRows} now={now} />
          <PdfsCard base={base} templates={templates} versions={versions} now={now} />
          {can(member, 'entries.delete') ? (
            <DeleteEntryCard
              number={entry.number}
              remove={deleteEntry.bind(null, slug, entry.number)}
              error={sp.delete === 'confirm' ? 'The number did not match.' : sp.delete === 'failed' ? 'The entry could not be deleted. Try again.' : null}
            />
          ) : null}
        </aside>
      </div>
    </section>
  );
}
