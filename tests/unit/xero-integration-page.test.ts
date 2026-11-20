import { describe, expect, it } from 'vitest';
import { differenceCount, differencesLabel, diffLines, normalisePath, parseMakeRecording, requestLines, sides } from '@/lib/settings/request-diff';
import {
  accessTokenMeter, actionStats, entityRows, failureItems, liveBlockedReason, pickDryRun, rateMeters, refreshTokenMeter, webhookEventRows,
} from '@/lib/settings/xero-page';

const NOW = '2026-10-29T12:30:00Z'; // 14:30 SAST

describe('token and rate meters', () => {
  it('access token: minutes left of 30, expired, missing', () => {
    expect(accessTokenMeter('2026-10-29T12:52:00Z', NOW)).toEqual({ label: '22 min left · auto-refresh', pct: 73, tone: 'green' });
    expect(accessTokenMeter('2026-10-29T12:00:00Z', NOW)).toMatchObject({ label: 'Expired · refreshes on next call', pct: 0 });
    expect(accessTokenMeter(null, NOW)).toMatchObject({ label: '—', pct: null });
  });

  it('refresh token: 60 days from the last refresh, red from 7 days', () => {
    expect(refreshTokenMeter('2026-10-23T12:30:00Z', NOW)).toMatchObject({ label: '54 days left', pct: 90, tone: 'green', daysLeft: 54 });
    expect(refreshTokenMeter('2026-09-08T12:30:00Z', NOW)).toMatchObject({ label: '9 days left', tone: 'yellow' });
    expect(refreshTokenMeter('2026-09-04T12:30:00Z', NOW)).toMatchObject({ label: '5 days left', tone: 'red' });
    expect(refreshTokenMeter('2026-08-01T00:00:00Z', NOW)).toMatchObject({ label: 'Expired · reconnect Xero', tone: 'red', daysLeft: 0 });
    expect(refreshTokenMeter(null, NOW)).toMatchObject({ label: '—', pct: null, daysLeft: null });
  });

  it('rate headroom from the last response; the minute resets after 60 s', () => {
    const fresh = rateMeters({ min: 8, day: 4612, seenAt: '2026-10-29T12:29:40Z' }, NOW);
    expect(fresh.minute).toEqual({ label: '8 / 60 left', pct: 13, tone: 'red' });
    expect(fresh.day).toEqual({ label: '4,612 / 5,000 left', pct: 92, tone: 'green' });
    expect(fresh.seen).toBe('14:29 SAST');
    expect(rateMeters({ min: 8, day: 4612, seenAt: '2026-10-29T12:20:00Z' }, NOW).minute.label).toBe('60 / 60 left');
    expect(rateMeters({ min: null, day: null, seenAt: null }, NOW).minute.label).toBe('No calls yet');
  });
});

describe('entities and failures', () => {
  const states = [
    { entity: 'invoices', backfill_done: true, pass: 0, page: 1, last_run_at: '2026-10-29T11:58:00Z', last_ok_at: '2026-10-29T11:12:00Z', last_error: 'xero 429', records_synced: 986 },
    { entity: 'quotes', backfill_done: true, pass: 0, page: 1, last_run_at: NOW, last_ok_at: NOW, last_error: null, records_synced: 1204 },
    { entity: 'payments', backfill_done: false, pass: 1, page: 3, last_run_at: NOW, last_ok_at: null, last_error: null, records_synced: '10' },
  ];

  it('orders entities as the design and derives a state', () => {
    expect(entityRows(states, NOW)).toEqual([
      { entity: 'quotes', name: 'Quotes', when: '14:30 SAST', records: '1,204', state: 'OK', tone: 'green', detail: null },
      { entity: 'invoices', name: 'Invoices', when: '13:12 SAST', records: '986', state: 'Failed', tone: 'red', detail: '429 Too Many Requests' },
      { entity: 'payments', name: 'Payments', when: 'Never', records: '10', state: 'Backfilling', tone: 'teal', detail: 'pass 2, page 3' },
    ]);
  });

  it('lists 24 h failures newest first; sync Retry, job Retry by id, Replay only for replayable events', () => {
    const items = failureItems({
      states,
      runs: [
        { id: 8812, job: 'xero.sync.full', started_at: '2026-10-29T11:58:30Z', error: 'xero 429' },
        { id: 8700, job: 'xero.rfi.create_invoice', started_at: '2026-10-29T07:00:00Z', error: 'xero 400 ValidationException' },
        { id: 10, job: 'xero.sync.quick', started_at: '2026-10-27T07:00:00Z', error: 'xero 500' }, // older than 24 h
      ],
      outbox: [{ id: 'j1', queue: 'xero.fetch', attempts: 5, last_error: 'xero 404', created_at: '2026-10-29T09:47:00Z', locked_at: '2026-10-29T09:47:00Z' }],
      events: [
        { id: 'e1', received_at: '2026-10-29T08:00:00Z', status: 'failed', attempts: 1, error: null, payload: { eventCategory: 'INVOICE', eventType: 'UPDATE' }, replayable: true },
        { id: 'e2', received_at: '2026-10-29T07:30:00Z', status: 'queued', attempts: 0, error: null, payload: { eventCategory: 'SUBSCRIPTION' }, replayable: false },
      ],
    }, NOW);
    expect(items.map((i) => [i.job, i.action, i.target])).toEqual([
      ['xero.sync.full', 'retry', null],
      ['xero.sync · invoices', 'retry', null],
      ['webhook · xero.fetch', 'retry-job', 'j1'],
      ['webhook · invoice', 'replay', 'e1'],
      ['webhook · subscription', null, null],
      ['xero.rfi.create_invoice', null, null],
    ]);
    expect(items[0]).toMatchObject({ error: '429 Too Many Requests', meta: '13:58 SAST · run #8812' });
    expect(items[2].meta).toBe('11:47 SAST · 5 attempts');
    expect(items[4].error).toBe('Not processed yet');
  });

  it('lists webhook events with kind, status and Replay only where the loader allowed it', () => {
    const rows = webhookEventRows([
      { id: 'a', received_at: '2026-10-29T11:00:00Z', status: 'processed', attempts: 1, error: null, payload: { eventCategory: 'INVOICE', eventType: 'UPDATE', resourceId: 'r' }, replayable: true },
      { id: 'b', received_at: '2026-10-29T10:00:00Z', status: 'ignored', attempts: 0, error: null, payload: { eventCategory: 'nope<script>' }, replayable: false },
      { id: 'c', received_at: '2026-10-29T09:00:00Z', status: 'failed', attempts: 2, error: 'xero 404', payload: null, replayable: true },
    ], NOW);
    expect(rows.map((r) => [r.kind, r.status, r.tone, r.replayable])).toEqual([
      ['INVOICE · UPDATE', 'Processed', 'green', true],
      ['Event', 'Ignored', 'gray', false],
      ['Event', 'Failed', 'red', true],
    ]);
    expect(rows[2].detail).toBe('404 Not Found');
    expect(rows[0].when).toBe('13:00 SAST');
    expect(JSON.stringify(rows)).not.toContain('"r"');
  });
});

describe('write actions', () => {
  const runs = [
    { action: 'rfi.create_invoice', mode: 'dry_run', status: 'planned', created_at: '2026-10-29T10:00:00Z' },
    { action: 'rfi.create_invoice', mode: 'dry_run', status: 'planned', created_at: '2026-10-28T10:00:00Z' },
    { action: 'rfi.create_invoice', mode: 'dry_run', status: 'failed', created_at: '2026-10-28T09:00:00Z' },
    { action: 'rfi.create_invoice', mode: 'dry_run', status: 'planned', created_at: '2026-10-01T10:00:00Z' }, // older than 7 days
    { action: 'deal.import_quote', mode: 'live', status: 'succeeded', created_at: '2026-10-29T10:00:00Z' },
    { action: 'release.on_paid', mode: 'off', status: 'skipped', created_at: '2026-10-29T10:00:00Z' },
  ];
  it('summarises the last 7 days from recorded runs', () => {
    expect(actionStats(runs, 'rfi.create_invoice', NOW)).toBe('3 dry runs · 1 failed');
    expect(actionStats(runs, 'deal.import_quote', NOW)).toBe('1 sent');
    expect(actionStats(runs, 'release.on_paid', NOW)).toBe('1 skipped (off)');
    expect(actionStats(runs, 'delivery.update_invoice', NOW)).toBe('No runs');
  });

  it('picks the chosen dry run or the latest one with requests', () => {
    const rows = [
      { id: 'a', action: 'rfi.create_invoice', mode: 'dry_run', status: 'planned', idempotency_key: 'k', created_at: NOW, planned_requests: [] },
      { id: 'b', action: 'rfi.create_invoice', mode: 'dry_run', status: 'planned', idempotency_key: 'k', created_at: NOW, planned_requests: [{ method: 'PUT' }] },
      { id: 'c', action: 'rfi.create_invoice', mode: 'live', status: 'succeeded', idempotency_key: 'k', created_at: NOW, planned_requests: [{}] },
      { id: 'd', action: 'deal.import_quote', mode: 'dry_run', status: 'planned', idempotency_key: 'k', created_at: NOW, planned_requests: [{}] },
    ];
    expect(pickDryRun(rows, 'rfi.create_invoice')?.id).toBe('b');
    expect(pickDryRun(rows, 'rfi.create_invoice', 'a')?.id).toBe('a');
    expect(pickDryRun(rows, 'rfi.create_invoice', 'c')?.id).toBe('b'); // a live run is never shown as a dry run
    expect(pickDryRun(rows, 'rfi.create_invoice', 'd')?.id).toBe('b'); // another action's run is ignored
    expect(pickDryRun(rows, 'release.on_paid')).toBeNull();
  });
});

describe('live availability', () => {
  it('matches checkSwitch: plan only, connection, write scopes; no Xero writes needs neither', () => {
    const write = { status: 'connected', scopes: ['accounting.transactions', 'accounting.contacts', 'accounting.attachments'] };
    expect(liveBlockedReason('invoice.merge_attachments', write)).toMatch(/only plans/);
    expect(liveBlockedReason('rfi.create_invoice', null)).toBe('connect Xero first.');
    expect(liveBlockedReason('rfi.create_invoice', { status: 'disconnected', scopes: write.scopes })).toBe('connect Xero first.');
    expect(liveBlockedReason('delivery.update_invoice', { status: 'connected', scopes: ['accounting.transactions.read'] })).toMatch(/write scopes/);
    expect(liveBlockedReason('rfi.create_invoice', write)).toBeNull();
    expect(liveBlockedReason('release.on_paid', null)).toBeNull();
    expect(liveBlockedReason('deal.import_quote', null)).toBeNull();
  });
});

describe('dry-run diff', () => {
  const portal = [{ step: 'invoice', method: 'PUT', path: '/Invoices', body: { Type: 'ACCREC', Reference: 'QU-10482 / TT9DEMO24D0010482', Contact: { ContactID: 'c7e1', Name: '[redacted]' } }, purpose: 'x' }];

  it('formats requests with sorted keys and relative paths', () => {
    expect(normalisePath('/api.xro/2.0/Invoices')).toBe('/Invoices');
    expect(normalisePath('https://api.xero.com/api.xro/2.0/Quotes/abc')).toBe('/Quotes/abc');
    expect(normalisePath('Contacts')).toBe('/Contacts');
    expect(requestLines(portal)).toEqual([
      'PUT /Invoices', '{', '  "Contact": {', '    "ContactID": "c7e1",', '    "Name": "[redacted]"', '  },', '  "Reference": "QU-10482 / TT9DEMO24D0010482",', '  "Type": "ACCREC"', '}',
    ]);
    expect(requestLines([{ method: 'PUT', path: '/Invoices/1/Attachments/[file]', file: {} }, { method: 'POST', path: '/Quotes/1', params: { b: '2', a: '1' } }]))
      .toEqual(['PUT /Invoices/1/Attachments/[file]', '(file body)', '', 'POST /Quotes/1?a=1&b=2']);
  });

  it('reads a pasted Make recording in its known shapes and redacts it', () => {
    const req = { method: 'PUT', path: 'Invoices', body: { Type: 'ACCREC', Reference: 'QU-10482', Contact: { ContactID: 'c7e1', Name: 'Sample Person' } } };
    for (const text of [
      JSON.stringify({ format: 'tt-make-replay/1', executions: [{ id: '1', action: 'deal.import_quote', make: { requests: [] } }, { id: '2', action: 'rfi.create_invoice', make: { requests: [req] } }] }),
      JSON.stringify({ make: { requests: [req] } }),
      JSON.stringify({ requests: [req] }),
      JSON.stringify([req]),
      JSON.stringify(req),
    ]) {
      const r = parseMakeRecording(text, 'rfi.create_invoice');
      expect(r.ok, text.slice(0, 40)).toBe(true);
      if (r.ok) {
        expect(r.requests).toHaveLength(1);
        expect(JSON.stringify(r.requests)).not.toContain('Sample Person');
        expect(JSON.stringify(r.requests)).toContain('[redacted]');
      }
    }
    const att = parseMakeRecording(JSON.stringify([{ method: 'PUT', path: '/Invoices/1/Attachments/someone-id.pdf', file: 'x' }]));
    expect(att.ok && att.requests[0].path).toBe('/Invoices/1/Attachments/[file]');
  });

  it('rejects junk without echoing it', () => {
    for (const text of ['', 'not json {', '[]', '{"x":1}', '[{"method":"PUT"}]']) {
      const r = parseMakeRecording(text);
      expect(r.ok, text).toBe(false);
      if (!r.ok) expect(r.error).not.toContain('not json');
    }
  });

  it('diffs lines: portal-only lines are added, Make-only lines removed, blocks counted', () => {
    const left = ['POST /Invoices', '{', '  "Reference": "QU-10482 / VIN",', '  "Type": "ACCREC"', '  "DueDate": "2026-11-24"', '}'];
    const right = ['POST /Invoices', '{', '  "Reference": "QU-10482",', '  "Type": "ACCREC"', '  "DueDate": "2026-11-25"', '}'];
    const d = diffLines(left, right);
    expect(differenceCount(d)).toBe(2);
    expect(differencesLabel(2)).toBe('2 differences');
    const s = sides(d);
    expect(s.portal.filter((l) => l.kind === 'added').map((l) => l.text)).toEqual(['  "Reference": "QU-10482 / VIN",', '  "DueDate": "2026-11-24"']);
    expect(s.make.filter((l) => l.kind === 'removed').map((l) => l.text)).toEqual(['  "Reference": "QU-10482",', '  "DueDate": "2026-11-25"']);
    expect(s.portal.filter((l) => l.kind === 'same')).toHaveLength(4);
    expect(differenceCount(diffLines(left, left))).toBe(0);
    expect(differencesLabel(0)).toBe('No differences');
    expect(differencesLabel(1)).toBe('1 difference');
    expect(sides(diffLines([], ['a'])).make).toEqual([{ kind: 'removed', text: 'a' }]);
  });
});
