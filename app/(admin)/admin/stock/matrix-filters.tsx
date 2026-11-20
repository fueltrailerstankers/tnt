'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { inputClass } from '@/components/ui/styles';
import { overviewHref } from '@/lib/stock/kpi';

/**
 * Stock by model filters: model search (?q=) and "In stock only" (?instock=1), both kept in the URL so a view can be
 * shared. The search applies after a short pause in typing, or at once on Enter.
 */
export function MatrixFilters({ q, inStockOnly }: { q: string; inStockOnly: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(q);
  // Shows the new toggle state at once; falls back to the URL's value when the navigation settles.
  const [shown, setShown] = useOptimistic(inStockOnly);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A back/forward navigation changes the URL under us: follow it (but keep a trailing space the user is typing).
  useEffect(() => setText((t) => (t.trim() === q ? t : q)), [q]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const go = (next: { q: string; inStockOnly: boolean }) => {
    if (timer.current) clearTimeout(timer.current);
    start(() => {
      setShown(next.inStockOnly);
      router.replace(overviewHref(next), { scroll: false });
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
      <form
        role="search"
        className="w-full sm:max-w-sm"
        onSubmit={(e) => { e.preventDefault(); go({ q: text, inStockOnly: shown }); }}
      >
        <label htmlFor="model-search" className="sr-only">Search models</label>
        <input
          id="model-search"
          type="search"
          name="q"
          value={text}
          maxLength={100}
          autoComplete="off"
          placeholder="Search model name or part number…"
          className={inputClass}
          aria-busy={pending}
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => go({ q: v, inStockOnly: shown }), 300);
          }}
        />
      </form>
      <label className="inline-flex cursor-pointer items-center gap-2 text-small font-semibold text-fg">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={shown}
          aria-busy={pending}
          onChange={(e) => go({ q: text, inStockOnly: e.target.checked })}
        />
        In stock only
      </label>
    </div>
  );
}
