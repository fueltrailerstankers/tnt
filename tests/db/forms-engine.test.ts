import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { as, connect } from './helpers';

const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_C = '00000000-0000-0000-0000-0000000000c3';
const STAFF_A = '00000000-0000-0000-0000-00000000a101';
const ADMIN_C = '00000000-0000-0000-0000-00000000c101';

let db: Client;
let entry: string;

beforeAll(async () => {
  db = await connect();
  await db.query(`insert into auth.users(id, email) values ($1,'staff-a@example.invalid'), ($2,'admin-c@example.invalid') on conflict do nothing`, [STAFF_A, ADMIN_C]);
  await db.query(`insert into public.orgs(id, name) values ($1, 'Org C') on conflict do nothing`, [ORG_C]);
  await db.query(`insert into public.memberships(org_id, user_id, role) values ($1,$2,'staff'), ($3,$4,'admin') on conflict do nothing`, [ORG_A, STAFF_A, ORG_C, ADMIN_C]);
  const f = await db.query(`select id from public.forms where slug = 'job-card' and org_id = $1`, [ORG_A]);
  entry = (await db.query(
    `insert into public.entries(form_id, number, status, data, summary) values ($1, 0, 'Submitted', '{"QuoteNo":"QTEST-9001","Line1":"Synthetic line"}', 'QTEST-9001') returning id`,
    [f.rows[0].id],
  )).rows[0].id;
});

afterAll(async () => { await db.end(); });

describe('0005 forms engine', () => {
  it('search_text covers the summary and data, lower-cased', async () => {
    const r = await db.query(`select search_text from public.entries where id = $1`, [entry]);
    expect(r.rows[0].search_text).toContain('qtest-9001');
    expect(r.rows[0].search_text).toContain('synthetic line');
  });

  it('seeds notification recipients from the spec inboxes for the default org only', async () => {
    const r = await db.query(`select event_key, address from public.notification_recipients where org_id = $1 and event_key like '%.%' order by event_key`, [ORG_A]);
    expect(r.rows).toContainEqual({ event_key: 'store-room.Submit', address: 'factory@fueltrailers.co.za' });
    expect(r.rows).toContainEqual({ event_key: 'request-for-invoice.Update', address: 'accounts@fueltrailers.co.za' });
    expect(r.rows).toContainEqual({ event_key: 'trailer-inspection-checklist.SubmitInspection', address: 'sales@fueltrailers.co.za' });
    const c = await db.query(`select count(*)::int as n from public.notification_recipients where org_id = $1`, [ORG_C]);
    expect(c.rows[0].n).toBe(0);
  });

  it('form_overview counts unread per caller and is scoped to the caller org', async () => {
    const before = await as(db, 'authenticated', STAFF_A, async () =>
      (await db.query(`select entries::int, unread::int from public.form_overview() where slug = 'job-card'`)).rows[0]);
    expect(before.unread).toBeGreaterThanOrEqual(1);
    await db.query(`insert into public.entry_reads(entry_id, user_id) values ($1, $2)`, [entry, STAFF_A]);
    const after = await as(db, 'authenticated', STAFF_A, async () =>
      (await db.query(`select unread::int from public.form_overview() where slug = 'job-card'`)).rows[0]);
    expect(after.unread).toBe(before.unread - 1);

    const other = await as(db, 'authenticated', ADMIN_C, async () => (await db.query(`select * from public.form_overview()`)).rows);
    expect(other).toEqual([]);
  });

  it('anon cannot call form_overview', async () => {
    await expect(as(db, 'anon', null, () => db.query(`select * from public.form_overview()`))).rejects.toThrow(/permission denied/);
  });

  it('entry_documents rows are immutable and not writable by clients', async () => {
    const d = await db.query(
      `insert into public.entry_documents(entry_id, template_number, storage_path, sha256) values ($1, 1, 'job-card/x/1.pdf', 'abc') returning id`, [entry]);
    await expect(db.query(`update public.entry_documents set sha256 = 'x' where id = $1`, [d.rows[0].id])).rejects.toThrow(/immutable/);
    await expect(as(db, 'authenticated', STAFF_A, () =>
      db.query(`insert into public.entry_documents(entry_id, template_number, storage_path) values ($1, 1, 'p')`, [entry]))).rejects.toThrow(/permission denied/);
  });

  it('entry_links has no token default (the app stores a hash) and staff cannot read links', async () => {
    await expect(db.query(`insert into public.entry_links(entry_id, role_name) values ($1, 'Inspector')`, [entry])).rejects.toThrow(/null value/);
    const n = await as(db, 'authenticated', STAFF_A, async () => (await db.query(`select count(*)::int as n from public.entry_links`)).rows[0].n);
    expect(n).toBe(0);
  });

  it('staff can read entries but cannot delete them', async () => {
    await as(db, 'authenticated', STAFF_A, async () => {
      expect((await db.query(`select count(*)::int as n from public.entries where id = $1`, [entry])).rows[0].n).toBe(1);
      expect((await db.query(`delete from public.entries where id = $1`, [entry])).rowCount).toBe(0);
    });
  });

  it('upload size limits are set on the private buckets', async () => {
    const r = await db.query(`select id, file_size_limit::int as l, public from storage.buckets order by id`);
    expect(r.rows).toEqual([
      { id: 'documents', l: 50 * 1024 * 1024, public: false },
      { id: 'entry-files', l: 20 * 1024 * 1024, public: false },
    ]);
  });
});

describe('list_entries', () => {
  it('pages, searches and filters by read state as the caller', async () => {
    const form = (await db.query(`select id from public.forms where slug = 'job-card' and org_id = $1`, [ORG_A])).rows[0].id;
    const rows = await as(db, 'authenticated', STAFF_A, async () =>
      (await db.query(`select number, is_read, total::int from public.list_entries($1, 'all', null, 'qtest-9001')`, [form])).rows);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toBe(1);
    const unread = await as(db, 'authenticated', STAFF_A, async () =>
      (await db.query(`select id from public.list_entries($1, 'unread')`, [form])).rows.map((r) => r.id));
    expect(unread).not.toContain(entry); // marked read in the form_overview test
    const other = await as(db, 'authenticated', ADMIN_C, async () => (await db.query(`select * from public.list_entries($1)`, [form])).rows);
    expect(other).toEqual([]);
  });
});
