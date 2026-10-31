// Lead activity lines (event kind + meta -> text). Pure. lead_events.meta holds ids, statuses and field names only,
// so nothing personal is ever shown here except the member names passed in `who`.

import { statusLabel } from './model';

export const EVENT_LABEL: Record<string, string> = {
  created: 'Lead received', duplicate: 'Flagged as a possible duplicate', routed: 'Routed', emailed: 'Notification',
  matched: 'Xero match updated', status: 'Status changed', assigned: 'Assignment changed', note: 'Note added',
};

export function eventLabel(kind: string): string {
  return EVENT_LABEL[kind] ?? kind;
}

export function eventText(kind: string, meta: Record<string, unknown> | null | undefined, who: ReadonlyMap<string, string>): string {
  const m = meta ?? {};
  switch (kind) {
    case 'created': return m.source ? `from ${String(m.source)}` : '';
    case 'routed': return m.event_key ? `to ${String(m.event_key)}` : '';
    case 'emailed': return typeof m.recipients === 'number'
      ? `${String(m.status ?? '')} (${m.recipients} recipient${m.recipients === 1 ? '' : 's'})`
      : String(m.status ?? '');
    case 'status': return `${statusLabel(String(m.from ?? ''))} → ${statusLabel(String(m.to ?? ''))}`;
    case 'assigned': return m.to ? `to ${who.get(String(m.to)) ?? 'a member'}` : 'unassigned';
    case 'matched': return [m.quote_id ? 'quote' : null, m.invoice_id ? 'invoice' : null].filter(Boolean).join(' and ') || 'no match';
    default: return '';
  }
}
