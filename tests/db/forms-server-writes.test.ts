// 0022: forms are server-written only; encryption and archive invariants; atomic workflow sync; form_usage;
// and the live-DB order (0018 and 0022 applied after 0011-0020).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { as, connect } from './helpers';

const ORG_A = '00000000-0000-0000-0000-000000000001';
const ADMIN = '00000000-0000-0000-0000-00000000a022';
let db: Client;

async function form(slug: string): Promise<string> {
  return (await db.query(`select id from public.forms where slug = $1 and org_id = $2`, [slug, ORG_A])).rows[0].id;
}

beforeAll(async () => {
  db = await connect();
  await db.query(`insert into auth.users(id, email) values ($1,'fw-admin@example.invalid') on conflict do nothing`, [ADMIN]);
  await db.query(`insert into public.memberships(org_id, user_id, role) values ($1,$2,'admin') on conflict do nothing`, [ORG_A, ADMIN]);
});
afterAll(async () => { await db.end(); });

describe('0022 forms are written by the server only', () => {
  it('authenticated users (even admins) cannot insert, update or delete forms; they still read them', async () => {
    const id = await form('release-form');
    await as(db, 'authenticated', ADMIN, async () => {
      expect((await db.query(`select count(*)::int as n from public.forms`)).rows[0].n).toBeGreaterThan(0);
    });
    await expect(as(db, 'authenticated', ADMIN, () => db.query(`update public.forms set is_active = false where id = $1`, [id]))).rejects.toThrow(/permission denied/);
    await expect(as(db, 'authenticated', ADMIN, () => db.query(`insert into public.forms(org_id, slug, name, internal_name, spec) values ($1,'x','x','x','{}')`, [ORG_A]))).rejects.toThrow(/permission denied/);
    await expect(as(db, 'authenticated', ADMIN, () => db.query(`delete from public.forms where id = $1`, [id]))).rejects.toThrow(/permission denied/);
  });

  it('deal and delivery-note are always encrypted', async () => {
    for (const slug of ['deal', 'delivery-note']) {
      await expect(as(db, 'service_role', null, () => db.query(`update public.forms set encrypt_entries = false where slug = $1`, [slug]))).rejects.toThrow(/always encrypted/);
    }
  });

  it('encryption cannot change once a form has entries (checked inside the update)', async () => {
    const id = await form('store-room');
    await as(db, 'service_role', null, async () => {
      await db.query(`insert into public.entries(form_id, number, status, data) values ($1, 0, 'Submitted', '{"x":"1"}')`, [id]);
      await expect(db.query(`update public.forms set encrypt_entries = true where id = $1`, [id])).rejects.toThrow(/cannot change once the form has entries/);
    });
    const empty = await form('job-card');
    await as(db, 'service_role', null, async () => {
      await db.query(`delete from public.entries where form_id = $1`, [empty]);
      await db.query(`update public.forms set encrypt_entries = true where id = $1`, [empty]);
    });
  });

  it('an entry must match its form encryption (closes the race with a first entry)', async () => {
    const deal = await form('deal');
    const plain = await form('release-form');
    await as(db, 'service_role', null, async () => {
      await db.query('savepoint s');
      await expect(db.query(`insert into public.entries(form_id, number, status, data) values ($1, 0, 'Submitted', '{"QUOTENO":"QTEST-22"}')`, [deal])).rejects.toThrow(/must be encrypted/);
      await db.query('rollback to savepoint s');
      await db.query(`insert into public.entries(form_id, number, status, data, data_encrypted) values ($1, 0, 'Submitted', '{}', '\\x01')`, [deal]);
    });
    await as(db, 'service_role', null, async () => {
      await expect(db.query(`insert into public.entries(form_id, number, status, data, data_encrypted) values ($1, 0, 'Submitted', '{}', '\\x01')`, [plain])).rejects.toThrow(/cannot be encrypted/);
    });
  });

  it('an archived form cannot be active', async () => {
    const id = await form('release-form');
    await expect(as(db, 'service_role', null, () => db.query(`update public.forms set archived_at = now(), is_active = true where id = $1`, [id]))).rejects.toThrow(/archived/);
  });

  it('sync_form_workflow replaces statuses and roles in one call; server only', async () => {
    const id = await form('job-card');
    await as(db, 'service_role', null, async () => {
      await db.query(`select public.sync_form_workflow($1, '[{"name":"Incomplete","color":"gray","sort_order":0},{"name":"Done","color":"green","sort_order":1}]', '[{"name":"Public","is_public":true}]')`, [id]);
      expect((await db.query(`select name from public.form_statuses where form_id = $1 order by sort_order`, [id])).rows.map((r) => r.name)).toEqual(['Incomplete', 'Done']);
      // A failing insert (duplicate name) leaves the old rows: one statement, one transaction.
      await db.query('savepoint s');
      await expect(db.query(`select public.sync_form_workflow($1, '[{"name":"A","color":"x","sort_order":0},{"name":"A","color":"x","sort_order":1}]', '[]')`, [id])).rejects.toThrow(/duplicate/);
      await db.query('rollback to savepoint s');
      expect((await db.query(`select count(*)::int as n from public.form_statuses where form_id = $1`, [id])).rows[0].n).toBe(2);
    });
    await expect(as(db, 'authenticated', ADMIN, () => db.query(`select public.sync_form_workflow($1, '[]', '[]')`, [id]))).rejects.toThrow(/permission denied/);
  });

  it('form_usage lists statuses in use and roles with live links', async () => {
    const id = await form('release-form');
    const e = await db.query(`insert into public.entries(form_id, number, status, data) values ($1, 0, 'Reviewed', '{}') returning id`, [id]);
    await db.query(`insert into public.entry_links(token, entry_id, role_name) values (repeat('b', 64), $1, 'Customer'), (repeat('c', 64), $1, 'Gone')`, [e.rows[0].id]);
    await db.query(`update public.entry_links set revoked_at = now() where role_name = 'Gone'`);
    const rows = await as(db, 'authenticated', ADMIN, async () => (await db.query(`select kind, name from public.form_usage($1) order by 1, 2`, [id])).rows);
    expect(rows).toEqual(expect.arrayContaining([{ kind: 'status', name: 'Reviewed' }, { kind: 'role', name: 'Customer' }]));
    expect(rows).not.toContainEqual({ kind: 'role', name: 'Gone' });
  });
});

describe('live-DB order: 0018 and 0022 after 0011-0020', () => {
  it('applies cleanly on a database that already has every other migration', async () => {
    const name = `${process.env.TEST_DB_NAME ?? 'tt_test'}_order`;
    const adminUrl = process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres';
    const admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.query(`create database ${name}`);
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    const c = new Client({ connectionString: url.toString() });
    await c.connect();
    try {
      const root = path.resolve(__dirname, '../..');
      await c.query(readFileSync(path.join(root, 'tests/db/shim.sql'), 'utf8'));
      const dir = path.join(root, 'supabase/migrations');
      const all = readdirSync(dir).filter((n) => n.endsWith('.sql')).sort();
      const late = ['0018_form_builder.sql', '0022_forms_server_writes.sql'];
      for (const f of [...all.filter((n) => !late.includes(n)), ...late]) await c.query(readFileSync(path.join(dir, f), 'utf8'));
      expect((await c.query(`select count(*)::int as n from public.form_versions`)).rows[0].n).toBe(7);
    } finally {
      await c.end();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    }
  }, 60_000);
});
