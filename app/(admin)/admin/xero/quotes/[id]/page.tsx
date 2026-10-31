import { notFound, redirect } from 'next/navigation';
import { MIRROR_ID } from '@/lib/admin/mirror';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Deep link (leads, activity log, deal files): opens the quote's drawer on the list, so Back and Close behave the same. */
export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requirePerm('quotes.read');
  const { id } = await params;
  if (!MIRROR_ID.test(id)) notFound();
  const db = await createClient();
  const { data } = await db.from('xero_quotes').select('quote_id').eq('org_id', member.orgId).eq('quote_id', id).maybeSingle();
  if (!data) notFound();
  redirect(`/admin/xero/quotes?id=${encodeURIComponent(id)}`);
}
