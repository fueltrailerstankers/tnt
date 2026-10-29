import { describe, expect, it } from 'vitest';
import {
  buildTimeline, DEAL_STAGES, orderInvoices, QUOTE_NO_PARAM, stageEntryIds, stagesPresent, UUID_PARAM,
  type DealFileStages, type TimelineEntryRow, type TimelineFormRow,
} from '@/lib/deal-files/timeline';

const forms: TimelineFormRow[] = [
  { id: 'f-deal', slug: 'deal', name: 'DEAL' },
  { id: 'f-rfi', slug: 'request-for-invoice', name: 'Request For Invoice' },
  { id: 'f-job', slug: 'job-card', name: 'JOB CARD' },
  { id: 'f-ins', slug: 'trailer-inspection-checklist', name: 'Trailer Inspection Checklist' },
  { id: 'f-rel', slug: 'release-form', name: 'RELEASE FORM' },
  { id: 'f-dn', slug: 'delivery-note', name: 'Delivery Note , Terms and Conditions' },
];
const row = (id: string, form_id: string, number: number): TimelineEntryRow => ({
  id, form_id, number, status: 'Submitted', summary: `S${number}`, created_at: '2026-01-02T08:00:00Z', updated_at: '2026-01-03T09:00:00Z',
});
const empty: DealFileStages = {
  deal_entry_id: null, rfi_entry_id: null, job_card_entry_id: null, inspection_entry_id: null, release_entry_id: null, delivery_entry_id: null,
};

describe('deal file timeline', () => {
  it('orders all six stages in business order with links', () => {
    const file: DealFileStages = {
      deal_entry_id: 'd', rfi_entry_id: 'r', job_card_entry_id: 'j', inspection_entry_id: 'i', release_entry_id: 'rel', delivery_entry_id: 'dn',
    };
    // Entries arrive in any order.
    const entries = [row('dn', 'f-dn', 6), row('rel', 'f-rel', 5), row('i', 'f-ins', 4), row('j', 'f-job', 3), row('r', 'f-rfi', 2), row('d', 'f-deal', 1)];
    const t = buildTimeline(file, entries, forms);
    expect(t.map((s) => s.label)).toEqual(['Deal', 'Request For Invoice', 'Job Card', 'Trailer Inspection', 'Release Form', 'Delivery Note']);
    expect(t.map((s) => s.entry?.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(t[1].entry).toEqual({
      id: 'r', number: 2, status: 'Submitted', summary: 'S2', createdAt: '2026-01-02T08:00:00Z', updatedAt: '2026-01-03T09:00:00Z',
      formName: 'Request For Invoice', href: '/admin/forms/request-for-invoice/entries/2',
    });
  });

  it('shows missing, unreadable and mismatched stages as not yet', () => {
    const file = { ...empty, deal_entry_id: 'd', rfi_entry_id: 'gone', release_entry_id: 'wrong' };
    const t = buildTimeline(file, [row('d', 'f-deal', 7), row('wrong', 'f-deal', 8)], forms);
    expect(t.map((s) => (s.entry ? s.entry.number : null))).toEqual([7, null, null, null, null, null]);
  });

  it('lists stage ticks and entry ids', () => {
    const file = { ...empty, deal_entry_id: 'd', delivery_entry_id: 'dn', rfi_entry_id: 'd' };
    expect(stagesPresent(file).map((s) => s.present)).toEqual([true, true, false, false, false, true]);
    expect(stagesPresent(file).map((s) => s.short)).toEqual(['Deal', 'RFI', 'Job card', 'Inspection', 'Release', 'Delivery']);
    expect(stageEntryIds(file)).toEqual(['d', 'dn']);
    expect(DEAL_STAGES).toHaveLength(6);
  });

  it('keeps invoice order and drops ids the mirror lacks', () => {
    const rows = [{ invoice_id: 'b', n: 2 }, { invoice_id: 'a', n: 1 }];
    expect(orderInvoices(['a', 'x', 'b', 'a'], rows).map((r) => r.n)).toEqual([1, 2]);
  });

  it('validates route params', () => {
    expect(QUOTE_NO_PARAM.test('90001')).toBe(true);
    expect(QUOTE_NO_PARAM.test('QU-90001')).toBe(true);
    expect(QUOTE_NO_PARAM.test('9000 1')).toBe(false);
    expect(QUOTE_NO_PARAM.test('a,b')).toBe(false);
    expect(QUOTE_NO_PARAM.test('x'.repeat(41))).toBe(false);
    expect(UUID_PARAM.test('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
    expect(UUID_PARAM.test('not-a-uuid')).toBe(false);
  });
});
