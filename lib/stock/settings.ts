// Stock settings (org app_settings 'stock.*', docs/M6.md section 4): parsing, defaults and the rules switch. Pure.
// The keys are written only by the Pilot setup server actions (stock.manage, then the service role); RLS (0011
// settings_no_client_stock_*) rejects client writes. Values are JSON strings: "2026-03-01", "preview".

import { zonedDayStart } from '@/lib/admin/grid';

export const STOCK_START_KEY = 'stock.deals_from';
export const INVOICE_RULES_KEY = 'stock.invoice_rules';

export const INVOICE_RULE_MODES = ['off', 'preview', 'live'] as const;
export type InvoiceRuleMode = (typeof INVOICE_RULE_MODES)[number];
/** Unset (or unreadable) = preview: the rules are evaluated and shown, no unit changes. */
export const DEFAULT_INVOICE_RULES: InvoiceRuleMode = 'preview';
/** What an admin types to switch the invoice rules to live. */
export const LIVE_CONFIRMATION = 'live';

export const RULE_MODE_LABEL: Record<InvoiceRuleMode, string> = { off: 'Off', preview: 'Preview', live: 'Live' };

export const RULE_MODE_ABOUT: Record<InvoiceRuleMode, string> = {
  off: 'Xero invoices are not checked against stock.',
  preview: 'Each stock invoice shows what it would do on Invoice review. No unit changes and no exceptions are recorded.',
  live: 'Unpaid invoices reserve their unit, paid invoices mark it sold, and doubtful invoices go to the exceptions queue.',
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date "YYYY-MM-DD" between 2000 and 2100. */
export function isIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * 'stock.deals_from' -> "YYYY-MM-DD", or null when unset or unreadable. Same reading as the deal sync: a JSON
 * string, an object { date } or a full timestamp (its first 10 characters).
 */
export function parseStockStart(v: unknown): string | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return parseStockStart((v as { date?: unknown }).date);
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, 10);
  return isIsoDate(s) ? s : null;
}

/** 'stock.invoice_rules' -> off | preview | live; anything else (unset included) is preview. */
export function parseInvoiceRules(v: unknown): InvoiceRuleMode {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return (INVOICE_RULE_MODES as readonly string[]).includes(s) ? (s as InvoiceRuleMode) : DEFAULT_INVOICE_RULES;
}

export interface StockSettings {
  /** Stock start date ("YYYY-MM-DD"): DEAL entries created and Xero invoices changed on or after it. */
  start: string | null;
  rules: InvoiceRuleMode;
}

/** Reads the stock settings from app_settings rows ({ key, value }). */
export function stockSettingsFrom(rows: ReadonlyArray<{ key: string; value: unknown }> | null | undefined): StockSettings {
  const get = (k: string) => rows?.find((r) => r.key === k)?.value;
  return { start: parseStockStart(get(STOCK_START_KEY)), rules: parseInvoiceRules(get(INVOICE_RULES_KEY)) };
}

/**
 * The first instant (UTC ISO) the invoice rules look at: the start of the stock start date in the org timezone.
 * Invoices last changed in Xero before it are history and never checked (no exceptions for old unit sales).
 */
export function invoicesFromInstant(start: string, timeZone: string): string {
  return zonedDayStart(start, timeZone);
}

/** Why a rules change is refused, or null when it may be saved. Live needs the typed confirmation "live". */
export function checkRulesSwitch(to: InvoiceRuleMode, typed: string | null | undefined): string | null {
  if (to === 'live' && (typed ?? '').trim().toLowerCase() !== LIVE_CONFIRMATION) {
    return `Type "${LIVE_CONFIRMATION}" to switch the invoice rules to live.`;
  }
  return null;
}
