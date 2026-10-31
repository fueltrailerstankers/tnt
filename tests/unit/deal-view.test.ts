import { describe, expect, it } from 'vitest';
import { buildTimeline, type DealFileStages, type TimelineEntryRow, type TimelineFormRow } from '@/lib/deal-files/timeline';
import { dealDocuments, shortSha, type DocumentRow } from '@/lib/deal-view/documents';
import { buildJourney, stepActivity, type JourneyEventRow } from '@/lib/deal-view/journey';
import { dealParam, dealSearchTerm, quoteLabel } from '@/lib/deal-view/search';
import { awaitingPayment, isPaid, quoteProgress } from '@/lib/deal-view/xero';

// Synthetic ids and names only.
const forms: TimelineFormRow[] = [
  { id: 'f-deal', slug: 'deal', name: 'Deal' },
  { id: 'f-rfi', slug: 'request-for-invoice', name: 'RFI' },
  { id: 'f-job', slug: 'job-card', name: 'Job Card' },
  { id: 'f-ins', slug: 'trailer-inspection-checklist', name: 'Inspection' },
  { id: 'f-rel', slug: 'release-form', name: 'Release' },
  { id: 'f-dn', slug: 'delivery-note', name: 'Delivery Note' },
];
const entry = (id: string, form_id: string, number: number, status = 'Submitted'): TimelineEntryRow => ({
  id, form_id, number, status, summary: null, created_at: '2026-10-24T09:02:00Z', updated_at: '2026-10-24T09:02:00Z',
});
const none: DealFileStages = {
  deal_entry_id: null, rfi_entry_id: null, job_card_entry_id: null, inspection_entry_id: null, release_entry_id: null, delivery_entry_id: null,
};
const ev = (id: number, entry_id: string, at: string, over: Partial<JourneyEventRow> = {}): JourneyEventRow => ({
  id, entry_id, actor_user: null, actor_role: 'Public', from_status: null, to_status: 'Submitted', created_at: at, ...over,
});

describe('deal journey', () => {
  it('five steps; done up to the last submitted entry, the next one is current, the rest not started', () => {
    const file = { ...none, deal_entry_id: 'd', rfi_entry_id: 'r', job_card_entry_id: 'j' };
    const stages = buildTimeline(file, [entry('d', 'f-deal', 512), entry('r', 'f-rfi', 388), entry('j', 'f-job', 9)], forms);
    const j = buildJourney({ file, stages, activity: new Map() });
    expect(j.steps.map((s) => s.label)).toEqual(['Deal', 'Request for Invoice', 'Inspection', 'Release', 'Delivery']);
    expect(j.steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'todo', 'todo']);
    expect(j.steps.map((s) => s.status)).toEqual(['Submitted', 'Submitted', 'Awaiting inspection', 'Not started', 'Not started']);
    expect(j.steps[0]).toMatchObject({ href: '/admin/forms/deal/entries/512', linkLabel: 'Open Deal #512', at: '2026-10-24T09:02:00Z' });
    expect(j.headline).toEqual({ label: 'At Inspection', tone: 'yellow' });
    expect(j.jobCard).toEqual({ href: '/admin/forms/job-card/entries/9', label: 'Job Card #9' });
  });

  it('an Incomplete entry is the current step with its own status; Release waits for payment while unpaid', () => {
    const file = { ...none, deal_entry_id: 'd' };
    const stages = buildTimeline(file, [entry('d', 'f-deal', 1, 'Incomplete')], forms);
    const j = buildJourney({ file, stages, activity: new Map() });
    expect(j.steps[0]).toMatchObject({ state: 'current', status: 'Incomplete' });
    expect(j.headline.label).toBe('At Deal');

    const f2 = { ...none, deal_entry_id: 'd', rfi_entry_id: 'r', inspection_entry_id: 'i' };
    const s2 = buildTimeline(f2, [entry('d', 'f-deal', 1), entry('r', 'f-rfi', 2), entry('i', 'f-ins', 3, 'Approved')], forms);
    expect(buildJourney({ file: f2, stages: s2, activity: new Map(), awaitingPayment: true }).steps[3].status).toBe('Waiting for payment');
    expect(buildJourney({ file: f2, stages: s2, activity: new Map() }).steps[3].status).toBe('Awaiting release');
  });

  it('all five done reads Delivered; a gap before the last done step is "Not linked"', () => {
    const file = { ...none, deal_entry_id: 'd', rfi_entry_id: 'r', inspection_entry_id: 'i', release_entry_id: 'rel', delivery_entry_id: 'dn' };
    const all = [entry('d', 'f-deal', 1), entry('r', 'f-rfi', 2), entry('i', 'f-ins', 3, 'Approved'), entry('rel', 'f-rel', 4), entry('dn', 'f-dn', 5)];
    const j = buildJourney({ file, stages: buildTimeline(file, all, forms), activity: new Map() });
    expect(j.steps.every((s) => s.state === 'done')).toBe(true);
    expect(j.headline).toEqual({ label: 'Delivered', tone: 'green' });

    const gap = { ...file, inspection_entry_id: null };
    const g = buildJourney({ file: gap, stages: buildTimeline(gap, all, forms), activity: new Map() });
    expect(g.steps[2]).toMatchObject({ state: 'todo', status: 'Not linked', href: null });
    expect(g.headline.label).toBe('Delivered');
  });

  it('without Forms access only presence is shown, with no links', () => {
    const file = { ...none, deal_entry_id: 'd', rfi_entry_id: 'r' };
    const j = buildJourney({ file, stages: null, activity: new Map() });
    expect(j.steps.map((s) => s.status)).toEqual(['Linked', 'Linked', 'Not linked', 'Not linked', 'Not linked']);
    expect(j.steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'todo', 'todo']);
    expect(j.steps.every((s) => s.href === null && s.at === null)).toBe(true);
    expect(j.jobCard).toBeNull();
  });

  it('who and when: the latest status change; jobs mark the release auto-created', () => {
    const names = new Map([['u-1', 'Demo Rep']]);
    const slugOf = new Map([['d', 'deal'], ['i', 'trailer-inspection-checklist'], ['rel', 'release-form'], ['r', 'request-for-invoice']]);
    const act = stepActivity([
      ev(1, 'd', '2026-10-24T09:02:00Z', { actor_user: 'u-1', actor_role: 'Internal' }),
      ev(2, 'd', '2026-10-24T10:00:00Z', { actor_user: 'u-2', to_status: 'Submitted', from_status: 'Submitted' }), // field edit only
      ev(3, 'i', '2026-10-27T14:40:00Z', { actor_role: 'Inspector' }),
      ev(4, 'i', '2026-10-28T08:15:00Z', { actor_user: 'u-1', from_status: 'Submitted', to_status: 'Approved' }),
      ev(5, 'rel', '2026-10-28T11:20:00Z', { actor_role: 'System' }),
      ev(6, 'r', '2026-10-25T06:52:00Z'),
    ], slugOf, names);
    expect(act.get('d')).toEqual({ at: '2026-10-24T09:02:00Z', who: 'Demo Rep', auto: false });
    expect(act.get('i')).toEqual({ at: '2026-10-28T08:15:00Z', who: 'Demo Rep', auto: false });
    expect(act.get('rel')).toEqual({ at: '2026-10-28T11:20:00Z', who: 'Auto · Xero', auto: true });
    expect(act.get('r')?.who).toBe('Public link');
    // A user who is not a member of the org gets a neutral label, never an id or email.
    expect(stepActivity([ev(7, 'x', '2026-10-01T00:00:00Z', { actor_user: 'other' })], new Map(), names).get('x')?.who).toBe('Staff member');

    const file = { ...none, release_entry_id: 'rel' };
    const j = buildJourney({ file, stages: buildTimeline(file, [entry('rel', 'f-rel', 4)], forms), activity: act });
    expect(j.steps[3]).toMatchObject({ state: 'done', auto: true, who: 'Auto · Xero', status: 'Submitted' });
  });
});

describe('deal Xero panel', () => {
  it('quote progress follows the Xero status; a linked invoice counts as invoiced', () => {
    const reached = (s: string | null, inv = false) => quoteProgress(s, inv).map((x) => x.reached);
    expect(reached('DRAFT')).toEqual([false, false, false]);
    expect(reached('SENT')).toEqual([true, false, false]);
    expect(reached('DECLINED')).toEqual([true, false, false]);
    expect(reached('ACCEPTED')).toEqual([true, true, false]);
    expect(reached('INVOICED')).toEqual([true, true, true]);
    expect(reached('ACCEPTED', true)).toEqual([true, true, true]);
    expect(reached(null)).toEqual([false, false, false]);
  });

  it('paid and awaiting payment', () => {
    expect(isPaid({ status: 'PAID', amount_due: 0, fully_paid_on: '2026-10-28' })).toBe(true);
    expect(isPaid({ status: 'AUTHORISED', amount_due: '0.00', fully_paid_on: '2026-10-28' })).toBe(true);
    expect(isPaid({ status: 'AUTHORISED', amount_due: 10, fully_paid_on: null })).toBe(false);
    expect(awaitingPayment([])).toBe(false);
    expect(awaitingPayment([{ status: 'AUTHORISED', amount_due: 10, fully_paid_on: null }])).toBe(true);
    expect(awaitingPayment([{ status: 'VOIDED', amount_due: 10, fully_paid_on: null }])).toBe(false);
    expect(awaitingPayment([{ status: 'AUTHORISED', amount_due: 10, fully_paid_on: null }, { status: 'PAID', amount_due: 0, fully_paid_on: '2026-10-28' }])).toBe(false);
  });
});

describe('deal documents', () => {
  const entries = new Map([
    ['dn', { slug: 'delivery-note', number: 291, formName: 'Delivery Note' }],
    ['ins', { slug: 'trailer-inspection-checklist', number: 214, formName: 'Inspection Checklist' }],
  ]);
  const doc = (id: string, entry_id: string, t: number, at: string, sha: string | null = 'c80d1111222233334444555566667777888899990000aaaabbbbccccdddd5b19'): DocumentRow =>
    ({ id, entry_id, template_number: t, name: 'x.pdf', sha256: sha, created_at: at });

  it('numbers versions per entry and template, newest first, and drops unlinked entries', () => {
    const out = dealDocuments([
      doc('a', 'ins', 1, '2026-10-27T14:40:00Z'),
      doc('b', 'ins', 1, '2026-10-28T08:15:00Z'),
      doc('c', 'dn', 1, '2026-10-29T13:02:00Z', null),
      doc('z', 'other', 1, '2026-10-30T00:00:00Z'),
    ], entries);
    expect(out.map((d) => d.title)).toEqual(['Delivery Note #291 · v1', 'Inspection Checklist #214 · v2', 'Inspection Checklist #214 · v1']);
    expect(out[1]).toMatchObject({ sha: 'c80d…5b19', href: '/admin/forms/trailer-inspection-checklist/entries/214/documents/1?version=b' });
    expect(out[0].sha).toBe('');
  });

  it('shortens only hex hashes', () => {
    expect(shortSha('9f3cabcdefa71e')).toBe('9f3c…a71e');
    expect(shortSha('<script>')).toBe('');
    expect(shortSha(null)).toBe('');
  });
});

describe('deal search and params', () => {
  it('searches deal files by the bare quote no', () => {
    expect(dealSearchTerm('QU-10482')).toBe('10482');
    expect(dealSearchTerm('qu 10482')).toBe('10482');
    expect(dealSearchTerm('TT9DEMO24D0010482')).toBe('TT9DEMO24D0010482');
    expect(dealSearchTerm('Bergview')).toBe('Bergview');
    expect(dealSearchTerm('a,b)')).not.toMatch(/[,()]/);
    expect(dealSearchTerm(undefined)).toBeNull();
  });

  it('route param accepts the QU- form; rejects anything else', () => {
    expect(dealParam('10482')).toBe('10482');
    expect(dealParam('QU-10482')).toBe('10482');
    expect(dealParam('a%2Fb')).toBeNull();
    expect(dealParam('%E0%A4%A')).toBeNull();
    expect(dealParam('x'.repeat(41))).toBeNull();
  });

  it('labels numeric quote nos the way Xero shows them', () => {
    expect(quoteLabel('10482')).toBe('QU-10482');
    expect(quoteLabel('10482', 'QU-10482')).toBe('QU-10482');
    expect(quoteLabel('ABC-1')).toBe('ABC-1');
  });
});
