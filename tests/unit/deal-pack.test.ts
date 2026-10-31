import { strToU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { areaOf, describe as describeRow, hrefFor, KNOWN_ACTIONS } from '@/lib/activity/describe';
import {
  encryptedEntries, kindOf, overPackLimit, PACK_MAX_BYTES, packAuditRow, packFileName, packHref, packManifest, planPack,
  type PackDocumentRow, type PackEntry,
} from '@/lib/deal-view/pack';
import { zipStream } from '@/lib/deal-view/zip-stream';

// Synthetic ids, numbers and hashes only.
const sha = (c: string) => c.repeat(64);
const entries = new Map<string, PackEntry>([
  ['e-deal', { slug: 'deal', number: 7, encrypted: true }],
  ['e-rfi', { slug: 'request-for-invoice', number: 12, encrypted: false }],
  ['e-dn', { slug: 'delivery-note', number: 3, encrypted: true }],
]);
const row = (id: string, entry: string, template: number, at: string, hash: string | null = sha('a')): PackDocumentRow => ({
  id, entry_id: entry, template_number: template, storage_path: `x/${id}.pdf`, sha256: hash, created_at: at,
});

describe('planPack', () => {
  const rows = [
    row('r1', 'e-rfi', 1, '2026-01-01T10:00:00Z', sha('1')),
    row('r2', 'e-rfi', 1, '2026-01-02T10:00:00Z', sha('2')),
    row('d1', 'e-deal', 1, '2026-01-01T09:00:00Z', sha('3')),
    row('d3', 'e-deal', 3, '2026-01-01T09:00:00Z', sha('4')),
    row('n1', 'e-dn', 1, '2026-01-05T09:00:00Z', sha('5')),
    row('zz', 'e-other', 1, '2026-01-05T09:00:00Z'),
  ];
  const files = planPack(rows, entries);

  it('keeps only the latest version per entry and template, in entry order then template', () => {
    expect(files.map((f) => [f.documentId, f.version])).toEqual([['d1', 1], ['d3', 1], ['r2', 2], ['n1', 1]]);
  });
  it('names files by kind, entry number and version only', () => {
    expect(files.map((f) => f.fileName)).toEqual(['DEAL-7-v1.pdf', 'DEAL-COGNITO-7-v1.pdf', 'RFI-12-v2.pdf', 'DELIVERY-NOTE-3-v1.pdf']);
    for (const f of files) expect(f.fileName).toMatch(/^[A-Z0-9-]+-\d+-v\d+(-\d+)?\.pdf$/);
  });
  it('drops rows of entries that are not linked or readable', () => {
    expect(files.some((f) => f.entryId === 'e-other')).toBe(false);
  });
  it('skips a latest version without a valid sha256 (cannot be integrity-checked)', () => {
    const out = planPack([row('a', 'e-rfi', 1, '2026-01-01T00:00:00Z'), row('b', 'e-rfi', 1, '2026-01-02T00:00:00Z', null)], entries);
    expect(out).toEqual([]);
  });
  it('orders equal timestamps by id and lowercases hashes', () => {
    const out = planPack([row('b', 'e-rfi', 1, '2026-01-01T00:00:00Z', 'B'.repeat(64)), row('a', 'e-rfi', 1, '2026-01-01T00:00:00Z')], entries);
    expect(out[0]).toMatchObject({ documentId: 'b', version: 2, sha256: 'b'.repeat(64) });
  });
  it('lists each encrypted entry once', () => {
    expect(encryptedEntries(files)).toEqual([{ entryId: 'e-deal', slug: 'deal', number: 7 }, { entryId: 'e-dn', slug: 'delivery-note', number: 3 }]);
  });
  it('is empty without documents', () => {
    expect(planPack([], entries)).toEqual([]);
  });
});

describe('names, limits and manifest', () => {
  it('kindOf maps stage forms and sanitises other slugs', () => {
    expect(kindOf('request-for-invoice', 1)).toBe('RFI');
    expect(kindOf('job-card', 4)).toBe('JOB-CARD-COLLECTION-SHEET');
    expect(kindOf('my_form', 1)).toBe('MY-FORM');
  });
  it('packFileName keeps quote characters only', () => {
    expect(packFileName('QU-10482')).toBe('deal-pack-QU-10482.zip');
    expect(packFileName('a/../"b"')).toBe('deal-pack-a-b.zip');
    expect(packFileName('///')).toBe('deal-pack.zip');
    expect(packHref('QU-1')).toBe('/admin/deal-files/QU-1/pack');
  });
  it('refuses over 100 MB', () => {
    expect(overPackLimit(PACK_MAX_BYTES)).toBe(false);
    expect(overPackLimit(PACK_MAX_BYTES + 1)).toBe(true);
  });
  it('manifest lists kind, entry, version, sha256 and file, nothing else', () => {
    const files = planPack([row('r1', 'e-rfi', 1, '2026-01-01T10:00:00Z', sha('c'))], entries);
    const m = packManifest('QU-1', files, '2026-02-01T00:00:00.000Z');
    expect(m).toBe([
      'Deal pack for quote QU-1', 'Generated 2026-02-01T00:00:00.000Z (UTC)', 'Documents: 1', '',
      'kind\tentry\tversion\tsha256\tfile', `RFI\t12\tv1\t${sha('c')}\tRFI-12-v1.pdf`, '',
    ].join('\n'));
    expect(m).not.toContain('x/r1.pdf');
  });
  it('audit row holds ids and counts only', () => {
    const files = planPack([row('r1', 'e-rfi', 1, '2026-01-01T10:00:00Z')], entries);
    expect(packAuditRow({ orgId: 'o', userId: 'u' }, 'df-1', 'QU-1', files)).toEqual({
      org_id: 'o', actor_user: 'u', action: 'deal.pack_download', entity: 'deal_file', entity_id: 'df-1',
      meta: { quote_no: 'QU-1', documents: 1, document_ids: ['r1'], entry_ids: ['e-rfi'] },
    });
  });
});

describe('deal.pack_download in the activity log', () => {
  const r = { id: 1, created_at: '2026-01-01T00:00:00Z', actor_user: 'u', action: 'deal.pack_download', entity: 'deal_file', entity_id: 'df-1', meta: { quote_no: 'QU-1', documents: 2 } };
  it('belongs to Deals, has a phrase and links to the deal file', () => {
    expect(areaOf('deal.pack_download')).toBe('deals');
    expect(areaOf('deal.create_quote')).toBe('integrations');
    expect(KNOWN_ACTIONS).toContain('deal.pack_download');
    expect(describeRow(r, new Map([['u', 'Sam']]))).toEqual({ text: 'Sam downloaded the document pack of deal QU-1 (2 PDFs)', href: '/admin/deal-files/QU-1' });
    expect(hrefFor({ ...r, meta: {} })).toBe('/admin/deal-files');
  });
});

describe('zipStream', () => {
  it('streams stored entries that unzip to the same bytes', async () => {
    const parts = [{ name: 'manifest.txt', data: strToU8('m') }, { name: 'RFI-12-v1.pdf', data: strToU8('%PDF-1.7 x') }];
    const all = new Uint8Array(await new Response(zipStream(parts)).arrayBuffer());
    const out = unzipSync(all);
    expect(Object.keys(out)).toEqual(['manifest.txt', 'RFI-12-v1.pdf']);
    expect(new TextDecoder().decode(out['RFI-12-v1.pdf'])).toBe('%PDF-1.7 x');
  });
  it('an empty pack is still a valid archive', async () => {
    const all = new Uint8Array(await new Response(zipStream([])).arrayBuffer());
    expect(unzipSync(all)).toEqual({});
  });
});
