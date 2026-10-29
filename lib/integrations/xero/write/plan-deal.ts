// deal.import_quote (BUILD_PLAN 4.1). Pure.
// Trigger: DEAL Submit. Xero GET /Quotes?QuoteNumber=QU-{QUOTENO}; only the quote whose QuoteNumber equals
// QU-{QUOTENO} counts. Lines 1..8 fill LINEn (Description) and PARTNOn (ItemCode); Total = quote Total.
// This writes our own (encrypted) DEAL entry, never Xero, so it has no planned Xero requests.
import { quoteNoOf } from '../mappers';
import { emptyPlan, money, text, type EntryIn, type Plan, type QuoteIn, type QuoteLineIn } from './types';

export const DEAL_LINES = 8;

export interface DealInput {
  entry: EntryIn;
  /** Quotes found for the number (mirror, refreshed by GET in live). */
  quotes: QuoteIn[];
  lines: QuoteLineIn[];
}

export function dealKey(entryId: string) {
  return `deal.import_quote:${entryId}`;
}

export function planDealImport(input: DealInput): Plan {
  const key = dealKey(input.entry.id);
  const no = quoteNoOf(text(input.entry.data.QUOTENO));
  if (!no) return emptyPlan('deal.import_quote', key, 'skip', 'DEAL has no quote number');
  const quote = input.quotes.find((q) => (q.quote_number ?? '').toUpperCase() === `QU-${no}`);
  if (!quote) return emptyPlan('deal.import_quote', key, 'retry', 'quote not found in Xero');

  const lines = input.lines.slice().sort((a, b) => a.line_no - b.line_no).slice(0, DEAL_LINES);
  const target: Record<string, unknown> = {};
  lines.forEach((l, i) => {
    target[`LINE${i + 1}`] = l.description ?? '';
    target[`PARTNO${i + 1}`] = l.item_code ?? '';
  });
  const total = money(quote.total);
  if (total !== null) target.Total = total;

  // Only fields that change; empty strings clear a field (the quote line has no code).
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(target)) {
    const cur = input.entry.data[k];
    const same = v === '' ? cur === undefined || cur === null || cur === '' : cur === v;
    if (!same) fields[k] = v === '' ? null : v;
  }
  const plan: Plan = {
    action: 'deal.import_quote', idempotencyKey: key, status: 'ready', requests: [], effects: [],
    expected: { quoteNumber: quote.quote_number, linesImported: lines.length, total, currency: quote.currency_code },
  };
  if (Object.keys(fields).length) plan.effects.push({ kind: 'entry.patch', formSlug: 'deal', entryId: input.entry.id, fields });
  else plan.reason = 'DEAL already matches the quote';
  return plan;
}
