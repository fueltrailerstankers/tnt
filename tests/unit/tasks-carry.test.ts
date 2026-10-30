import { describe, expect, it } from 'vitest';
import { canonical, carryFormData } from '@/lib/tasks/carry';
import { inputFields } from '@/lib/spec/types';
import { readFormData } from '@/lib/spec/values';
import { fd, SLUGS, spec } from './specs';

// Synthetic values only. A transition from Tasks posts the entry's own values back through runAction; these tests
// prove that what runAction reads is exactly what is stored, and that every file and signature is kept.

const FILE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FILE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SIG = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LOOKUP = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** A filled form for any spec: one value per input field, as the renderer would post it. */
function filled(slug: string): Record<string, string | string[]> {
  const s = spec(slug);
  const v: Record<string, string | string[]> = {};
  for (const f of inputFields(s)) {
    const k = `f.${f.name}`;
    if (f.type === 'text' || f.type === 'textarea') v[k] = `Demo ${f.name}`;
    if (f.type === 'email') v[k] = 'demo@example.invalid';
    if (f.type === 'date') v[k] = '2026-10-29';
    if (f.type === 'number') v[k] = f.integer ? '7' : '7.5';
    if (f.type === 'choice') v[k] = f.multi ? [f.options[0], f.options[f.options.length - 1]] : f.options[0];
    if (f.type === 'lookup') v[k] = LOOKUP;
    if (f.type === 'name' || f.type === 'address') for (const p of f.parts) v[`${k}.${p}`] = `Demo ${p}`;
  }
  for (const it of s.checklist ?? []) {
    if (it.itemNo % 2) v[`cl.${it.itemNo}.pass`] = 'on';
    else {
      v[`cl.${it.itemNo}.fail`] = 'on';
      v[`cl.${it.itemNo}.comments`] = 'Loose bolt';
    }
  }
  return v;
}

describe('carryFormData', () => {
  it.each(SLUGS)('%s: the carried form reads back to exactly the stored data', (slug) => {
    const s = spec(slug);
    const stored = readFormData(s, fd(filled(slug))).data;
    expect(Object.keys(stored).length).toBeGreaterThan(0);
    const res = carryFormData(s, stored, []);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const again = readFormData(s, res.fd);
    expect(again.errors).toEqual({});
    expect(canonical(again.data)).toBe(canonical(stored));
  });

  it('keeps every existing file and signature of the inspection', () => {
    const s = spec('trailer-inspection-checklist');
    const stored = readFormData(s, fd(filled('trailer-inspection-checklist'))).data;
    const res = carryFormData(s, stored, [{ id: SIG, fieldKey: 'InspectorSignature' }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const read = readFormData(s, res.fd);
    expect(read.signatures.InspectorSignature).toEqual({ kind: 'keep', id: SIG });
    expect(stored.checklist).toEqual(read.data.checklist);
  });

  it('keeps all files of a multi-file field', () => {
    const s = spec('delivery-note');
    const field = inputFields(s).find((f) => f.type === 'file')!;
    const stored = readFormData(s, fd(filled('delivery-note'))).data;
    const res = carryFormData(s, stored, [{ id: FILE_A, fieldKey: field.name }, { id: FILE_B, fieldKey: field.name }]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(readFormData(s, res.fd).files[field.name]).toEqual([{ kind: 'existing', id: FILE_A }, { kind: 'existing', id: FILE_B }]);
  });

  it('refuses rather than drop anything it cannot carry exactly', () => {
    const s = spec('trailer-inspection-checklist');
    const stored = readFormData(s, fd(filled('trailer-inspection-checklist'))).data;
    // A key the spec does not know (e.g. an imported legacy value) would be lost.
    expect(carryFormData(s, { ...stored, LegacyField: 'x' }, [])).toEqual({ ok: false, reason: 'round-trip' });
    // Untrimmed text would be rewritten.
    expect(carryFormData(s, { ...stored, TRAILERVINNUMBER: ' TT9 ' }, [])).toEqual({ ok: false, reason: 'round-trip' });
    // A checklist label that no longer matches the spec would be rewritten.
    const checklist = (stored.checklist as Array<Record<string, unknown>>).map((r, i) => (i === 0 ? { ...r, label: 'Old label' } : r));
    expect(carryFormData(s, { ...stored, checklist }, [])).toEqual({ ok: false, reason: 'round-trip' });
    // Wrong value shapes.
    expect(carryFormData(s, { ...stored, TRAILERVINNUMBER: 12 }, [])).toEqual({ ok: false, reason: 'shape' });
    expect(carryFormData(s, { ...stored, checklist: 'x' }, [])).toEqual({ ok: false, reason: 'shape' });
    // Two signatures in one field: runAction would delete one.
    expect(carryFormData(s, stored, [{ id: SIG, fieldKey: 'InspectorSignature' }, { id: FILE_A, fieldKey: 'InspectorSignature' }]))
      .toEqual({ ok: false, reason: 'files' });
    // An invalid stored email would fail the read.
    expect(carryFormData(s, { ...stored, InspectorEmail: 'not-an-email' }, [])).toEqual({ ok: false, reason: 'round-trip' });
  });

  it('carries an empty entry', () => {
    const s = spec('store-room');
    const res = carryFormData(s, {}, []);
    expect(res.ok).toBe(true);
  });

  it('canonical JSON ignores key order and undefined', () => {
    expect(canonical({ b: 1, a: [{ y: 2, x: 1 }], c: undefined })).toBe(canonical({ a: [{ x: 1, y: 2 }], b: 1 }));
  });
});
