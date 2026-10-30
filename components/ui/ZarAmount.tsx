import { approxUsd, currencyCode, formatAmount, formatUsd, toAmount, type AmountInput } from '@/lib/money/fx';
import { Badge } from './Badge';

const TEXT = { sm: 'text-small', md: 'text-small', lg: 'text-[15px] leading-[22px]' } as const;

export interface ZarAmountProps {
  amount: AmountInput;
  /** The row's currency_code. Xero data is ZAR; another code is shown in the badge instead. */
  currency?: string | null;
  /** USD per 1 ZAR. Only pass a rate from a real source; without one the "≈ USD" line is hidden. */
  fxRate?: number | null;
  /** sm: drawer totals (small badge), md: tables, lg: summaries. */
  size?: 'sm' | 'md' | 'lg';
  /** end for right-aligned table cells. */
  align?: 'start' | 'end';
}

/**
 * Xero-sourced money: mono amount + currency badge (ZAR, or the row's own code), and a muted "≈ USD $…" line only
 * when the amount is ZAR and a real rate is passed (approxUsd in lib/money/fx). "—" for no amount.
 */
export function ZarAmount({ amount, currency = 'ZAR', fxRate, size = 'md', align = 'start' }: ZarAmountProps) {
  const has = toAmount(amount) !== null;
  const code = currencyCode(currency);
  const usd = approxUsd(amount, code, fxRate);
  return (
    <span className={`inline-flex flex-col gap-0.5 ${align === 'end' ? 'items-end text-right' : 'items-start'}`}>
      <span className="inline-flex items-center gap-2">
        <span className={`whitespace-nowrap font-mono font-semibold tabular-nums ${TEXT[size]}`}>{formatAmount(amount, code)}</span>
        {has ? <Badge variant="zar" size={size === 'sm' ? 'sm' : 'md'}>{code}</Badge> : null}
      </span>
      {usd !== null ? (
        <span className="whitespace-nowrap text-small text-fg-muted">
          <span aria-hidden="true">≈</span>
          <span className="sr-only">approximately</span> USD <span className="font-mono tabular-nums">{formatUsd(usd)}</span>
        </span>
      ) : null}
    </span>
  );
}
