'use server';

import { notFound } from 'next/navigation';
import { z } from 'zod';
import type { RevealResult } from '@/components/ui/ProtectedField';
import type { TypedConfirmResult } from '@/components/ui/TypedConfirmModal';
import { requirePerm } from '@/lib/security/require';
import { livePhrase, typedMatches } from '@/lib/ui/confirm';
import { GALLERY_ACTION, GALLERY_ID_VALUE } from './fixtures';

// Gallery-only actions with fictional values. They change nothing. Like the page, they 404 in production and need
// admin.access. A real reveal action checks its own permission and writes audit_log with field keys only.

function devOnly(): void {
  if (process.env.NODE_ENV === 'production') notFound();
}

export async function revealGalleryId(): Promise<RevealResult> {
  devOnly();
  await requirePerm('admin.access');
  return { ok: true, value: GALLERY_ID_VALUE };
}

const Typed = z.string().max(200);

/** Re-checks the typed phrase on the server with the same rule as the modal. Nothing is switched. */
export async function confirmGalleryLive(typed: unknown): Promise<TypedConfirmResult> {
  devOnly();
  await requirePerm('admin.access');
  const parsed = Typed.safeParse(typed);
  if (!parsed.success || !typedMatches(parsed.data, livePhrase(GALLERY_ACTION))) {
    return { ok: false, message: 'The text did not match.' };
  }
  return { ok: true };
}
