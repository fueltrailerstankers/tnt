import { describe, expect, it } from 'vitest';
import { dateRange, defaultColumns, escapeLike, exportTable, parseGridQuery, toCsv, zonedDayStart } from '@/lib/admin/grid';
import { maskId } from '@/lib/forms/lookup-types';
import { validateUploadRequest } from '@/lib/forms/uploads';
import { spec } from './specs';

describe('grid query', () => {
  it('parses views, columns and paging defensively', () => {
    const sp = spec('store-room');
    expect(parseGridQuery(sp, {})).toMatchObject({ view: 'all', status: null, page: 1, cols: defaultColumns(sp) });
    expect(parseGridQuery(sp, { view: 'status:APPROVAL' })).toMatchObject({ view: 'status', status: 'APPROVAL' });
    expect(parseGridQuery(sp, { view: 'status:Nope' })).toMatchObject({ view: 'all', status: null });
    expect(parseGridQuery(sp, { cols: 'OTHER,evil,NUTS12MM' }).cols).toEqual(['OTHER', 'NUTS12MM']);
    expect(parseGridQuery(sp, { page: '-3', from: '2026-13-99' })).toMatchObject({ page: 1, from: null });
  });

  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  it('date filters use the org timezone (Africa/Johannesburg is UTC+2)', () => {
    expect(zonedDayStart('2026-10-29', 'Africa/Johannesburg')).toBe('2026-10-28T22:00:00.000Z');
    expect(dateRange({ from: '2026-10-01', to: '2026-10-31' }, 'Africa/Johannesburg')).toEqual({
      from: '2026-09-30T22:00:00.000Z',
      to: '2026-10-31T22:00:00.000Z',
    });
  });
});

describe('export', () => {
  it('masks protected fields unless allowed, and guards against formula injection', () => {
    const sp = spec('delivery-note');
    const rows = [{ number: 3, status: 'Submitted', createdAt: '2026-10-29T08:00:00Z', updatedAt: '2026-10-29T08:00:00Z', data: { TrailerVinNO: '=HYPERLINK("x")', Email: 'c@example.invalid' } }];
    const t = exportTable(sp, rows, 'Africa/Johannesburg', false);
    expect(t[0].slice(0, 4)).toEqual(['Entry Number', 'Status', 'Created', 'Updated']);
    const emailCol = t[0].indexOf('Email');
    expect(t[1][emailCol]).toBe('(protected)');
    expect(exportTable(sp, rows, 'Africa/Johannesburg', true)[1][emailCol]).toBe('c@example.invalid');
    const csv = toCsv(t);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv.startsWith('﻿')).toBe(true);
  });

  it('inspection export includes one column per checklist item', () => {
    const sp = spec('trailer-inspection-checklist');
    const t = exportTable(sp, [{ number: 1, status: 'Submitted', createdAt: '2026-10-29T08:00:00Z', updatedAt: '2026-10-29T08:00:00Z',
      data: { checklist: [{ itemNo: 1, label: 'x', pass: true, fail: false, comments: 'ok' }] } }], 'UTC', true);
    expect(t[0]).toContain('1. Chassis inspected for weld quality, damage, cracks and overall finish.');
    expect(t[1]).toContain('Pass / ok');
  });
});

describe('misc rules', () => {
  it('masks ID numbers to the last four characters', () => {
    expect(maskId('0000000000123')).toBe('*********0123');
    expect(maskId('12')).toBe('****');
  });

  it('upload ticket requests are limited per field', () => {
    const rfi = spec('request-for-invoice');
    expect(validateUploadRequest(rfi, 'Nope', [{ name: 'a', size: 1, type: 'x' }])).toEqual({ ok: false, error: 'Unknown file field.' });
    expect(validateUploadRequest(rfi, 'QuoteNo', [{ name: 'a', size: 1, type: 'x' }])).toEqual({ ok: false, error: 'Unknown file field.' });
    expect(validateUploadRequest(rfi, '_1stDeposit', Array(6).fill({ name: 'a', size: 1, type: 'x' }))).toMatchObject({ ok: false });
    expect(validateUploadRequest(rfi, '_1stDeposit', [{ name: 'a', size: 21 * 1024 * 1024, type: 'x' }])).toMatchObject({ ok: false });
    expect(validateUploadRequest(spec('delivery-note'), 'Pic1FRONT', [{ name: 'a.pdf', size: 10, type: 'application/pdf' }])).toMatchObject({ ok: false });
    expect(validateUploadRequest(rfi, '_1stDeposit', [{ name: 'a.pdf', size: 10, type: 'application/pdf' }])).toMatchObject({ ok: true });
  });
});

import { formatMoney, searchTerm } from '@/lib/admin/format';
describe('format', () => {
  it('money carries its own currency', () => {
    expect(formatMoney(1150, 'ZAR')).toMatch(/R\s?1\s?150,00/);
    expect(formatMoney(null, 'ZAR')).toBe('');
    expect(formatMoney('12.5', null)).toMatch(/12,50/);
  });
  it('search terms cannot break out of a PostgREST filter', () => {
    expect(searchTerm('QU-1,status.eq.PAID)')).toBe('QU-1 status.eq.PAID');
    expect(searchTerm('   ')).toBeNull();
  });
});
