import { describe, expect, it } from 'vitest';
import { LEAD_STATUSES } from '@/lib/leads/schema';
import { actionMessage, fieldErrors, UI_SOURCES } from '@/lib/leads-view/actions';
import {
  activeView, ageLabel, ageWords, BOARD_STAGES, branchOptions, buildBoard, duplicateReason, filterBoard, listFilter,
  mailHref, matchesSearch, openSummary, sourceBadge, STATUS_LABEL, statusLabel, statusTone, sumQuotes, telHref,
  xeroStatusLabel, type BoardLead,
} from '@/lib/leads-view/model';
import { inboxParams, inboxQuery, isUuid } from '@/lib/leads-view/params';
import { eventLabel, eventText } from '@/lib/leads-view/timeline';

// Fictional data only (example.invalid, +27 xx 555 xxxx).
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

let n = 0;
function lead(over: Partial<BoardLead> = {}): BoardLead {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    created_at: `2026-10-${String(10 + (n % 15)).padStart(2, '0')}T08:00:00Z`,
    name: `Demo Co ${n}`, email: `demo${n}@example.invalid`, phone: '+27 31 555 0101', product: 'Diesel bowser',
    source: 'manual', branch: 'Durban', status: 'new', assigned_to: null, duplicate_of: null,
    matched_quote_id: null, matched_quote_number: null, matched_quote_status: null, matched_quote_total: null, matched_quote_currency: null,
    ...over,
  };
}

describe('statuses and stages', () => {
  it('labels every stored status and invents none', () => {
    for (const s of LEAD_STATUSES) expect(STATUS_LABEL[s]).toBeTruthy();
    expect(Object.keys(STATUS_LABEL).sort()).toEqual([...LEAD_STATUSES].sort());
    expect(BOARD_STAGES).toEqual(['new', 'contacted', 'quoted', 'won', 'lost']);
    for (const s of BOARD_STAGES) expect(LEAD_STATUSES).toContain(s);
  });
  it('maps labels and tones; unknown values pass through as gray', () => {
    expect(statusLabel('contacted')).toBe('Contacted');
    expect(statusLabel('weird')).toBe('weird');
    expect(statusTone('quoted')).toBe('accent');
    expect(statusTone('spam')).toBe('red');
    expect(statusTone('weird')).toBe('gray');
  });
});

describe('sourceBadge', () => {
  it('shows Manual and Test as designed, other sources by name', () => {
    expect(sourceBadge('manual')).toEqual({ label: 'Manual', variant: 'neutral' });
    expect(sourceBadge('test')).toEqual({ label: 'Test', variant: 'test' });
    expect(sourceBadge('website', new Map([['website', 'Website product inquiry']]))).toEqual({ label: 'Website product inquiry', variant: 'neutral' });
    expect(sourceBadge('google')).toEqual({ label: 'google', variant: 'neutral' });
  });
});

describe('inbox filters', () => {
  it('defaults to open leads; chips map to statuses', () => {
    expect(listFilter(null, null)).toEqual({ statuses: ['new', 'contacted', 'quoted'], mine: false });
    expect(listFilter('mine', null)).toEqual({ statuses: ['new', 'contacted', 'quoted'], mine: true });
    expect(listFilter('won', null)).toEqual({ statuses: ['won'], mine: false });
    expect(listFilter('spam', null)).toEqual({ statuses: ['spam'], mine: false });
    expect(listFilter('all', null)).toEqual({ statuses: null, mine: false });
    expect(listFilter('bogus', null).statuses).toEqual(['new', 'contacted', 'quoted']);
  });
  it('an explicit ?status= wins over the view', () => {
    expect(listFilter('won', 'contacted')).toEqual({ statuses: ['contacted'], mine: false });
    expect(listFilter('won', 'nope')).toEqual({ statuses: ['won'], mine: false });
    expect(activeView('won', 'contacted')).toBe('contacted');
    expect(activeView('won', null)).toBe('won');
    expect(activeView('x', null)).toBe('open');
  });
  it('parses params defensively and builds query strings of filter values only', () => {
    const p = inboxParams({ q: 'Visitor (1)', view: 'mine', status: 'nope', source: 'evil', assigned: 'me; drop', dups: '1', page: '3' }, ['manual', 'test']);
    expect(p).toMatchObject({ q: 'Visitor  1', view: 'mine', status: null, source: null, assigned: null, dups: true, page: 3 });
    expect(inboxQuery(p)).toBe('?q=Visitor++1&view=mine&dups=1&page=3');
    expect(inboxQuery(p, { view: 'won', page: null })).toBe('?q=Visitor++1&view=won&dups=1');
    const d = inboxParams({}, []);
    expect(inboxQuery(d)).toBe('');
    expect(inboxParams({ assigned: OTHER }, []).assigned).toBe(OTHER);
    expect(inboxParams({ view: 'open', status: 'won' }, []).status).toBe('won');
  });
  it('accepts only uuids as lead ids', () => {
    expect(isUuid(ME)).toBe(true);
    expect(isUuid('../x')).toBe(false);
    expect(isUuid(`${ME}x`)).toBe(false);
  });
});

describe('age, links and labels', () => {
  const now = new Date('2026-10-31T12:00:00Z');
  it('ageLabel / ageWords', () => {
    expect(ageLabel('2026-10-31T11:59:40Z', now)).toBe('now');
    expect(ageLabel('2026-10-31T11:25:00Z', now)).toBe('35 min');
    expect(ageLabel('2026-10-31T08:00:00Z', now)).toBe('4 h');
    expect(ageLabel('2026-10-29T08:00:00Z', now)).toBe('2 d');
    expect(ageLabel('2026-10-10T08:00:00Z', now)).toBe('3 w');
    expect(ageLabel('2026-06-01T08:00:00Z', now)).toBe('5 mo');
    expect(ageLabel(null, now)).toBe('');
    expect(ageLabel('not a date', now)).toBe('');
    expect(ageLabel('2026-11-02T08:00:00Z', now)).toBe('now'); // future clamps
    expect(ageWords('2026-10-29T08:00:00Z', now)).toBe('2 days ago');
    expect(ageWords('2026-10-31T11:00:00Z', now)).toBe('1 hour ago');
    expect(ageWords('2026-10-31T11:59:59Z', now)).toBe('just now');
  });
  it('duplicateReason names the shared key', () => {
    const a = { email_norm: 'a@example.invalid', phone_norm: '315550101' };
    expect(duplicateReason(a, { email_norm: 'a@example.invalid', phone_norm: '315550101' })).toBe('same phone number and email');
    expect(duplicateReason(a, { email_norm: 'b@example.invalid', phone_norm: '315550101' })).toBe('same phone number');
    expect(duplicateReason(a, { email_norm: 'a@example.invalid', phone_norm: null })).toBe('same email');
    expect(duplicateReason({ email_norm: null, phone_norm: null }, { email_norm: null, phone_norm: null })).toBeNull();
    expect(duplicateReason(a, null)).toBeNull();
  });
  it('xero status, tel and mailto', () => {
    expect(xeroStatusLabel('SENT')).toBe('Sent');
    expect(xeroStatusLabel(null)).toBe('');
    expect(telHref('+27 31 555 0101')).toBe('tel:+27315550101');
    expect(telHref('031 555 0101')).toBe('tel:0315550101');
    expect(telHref('n/a')).toBeNull();
    expect(mailHref(' x@example.invalid ')).toBe('mailto:x@example.invalid');
    expect(mailHref('a@b.c,d@e.f')).toBeNull();
    expect(mailHref('javascript:alert(1)')).toBeNull();
    expect(mailHref(null)).toBeNull();
  });
});

describe('pipeline board', () => {
  it('filters by search, owner, branch and test source', () => {
    const rows = [
      lead({ name: 'Karoo Demo Transport', assigned_to: ME }),
      lead({ source: 'test', branch: 'Cape Town', phone: '+27 21 555 0133' }),
      lead({ assigned_to: OTHER, product: 'Flat-deck trailer', branch: null }),
    ];
    expect(filterBoard(rows, {}, ME)).toHaveLength(3);
    expect(filterBoard(rows, { hideTest: true }, ME).map((l) => l.source)).toEqual(['manual', 'manual']);
    expect(filterBoard(rows, { owner: 'mine' }, ME)).toEqual([rows[0]]);
    expect(filterBoard(rows, { owner: 'none' }, ME)).toEqual([rows[1]]);
    expect(filterBoard(rows, { branch: 'Cape Town' }, ME)).toEqual([rows[1]]);
    expect(filterBoard(rows, { q: 'karoo' }, ME)).toEqual([rows[0]]);
    expect(filterBoard(rows, { q: 'flat-deck' }, ME)).toEqual([rows[2]]);
    expect(filterBoard(rows, { q: '021 555 0133' }, ME)).toEqual([rows[1]]);
    expect(matchesSearch(rows[0], '  ')).toBe(true);
    expect(matchesSearch(rows[0], '55')).toBe(false); // fewer than 3 digits never matches a phone
  });

  it('sums matched quote totals per currency, ZAR first, ignoring leads without a quote', () => {
    expect(sumQuotes([
      lead({ matched_quote_id: 'q1', matched_quote_total: '198400.00', matched_quote_currency: 'ZAR' }),
      lead({ matched_quote_id: 'q2', matched_quote_total: 86250.5, matched_quote_currency: null }),
      lead({ matched_quote_id: 'q3', matched_quote_total: 100, matched_quote_currency: 'USD' }),
      lead({ matched_quote_id: null, matched_quote_total: 999 }),
      lead({ matched_quote_id: 'q4', matched_quote_total: null }),
    ])).toEqual([{ currency: 'ZAR', total: 284650.5 }, { currency: 'USD', total: 100 }]);
    expect(sumQuotes([])).toEqual([]);
  });

  it('builds the five stage columns with counts and sums; spam is not a column', () => {
    const rows = [
      lead({ status: 'new', created_at: '2026-10-01T00:00:00Z' }),
      lead({ status: 'new', created_at: '2026-10-05T00:00:00Z' }),
      lead({ status: 'quoted', matched_quote_id: 'q', matched_quote_total: 1000, matched_quote_currency: 'ZAR' }),
      lead({ status: 'won', matched_quote_id: 'w', matched_quote_total: 500, matched_quote_currency: 'ZAR' }),
      lead({ status: 'spam' }),
    ];
    const board = buildBoard(rows);
    expect(board.map((c) => [c.stage, c.label, c.count])).toEqual([
      ['new', 'New', 2], ['contacted', 'Contacted', 0], ['quoted', 'Quoted', 1], ['won', 'Won', 1], ['lost', 'Lost', 0],
    ]);
    expect(board[0].cards[0].created_at).toBe('2026-10-05T00:00:00Z'); // newest first
    expect(board[2].sums).toEqual([{ currency: 'ZAR', total: 1000 }]);
    expect(board.reduce((a, c) => a + c.count, 0)).toBe(4);
    expect(openSummary(rows)).toEqual({ count: 3, sums: [{ currency: 'ZAR', total: 1000 }] });
  });

  it('lists distinct branches', () => {
    expect(branchOptions([lead({ branch: 'Durban' }), lead({ branch: ' Cape Town ' }), lead({ branch: null }), lead({ branch: 'Durban' })]))
      .toEqual(['Cape Town', 'Durban']);
  });
});

describe('action results and activity text', () => {
  it('field errors name only known fields', () => {
    expect(fieldErrors(['email'])).toEqual({ email: expect.stringContaining('phone number') });
    expect(fieldErrors(['branch', 'evil'])).toEqual({ branch: expect.any(String), form: expect.any(String) });
    expect(UI_SOURCES).toEqual(['manual', 'test']);
    expect(actionMessage('notfound')).toMatch(/no longer exists/);
  });
  it('activity lines carry no field values', () => {
    const who = new Map([[ME, 'Test Admin']]);
    expect(eventLabel('status')).toBe('Status changed');
    expect(eventLabel('custom')).toBe('custom');
    expect(eventText('status', { from: 'new', to: 'contacted' }, who)).toBe('New → Contacted');
    expect(eventText('assigned', { to: ME }, who)).toBe('to Test Admin');
    expect(eventText('assigned', { to: null }, who)).toBe('unassigned');
    expect(eventText('emailed', { status: 'sent', recipients: 1 }, who)).toBe('sent (1 recipient)');
    expect(eventText('matched', { quote_id: 'q', invoice_id: null }, who)).toBe('quote');
    expect(eventText('note', {}, who)).toBe('');
  });
});
