import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { as, connect } from './helpers';

// 0023 leads actions: lead_merge, lead_not_duplicate, lead_set_branch. Access and org re-checked in SQL, stale
// pages refused under the row lock, nothing deleted, events + audit rows with ids/codes only. Synthetic data only.
const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_D = '00000000-0000-0000-0000-0000000000d5';
const U = (n: number) => `00000000-0000-0000-0000-0000000023${String(n).padStart(2, '0')}`;
const ADMIN_A = U(1);
const STAFF_A = U(2);
const REVIEWER_A = U(3);
const READER_A = U(4); // staff with Leads read only
const ADMIN_D = U(5);

let db: Client;
let original: string;
let dup: string;
let later: string;
let other: string;
let foreign: string;

const lead = async (org: string, ext: string, extra: Record<string, unknown> = {}) => {
  const cols = ['org_id', 'source', 'external_id', 'email_norm', ...Object.keys(extra)];
  const vals = [org, 'test', ext, `${ext}@example.invalid`, ...Object.values(extra)];
  return (await db.query(`insert into public.leads(${cols.join(', ')}) values (${vals.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, vals)).rows[0].id as string;
};

beforeAll(async () => {
  db = await connect();
  await db.query(
    `insert into auth.users(id, email) values ($1,'la-admin@example.invalid'), ($2,'la-staff@example.invalid'), ($3,'la-reviewer@example.invalid'), ($4,'la-reader@example.invalid'), ($5,'la-admin-d@example.invalid') on conflict do nothing`,
    [ADMIN_A, STAFF_A, REVIEWER_A, READER_A, ADMIN_D],
  );
  await db.query(`insert into public.orgs(id, name) values ($1, 'Org D5') on conflict do nothing`, [ORG_D]);
  await db.query(
    `insert into public.memberships(org_id, user_id, role) values ($1,$2,'admin'), ($1,$3,'staff'), ($1,$4,'reviewer'), ($1,$5,'staff'), ($6,$7,'admin') on conflict do nothing`,
    [ORG_A, ADMIN_A, STAFF_A, REVIEWER_A, READER_A, ORG_D, ADMIN_D],
  );
  await db.query(`update public.memberships set access = access || '{"leads":"read"}' where org_id = $1 and user_id = $2`, [ORG_A, READER_A]);
  await db.query(`insert into public.lead_sources(org_id, key, name) values ($1, 'test', 'Test') on conflict do nothing`, [ORG_D]);
  original = await lead(ORG_A, 'la-1');
  dup = await lead(ORG_A, 'la-2', { duplicate_of: original });
  later = await lead(ORG_A, 'la-3', { duplicate_of: dup });
  other = await lead(ORG_A, 'la-4');
  foreign = await lead(ORG_D, 'la-5', { duplicate_of: null });
});

afterAll(async () => { await db.end(); });

const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
const count = async (sql: string, params: unknown[] = []) => Number((await one(sql, params)).n);

/** Runs one RPC as the user and expects it to fail with the given code (message) and hint 'leads'. */
const refused = async (user: string, sql: string, params: unknown[], code: string) => {
  await expect(as(db, 'authenticated', user, () => db.query(sql, params))).rejects.toMatchObject({ message: code, hint: 'leads' });
};

const MERGE = 'select public.lead_merge($1, $2, $3) as r';
const NOT_DUP = 'select public.lead_not_duplicate($1, $2, $3) as r';
const BRANCH = 'select public.lead_set_branch($1, $2, $3) as r';

describe('access', () => {
  it('reviewers, Leads-read members and other orgs are refused (FORBIDDEN) and nothing changes', async () => {
    for (const u of [REVIEWER_A, READER_A, ADMIN_D]) {
      await refused(u, MERGE, [ORG_A, dup, original], 'FORBIDDEN');
      await refused(u, NOT_DUP, [ORG_A, dup, original], 'FORBIDDEN');
      await refused(u, BRANCH, [ORG_A, dup, 'Durban'], 'FORBIDDEN');
    }
    // Leads write in your own org never reaches another org's lead: it is not found.
    await refused(ADMIN_D, BRANCH, [ORG_D, dup, 'Durban'], 'LEAD_NOT_FOUND');
    await refused(STAFF_A, BRANCH, [ORG_A, foreign, 'Durban'], 'LEAD_NOT_FOUND');
    await refused(STAFF_A, BRANCH, [ORG_D, foreign, 'Durban'], 'FORBIDDEN');
    const r = await one(`select merged_into, duplicate_of, branch from public.leads where id = $1`, [dup]);
    expect(r).toEqual({ merged_into: null, duplicate_of: original, branch: null });
    expect(await count(`select count(*) as n from public.audit_log where action like 'lead.%' and entity_id = any($1)`, [[dup, foreign]])).toBe(0);
  });

  it('anon cannot run the RPCs; nobody can call the internal helpers', async () => {
    await expect(as(db, 'anon', null, () => db.query(MERGE, [ORG_A, dup, original]))).rejects.toThrow(/permission denied/);
    await expect(as(db, 'authenticated', ADMIN_A, () => db.query(`select public.lead_require_write($1)`, [ORG_A]))).rejects.toThrow(/permission denied/);
    await expect(as(db, 'authenticated', ADMIN_A, () => db.query(`select public.lead_raise('X')`))).rejects.toThrow(/permission denied/);
  });

  it('direct writes to the new columns stay refused (server and RPCs only)', async () => {
    await expect(as(db, 'authenticated', ADMIN_A, () => db.query(`update public.leads set merged_into = $1 where id = $2`, [original, dup]))).rejects.toThrow(/permission denied/);
  });
});

describe('lead_merge', () => {
  it('links the duplicate to its original, repoints later duplicates, records events and the audit row', async () => {
    await as(db, 'authenticated', STAFF_A, async () => {
      const r = (await db.query(MERGE, [ORG_A, dup, original])).rows[0].r;
      expect(r).toEqual({ lead: dup, into: original, repointed: 1 });
    });
    // as() rolled back: run again for real inside a transaction we inspect.
    await db.query('begin');
    try {
      await db.query(`set local role authenticated`);
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: STAFF_A, role: 'authenticated' })]);
      await db.query(MERGE, [ORG_A, dup, original]);
      await db.query('reset role');
      const d = await one(`select merged_into, merged_by, merged_at is not null as at, duplicate_of, status from public.leads where id = $1`, [dup]);
      expect(d).toEqual({ merged_into: original, merged_by: STAFF_A, at: true, duplicate_of: original, status: 'new' });
      expect((await one(`select duplicate_of from public.leads where id = $1`, [later])).duplicate_of).toBe(original);
      const ev = (await db.query(`select lead_id, kind, actor, meta from public.lead_events where lead_id = any($1) order by kind`, [[dup, original]])).rows;
      expect(ev).toEqual([
        { lead_id: dup, kind: 'merged', actor: STAFF_A, meta: { into: original } },
        { lead_id: original, kind: 'merged_from', actor: STAFF_A, meta: { from: dup, repointed: 1 } },
      ]);
      const a = (await db.query(`select org_id, actor_user, entity, entity_id, meta from public.audit_log where action = 'lead.merge'`)).rows;
      expect(a).toEqual([{ org_id: ORG_A, actor_user: STAFF_A, entity: 'lead', entity_id: dup, meta: { into: original, repointed: 1 } }]);
      // Nothing deleted.
      expect(await count(`select count(*) as n from public.leads where id = any($1)`, [[original, dup, later]])).toBe(3);
    } finally {
      await db.query('rollback');
    }
  });

  it('refuses stale or invalid merges', async () => {
    await refused(STAFF_A, MERGE, [ORG_A, dup, other], 'DUPLICATE_CHANGED');
    await refused(STAFF_A, MERGE, [ORG_A, other, original], 'DUPLICATE_CHANGED');
    await refused(STAFF_A, MERGE, [ORG_A, dup, dup], 'INVALID_INPUT');
    await refused(STAFF_A, MERGE, [ORG_A, dup, foreign], 'LEAD_NOT_FOUND');
  });

  it('a merged lead cannot be merged again, dismissed or re-branched; nothing merges into it', async () => {
    await db.query('begin');
    try {
      await db.query(`update public.leads set merged_into = $1 where id = $2`, [original, dup]);
      for (const [sql, params] of [
        [MERGE, [ORG_A, dup, original]], [NOT_DUP, [ORG_A, dup, original]], [BRANCH, [ORG_A, dup, 'Durban']], [MERGE, [ORG_A, later, dup]],
      ] as const) {
        await db.query('savepoint s');
        await db.query(`set local role authenticated`);
        await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: STAFF_A, role: 'authenticated' })]);
        await expect(db.query(sql, [...params])).rejects.toMatchObject({ message: 'LEAD_MERGED' });
        await db.query('rollback to savepoint s');
        await db.query('reset role');
      }
    } finally {
      await db.query('rollback');
    }
  });

  it('a lead cannot be merged into itself (constraint)', async () => {
    await expect(db.query(`update public.leads set merged_into = id where id = $1`, [other])).rejects.toMatchObject({ code: '23514' });
  });
});

describe('lead_not_duplicate', () => {
  it('clears the flag, remembers the original and records the event and audit row', async () => {
    await db.query('begin');
    try {
      await db.query(`set local role authenticated`);
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN_A, role: 'authenticated' })]);
      expect((await one(NOT_DUP, [ORG_A, dup, original])).r).toEqual({ lead: dup, of: original });
      await db.query('reset role');
      const d = await one(`select duplicate_of, not_duplicate_of, duplicate_dismissed_by from public.leads where id = $1`, [dup]);
      expect(d).toEqual({ duplicate_of: null, not_duplicate_of: original, duplicate_dismissed_by: ADMIN_A });
      expect(await one(`select kind, meta from public.lead_events where lead_id = $1`, [dup])).toEqual({ kind: 'not_duplicate', meta: { of: original } });
      expect(await one(`select entity_id, meta from public.audit_log where action = 'lead.not_duplicate'`)).toEqual({ entity_id: dup, meta: { of: original } });
      // The dismissed original can never be set as its duplicate_of again.
      await expect(db.query(`update public.leads set duplicate_of = $1 where id = $2`, [original, dup])).rejects.toMatchObject({ code: '23514' });
    } finally {
      await db.query('rollback');
    }
  });

  it('refuses when the flag changed since the page was read', async () => {
    await refused(STAFF_A, NOT_DUP, [ORG_A, dup, other], 'DUPLICATE_CHANGED');
    await refused(STAFF_A, NOT_DUP, [ORG_A, other, original], 'DUPLICATE_CHANGED');
  });
});

describe('lead_set_branch', () => {
  it('sets, keeps and clears the branch; writes only on a change', async () => {
    await db.query('begin');
    try {
      await db.query(`set local role authenticated`);
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: STAFF_A, role: 'authenticated' })]);
      expect((await one(BRANCH, [ORG_A, other, '  Cape Town '])).r).toEqual({ lead: other, changed: true });
      expect((await one(BRANCH, [ORG_A, other, 'Cape Town'])).r).toEqual({ lead: other, changed: false });
      expect((await one(BRANCH, [ORG_A, other, ''])).r).toEqual({ lead: other, changed: true });
      await db.query('reset role');
      expect((await one(`select branch from public.leads where id = $1`, [other])).branch).toBeNull();
      const ev = (await db.query(`select meta from public.lead_events where lead_id = $1 and kind = 'branch' order by created_at, id`, [other])).rows.map((r) => r.meta);
      expect(ev).toHaveLength(2);
      expect(ev).toContainEqual({ from: null, to: 'Cape Town' });
      expect(ev).toContainEqual({ from: 'Cape Town', to: null });
      expect(await count(`select count(*) as n from public.audit_log where action = 'lead.branch' and entity_id = $1`, [other])).toBe(2);
    } finally {
      await db.query('rollback');
    }
  });

  it('refuses branch names the intake schema would refuse', async () => {
    for (const b of ['1 Durban', 'Durban; drop', 'x'.repeat(61), 'Cape<Town>']) {
      await refused(STAFF_A, BRANCH, [ORG_A, other, b], 'INVALID_INPUT');
    }
  });
});
