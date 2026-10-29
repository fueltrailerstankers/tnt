'use client';

import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { nextTheme, resolveTheme, THEME_KEY, type Theme } from '@/lib/ui/theme';

function currentTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme');
  let stored: string | null = attr;
  if (!stored) {
    try { stored = localStorage.getItem(THEME_KEY); } catch { /* storage blocked: follow the OS */ }
  }
  return resolveTheme(stored, window.matchMedia('(prefers-color-scheme: dark)').matches);
}

/** Sets data-theme on <html> and remembers the choice. With no choice stored the OS preference applies. */
export function ThemeToggle({ variant = 'top' }: { variant?: 'top' | 'menu' }) {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(currentTheme()), []);

  const toggle = () => {
    const next = nextTheme(theme ?? currentTheme());
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* storage blocked: applies for this visit only */ }
    setTheme(next);
  };

  const dark = theme === 'dark';
  if (variant === 'menu') {
    return (
      <button
        type="button"
        onClick={toggle}
        className="mt-auto h-12 rounded-pill border border-side-border bg-transparent text-sm font-semibold text-side-fg"
      >
        {dark ? 'Light mode' : 'Dark mode'}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex size-[38px] items-center justify-center rounded-pill border border-border bg-surface text-fg"
    >
      <Icon name={dark ? 'sun' : 'moon'} />
    </button>
  );
}
