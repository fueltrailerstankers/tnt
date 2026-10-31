import 'server-only';
import { MIRROR_PAGE } from '@/lib/admin/mirror';
import { leadMembers, type OrgMember } from '@/lib/leads/members';
import type { LeadStatus } from '@/lib/leads/schema';
import type { Member } from '@/lib/security/can';
import { createClient } from '@/lib/supabase/server';
import { activeView, branchSuggestions, listFilter, type BoardLead } from './model';
import { inboxParams, isUuid, type InboxParams } from './params';

export { inboxQuery, isUuid, type InboxParams } from './params';

// Reads for the Leads screens. RLS client (leads.read through has_access) and every query also filtered by the
// member's org. Call only after requirePerm('leads.read'). Selects named columns: never `raw` (the webhook payload).

type Sp = Record<string, string | string[] | undefined>;

export const LIST_COLUMNS = 'id, created_at, name, product, source, branch, status, assigned_to, duplicate_of, matched_quote_number, matched_invoice_number';

export interface ListRow {
  id: string; created_at: string; name: string | null; product: string | null; source: string; branch: string | null;
  status: string; assigned_to: string | null; duplicate_of: string | null;
  matched_quote_number: string | null; matched_invoice_number: string | null;
}

export type ChipCounts = Record<'new' | 'contacted' | 'quoted' | 'won' | 'lost' | 'spam' | 'mine', number>;

export interface InboxData {
  params: InboxParams;
  active: string;
  rows: ListRow[];
  count: number;
  pages: number;
  counts: ChipCounts;
  sources: Map<string, string>;
  members: OrgMember[];
  /** Branch names in use (recent leads, plus routing rules the caller may read): suggestions for Branch fields. */
  branches: string[];
}

type Db = Awaited<ReturnType<typeof createClient>>;

export async function loadInbox(member: Member, sp: Sp): Promise<InboxData> {
  const db = await createClient();
  const [{ data: sources }, members, { data: usedBranches }, { data: ruleBranches }] = await Promise.all([
    db.from('lead_sources').select('key, name').eq('org_id', member.orgId).order('name'),
    leadMembers(member.orgId),
    db.from('leads').select('branch').eq('org_id', member.orgId).not('branch', 'is', null)
      .order('created_at', { ascending: false }).limit(BRANCH_SAMPLE),
    // Routing rules are admin-only under RLS: other members simply get none here.
    db.from('routing_rules').select('assign_branch').eq('org_id', member.orgId).not('assign_branch', 'is', null).limit(100),
  ]);
  const params = inboxParams(sp, (sources ?? []).map((s) => s.key as string));
  const f = listFilter(params.view, params.status);

  // Filters shared by the list and the chip counts (everything except status and Mine). Merged leads (0023) are
  // never listed: they are reached from their original's detail.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const common = <Q extends { ilike: any; eq: any; is: any; not: any }>(query: Q): Q => {
    let q = query.is('merged_into', null);
    if (params.q) q = q.ilike('search_text', `*${params.q.toLowerCase()}*`);
    if (params.source) q = q.eq('source', params.source);
    if (params.branch) q = q.ilike('branch', params.branch);
    if (params.assigned === 'me') q = q.eq('assigned_to', member.userId);
    else if (params.assigned === 'none') q = q.is('assigned_to', null);
    else if (params.assigned) q = q.eq('assigned_to', params.assigned);
    if (params.dups) q = q.not('duplicate_of', 'is', null);
    return q;
  };

  let list = common(db.from('leads').select(LIST_COLUMNS, { count: 'exact' }).eq('org_id', member.orgId))
    .order('created_at', { ascending: false }).order('id', { ascending: false })
    .range((params.page - 1) * MIRROR_PAGE, params.page * MIRROR_PAGE - 1);
  if (f.statuses) list = list.in('status', f.statuses);
  if (f.mine) list = list.eq('assigned_to', member.userId);

  const head = (status: LeadStatus | LeadStatus[], mine = false) => {
    let q = common(db.from('leads').select('id', { count: 'exact', head: true }).eq('org_id', member.orgId));
    q = Array.isArray(status) ? q.in('status', status) : q.eq('status', status);
    if (mine) q = q.eq('assigned_to', member.userId);
    return q;
  };
  const [listRes, ...countRes] = await Promise.all([
    list,
    head('new'), head('contacted'), head('quoted'), head('won'), head('lost'), head('spam'),
    head(['new', 'contacted', 'quoted'], true),
  ]);
  const [n, c, qu, w, l, s, mine] = countRes.map((r) => r.count ?? 0);
  const count = listRes.count ?? 0;
  return {
    params,
    active: activeView(params.view, params.status),
    rows: (listRes.data ?? []) as ListRow[],
    count,
    pages: Math.max(1, Math.ceil(count / MIRROR_PAGE)),
    counts: { new: n, contacted: c, quoted: qu, won: w, lost: l, spam: s, mine },
    sources: new Map((sources ?? []).map((x) => [x.key as string, x.name as string])),
    members,
    branches: branchSuggestions([
      ...(usedBranches ?? []).map((r) => r.branch as string | null),
      ...(ruleBranches ?? []).map((r) => r.assign_branch as string | null),
    ]),
  };
}

/** Most recent leads whose branch is read for the Branch suggestions. */
const BRANCH_SAMPLE = 1000;

// ---------------------------------------------------------------------------------------------------------------
// One lead
// ---------------------------------------------------------------------------------------------------------------

const DETAIL_COLUMNS = [
  'id', 'created_at', 'created_by', 'name', 'email', 'email_norm', 'phone', 'phone_norm', 'product', 'message', 'source',
  'source_form', 'branch', 'status', 'assigned_to', 'duplicate_of', 'gclid', 'fbclid', 'utm', 'matched_contact_ids',
  'matched_quote_id', 'matched_quote_number', 'matched_quote_status', 'matched_quote_total', 'matched_quote_currency',
  'matched_invoice_id', 'matched_invoice_number', 'invoice_count', 'invoiced_total', 'invoiced_currency', 'matched_at',
  'merged_into', 'merged_at', 'merged_by', 'not_duplicate_of', 'duplicate_dismissed_at', 'duplicate_dismissed_by',
].join(', ');

export interface LeadDetail {
  id: string; created_at: string; created_by: string | null; name: string | null; email: string | null;
  email_norm: string | null; phone: string | null; phone_norm: string | null; product: string | null;
  message: string | null; source: string; source_form: string | null; branch: string | null; status: string;
  assigned_to: string | null; duplicate_of: string | null; gclid: string | null; fbclid: string | null;
  utm: Record<string, string> | null; matched_contact_ids: string[] | null;
  matched_quote_id: string | null; matched_quote_number: string | null; matched_quote_status: string | null;
  matched_quote_total: number | string | null; matched_quote_currency: string | null;
  matched_invoice_id: string | null; matched_invoice_number: string | null; invoice_count: number | null;
  invoiced_total: number | string | null; invoiced_currency: string | null; matched_at: string | null;
  merged_into: string | null; merged_at: string | null; merged_by: string | null;
  not_duplicate_of: string | null; duplicate_dismissed_at: string | null; duplicate_dismissed_by: string | null;
}

export interface LeadEvent { id: string; kind: string; actor: string | null; meta: Record<string, unknown> | null; body: string | null; created_at: string }
export interface LeadRef {
  id: string; name: string | null; created_at: string; created_by: string | null; email_norm: string | null; phone_norm: string | null;
  merged_into: string | null; merged_at: string | null;
}

export interface DetailData {
  lead: LeadDetail;
  events: LeadEvent[];
  original: LeadRef | null;
  /** Open later leads flagged as duplicates of this one (merged ones are in `merged`). */
  later: LeadRef[];
  /** Leads merged into this one (0023). */
  merged: LeadRef[];
  /** The lead this one was merged into, when it was. */
  mergedInto: LeadRef | null;
  sourceName: string | null;
}

const REF_COLUMNS = 'id, name, created_at, created_by, email_norm, phone_norm, merged_into, merged_at';

export async function loadLeadDetail(member: Member, id: string, db?: Db): Promise<DetailData | null> {
  if (!isUuid(id)) return null;
  const c = db ?? await createClient();
  const { data: lead } = await c.from('leads').select(DETAIL_COLUMNS).eq('org_id', member.orgId).eq('id', id).maybeSingle();
  if (!lead) return null;
  const l = lead as unknown as LeadDetail;
  const [{ data: events }, { data: later }, { data: merged }, { data: original }, { data: into }, { data: src }] = await Promise.all([
    c.from('lead_events').select('id, kind, actor, meta, body, created_at').eq('org_id', member.orgId).eq('lead_id', id)
      .order('created_at', { ascending: true }).limit(500),
    c.from('leads').select(REF_COLUMNS).eq('org_id', member.orgId).eq('duplicate_of', id).is('merged_into', null)
      .order('created_at', { ascending: true }).limit(50),
    c.from('leads').select(REF_COLUMNS).eq('org_id', member.orgId).eq('merged_into', id).order('created_at', { ascending: true }).limit(50),
    l.duplicate_of
      ? c.from('leads').select(REF_COLUMNS).eq('org_id', member.orgId).eq('id', l.duplicate_of).maybeSingle()
      : Promise.resolve({ data: null }),
    l.merged_into
      ? c.from('leads').select(REF_COLUMNS).eq('org_id', member.orgId).eq('id', l.merged_into).maybeSingle()
      : Promise.resolve({ data: null }),
    c.from('lead_sources').select('name').eq('org_id', member.orgId).eq('key', l.source).maybeSingle(),
  ]);
  return {
    lead: l,
    events: (events ?? []) as LeadEvent[],
    original: (original as LeadRef | null) ?? null,
    later: (later ?? []) as LeadRef[],
    merged: (merged ?? []) as LeadRef[],
    mergedInto: (into as LeadRef | null) ?? null,
    sourceName: (src?.name as string | undefined) ?? null,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Pipeline board
// ---------------------------------------------------------------------------------------------------------------

/** Most leads the board loads (newest first); the page says so when there are more. */
export const BOARD_LIMIT = 1000;

const BOARD_COLUMNS = 'id, created_at, name, email, phone, product, source, branch, status, assigned_to, duplicate_of, matched_quote_id, matched_quote_number, matched_quote_status, matched_quote_total, matched_quote_currency';

export interface BoardData { leads: BoardLead[]; total: number; members: OrgMember[]; sources: Map<string, string> }

export async function loadBoard(member: Member): Promise<BoardData> {
  const db = await createClient();
  const [{ data, count }, members, { data: sources }] = await Promise.all([
    db.from('leads').select(BOARD_COLUMNS, { count: 'exact' }).eq('org_id', member.orgId).neq('status', 'spam').is('merged_into', null)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, BOARD_LIMIT - 1),
    leadMembers(member.orgId),
    db.from('lead_sources').select('key, name').eq('org_id', member.orgId),
  ]);
  return {
    leads: (data ?? []) as BoardLead[],
    total: count ?? 0,
    members,
    sources: new Map((sources ?? []).map((x) => [x.key as string, x.name as string])),
  };
}
