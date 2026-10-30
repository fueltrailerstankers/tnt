import { describe, expect, it } from 'vitest';
import { buttonClass, type ButtonSize, type ButtonVariant } from '@/components/ui/styles';

// The classes buttonClass() produced before the component library. Existing pages (login, forms list, admin
// layout) must render exactly the same, so the original variants and sizes are pinned here.
const OLD_BASE = 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-semibold no-underline transition disabled:cursor-not-allowed disabled:opacity-50';
const OLD_VARIANT: Record<'primary' | 'secondary' | 'ghost' | 'destructive', string> = {
  primary: 'bg-accent text-accent-fg border border-transparent hover:brightness-95',
  secondary: 'bg-surface text-fg border border-border-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-fg border border-transparent hover:bg-surface-2',
  destructive: 'bg-danger text-white border border-transparent hover:brightness-95',
};
const OLD_SIZE: Record<36 | 44 | 52, string> = {
  36: 'h-9 px-3.5 text-body',
  44: 'h-11 px-5 text-[15px]',
  52: 'h-[52px] px-6 text-base',
};

const set = (cls: string) => new Set(cls.split(/\s+/).filter(Boolean));

describe('buttonClass', () => {
  it('renders the original variants and sizes exactly as before', () => {
    for (const variant of Object.keys(OLD_VARIANT) as (keyof typeof OLD_VARIANT)[]) {
      for (const size of [36, 44, 52] as const) {
        const before = `${OLD_BASE} ${OLD_VARIANT[variant]} ${OLD_SIZE[size]} w-full`;
        expect(set(buttonClass(variant, size, 'w-full'))).toEqual(set(before));
      }
    }
    // Defaults are still primary 36.
    expect(set(buttonClass())).toEqual(set(`${OLD_BASE} ${OLD_VARIANT.primary} ${OLD_SIZE[36]}`));
  });

  it('adds the design variants and sizes', () => {
    const variants: ButtonVariant[] = ['destructive-outline', 'accent-outline', 'link'];
    const sizes: ButtonSize[] = [30, 32, 38, 48];
    for (const v of variants) for (const s of sizes) expect(buttonClass(v, s)).toContain('rounded-pill');
    expect(buttonClass('accent-outline', 30)).toContain('h-[30px]');
    expect(buttonClass('destructive-outline', 38)).toContain('text-status-red-fg');
    // The link variant has no fixed height.
    expect(buttonClass('link', 52)).not.toContain('h-[52px]');
  });

  it('uses tokens only, with near-black text on orange', () => {
    for (const v of ['primary', 'secondary', 'ghost', 'destructive', 'destructive-outline', 'accent-outline', 'link'] as ButtonVariant[]) {
      const cls = buttonClass(v);
      expect(cls).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(cls).not.toMatch(/\b(?:bg|text|border)-(?:neutral|gray|red|orange|amber|green|slate|zinc)-\d/);
    }
    expect(buttonClass('primary')).toContain('text-accent-fg');
  });

  it('keeps the variant colours while loading instead of the disabled look', () => {
    const cls = buttonClass('primary', 36, '', { loading: true });
    expect(cls).toContain('opacity-80');
    expect(cls).not.toContain('disabled:opacity-50');
  });
});
