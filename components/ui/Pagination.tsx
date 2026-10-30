import Link from 'next/link';
import { clampPage, pageRange } from '@/lib/ui/pagination';
import { Icon } from './Icon';
import { iconButtonClass } from './IconButton';

export interface PaginationProps {
  page: number;
  pageCount: number;
  /** Link mode (URL state, works without JS). */
  prevHref?: string;
  nextHref?: string;
  /** Button mode (client parents). */
  onPrev?: () => void;
  onNext?: () => void;
  /** With both, the left side reads "Showing 1–50 of 214". */
  total?: number;
  pageSize?: number;
  /** Table footer look (top border, padding). */
  footer?: boolean;
}

const STEP = iconButtonClass('secondary', 32);

function Step({ dir, enabled, href, onClick }: { dir: 'prev' | 'next'; enabled: boolean; href?: string; onClick?: () => void }) {
  const label = dir === 'prev' ? 'Previous page' : 'Next page';
  const icon = <Icon name={dir === 'prev' ? 'chevronLeft' : 'chevronRight'} size={16} strokeWidth={2} />;
  if (enabled && href) return <Link href={href} aria-label={label} className={STEP}>{icon}</Link>;
  return (
    <button type="button" aria-label={label} disabled={!enabled} onClick={enabled ? onClick : undefined} className={STEP}>
      {icon}
    </button>
  );
}

/** Previous / Next with "Page X of Y". */
export function Pagination({ page, pageCount, prevHref, nextHref, onPrev, onNext, total, pageSize, footer = true }: PaginationProps) {
  const count = Math.max(1, Math.floor(pageCount) || 1);
  const p = clampPage(page, count);
  const range = total !== undefined && pageSize ? pageRange(p, pageSize, total) : null;
  return (
    <nav
      aria-label="Pagination"
      className={`flex flex-wrap items-center justify-between gap-3 text-small text-fg-muted ${footer ? 'border-t border-border px-3.5 py-2.5' : ''}`}
    >
      <span>{range ? (total ? `Showing ${range.from}–${range.to} of ${total}` : 'No rows') : null}</span>
      <div className="flex items-center gap-2">
        <span aria-live="polite">{`Page ${p} of ${count}`}</span>
        <Step dir="prev" enabled={p > 1 && !!(prevHref || onPrev)} href={prevHref} onClick={onPrev} />
        <Step dir="next" enabled={p < count && !!(nextHref || onNext)} href={nextHref} onClick={onNext} />
      </div>
    </nav>
  );
}
