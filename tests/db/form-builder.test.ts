// 0018 form builder: form_versions (append-only, server-only writes), form_data_keys, archived forms.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { as, connect } from './helpers';

const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_C = '00000000-0000-0000-0000-0000000000c3';
const ADMIN = '00000000-0000-0000-0000-00000000a018';
const STAFF = '00000000-0000-0000-0000-00000000a019';
const OTHER = '00000000-0000-0000-0000-00000000c018';
let db: Client;
let formId: string;

beforeAll(async () => {
  db = await connect();
  await db.query(`insert into auth.users(id, email) values ($1,'fb-admin@example.invalid'), ($2,'fb-staff@example.invalid'), ($3,'fb-other@example.invalid') on conflict do nothing`, [ADMIN, STAFF, OTHER]);
  await db.query(`insert into public.orgs(id, name) values ($1, 'Org C') on conflict do nothing`, [ORG_C]);
  await db.query(`insert into public.memberships(org_id, user_id, role) values ($1,$2,'admin'), ($1,$3,'staff'), ($4,$5,'admin') on conflict do nothing`, [ORG_A, ADMIN, STAFF, ORG_C, OTHER]);
  formId = (await db.query(`select id from public.forms where slug = 'job-card' and org_id = $1`, [ORG_A])).rows[0].id;
});
afterAll(async () => { await db.end(); });

describe('0018 form builder', () => {
  it('backfills version 1 for every existing form, with org_id from the form', async () => {
    const r = await db.query(`select count(*)::int as n, bool_and(v.org_id = f.org_id) as ok from public.form_versions v join public.forms f on f.id = v.form_id where v.version = 1`);
    expect(r.rows[0].n).toBeGreaterThanOrEqual(7);
    expect(r.rows[0].ok).toBe(true);
    const f = await db.query(`select version, draft_spec, archived_at from public.forms where id = $1`, [formId]);
    expect(f.rows[0]).toMatchObject({ version: 1, draft_spec: null, archived_at: null });
  });

  it('members read versions of their org only', async () => {
    const a = await as(db, 'authenticated', STAFF, async () => (await db.query(`select count(*)::int as n from public.form_versions where form_id = $1`, [formId])).rows[0].n);
    expect(a).toBe(1);
    const c = await as(db, 'authenticated', OTHER, async () => (await db.query(`select count(*)::int as n from public.form_versions where form_id = $1`, [formId])).rows[0].n);
    expect(c).toBe(0);
  });

  it('clients (even admins) cannot write versions', async () => {
    await expect(as(db, 'authenticated', ADMIN, () => db.query(`insert into public.form_versions(form_id, version, spec) values ($1, 99, '{}')`, [formId]))).rejects.toThrow(/permission denied/);
    await expect(as(db, 'authenticated', ADMIN, () => db.query(`update public.form_versions set note = 'x' where form_id = $1`, [formId]))).rejects.toThrow(/permission denied/);
    await expect(as(db, 'authenticated', ADMIN, () => db.query(`delete from public.form_versions where form_id = $1`, [formId]))).rejects.toThrow(/permission denied/);
  });

  it('versions are append-only even for the server; org_id is taken from the form', async () => {
    await as(db, 'service_role', null, async () => {
      const r = await db.query(`insert into public.form_versions(form_id, org_id, version, spec, note) values ($1, $2, 2, '{}', 'v2') returning org_id`, [formId, ORG_C]);
      expect(r.rows[0].org_id).toBe(ORG_A);
      await expect(db.query(`update public.form_versions set note = 'changed' where form_id = $1`, [formId])).rejects.toThrow(/append-only/);
    });
    await as(db, 'service_role', null, async () => {
      await expect(db.query(`delete from public.form_versions where form_id = $1`, [formId])).rejects.toThrow(/append-only/);
    });
    await expect(db.query(`insert into public.form_versions(form_id, version, spec) values ($1, 1, '{}')`, [formId])).rejects.toThrow(/duplicate key/);
  });

  it('form_data_keys lists data keys and file field keys, within RLS', async () => {
    const e = await db.query(`insert into public.entries(form_id, number, status, data) values ($1, 0, 'Submitted', '{"QuoteNo":"QTEST-18","LINE1":"x"}') returning id`, [formId]);
    await db.query(`insert into public.entry_files(entry_id, field_key, storage_path, file_name) values ($1,'Photo','job-card/x/p.png','p.png')`, [e.rows[0].id]);
    const keys = await as(db, 'authenticated', ADMIN, async () => (await db.query(`select k from public.form_data_keys($1) k order by 1`, [formId])).rows.map((r) => r.k));
    expect(keys).toEqual(expect.arrayContaining(['LINE1', 'Photo', 'QuoteNo']));
    const none = await as(db, 'authenticated', OTHER, async () => (await db.query(`select count(*)::int as n from public.form_data_keys($1)`, [formId])).rows[0].n);
    expect(none).toBe(0);
    await expect(as(db, 'anon', null, () => db.query(`select public.form_data_keys($1)`, [formId]))).rejects.toThrow(/permission denied/);
  });

  it('archived forms leave form_overview; only admins can archive', async () => {
    const before = await as(db, 'authenticated', STAFF, async () => (await db.query(`select slug from public.form_overview()`)).rows.map((r) => r.slug));
    expect(before).toContain('job-card');
    expect(await as(db, 'authenticated', STAFF, async () => (await db.query(`update public.forms set archived_at = now() where id = $1`, [formId])).rowCount)).toBe(0);
    await as(db, 'authenticated', ADMIN, async () => {
      expect((await db.query(`update public.forms set archived_at = now() where id = $1`, [formId])).rowCount).toBe(1);
      const after = (await db.query(`select slug from public.form_overview()`)).rows.map((r) => r.slug);
      expect(after).not.toContain('job-card');
    });
  });

  it('slugs stay unique per org', async () => {
    await expect(db.query(`insert into public.forms(org_id, slug, name, internal_name, spec) values ($1, 'job-card', 'x', 'x', '{}')`, [ORG_A])).rejects.toThrow(/duplicate key/);
    await as(db, 'service_role', null, async () => {
      await db.query(`insert into public.forms(org_id, slug, name, internal_name, spec) values ($1, 'job-card', 'x', 'x', '{}')`, [ORG_C]);
    });
  });
});
