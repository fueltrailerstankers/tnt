import { LEAD_STATUSES, OPEN_STATUSES, type LeadStatus } from '@/lib/leads/schema';
import { currencyCode, toAmount, type AmountInput } from '@/lib/money/fx';

// Leads screens (inbox, pipeline, phone): labels, filters and board maths over the lead statuses lib/leads has.
// Pure. Nothing here invents a status: the five board stages are LEAD_STATUSES minus `spam`, which stays reachable
// from the inbox filter and the Status select.

export type StageTone = 'teal' | 'yellow' | 'accent' | 'green' | 'gray' | 'red';

/** Display label per stored status (stored values stay lower-case). */
export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New', contacted: 'Contacted', quoted: 'Quoted', won: 'Won', lost: 'Lost', spam: 'Spam',
};

/** Tone per status, as the design colours its stage dots and chips. Always shown with the label. */
export const STATUS_TONE: Record<LeadStatus, StageTone> = {
  new: 'teal', contacted: 'yellow', quoted: 'accent', won: 'green', lost: 'gray', spam: 'red',
};

/** Pipeline board columns, in order (design: New / Contacted / Quoted / Won / Lost). */
export const BOARD_STAGES = ['new', 'contacted', 'quoted', 'won', 'lost'] as const satisfies readonly LeadStatus[];
export type BoardStage = (typeof BOARD_STAGES)[number];

export const isLeadStatus = (v: unknown): v is LeadStatus => typeof v === 'string' && (LEAD_STATUSES as readonly string[]).includes(v);
export const isOpenStatus = (s: string) => (OPEN_STATUSES as readonly string[]).includes(s);

export function statusLabel(s: string): string {
  return isLeadStatus(s) ? STATUS_LABEL[s] : s;
}

export function statusTone(s: string): StageTone {
  return isLeadStatus(s) ? STATUS_TONE[s] : 'gray';
}

// ---------------------------------------------------------------------------------------------------------------
// Source badge (design: Manual / Test; other sources show their lead_sources name)
// ---------------------------------------------------------------------------------------------------------------

export interface SourceBadge { label: string; variant: 'test' | 'neutral' }

export function sourceBadge(source: string, names?: ReadonlyMap<string, string>): SourceBadge {
  if (source === 'test') return { label: 'Test', variant: 'test' };
  if (source === 'manual') return { label: 'Manual', variant: 'neutral' };
  return { label: names?.get(source) ?? source, variant: 'neutral' };
}

// ---------------------------------------------------------------------------------------------------------------
// Inbox filter chips (design: Open · n, Mine · n, Won, Lost) plus All and Spam
// ---------------------------------------------------------------------------------------------------------------

export const INBOX_VIEWS = ['open', 'mine', 'won', 'lost', 'spam', 'all'] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export const INBOX_VIEW_LABEL: Record<InboxView, string> = {
  open: 'Open', mine: 'Mine', won: 'Won', lost: 'Lost', spam: 'Spam', all: 'All',
};

/** Phone stage chips (design PhoneLeads: Open, New, Contacted, Quoted, Won) plus Lost. */
export const PHONE_VIEWS = ['open', 'new', 'contacted', 'quoted', 'won', 'lost'] as const;
export type PhoneView = (typeof PHONE_VIEWS)[number];

export interface ListFilter {
  /** Statuses to include; null = every status. */
  statuses: LeadStatus[] | null;
  /** Only leads assigned to the signed-in member. */
  mine: boolean;
}

/**
 * What a list request shows. An explicit `status` (a single stored status, e.g. ?status=contacted) wins over the
 * view chip; the default view is Open.
 */
export function listFilter(view: string | null | undefined, status: string | null | undefined): ListFilter {
  if (isLeadStatus(status)) return { statuses: [status], mine: false };
  switch (view) {
    case 'mine': return { statuses: [...OPEN_STATUSES], mine: true };
    case 'won': return { statuses: ['won'], mine: false };
    case 'lost': return { statuses: ['lost'], mine: false };
    case 'spam': return { statuses: ['spam'], mine: false };
    case 'all': return { statuses: null, mine: false };
    default: return { statuses: [...OPEN_STATUSES], mine: false };
  }
}

/** The chip that is "on" for a request: the view, or the stage when ?status= is a single stage. */
export function activeView(view: string | null | undefined, status: string | null | undefined): string {
  if (isLeadStatus(status)) return status;
  return (INBOX_VIEWS as readonly string[]).includes(view ?? '') ? (view as string) : 'open';
}

// ---------------------------------------------------------------------------------------------------------------
// Age, duplicates, Xero labels
// ---------------------------------------------------------------------------------------------------------------

/** Compact age for list rows and cards: "now", "35 min", "4 h", "2 d", "3 w", "5 mo". */
export function ageLabel(created: string | Date | null | undefined, now: Date): string {
  if (!created) return '';
  const t = new Date(created).getTime();
  if (!Number.isFinite(t)) return '';
  const min = Math.max(0, Math.floor((now.getTime() - t) / 60_000));
  if (min < 1) return 'now';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d} d`;
  if (d < 60) return `${Math.floor(d / 7)} w`;
  return `${Math.floor(d / 30)} mo`;
}

/** Screen-reader form of ageLabel ("2 days ago"). */
export function ageWords(created: string | Date | null | undefined, now: Date): string {
  const a = ageLabel(created, now);
  if (!a) return '';
  if (a === 'now') return 'just now';
  const [n, unit] = a.split(' ');
  const word = { min: 'minute', h: 'hour', d: 'day', w: 'week', mo: 'month' }[unit] ?? unit;
  return `${n} ${word}${n === '1' ? '' : 's'} ago`;
}

export interface MatchKeys { email_norm: string | null; phone_norm: string | null }

/** Why a lead was linked to its original: the normalised keys they share ("phone number", "email", both). */
export function duplicateReason(lead: MatchKeys, original: MatchKeys | null | undefined): string | null {
  if (!original) return null;
  const phone = Boolean(lead.phone_norm && lead.phone_norm === original.phone_norm);
  const email = Boolean(lead.email_norm && lead.email_norm === original.email_norm);
  if (phone && email) return 'same phone number and email';
  if (phone) return 'same phone number';
  if (email) return 'same email';
  return null;
}

/** Xero status as users know it ("SENT" -> "Sent"). */
export function xeroStatusLabel(s: string | null | undefined): string {
  const v = (s ?? '').trim();
  if (!v) return '';
  return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

/** tel: target for a stored phone (digits and a leading +), or null when nothing dialable remains. */
export function telHref(phone: string | null | undefined): string | null {
  const p = (phone ?? '').trim();
  const digits = p.replace(/\D/g, '');
  if (digits.length < 6) return null;
  return `tel:${p.startsWith('+') ? '+' : ''}${digits}`;
}

/** mailto: target for a stored email that looks like one address, else null. */
export function mailHref(email: string | null | undefined): string | null {
  const e = (email ?? '').trim();
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(e) ? `mailto:${e}` : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Pipeline board
// ---------------------------------------------------------------------------------------------------------------

export interface BoardLead {
  id: string;
  created_at: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  product: string | null;
  source: string;
  branch: string | null;
  status: string;
  assigned_to: string | null;
  duplicate_of: string | null;
  matched_quote_id: string | null;
  matched_quote_number: string | null;
  matched_quote_status: string | null;
  matched_quote_total: AmountInput;
  matched_quote_currency: string | null;
}

export interface BoardFilters {
  /** Free text over name, email, phone and product (client side; never sent in a URL). */
  q?: string;
  /** 'all' | 'mine' | 'none' */
  owner?: 'all' | 'mine' | 'none';
  /** Exact branch, or '' for all. */
  branch?: string;
  hideTest?: boolean;
}

export interface Money { currency: string; total: number }

export interface BoardColumn<T extends BoardLead = BoardLead> {
  stage: BoardStage;
  label: string;
  tone: StageTone;
  count: number;
  /** Matched quote totals per currency (Xero data is ZAR; another code is summed on its own). */
  sums: Money[];
  cards: T[];
}

const digitsOnly = (s: string) => s.replace(/\D/g, '');

export function matchesSearch(l: Pick<BoardLead, 'name' | 'email' | 'phone' | 'product'>, q: string | undefined): boolean {
  const t = (q ?? '').trim().toLowerCase();
  if (!t) return true;
  const hay = [l.name, l.email, l.product].map((v) => (v ?? '').toLowerCase());
  if (hay.some((h) => h.includes(t))) return true;
  const d = digitsOnly(t);
  return d.length >= 3 && digitsOnly(l.phone ?? '').includes(d);
}

export function filterBoard<T extends BoardLead>(leads: readonly T[], f: BoardFilters, me: string): T[] {
  return leads.filter((l) =>
    (!f.hideTest || l.source !== 'test')
    && (!f.branch || (l.branch ?? '') === f.branch)
    && (f.owner === 'mine' ? l.assigned_to === me : f.owner === 'none' ? !l.assigned_to : true)
    && matchesSearch(l, f.q));
}

/** Sums matched quote totals per currency, ZAR first, then by code. Leads without a matched quote add nothing. */
export function sumQuotes(leads: readonly Pick<BoardLead, 'matched_quote_id' | 'matched_quote_total' | 'matched_quote_currency'>[]): Money[] {
  const by = new Map<string, number>();
  for (const l of leads) {
    if (!l.matched_quote_id) continue;
    const n = toAmount(l.matched_quote_total);
    if (n === null) continue;
    const c = currencyCode(l.matched_quote_currency);
    by.set(c, Math.round(((by.get(c) ?? 0) + n) * 100) / 100);
  }
  return [...by.entries()].map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => (a.currency === 'ZAR' ? -1 : b.currency === 'ZAR' ? 1 : a.currency.localeCompare(b.currency)));
}

/** Board columns (spam is not a stage and is left off), newest first within each column. */
export function buildBoard<T extends BoardLead>(leads: readonly T[]): BoardColumn<T>[] {
  return BOARD_STAGES.map((stage) => {
    const cards = leads.filter((l) => l.status === stage)
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    return { stage, label: STATUS_LABEL[stage], tone: STATUS_TONE[stage], count: cards.length, sums: sumQuotes(cards), cards };
  });
}

/** Header line: open leads (New, Contacted, Quoted) and their matched quote value. */
export function openSummary(leads: readonly BoardLead[]): { count: number; sums: Money[] } {
  const open = leads.filter((l) => isOpenStatus(l.status));
  return { count: open.length, sums: sumQuotes(open) };
}

/** Distinct non-empty branches, sorted, for the Branch filter. */
export function branchOptions(leads: readonly Pick<BoardLead, 'branch'>[]): string[] {
  return [...new Set(leads.map((l) => (l.branch ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
