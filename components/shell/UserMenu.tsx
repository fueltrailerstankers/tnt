'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';

/** Account menu: name, role, My account and sign out. Closes on Escape or an outside click. */
export function UserMenu({ name, initials, role, signOut }: { name: string; initials: string; role: string; signOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-[38px] items-center gap-2 rounded-pill border border-border bg-surface pl-1 pr-2 text-fg"
      >
        {/* The accessible name is built from the visible text (WCAG 2.5.3 label in name): "User menu Test Admin admin". */}
        <span className="sr-only">User menu </span>
        <span aria-hidden="true" className="flex size-[30px] items-center justify-center rounded-sm bg-accent-soft text-xs font-bold text-accent-text">{initials}</span>
        <span className="flex-col items-start leading-tight max-sm:sr-only sm:flex">
          <span className="text-small font-semibold">{name}</span>
          <span className="text-[11px] capitalize text-fg-muted"> {role}</span>
        </span>
        <Icon name="chevronDown" size={14} strokeWidth={2} />
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-56 rounded-md border border-border bg-surface p-1 shadow-overlay">
          <div className="px-3 py-2 text-small text-fg-muted">
            <div className="font-semibold text-fg">{name}</div>
            <div className="capitalize">{role}</div>
          </div>
          <Link role="menuitem" href="/admin/account" onClick={() => setOpen(false)} className="block w-full rounded-sm px-3 py-2 text-left text-body font-semibold text-fg no-underline hover:bg-surface-2">My account</Link>
          <form action={signOut}>
            <button role="menuitem" className="w-full rounded-sm px-3 py-2 text-left text-body font-semibold text-fg hover:bg-surface-2">Sign out</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
