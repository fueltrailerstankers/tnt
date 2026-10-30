import type { ReactNode } from 'react';

/** Keyboard hint, e.g. the "/" search shortcut. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center rounded-xs border border-border-strong px-1.5 py-px font-mono text-[11px] leading-4 text-fg-muted">
      {children}
    </kbd>
  );
}
