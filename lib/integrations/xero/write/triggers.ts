// What starts each action. Pure.
import { isFullyPaid } from './plan-release';
import type { ActionName, InvoiceIn } from './types';

/** Form saves that enqueue an action (BUILD_PLAN 4.1 to 4.3). */
export function actionsForSave(formSlug: string, actionName: string): ActionName[] {
  if (formSlug === 'deal' && actionName === 'Submit') return ['deal.import_quote'];
  if (formSlug === 'request-for-invoice' && (actionName === 'Submit' || actionName === 'Update')) return ['rfi.create_invoice'];
  if (formSlug === 'delivery-note' && (actionName === 'Submit' || actionName === 'Update')) return ['delivery.update_invoice'];
  return [];
}

type Paid = Pick<InvoiceIn, 'invoice_id' | 'amount_due' | 'status' | 'invoice_type' | 'total'>;

/**
 * Invoices that just became fully paid, for release.on_paid.
 * - before: amount_due per invoice id as stored before the upsert (missing = not in the mirror yet)
 * - backfillDone: during the initial backfill every old paid invoice is "new"; those must not create
 *   releases (history comes from the Cognito import in M5). After the backfill, a new invoice that arrives
 *   already paid (paid within one sync interval) does count.
 */
export function paidTransitions(before: Map<string, number | string | null>, after: Paid[], backfillDone: boolean): string[] {
  const out: string[] = [];
  for (const inv of after) {
    if (!isFullyPaid(inv)) continue;
    const had = before.has(inv.invoice_id);
    const prev = had ? before.get(inv.invoice_id) : undefined;
    const wasPaid = had && prev !== null && prev !== undefined && Number(prev) === 0;
    if (wasPaid) continue;
    if (!had && !backfillDone) continue;
    out.push(inv.invoice_id);
  }
  return out;
}
