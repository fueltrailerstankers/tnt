import { describe, expect, it } from 'vitest';
import {
  ACCESSORY_FIELDS, dealQuery, dispatchHref, dispatchRpcArgs, errorField, fieldMessage, findOutcome, isIsoDate, modelOptionLabel,
  moveOfferLabel, parseDispatch, savedNotice, savedUrl, vinCheck, type FoundDealRow,
} from '@/lib/stock/dispatch';
import {
  DEALS_COPY, dealsHref, DismissInput, outstandingFooter, parseDealsQuery, permissionLine, RestoreInput, yearOptions,
} from '@/lib/stock/deals-view';
import { parseStockError, STOCK_COPY } from '@/lib/stock/errors';

// Synthetic VINs and deals only.
const ORG = '00000000-0000-0000-0000-000000000001';
const VIN = 'SAMPLEVIN0000260';
const names: Record<string, string> = { FACTORY: 'Factory', JHB: 'Johannesburg', CPT: 'Cape Town', DBN: 'Durban' };
const locationName = (id: string) => names[id];

const form = (over: Record<string, string> = {}) => ({
  mode: 'free', model: '1000DB', vin: ` ${VIN.toLowerCase()} `, location: 'CPT', dispatch_date: '2026-03-12', notes: '', ...over,
});

describe('parseDispatch', () => {
  it('normalises a free dispatch (VIN, model, accessories, notes)', () => {
    const r = parseDispatch(form({ model: ' 1000 db', accessory_1: ' Sample hose reel ', accessory_3: 'Spare wheel', accessory_2: '  ', notes: '  ' }));
    expect(r).toEqual({
      ok: true,
      value: {
        mode: 'free', dealYear: null, dealNumber: null, model: '1000DB', vin: VIN, location: 'CPT', dispatchDate: '2026-03-12',
        accessories: ['Sample hose reel', 'Spare wheel'], notes: null,
      },
    });
  });

  it('ignores deal fields in free mode and requires both in deal mode', () => {
    expect(parseDispatch(form({ deal_year: '2026', deal_number: '260' }))).toMatchObject({ ok: true, value: { dealYear: null, dealNumber: null } });
    expect(parseDispatch(form({ mode: 'deal', deal_year: '2026', deal_number: '260' }))).toMatchObject({ ok: true, value: { mode: 'deal', dealYear: 2026, dealNumber: 260 } });
    for (const over of [{ deal_year: '2026', deal_number: '' }, { deal_year: '', deal_number: '260' }, { deal_year: '1999', deal_number: '260' }, { deal_year: '2026', deal_number: '0' }, { deal_year: '2026', deal_number: '2.5' }]) {
      expect(parseDispatch(form({ mode: 'deal', ...over }))).toEqual({ ok: false, field: 'deal', message: 'Enter both the deal year and the sequence number.' });
    }
  });

  it('places each invalid field with the same copy as the RPC errors', () => {
    expect(parseDispatch(form({ vin: 'AB 1' }))).toEqual({ ok: false, field: 'vin', message: 'Enter the full VIN.' });
    expect(parseDispatch(form({ model: '' }))).toEqual({ ok: false, field: 'model', message: 'Choose a model from the list.' });
    expect(parseDispatch(form({ location: '' }))).toEqual({ ok: false, field: 'location', message: 'Choose a destination branch.' });
    expect(parseDispatch(form({ location: 'cpt; drop' }))).toMatchObject({ ok: false, field: 'location' });
    expect(parseDispatch(form({ dispatch_date: '2026-02-30' }))).toEqual({ ok: false, field: 'dispatch_date', message: 'Enter a valid dispatch date.' });
    expect(parseDispatch(form({ accessory_1: 'x'.repeat(201) }))).toMatchObject({ ok: false, field: 'accessories' });
    expect(parseDispatch(form({ notes: 'x'.repeat(2001) }))).toEqual({ ok: false, field: 'notes', message: 'Notes are too long (2000 characters at most).' });
    expect(parseDispatch(form({ mode: 'other' }))).toMatchObject({ ok: false, field: 'mode' });
  });

  it('reads exactly ten accessory lines', () => {
    expect(ACCESSORY_FIELDS).toHaveLength(10);
    const all = Object.fromEntries(ACCESSORY_FIELDS.map((k, i) => [k, `Line ${i + 1}`]));
    const r = parseDispatch(form({ ...all, accessory_11: 'ignored' }));
    expect(r.ok && r.value.accessories).toEqual(Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`));
  });

  it('maps to the stock_dispatch_unit arguments', () => {
    const r = parseDispatch(form({ mode: 'deal', deal_year: '2026', deal_number: '260', accessory_1: 'Reel' }));
    if (!r.ok) throw new Error('expected ok');
    expect(dispatchRpcArgs(ORG, r.value)).toEqual({
      p_org: ORG, p_vin: VIN, p_model: '1000DB', p_location: 'CPT', p_date: '2026-03-12', p_accessories: ['Reel'], p_notes: null,
      p_deal_year: 2026, p_deal_number: 260,
    });
  });
});

describe('isIsoDate and dealQuery', () => {
  it('accepts real calendar dates only', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
    for (const s of ['2026-02-29', '2026-13-01', '26-01-01', '2026-1-1', '', '1999-12-31']) expect(isIsoDate(s)).toBe(false);
  });

  it('reads ?year=&number= or nothing', () => {
    expect(dealQuery('2026', '260')).toEqual({ year: 2026, number: 260 });
    expect(dealQuery(['2026', '2025'], ['260'])).toEqual({ year: 2026, number: 260 });
    for (const [y, n] of [['2026', undefined], [undefined, '260'], ['26', '260'], ['2026', '0'], ['2026', 'x'], ['1999', '1']] as const) expect(dealQuery(y, n)).toBeNull();
  });
});

describe('findOutcome (Find unit)', () => {
  const deal = (over: Partial<FoundDealRow> = {}): FoundDealRow => ({
    year: 2026, number: 260, status: 'awaiting_dispatch', model_part: '1000DB', location_id: 'CPT', accessories: ['Sample hose reel'], quote_number: 'SAMPLE-Q-260', ...over,
  });

  it('found and outstanding: the stock plan message and the prefill', () => {
    expect(findOutcome(2026, 260, deal(), { locationName })).toEqual({
      kind: 'found',
      message: 'Deal 2026 / 260 · 1000DB · Cape Town. Add or confirm the VIN and destination.',
      deal: { year: 2026, number: 260, model: '1000DB', location: 'CPT', accessories: ['Sample hose reel'], quoteNumber: 'SAMPLE-Q-260' },
    });
  });

  it('found with an unknown model or branch says so', () => {
    const r = findOutcome(2026, 260, deal({ model_part: null, location_id: null, accessories: null }), { locationName });
    expect(r).toMatchObject({ kind: 'found', message: 'Deal 2026 / 260 · Model not recognised · No branch. Add or confirm the VIN and destination.' });
    expect(r.kind === 'found' && r.deal.accessories).toEqual([]);
  });

  it('dismissed, already dispatched and not found block with the exact copy', () => {
    expect(findOutcome(2026, 260, deal({ status: 'dismissed' }))).toEqual({
      kind: 'dismissed', year: 2026, number: 260, message: 'This deal has been dismissed. Only an admin can restore it before dispatch.',
    });
    expect(findOutcome(2026, 260, deal({ status: 'dispatched' }), { unitVin: VIN })).toEqual({
      kind: 'dispatched', year: 2026, number: 260, message: `Deal 2026/260 was already dispatched with VIN ${VIN}.`,
    });
    expect(findOutcome(2026, 260, deal({ status: 'dispatched' })).message).toBe('Deal 2026/260 was already dispatched.');
    expect(findOutcome(2026, 999, null)).toEqual({ kind: 'not_found', year: 2026, number: 999, message: 'No matching deal for this year and number.' });
  });
});

describe('errorField', () => {
  it('puts VIN errors under the VIN, deal errors under Find unit, the rest on their field', () => {
    const at = (message: string, detail: Record<string, unknown> = {}) => errorField(parseStockError({ message, details: JSON.stringify(detail), hint: 'stock' })!);
    expect(at('VIN_EXISTS')).toBe('vin');
    expect(at('FACTORY_UNIT_EXISTS')).toBe('vin');
    expect(at('DEAL_NOT_FOUND')).toBe('deal');
    expect(at('DEAL_DISMISSED')).toBe('deal');
    expect(at('DEAL_ALREADY_DISPATCHED')).toBe('deal');
    expect(at('MODEL_NOT_FOUND')).toBe('model');
    expect(at('LOCATION_NOT_FOUND')).toBe('location');
    expect(at('INVALID_INPUT', { field: 'location', reason: 'factory_with_deal' })).toBe('location');
    expect(at('INVALID_INPUT', { field: 'accessories' })).toBe('accessories');
    expect(at('INVALID_INPUT', { field: 'whatever' })).toBe('form');
    expect(at('FORBIDDEN')).toBe('form');
    expect(fieldMessage('form')).toBe('Check the values and try again.');
  });
});

describe('vinCheck (on blur)', () => {
  const unit = { vin_norm: VIN, model_part: '2500D', sequence: 248, location_id: 'JHB', status: 'sold' };

  it('no unit: nothing to say', () => {
    expect(vinCheck(null, false, locationName)).toBeNull();
  });

  it('any existing unit, sold included: the duplicate copy from the stock plan', () => {
    expect(vinCheck(unit, false, locationName)).toEqual({
      tone: 'error', message: 'VIN already used — 2500D; sequence 248; Johannesburg; Sold. Open the existing record instead.',
    });
    expect(vinCheck({ ...unit, location_id: 'FACTORY', status: 'sold' }, true, locationName)?.tone).toBe('error');
  });

  it('an unsold unit at the Factory: a note that it can be moved', () => {
    expect(vinCheck({ ...unit, location_id: 'FACTORY', status: 'available', sequence: null }, true, locationName)).toEqual({
      tone: 'info', message: 'This VIN is already registered at the Factory. Choose a destination branch to move it.',
    });
  });
});

describe('labels, links and notices', () => {
  it('formats the model option, move offer and links', () => {
    expect(modelOptionLabel('1000DB', '1000 litre metal bowser')).toBe('1000DB — 1000 litre metal bowser');
    expect(moveOfferLabel('Cape Town')).toBe('Move this factory unit to Cape Town');
    expect(dispatchHref(2026, 260)).toBe('/admin/stock/dispatch?year=2026&number=260');
    expect(savedUrl(VIN, 'dispatch')).toBe(`/admin/stock/units?q=${VIN}&saved=dispatch`);
    expect(savedNotice('dispatch')).toBe(STOCK_COPY.dispatchSaved);
    expect(savedNotice(['move'])).toBe('Factory unit moved to its branch.');
    expect(savedNotice('other')).toBeNull();
    expect(savedNotice(undefined)).toBeNull();
  });
});

describe('deals page query and copy', () => {
  const BRANCHES = ['JHB', 'CPT', 'DBN'];

  it('parses filters with safe fallbacks', () => {
    expect(parseDealsQuery({}, 2026, BRANCHES)).toEqual({ year: 2026, branch: null, dismissed: false, page: 1 });
    expect(parseDealsQuery({ year: '2025', branch: 'cpt', dismissed: '1', page: '3' }, 2026, BRANCHES)).toEqual({ year: 2025, branch: 'CPT', dismissed: true, page: 3 });
    expect(parseDealsQuery({ year: 'x', branch: 'FACTORY', dismissed: 'yes', page: '-1' }, 2026, BRANCHES)).toEqual({ year: 2026, branch: null, dismissed: false, page: 1 });
  });

  it('builds links that leave defaults out', () => {
    const q = parseDealsQuery({ year: '2025', branch: 'CPT' }, 2026, BRANCHES);
    expect(dealsHref(q, 2026)).toBe('/admin/stock/deals?year=2025&branch=CPT');
    expect(dealsHref(q, 2026, { year: 2026, branch: null })).toBe('/admin/stock/deals');
    expect(dealsHref(q, 2026, { page: 2, dismissed: true })).toBe('/admin/stock/deals?year=2025&branch=CPT&dismissed=1&page=2');
  });

  it('offers every year from the oldest deal to this year, newest first', () => {
    expect(yearOptions(2024, 2026, 2026, 2026)).toEqual([2026, 2025, 2024]);
    expect(yearOptions(null, null, 2026, 2026)).toEqual([2026]);
    expect(yearOptions(null, null, 2026, 2023)).toEqual([2026, 2025, 2024, 2023]);
  });

  it('uses the stock plan copy', () => {
    expect(outstandingFooter(1)).toBe('1 outstanding deal · Dispatches without a deal number do not clear this list.');
    expect(outstandingFooter(3)).toBe('3 outstanding deals · Dispatches without a deal number do not clear this list.');
    expect(permissionLine(false)).toBe('View access · Only an admin can dismiss or restore deals.');
    expect(DEALS_COPY.kpiSub(2026)).toBe('Awaiting dispatch · 2026');
  });

  it('requires a dismissal reason of at most 200 characters', () => {
    const deal_id = '00000000-0000-0000-0000-00000000de01';
    expect(DismissInput.safeParse({ deal_id, reason: ' SENT 26/03 ' }).data).toEqual({ deal_id, reason: 'SENT 26/03' });
    expect(DismissInput.safeParse({ deal_id, reason: '   ' }).success).toBe(false);
    expect(DismissInput.safeParse({ deal_id, reason: 'x'.repeat(201) }).success).toBe(false);
    expect(DismissInput.safeParse({ deal_id: 'nope', reason: 'x' }).success).toBe(false);
    expect(RestoreInput.safeParse({ deal_id }).success).toBe(true);
  });
});
