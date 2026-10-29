import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractVin, isValidVin, matchedVin, normalizeVin, VIN_STRIP_CLASS } from '@/lib/stock/vin';

// Synthetic VINs only.
const KNOWN = ['TESTVIN00000000001', 'TESTVIN00000000002', 'demo vin 000003'];

describe('normalizeVin', () => {
  it('upper-cases and removes every whitespace character', () => {
    expect(normalizeVin(' testvin 0000\t0001\n')).toBe('TESTVIN00000001');
    expect(normalizeVin('AbC-123')).toBe('ABC-123');
  });
  it('removes the invisible characters pasted VINs carry (NBSP, thin space, BOM, zero-width, direction marks)', () => {
    expect(normalizeVin('nbsp\u00a0test\u2009 12345')).toBe('NBSPTEST12345');
    expect(normalizeVin('\ufeffTESTVIN\u200b000\u200d1\u200e\u202f\u3000')).toBe('TESTVIN0001');
    expect(normalizeVin('\u00a0\ufeff')).toBeNull();
    // Visible punctuation stays.
    expect(normalizeVin('ab\u2010c-d/e')).toBe('AB\u2010C-D/E');
  });
  it('uses the same character class as the database (0011 stock_norm_vin)', () => {
    const sql = readFileSync(path.resolve(__dirname, '../../supabase/migrations/0011_stock.sql'), 'utf8');
    const fn = sql.slice(sql.indexOf('create or replace function public.stock_norm_vin'));
    const m = fn.match(/regexp_replace\(coalesce\(p, ''\), '([^']+)', '', 'g'\)/);
    expect(m?.[1]).toBe(VIN_STRIP_CLASS);
    // Every other VIN normalisation in 0011 goes through stock_norm_vin.
    expect(sql).not.toMatch(/regexp_replace\(coalesce\(p_(vin|reference)|regexp_replace\(vin,|p_fields ->> 'vin', ''\), '\\s'/);
  });
  it('returns null for empty or non-string input', () => {
    expect(normalizeVin('   ')).toBeNull();
    expect(normalizeVin('')).toBeNull();
    expect(normalizeVin(null)).toBeNull();
    expect(normalizeVin(undefined)).toBeNull();
  });
  it('validates the length bounds the database enforces', () => {
    expect(isValidVin('ABCD')).toBe(false);
    expect(isValidVin(' AB CDE ')).toBe(true);
    expect(isValidVin('X'.repeat(40))).toBe(true);
    expect(isValidVin('X'.repeat(41))).toBe(false);
    expect(isValidVin(null)).toBe(false);
  });
});

describe('extractVin', () => {
  it('prefers an exact normalised match', () => {
    expect(extractVin('testvin00000000001', KNOWN)).toEqual({ kind: 'exact', vin: 'TESTVIN00000000001' });
    expect(extractVin(' DEMO VIN 000003 ', KNOWN)).toEqual({ kind: 'exact', vin: 'DEMOVIN000003' });
    expect(extractVin('TESTVIN\u00a000000000001\ufeff', KNOWN)).toEqual({ kind: 'exact', vin: 'TESTVIN00000000001' });
  });
  it('falls back to the one known VIN contained in the reference', () => {
    expect(extractVin('Trailer TESTVIN 00000000002 deposit', KNOWN)).toEqual({ kind: 'contained', vin: 'TESTVIN00000000002' });
  });
  it('reports ambiguous when the reference contains more than one known VIN', () => {
    expect(extractVin('TESTVIN00000000001 / TESTVIN00000000002', KNOWN)).toEqual({
      kind: 'ambiguous', vins: ['TESTVIN00000000001', 'TESTVIN00000000002'],
    });
  });
  it('reports none and missing', () => {
    expect(extractVin('PO 12345', KNOWN)).toEqual({ kind: 'none' });
    expect(extractVin('  ', KNOWN)).toEqual({ kind: 'missing' });
    expect(extractVin(null, KNOWN)).toEqual({ kind: 'missing' });
    expect(extractVin('TESTVIN00000000001', [])).toEqual({ kind: 'none' });
  });
  it('matchedVin returns the VIN only for exact or contained matches', () => {
    expect(matchedVin({ kind: 'exact', vin: 'A' })).toBe('A');
    expect(matchedVin({ kind: 'contained', vin: 'B' })).toBe('B');
    expect(matchedVin({ kind: 'ambiguous', vins: ['A', 'B'] })).toBeNull();
    expect(matchedVin({ kind: 'none' })).toBeNull();
    expect(matchedVin({ kind: 'missing' })).toBeNull();
  });
});
