import { notFound, redirect } from 'next/navigation';
import { MIRROR_ID } from '@/lib/admin/mirror';
import { requirePerm } from '@/lib/security/require';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Deep link (leads, stock, activity log, deal files): opens the invoice's drawer on the list, so Back and Close behave
 * the same. Bills open with the type filter that lists them.
 */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const member = await requirePerm('invoices.read');
  const { id } = await params;
  if (!MIRROR_ID.test(id)) notFound();
  const db = await createClient();
  const { data } = await db.from('xero_invoices').select('invoice_id, invoice_type').eq('org_id', member.orgId).eq('invoice_id', id).maybeSingle();
  if (!data) notFound();
  const type = data.invoice_type === 'ACCPAY' ? '&type=ACCPAY' : data.invoice_type === 'ACCREC' ? '' : '&type=ALL';
  redirect(`/admin/xero/invoices?id=${encodeURIComponent(id)}${type}`);
}
