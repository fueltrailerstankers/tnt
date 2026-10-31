import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { StatusChip } from '@/components/ui/StatusChip';
import { ZarAmount } from '@/components/ui/ZarAmount';
import { invoiceStatusLabel, statusLabel } from '@/lib/admin/mirror';
import { isPaid, quoteProgress, type PanelInvoiceRow } from '@/lib/deal-view/xero';
import { dayTime, shortDate } from '@/lib/ui/time';

export interface PanelQuote {
  quote_id: string;
  quote_number: string | null;
  status: string | null;
  currency_code: string | null;
  total: number | string | null;
  synced_at: string | null;
}

/**
 * Xero panel of a deal file: quote Sent / Accepted / Invoiced, then per invoice the total, amount due and paid date.
 * Read-only mirror. `quotes` / `invoices` say whether the member may read them (null data then means "no access").
 */
export function XeroPanel({ quoteLabel, quote, invoices, canQuotes, canInvoices, fxRate, today, now }: {
  quoteLabel: string;
  quote: PanelQuote | null;
  invoices: readonly (PanelInvoiceRow & { synced_at?: string | null })[];
  canQuotes: boolean;
  canInvoices: boolean;
  fxRate: number | null;
  today: string;
  now: string;
}) {
  const steps = quoteProgress(quote?.status, invoices.length > 0);
  const synced = [quote?.synced_at, ...invoices.map((i) => i.synced_at)].filter((x): x is string => !!x).sort().pop();
  return (
    <Card aria-labelledby="xero-h" className="min-w-0 flex-[1_1_380px]" data-testid="deal-xero">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="xero-h" className="m-0 text-[15px] font-semibold leading-[22px]">Xero</h2>
        <span className="text-small text-fg-muted">Read-only mirror{synced ? ` · synced ${dayTime(synced, now)} SAST` : ''}</span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-small text-fg-muted">
          <span>Quote <span className="font-mono">{quoteLabel}</span></span>
          {quote ? <StatusChip status={statusLabel(quote.status)} size="sm" /> : null}
        </div>
        {canQuotes ? (
          quote ? (
            <ol aria-label="Quote progress" className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
              {steps.map((st) => (
                <li
                  key={st.label}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-sm px-3 text-small font-semibold ${st.reached ? 'bg-status-green-bg text-status-green-fg' : 'bg-surface-2 text-fg-muted'}`}
                >
                  {st.reached ? <Icon name="check" size={14} strokeWidth={2.5} /> : null}
                  {st.label}
                  <span className="sr-only">{st.reached ? ' (reached)' : ' (not yet)'}</span>
                </li>
              ))}
            </ol>
          ) : <p className="m-0 text-small text-fg-muted">This quote is not in the Xero mirror.</p>
        ) : <p className="m-0 text-small text-fg-muted">You do not have access to Xero quotes.</p>}
        {canQuotes && quote ? (
          <Link href={`/admin/xero/quotes?id=${encodeURIComponent(quote.quote_id)}`} className="self-start text-small font-semibold text-accent-text">Open quote detail</Link>
        ) : null}
      </div>

      {!canInvoices ? (
        <p className="m-0 text-small text-fg-muted">You do not have access to Xero invoices.</p>
      ) : invoices.length ? invoices.map((inv) => (
        <div key={inv.invoice_id} className="flex flex-col gap-3 border-t border-border pt-3">
          <dl className="m-0 grid grid-cols-2 gap-3.5">
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-small text-fg-muted">Invoice total</dt>
              <dd className="m-0"><ZarAmount amount={inv.total} currency={inv.currency_code} fxRate={fxRate} size="lg" /></dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-small text-fg-muted">Amount due</dt>
              <dd className={`m-0 ${isPaid(inv) ? 'text-status-green-fg' : ''}`}><ZarAmount amount={inv.amount_due} currency={inv.currency_code} size="lg" /></dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-small text-fg-muted">Invoice</dt>
              <dd className="m-0 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[15px]">{inv.invoice_number || '(no number)'}</span>
                <StatusChip status={invoiceStatusLabel(inv, today)} size="sm" />
              </dd>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <dt className="text-small text-fg-muted">Paid date</dt>
              <dd className="m-0 text-[15px]">{shortDate(inv.fully_paid_on) || '—'}</dd>
            </div>
          </dl>
          <Link href={`/admin/xero/invoices?id=${encodeURIComponent(inv.invoice_id)}`} className="self-start text-small font-semibold text-accent-text">
            Open invoice detail<span className="sr-only"> {inv.invoice_number ?? ''}</span>
          </Link>
        </div>
      )) : (
        <dl className="m-0 grid grid-cols-2 gap-3.5 border-t border-border pt-3">
          <div className="flex flex-col gap-1"><dt className="text-small text-fg-muted">Invoice</dt><dd className="m-0 text-[15px]">Not invoiced</dd></div>
          <div className="flex flex-col gap-1"><dt className="text-small text-fg-muted">Paid date</dt><dd className="m-0 text-[15px]">—</dd></div>
        </dl>
      )}
    </Card>
  );
}
