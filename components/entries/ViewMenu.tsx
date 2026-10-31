'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { SavedViewsMenu, type SavedView } from '@/components/ui/SavedViewsMenu';
import { deleteFormView, saveFormView } from '@/app/(admin)/admin/forms/[slug]/actions';

export interface GridView extends SavedView {
  href: string;
}

/**
 * Entries grid view select: built-in views (All entries, Unread) and the member's saved views for this form.
 * Selecting navigates; Save view stores the current filters through a server action (RLS, own views only).
 */
export function ViewMenu({ slug, views, value, query, baseHref }: {
  slug: string;
  views: readonly GridView[];
  value: string;
  /** The current grid filters as the saved-view query (view, q, from, to, cols). */
  query: Record<string, string | string[]>;
  baseHref: string;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <SavedViewsMenu
      views={views}
      value={value}
      onSelect={(id) => {
        const v = views.find((x) => x.id === id);
        if (v && v.id !== 'custom') start(() => router.push(v.href));
      }}
      onSave={async (name) => {
        const saved = await saveFormView(slug, { name, query });
        start(() => router.push(saved.href));
      }}
      onDelete={async (id) => {
        await deleteFormView(slug, { id });
        start(() => router.push(baseHref));
      }}
    />
  );
}
