'use client';

import { useRouter } from 'next/navigation';
import type { RefObject } from 'react';
import { Icon } from '@/components/ui/Icon';
import { searchTarget } from '@/lib/ui/search';

const LABEL = 'Search by quote no, VIN or invoice no';

/** Quote no / VIN / invoice no search. Routes to the page that lists the key; the `/` shortcut is handled by ShellFrame. */
export function GlobalSearch({ inputRef, className = '', showHint = true }: { inputRef: RefObject<HTMLInputElement | null>; className?: string; showHint?: boolean }) {
  const router = useRouter();
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const target = searchTarget(inputRef.current?.value ?? '');
        if (target) router.push(target);
      }}
      className={`flex h-[38px] items-center gap-2 rounded-md border border-border bg-surface-2 px-3 text-fg-muted focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus ${className}`}
    >
      <Icon name="search" size={16} strokeWidth={2} />
      <input
        ref={inputRef}
        type="search"
        name="q"
        aria-label={LABEL}
        placeholder="Search quote no, VIN or invoice no"
        autoComplete="off"
        className="min-w-0 flex-1 border-0 bg-transparent text-base text-fg outline-none placeholder:text-fg-muted sm:text-body"
      />
      {showHint ? <kbd className="rounded-xs border border-border-strong px-1.5 py-px text-[11px] text-fg-muted">/</kbd> : null}
    </form>
  );
}
