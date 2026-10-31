// Xero mirror pages (quotes, invoices): list paging, URL state, status labels, totals and Xero links. Pure.
// The mirror is read only: nothing here builds a request to Xero, only links a person can open in their browser.
import { z } from 'zod';
import { toAmount, type AmountInput } from '@/lib/money/fx';
import { searchTerm } from './format';

export const MIRROR_PAGE = 50;

export function pageOf(p: string | string[] | undefined): number {
  const n = Number.parseInt(Array.isArray(p) ? p[0] : p ?? '', 10);
  return Number.isFinite(n) && n > 0 && n < 100_000 ? n : 1;
}

export function oneOf<T extends string>(v: string | string[] | undefined, allowed: readonly T[]): T | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s && (allowed as readonly string[]).includes(s) ? (s as T) : null;
}

export const QUOTE_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'INVOICED', 'DECLINED', 'DELETED'] as const;
export const INVOICE_STATUSES = ['DRAFT', 'SUBMITTED', 'AUTHORISED', 'PAID', 'VOIDED', 'DELETED'] as const;
/** Invoice filters: the Xero statuses plus OVERDUE (authorised, unpaid, past its due date). */
export const INVOICE_FILTERS = ['DRAFT', 'SUBMITTED', 'AUTHORISED', 'OVERDUE', 'PAID', 'VOIDED', 'DELETED'] as const;
export const INVOICE_TYPES = ['ACCREC', 'ACCPAY', 'ALL'] as const;
export type MirrorKind = 'quotes' | 'invoices';
export type InvoiceType = (typeof INVOICE_TYPES)[number];

/** Drawer id (?id=): a Xero GUID or a synthetic id. Only ever used as an equality filter. */
export const MIRROR_ID = /^[A-Za-z0-9-]{1,64}$/;

export interface MirrorQuery {
  q: string | null;
  status: string | null;
  /** Invoices only; ACCREC by default. */
  type: InvoiceType;
  page: number;
  id: string | null;
}

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const text = z.preprocess(first, z.string().optional());

/** Validates list search params (Zod); anything unknown or malformed falls back to the default. */
export function parseMirrorQuery(kind: MirrorKind, sp: Record<string, string | string[] | undefined>): MirrorQuery {
  const parsed = z.object({ q: text, status: text, type: text, page: text, id: text }).safeParse(sp);
  const v = parsed.success ? parsed.data : {};
  const statuses: readonly string[] = kind === 'quotes' ? QUOTE_STATUSES : INVOICE_FILTERS;
  const id = v.id && MIRROR_ID.test(v.id) ? v.id : null;
  return {
    q: searchTerm(v.q),
    status: v.status && statuses.includes(v.status) ? v.status : null,
    type: kind === 'invoices' ? oneOf(v.type, INVOICE_TYPES) ?? 'ACCREC' : 'ACCREC',
    page: pageOf(v.page),
    id,
  };
}

/** List URL for the given state; defaults (page 1, type ACCREC) are left out so links stay short. */
export function mirrorHref(kind: MirrorKind, state: MirrorQuery, over: Partial<MirrorQuery> = {}): string {
  const s = { ...state, ...over };
  const u = new URLSearchParams();
  if (s.q) u.set('q', s.q);
  if (s.status) u.set('status', s.status);
  if (kind === 'invoices' && s.type !== 'ACCREC') u.set('type', s.type);
  if (s.page > 1) u.set('page', String(s.page));
  if (s.id) u.set('id', s.id);
  const qs = u.toString();
  return `/admin/xero/${kind}${qs ? `?${qs}` : ''}`;
}

/** "AUTHORISED" -> "Authorised". Xero sends upper case; the chips use the labels staff know. */
export function statusLabel(status: string | null | undefined): string {
  const s = (status ?? '').trim();
  if (!s) return 'Unknown';
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}

/** Today's calendar date in Africa/Johannesburg, "YYYY-MM-DD" (due dates are SAST calendar days). */
export function sastToday(now: Date | string | number = new Date()): string {
  const d = new Date(now);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

export interface InvoiceStatusInput {
  status: string | null;
  due_date: string | null;
  amount_due: AmountInput;
}

/** Whether an invoice is overdue: authorised, money still due, and the due date (SAST day) has passed. */
export function isOverdue(row: InvoiceStatusInput, today: string): boolean {
  const due = toAmount(row.amount_due);
  return row.status === 'AUTHORISED' && !!row.due_date && row.due_date.slice(0, 10) < today && due !== null && due > 0;
}

/** Chip label for an invoice: "Overdue" when overdue, else the Xero status. */
export function invoiceStatusLabel(row: InvoiceStatusInput, today: string): string {
  return isOverdue(row, today) ? 'Overdue' : statusLabel(row.status);
}

/**
 * Tax line label: "VAT 15%" when the tax is 15% of the subtotal (to the cent, allowing per-line rounding), else
 * "VAT" (zero-rated lines, mixed rates). The amounts are Xero's own; nothing is recalculated.
 */
export function taxLabel(subTotal: AmountInput, totalTax: AmountInput): string {
  const sub = toAmount(subTotal);
  const tax = toAmount(totalTax);
  if (sub === null || tax === null || sub === 0) return 'VAT';
  return Math.abs(sub * 0.15 - tax) <= Math.max(0.05, Math.abs(sub) * 0.0001) ? 'VAT 15%' : 'VAT';
}

const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Browser link to the record in Xero (a person opens it signed in to Xero; the portal never calls it). Null unless
 * the id is a Xero GUID. Invoices use Xero's long-standing View.aspx pages (sales and bills); quotes use the
 * quotes app path.
 */
export function xeroLink(kind: 'quote' | 'invoice', id: string | null | undefined, invoiceType?: string | null): string | null {
  if (!id || !GUID.test(id)) return null;
  if (kind === 'quote') return `https://go.xero.com/app/quotes/view/${id}`;
  const area = invoiceType === 'ACCPAY' ? 'AccountsPayable' : 'AccountsReceivable';
  return `https://go.xero.com/${area}/View.aspx?InvoiceID=${id}`;
}

/** "12.4 KB". Empty for a missing or negative size. */
export function fileSize(n: number | string | null | undefined): string {
  const b = Number(n);
  if (n === null || n === undefined || n === '' || !Number.isFinite(b) || b < 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/** Line quantity without trailing zeros ("1", "2.5"). */
export function quantity(q: AmountInput): string {
  const n = toAmount(q);
  if (n === null) return '';
  return String(Math.round(n * 10_000) / 10_000);
}
