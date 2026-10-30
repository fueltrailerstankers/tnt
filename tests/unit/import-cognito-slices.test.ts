// In-app import: the importer run in time-boxed, resumable slices (budget + cursor), checkpoints, stop, resume after
// a crash, and the batch dry run's planned lookups. Synthetic fixtures and in-memory sink/source only.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { sealData } from '@/lib/forms/entries';
import { HttpCognitoSource } from '@/lib/import/cognito/api';
import { IMPORT_ORDER, runImport, runImportSlice, type SliceResult } from '@/lib/import/cognito/importer';
import { parseCursor, parseReport } from '@/lib/import/cognito/progress';
import { emptyFormReport, type FormReport } from '@/lib/import/cognito/report';
import type { CognitoFormRef, PositionedEntry, SourcePosition } from '@/lib/import/cognito/source';
import { FakeSource, PERSONAL, allFixtures, platform } from './cognito-fake';

let saved: string | undefined;
beforeAll(() => {
  saved = process.env.ENTRY_ENCRYPTION_KEY;
  process.env.ENTRY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});
afterAll(() => {
  process.env.ENTRY_ENCRYPTION_KEY = saved;
});

function counter(prefix = '1') {
  let n = 0;
  return () => `${prefix}0000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
}

/** Like the job: the report and cursor go through JSON (jsonb) between slices. */
const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Runs one form slice by slice until it is finished, the way the job does (deadline already passed = one step each). */
async function drive(deps: Parameters<typeof runImportSlice>[0], form: string, apply: boolean, opts: { newId?: () => string } = {}) {
  let report: FormReport | null = null;
  let position: SourcePosition | null = null;
  for (let slices = 1; slices < 500; slices++) {
    const r: SliceResult = await runImportSlice(deps, {
      form, apply, report: report ? roundTrip(report) : null, from: position ? roundTrip(position) : null,
      deadline: 0, checkpointEvery: 1, newId: opts.newId, concurrency: 3, shouldStop: async () => false,
    });
    report = parseReport(roundTrip(r.report));
    position = r.position;
    if (r.outcome === 'done' || r.outcome === 'limit') return { report: report!, slices };
    expect(r.outcome).toBe('budget');
    expect(position).not.toBeNull();
  }
  throw new Error('did not finish');
}

describe('importer slices (budget and cursor)', () => {
  it('slice by slice gives the same result as one run, for dry run and apply, across all forms', async () => {
    const whole = platform();
    const reference = await runImport({ source: new FakeSource(allFixtures()), sink: whole, seal: sealData }, { forms: [...IMPORT_ORDER], apply: true, newId: counter('2') });

    const sliced = platform();
    const deps = { source: new FakeSource(allFixtures()), sink: sliced, seal: sealData };
    const ids = counter('3');
    for (const slug of IMPORT_ORDER) {
      const dry = await drive(deps, slug, false);
      const ref = reference.forms.find((f) => f.form === slug)!;
      expect(dry.report.seen).toBe(ref.seen);
      expect(dry.slices).toBeGreaterThanOrEqual(ref.seen);
      const applied = await drive(deps, slug, true, { newId: ids });
      expect(applied.report).toEqual(ref);
    }
    expect(sliced.entries).toHaveLength(whole.entries.length);
    expect(sliced.files).toHaveLength(whole.files.length);
    expect(sliced.refs).toHaveLength(whole.refs.length);
    expect([...sliced.counters.values()].sort()).toEqual([...whole.counters.values()].sort());

    // A re-run imports nothing new.
    for (const slug of IMPORT_ORDER) {
      const again = await drive(deps, slug, true);
      expect(again.report.imported).toBe(0);
      expect(again.report.toImport).toBe(0);
    }
    expect(sliced.entries).toHaveLength(whole.entries.length);
  });

  it('a source without positions is resumed by index: entries already handled are skipped, not counted twice', async () => {
    const source = new FakeSource(allFixtures());
    expect('listPositioned' in source).toBe(false);
    const sink = platform();
    const first = await runImportSlice({ source, sink, seal: sealData }, { form: 'request-for-invoice', apply: false, deadline: 0 });
    expect(first).toMatchObject({ outcome: 'budget', position: { kind: 'index', n: 1 } });
    expect(first.report.seen).toBe(1);
    const second = await runImportSlice({ source, sink, seal: sealData }, { form: 'request-for-invoice', apply: false, deadline: Date.now() + 60_000, report: first.report, from: first.position });
    expect(second).toMatchObject({ outcome: 'done', position: null });
    expect(second.report).toMatchObject({ seen: 3, toImport: 2, skipped: { unknown_status: 1 } });
  });

  it('checkpoints only when nothing is in flight: every entry before the position is counted and settled', async () => {
    const sink = platform();
    const deps = { source: new FakeSource(allFixtures()), sink, seal: sealData };
    const rep = emptyFormReport('delivery-note', null);
    const seenAt: Array<{ n: number; seen: number; settled: number; toImport: number }> = [];
    const r = await runImportSlice(deps, {
      form: 'delivery-note', apply: true, allowUnresolvedLookups: true, concurrency: 4, checkpointEvery: 1, deadline: Date.now() + 60_000,
      report: rep,
      checkpoint: async (p) => {
        const f = rep;
        seenAt.push({ n: p?.kind === 'index' ? p.n : -1, seen: f.seen, settled: f.imported + Object.values(f.failed).reduce((a, b) => a + b, 0), toImport: f.toImport });
      },
    });
    expect(r.outcome).toBe('done');
    expect(seenAt.length).toBe(3);
    for (const c of seenAt) {
      expect(c.seen).toBe(c.n);
      expect(c.settled).toBe(c.toImport);
    }
  });

  it('stop pauses at the next checkpoint; resume continues from the saved position', async () => {
    const sink = platform();
    const deps = { source: new FakeSource(allFixtures()), sink, seal: sealData };
    let checks = 0;
    const first = await runImportSlice(deps, {
      form: 'release-form', apply: true, deadline: Date.now() + 60_000, checkpointEvery: 1, newId: counter('4'),
      shouldStop: async () => ++checks >= 1,
    });
    expect(first.outcome).toBe('stopped');
    expect(first.position).toEqual({ kind: 'index', n: 1 });
    expect(first.report.seen).toBe(1);
    expect(first.report.counterSetTo).toBeNull(); // counters are set only when the form is finished
    const second = await runImportSlice(deps, { form: 'release-form', apply: true, report: roundTrip(first.report), from: first.position, newId: counter('5') });
    expect(second.outcome).toBe('done');
    const whole = await runImport({ source: new FakeSource(allFixtures()), sink: platform(), seal: sealData }, { forms: ['release-form'], apply: true });
    expect(second.report).toEqual(whole.forms[0]);
  });

  it('a slice that crashes is resumed from its last checkpoint without duplicates', async () => {
    const clean = platform();
    await runImport({ source: new FakeSource(allFixtures()), sink: clean, seal: sealData }, { forms: ['request-for-invoice'], apply: true, concurrency: 1 });

    for (const crashAt of [1, 3, 6]) {
      const sink = platform();
      const deps = { source: new FakeSource(allFixtures()), sink, seal: sealData };
      const ids = counter('6');
      let saved: { report: FormReport | null; position: SourcePosition | null } = { report: null, position: null };
      sink.failAfter = crashAt;
      const current = emptyFormReport('request-for-invoice', 1345);
      // The job keeps the last checkpoint only (report + cursor are saved together); a crash loses the rest.
      await runImportSlice(deps, {
        form: 'request-for-invoice', apply: true, concurrency: 1, checkpointEvery: 1, deadline: Date.now() + 60_000, newId: ids,
        shouldStop: async () => false,
        checkpoint: async (p) => {
          // From the crash on, the process is gone: nothing more is saved.
          if (sink.failAfter !== null && sink.writes >= sink.failAfter) throw new Error('process died');
          saved = { report: roundTrip(current), position: p };
        },
        report: current,
      }).catch(() => undefined);
      sink.failAfter = null;
      const resumed = await runImportSlice(deps, { form: 'request-for-invoice', apply: true, report: saved.report ? roundTrip(saved.report) : null, from: saved.position, newId: ids });
      expect(sink.writes).toBeGreaterThan(crashAt);
      expect(resumed.outcome).toBe('done');
      expect(resumed.report.failed).toEqual({});
      expect(sink.entries).toHaveLength(clean.entries.length);
      expect(sink.files).toHaveLength(clean.files.length);
      expect(new Set(sink.files.map((f) => f.storage_path)).size).toBe(sink.files.length);
      expect(sink.events).toHaveLength(clean.events.length);
      expect(sink.refs).toHaveLength(clean.refs.length);
      expect(resumed.report.seen).toBe(3);
      expect(resumed.report.imported + resumed.report.alreadyImported).toBe(2);
    }
  });

  it('the batch dry run passes RFI ids it planned to the Delivery Note dry run (pending, not unresolved)', async () => {
    const sink = platform();
    const deps = { source: new FakeSource(allFixtures()), sink, seal: sealData };
    const rfi = await runImportSlice(deps, { form: 'request-for-invoice', apply: false });
    expect(rfi.planned.sort()).toEqual(['4-1', '4-2']);
    // As stored in import_runs.cursor and read back by the Delivery Note run of the same batch.
    const planned = new Map([['request-for-invoice', new Set(parseCursor(roundTrip({ position: null, planned: rfi.planned })).planned)]]);
    const dn = await runImportSlice(deps, { form: 'delivery-note', apply: false, planned });
    expect(dn.report).toMatchObject({ seen: 3, toImport: 2, skipped: { lookup_unresolved: 1 }, lookups: { resolved: 0, pendingSource: 2, unresolved: 1 } });
    // Without the batch the same dry run cannot know the RFIs.
    const alone = await runImportSlice(deps, { form: 'delivery-note', apply: false });
    expect(alone.report.lookups).toEqual({ resolved: 0, pendingSource: 0, unresolved: 3 });
    for (const p of PERSONAL) expect(JSON.stringify([rfi, dn])).not.toContain(p);
  });

  it('limit counts across slices and ends the run', async () => {
    const sink = platform();
    const deps = { source: new FakeSource(allFixtures()), sink, seal: sealData };
    let report: FormReport | null = null;
    let position: SourcePosition | null = null;
    let r: SliceResult;
    do {
      r = await runImportSlice(deps, { form: 'request-for-invoice', apply: true, limit: 1, deadline: 0, report, from: position });
      report = roundTrip(r.report);
      position = r.position;
    } while (r.outcome === 'budget');
    expect(r.outcome).toBe('limit');
    expect(r.report).toMatchObject({ toImport: 1, imported: 1, stoppedAtLimit: true });
    expect(sink.entries).toHaveLength(1);
  });

  it('a form that is not in the platform throws', async () => {
    await expect(runImportSlice({ source: new FakeSource({}), sink: platform(), seal: sealData }, { form: 'nope', apply: false })).rejects.toThrow('form not in the platform');
  });
});

describe('HttpCognitoSource positions', () => {
  const FORM: CognitoFormRef = { slug: 'release-form', cognitoFormId: 8, internalName: 'RELEASEFORM' };
  const entry = (n: number) => ({ Id: `8-${n}`, Entry: { Number: n } });
  const existing = new Set([1, 2, 4, 5, 9]);
  const make = (calls: string[], listMode: 'by-number' | 'list' = 'by-number') => new HttpCognitoSource({
    apiKey: 'test-key', listMode, maxConsecutiveMisses: 3, pageSize: 2, sleep: async () => undefined,
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      const list = url.match(/entries\?skip=(\d+)&take=(\d+)$/);
      if (list) return new Response(JSON.stringify([...existing].slice(Number(list[1]), Number(list[1]) + Number(list[2])).map(entry)), { status: 200 });
      const n = Number(url.split('/').pop());
      return existing.has(n) ? new Response(JSON.stringify(entry(n)), { status: 200 }) : new Response('{}', { status: 404 });
    }) as typeof fetch,
  });

  async function steps(it: AsyncIterable<PositionedEntry>, max = 100) {
    const out: PositionedEntry[] = [];
    for await (const s of it) {
      out.push(s);
      if (out.length >= max) break;
    }
    return out;
  }

  it('by-number yields misses too, and a resume continues the miss count so the end is still found', async () => {
    const calls: string[] = [];
    const all = await steps(make(calls).listPositioned(FORM, {}));
    expect(all.filter((s) => s.entry).map((s) => (s.entry as { Id: string }).Id)).toEqual(['8-1', '8-2', '8-4', '8-5']);
    expect(all.map((s) => s.position)).toEqual([
      { kind: 'number', next: 2, misses: 0 }, { kind: 'number', next: 3, misses: 0 }, { kind: 'number', next: 4, misses: 1 },
      { kind: 'number', next: 5, misses: 0 }, { kind: 'number', next: 6, misses: 0 },
      { kind: 'number', next: 7, misses: 1 }, { kind: 'number', next: 8, misses: 2 }, { kind: 'number', next: 9, misses: 3 },
    ]);
    // Paused after two misses: one more miss ends the form (entry 9 is beyond 3 consecutive misses, as in one go).
    const resumedCalls: string[] = [];
    const rest = await steps(make(resumedCalls).listPositioned(FORM, { from: { kind: 'number', next: 8, misses: 2 } }));
    expect(rest).toEqual([{ entry: null, position: { kind: 'number', next: 9, misses: 3 } }]);
    expect(resumedCalls).toEqual(['https://www.cognitoforms.com/api/forms/8/entries/8']);
    // A finished position reads nothing.
    expect(await steps(make([]).listPositioned(FORM, { from: { kind: 'number', next: 9, misses: 3 } }))).toEqual([]);
  });

  it('listEntries still yields only entries (CLI unchanged)', async () => {
    const out = [];
    for await (const e of make([]).listEntries(FORM, {})) out.push(e);
    expect(out).toHaveLength(4);
  });

  it('list mode resumes by skip; a position of the other mode starts over', async () => {
    const calls: string[] = [];
    const rest = await steps(make(calls, 'list').listPositioned(FORM, { from: { kind: 'skip', n: 3 } }));
    expect(rest.map((s) => (s.entry as { Id: string }).Id)).toEqual(['8-5', '8-9']);
    expect(rest.map((s) => s.position)).toEqual([{ kind: 'skip', n: 4 }, { kind: 'skip', n: 5 }]);
    expect(calls[0]).toContain('entries?skip=3&take=2');
    const fresh = await steps(make([], 'list').listPositioned(FORM, { from: { kind: 'number', next: 4, misses: 0 } }));
    expect(fresh).toHaveLength(5);
  });
});
