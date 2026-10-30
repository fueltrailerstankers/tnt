import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

/**
 * Opens the record behind an activity row whose page URL is not the id (entries: form slug + number; forms: their
 * settings). Reads through the caller's RLS client, so an entry outside their Forms access is simply not found.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ entity: string; id: string }> }) {
  const member = await requirePerm('audit.read');
  const { entity, id } = await params;
  if (!z.guid().safeParse(id).success) return notFound();
  const db = await createClient();
  if (entity === 'entry') {
    const { data: e } = await db.from('entries').select('form_id, number').eq('org_id', member.orgId).eq('id', id).maybeSingle();
    if (!e) return notFound();
    const { data: f } = await db.from('forms').select('slug').eq('org_id', member.orgId).eq('id', e.form_id).maybeSingle();
    if (!f) return notFound();
    redirect(`/admin/forms/${f.slug}/entries/${e.number}`);
  }
  if (entity === 'form') {
    const { data: f } = await db.from('forms').select('slug').eq('org_id', member.orgId).eq('id', id).maybeSingle();
    if (!f) return notFound();
    redirect(`/admin/forms/${f.slug}`);
  }
  return notFound();
}
