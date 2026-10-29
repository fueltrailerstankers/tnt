import { describe, expect, it } from 'vitest';
import {
  dealFoundMessage, EXCEPTION_REASON_LABEL, parseStockError, STOCK_ERROR_CODES, stockErrorMessage, stockMessageFor, unitStatusLabel,
} from '@/lib/stock/errors';
import { EXCEPTION_REASONS } from '@/lib/stock/invoice';

const pgrst = (code: string, detail: Record<string, unknown> = {}) => ({ code: 'P0001', message: code, details: JSON.stringify(detail), hint: 'stock' });
const names: Record<string, string> = { JHB: 'Johannesburg', CPT: 'Cape Town', DBN: 'Durban', FACTORY: 'Factory' };
const locationName = (id: string) => names[id];

describe('parseStockError', () => {
  it('reads PostgREST and node-postgres shapes', () => {
    expect(parseStockError(pgrst('DEAL_NOT_FOUND', { year: 2026, number: 1 }))).toEqual({ code: 'DEAL_NOT_FOUND', detail: { year: 2026, number: 1 } });
    expect(parseStockError({ message: 'VIN_EXISTS', detail: '{"vin":"X"}', hint: 'stock' })).toEqual({ code: 'VIN_EXISTS', detail: { vin: 'X' } });
  });
  it('ignores errors that are not stock RPC errors', () => {
    expect(parseStockError({ message: 'VIN_EXISTS' })).toBeNull();
    expect(parseStockError({ message: 'duplicate key value', hint: 'stock' })).toBeNull();
    expect(parseStockError(null)).toBeNull();
    expect(parseStockError('VIN_EXISTS')).toBeNull();
  });
  it('tolerates a bad detail payload', () => {
    expect(parseStockError({ message: 'FORBIDDEN', details: 'not json', hint: 'stock' })).toEqual({ code: 'FORBIDDEN', detail: {} });
  });
});

describe('stockErrorMessage', () => {
  const msg = (code: string, detail: Record<string, unknown> = {}) => stockMessageFor(pgrst(code, detail), { locationName });

  it('uses the stock plan copy for dispatch (5.4)', () => {
    expect(msg('VIN_EXISTS', { model: '2000S', sequence: 251, location: 'JHB', location_name: 'Johannesburg', status: 'sold' }))
      .toBe('VIN already used — 2000S; sequence 251; Johannesburg; Sold. Open the existing record instead.');
    expect(msg('VIN_EXISTS', { model: '2500D', sequence: null, location: 'FACTORY', status: 'available' }))
      .toBe('VIN already used — 2500D; sequence —; Factory; Available. Open the existing record instead.');
    expect(msg('DEAL_NOT_FOUND')).toBe('No matching deal for this year and number.');
    expect(msg('DEAL_DISMISSED')).toBe('This deal has been dismissed. Only an admin can restore it before dispatch.');
    expect(stockErrorMessage({ code: 'DEAL_DISMISSED', detail: {} }, { restorer: 'the stock admin' }))
      .toBe('This deal has been dismissed. Only the stock admin can restore it before dispatch.');
    expect(msg('DEAL_ALREADY_DISPATCHED', { year: 2026, number: 260, vin: 'TESTVIN00000000001' }))
      .toBe('Deal 2026/260 was already dispatched with VIN TESTVIN00000000001.');
    expect(msg('FACTORY_UNIT_EXISTS', { to: 'CPT' })).toBe('This VIN is already registered at the Factory. Move this factory unit to Cape Town instead.');
  });

  it('uses the stock plan copy for invoices (5.5)', () => {
    expect(msg('VIN_NOT_FOUND')).toBe('VIN not found. No stock record has been changed.');
    expect(msg('UNIT_LINKED_OTHER_INVOICE')).toBe('This unit is linked to another invoice. Review the conflict before proceeding.');
    expect(msg('INVOICE_LINKED_OTHER_UNIT')).toBe('This invoice is linked to another unit. Review the conflict before proceeding.');
  });

  it('has a message for every code and field, never raw database text', () => {
    for (const code of STOCK_ERROR_CODES) expect(msg(code)).toMatch(/\S/);
    expect(msg('INVALID_INPUT', { field: 'accessories', max: 10 })).toBe('Record up to 10 accessory lines of up to 200 characters each.');
    expect(msg('INVALID_INPUT', { field: 'deal', reason: 'unit_has_deal' })).toBe('This unit is already linked to a deal.');
    expect(msg('INVALID_INPUT', { field: 'location', reason: 'same_location' })).toBe('The unit is already at this location.');
    expect(msg('INVALID_INPUT', { field: 'whatever' })).toBe('Check the values and try again.');
    expect(stockMessageFor(new Error('relation "x" does not exist'))).toBe('Something went wrong. No stock record has been changed.');
  });
});

describe('copy helpers', () => {
  it('labels unit statuses and every exception reason', () => {
    expect(unitStatusLabel('reserved')).toBe('Reserved');
    expect(unitStatusLabel(null)).toBe('—');
    for (const r of EXCEPTION_REASONS) expect(EXCEPTION_REASON_LABEL[r]).toMatch(/\S/);
  });
  it('formats the Find unit success line', () => {
    expect(dealFoundMessage({ year: 2026, number: 260, model: '1000DB', branch: 'Cape Town' }))
      .toBe('Deal 2026 / 260 · 1000DB · Cape Town. Add or confirm the VIN and destination.');
    expect(dealFoundMessage({ year: 2026, number: 261, model: null, branch: null }))
      .toBe('Deal 2026 / 261 · Model not recognised · No branch. Add or confirm the VIN and destination.');
  });
});
