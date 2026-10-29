// Integration: runImport against an in-memory CognitoSource (synthetic fixtures) and an in-memory sink with the
// database's uniqueness rules. Uses the app's real sealData/openRow (server-only is a marker; stubbed here).
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { openRow, sealData, type EntryRow } from '@/lib/forms/entries';
import { IMPORT_ORDER, importObjectPath, orderForms, runImport, stableUuid } from '@/lib/import/cognito/importer';
import { mapEntry } from '@/lib/import/cognito/map';
import { formatReport, type ImportReport } from '@/lib/import/cognito/report';
import { refEntity } from '@/lib/import/cognito/sink';
import { FakeSource, PERSONAL, allFixtures, entryOf, platform } from './cognito-fake';
import { spec } from './specs';

const ALL = [...IMPORT_ORDER];
let saved: string | undefined;
beforeAll(() => {
  saved = process.env.ENTRY_ENCRYPTION_KEY;
  process.env.ENTRY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});
afterAll(() => {
  process.env.ENTRY_ENCRYPTION_KEY = saved;
});

function counter() {
  let n = 0;
  return () => `10000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

function form(rep: ImportReport, slug: string) {
  const f = rep.forms.find((x) => x.form === slug);
  if (!f) throw new Error(`no report for ${slug}`);
  return f;
}

describe('cognito importer', () => {
  it('imports RFI before Delivery Note whatever order the forms are given in', () => {
    expect(orderForms(['delivery-note', 'store-room', 'request-for-invoice'])).toEqual(['request-for-invoice', 'delivery-note', 'store-room']);
  });

  it('dry-run writes nothing and reports counts only, with no personal data', async () => {
    const sink = platform();
    const source = new FakeSource(allFixtures());
    const rep = await runImport({ source, sink, seal: sealData }, { forms: ALL, apply: false });
    expect(sink.writes).toBe(0);
    expect(source.downloads).toEqual([]);

    const rfi = form(rep, 'request-for-invoice');
    expect(rfi).toMatchObject({ seen: 3, toImport: 2, alreadyImported: 0, skipped: { unknown_status: 1 }, expected: 1345 });
    expect(rfi.files).toEqual({ count: 3, bytes: 2048 + 1024 + 4096, unknownSize: 0 });
    expect(rfi.unknownFields).toEqual({ 'Name.Middle': { present: 0, withValue: 1 }, LegacyVinAsOnUnit: { present: 1, withValue: 1 }, OldNotes: { present: 1, withValue: 0 } });

    const dn = form(rep, 'delivery-note');
    // 5-1 -> RFI 4-1 and 5-3 -> RFI 4-2 resolve to RFIs planned in this run; 5-2 -> 4-99 does not exist.
    expect(dn).toMatchObject({ seen: 3, toImport: 2, skipped: { lookup_unresolved: 1 }, lookups: { resolved: 0, pendingSource: 2, unresolved: 1 } });
    expect(dn.signatures.count).toBe(6);
    expect(dn.signatures.unknownSize).toBe(5);
    expect(dn.files.count).toBe(4);
    expect(form(rep, 'deal').issues).toEqual({ 'MONTH:not_in_options': 1, 'Total:not_integer': 1 });
    expect(form(rep, 'job-card').expected).toBeNull();

    const text = formatReport(rep);
    const json = JSON.stringify(rep);
    for (const p of PERSONAL) {
      expect(text).not.toContain(p);
      expect(json).not.toContain(p);
    }
    expect(text).toContain('== request-for-invoice');
    expect(text).toContain('dry-run: nothing was written');
  });

  it('apply imports entries with original numbers, files, events, refs and counters; a second run imports 0', async () => {
    const sink = platform();
    const source = new FakeSource(allFixtures());
    const deps = { source, sink, seal: sealData };
    const rep = await runImport(deps, { forms: ALL, apply: true, newId: counter() });

    const forms = new Map((await sink.loadForms()).map((f) => [f.slug, f]));
    const rfiForm = forms.get('request-for-invoice')!;
    const rfiRows = sink.entries.filter((e) => e.form_id === rfiForm.id);
    expect(rfiRows.map((e) => e.number).sort()).toEqual([1, 2]);
    expect(form(rep, 'request-for-invoice')).toMatchObject({ imported: 2, counterSetTo: 2, failed: {} });
    expect(form(rep, 'delivery-note')).toMatchObject({ imported: 2, counterSetTo: 3, lookups: { resolved: 2, unresolved: 1 } });
    expect(sink.entries).toHaveLength(2 + 2 + 1 + 2 + 2 + 2 + 2); // rfi deal job insp rel dn store

    // Original metadata kept.
    const r1 = rfiRows.find((e) => e.number === 1)!;
    expect(r1).toMatchObject({
      status: 'Submitted', cognito_entry_id: '4-1', summary: 'Testy Fakeperson', data_encrypted: null,
      created_at: '2026-01-05T08:00:00.000Z', updated_at: '2026-01-06T09:00:00.000Z', submitted_at: '2026-01-05T08:01:00.000Z',
    });
    expect(r1.data).toMatchObject({ Name: { First: 'Testy', Last: 'Fakeperson' } });

    // Encryption: DEAL and Delivery Note keep data = {} and decrypt (AAD = entry id) to the mapped values.
    for (const slug of ['deal', 'delivery-note']) {
      const f = forms.get(slug)!;
      const rows = sink.entries.filter((e) => e.form_id === f.id);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.data).toEqual({});
        expect(row.data_encrypted).toMatch(/^\\x[0-9a-f]+$/);
        expect(row.data_encrypted).not.toContain(Buffer.from('FAKEVIN').toString('hex'));
      }
    }
    const dnForm = forms.get('delivery-note')!;
    const dn1 = sink.entries.find((e) => e.form_id === dnForm.id && e.number === 1)!;
    const opened = openRow(dnForm, { ...dn1, org_id: sink.orgId, data_encrypted: dn1.data_encrypted } as unknown as EntryRow);
    // Lookup: QuoteNo holds our RFI entry uuid, found through external_refs.
    expect(opened.data).toMatchObject({ TrailerVinNO: 'FAKEVIN0000000001', QuoteNo: r1.id, Email: 'buyer-one@example.invalid' });
    expect(dn1.summary).toBe('FAKEVIN0000000001');
    const dealForm = forms.get('deal')!;
    const deal1 = sink.entries.find((e) => e.form_id === dealForm.id && e.number === 1)!;
    expect(openRow(dealForm, { ...deal1, org_id: sink.orgId } as unknown as EntryRow).data).toMatchObject({ QUOTENO: 'QU-90001', Total: 125000 });

    // Files and signatures: standard path shape, signature kind, sniffed type.
    const dnFiles = sink.files.filter((f) => f.entry_id === dn1.id);
    expect(dnFiles.filter((f) => f.kind === 'signature').map((f) => f.field_key).sort()).toEqual(['SalesRepSignature', 'Signature', 'Signature2', 'Signature3', 'Signature4']);
    expect(dnFiles.filter((f) => f.kind === 'file')).toHaveLength(4);
    for (const f of dnFiles) {
      expect(f.storage_path).toMatch(new RegExp(`^delivery-note/${dn1.id}/${f.field_key}/[0-9a-f-]{36}-[A-Za-z0-9._-]+$`));
      expect(sink.objects.has(f.storage_path)).toBe(true);
    }
    expect(dnFiles.find((f) => f.field_key === 'Signature4')).toMatchObject({ file_name: 'Signature4.png', content_type: 'image/png' });
    expect(dnFiles.find((f) => f.field_key === 'NATIS')).toMatchObject({ content_type: 'application/pdf', size_bytes: 6000, file_name: 'fake-natis.pdf' });
    const svg = sink.entries.find((e) => e.form_id === dnForm.id && e.number === 3)!;
    expect(sink.files.find((f) => f.entry_id === svg.id)).toMatchObject({ kind: 'signature', file_name: 'Signature4.svg' });
    const insp = sink.entries.find((e) => e.cognito_entry_id === '13-1')!;
    expect(sink.files.find((f) => f.entry_id === insp.id)).toMatchObject({ field_key: 'InspectorSignature', kind: 'signature', content_type: 'image/png' });

    // Timeline and refs.
    expect(sink.events).toHaveLength(sink.entries.length);
    expect(sink.events.every((e) => e.action === 'Import' && e.actor_role === 'Import' && e.actor_user === null)).toBe(true);
    expect(sink.events.find((e) => e.entry_id === dn1.id)!.diff.changed).toContain('QuoteNo');
    expect(sink.refs).toHaveLength(sink.entries.length);
    expect(sink.refs.find((r) => r.external_id === '4-1')).toEqual({ entity: refEntity('request-for-invoice'), external_id: '4-1', internal_id: r1.id });
    expect(sink.counters.get(dnForm.id)).toBe(3);

    // Second run: nothing new.
    const writes = sink.writes;
    const downloads = source.downloads.length;
    const again = await runImport(deps, { forms: ALL, apply: true, newId: counter() });
    expect(again.forms.reduce((n, f) => n + f.imported, 0)).toBe(0);
    expect(form(again, 'request-for-invoice')).toMatchObject({ alreadyImported: 2, toImport: 0 });
    expect(sink.writes).toBe(writes);
    expect(source.downloads.length).toBe(downloads);
    expect(sink.entries).toHaveLength(13);
  });

  it('a crash mid-run never duplicates: the re-run resumes half-imported entries', async () => {
    const sink = platform();
    const source = new FakeSource(allFixtures());
    const clean = platform();
    await runImport({ source: new FakeSource(allFixtures()), sink: clean, seal: sealData }, { forms: ALL, apply: true, newId: counter(), concurrency: 1 });

    for (const crashAt of [1, 2, 5, 9, 17, 40]) {
      const s = platform();
      const ids = counter(); // unique across both runs, like randomUUID
      s.failAfter = crashAt;
      // Every write from crashAt on throws, like a process that died there; the run may itself reject.
      await runImport({ source, sink: s, seal: sealData }, { forms: ALL, apply: true, newId: ids, concurrency: 1 }).catch(() => undefined);
      expect(s.writes).toBe(crashAt);
      s.failAfter = null;
      const second = await runImport({ source, sink: s, seal: sealData }, { forms: ALL, apply: true, newId: ids, concurrency: 1 });
      expect(second.forms.filter((f) => Object.keys(f.failed).length).map((f) => [f.form, f.failed])).toEqual([]);
      expect(s.entries).toHaveLength(clean.entries.length);
      expect(s.files).toHaveLength(clean.files.length);
      expect(new Set(s.files.map((f) => f.storage_path)).size).toBe(s.files.length);
      expect(s.events).toHaveLength(clean.events.length);
      expect(s.refs).toHaveLength(clean.refs.length);
      expect([...s.counters.values()].sort()).toEqual([...clean.counters.values()].sort());
    }
    expect(sink.writes).toBe(0);
  });

  it('a failed download leaves the entry resumable instead of marking it imported', async () => {
    const sink = platform();
    const source = new FakeSource({ 'request-for-invoice': allFixtures()['request-for-invoice'] });
    source.failIds.add('F-rfi1-b');
    const first = await runImport({ source, sink, seal: sealData }, { forms: ['request-for-invoice'], apply: true });
    expect(form(first, 'request-for-invoice')).toMatchObject({ imported: 1, failed: { download_failed: 1 } });
    expect(sink.refs.map((r) => r.external_id)).toEqual(['4-2']);

    source.failIds.clear();
    const dry = await runImport({ source, sink, seal: sealData }, { forms: ['request-for-invoice'], apply: false });
    expect(form(dry, 'request-for-invoice')).toMatchObject({ toImport: 1, resumable: 1, alreadyImported: 1 });
    const second = await runImport({ source, sink, seal: sealData }, { forms: ['request-for-invoice'], apply: true });
    expect(form(second, 'request-for-invoice')).toMatchObject({ imported: 1, failed: {} });
    expect(sink.entries).toHaveLength(2);
    expect(sink.files).toHaveLength(3);
  });

  it('a number already used by a platform entry is reported, not overwritten; counters are never lowered', async () => {
    const sink = platform();
    const f = (await sink.loadForms()).find((x) => x.slug === 'release-form')!;
    sink.entries.push({
      id: '20000000-0000-4000-8000-000000000001', form_id: f.id, number: 1, status: 'Submitted', data: {}, data_encrypted: null,
      summary: null, created_at: '2026-03-01T00:00:00.000Z', updated_at: '2026-03-01T00:00:00.000Z', submitted_at: null, cognito_entry_id: null as unknown as string,
    });
    sink.counters.set(f.id, 7);
    const rep = await runImport({ source: new FakeSource(allFixtures()), sink, seal: sealData }, { forms: ['release-form'], apply: true });
    expect(form(rep, 'release-form')).toMatchObject({ imported: 1, failed: { number_taken: 1 }, counterSetTo: 7 });
  });

  it('delivery note alone: unresolved RFI lookups skip by default, or import without the link when allowed', async () => {
    const fixtures = { 'delivery-note': allFixtures()['delivery-note'] };
    const skip = await runImport({ source: new FakeSource(fixtures), sink: platform(), seal: sealData }, { forms: ['delivery-note'], apply: true });
    expect(form(skip, 'delivery-note')).toMatchObject({ imported: 0, skipped: { lookup_unresolved: 3 } });

    const sink = platform();
    const allow = await runImport({ source: new FakeSource(fixtures), sink, seal: sealData }, { forms: ['delivery-note'], apply: true, allowUnresolvedLookups: true });
    expect(form(allow, 'delivery-note')).toMatchObject({ imported: 3, lookups: { unresolved: 3 } });
  });

  it('--limit and --since', async () => {
    const lim = await runImport({ source: new FakeSource(allFixtures()), sink: platform(), seal: sealData }, { forms: ['request-for-invoice'], apply: false, limit: 1 });
    expect(form(lim, 'request-for-invoice')).toMatchObject({ toImport: 1, stoppedAtLimit: true });
    const since = await runImport({ source: new FakeSource(allFixtures()), sink: platform(), seal: sealData }, { forms: ['request-for-invoice'], apply: false, since: new Date('2026-01-06T00:00:00Z') });
    expect(form(since, 'request-for-invoice')).toMatchObject({ toImport: 1, skipped: { before_since: 1, unknown_status: 1 } });
  });

  it('storage paths are deterministic per entry, field and file', () => {
    const m = mapEntry(spec('request-for-invoice'), entryOf('request-for-invoice', '4-1'));
    if (!m.ok) throw new Error('fixture');
    const id = '30000000-0000-4000-8000-000000000001';
    const a = importObjectPath('request-for-invoice', id, '4-1', m.entry.files[0]);
    expect(a).toBe(importObjectPath('request-for-invoice', id, '4-1', m.entry.files[0]));
    expect(a).not.toBe(importObjectPath('request-for-invoice', id, '4-1', m.entry.files[1]));
    expect(a).toMatch(/^request-for-invoice\/30000000-0000-4000-8000-000000000001\/_1stDeposit\/[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-fake-proof-of-payment\.pdf$/);
    expect(stableUuid('x')).toBe(stableUuid('x'));
  });
});
