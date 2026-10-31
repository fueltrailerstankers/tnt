import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { buttonClass } from '@/components/ui/styles';
import { quantity, taxLabel } from '@/lib/admin/mirror';
import { approxUsd, currencyCode, formatAmount, formatUsd, type AmountInput } from '@/lib/money/fx';

// Drawer sections for a mirrored quote or invoice. Server-rendered; amounts are Xero's own, never recalculated.

export function Facts({ items }: { items: ReadonlyArray<{ term: string; value: ReactNode; mono?: boolean }> }) {
  return (
    <dl className="m-0 grid grid-cols-2 gap-3 text-small">
      {items.map((i) => (
        <div key={i.term} className="min-w-0">
          <dt className="text-fg-muted">{i.term}</dt>
          <dd className={`m-0 mt-0.5 break-words font-medium ${i.mono ? 'font-mono' : ''}`}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface LineView { line_no: number; item_code: string | null; description: string | null; quantity: AmountInput; line_amount: AmountInput }

export function Lines({ lines, currency }: { lines: readonly LineView[]; currency: string | null }) {
  return (
    <section aria-labelledby="mirror-lines" className="flex flex-col">
      <h3 id="mirror-lines" className="m-0 mb-2 text-body font-semibold">Lines</h3>
      {lines.length ? (
        <ul className="m-0 list-none p-0" data-testid="mirror-lines">
          {lines.map((l) => (
            <li key={l.line_no} className="grid grid-cols-[minmax(0,1fr)_40px_minmax(96px,auto)] gap-2 border-t border-border py-2 text-small">
              <span className="flex min-w-0 flex-col">
                {l.item_code ? <span className="font-mono text-[12px] leading-4 text-fg-muted">{l.item_code}</span> : null}
                <span className="break-words">{l.description || '—'}</span>
              </span>
              <span className="text-right text-fg-muted"><span className="sr-only">Quantity </span>×{quantity(l.quantity)}</span>
              <span className="whitespace-nowrap text-right font-mono tabular-nums">{formatAmount(l.line_amount, currency)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="m-0 border-t border-border py-2 text-small text-fg-muted">No lines in the mirror.</p>}
    </section>
  );
}

/** Subtotal, VAT, Total (with the currency badge), extra rows (paid, due) and "≈ USD" only with a real rate. */
export function Totals({ subTotal, totalTax, total, currency, fxRate, extra = [] }: {
  subTotal: AmountInput; totalTax: AmountInput; total: AmountInput; currency: string | null; fxRate: number | null;
  extra?: ReadonlyArray<{ label: string; amount: AmountInput; strong?: boolean }>;
}) {
  const code = currencyCode(currency);
  const usd = approxUsd(total, code, fxRate);
  const row = (label: string, value: ReactNode, strong = false, key = label) => (
    <div key={key} className="contents">
      <dt className={strong ? 'font-semibold' : 'text-fg-muted'}>{label}</dt>
      <dd className={`m-0 whitespace-nowrap text-right font-mono tabular-nums ${strong ? 'font-semibold' : ''}`}>{value}</dd>
    </div>
  );
  return (
    <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 border-t border-border-strong pt-2.5 text-small" data-testid="mirror-totals">
      {row('Subtotal', formatAmount(subTotal, code))}
      {row(taxLabel(subTotal, totalTax), formatAmount(totalTax, code))}
      {row('Total', <span className="inline-flex items-center gap-1.5">{formatAmount(total, code)}<Badge variant="zar" size="sm">{code}</Badge></span>, true)}
      {usd !== null ? row('≈ USD', <span className="text-fg-muted">{formatUsd(usd)}</span>, false, 'usd') : null}
      {extra.map((e) => row(e.label, formatAmount(e.amount, code), e.strong))}
    </dl>
  );
}

export function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h3 id={id} className="m-0 text-body font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** Footer: Open in Xero (new tab) and Go to deal file. Missing targets are left out, never shown as dead links. */
export function RecordFooter({ xeroHref, dealHref }: { xeroHref: string | null; dealHref: string | null }) {
  if (!xeroHref && !dealHref) return null;
  return (
    <div className="flex w-full flex-wrap gap-2">
      {xeroHref ? (
        <a href={xeroHref} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary', 38, 'flex-1')}>
          Open in Xero<Icon name="external" size={14} strokeWidth={2} /><span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : null}
      {dealHref ? <Link href={dealHref} className={buttonClass('primary', 38, 'flex-1')}>Go to deal file</Link> : null}
    </div>
  );
}
