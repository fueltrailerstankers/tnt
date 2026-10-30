'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Input, Select } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ALL_BRANCHES, STATUS_FILTER_LABEL, STATUS_FILTERS } from '@/lib/stock/register';

const BASE = '/admin/stock/units';

interface Props {
  q: string | null;
  model: string | null;
  location: string | null;
  status: string | null;
  locations: { id: string; name: string }[];
}

/**
 * Register filters, synced to the URL: the search box is debounced, selects apply at once, Clear resets.
 * Also a plain GET form, so it works before hydration.
 */
export function RegisterFilters({ q, model, location, status, locations }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState(q ?? '');
  const lastPushed = useRef(q ?? '');

  const navigate = useCallback((over: { q?: string | null; model?: string | null; location?: string | null; status?: string | null }) => {
    const next = { q: lastPushed.current || null, model, location, status, ...over };
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) u.set(k, v);
    start(() => router.replace(u.size ? `${BASE}?${u}` : BASE, { scroll: false }));
  }, [model, location, status, router]);

  // Debounced search.
  useEffect(() => {
    const v = text.trim();
    if (v === lastPushed.current) return;
    const t = setTimeout(() => {
      lastPushed.current = v;
      navigate({ q: v || null });
    }, 350);
    return () => clearTimeout(t);
  }, [text, navigate]);

  // The URL changed from elsewhere (Clear, back button, a link): show its search.
  useEffect(() => {
    const qs = q ?? '';
    if (qs !== lastPushed.current) {
      lastPushed.current = qs;
      setText(qs);
    }
  }, [q]);

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
        lastPushed.current = text.trim();
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
          <Select name="location" value={location ?? ''} onChange={(e) => navigate({ location: e.target.value || null })}>
            <option value="">All locations</option>
            <option value={ALL_BRANCHES}>All branches</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-small font-semibold text-fg">Status</span>
          <Select name="status" value={status ?? ''} onChange={(e) => navigate({ status: e.target.value || null })}>
            <option value="">All statuses</option>
            {STATUS_FILTERS.map((s) => <option key={s} value={s}>{STATUS_FILTER_LABEL[s]}</option>)}
          </Select>
        </label>
      </div>
      {model ? <input type="hidden" name="model" value={model} /> : null}
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" size={44} className="sm:hidden">Search</Button>
        <Link
          href={BASE}
          className="inline-flex h-11 items-center justify-center rounded-pill px-4 text-body font-semibold text-fg no-underline hover:bg-surface-2"
          onClick={() => { lastPushed.current = ''; setText(''); }}
        >
          Clear
        </Link>
      </div>
      {model ? (
        <p className="text-small text-fg-muted sm:col-span-4">
          Model <span className="font-mono font-semibold text-fg">{model}</span>{' '}
          <button type="button" className="font-semibold text-accent-text underline" onClick={() => navigate({ model: null })}>Show all models</button>
        </p>
      ) : null}
    </form>
  );
}
