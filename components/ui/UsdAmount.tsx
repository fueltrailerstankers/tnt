import { formatUsd, type AmountInput } from '@/lib/money/fx';

const TEXT = { md: 'text-small', lg: 'text-[15px] leading-[22px]' } as const;

/** Portal money in the display currency: "$26,450.00" (formatUsd in lib/money/fx), mono, no badge. "—" for no amount. */
export function UsdAmount({ amount, size = 'md', align = 'start' }: { amount: AmountInput; size?: 'md' | 'lg'; align?: 'start' | 'end' }) {
  return (
    <span className={`whitespace-nowrap font-mono font-semibold tabular-nums ${TEXT[size]} ${align === 'end' ? 'text-right' : ''}`.trim()}>
      {formatUsd(amount)}
    </span>
  );
}
