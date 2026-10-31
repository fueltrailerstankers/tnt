import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { buttonClass } from '@/components/ui/styles';
import { Icon } from '@/components/ui/Icon';
import { StatusChip } from '@/components/ui/StatusChip';
import { ZarAmount } from '@/components/ui/ZarAmount';
import type { DetailData } from '@/lib/leads-view/load';
import { duplicateReason, mailHref, telHref, xeroStatusLabel } from '@/lib/leads-view/model';
import { eventLabel, eventText } from '@/lib/leads-view/timeline';
import { longDateTime, shortDateTime } from '@/lib/ui/time';
import { DuplicateTag, LeadStatusChip, SourceTag } from './LeadBits';
import { AssignForm, NoteForm, StagePills, StatusForm } from './LeadControls';

const h3 = 'm-0 text-[15px] font-semibold leading-[22px]';

/**
 * Lead detail (inbox right column; the whole page on phones). Status, assignment, the duplicate warning (lib/leads
 * flags duplicates but has no merge or "not a duplicate" action, so the warning links to the other lead only), the
 * Xero match, notes and the activity log.
 */
export function LeadDetail({ data, manage, members, backHref, className = '' }: {
  data: DetailData;
  manage: boolean;
  members: ReadonlyArray<{ userId: string; label: string }>;
  backHref: string;
  className?: string;
}) {
  const { lead, events, original, later } = data;
  const who = new Map(members.map((m) => [m.userId, m.label]));
  const tel = telHref(lead.phone);
  const mail = mailHref(lead.email);
  const notes = events.filter((e) => e.kind === 'note' && e.body);
  const reason = duplicateReason(lead, original);
  const owner = lead.assigned_to ? who.get(lead.assigned_to) ?? 'Member' : 'Unassigned';
  const name = lead.name || '(no name)';
  const titleId = `lead-${lead.id}-title`;

  return (
    <section aria-labelledby={titleId} className={`flex min-w-0 flex-col gap-[18px] rounded-md border border-border bg-surface p-4 shadow-card sm:p-5 ${className}`}>
      <Link href={backHref} className="inline-flex min-h-11 items-center gap-1 self-start text-small font-semibold text-accent-text no-underline lg:hidden">
        <Icon name="chevronLeft" size={18} strokeWidth={2} />Back to leads
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[12px] leading-4 text-fg-muted">Received {longDateTime(lead.created_at)}</span>
          <h2 id={titleId} className="m-0 break-words text-[22px] font-bold leading-7 lg:text-[20px] lg:font-semibold">{name}</h2>
          <span className="flex flex-wrap items-center gap-x-1.5 text-body text-fg-muted">
            {[lead.email ? (mail ? <a key="e" href={mail} className="break-all text-fg-muted underline-offset-2 hover:text-fg">{lead.email}</a> : <span key="e">{lead.email}</span>) : null,
              lead.phone ? (tel ? <a key="p" href={tel} className="text-fg-muted underline-offset-2 hover:text-fg">{lead.phone}</a> : <span key="p">{lead.phone}</span>) : null]
              .filter(Boolean)
              .flatMap((el, i) => (i ? [<span key={`s${i}`} aria-hidden="true">·</span>, el] : [el]))}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <LeadStatusChip status={lead.status} size="md" testId="lead-status" />
          <SourceTag source={lead.source} names={new Map(data.sourceName ? [[lead.source, data.sourceName]] : [])} prefix="Source: " />
          {lead.duplicate_of ? <DuplicateTag /> : null}
        </div>
      </div>

      {tel || mail ? (
        <div className="grid grid-cols-2 gap-2 lg:hidden">
          {tel ? <a href={tel} className={buttonClass('primary', 48, 'w-full')}><Icon name="phone" size={18} strokeWidth={2} />Call</a> : null}
          {mail ? <a href={mail} className={buttonClass('secondary', 48, `w-full ${tel ? '' : 'col-span-2'}`)}><Icon name="mail" size={18} strokeWidth={2} />Email</a> : null}
        </div>
      ) : null}

      {original ? (
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-md bg-status-yellow-bg px-3.5 py-3 text-status-yellow-fg" data-testid="lead-duplicate">
          <Icon name="warning" size={18} strokeWidth={2} className="flex-none" />
          <p className="m-0 min-w-0 flex-[1_1_260px] text-body">
            <strong>Possible duplicate of <Link href={`/admin/leads/${original.id}`} className="text-status-yellow-fg underline">{original.name || 'an earlier lead'}</Link></strong>
            {reason ? ` · ${reason}` : ''}, received {shortDateTime(original.created_at)} SAST
            {original.created_by && who.get(original.created_by) ? ` by ${who.get(original.created_by)}` : ''}.
          </p>
        </div>
      ) : lead.duplicate_of ? (
        <div className="flex items-center gap-2 rounded-md bg-status-yellow-bg px-3.5 py-3 text-body text-status-yellow-fg" data-testid="lead-duplicate">
          <Icon name="warning" size={18} strokeWidth={2} className="flex-none" />
          <p className="m-0"><strong>Possible duplicate</strong> of an earlier lead that is no longer available.</p>
        </div>
      ) : null}
      {later.length ? (
        <p className="m-0 text-small text-fg-muted">
          {later.length === 1 ? 'A later lead is' : `${later.length} later leads are`} flagged as a possible duplicate of this one:{' '}
          {later.map((d, i) => (
            <span key={d.id}>{i ? ', ' : ''}<Link href={`/admin/leads/${d.id}`} className="text-accent-text">{d.name || 'later lead'}</Link> ({shortDateTime(d.created_at)} SAST)</span>
          ))}
        </p>
      ) : null}

      {manage ? (
        <>
          <div className="lg:hidden"><StagePills id={lead.id} status={lead.status} size={44} /></div>
          <div className="grid grid-cols-1 gap-x-3.5 gap-y-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.7fr)]">
            <div className="hidden lg:block"><StatusForm key={lead.status} id={lead.id} status={lead.status} /></div>
            <AssignForm key={lead.assigned_to ?? 'none'} id={lead.id} assigned={lead.assigned_to} members={members} />
            <div className="flex flex-col">
              <span className="mb-1.5 block text-small font-semibold">Branch</span>
              <span className="flex h-[38px] items-center text-body">{lead.branch || <span className="text-fg-muted">Not set</span>}</span>
            </div>
          </div>
        </>
      ) : null}

      <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-md border border-border p-3.5 text-body sm:grid-cols-[120px_minmax(0,1fr)]">
        {!manage ? (<><dt className="text-fg-muted">Owner</dt><dd className="m-0">{owner}</dd><dt className="text-fg-muted">Branch</dt><dd className="m-0">{lead.branch || '—'}</dd></>) : null}
        <dt className="text-fg-muted">Product / interest</dt><dd className="m-0 break-words">{lead.product || '—'}</dd>
        {lead.message ? (<><dt className="text-fg-muted">Message</dt><dd className="m-0 whitespace-pre-wrap break-words">{lead.message}</dd></>) : null}
        {lead.source_form ? (<><dt className="text-fg-muted">Form</dt><dd className="m-0">{lead.source_form}</dd></>) : null}
        {manage ? (<><dt className="text-fg-muted lg:hidden">Owner</dt><dd className="m-0 lg:hidden">{owner}</dd></>) : null}
      </dl>

      <section aria-labelledby={`${titleId}-xero`} className="flex flex-col gap-2" data-testid="lead-xero">
        <h3 id={`${titleId}-xero`} className={h3}>Matched in Xero</h3>
        {lead.matched_quote_id ? (
          <Link href={`/admin/xero/quotes/${encodeURIComponent(lead.matched_quote_id)}`} className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3.5 py-3 text-fg no-underline hover:bg-surface-2">
            <span className="text-small text-fg-muted">Quote</span>
            <span className="font-mono text-body font-semibold">{lead.matched_quote_number ?? 'Open quote'}</span>
            {lead.matched_quote_status ? <StatusChip status={xeroStatusLabel(lead.matched_quote_status)} size="sm" /> : null}
            <span className="ml-auto"><ZarAmount amount={lead.matched_quote_total} currency={lead.matched_quote_currency} /></span>
          </Link>
        ) : null}
        {lead.matched_invoice_id ? (
          <Link href={`/admin/xero/invoices/${encodeURIComponent(lead.matched_invoice_id)}`} className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3.5 py-3 text-fg no-underline hover:bg-surface-2">
            <span className="text-small text-fg-muted">Latest invoice</span>
            <span className="font-mono text-body font-semibold">{lead.matched_invoice_number ?? 'Open invoice'}</span>
            <span className="text-small text-fg-muted">{lead.invoice_count ?? 0} invoice{lead.invoice_count === 1 ? '' : 's'}, invoiced</span>
            <span className="ml-auto"><ZarAmount amount={lead.invoiced_total} currency={lead.invoiced_currency} /></span>
          </Link>
        ) : null}
        {!lead.matched_quote_id && !lead.matched_invoice_id ? (
          <p className="m-0 text-small text-fg-muted">
            {lead.matched_contact_ids?.length ? 'Matched a Xero contact; no quote or invoice for it yet.' : 'No quote or invoice in Xero for this contact yet. When one is raised it links here automatically.'}
          </p>
        ) : null}
        {lead.matched_at ? <p className="m-0 text-[12px] leading-4 text-fg-muted">Matched {longDateTime(lead.matched_at)}</p> : null}
      </section>

      <section aria-labelledby={`${titleId}-notes`} className="flex flex-col gap-2.5">
        <h3 id={`${titleId}-notes`} className={h3}>Notes</h3>
        {notes.length ? (
          <ol className="m-0 flex list-none flex-col gap-2.5 p-0" data-testid="lead-notes">
            {notes.map((n) => (
              <li key={n.id} className="flex flex-col gap-1 rounded-md bg-surface-2 px-3 py-2.5">
                <span className="text-[12px] leading-4 text-fg-muted"><strong className="text-fg">{n.actor ? who.get(n.actor) ?? 'Member' : 'System'}</strong> · {shortDateTime(n.created_at)} SAST</span>
                <span className="whitespace-pre-wrap break-words text-body">{n.body}</span>
              </li>
            ))}
          </ol>
        ) : <p className="m-0 text-small text-fg-muted">No notes yet.</p>}
        {manage ? <NoteForm id={lead.id} /> : null}
      </section>

      <details className="group rounded-md border border-border">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3.5 text-small font-semibold">
          Activity ({events.length})
          <Icon name="chevronDown" size={16} strokeWidth={2} className="transition group-open:rotate-180" />
        </summary>
        <ol className="m-0 flex list-none flex-col gap-2 border-t border-border px-3.5 py-3" data-testid="lead-timeline">
          {events.map((e) => (
            <li key={e.id} className="flex flex-col gap-0.5 text-small">
              <span className="text-[12px] leading-4 text-fg-muted">{shortDateTime(e.created_at)} SAST{e.actor ? ` · ${who.get(e.actor) ?? 'member'}` : ''}</span>
              <span><span className="font-semibold">{eventLabel(e.kind)}</span> {eventText(e.kind, e.meta, who)}</span>
            </li>
          ))}
        </ol>
      </details>
      {lead.gclid || lead.fbclid || (lead.utm && Object.keys(lead.utm).length) ? (
        <p className="m-0 flex flex-wrap gap-1.5 text-[12px] text-fg-muted">
          <span>Campaign:</span>
          {lead.gclid ? <Badge>GCLID</Badge> : null}
          {lead.fbclid ? <Badge>FBCLID</Badge> : null}
          {Object.entries(lead.utm ?? {}).map(([k, v]) => <Badge key={k}>{`${k}=${v}`}</Badge>)}
        </p>
      ) : null}
    </section>
  );
}
