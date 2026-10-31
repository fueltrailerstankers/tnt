import { describe, expect, it } from 'vitest';
import {
  DRAFT_MAX_CHARS, DRAFT_MAX_VALUE, DRAFT_PREFIX, DRAFT_TTL_MS, draftAge, draftAllowed, draftKey, parseDraft, pickDraftValues, readDraftRaw,
  removeDraft, restoredData, sameValues, serializeDraft, sweepDrafts, writeDraft, type DraftStorage,
} from '@/lib/forms/draft';
import type { FormSpec } from '@/lib/spec/types';
import { spec } from './specs';

const NOW = Date.UTC(2026, 9, 31, 10, 0, 0);

/** job-card plus fields that must never be kept, to exercise the filters. */
function mixed(): FormSpec {
  const s = spec('job-card');
  const extra = [
    { name: 'Contact', label: 'Contact', type: 'email', protected: true, row: 90, col: 1, span: 24 },
    { name: 'Plain', label: 'Plain', type: 'email', row: 91, col: 1, span: 24 },
    { name: 'Photos', label: 'Photos', type: 'file', row: 92, col: 1, span: 24 },
    { name: 'Sign', label: 'Sign', type: 'signature', row: 93, col: 1, span: 24 },
    { name: 'Password', label: 'Password', type: 'text', row: 94, col: 1, span: 24 },
    { name: 'Office', label: 'Office', type: 'text', readOnly: true, row: 95, col: 1, span: 24 },
    { name: 'Who', label: 'Who', type: 'name', parts: ['First', 'Last'], row: 96, col: 1, span: 24 },
    { name: 'Kind', label: 'Kind', type: 'choice', style: 'radio', options: ['A', 'B'], other: true, row: 97, col: 1, span: 24 },
  ];
  return { ...s, fields: [...s.fields, ...extra] } as unknown as FormSpec;
}

function memStorage(init: Record<string, string> = {}): DraftStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
  };
}

const throwing: DraftStorage = {
  get length(): number { throw new Error('blocked'); },
  key: () => { throw new Error('blocked'); },
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('quota'); },
  removeItem: () => { throw new Error('blocked'); },
};

describe('draft keys', () => {
  it('derives one key per audience, form and scope', () => {
    const s = spec('job-card');
    expect(draftKey(s, 'staff', { kind: 'new' })).toBe(`${DRAFT_PREFIX}staff:job-card:new`);
    expect(draftKey(s, 'staff', { kind: 'entry', number: 12 })).toBe(`${DRAFT_PREFIX}staff:job-card:entry:12`);
    expect(draftKey(s, 'public', { kind: 'link', number: 7 })).toBe(`${DRAFT_PREFIX}public:job-card:link:7`);
    expect(draftKey(s, 'staff', { kind: 'entry', number: 0 })).toBeNull();
    expect(draftKey(s, 'staff', { kind: 'entry', number: 1.5 })).toBeNull();
  });

  it('never autosaves encrypted forms (DEAL, Delivery Note, or the spec flag)', () => {
    expect(draftAllowed(spec('deal'))).toBe(false);
    expect(draftAllowed(spec('delivery-note'))).toBe(false);
    expect(draftKey(spec('deal'), 'staff', { kind: 'new' })).toBeNull();
    expect(draftKey(spec('delivery-note'), 'public', { kind: 'new' })).toBeNull();
    const flagged = { ...spec('job-card'), settings: { ...spec('job-card').settings, encryptEntries: true } };
    expect(draftAllowed(flagged)).toBe(false);
    expect(pickDraftValues(spec('deal'), [['f.QuoteNo', 'Q-1']], 'staff')).toEqual([]);
    expect(draftAllowed(spec('job-card'))).toBe(true);
  });
});

describe('which values are kept', () => {
  it('keeps typed field values and drops signatures, files, protected, locked, secrets and hidden inputs', () => {
    const s = mixed();
    const posted: Array<[string, unknown]> = [
      ['f.QuoteNo', 'Q-100'], ['f.Plain', 'a@example.invalid'], ['f.Contact', 'hidden@example.invalid'],
      ['file.Photos', '[{"path":"staging/x"}]'], ['sig.Sign', 'data:image/png;base64,AAAA'], ['f.Password', 'hunter2'],
      ['f.Office', 'X'], ['f.Who.First', 'Test'], ['f.Who.Middle', 'no'], ['f.Kind', 'A'], ['f.Kind.other', 'Z'],
      ['cf-turnstile-response', 'tok'], ['__version', 'v1'], ['__action', 'Submit'], ['__hp', ''], ['f.Unknown', 'x'],
      ['f.Text', new Blob(['x'])], ['f.Text2', 'y'.repeat(DRAFT_MAX_VALUE + 1)], ['f.Text3', ''],
    ];
    expect(pickDraftValues(s, posted, 'staff')).toEqual([
      ['f.QuoteNo', 'Q-100'], ['f.Plain', 'a@example.invalid'], ['f.Office', 'X'], ['f.Who.First', 'Test'], ['f.Kind', 'A'], ['f.Kind.other', 'Z'], ['f.Text3', ''],
    ]);
    // The public role may not change readOnly fields: those are not kept for it.
    expect(pickDraftValues(s, [['f.Office', 'X'], ['f.QuoteNo', 'Q']], 'public')).toEqual([['f.QuoteNo', 'Q']]);
  });

  it('keeps checklist rows only for the checklist items of the form', () => {
    const s = spec('trailer-inspection-checklist');
    const v = pickDraftValues(s, [['cl.1.pass', 'on'], ['cl.1.comments', 'ok'], ['cl.999.pass', 'on'], ['cl.1.other', 'x'], ['sig.InspectorSignature', 'data:']], 'staff');
    expect(v).toEqual([['cl.1.pass', 'on'], ['cl.1.comments', 'ok']]);
  });

  it('compares values in order', () => {
    expect(sameValues([['a', '1']], [['a', '1']])).toBe(true);
    expect(sameValues([['a', '1']], [['a', '2']])).toBe(false);
    expect(sameValues([['a', '1']], [])).toBe(false);
  });
});

describe('stored drafts', () => {
  const s = spec('job-card');
  const values: Array<[string, string]> = [['f.QuoteNo', 'Q-1'], ['f.Text', 'Brakes']];

  it('round-trips and expires after 7 days', () => {
    const raw = serializeDraft({ values, savedAt: NOW, base: null });
    expect(parseDraft(raw, s, 'staff', { now: NOW + 1000, base: null })).toEqual({ values, savedAt: NOW, base: null });
    expect(parseDraft(raw, s, 'staff', { now: NOW + DRAFT_TTL_MS + 1, base: null })).toBeNull();
    expect(parseDraft(raw, s, 'staff', { now: NOW - 10 * 60_000, base: null })).toBeNull();
  });

  it('drops a draft saved against another version of the entry', () => {
    const raw = serializeDraft({ values, savedAt: NOW, base: '2026-10-30T10:00:00Z' });
    expect(parseDraft(raw, s, 'staff', { now: NOW, base: '2026-10-30T10:00:00Z' })).not.toBeNull();
    expect(parseDraft(raw, s, 'staff', { now: NOW, base: '2026-10-31T09:00:00Z' })).toBeNull();
  });

  it('rejects junk and filters values again with the current spec', () => {
    for (const raw of [null, '', 'not json', '[]', '{"v":2,"savedAt":1,"values":[]}', JSON.stringify({ v: 1, savedAt: NOW, values: 'x' })]) {
      expect(parseDraft(raw, s, 'staff', { now: NOW, base: null })).toBeNull();
    }
    const raw = JSON.stringify({ v: 1, savedAt: NOW, base: null, values: [['sig.X', 'data:'], ['f.QuoteNo', 'Q'], [1, 2], ['f.Text']] });
    expect(parseDraft(raw, s, 'staff', { now: NOW, base: null })?.values).toEqual([['f.QuoteNo', 'Q']]);
    expect(parseDraft(JSON.stringify({ v: 1, savedAt: NOW, base: null, values: [['sig.X', 'data:']] }), s, 'staff', { now: NOW, base: null })).toBeNull();
    // An encrypted form never reads a draft, even one planted under its name.
    expect(parseDraft(raw, spec('deal'), 'staff', { now: NOW, base: null })).toBeNull();
  });

  it('caps the size', () => {
    const big: Array<[string, string]> = Array.from({ length: 20 }, (_, i) => [`f.Text${i}`, 'x'.repeat(5000)]);
    expect(serializeDraft({ values: big, savedAt: NOW, base: null })).toBeNull();
    const st = memStorage({ k: 'old' });
    expect(writeDraft(st, 'k', { values: big, savedAt: NOW, base: null })).toBe(false);
    expect(st.data.has('k')).toBe(false);
    expect(parseDraft('x'.repeat(DRAFT_MAX_CHARS + 1), s, 'staff', { now: NOW, base: null })).toBeNull();
  });
});

describe('restore', () => {
  it('reads values with the form reader over the initial data', () => {
    const s = mixed();
    const initial = { QuoteNo: 'Q-OLD', Text4: 'kept', Text3: 'cleared later' };
    const out = restoredData(s, initial, [['f.QuoteNo', 'Q-NEW'], ['f.Text3', ''], ['f.Who.First', 'Test'], ['f.Plain', 'bad email']]);
    expect(out).toEqual({ QuoteNo: 'Q-NEW', Text4: 'kept', Who: { First: 'Test' }, Plain: 'bad email' });
  });

  it('restores the checklist rows', () => {
    const s = spec('trailer-inspection-checklist');
    const out = restoredData(s, {}, [['cl.1.pass', 'on'], ['cl.1.comments', 'ok']]);
    const rows = out.checklist as Array<{ itemNo: number; pass: boolean; comments: string }>;
    expect(rows[0]).toMatchObject({ itemNo: 1, pass: true, comments: 'ok' });
    expect(rows[1]).toMatchObject({ itemNo: 2, pass: false });
  });
});

describe('storage helpers', () => {
  it('never throw when storage is blocked or missing', () => {
    expect(readDraftRaw(throwing, 'k')).toBeNull();
    expect(writeDraft(throwing, 'k', { values: [['f.A', '1']], savedAt: NOW, base: null })).toBe(false);
    expect(() => removeDraft(throwing, 'k')).not.toThrow();
    expect(sweepDrafts(throwing, NOW)).toBe(0);
    expect(readDraftRaw(null, 'k')).toBeNull();
    expect(writeDraft(null, 'k', { values: [], savedAt: NOW, base: null })).toBe(false);
  });

  it('sweeps expired and unreadable drafts only', () => {
    const fresh = serializeDraft({ values: [['f.A', '1']], savedAt: NOW - 1000, base: null })!;
    const old = serializeDraft({ values: [['f.A', '1']], savedAt: NOW - DRAFT_TTL_MS - 1, base: null })!;
    const st = memStorage({ [`${DRAFT_PREFIX}a`]: fresh, [`${DRAFT_PREFIX}b`]: old, [`${DRAFT_PREFIX}c`]: 'junk', 'tt-theme': 'dark' });
    expect(sweepDrafts(st, NOW)).toBe(2);
    expect([...st.data.keys()].sort()).toEqual([`${DRAFT_PREFIX}a`, 'tt-theme']);
  });

  it('describes the age', () => {
    expect(draftAge(NOW, NOW + 10_000)).toBe('just now');
    expect(draftAge(NOW, NOW + 60_000)).toBe('1 minute ago');
    expect(draftAge(NOW, NOW + 3 * 3600_000)).toBe('3 hours ago');
    expect(draftAge(NOW, NOW + 2 * 86400_000)).toBe('2 days ago');
  });
});
