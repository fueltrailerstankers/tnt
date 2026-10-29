import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { as, connect } from './helpers';

// 0008 leads: policies, grants, derived columns and seeds. Synthetic data only.
const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_D = '00000000-0000-0000-0000-0000000000d4';
const ADMIN_A = '00000000-0000-0000-0000-00000000a401';
const STAFF_A = '00000000-0000-0000-0000-00000000a402';
const REVIEWER_A = '00000000-0000-0000-0000-00000000a403';
const ADMIN_D = '00000000-0000-0000-0000-00000000d401';

let db: Client;
let leadA: string;

beforeAll(async () => {
  db = await connect();
  await db.query(
    `insert into auth.users(id, email) values ($1,'leads-admin@example.invalid'), ($2,'leads-staff@example.invalid'), ($3,'leads-reviewer@example.invalid'), ($4,'leads-admin-d@example.invalid') on conflict do nothing`,
    [ADMIN_A, STAFF_A, REVIEWER_A, ADMIN_D],
  );
  await db.query(`insert into public.orgs(id, name) values ($1, 'Org D') on conflict do nothing`, [ORG_D]);
  await db.query(
    `insert into public.memberships(org_id, user_id, role) values ($1,$2,'admin'), ($1,$3,'staff'), ($1,$4,'reviewer'), ($5,$6,'admin') on conflict do nothing`,
    [ORG_A, ADMIN_A, STAFF_A, REVIEWER_A, ORG_D, ADMIN_D],
  );
  leadA = (await db.query(
    `insert into public.leads(org_id, source, external_id, name, email, email_norm, phone, phone_norm) values ($1,'test','db-test-1','Synthetic Lead','SL@example.invalid','sl@example.invalid','082 555 0199','825550199') returning id`,
    [ORG_A],
  )).rows[0].id;
  await db.query(`insert into public.lead_events(lead_id, kind, meta) values ($1,'created','{"source":"test"}')`, [leadA]);
});

afterAll(async () => { await db.end(); });

const count = async (sql: string, params: unknown[] = []) => Number((await db.query(sql, params)).rows[0].n);

describe('seeds', () => {
  it('seeds lead sources, a default rule and the leads.new inbox for the default org only', async () => {
    const src = (await db.query(`select key, active from public.lead_sources where org_id = $1 order by key`, [ORG_A])).rows;
    expect(src).toEqual([
      { key: 'facebook', active: false }, { key: 'google', active: false }, { key: 'manual', active: true },
      { key: 'test', active: true }, { key: 'website', active: true },
    ]);
    expect(await count(`select count(*) as n from public.routing_rules where org_id = $1 and notify_event_key = 'leads.new' and active`, [ORG_A])).toBe(1);
    expect(await count(`select count(*) as n from public.notification_recipients where org_id = $1 and event_key = 'leads.new'`, [ORG_A])).toBe(1);
    expect(await count(`select count(*) as n from public.lead_sources where org_id = $1`, [ORG_D])).toBe(0);
  });
});

describe('read access', () => {
  it('admin and staff of the org read leads and events; reviewers do not', async () => {
    for (const u of [ADMIN_A, STAFF_A]) {
      await as(db, 'authenticated', u, async () => {
        expect(await count(`select count(*) as n from public.leads where id = $1`, [leadA])).toBe(1);
        expect(await count(`select count(*) as n from public.lead_events where lead_id = $1`, [leadA])).toBe(1);
      });
    }
    await as(db, 'authenticated', REVIEWER_A, async () => {
      expect(await count(`select count(*) as n from public.leads`)).toBe(0);
      expect(await count(`select count(*) as n from public.lead_events`)).toBe(0);
    });
  });

  it('another org sees nothing', async () => {
    await as(db, 'authenticated', ADMIN_D, async () => {
      expect(await count(`select count(*) as n from public.leads`)).toBe(0);
      expect(await count(`select count(*) as n from public.lead_events`)).toBe(0);
      expect(await count(`select count(*) as n from public.lead_sources`)).toBe(0);
      expect(await count(`select count(*) as n from public.routing_rules`)).toBe(0);
    });
  });

  it('routing rules are admin-only; sources are readable by members', async () => {
    await as(db, 'authenticated', STAFF_A, async () => {
      expect(await count(`select count(*) as n from public.routing_rules`)).toBe(0);
      expect(await count(`select count(*) as n from public.lead_sources`)).toBeGreaterThan(0);
    });
    await as(db, 'authenticated', ADMIN_A, async () => {
      expect(await count(`select count(*) as n from public.routing_rules`)).toBeGreaterThan(0);
    });
  });

  it('anon reads nothing', async () => {
    for (const t of ['leads', 'lead_events', 'lead_sources', 'routing_rules']) {
      await expect(as(db, 'anon', null, () => db.query(`select 1 from public.${t}`))).rejects.toThrow(/permission denied/);
    }
  });
});

describe('writes go through the server only', () => {
  it('even an org admin cannot write leads, events, sources or rules directly', async () => {
    for (const sql of [
      `insert into public.leads(org_id, source, name) values ('${ORG_A}','manual','x')`,
      `update public.leads set status = 'won' where id = '${leadA}'`,
      `delete from public.leads where id = '${leadA}'`,
      `insert into public.lead_events(lead_id, kind) values ('${leadA}','note')`,
      `update public.lead_sources set active = false`,
      `insert into public.routing_rules(org_id, name) values ('${ORG_A}','x')`,
      `update public.routing_rules set active = false`,
    ]) {
      for (const u of [ADMIN_A, STAFF_A]) {
        await expect(as(db, 'authenticated', u, () => db.query(sql))).rejects.toThrow(/permission denied/);
      }
    }
    expect((await db.query(`select status from public.leads where id = $1`, [leadA])).rows[0].status).toBe('new');
  });
});

describe('integrity', () => {
  it('lead_events and lead emails take org_id from the lead, never from the caller', async () => {
    const e = await db.query(`insert into public.lead_events(lead_id, org_id, kind) values ($1,$2,'note') returning org_id`, [leadA, ORG_D]);
    expect(e.rows[0].org_id).toBe(ORG_A);
    const m = await db.query(`insert into public.email_log(lead_id, org_id, to_addresses, subject, status) values ($1,$2,array['sales@example.invalid'],'New lead','skipped') returning org_id`, [leadA, ORG_D]);
    expect(m.rows[0].org_id).toBe(ORG_A);
  });

  it('0012: one-time intake events are recorded once per lead; matched and staff events repeat', async () => {
    const lead = (await db.query(`insert into public.leads(org_id, source, external_id) values ($1,'test','db-once-1') returning id`, [ORG_A])).rows[0].id;
    for (const kind of ['created', 'duplicate', 'routed', 'emailed']) {
      await db.query(`insert into public.lead_events(lead_id, kind) values ($1,$2)`, [lead, kind]);
      await expect(db.query(`insert into public.lead_events(lead_id, kind) values ($1,$2)`, [lead, kind])).rejects.toMatchObject({ code: '23505' });
    }
    for (const kind of ['matched', 'status', 'assigned', 'note']) {
      await db.query(`insert into public.lead_events(lead_id, kind) values ($1,$2), ($1,$2)`, [lead, kind]);
    }
    expect(await count(`select count(*) as n from public.lead_events where lead_id = $1`, [lead])).toBe(12);
  });

  it('0012 stops with a clear message and deletes nothing when a lead already has a repeated one-time event', async () => {
    const migration = readFileSync(path.resolve(__dirname, '../../supabase/migrations/0012_lead_events_once.sql'), 'utf8');
    await db.query('begin');
    try {
      await db.query('drop index public.lead_events_once'); // as before 0012
      await db.query(`insert into public.lead_events(lead_id, kind) values ($1,'routed'), ($1,'routed')`, [leadA]);
      const before = await count(`select count(*) as n from public.lead_events`);
      await db.query('savepoint again');
      await expect(db.query(migration)).rejects.toThrow(/0012_lead_events_once: 1 lead\/kind pair\(s\) already have a repeated/);
      await db.query('rollback to savepoint again');
      expect(await count(`select count(*) as n from public.lead_events`)).toBe(before);
    } finally {
      await db.query('rollback');
    }
    expect(await count(`select count(*) as n from pg_indexes where indexname = 'lead_events_once'`)).toBe(1);
  });

  it('the source id is unique per org and source; manual leads without one are not', async () => {
    await expect(db.query(`insert into public.leads(org_id, source, external_id) values ($1,'test','db-test-1')`, [ORG_A])).rejects.toThrow(/duplicate key/);
    await db.query(`insert into public.leads(org_id, source, external_id) values ($1,'website','db-test-1')`, [ORG_A]);
    await db.query(`insert into public.leads(org_id, source) values ($1,'manual'), ($1,'manual')`, [ORG_A]);
  });

  it('rejects unknown sources and statuses', async () => {
    await expect(db.query(`insert into public.leads(org_id, source) values ($1,'nope')`, [ORG_A])).rejects.toThrow(/foreign key/);
    await expect(db.query(`insert into public.leads(org_id, source) values ($1,'test')`, [ORG_D])).rejects.toThrow(/foreign key/);
    await expect(db.query(`update public.leads set status = 'maybe' where id = $1`, [leadA])).rejects.toThrow(/check constraint/);
  });

  it('search_text covers name, email, phone and product', async () => {
    const r = await db.query(`select search_text from public.leads where id = $1`, [leadA]);
    expect(r.rows[0].search_text).toContain('synthetic lead');
    expect(r.rows[0].search_text).toContain('sl@example.invalid');
    expect(r.rows[0].search_text).toContain('825550199');
  });

  it('xero_contacts get normalised email and phone (mobile first, last 9 digits)', async () => {
    const raw = { Phones: [
      { PhoneType: 'DEFAULT', PhoneCountryCode: '27', PhoneAreaCode: '11', PhoneNumber: '555 0100' },
      { PhoneType: 'MOBILE', PhoneCountryCode: '+27', PhoneAreaCode: '82', PhoneNumber: '555-0199' },
      { PhoneType: 'FAX', PhoneNumber: '' },
    ] };
    const r = await db.query(
      `insert into public.xero_contacts(org_id, tenant_id, contact_id, email, raw) values ($1,'t','lead-c1','  Buyer@Example.INVALID ',$2) returning email_norm, phone_norm`,
      [ORG_A, JSON.stringify(raw)],
    );
    expect(r.rows[0]).toEqual({ email_norm: 'buyer@example.invalid', phone_norm: '825550199' });
    const u = await db.query(`update public.xero_contacts set raw = '{"Phones":[]}' where contact_id = 'lead-c1' returning phone_norm`);
    expect(u.rows[0].phone_norm).toBeNull();
  });
});
