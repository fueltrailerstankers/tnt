'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Input, Select } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ALL_BRANCHES, STATUS_FILTER_LABEL, STATUS_FILTERS, statusFilterOf, unitsHref } from '@/lib/stock/register';

const BASE = '/admin/stock/units';

interface Filters {
  q: string | null;
  model: string | null;
  location: string | null;
  status: string | null;
}

interface Props extends Filters {
  locations: { id: string; name: string }[];
}

const same = (a: Filters, b: Filters) => a.q === b.q && a.model === b.model && a.location === b.location && a.status === b.status;

/**
 * Register filters, synced to the URL: the search box is debounced, selects apply at once, Clear resets.
 * Also a plain GET form, so it works before hydration.
 *
 * The latest choice lives in a ref (not the props): the props only change once the navigation has rendered, so
 * a second change made before that (status, then location) must build on the first, not on the old URL.
 */
export function RegisterFilters({ q, model, location, status, locations }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const cur = useRef<Filters>({ q, model, location, status });
  const [sel, setSel] = useState<Filters>({ q, model, location, status });
  const [text, setText] = useState(q ?? '');

  const navigate = useCallback((over: Partial<Filters>) => {
    const next = { ...cur.current, ...over };
    cur.current = next;
    setSel(next);
    // unitsHref builds the query with toString(); the size property of URLSearchParams is missing before Safari 17.
    const href = unitsHref({ q: next.q, model: next.model, location: next.location, status: statusFilterOf(next.status) });
    start(() => router.replace(href, { scroll: false }));
  }, [router]);

  // Debounced search.
  useEffect(() => {
    const v = text.trim() || null;
    if (v === cur.current.q) return;
    const t = setTimeout(() => navigate({ q: v }), 350);
    return () => clearTimeout(t);
  }, [text, navigate]);

  // The URL changed from elsewhere (Clear, back button, a link): show it. Skipped while our own navigation runs.
  useEffect(() => {
    if (pending) return;
    const fromUrl = { q, model, location, status };
    if (same(fromUrl, cur.current)) return;
    cur.current = fromUrl;
    setSel(fromUrl);
    setText(q ?? '');
  }, [q, model, location, status, pending]);

  return (
    <form
      method="get"
      action={BASE}
      role="search"
      aria-label="Unit register filters"
      aria-busy={pending}
      className="grid gap-3 rounded-md border border-border bg-surface p-3 shadow-card sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        navigate({ q: text.trim() || null });
      }}
    >
      <label className="block min-w-0">
        <span className="mb-1.5 block text-small font-semibold text-fg">Search</span>
        <span className="relative block">
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"><Icon name="search" size={16} /></span>
          <Input
            type="search"
            name="q"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search VIN, sequence, model or invoice…"
            autoComplete="off"
            maxLength={60}
            className="pl-9"
          />
        </span>
      </label>
      <div className="grid grid-cols-2 gap-3 sm:contents">
        <label className="block">
          <span className="mb-1.5 block text-small font-semibold text-fg">Location</span>
          <Select name="location" value={sel.location ?? ''} onChange={(e) => navigate({ location: e.target.value || null })}>
            <option value="">All locations</option>
            <option value={ALL_BRANCHES}>All branches</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-small font-semibold text-fg">Status</span>
          <Select name="status" value={sel.status ?? ''} onChange={(e) => navigate({ status: e.target.value || null })}>
            <option value="">All statuses</option>
            {STATUS_FILTERS.map((s) => <option key={s} value={s}>{STATUS_FILTER_LABEL[s]}</option>)}
          </Select>
        </label>
      </div>
      {sel.model ? <input type="hidden" name="model" value={sel.model} /> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" size={44} className="sm:hidden">Search</Button>
        <Link
          href={BASE}
          className="inline-flex h-11 items-center justify-center rounded-pill px-4 text-body font-semibold text-fg no-underline hover:bg-surface-2"
          onClick={() => {
            const none = { q: null, model: null, location: null, status: null };
            cur.current = none;
            setSel(none);
            setText('');
          }}
        >
          Clear
        </Link>
      </div>
      {sel.model ? (
        <p className="text-small text-fg-muted sm:col-span-4">
          Model <span className="font-mono font-semibold text-fg">{sel.model}</span>{' '}
          <button type="button" className="font-semibold text-accent-text underline" onClick={() => navigate({ model: null })}>Show all models</button>
        </p>
      ) : null}
    </form>
  );
}
