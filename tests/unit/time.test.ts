import { describe, expect, it } from 'vitest';
import { clock, dayTime, longDate, longDateTime, sastClock, shortDateTime } from '@/lib/ui/time';

// SAST is UTC+2 all year. 07:14Z is 09:14 SAST.
const NOW = '2026-10-29T10:00:00Z';

describe('SAST clock', () => {
  it('shows HH:MM SAST in Africa/Johannesburg', () => {
    expect(sastClock('2026-10-29T07:14:00Z')).toBe('09:14 SAST');
    expect(clock('2026-10-29T07:14:00Z')).toBe('09:14');
  });
  it('uses a 24-hour clock with leading zeros', () => {
    expect(sastClock('2026-10-28T22:05:00Z')).toBe('00:05 SAST');
    expect(sastClock('2026-10-29T13:31:00Z')).toBe('15:31 SAST');
  });
  it('accepts Date and epoch input', () => {
    expect(sastClock(new Date('2026-10-29T07:14:00Z'))).toBe('09:14 SAST');
    expect(sastClock(Date.parse('2026-10-29T07:14:00Z'))).toBe('09:14 SAST');
  });
  it('is empty for missing or invalid input', () => {
    expect(sastClock(null)).toBe('');
    expect(sastClock(undefined)).toBe('');
    expect(sastClock('')).toBe('');
    expect(sastClock('not a date')).toBe('');
  });
});

describe('dayTime', () => {
  it('says Today for the same SAST day', () => {
    expect(dayTime('2026-10-29T07:14:00Z', NOW)).toBe('Today 09:14');
  });
  it('uses the SAST calendar day, not the UTC one', () => {
    // 22:30Z on the 28th is 00:30 on the 29th in SAST.
    expect(dayTime('2026-10-28T22:30:00Z', NOW)).toBe('Today 00:30');
    // 21:59Z on the 28th is still the 28th in SAST.
    expect(dayTime('2026-10-28T21:59:00Z', NOW)).toBe('Yesterday 23:59');
  });
  it('says Yesterday for the previous day', () => {
    expect(dayTime('2026-10-28T13:40:00Z', NOW)).toBe('Yesterday 15:40');
  });
  it('shows the date for older days in the same year', () => {
    expect(dayTime('2026-10-27T13:40:00Z', NOW)).toBe('27 Oct 15:40');
    expect(dayTime('2026-09-03T06:00:00Z', NOW)).toBe('3 Sep 08:00');
  });
  it('adds the year when it differs', () => {
    expect(dayTime('2025-10-27T13:40:00Z', NOW)).toBe('27 Oct 2025 15:40');
  });
  it('handles a year boundary', () => {
    expect(dayTime('2026-12-31T20:00:00Z', '2027-01-01T08:00:00Z')).toBe('Yesterday 22:00');
  });
  it('uses the date for future days and for a bad "now"', () => {
    expect(dayTime('2026-10-30T07:14:00Z', NOW)).toBe('30 Oct 09:14');
    expect(dayTime('2026-10-29T07:14:00Z', 'nope')).toBe('29 Oct 09:14');
    expect(dayTime(null, NOW)).toBe('');
  });
});

describe('date formats', () => {
  it('formats table, long date and long date-time', () => {
    expect(shortDateTime('2026-10-29T07:14:00Z')).toBe('29 Oct, 09:14');
    expect(longDate('2026-10-29T12:31:00Z')).toBe('29 Oct 2026');
    expect(longDateTime('2026-10-29T12:31:00Z')).toBe('29 Oct 2026, 14:31 SAST');
  });
  it('rolls the date over at SAST midnight', () => {
    expect(longDate('2026-12-31T22:00:00Z')).toBe('1 Jan 2027');
  });
  it('is empty for missing input', () => {
    expect(shortDateTime(null)).toBe('');
    expect(longDate(undefined)).toBe('');
    expect(longDateTime('x')).toBe('');
  });
});
