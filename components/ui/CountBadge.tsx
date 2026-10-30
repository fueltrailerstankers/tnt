import { badgeLabel } from '@/lib/ui/nav';

/** Red pill count for nav items and tabs, capped at 99+. Renders nothing for zero. Named "<n> waiting" by default. */
export function CountBadge({ count, noun = 'waiting', small = false }: { count: number; noun?: string; small?: boolean }) {
  const text = badgeLabel(count);
  if (!text) return null;
  return (
    <span
      role="img"
      aria-label={`${text} ${noun}`}
      className={`inline-flex flex-none items-center justify-center rounded-pill bg-danger font-bold text-white ${small ? 'h-[18px] min-w-[18px] px-[5px] text-[10px]' : 'h-5 min-w-5 px-1.5 text-[11px]'}`}
    >
      {text}
    </span>
  );
}
