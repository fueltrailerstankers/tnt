import { Suspense } from 'react';
import { addLeadSources } from '@/components/leads/LeadsInbox';
import { PipelineBoard } from '@/components/leads/PipelineBoard';
import { loadBoard } from '@/lib/leads-view/load';
import { can } from '@/lib/security/can';
import { requirePerm } from '@/lib/security/require';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Leads pipeline · Trailers & Tankers' };

/** Leads pipeline board (handoff LeadsPipeline). Spam leads are not a stage and stay in the inbox. */
export default async function LeadsPipeline() {
  const member = await requirePerm('leads.read');
  const manage = can(member, 'leads.manage');
  const [board, addSources] = await Promise.all([loadBoard(member), manage ? addLeadSources(member) : Promise.resolve([])]);
  return (
    <Suspense>
      <PipelineBoard
        leads={board.leads}
        total={board.total}
        members={board.members.map((m) => ({ userId: m.userId, label: m.label }))}
        sourceNames={Object.fromEntries(board.sources)}
        me={member.userId}
        manage={manage}
        addSources={addSources}
        nowIso={new Date().toISOString()}
      />
    </Suspense>
  );
}
