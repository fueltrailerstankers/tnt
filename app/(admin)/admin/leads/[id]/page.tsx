import { notFound } from 'next/navigation';
import { LeadsInbox } from '@/components/leads/LeadsInbox';
import { isUuid } from '@/lib/leads-view/load';
import { requirePerm } from '@/lib/security/require';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Lead · Trailers & Tankers' };

/** One lead: the inbox with this lead open (desktop: beside the list; phones: the lead alone with Back). */
export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('leads.read');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <LeadsInbox member={member} sp={await searchParams} selectedId={id.toLowerCase()} />;
}
