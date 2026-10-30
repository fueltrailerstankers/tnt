'use server';

import { notFound } from 'next/navigation';
import { z } from 'zod';
import type { RevealResult } from '@/components/ui/ProtectedField';
import type { TypedConfirmResult } from '@/components/ui/TypedConfirmModal';
import { requirePerm } from '@/lib/security/require';
import { livePhrase, typedMatches } from '@/lib/ui/confirm';
import { GALLERY_ACTION, GALLERY_ID_VALUE } from './fixtures';

// Gallery-only actions with fictional values. They read and write nothing: no database, no Xero, no audit rows.
// Like the page they need admin.access and 404 in production. A real reveal action checks its own permission and
// writes audit_log with field keys only; a real "go live" goes through setActionMode.

function devOnly(): void {
  if (process.env.NODE_ENV === 'production') notFound();
}

export async function revealGalleryId(): Promise<RevealResult> {
  await requirePerm('admin.access');
  devOnly();
  return { ok: true, value: GALLERY_ID_VALUE };
}

const Typed = z.string().max(200);

/** Re-checks the typed phrase on the server with the same exact-match rule as the modal. Nothing is switched. */
export async function confirmGalleryLive(typed: unknown): Promise<TypedConfirmResult> {
  await requirePerm('admin.access');
  devOnly();
  const parsed = Typed.safeParse(typed);
  if (!parsed.success || !typedMatches(parsed.data, livePhrase(GALLERY_ACTION))) {
    return { ok: false, message: 'The text did not match.' };
  }
  return { ok: true };
}
