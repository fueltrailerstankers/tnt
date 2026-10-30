import { describe, expect, it } from 'vitest';
import { livePhrase, typedMatches } from '@/lib/ui/confirm';
import { initials } from '@/lib/ui/initials';
import { maskEmail, maskId, maskValue } from '@/lib/ui/mask';
import { clampPage, pageCount, pageRange } from '@/lib/ui/pagination';
import { changedFieldNames, timelineItem, timelineText, type EntryEventRow } from '@/lib/ui/timeline';

describe('typed confirmation', () => {
  it('matches only the exact phrase', () => {
    const phrase = livePhrase('createInvoiceFromQuote');
    expect(phrase).toBe('LIVE createInvoiceFromQuote');
    expect(typedMatches('LIVE createInvoiceFromQuote', phrase)).toBe(true);
  });
  it('rejects anything that is not exact: case, spacing, partial or padded text', () => {
    const phrase = livePhrase('createInvoiceFromQuote');
    for (const typed of [
      'LIVE createInvoiceFrom',
      'live createInvoiceFromQuote',
      'LIVE createinvoicefromquote',
      'LIVE  createInvoiceFromQuote',
      ' LIVE createInvoiceFromQuote',
      'LIVE createInvoiceFromQuote ',
      'LIVE createInvoiceFromQuote\n',
      'LIVE createInvoiceFromQuotes',
      'createInvoiceFromQuote',
      '',
    ]) {
      expect(typedMatches(typed, phrase), typed).toBe(false);
    }
    expect(typedMatches(null, phrase)).toBe(false);
    expect(typedMatches(undefined, phrase)).toBe(false);
  });
  it('never matches a blank phrase', () => {
    expect(typedMatches('', '')).toBe(false);
    expect(typedMatches('  ', '  ')).toBe(false);
  });
});

describe('masks', () => {
  it('masks ID numbers to a fixed shape with the last two characters', () => {
    expect(maskId('SAMPLE-ID-0087')).toBe('•••••• •••• •87');
    expect(maskId('1234567890187')).toBe('•••••• •••• •87');
    // Length is not leaked.
    expect(maskId('AB1234587')).toHaveLength(maskId('1234567890123487').length);
    expect(maskId('12345')).toBe('••••••');
    expect(maskId('')).toBe('');
    expect(maskId(null)).toBe('');
  });
  it('masks emails keeping first/last local character and the domain', () => {
    expect(maskEmail('inspector.a@example.com')).toBe('i•••••••••a@example.com');
    expect(maskEmail('abc@example.com')).toBe('a•••••••••c@example.com');
    expect(maskEmail('ab@example.com')).toBe('a••••••••••@example.com');
    expect(maskEmail('a@example.com')).toBe('•••••••••••@example.com');
    // The masked local part has the same length whatever the real one is.
    const lengths = ['a', 'ab', 'abc', 'inspector.a', 'a.very.long.local.part'].map((l) => maskEmail(`${l}@example.com`).length);
    expect(new Set(lengths).size).toBe(1);
    expect(maskEmail('not-an-email')).toBe('••••••');
    expect(maskEmail('@example.com')).toBe('••••••');
  });
  it('never returns the clear value', () => {
    for (const v of ['SAMPLE-ID-0001', 'inspector.a@example.com', 'secret']) {
      for (const kind of ['id', 'email', 'text'] as const) expect(maskValue(v, kind)).not.toBe(v);
    }
    expect(maskValue('', 'text')).toBe('');
  });
});

describe('pagination', () => {
  it('counts pages, at least one', () => {
    expect(pageCount(214, 50)).toBe(5);
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(10, 0)).toBe(1);
  });
  it('clamps pages', () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(9, 5)).toBe(5);
    expect(clampPage(Number.NaN, 5)).toBe(1);
    expect(clampPage(2.7, 5)).toBe(2);
  });
  it('gives the row range for "Showing a–b of n"', () => {
    expect(pageRange(1, 50, 214)).toEqual({ from: 1, to: 50 });
    expect(pageRange(5, 50, 214)).toEqual({ from: 201, to: 214 });
    expect(pageRange(9, 50, 214)).toEqual({ from: 201, to: 214 });
    expect(pageRange(1, 50, 0)).toEqual({ from: 0, to: 0 });
  });
});

describe('initials', () => {
  it('uses first and last name, or the fallback', () => {
    expect(initials('Inspector A. Demo', 'admin')).toBe('ID');
    expect(initials('  thandi  ', 'admin')).toBe('T');
    expect(initials(null, 'admin')).toBe('AD');
    expect(initials('', 'staff')).toBe('ST');
  });
});

describe('timeline', () => {
  const row = (over: Partial<EntryEventRow>): EntryEventRow => ({
    id: 'e1', action: 'Submit', from_status: null, to_status: 'Submitted', actor_user: 'u1', actor_role: 'inspector',
    diff: { changed: [] }, created_at: '2026-10-29T07:14:00Z', ...over,
  });

  it('maps changed keys to labels and drops anything else in the diff', () => {
    const diff = { changed: ['vin', 'notes', 'vin', 42, ''], before: { vin: 'TT9DEMO24D0010482' }, values: ['secret'] };
    expect(changedFieldNames(diff, { vin: 'VIN', notes: 'Notes' })).toEqual(['VIN', 'Notes']);
    expect(changedFieldNames(null)).toEqual([]);
    expect(changedFieldNames({ changed: 'vin' })).toEqual([]);
  });

  it('never carries field values into the item', () => {
    const item = timelineItem(
      row({ from_status: 'Submitted', to_status: 'Submitted', action: 'Edit', diff: { changed: ['vin'], before: { vin: 'TT9DEMO24D0010482' }, after: { vin: 'TT9DEMO24D0010477' } } }),
      { labels: { vin: 'VIN' } },
    );
    const text = JSON.stringify(item) + timelineText(item);
    expect(text).not.toContain('TT9DEMO24D0010482');
    expect(text).not.toContain('TT9DEMO24D0010477');
    expect(timelineText(item)).toBe('changed fields: VIN');
    expect(item.tone).toBe('neutral');
  });

  it('describes submission and status changes with tones', () => {
    const names = { u1: 'Inspector A. Demo' };
    const submitted = timelineItem(row({}), { names });
    expect(submitted).toMatchObject({ who: 'Inspector A. Demo', what: 'submitted the entry', tone: 'teal' });

    const reviewed = timelineItem(row({ action: 'Mark Reviewed', from_status: 'Submitted', to_status: 'Reviewed', diff: { changed: ['review_notes'] } }), { names, labels: { review_notes: 'Review notes' } });
    expect(timelineText(reviewed)).toBe('changed status Submitted → Reviewed · changed fields: Review notes');
    expect(reviewed.tone).toBe('yellow');

    expect(timelineItem(row({ from_status: 'Reviewed', to_status: 'Approved' })).tone).toBe('green');
    expect(timelineItem(row({ from_status: 'Reviewed', to_status: 'Changes requested' })).tone).toBe('red');
    expect(timelineItem(row({ to_status: 'Incomplete' })).what).toBe('created the entry as Incomplete');
  });

  it('names the actor: profile name, then System, then the role', () => {
    expect(timelineItem(row({ actor_user: null, actor_role: 'System' })).who).toBe('System');
    expect(timelineItem(row({ actor_user: 'u9', actor_role: 'reviewer' })).who).toBe('Reviewer');
    expect(timelineItem(row({ actor_user: null, actor_role: null })).who).toBe('Someone');
  });

  it('falls back to the action name when nothing changed', () => {
    const item = timelineItem(row({ action: 'Resend Link', from_status: 'Submitted', to_status: 'Submitted' }));
    expect(timelineText(item)).toBe('resend link');
  });
});
