// Terms versions: canonical text and sha256 of ordered {id, text} blocks (pure), and ensureTermsVersion's
// idempotency against an in-memory terms_versions table with its unique (org_id, key, sha256) key.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
const { canonicalTermsText, ensureTermsVersion, normaliseTermsBlocks, termsSha256, verifyTermsBody } = await import('@/lib/terms/versions');

const ORG = '00000000-0000-0000-0000-000000000001';
const OTHER_ORG = '00000000-0000-0000-0000-0000000000e5';
// Synthetic text; real legal text comes verbatim from the kit content.
const BLOCKS = [
  { id: 'terms', text: '1.PRICE\nSynthetic terms for tests , kept verbatim.' },
  { id: 'declaration', text: '<p>I, the signatory, confirm the details.</p>' },
  { id: 'waiver', text: 'Synthetic waiver’s text.' },
  { id: 'receipt', text: 'Received in good order.' },
];

describe('canonical text and hash', () => {
  it('is JSON of the ordered blocks with only id and text', () => {
    const extra = BLOCKS.map((b) => ({ ...b, html: '<b>ignored</b>' }));
    expect(canonicalTermsText(extra)).toBe(JSON.stringify(BLOCKS));
  });

  it('hashes the canonical text as UTF-8 sha256 hex', () => {
    const expected = createHash('sha256').update(JSON.stringify(BLOCKS), 'utf8').digest('hex');
    expect(termsSha256(BLOCKS)).toBe(expected);
    expect(termsSha256(BLOCKS)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for the same text and changes with any text, order or id change', () => {
    const base = termsSha256(BLOCKS);
    expect(termsSha256(BLOCKS.map((b) => ({ ...b })))).toBe(base);
    expect(termsSha256([...BLOCKS].reverse())).not.toBe(base);
    expect(termsSha256([{ ...BLOCKS[0], text: BLOCKS[0].text.replace(' , ', ', ') }, ...BLOCKS.slice(1)])).not.toBe(base);
    expect(termsSha256([{ ...BLOCKS[0], id: 'terms2' }, ...BLOCKS.slice(1)])).not.toBe(base);
    expect(termsSha256([{ ...BLOCKS[0], text: `${BLOCKS[0].text} ` }, ...BLOCKS.slice(1)])).not.toBe(base);
  });

  it('keeps text verbatim except line endings, which are normalised to LF', () => {
    const crlf = [{ id: 'terms', text: 'Line one\r\nLine two\rLine three' }];
    expect(normaliseTermsBlocks(crlf)).toEqual([{ id: 'terms', text: 'Line one\nLine two\nLine three' }]);
    expect(termsSha256(crlf)).toBe(termsSha256([{ id: 'terms', text: 'Line one\nLine two\nLine three' }]));
    expect(normaliseTermsBlocks([{ id: 't', text: '  Typo’s  kept ' }])[0].text).toBe('  Typo’s  kept ');
  });

  it('cannot be forged by moving a block boundary', () => {
    const a = [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }];
    const b = [{ id: 'a', text: 'x","id":"b","text":"y' }];
    expect(termsSha256(a)).not.toBe(termsSha256(b));
  });

  it('rejects empty lists, bad or duplicate ids, empty text and NUL', () => {
    for (const bad of [
      [],
      [{ id: 'Terms', text: 'x' }],
      [{ id: '', text: 'x' }],
      [{ id: 't', text: 'x' }, { id: 't', text: 'y' }],
      [{ id: 't', text: '  \n ' }],
      [{ id: 't', text: 'a\u0000b' }],
      [{ id: 't' }],
    ]) {
      expect(() => termsSha256(bad as never), JSON.stringify(bad)).toThrow(/terms:/);
    }
  });

  it('verifies a stored body against its hash', () => {
    const sha = termsSha256(BLOCKS);
    expect(verifyTermsBody(BLOCKS, sha)).toBe(true);
    expect(verifyTermsBody([{ ...BLOCKS[0], text: 'changed' }, ...BLOCKS.slice(1)], sha)).toBe(false);
    expect(verifyTermsBody(BLOCKS, sha.toUpperCase())).toBe(false);
    expect(verifyTermsBody({ not: 'an array' }, sha)).toBe(false);
    expect(verifyTermsBody([], sha)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ensureTermsVersion against an in-memory table
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function fakeAdmin(opts: { raceOnInsert?: Row } = {}) {
  const rows: Row[] = [];
  const ops: string[] = [];
  let n = 0;
  const from = (table: string) => {
    if (table !== 'terms_versions') throw new Error(`unexpected table ${table}`);
    let op: 'select' | 'insert' = 'select';
    let payload: Row = {};
    const filters: Array<[string, unknown]> = [];
    const run = async () => {
      ops.push(op);
      if (op === 'insert') {
        // Simulate another request inserting the same version between our select and insert.
        if (opts.raceOnInsert && !rows.length) rows.push(opts.raceOnInsert);
        if (rows.some((r) => r.org_id === payload.org_id && r.key === payload.key && r.sha256 === payload.sha256)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        const row = { id: `tv-${++n}`, ...payload };
        rows.push(row);
        return { data: [{ id: row.id }], error: null };
      }
      return { data: rows.filter((r) => filters.every(([k, v]) => r[k] === v)).map((r) => ({ id: r.id })), error: null };
    };
    const b = {
      select() { return b; },
      insert(p: Row) { op = 'insert'; payload = p; return b; },
      eq(k: string, v: unknown) { filters.push([k, v]); return b; },
      limit() { return b; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
    };
    return b;
  };
  return { admin: { from } as unknown as SupabaseClient, rows, ops };
}

describe('ensureTermsVersion', () => {
  it('inserts the normalised body once and returns the same id afterwards', async () => {
    const f = fakeAdmin();
    const id = await ensureTermsVersion(f.admin, ORG, 'delivery-note', BLOCKS);
    expect(f.rows).toEqual([{ id, org_id: ORG, key: 'delivery-note', sha256: termsSha256(BLOCKS), body: BLOCKS }]);
    expect(await ensureTermsVersion(f.admin, ORG, 'delivery-note', BLOCKS.map((b) => ({ ...b })))).toBe(id);
    expect(f.rows).toHaveLength(1);
    expect(f.ops).toEqual(['select', 'insert', 'select']);
  });

  it('keeps versions apart by org, key and text', async () => {
    const f = fakeAdmin();
    const a = await ensureTermsVersion(f.admin, ORG, 'delivery-note', BLOCKS);
    const b = await ensureTermsVersion(f.admin, OTHER_ORG, 'delivery-note', BLOCKS);
    const c = await ensureTermsVersion(f.admin, ORG, 'release-form', BLOCKS);
    const d = await ensureTermsVersion(f.admin, ORG, 'delivery-note', [{ id: 'terms', text: 'Version 2' }]);
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it('resolves a concurrent insert of the same version to the existing row', async () => {
    const sha256 = termsSha256(BLOCKS);
    const f = fakeAdmin({ raceOnInsert: { id: 'tv-other', org_id: ORG, key: 'delivery-note', sha256, body: BLOCKS } });
    expect(await ensureTermsVersion(f.admin, ORG, 'delivery-note', BLOCKS)).toBe('tv-other');
    expect(f.ops).toEqual(['select', 'insert', 'select']);
  });

  it('rejects a bad org id, key or blocks before any query', async () => {
    const f = fakeAdmin();
    await expect(ensureTermsVersion(f.admin, 'not-a-uuid', 'delivery-note', BLOCKS)).rejects.toThrow(/org id/);
    await expect(ensureTermsVersion(f.admin, ORG, 'Delivery Note', BLOCKS)).rejects.toThrow(/key/);
    await expect(ensureTermsVersion(f.admin, ORG, 'delivery-note', [])).rejects.toThrow(/block/);
    expect(f.ops).toEqual([]);
  });
});
