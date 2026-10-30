import { formatUsd, type AmountInput } from '@/lib/money/fx';

const TEXT = { md: 'text-small', lg: 'text-[15px] leading-[22px]' } as const;

/** Portal money in the display currency: "$26,450.00", mono, no badge. "—" for no amount. */
export function UsdAmount({ amount, size = 'md' }: { amount: AmountInput; size?: 'md' | 'lg' }) {
  return <span className={`whitespace-nowrap font-mono font-semibold tabular-nums ${TEXT[size]}`}>{formatUsd(amount)}</span>;
}
