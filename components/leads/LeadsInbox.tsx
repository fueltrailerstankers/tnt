import { notFound } from 'next/navigation';
import { can, type Member } from '@/lib/security/can';
import { inboxQuery, loadInbox, loadLeadDetail, type DetailData } from '@/lib/leads-view/load';
import { EmptyState } from '@/components/ui/EmptyState';
import { rematchLeads } from '@/app/(admin)/admin/leads/actions';
import { createClient } from '@/lib/supabase/server';
import { UI_SOURCES, type UiSource } from '@/lib/leads-view/actions';
import { AddLead } from './AddLead';
import { LeadsViewSwitch } from './LeadBits';
import { LeadDetail } from './LeadDetail';
import { LeadList } from './LeadList';

type Sp = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

/** Active sources staff may pick in Add lead (Manual first). */
export async function addLeadSources(member: Member): Promise<UiSource[]> {
  const db = await createClient();
  const { data } = await db.from('lead_sources').select('key').eq('org_id', member.orgId).eq('active', true).in('key', [...UI_SOURCES]);
  const keys = new Set((data ?? []).map((r) => r.key as string));
  return UI_SOURCES.filter((s) => keys.has(s));
}

/**
 * Leads inbox (design Leads + PhoneLeads). Desktop (lg+): list and detail side by side; /admin/leads shows the first
 * lead of the list. Phones: the list, or (on /admin/leads/[id]) the lead with a Back link. Call after requirePerm('leads.read').
 */
export async function LeadsInbox({ member, sp, selectedId }: { member: Member; sp: Sp; selectedId: string | null }) {
  const now = new Date();
  const manage = can(member, 'leads.manage');
  const [data, sources] = await Promise.all([loadInbox(member, sp), manage ? addLeadSources(member) : Promise.resolve([] as UiSource[])]);
  const shownId = selectedId ?? data.rows[0]?.id ?? null;
  const detail: DetailData | null = shownId ? await loadLeadDetail(member, shownId) : null;
  if (selectedId && !detail) notFound();
  const backHref = `/admin/leads${inboxQuery(data.params)}`;
  const rematched = one(sp.rematched);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className={`m-0 text-h1 ${selectedId ? 'max-lg:sr-only' : ''}`}>Leads</h1>
        <div className={`flex flex-wrap items-center gap-2 ${selectedId ? 'max-lg:hidden' : ''}`}>
          <LeadsViewSwitch current="inbox" />
          {can(member, 'integrations.manage') && manage ? (
            <form action={rematchLeads} className="hidden lg:block">
              <button className="inline-flex h-9 items-center rounded-pill border border-border-strong bg-surface px-3.5 text-small font-semibold text-fg hover:bg-surface-2">Re-match with Xero</button>
            </form>
          ) : null}
          {manage ? <AddLead sources={sources} branches={data.branches} /> : null}
        </div>
      </div>
      {rematched ? (
        <p role="status" className="m-0 rounded-sm bg-status-green-bg px-3 py-2 text-small text-status-green-fg">
          Checked {one(sp.checked)} open leads; {rematched} match{rematched === '1' ? '' : 'es'} changed.{one(sp.queued) ? ' The rest continues in the background.' : ''}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <LeadList
          data={data}
          selectedId={shownId}
          now={now}
          className={`lg:w-[380px] lg:flex-none xl:w-[420px] ${selectedId ? 'max-lg:hidden' : ''}`}
        />
        {detail ? (
          <LeadDetail
            data={detail}
            manage={manage}
            members={data.members}
            branches={data.branches}
            backHref={backHref}
            className={`flex-1 ${selectedId ? '' : 'max-lg:hidden'}`}
          />
        ) : (
          <div className="hidden flex-1 lg:block">
            <EmptyState icon="leads" title="No lead selected" body="Choose a lead from the list to see its details." />
          </div>
        )}
      </div>
    </div>
  );
}
