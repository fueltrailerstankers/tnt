// 0007: xero_action_runs policies, claims and release recipients. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { as, connect } from './helpers';

const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_D = '00000000-0000-0000-0000-0000000000d4';
const ADMIN_A = '00000000-0000-0000-0000-00000000a701';
const STAFF_A = '00000000-0000-0000-0000-00000000a702';
const ADMIN_D = '00000000-0000-0000-0000-00000000d701';

let db: Client;

beforeAll(async () => {
  db = await connect();
  await db.query(`insert into auth.users(id, email) values ($1,'m3-admin-a@example.invalid'), ($2,'m3-staff-a@example.invalid'), ($3,'m3-admin-d@example.invalid') on conflict do nothing`, [ADMIN_A, STAFF_A, ADMIN_D]);
  await db.query(`insert into public.orgs(id, name) values ($1, 'Org D') on conflict do nothing`, [ORG_D]);
  await db.query(`insert into public.memberships(org_id, user_id, role) values ($1,$2,'admin'), ($1,$3,'staff'), ($4,$5,'admin') on conflict do nothing`, [ORG_A, ADMIN_A, STAFF_A, ORG_D, ADMIN_D]);
  await db.query(`insert into public.xero_action_runs(org_id, action, idempotency_key, mode, status, planned_requests) values
    ($1,'delivery.update_invoice','delivery.update_invoice:INV-0001','dry_run','planned','[{"step":"attach.f1","method":"PUT","path":"/Invoices/i1/Attachments/[file]"}]'),
    ($2,'release.on_paid','release.on_paid:i9','off','skipped','[]')`, [ORG_A, ORG_D]);
});

afterAll(async () => { await db.end(); });

const count = async (sql: string, params: unknown[] = []) => Number((await db.query(sql, params)).rows[0].n);

describe('xero_action_runs (0007)', () => {
  it('org admins read their own org runs only', async () => {
    await as(db, 'authenticated', ADMIN_A, async () => {
      expect(await count(`select count(*)::int as n from public.xero_action_runs where action = 'delivery.update_invoice'`)).toBe(1);
      expect(await count(`select count(*)::int as n from public.xero_action_runs where org_id = $1`, [ORG_D])).toBe(0);
    });
    await as(db, 'authenticated', ADMIN_D, async () => {
      expect(await count(`select count(*)::int as n from public.xero_action_runs where org_id = $1`, [ORG_A])).toBe(0);
      expect(await count(`select count(*)::int as n from public.xero_action_runs where org_id = $1`, [ORG_D])).toBe(1);
    });
  });

  it('staff members of the same org cannot read runs (admins only)', async () => {
    const n = await as(db, 'authenticated', STAFF_A, () => count(`select count(*)::int as n from public.xero_action_runs`));
    expect(n).toBe(0);
  });

  it('nobody but the server writes runs', async () => {
    for (const sql of [
      `insert into public.xero_action_runs(org_id, action, idempotency_key, mode, status) values ('${ORG_A}','rfi.create_invoice','k','live','succeeded')`,
      `update public.xero_action_runs set status = 'succeeded'`,
      `delete from public.xero_action_runs`,
    ]) {
      await expect(as(db, 'authenticated', ADMIN_A, () => db.query(sql))).rejects.toThrow(/permission denied/);
    }
    await expect(as(db, 'anon', null, () => db.query(`select 1 from public.xero_action_runs`))).rejects.toThrow(/permission denied/);
  });

  it('mode and status are constrained', async () => {
    await expect(db.query(`insert into public.xero_action_runs(org_id, action, idempotency_key, mode, status) values ($1,'rfi.create_invoice','k','yolo','planned')`, [ORG_A])).rejects.toThrow(/check/);
    await expect(db.query(`insert into public.xero_action_runs(org_id, action, idempotency_key, mode, status) values ($1,'rfi.create_invoice','k','live','done')`, [ORG_A])).rejects.toThrow(/check/);
    await expect(db.query(`insert into public.xero_action_runs(org_id, action, idempotency_key, mode, status) values ($1,'Bad Action','k','live','planned')`, [ORG_A])).rejects.toThrow(/check/);
  });
});

describe('claims and settings', () => {
  it('an action key can be claimed once per org (live writes are claimed exactly once)', async () => {
    await db.query(`insert into public.action_claims(org_id, action_key) values ($1,'rfi.create_invoice:m3-test#invoice.create')`, [ORG_A]);
    await expect(db.query(`insert into public.action_claims(org_id, action_key) values ($1,'rfi.create_invoice:m3-test#invoice.create')`, [ORG_A])).rejects.toThrow(/duplicate key/);
    await db.query(`insert into public.action_claims(org_id, action_key) values ($1,'rfi.create_invoice:m3-test#invoice.create')`, [ORG_D]);
    // The writer's conditional take-over of a rejected claim succeeds once.
    await db.query(`update public.action_claims set result = '{"status":"rejected","http":400}' where org_id = $1 and action_key = 'rfi.create_invoice:m3-test#invoice.create'`, [ORG_A]);
    const take = `update public.action_claims set result = null where org_id = $1 and action_key = 'rfi.create_invoice:m3-test#invoice.create' and result->>'status' = 'rejected'`;
    expect((await db.query(take, [ORG_A])).rowCount).toBe(1);
    expect((await db.query(take, [ORG_A])).rowCount).toBe(0);
    await expect(as(db, 'authenticated', ADMIN_A, () => db.query(`select 1 from public.action_claims`))).rejects.toThrow(/permission denied/);
  });

  it('no client changes action modes directly, not even an org admin (0009); the server does', async () => {
    await expect(as(db, 'authenticated', ADMIN_A, () =>
      db.query(`insert into public.app_settings(org_id, key, value) values ($1,'xero.action.rfi.create_invoice','"live"')`, [ORG_A]))).rejects.toThrow(/row-level security/);
    await expect(as(db, 'authenticated', STAFF_A, () =>
      db.query(`insert into public.app_settings(org_id, key, value) values ($1,'xero.action.rfi.create_invoice','"live"')`, [ORG_A]))).rejects.toThrow(/row-level security/);
    // Service role (the server action after its permission + confirmation checks).
    await db.query(`insert into public.app_settings(org_id, key, value) values ($1,'xero.action.rfi.create_invoice','"dry_run"')`, [ORG_A]);
    await as(db, 'authenticated', ADMIN_A, async () => {
      expect((await db.query(`update public.app_settings set value = '"live"' where org_id = $1 and key like 'xero.action.%'`, [ORG_A])).rowCount).toBe(0);
      expect((await db.query(`delete from public.app_settings where org_id = $1 and key like 'xero.action.%'`, [ORG_A])).rowCount).toBe(0);
      expect((await db.query(`select 1 from public.app_settings where org_id = $1 and key = 'xero.action.rfi.create_invoice'`, [ORG_A])).rowCount).toBe(1);
      // Other settings stay admin-writable.
      await db.query(`insert into public.app_settings(org_id, key, value) values ($1,'m3.test.other','1')`, [ORG_A]);
    });
    await as(db, 'authenticated', ADMIN_D, async () => {
      expect((await db.query(`update public.app_settings set value = '"live"' where org_id = $1`, [ORG_A])).rowCount).toBe(0);
    });
  });

  it('seeds the release.paid recipients for the default org only', async () => {
    const r = await db.query(`select address from public.notification_recipients where org_id = $1 and event_key = 'release.paid' order by address`, [ORG_A]);
    expect(r.rows.map((x) => x.address)).toEqual(['capetown@fueltrailers.co.za', 'durban@fueltrailers.co.za', 'sales@fueltrailers.co.za']);
    expect(await count(`select count(*)::int as n from public.notification_recipients where org_id = $1 and event_key = 'release.paid'`, [ORG_D])).toBe(0);
  });
});
