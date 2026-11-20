import { describe, expect, it } from 'vitest';
import { firstName, greeting, homeDateLine, phoneDateLine } from '@/lib/home/greeting';
import { entryReference, FORM_UI, formUi, newEntryHref, sortForHome } from '@/lib/home/forms';
import { byLabel, recentRows, type RecentEntryInput } from '@/lib/home/recent';
import { syncRows, tokenExpiry, xeroHealth, type SyncStateRow } from '@/lib/home/xero-health';
import type { Member, Role } from '@/lib/security/can';
import {
  buildTasks, emptyCopy, filterRows, inspectionFacts, parseFilter, storeRoomShortage, taskCounts, taskPerms, visibleFilters,
  type BuildInput, type TaskPerms,
} from '@/lib/tasks/build';
import { ageLabel, daysAgo, plural, sinceLabel, stampLabel, whenLabel } from '@/lib/tasks/format';
import { entitySingular, errorCode, jobErrorLabel, safeErrorText } from '@/lib/tasks/jobs';
import { spec } from './specs';

// SAST = UTC+2. NOW is Thursday 29 Oct 2026, 14:32 SAST.
const NOW = '2026-10-29T12:32:00Z';
const member = (role: Role): Member => ({ userId: '00000000-0000-0000-0000-0000000000a1', orgId: '00000000-0000-0000-0000-000000000001', role, branch: null });
const ALL: TaskPerms = { review: true, approve: true, storeRoom: true, jobs: true, leads: true };

describe('relative times (SAST days)', () => {
  it('ages: Today / Yesterday with a clock, then whole days', () => {
    expect(ageLabel('2026-10-29T07:14:00Z', NOW)).toBe('Today 09:14');
    expect(ageLabel('2026-10-28T13:40:00Z', NOW)).toBe('Yesterday 15:40');
    expect(ageLabel('2026-10-27T08:00:00Z', NOW)).toBe('2 days');
    expect(ageLabel('2026-10-20T08:00:00Z', NOW)).toBe('9 days');
    expect(ageLabel(null, NOW)).toBe('');
  });
  it('counts SAST calendar days, not UTC ones', () => {
    // 22:30Z on the 28th is 00:30 on the 29th in SAST.
    expect(daysAgo('2026-10-28T22:30:00Z', NOW)).toBe(0);
    expect(daysAgo('2026-10-28T21:59:00Z', NOW)).toBe(1);
  });
  it('inline "since" text: bare clock today, lower-case yesterday, date before', () => {
    expect(sinceLabel('2026-10-29T07:14:00Z', NOW)).toBe('09:14');
    expect(sinceLabel('2026-10-28T14:40:00Z', NOW)).toBe('yesterday 16:40');
    expect(sinceLabel('2026-10-27T13:48:00Z', NOW)).toBe('27 Oct 15:48');
    expect(whenLabel('2026-10-28T14:40:00Z', NOW)).toBe('Yesterday 16:40');
    expect(whenLabel('2026-10-29T07:14:00Z', NOW)).toBe('09:14');
  });
  it('sync stamps say SAST', () => {
    expect(stampLabel('2026-10-29T12:30:00Z', NOW)).toBe('14:30 SAST');
    expect(stampLabel('2026-10-28T12:30:00Z', NOW)).toBe('Yesterday 14:30 SAST');
    expect(stampLabel('2026-10-26T12:30:00Z', NOW)).toBe('26 Oct 14:30 SAST');
  });
  it('plurals', () => {
    expect(plural(1, 'failure')).toBe('1 failure');
    expect(plural(3, 'failure')).toBe('3 failures');
    expect(plural(0, 'form')).toBe('0 forms');
  });
});

describe('job error labels', () => {
  it('maps the redacted sync reasons', () => {
    expect(jobErrorLabel('xero 429', 'short')).toBe('429 rate limit');
    expect(jobErrorLabel('xero 429', 'long')).toBe('429 Too Many Requests');
    expect(jobErrorLabel('xero 503')).toBe('503 Xero server error');
    expect(jobErrorLabel('xero 418')).toBe('418 error');
    expect(jobErrorLabel('auth invalid_grant', 'short')).toBe('Xero sign-in failed');
    expect(jobErrorLabel('auth invalid_grant')).toBe('Xero sign-in failed (invalid_grant)');
    expect(jobErrorLabel('sync error')).toBe('Sync error');
    expect(jobErrorLabel(null)).toBe('Failed');
  });
  it('never shows an email address or a long number from free text, and clips', () => {
    const out = jobErrorLabel('Recipient bounced: someone.real@example.com account 123456789012');
    expect(out).not.toContain('@');
    expect(out).toContain('[email]');
    expect(out).toContain('[number]');
    expect(safeErrorText('x'.repeat(200)).length).toBe(80);
  });
  it('short codes and singular entity names', () => {
    expect(errorCode('xero 429')).toBe('429');
    expect(errorCode('auth token 400')).toBe('auth');
    expect(errorCode('sync error')).toBe('error');
    expect(entitySingular('invoices')).toBe('invoice');
  });
});

describe('Home header', () => {
  it('greets by SAST hour with the first name', () => {
    expect(greeting('2026-10-29T05:59:00Z', 'Zanele Demo')).toBe('Good morning, Zanele'); // 07:59
    expect(greeting('2026-10-29T10:00:00Z', 'Zanele Demo')).toBe('Good afternoon, Zanele'); // 12:00
    expect(greeting('2026-10-29T14:59:00Z', 'Zanele')).toBe('Good afternoon, Zanele'); // 16:59
    expect(greeting('2026-10-29T15:00:00Z', 'Zanele')).toBe('Good evening, Zanele'); // 17:00
    expect(greeting('2026-10-28T22:30:00Z', 'Zanele')).toBe('Good morning, Zanele'); // 00:30
  });
  it('drops the name and comma without a profile name', () => {
    expect(greeting(NOW, null)).toBe('Good afternoon');
    expect(greeting(NOW, '   ')).toBe('Good afternoon');
    expect(firstName('  Pieter  van Demo ')).toBe('Pieter');
  });
  it('date lines without the en-GB comma', () => {
    expect(homeDateLine(NOW)).toBe('Thursday 29 October 2026 · 14:32 SAST');
    expect(phoneDateLine(NOW)).toBe('Thu 29 Oct · 14:32 SAST');
    expect(phoneDateLine('2026-09-01T08:00:00Z')).toBe('Tue 1 Sep · 10:00 SAST');
  });
});

describe('Home forms', () => {
  const forms = ['deal', 'delivery-note', 'release-form', 'request-for-invoice', 'store-room', 'trailer-inspection-checklist', 'job-card']
    .map((slug) => ({ slug, name: spec(slug).name, spec: spec(slug), isActive: true }));

  it('uses the design order and labels', () => {
    expect(sortForHome(forms).map((f) => formUi(f.slug, f.name).label)).toEqual([
      'Deal', 'Request for Invoice', 'Job Card', 'Trailer Inspection', 'Release Form', 'Delivery Note + T&Cs', 'Store Room',
    ]);
    expect(Object.keys(FORM_UI)).toHaveLength(7);
    expect(formUi('unknown', 'Other form')).toMatchObject({ label: 'Other form', icon: 'forms' });
  });

  it('"New" goes to the staff form when the member may start one, else the public link, else nowhere', () => {
    const f = (slug: string, isActive = true) => ({ ...forms.find((x) => x.slug === slug)!, isActive });
    expect(newEntryHref(f('deal'), member('admin'))).toBe('/admin/forms/deal/new');
    expect(newEntryHref(f('store-room'), member('staff'))).toBe('/admin/forms/store-room/new');
    // Only the Inspector role can start an inspection: staff get the public link.
    expect(newEntryHref(f('trailer-inspection-checklist'), member('admin'))).toBe('/f/trailer-inspection-checklist');
    expect(newEntryHref(f('trailer-inspection-checklist', false), member('admin'))).toBeNull();
    // Reviewers cannot write entries.
    expect(newEntryHref(f('job-card'), member('reviewer'))).toBe('/f/job-card');
    expect(newEntryHref(f('deal', false), member('reviewer'))).toBeNull();
  });

  it('references: clear summary for encrypted forms, document numbers where the summary is a person', () => {
    expect(entryReference('deal', 'QU-10479', { secret: 'x' })).toBe('QU-10479');
    expect(entryReference('delivery-note', 'TT9DEMO24D0010482', null)).toBe('TT9DEMO24D0010482');
    expect(entryReference('job-card', 'QU-10471', {})).toBe('QU-10471');
    expect(entryReference('release-form', 'TT9DEMO24D0010482', { INVNO: 'INV-20926' })).toBe('INV-20926');
    expect(entryReference('release-form', 'TT9DEMO24D0010482', {})).toBe('TT9DEMO24D0010482');
    expect(entryReference('request-for-invoice', 'Demo Person', { QuoteNo: 'QU-10482' })).toBe('QU-10482');
    expect(entryReference('request-for-invoice', 'Demo Person', {})).toBe('—');
    expect(entryReference('trailer-inspection-checklist', 'Inspector A. Demo', { TRAILERVINNUMBER: 'TT9DEMO24D0010482' })).toBe('TT9DEMO24D0010482');
    expect(entryReference('trailer-inspection-checklist', 'Inspector A. Demo', {})).toBe('—');
    expect(entryReference('store-room', '12', { a: 1 })).toBe('—');
  });
});

describe('Home recent entries', () => {
  const base: RecentEntryInput = {
    id: 'e1', slug: 'trailer-inspection-checklist', formName: 'Trailer Inspection Checklist', number: 214, status: 'Submitted', statusColor: 'teal',
    summary: 'Inspector A. Demo', data: { TRAILERVINNUMBER: 'TT9DEMO24D0010482', InspectedByName: { First: 'Inspector', Last: 'A. Demo' } },
    createdAt: '2026-10-29T07:00:00Z', submittedAt: '2026-10-29T07:14:00Z', createdBy: null, firstRole: 'Inspector', read: false,
  };
  const names = new Map([['u1', 'Pieter Demo']]);

  it('says who started the entry', () => {
    expect(byLabel(base, names)).toBe('Inspector A. Demo');
    expect(byLabel({ ...base, data: {} }, names)).toBe('Inspector link');
    expect(byLabel({ ...base, slug: 'release-form', firstRole: 'System' }, names)).toBe('Auto · Xero');
    expect(byLabel({ ...base, slug: 'request-for-invoice', firstRole: 'Public' }, names)).toBe('Public link');
    expect(byLabel({ ...base, createdBy: 'u1' }, names)).toBe('Pieter Demo');
    expect(byLabel({ ...base, createdBy: 'u2' }, names)).toBe('Staff member');
  });

  it('maps rows with label, link, reference, time and read state', () => {
    const [r] = recentRows([base], names, NOW);
    expect(r).toEqual({
      id: 'e1', label: 'Trailer Inspection #214', href: '/admin/forms/trailer-inspection-checklist/entries/214', reference: 'TT9DEMO24D0010482',
      by: 'Inspector A. Demo', when: 'Today 09:14', status: 'Submitted', statusColor: 'teal', unread: true,
    });
    expect(recentRows([{ ...base, read: true, submittedAt: null, createdAt: '2026-10-27T13:48:00Z' }], names, NOW)[0]).toMatchObject({ unread: false, when: '27 Oct 15:48' });
  });
});

describe('Xero health', () => {
  const ok = (entity: string): SyncStateRow => ({ entity, last_run_at: '2026-10-29T12:30:00Z', last_ok_at: '2026-10-29T12:30:00Z', last_error: null });
  const states = ['quotes', 'invoices', 'contacts', 'payments', 'attachments'].map(ok);
  const conn = { status: 'connected', expiresAt: '2026-10-29T12:54:00Z' };

  it('healthy', () => {
    const h = xeroHealth({ connection: conn, states, failures: [] }, NOW);
    expect(h.chip).toEqual({ label: 'Healthy', tone: 'green' });
    expect(h.rows).toEqual([
      { label: 'Last sync', value: '14:30 SAST' },
      { label: 'Token expiry', value: 'in 22 min · auto-refresh' },
      { label: 'Failures 24 h', value: '0' },
    ]);
    expect(h.banner).toBeNull();
    expect(h.sync.map((s) => [s.label, s.dot, s.when])).toEqual([
      ['Quotes', 'ok', '14:30 SAST'], ['Invoices', 'ok', '14:30 SAST'], ['Contacts', 'ok', '14:30 SAST'], ['Payments', 'ok', '14:30 SAST'],
    ]);
  });

  it('failures: yellow chip, red count with the latest reason, failed sync row and phone banner', () => {
    const failing = states.map((s) => (s.entity === 'invoices' ? { ...s, last_run_at: '2026-10-29T11:58:00Z', last_error: 'xero 429' } : s));
    const h = xeroHealth({ connection: conn, states: failing, failures: [{ error: 'xero 429' }] }, NOW);
    expect(h.chip).toEqual({ label: '1 failure', tone: 'yellow' });
    expect(h.rows[2]).toEqual({ label: 'Failures 24 h', value: '1 (429 rate limit)', danger: true });
    expect(h.sync[1]).toMatchObject({ dot: 'failed', when: 'Failed 13:58 · 429' });
    expect(h.banner).toBe('Xero invoice sync failed at 13:58');
    expect(xeroHealth({ connection: conn, states, failures: [{ error: 'xero 429' }, { error: 'sync error' }] }, NOW).chip.label).toBe('2 failures');
  });

  it('not connected: red chip, dashes and a banner', () => {
    const h = xeroHealth({ connection: null, states: [], failures: [] }, NOW);
    expect(h.chip).toEqual({ label: 'Not connected', tone: 'red' });
    expect(h.rows.slice(0, 2).map((r) => r.value)).toEqual(['—', '—']);
    expect(h.banner).toBe('Xero is not connected');
    expect(xeroHealth({ connection: { status: 'error', expiresAt: null }, states, failures: [] }, NOW).chip.label).toBe('Not connected');
  });

  it('failed reads show dashes, never throw', () => {
    const h = xeroHealth({ connection: conn, states: null, failures: null }, NOW);
    expect(h.rows.map((r) => r.value)).toEqual(['—', 'in 22 min · auto-refresh', '—']);
    expect(h.sync.every((s) => s.when === '—')).toBe(true);
  });

  it('never-synced entities and token expiry wording', () => {
    expect(syncRows([], NOW).map((s) => [s.dot, s.when])[0]).toEqual(['never', 'Not synced yet']);
    expect(tokenExpiry('2026-10-29T12:31:00Z', NOW)).toBe('expired · refreshes on next call');
    expect(tokenExpiry('2026-10-29T14:40:00Z', NOW)).toBe('in 2 h · auto-refresh');
    expect(tokenExpiry(null, NOW)).toBe('—');
  });
});

describe('tasks', () => {
  const store = spec('store-room');
  const insp = (over: Partial<NonNullable<BuildInput['inspections']>[number]> = {}) => ({
    id: '11111111-1111-4111-8111-111111111111', number: 214, status: 'Submitted', version: '2026-10-29T07:14:00.000Z',
    data: {
      TRAILERVINNUMBER: 'TT9DEMO24D0010482', InspectedByName: { First: 'Inspector', Last: 'A. Demo' },
      checklist: [{ itemNo: 1, label: 'a', fail: true, pass: false, comments: '' }, { itemNo: 2, label: 'b', fail: true, pass: false, comments: '' }, { itemNo: 3, label: 'c', fail: false, pass: true, comments: '' }],
    },
    waitingSince: '2026-10-29T07:14:00Z', reviewedBy: null, ...over,
  });
  const input: BuildInput = {
    inspections: [
      insp(),
      insp({ id: '22222222-2222-4222-8222-222222222222', number: 209, status: 'Reviewed', waitingSince: '2026-10-28T14:40:00Z', reviewedBy: 'Pieter Demo' }),
      insp({ id: '33333333-3333-4333-8333-333333333333', number: 211, data: { TRAILERVINNUMBER: 'TT9DEMO24D0010471', InspectedByName: { First: 'Inspector', Last: 'B. Sample' } }, waitingSince: '2026-10-28T13:40:00Z' }),
    ],
    storeRoom: [{
      id: '44444444-4444-4444-8444-444444444444', number: 61, status: 'APPROVAL', version: 'v', waitingSince: '2026-10-28T14:05:00Z', countedBy: 'Store B. Sample',
      data: { _14INCX5HoleTIRESMIN50: '12', _13INCH4HOLETIRESMIN10: '10', READYBARMIN30: 'n/a' },
    }],
    storeRoomSpec: store,
    failedJobs: [{ id: '55555555-5555-4555-8555-555555555555', queue: 'xero.setQuoteStatus', attempts: 5, lastError: 'xero 429', failedAt: '2026-10-29T11:58:00Z' }],
    syncFailures: [{ entity: 'invoices', error: 'xero 429', at: '2026-10-29T11:58:00Z', runId: 8812 }],
    leads: [{ id: '66666666-6666-4666-8666-666666666666', name: 'Karoo Demo Transport', status: 'new', createdAt: '2026-10-27T08:00:00Z', duplicateOf: 'x', duplicateName: 'Karoo Demo Haulage' }],
    perms: ALL,
    now: NOW,
  };

  it('orders by category (Submitted before Reviewed), then oldest first', () => {
    const rows = buildTasks(input);
    expect(rows.map((r) => r.testId)).toEqual([
      'task-inspection-211', 'task-inspection-214', 'task-inspection-209', 'task-store-room-61',
      'task-job-55555555-5555-4555-8555-555555555555', 'task-sync-invoices', 'task-lead-66666666-6666-4666-8666-666666666666',
    ]);
    expect(taskCounts(rows)).toEqual({ all: 7, inspections: 3, 'store-room': 1, 'failed-jobs': 2, leads: 1 });
    expect(filterRows(rows, 'failed-jobs')).toHaveLength(2);
  });

  it('inspection rows: title, meta, chip, age, actions and the Home/phone wording', () => {
    const rows = buildTasks(input);
    const sub = rows.find((r) => r.testId === 'task-inspection-214')!;
    expect(sub).toMatchObject({
      title: 'Inspection #214 · TT9DEMO24D0010482', status: 'Submitted', statusTone: 'teal', icon: 'inspect',
      meta: 'Needs review · Inspector A. Demo · 2 rows marked Fail', age: 'Today 09:14',
      href: '/admin/forms/trailer-inspection-checklist/entries/214', secondary: { label: 'Open', href: '/admin/forms/trailer-inspection-checklist/entries/214' },
      primary: { type: 'inspection', action: 'review', label: 'Mark reviewed', number: 214, version: '2026-10-29T07:14:00.000Z' },
    });
    expect(sub.home).toEqual({
      kind: 'Review', kindTone: 'teal', title: 'Review inspection #214', action: 'Review', href: '/admin/forms/trailer-inspection-checklist/entries/214',
      meta: 'VIN TT9DEMO24D0010482 · submitted 09:14 by Inspector A. Demo',
    });
    expect(sub.phone).toEqual({ title: 'Review inspection #214', meta: 'VIN …0482 · 09:14' });
    expect(rows.find((r) => r.testId === 'task-inspection-211')!.meta).toBe('Needs review · Inspector B. Sample');

    const rev = rows.find((r) => r.testId === 'task-inspection-209')!;
    expect(rev).toMatchObject({ status: 'Reviewed', statusTone: 'yellow', meta: 'Needs approval · reviewed by Pieter Demo', age: 'Yesterday 16:40', primary: { action: 'approve', label: 'Approve' } });
    expect(rev.home).toMatchObject({ kind: 'Approve', kindTone: 'yellow', title: 'Approve inspection #209', meta: 'Reviewed yesterday 16:40 by Pieter Demo', action: 'Open' });
  });

  it('store room, failed jobs and leads', () => {
    const rows = buildTasks(input);
    const s = rows.find((r) => r.category === 'store-room')!;
    expect(s).toMatchObject({
      title: 'Store Room count #61', status: 'APPROVAL', statusTone: 'red', meta: '1 of 31 items below minimum · counted by Store B. Sample',
      primary: { type: 'store-room', label: 'Mark APPROVED EMAILED', number: 61, status: 'APPROVED EMAILED' },
    });
    expect(s.home).toMatchObject({ kind: 'APPROVAL', meta: '1 item below minimum level', action: 'Open' });
    expect(s.phone).toEqual({ title: 'Store Room #61', meta: '1 below minimum' });

    const job = rows.find((r) => r.testId.startsWith('task-job-'))!;
    expect(job).toMatchObject({ title: 'xero.setQuoteStatus', status: 'Failed', meta: '429 Too Many Requests · 5 attempts', primary: { type: 'job-retry', label: 'Retry', jobId: job.id.slice(4) }, secondary: { label: 'Details' } });
    expect(job.home).toMatchObject({ kind: 'Failed', title: 'Job xero.setQuoteStatus failed', meta: '429 rate limit · 13:58 SAST · auto-retry exhausted', href: '/admin/tasks?filter=failed-jobs' });

    const sync = rows.find((r) => r.testId === 'task-sync-invoices')!;
    expect(sync).toMatchObject({ title: 'xero.sync.invoices', meta: '429 Too Many Requests · run #8812', primary: { type: 'sync-retry', label: 'Retry' } });
    expect(sync.home.action).toBe('Retry');

    const lead = rows.find((r) => r.category === 'leads')!;
    expect(lead).toMatchObject({
      title: 'Lead · Karoo Demo Transport', status: 'New', meta: 'Assigned to you · possible duplicate of Karoo Demo Haulage', age: '2 days',
      secondary: null, primary: { type: 'link', label: 'Open lead', href: '/admin/leads/66666666-6666-4666-8666-666666666666' },
    });
    expect(lead.home).toMatchObject({ kind: 'Lead', kindTone: 'gray', meta: 'Possible duplicate of Karoo Demo Haulage' });
  });

  it('only shows rows the member can act on', () => {
    const cats = (role: Role) => [...new Set(buildTasks({ ...input, perms: taskPerms(member(role)) }).map((r) => `${r.category}:${r.status}`))];
    expect(cats('admin')).toEqual(['inspections:Submitted', 'inspections:Reviewed', 'store-room:APPROVAL', 'failed-jobs:Failed', 'leads:New']);
    // Staff: read-only for inspections (Rule 4), no jobs.
    expect(cats('staff')).toEqual(['store-room:APPROVAL', 'leads:New']);
    expect(cats('reviewer')).toEqual(['inspections:Submitted', 'inspections:Reviewed']);
    expect(cats('factory')).toEqual([]);
    expect(visibleFilters(taskPerms(member('staff')))).toEqual(['all', 'store-room', 'leads']);
    expect(visibleFilters(taskPerms(member('reviewer')))).toEqual(['all', 'inspections']);
  });

  it('filters from the URL fall back to All', () => {
    const vis = visibleFilters(ALL);
    expect(parseFilter('failed-jobs', vis)).toBe('failed-jobs');
    expect(parseFilter(['leads', 'x'], vis)).toBe('leads');
    expect(parseFilter('nope', vis)).toBe('all');
    expect(parseFilter('failed-jobs', ['all', 'inspections'])).toBe('all');
    expect(parseFilter(undefined, vis)).toBe('all');
  });

  it('facts, shortage and empty copy', () => {
    expect(inspectionFacts({})).toEqual({ vin: '', inspector: '', fails: 0 });
    expect(storeRoomShortage(store, {})).toEqual({ short: 0, total: 31 });
    expect(storeRoomShortage(null, {})).toEqual({ short: 0, total: 0 });
    expect(emptyCopy('all').title).toBe('Nothing needs you right now');
    expect(emptyCopy('leads').body).toBe('No new leads assigned to you.');
  });
});
