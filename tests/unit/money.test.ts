import { describe, expect, it } from 'vitest';
import { approxUsd, currencyCode, formatAmount, formatUsd, formatZar, NO_AMOUNT, toAmount } from '@/lib/money/fx';

describe('money formatting', () => {
  it('formats ZAR as the design shows', () => {
    expect(formatZar(486750)).toBe('R 486,750.00');
    expect(formatZar('412000')).toBe('R 412,000.00');
    expect(formatZar(74750.5)).toBe('R 74,750.50');
    expect(formatZar(0)).toBe('R 0.00');
  });
  it('formats USD as the design shows', () => {
    expect(formatUsd(26450)).toBe('$26,450.00');
    expect(formatUsd('1234567.891')).toBe('$1,234,567.89');
  });
  it('puts the sign in front and never prints -0.00', () => {
    expect(formatZar(-1500)).toBe('-R 1,500.00');
    expect(formatUsd(-0.001)).toBe('$0.00');
  });
  it('shows a dash for missing or non-numeric amounts', () => {
    for (const v of [null, undefined, '', '   ', 'abc']) {
      expect(formatZar(v)).toBe(NO_AMOUNT);
      expect(formatUsd(v)).toBe(NO_AMOUNT);
      expect(formatAmount(v, 'EUR')).toBe(NO_AMOUNT);
    }
  });
  it('formats by currency code', () => {
    expect(formatAmount(10, 'zar')).toBe('R 10.00');
    expect(formatAmount(10, 'USD')).toBe('$10.00');
    expect(formatAmount(1250, 'EUR')).toBe('EUR 1,250.00');
    // Xero data is ZAR: an unknown code falls back to ZAR rather than guessing another currency.
    expect(formatAmount(10, null)).toBe('R 10.00');
  });
  it('parses amounts and currency codes', () => {
    expect(toAmount('486750.00')).toBe(486750);
    expect(toAmount(Number.NaN)).toBeNull();
    expect(toAmount(Number.POSITIVE_INFINITY)).toBeNull();
    expect(currencyCode(' usd ')).toBe('USD');
    expect(currencyCode('rand')).toBe('ZAR');
    expect(currencyCode('', '')).toBe('');
  });
});

describe('approxUsd', () => {
  it('converts ZAR with a positive rate (USD per ZAR), rounded to cents', () => {
    expect(approxUsd(486750, 'ZAR', 0.05434)).toBe(26450.0);
    expect(approxUsd('100', 'zar', 0.0555)).toBe(5.55);
  });
  it('is null unless the currency is ZAR', () => {
    expect(approxUsd(100, 'USD', 0.05)).toBeNull();
    expect(approxUsd(100, 'EUR', 0.05)).toBeNull();
    expect(approxUsd(100, null, 0.05)).toBeNull();
    expect(approxUsd(100, 'rand', 0.05)).toBeNull();
  });
  it('is null without a usable rate (no invented rates)', () => {
    for (const rate of [null, undefined, 0, -0.05, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(approxUsd(100, 'ZAR', rate)).toBeNull();
    }
  });
  it('is null for a missing amount', () => {
    expect(approxUsd(null, 'ZAR', 0.05)).toBeNull();
    expect(approxUsd('', 'ZAR', 0.05)).toBeNull();
  });
});
