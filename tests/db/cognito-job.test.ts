// The in-app import job (lib/import/cognito/job.ts) against real Postgres through tests/e2e/mini-supabase.mjs (the
// PostgREST stub), so the lease token, stop ordering, attempts guard, retry-later path and job_runs rows run on the
// real schema. The Cognito side is an injected fake source. Synthetic data only.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { drainImportJobs, importSlice, resumeImport, stopImport } from '@/lib/import/cognito/job';
import { saveApiKey } from '@/lib/import/cognito/key';
import { MAX_POSITION_ATTEMPTS } from '@/lib/import/cognito/progress';
import { SourceDeadlineError, type CognitoEntry, type CognitoSource } from '@/lib/import/cognito/source';
import { FakeSource, allFixtures } from '../unit/cognito-fake';

const ORG = '00000000-0000-0000-0000-000000000001';
const ADMIN = '00000000-0000-0000-0000-00000000a001';
const MEMBER = { userId: ADMIN, orgId: ORG, role: 'admin' as const, branch: null };
const DB_NAME = `${process.env.TEST_DB_NAME ?? 'tt_test'}_job`;

let stub: ChildProcess;
let db: SupabaseClient;
let sqlc: pg.Client;
const saved: Record<string, string | undefined> = {};

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

const sql = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await sqlc.query(text, params)).rows as T[];
const run = async (id: string) => (await sql<{ status: string; error: string | null; cursor: Record<string, unknown>; report: Record<string, unknown>; lease_token: string | null; stop_requested: boolean }>(
  `select status, error, cursor, report, lease_token, stop_requested from import_runs where id = $1`, [id]))[0];

async function newRun(slug: string, mode: 'dry_run' | 'apply', status = 'queued', extra = ''): Promise<string> {
  const r = await sql<{ id: string }>(`insert into import_runs(org_id, form_slug, mode, status${extra ? ', lease_until, lease_token' : ''}) values ($1, $2, $3, $4${extra}) returning id`, [ORG, slug, mode, status]);
  return r[0].id;
}

const later = () => Date.now() + 30_000;
const fakeSource = (entries = allFixtures()) => () => new FakeSource(entries);

/** A source whose listing throws (or never answers). */
function throwing(make: () => unknown): () => CognitoSource {
  return () => ({
    async *listEntries(): AsyncIterable<CognitoEntry> {
      throw make();
    },
    downloadFile: async () => { throw new Error('unused'); },
  });
}
const hanging = (): CognitoSource => ({
  async *listEntries(): AsyncIterable<CognitoEntry> {
    await new Promise(() => undefined);
  },
  downloadFile: async () => { throw new Error('unused'); },
});

/**
 * The service-role client, with a hook after the n-th import_runs update (to interleave another actor) and an
 * optional failure of the n-th one.
 */
function hooked(after: (n: number) => Promise<void>, failAt?: number): SupabaseClient {
  let n = 0;
  return new Proxy(db, {
    get(target, prop, recv) {
      if (prop !== 'from') return Reflect.get(target, prop, recv);
      return (table: string) => {
        const b = target.from(table);
        if (table !== 'import_runs') return b;
        const update = b.update.bind(b);
        (b as unknown as { update: unknown }).update = (...args: Parameters<typeof update>) => {
          const fb = update(...args);
          const then = fb.then.bind(fb);
          const k = ++n;
          (fb as unknown as { then: unknown }).then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => {
            if (k === failAt) return Promise.resolve({ data: null, error: { message: 'simulated' }, count: null, status: 500, statusText: 'x' }).then(ok, bad);
            return then(async (v: unknown) => { await after(k); return v; }).then(ok, bad);
          };
          return fb;
        };
        return b;
      };
    },
  });
}

beforeAll(async () => {
  for (const k of ['ENCRYPTION_KEY', 'ENTRY_ENCRYPTION_KEY']) saved[k] = process.env[k];
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.ENTRY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const port = await freePort();
  stub = spawn(process.execPath, [path.resolve(__dirname, '../e2e/mini-supabase.mjs')], {
    env: { ...process.env, STUB_PORT: String(port), E2E_DB_NAME: DB_NAME }, stdio: 'ignore',
  });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break;
    } catch { /* not up yet */ }
    if (i > 150) throw new Error('stub did not start');
    await new Promise((r) => setTimeout(r, 100));
  }
  db = createClient(`http://127.0.0.1:${port}`, 'stub-service-key', { auth: { persistSession: false, autoRefreshToken: false } });
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres');
  url.pathname = `/${DB_NAME}`;
  sqlc = new pg.Client({ connectionString: url.toString() });
  await sqlc.connect();
  await saveApiKey(db, ORG, 'synthetic-cognito-key-0000', ADMIN);
}, 60_000);

afterAll(async () => {
  await sqlc?.end();
  stub?.kill('SIGTERM');
  for (const [k, v] of Object.entries(saved)) process.env[k] = v;
});

beforeEach(async () => {
  await sql(`update import_runs set status = 'done' where status in ('queued', 'running')`);
  await sql(`delete from outbox_jobs`);
});

describe('import job on the real schema', () => {
  it('a dry run slice through the real sink finishes the form and releases its lease', async () => {
    const id = await newRun('request-for-invoice', 'dry_run');
    const s = await importSlice(db, ORG, id, later(), { makeSource: fakeSource() });
    expect(s).toMatchObject({ outcome: 'done', seen: 3 });
    expect(await run(id)).toMatchObject({ status: 'done', lease_token: null, error: null, report: expect.objectContaining({ seen: 3, toImport: 2 }) });
    expect((await run(id)).cursor.attempt).toBeUndefined();
  });

  it('L1: Stop is never lost, whenever the working slice finishes during it', async () => {
    for (const k of [1, 2, 3]) {
      await sql(`update import_runs set status = 'done' where status in ('queued', 'running')`);
      const id = await newRun('release-form', 'dry_run', 'running', `, now() + interval '1 minute', '${randomUUID()}'`);
      // The slice "finishes its budget" right after the k-th update: it frees the lease and queues its continuation.
      const finishSlice = async (n: number) => {
        if (n === k) await sql(`update import_runs set lease_until = null, lease_token = null where id = $1 and status = 'running'`, [id]);
      };
      expect(await stopImport(hooked(finishSlice), ORG, id)).toMatchObject({ ok: true });
      // The continuation then tries to claim the run.
      await importSlice(db, ORG, id, later(), { makeSource: fakeSource() });
      expect((await run(id)).status, `hook after update ${k}`).toBe('paused');
    }
  });

  it('L1: a running slice is asked to stop and pauses at its checkpoint; a queued run pauses at once', async () => {
    const queued = await newRun('store-room', 'dry_run');
    expect(await stopImport(db, ORG, queued)).toMatchObject({ ok: true });
    expect((await run(queued)).status).toBe('paused');
    const busy = await newRun('release-form', 'dry_run', 'running', `, now() + interval '1 minute', '${randomUUID()}'`);
    await stopImport(db, ORG, busy);
    expect(await run(busy)).toMatchObject({ status: 'running', stop_requested: true });
  });

  it('L2: a slice whose lease was taken over writes nothing more', async () => {
    const id = await newRun('request-for-invoice', 'dry_run');
    const thief = randomUUID();
    const steal = () => {
      const inner = new FakeSource(allFixtures());
      return {
        async *listEntries(form: Parameters<FakeSource['listEntries']>[0]) {
          await sql(`update import_runs set lease_token = $2 where id = $1`, [id, thief]);
          yield* inner.listEntries(form);
        },
        downloadFile: inner.downloadFile.bind(inner),
      } as CognitoSource;
    };
    const s = await importSlice(db, ORG, id, later(), { makeSource: steal });
    expect(s.outcome).toBe('lease_lost');
    expect(await run(id)).toMatchObject({ status: 'running', lease_token: thief, report: {}, error: null });
  });

  it('M1: a position that keeps killing slices fails the run (stuck_entry) instead of looping; Resume starts the count afresh', async () => {
    const id = await newRun('release-form', 'dry_run');
    for (let i = 1; i <= MAX_POSITION_ATTEMPTS; i++) {
      // A slice that never returns (the platform kills it at its time limit); its lease then runs out.
      void importSlice(db, ORG, id, later(), { makeSource: () => hanging() });
      await expect.poll(async () => (await run(id)).cursor.attempt).toMatchObject({ n: i });
      await sql(`update import_runs set lease_until = now() - interval '1 second' where id = $1`, [id]);
    }
    const s = await importSlice(db, ORG, id, later(), { makeSource: fakeSource() });
    expect(s).toMatchObject({ outcome: 'failed', error: 'stuck_entry' });
    expect(await run(id)).toMatchObject({ status: 'failed', error: 'stuck_entry', lease_token: null });

    expect(await resumeImport(db, MEMBER, id)).toMatchObject({ ok: true });
    expect((await run(id)).cursor.attempt).toBeUndefined();
    expect(await importSlice(db, ORG, id, later(), { makeSource: fakeSource() })).toMatchObject({ outcome: 'done' });
  });

  it('M1: Cognito asking to wait longer than the slice has frees the run visibly and continues after Retry-After; it gives up after the limit', async () => {
    const id = await newRun('release-form', 'dry_run');
    const limited = throwing(() => new SourceDeadlineError('cognito_rate_limited', 60_000));
    for (let i = 1; i <= MAX_POSITION_ATTEMPTS; i++) {
      expect(await importSlice(db, ORG, id, later(), { makeSource: limited })).toMatchObject({ outcome: 'retry', error: 'cognito_rate_limited' });
      expect(await run(id)).toMatchObject({ status: 'running', error: 'cognito_rate_limited', lease_token: null });
      expect((await run(id)).cursor.attempt).toMatchObject({ n: i, last: 'cognito_rate_limited' });
    }
    const jobs = await sql<{ wait: number }>(`select extract(epoch from run_at - now())::int as wait from outbox_jobs where payload->>'run_id' = $1`, [id]);
    expect(jobs).toHaveLength(MAX_POSITION_ATTEMPTS);
    for (const j of jobs) expect(j.wait).toBeGreaterThanOrEqual(50);
    expect(await importSlice(db, ORG, id, later(), { makeSource: limited })).toMatchObject({ outcome: 'failed', error: 'cognito_rate_limited' });
    expect(await run(id)).toMatchObject({ status: 'failed', error: 'cognito_rate_limited' });
  });

  it('M1: a request cut off at the step deadline continues at once from the last checkpoint, with no error shown', async () => {
    const id = await newRun('release-form', 'dry_run');
    expect(await importSlice(db, ORG, id, later(), { makeSource: throwing(() => new SourceDeadlineError('step_deadline')) })).toMatchObject({ outcome: 'retry' });
    expect(await run(id)).toMatchObject({ status: 'running', error: null, lease_token: null });
    const jobs = await sql<{ wait: number }>(`select extract(epoch from run_at - now())::int as wait from outbox_jobs where payload->>'run_id' = $1`, [id]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].wait).toBeLessThanOrEqual(1);
  });

  it('a failed claim and every drain leave a job_runs row', async () => {
    const id = await newRun('store-room', 'dry_run');
    const before = (await sql<{ n: number }>(`select count(*)::int as n from job_runs where job = 'cognito.import' and ok = false and error = 'import_runs claim failed'`))[0].n;
    await expect(importSlice(hooked(async () => undefined, 1), ORG, id, later(), { makeSource: fakeSource() })).rejects.toThrow('import_runs claim failed');
    const after = (await sql<{ n: number }>(`select count(*)::int as n from job_runs where job = 'cognito.import' and ok = false and error = 'import_runs claim failed'`))[0].n;
    expect(after).toBe(before + 1);

    await drainImportJobs(db, 5_000);
    expect(await sql(`select 1 from job_runs where job = 'cognito-import.drain' and finished_at is not null`)).not.toHaveLength(0);
  });

  it('Resume of an Import of an encrypted form needs ENTRY_ENCRYPTION_KEY, like Start', async () => {
    const id = await newRun('deal', 'apply', 'failed');
    const key = process.env.ENTRY_ENCRYPTION_KEY;
    delete process.env.ENTRY_ENCRYPTION_KEY;
    try {
      expect(await resumeImport(db, MEMBER, id)).toEqual({ ok: false, error: expect.stringContaining('ENTRY_ENCRYPTION_KEY is not set') });
      expect((await run(id)).status).toBe('failed');
    } finally {
      process.env.ENTRY_ENCRYPTION_KEY = key;
    }
    expect(await resumeImport(db, MEMBER, id)).toMatchObject({ ok: true });
  });
});
