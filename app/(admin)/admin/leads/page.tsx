import { LeadsInbox } from '@/components/leads/LeadsInbox';
import { requirePerm } from '@/lib/security/require';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leads · Trailers & Tankers' };

/** Leads inbox (handoff Leads, PhoneLeads): list + detail of the first lead on desktop, the list on phones. */
export default async function Leads({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const member = await requirePerm('leads.read');
  return <LeadsInbox member={member} sp={await searchParams} selectedId={null} />;
}
