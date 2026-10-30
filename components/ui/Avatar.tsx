import { initials } from '@/lib/ui/initials';

const SIZE = {
  24: 'size-6 rounded-full text-[10px]',
  30: 'size-[30px] rounded-sm text-[12px]',
  36: 'size-9 rounded-sm text-[13px]',
} as const;

/**
 * Initials tile. Set `decorative` when the name is printed next to it (aria-hidden); otherwise it is role=img
 * named after the person.
 */
export function Avatar({ name, fallback = '?', size = 30, decorative = false }: { name: string | null; fallback?: string; size?: 24 | 30 | 36; decorative?: boolean }) {
  const label = name?.trim() || fallback;
  return (
    <span
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
      className={`inline-flex flex-none select-none items-center justify-center bg-accent-soft font-bold leading-none text-accent-text ${SIZE[size]}`}
    >
      {initials(name, fallback)}
    </span>
  );
}
