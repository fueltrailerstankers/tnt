'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Drawer } from '@/components/ui/Drawer';
import { Icon } from '@/components/ui/Icon';
import { buttonClass } from '@/components/ui/styles';
import { ZarAmount } from '@/components/ui/ZarAmount';
import { StatusChip } from '@/components/ui/StatusChip';
import type { UiSource } from '@/lib/leads-view/actions';
import {
  ageLabel, ageWords, branchOptions, buildBoard, duplicateReason, filterBoard, openSummary, sourceBadge, xeroStatusLabel,
  type BoardFilters, type BoardLead,
} from '@/lib/leads-view/model';
import { normEmail, normPhone } from '@/lib/leads/normalise';
import { longDateTime } from '@/lib/ui/time';
import { AddLead } from './AddLead';
import { DuplicateTag, LeadStatusChip, LeadsViewSwitch, QuoteSums, SourceTag, STAGE_DOT } from './LeadBits';
import { NoteForm, StagePills } from './LeadControls';

/** Cards drawn per column; the rest are counted and linked to the inbox. */
const CARDS_PER_COLUMN = 50;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PipelineProps {
  leads: BoardLead[];
  /** Leads in the org outside spam; more than `leads.length` means the board shows the newest only. */
  total: number;
  members: ReadonlyArray<{ userId: string; label: string }>;
  sourceNames: Record<string, string>;
  me: string;
  manage: boolean;
  addSources: UiSource[];
  /** Server time of the render, for the card ages. */
  nowIso: string;
}

/**
 * Pipeline board (design LeadsPipeline): New / Contacted / Quoted / Won / Lost columns with counts and matched quote
 * sums, filters (search, owner, branch, Hide test leads) applied in the browser so no search text reaches a URL, and
 * a drawer per lead (?id= in the URL, so Back closes it) to change its stage through the permission-checked action.
 */
export function PipelineBoard({ leads, total, members, sourceNames, me, manage, addSources, nowIso }: PipelineProps) {
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const params = useSearchParams();
  const [filters, setFilters] = useState<BoardFilters>({ q: '', owner: 'all', branch: '', hideTest: false });
  const names = useMemo(() => new Map(Object.entries(sourceNames)), [sourceNames]);
  const who = useMemo(() => new Map(members.map((m) => [m.userId, m.label])), [members]);
  const byId = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);
  const branches = useMemo(() => branchOptions(leads), [leads]);
  const shown = useMemo(() => filterBoard(leads, filters, me), [leads, filters, me]);
  const columns = useMemo(() => buildBoard(shown), [shown]);
  const summary = useMemo(() => openSummary(shown), [shown]);

  const idParam = params.get('id') ?? '';
  const openId = ID.test(idParam) ? idParam.toLowerCase() : null;
  const cur = openId ? byId.get(openId) ?? null : null;

  // Opening pushes ?id= (Back closes the drawer); closing goes back when we pushed, else drops the param in place.
  const pushed = useRef(false);
  useEffect(() => { if (!openId) pushed.current = false; }, [openId]);
  const openLead = useCallback((id: string) => {
    const u = new URL(window.location.href);
    u.searchParams.set('id', id);
    if (pushed.current) window.history.replaceState(null, '', u);
    else window.history.pushState(null, '', u);
    pushed.current = true;
  }, []);
  const close = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
      return;
    }
    const u = new URL(window.location.href);
    u.searchParams.delete('id');
    window.history.replaceState(null, '', u);
  }, []);
  const set = (p: Partial<BoardFilters>) => setFilters((f) => ({ ...f, ...p }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-h1">Leads</h1>
          <p className="m-0 flex flex-wrap items-center gap-x-1.5 text-small text-fg-muted" aria-live="polite">
            <span>{summary.count} open · pipeline</span>
            <QuoteSums sums={summary.sums} />
            <span>from matched Xero quotes</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LeadsViewSwitch current="pipeline" />
          {manage ? <AddLead sources={addSources} branches={branches} /> : null}
        </div>
      </div>

      <div role="group" aria-label="Filter the board" className="flex flex-wrap items-center gap-2">
        <label className="flex h-11 min-w-0 flex-[1_1_100%] sm:flex-[0_1_280px] items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-fg-muted focus-within:outline-2 focus-within:outline-focus lg:h-[34px]">
          <Icon name="search" size={14} strokeWidth={2} />
          <span className="sr-only">Search leads</span>
          <input
            type="search"
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Name, email, phone or product"
            className="min-w-0 flex-1 border-0 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle sm:text-small"
          />
        </label>
        <select aria-label="Owner" value={filters.owner} onChange={(e) => set({ owner: e.target.value as BoardFilters['owner'] })} className="h-11 rounded-sm border border-border bg-surface px-2.5 text-base text-fg sm:text-small lg:h-[34px]">
          <option value="all">All owners</option>
          <option value="mine">Mine</option>
          <option value="none">Unassigned</option>
        </select>
        <select aria-label="Branch" value={filters.branch} onChange={(e) => set({ branch: e.target.value })} className="h-11 rounded-sm border border-border bg-surface px-2.5 text-base text-fg sm:text-small lg:h-[34px]">
          <option value="">All branches</option>
          {branches.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <button
          type="button"
          aria-pressed={Boolean(filters.hideTest)}
          onClick={() => set({ hideTest: !filters.hideTest })}
          className="inline-flex h-11 items-center gap-2 rounded-pill border border-border bg-surface px-3 text-small font-medium text-fg hover:bg-surface-2 lg:h-[34px]"
        >
          <span aria-hidden="true" className={`relative h-4 w-7 flex-none rounded-pill ${filters.hideTest ? 'bg-accent' : 'bg-border-strong'}`}>
            <span className={`absolute top-0.5 size-3 rounded-full bg-surface transition-[left] ${filters.hideTest ? 'left-3.5' : 'left-0.5'}`} />
          </span>
          Hide test leads
        </button>
        {total > leads.length ? <p className="m-0 text-[12px] text-fg-muted">Showing the newest {leads.length} of {total} leads.</p> : null}
      </div>

      <div className="grid auto-cols-[minmax(264px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2 relative [contain:inline-size]" data-testid="pipeline-board">
        {columns.map((c) => {
          const headId = `stage-${c.stage}`;
          return (
            <section key={c.stage} aria-labelledby={headId} data-stage={c.stage} className="flex min-h-[420px] flex-col gap-2.5 rounded-lg bg-surface-2 p-2.5 lg:min-h-[560px]">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1 pt-1">
                <h2 id={headId} className="m-0 flex items-center gap-2 text-small font-bold">
                  <span aria-hidden="true" className={`size-2 rounded-full ${STAGE_DOT[c.tone]}`} />
                  {c.label}
                  <span className="font-medium text-fg-muted" data-testid="stage-count">{c.count}</span>
                  <span className="sr-only">{c.count === 1 ? 'lead' : 'leads'}</span>
                </h2>
                <span data-testid="stage-sum"><QuoteSums sums={c.sums} /></span>
              </div>
              {c.cards.length ? (
                <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                  {c.cards.slice(0, CARDS_PER_COLUMN).map((l) => {
                    const owner = l.assigned_to ? who.get(l.assigned_to) ?? 'Member' : null;
                    return (
                      <li key={l.id}>
                        <button
                          type="button"
                          onClick={() => openLead(l.id)}
                          aria-haspopup="dialog"
                          data-testid="pipeline-card"
                          className={`flex w-full flex-col gap-2 rounded-md border bg-surface p-3 text-left text-fg ${l.id === openId ? 'border-accent ring-[3px] ring-accent-soft' : 'border-border shadow-card hover:border-border-strong'}`}
                        >
                          <span className="break-words text-body font-bold">{l.name || '(no name)'}</span>
                          {l.product ? <span className="text-small text-fg-muted">{l.product}</span> : null}
                          {l.matched_quote_id ? (
                            <span className="flex flex-wrap items-center gap-2 text-[12px]">
                              <span className="font-mono font-semibold">{l.matched_quote_number ?? 'Quote'}</span>
                              <ZarAmount amount={l.matched_quote_total} currency={l.matched_quote_currency} size="sm" />
                            </span>
                          ) : null}
                          <span className="flex flex-wrap items-center gap-1.5">
                            <SourceTag source={l.source} names={names} />
                            {l.duplicate_of ? <DuplicateTag /> : null}
                            <span className="ml-auto flex items-center gap-1.5 text-[12px] text-fg-muted">
                              <span aria-hidden="true">{ageLabel(l.created_at, now)}</span>
                              <span className="sr-only">{ageWords(l.created_at, now)}</span>
                              {owner ? <><Avatar name={owner} size={24} decorative /><span className="sr-only">, owner {owner}</span></> : <span className="sr-only">, unassigned</span>}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="m-0 px-1 text-small text-fg-muted">No leads.</p>}
              {c.cards.length > CARDS_PER_COLUMN ? (
                <Link href={`/admin/leads?status=${c.stage}`} className="px-1 text-small font-semibold text-accent-text">
                  {c.cards.length - CARDS_PER_COLUMN} more in the inbox
                </Link>
              ) : null}
            </section>
          );
        })}
      </div>

      <Drawer
        open={Boolean(cur)}
        onClose={close}
        width={460}
        title={cur?.name || '(no name)'}
        eyebrow={cur ? `Source: ${sourceBadge(cur.source, names).label}` : null}
        meta={cur ? <LeadStatusChip status={cur.status} /> : null}
        footer={cur ? (
          <>
            <Link href={`/admin/leads/${cur.id}`} className={buttonClass('secondary', 38, 'flex-1')}>Open in inbox</Link>
            <button type="button" onClick={close} className={buttonClass('primary', 38, 'flex-1')}>Done</button>
          </>
        ) : null}
      >
        {cur ? <DrawerBody lead={cur} original={cur.duplicate_of ? byId.get(cur.duplicate_of) ?? null : null} who={who} manage={manage} /> : null}
      </Drawer>
    </div>
  );
}

function DrawerBody({ lead, original, who, manage }: { lead: BoardLead; original: BoardLead | null; who: ReadonlyMap<string, string>; manage: boolean }) {
  const reason = original ? duplicateReason(
    { email_norm: normEmail(lead.email), phone_norm: normPhone(lead.phone) },
    { email_norm: normEmail(original.email), phone_norm: normPhone(original.phone) },
  ) : null;
  return (
    <>
      {manage ? <StagePills key={lead.id} id={lead.id} status={lead.status} /> : null}
      {lead.duplicate_of ? (
        <div className="flex items-start gap-2.5 rounded-md bg-status-yellow-bg px-3.5 py-3 text-body text-status-yellow-fg">
          <Icon name="warning" size={18} strokeWidth={2} className="mt-0.5 flex-none" />
          <p className="m-0">
            <strong>Possible duplicate of {original ? <Link href={`/admin/leads/${original.id}`} className="text-status-yellow-fg underline">{original.name || 'an earlier lead'}</Link> : 'an earlier lead'}</strong>
            {reason ? ` · ${reason}` : ''}
          </p>
        </div>
      ) : null}
      <dl className="m-0 grid grid-cols-2 gap-3 text-small">
        <div><dt className="text-fg-muted">Owner</dt><dd className="m-0 mt-0.5 font-semibold">{lead.assigned_to ? who.get(lead.assigned_to) ?? 'Member' : 'Unassigned'}</dd></div>
        <div><dt className="text-fg-muted">Branch</dt><dd className="m-0 mt-0.5 font-semibold">{lead.branch || '—'}</dd></div>
        <div><dt className="text-fg-muted">Phone</dt><dd className="m-0 mt-0.5 break-words">{lead.phone || '—'}</dd></div>
        <div><dt className="text-fg-muted">Email</dt><dd className="m-0 mt-0.5 break-all">{lead.email || '—'}</dd></div>
        <div className="col-span-2"><dt className="text-fg-muted">Received</dt><dd className="m-0 mt-0.5">{longDateTime(lead.created_at)}</dd></div>
        {lead.product ? <div className="col-span-2"><dt className="text-fg-muted">Product / interest</dt><dd className="m-0 mt-0.5 break-words">{lead.product}</dd></div> : null}
      </dl>
      <div className="flex flex-col gap-2">
        <h3 className="m-0 text-small font-semibold">Matched in Xero</h3>
        {lead.matched_quote_id ? (
          <Link href={`/admin/xero/quotes/${encodeURIComponent(lead.matched_quote_id)}`} className="flex flex-wrap items-center gap-2.5 rounded-md border border-border p-3 text-fg no-underline hover:bg-surface-2">
            <span className="font-mono font-bold">{lead.matched_quote_number ?? 'Quote'}</span>
            {lead.matched_quote_status ? <StatusChip status={xeroStatusLabel(lead.matched_quote_status)} size="sm" /> : null}
            <span className="ml-auto"><ZarAmount amount={lead.matched_quote_total} currency={lead.matched_quote_currency} /></span>
          </Link>
        ) : <p className="m-0 text-small text-fg-muted">No Xero quote yet. When a quote is raised in Xero for this contact it links here automatically.</p>}
      </div>
      {manage ? <NoteForm id={lead.id} label="Add note" compact /> : null}
    </>
  );
}

