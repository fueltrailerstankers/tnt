// Deal file Xero panel: quote progress and the invoice figures, from the read-only mirror. Pure.
import { toAmount, type AmountInput } from '@/lib/money/fx';

export interface QuoteProgressStep {
  label: 'Sent' | 'Accepted' | 'Invoiced';
  reached: boolean;
}

/**
 * Sent -> Accepted -> Invoiced from the Xero quote status. A sales invoice linked to the deal also counts as
 * invoiced (Make's flow invoices before the quote status is changed). Declined quotes reached Sent only.
 */
export function quoteProgress(status: string | null | undefined, hasInvoice = false): QuoteProgressStep[] {
  const s = (status ?? '').toUpperCase();
  const invoiced = s === 'INVOICED' || hasInvoice;
  const accepted = invoiced || s === 'ACCEPTED';
  const sent = accepted || s === 'SENT' || s === 'DECLINED';
  return [
    { label: 'Sent', reached: sent },
    { label: 'Accepted', reached: accepted },
    { label: 'Invoiced', reached: invoiced },
  ];
}

export interface PanelInvoiceRow {
  invoice_id: string;
  invoice_number: string | null;
  status: string | null;
  currency_code: string | null;
  total: AmountInput;
  amount_due: AmountInput;
  fully_paid_on: string | null;
}

/** Fully paid: Xero says PAID, or nothing is due and a paid date is set. */
export function isPaid(i: Pick<PanelInvoiceRow, 'status' | 'amount_due' | 'fully_paid_on'>): boolean {
  if ((i.status ?? '').toUpperCase() === 'PAID') return true;
  const due = toAmount(i.amount_due);
  return due !== null && due <= 0 && !!i.fully_paid_on;
}

/** The Release step waits for payment while the deal has a live sales invoice and none of them is paid. */
export function awaitingPayment(invoices: readonly Pick<PanelInvoiceRow, 'status' | 'amount_due' | 'fully_paid_on'>[]): boolean {
  const live = invoices.filter((i) => !['VOIDED', 'DELETED', 'DRAFT'].includes((i.status ?? '').toUpperCase()));
  return live.length > 0 && !live.some(isPaid);
}
