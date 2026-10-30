// 0020 Cognito import: the key table is service-only, runs are readable by org admins only and written by the server
// only, one active run per form, error is a reason code. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { as, connect } from './helpers';

const ORG = '00000000-0000-0000-0000-0000000000c9';
const OTHER = '00000000-0000-0000-0000-0000000000ca';
const ADMIN = '00000000-0000-0000-0000-00000000c901';
const STAFF = '00000000-0000-0000-0000-00000000c902';
const REVIEWER = '00000000-0000-0000-0000-00000000c903';
const OTHER_ADMIN = '00000000-0000-0000-0000-00000000ca01';

let db: Client;
let runId: string;

beforeAll(async () => {
  db = await connect();
  await db.query(`insert into public.orgs(id, name) values ($1, 'Org C9'), ($2, 'Org CA')`, [ORG, OTHER]);
  await db.query(`insert into auth.users(id, email) values ($1,'c9-admin@example.invalid'), ($2,'c9-staff@example.invalid'), ($3,'c9-rev@example.invalid'), ($4,'ca-admin@example.invalid')`,
    [ADMIN, STAFF, REVIEWER, OTHER_ADMIN]);
  await db.query(`insert into public.memberships(org_id, user_id, role) values ($1,$2,'admin'), ($1,$3,'staff'), ($1,$4,'reviewer'), ($5,$6,'admin')`,
    [ORG, ADMIN, STAFF, REVIEWER, OTHER, OTHER_ADMIN]);
  await db.query(`insert into public.cognito_api_keys(org_id, key_enc, last4, created_by) values ($1, '\\x0102', 'wxyz', $2)`, [ORG, ADMIN]);
  const r = await db.query(
    `insert into public.import_runs(org_id, form_slug, mode, status, report, started_by) values ($1, 'release-form', 'apply', 'done', '{"seen":3}', $2) returning id`,
    [ORG, ADMIN]);
  runId = r.rows[0].id;
});

afterAll(async () => { await db.end(); });

describe('cognito_api_keys (service role only)', () => {
  for (const [who, role, id] of [['admin', 'authenticated', ADMIN], ['staff', 'authenticated', STAFF], ['anon', 'anon', null]] as const) {
    it(`${who} cannot read, write or delete the key table`, async () => {
      for (const sql of [
        `select key_enc from public.cognito_api_keys`,
        `select last4 from public.cognito_api_keys`,
        `update public.cognito_api_keys set last4 = 'x'`,
        `delete from public.cognito_api_keys`,
        `insert into public.cognito_api_keys(org_id, key_enc, last4) values ('${ORG}', '\\x01', 'a')`,
      ]) {
        await expect(as(db, role, id, () => db.query(sql))).rejects.toThrow(/permission denied/);
      }
    });
  }

  it('one key per org; the service role reads it', async () => {
    await expect(db.query(`insert into public.cognito_api_keys(org_id, key_enc, last4) values ($1, '\\x03', 'abcd')`, [ORG])).rejects.toThrow(/duplicate key/);
    const r = await as(db, 'service_role', null, () => db.query(`select last4 from public.cognito_api_keys where org_id = $1`, [ORG]));
    expect(r.rows).toEqual([{ last4: 'wxyz' }]);
  });

  it('keeps at most 4 clear characters', async () => {
    await expect(db.query(`insert into public.cognito_api_keys(org_id, key_enc, last4) values ($1, '\\x03', 'abcde')`, [OTHER])).rejects.toThrow(/check constraint/);
  });
});

describe('import_runs', () => {
  it('org admins read their own runs; staff, reviewers and other orgs see none', async () => {
    const count = (user: string) => as(db, 'authenticated', user, async () =>
      (await db.query(`select count(*)::int as n from public.import_runs where org_id = $1`, [ORG])).rows[0].n as number);
    expect(await count(ADMIN)).toBe(1);
    expect(await count(STAFF)).toBe(0);
    expect(await count(REVIEWER)).toBe(0);
    expect(await count(OTHER_ADMIN)).toBe(0);
  });

  it('even an org admin cannot write runs; only the server does', async () => {
    for (const sql of [
      `insert into public.import_runs(org_id, form_slug, mode) values ('${ORG}', 'deal', 'apply')`,
      `update public.import_runs set status = 'queued' where id = '${runId}'`,
      `delete from public.import_runs where id = '${runId}'`,
    ]) {
      await expect(as(db, 'authenticated', ADMIN, () => db.query(sql))).rejects.toThrow(/permission denied/);
    }
  });

  it('allows one queued or running run per org and form', async () => {
    await as(db, 'service_role', null, async () => {
      await db.query(`insert into public.import_runs(org_id, form_slug, mode, status) values ($1, 'deal', 'dry_run', 'queued')`, [ORG]);
      await expect(db.query(`insert into public.import_runs(org_id, form_slug, mode, status) values ($1, 'deal', 'apply', 'running')`, [ORG]))
        .rejects.toThrow(/import_runs_one_active_idx/);
    });
    // Paused, done and failed runs do not block a new run; another org is independent.
    await as(db, 'service_role', null, async () => {
      await db.query(`insert into public.import_runs(org_id, form_slug, mode, status) values ($1, 'deal', 'dry_run', 'paused'), ($1, 'deal', 'apply', 'failed')`, [ORG]);
      await db.query(`insert into public.import_runs(org_id, form_slug, mode, status) values ($1, 'deal', 'dry_run', 'queued')`, [ORG]);
      await db.query(`insert into public.import_runs(org_id, form_slug, mode, status) values ($1, 'deal', 'dry_run', 'queued')`, [OTHER]);
    });
  });

  it('error holds a reason code, never a message; mode and status are fixed sets', async () => {
    await expect(db.query(`update public.import_runs set error = 'Cognito said: customer X not found' where id = $1`, [runId])).rejects.toThrow(/check constraint/);
    await db.query(`update public.import_runs set error = 'cognito_auth' where id = $1`, [runId]);
    await expect(db.query(`update public.import_runs set status = 'cancelled' where id = $1`, [runId])).rejects.toThrow(/check constraint/);
    await expect(db.query(`insert into public.import_runs(org_id, form_slug, mode) values ($1, 'deal', 'live')`, [OTHER])).rejects.toThrow(/check constraint/);
    await expect(db.query(`insert into public.import_runs(org_id, form_slug, mode) values ($1, '../deal', 'apply')`, [OTHER])).rejects.toThrow(/check constraint/);
  });

  it('updated_at moves on every update', async () => {
    const before = (await db.query(`select updated_at from public.import_runs where id = $1`, [runId])).rows[0].updated_at as Date;
    await db.query(`select pg_sleep(0.01)`);
    await db.query(`update public.import_runs set report = '{"seen":4}' where id = $1`, [runId]);
    const after = (await db.query(`select updated_at from public.import_runs where id = $1`, [runId])).rows[0].updated_at as Date;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});
