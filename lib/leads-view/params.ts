import { searchTerm } from '@/lib/admin/format';
import { oneOf, pageOf } from '@/lib/admin/mirror';
import { LEAD_STATUSES, type LeadStatus } from '@/lib/leads/schema';
import { INBOX_VIEWS } from './model';

// Inbox URL parameters. Pure. The URL holds filter values only (view, status, source, branch, assignee id, page and
// the search text the user typed), never lead data.

type Sp = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string) => UUID.test(v);

export interface InboxParams {
  q: string | null;
  view: string;
  status: LeadStatus | null;
  source: string | null;
  branch: string | null;
  assigned: string | null;
  dups: boolean;
  page: number;
}

export function inboxParams(sp: Sp, sourceKeys: readonly string[]): InboxParams {
  const assignedRaw = one(sp.assigned);
  const viewRaw = one(sp.view);
  return {
    q: searchTerm(sp.q),
    view: (INBOX_VIEWS as readonly string[]).includes(viewRaw) ? viewRaw : 'open',
    status: oneOf(sp.status, LEAD_STATUSES),
    source: oneOf(sp.source, sourceKeys),
    branch: searchTerm(sp.branch),
    assigned: assignedRaw === 'me' || assignedRaw === 'none' || UUID.test(assignedRaw) ? assignedRaw : null,
    dups: one(sp.dups) === '1',
    page: pageOf(sp.page),
  };
}

/** Query string for the inbox with some params replaced (null removes). Holds filter values only, never lead data. */
export function inboxQuery(p: InboxParams, over: Partial<Record<keyof InboxParams, string | null>> = {}): string {
  const base: Record<string, string | null> = {
    q: p.q, view: p.view === 'open' ? null : p.view, status: p.status, source: p.source, branch: p.branch,
    assigned: p.assigned, dups: p.dups ? '1' : null, page: p.page > 1 ? String(p.page) : null,
  };
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v && !(k === 'page' && v === '1')) u.set(k, v);
  return u.size ? `?${u}` : '';
}

