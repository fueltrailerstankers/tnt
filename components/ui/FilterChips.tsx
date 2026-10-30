import Link from 'next/link';
import type { Tone } from '@/lib/ui/status';

export interface FilterChip {
  value: string;
  label: string;
  count?: number;
  /** Render as a link (URL state). The selected link gets aria-current="page". */
  href?: string;
  /** Dot colour for status filters; 'all' is a muted dot. */
  dot?: Tone | 'all';
}

export interface FilterChipsProps {
  /** Group name, e.g. "Filter by status". */
  label: string;
  chips: readonly FilterChip[];
  value: string;
  /** Button chips call this (client parents only). Link chips navigate instead. */
  onChange?: (value: string) => void;
  /** sm: 28px count chips ("All · 128"). md: 30px status chips. lg: 32px task chips. */
  size?: 'sm' | 'md' | 'lg';
  /** Scroll sideways instead of wrapping (phone stage chips). */
  scroll?: boolean;
}

const SIZE = {
  sm: 'h-7 px-2.5 text-[12px] leading-4',
  md: 'h-[30px] px-2.5 text-[12px] leading-4',
  lg: 'h-8 px-3 text-small',
} as const;

const DOT: Record<Tone | 'all', string> = {
  all: 'bg-fg-muted',
  gray: 'bg-status-gray-fg',
  teal: 'bg-status-teal-fg',
  yellow: 'bg-status-yellow-fg',
  green: 'bg-status-green-fg',
  red: 'bg-status-red-fg',
};

/**
 * Pill filter chips with optional counts. Selected is inverted (fg on bg). Buttons use aria-pressed; link chips
 * use aria-current so the URL holds the filter.
 */
export function FilterChips({ label, chips, value, onChange, size = 'md', scroll = false }: FilterChipsProps) {
  return (
    <div role="group" aria-label={label} className={`flex gap-2 ${scroll ? 'flex-nowrap gap-1.5 overflow-x-auto pb-0.5' : 'flex-wrap'}`}>
      {chips.map((c) => {
        const on = c.value === value;
        const cls = [
          'inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-pill border no-underline transition',
          SIZE[size],
          on ? 'border-fg bg-fg font-semibold text-bg' : `border-border bg-surface text-fg hover:bg-surface-2 ${size === 'sm' ? 'font-medium' : 'font-semibold'}`,
        ].join(' ');
        const body = (
          <>
            {c.dot ? <span aria-hidden="true" className={`size-1.5 flex-none rounded-full ${on ? 'bg-current' : DOT[c.dot]}`} /> : null}
            {c.label}
            {c.count !== undefined ? <span className="tabular-nums">{` · ${c.count}`}</span> : null}
          </>
        );
        return c.href ? (
          <Link key={c.value} href={c.href} aria-current={on ? 'page' : undefined} className={cls}>{body}</Link>
        ) : (
          <button key={c.value} type="button" aria-pressed={on} onClick={onChange ? () => onChange(c.value) : undefined} className={cls}>
            {body}
          </button>
        );
      })}
    </div>
  );
}
