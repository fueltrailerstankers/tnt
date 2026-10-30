// 0014 (M7): access maps, has_access(), per-area RLS, status, last-admin trigger, stock RPC gate. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { AREAS, clampAccess, PRESET_ACCESS, ROLES, type AccessMap, type Area } from '@/lib/security/can';
import { as, connect } from './helpers';

const ORG = '00000000-0000-0000-0000-0000000007a1';
const OTHER = '00000000-0000-0000-0000-0000000007b1';
const U = (n: number) => `00000000-0000-0000-0000-0000000077${String(n).padStart(2, '0')}`;
const ADMIN = U(1);
const STAFF = U(2);
const REVIEWER = U(3);
const FACTORY = U(4);
const INSPECTOR = U(5);
const PROBE = U(6);      // access map changed per test
const INVITED = U(7);
const DISABLED = U(8);
const OTHER_ADMIN = U(9);
const ADMIN2 = U(10);

// Table -> area: the read policy each one follows (docs/M7.md section 1).
const TABLE_AREA: Array<[string, Area]> = [
  ['entries', 'forms'], ['entry_files', 'forms'], ['entry_events', 'forms'], ['entry_documents', 'forms'], ['email_log', 'forms'],
  ['deal_files', 'deals'],
  ['xero_quotes', 'quotes'], ['xero_quote_lines', 'quotes'],
  ['xero_invoices', 'invoices'], ['xero_invoice_lines', 'invoices'], ['xero_payments', 'invoices'], ['xero_attachments', 'invoices'],
  ['xero_sync_state', 'integrations'],
  ['leads', 'leads'], ['lead_events', 'leads'], ['lead_sources', 'leads'],
  ['stock_locations', 'stock'], ['stock_models', 'stock'], ['stock_deals', 'stock'], ['stock_units', 'stock'], ['stock_deal_dismissals', 'stock'],
  ['notification_recipients', 'settings'],
  ['audit_log', 'activity'],
];

const none = (): AccessMap => Object.fromEntries(AREAS.map((a) => [a, 'none'])) as AccessMap;
let db: Client;
let entryId: string;

const count = async (user: string, sql: string, params: unknown[] = []) =>
  as(db, 'authenticated', user, async () => Number((await db.query(sql, params)).rows[0].n));
const setProbe = async (access: Partial<AccessMap>, role = 'staff') =>
  db.query(`update public.memberships set role = $3, access = $2 where org_id = $1 and user_id = $4`, [ORG, JSON.stringify({ ...none(), ...access }), role, PROBE]);

beforeAll(async () => {
  db = await connect();
  const ids = [ADMIN, STAFF, REVIEWER, FACTORY, INSPECTOR, PROBE, INVITED, DISABLED, OTHER_ADMIN, ADMIN2];
  await db.query(`insert into auth.users(id, email) select u, 'm7-' || right(u::text, 4) || '@example.invalid' from unnest($1::uuid[]) u`, [ids]);
  await db.query(`insert into public.profiles(id, email, full_name) select u, 'm7-' || right(u::text, 4) || '@example.invalid', 'Member ' || right(u::text, 2) from unnest($1::uuid[]) u`, [ids]);
  await db.query(`insert into public.orgs(id, name) values ($1, 'Org M7'), ($2, 'Org M7 other')`, [ORG, OTHER]);
  await db.query(
    `insert into public.memberships(org_id, user_id, role) values ($1,$2,'admin'), ($1,$3,'staff'), ($1,$4,'reviewer'), ($1,$5,'factory'),
       ($1,$6,'inspector'), ($1,$7,'staff'), ($8,$9,'admin')`,
    [ORG, ADMIN, STAFF, REVIEWER, FACTORY, INSPECTOR, PROBE, OTHER, OTHER_ADMIN],
  );
  await db.query(`insert into public.memberships(org_id, user_id, role, status) values ($1,$2,'admin','invited'), ($1,$3,'admin','disabled')`, [ORG, INVITED, DISABLED]);

  // One row per area table in ORG (forms and stock reference data come from a copy of the default org's).
  const form = await db.query(`insert into public.forms(org_id, slug, name, internal_name, spec) select $1, slug, name, internal_name, spec from public.forms where slug = 'job-card' limit 1 returning id`, [ORG]);
  const e = await db.query(`insert into public.entries(form_id, number, status, data) values ($1, 0, 'Submitted', '{}') returning id`, [form.rows[0].id]);
  entryId = e.rows[0].id;
  await db.query(`insert into public.entry_files(entry_id, field_key, storage_path, file_name) values ($1,'X','m7/x/a.txt','a.txt')`, [entryId]);
  await db.query(`insert into public.entry_events(entry_id, action) values ($1,'Submit')`, [entryId]);
  await db.query(`insert into public.entry_documents(entry_id, template_number, storage_path) values ($1, 1, 'm7/x/doc.pdf')`, [entryId]);
  await db.query(`insert into public.email_log(entry_id, to_addresses, subject) values ($1, array['m7@example.invalid'], 'test')`, [entryId]);
  await db.query(`insert into public.deal_files(org_id, quote_no, quote_id) values ($1,'97001','qm7')`, [ORG]);
  await db.query(`insert into public.xero_quotes(org_id, tenant_id, quote_id, quote_number, quote_no, currency_code, total, raw) values ($1,'t','qm7','QU-97001','97001','ZAR',1,'{}')`, [ORG]);
  await db.query(`insert into public.xero_quote_lines(org_id, quote_id, line_no, description) values ($1,'qm7',1,'x')`, [ORG]);
  await db.query(`insert into public.xero_invoices(org_id, tenant_id, invoice_id, invoice_number, currency_code, total, raw) values ($1,'t','im7','INV-97001','ZAR',1,'{}')`, [ORG]);
  await db.query(`insert into public.xero_invoice_lines(org_id, invoice_id, line_no, description) values ($1,'im7',1,'x')`, [ORG]);
  await db.query(`insert into public.xero_payments(org_id, tenant_id, payment_id, invoice_id, amount, currency_code, raw) values ($1,'t','pm7','im7',1,'ZAR','{}')`, [ORG]);
  await db.query(`insert into public.xero_attachments(org_id, attachment_id, parent_type, parent_id, raw) values ($1,'am7','Invoice','im7','{}')`, [ORG]);
  await db.query(`insert into public.xero_sync_state(org_id, entity) values ($1,'invoices')`, [ORG]);
  await db.query(`insert into public.lead_sources(org_id, key, name) values ($1, 'test', 'Test')`, [ORG]);
  const lead = await db.query(`insert into public.leads(org_id, source, name, email, email_norm) values ($1,'test','Lead M7','lead-m7@example.invalid','lead-m7@example.invalid') returning id`, [ORG]);
  await db.query(`insert into public.lead_events(lead_id, kind, meta) values ($1,'created','{}')`, [lead.rows[0].id]);
  await db.query(`insert into public.stock_locations(org_id, id, name, is_factory, sort_order) select $1, id, name, is_factory, sort_order from public.stock_locations where org_id = '00000000-0000-0000-0000-000000000001'`, [ORG]);
  await db.query(`insert into public.stock_models(org_id, part_number, description, category, active, sort_order) select $1, part_number, description, category, active, sort_order from public.stock_models where org_id = '00000000-0000-0000-0000-000000000001'`, [ORG]);
  const deal = await db.query(`insert into public.stock_deals(org_id, year, number, location_id, model_part) values ($1, 2026, 97001, 'JHB', '3000D') returning id`, [ORG]);
  await db.query(`insert into public.stock_deal_dismissals(org_id, deal_id, reason) values ($1, $2, 'Synthetic')`, [ORG, deal.rows[0].id]);
  const unit = await db.query(`insert into public.stock_units(org_id, vin, model_part, location_id) values ($1, 'M7TESTVIN00000001', '3000D', 'JHB') returning id`, [ORG]);
  await db.query(`insert into public.stock_invoice_exceptions(org_id, invoice_number, reason, unit_id) values ($1, 'INV-M7-1', 'voided', $2)`, [ORG, unit.rows[0].id]);
  await db.query(`insert into public.notification_recipients(org_id, event_key, address) values ($1,'m7.test','m7@example.invalid')`, [ORG]);
  await db.query(`insert into public.audit_log(org_id, actor_user, action) values ($1, $2, 'test.m7'), ($1, $3, 'stock.test')`, [ORG, ADMIN, ADMIN]);
});

afterAll(async () => { await db.end(); });

describe('presets and clamping in SQL match lib/security/can.ts', () => {
  for (const role of ROLES) {
    it(`preset_access('${role}')`, async () => {
      const r = await db.query(`select public.preset_access($1) as a, public.clamp_access($1, public.preset_access($1)) as c`, [role]);
      expect(r.rows[0].a).toEqual(PRESET_ACCESS[role]);
      expect(r.rows[0].c).toEqual(clampAccess(role, PRESET_ACCESS[role]));
    });
  }

  it('clamp_access agrees with clampAccess on junk and on the factory ceiling', async () => {
    for (const [role, input] of [['staff', { forms: 'read', bogus: 'write', stock: 'owner' }], ['factory', { forms: 'write', leads: 'read', stock: 'write', users: 'read' }], ['admin', {}]] as const) {
      const r = await db.query(`select public.clamp_access($1, $2) as c`, [role, JSON.stringify(input)]);
      expect(r.rows[0].c, role).toEqual(clampAccess(role, input));
    }
  });
});

describe('memberships trigger and constraints', () => {
  it('backfills a role-only insert with the preset, active and accepted', async () => {
    const r = await db.query(`select role, preset, access, status, accepted_at from public.memberships where org_id = $1 and user_id = $2`, [ORG, STAFF]);
    expect(r.rows[0]).toMatchObject({ role: 'staff', preset: 'staff', access: PRESET_ACCESS.staff, status: 'active' });
    expect(r.rows[0].accepted_at).not.toBeNull();
  });

  it('marks a changed map custom and clamps it to the role', async () => {
    await db.query('begin');
    try {
      const r = await db.query(
        `update public.memberships set access = access || '{"leads":"read"}' where org_id = $1 and user_id = $2 returning preset, access`, [ORG, STAFF]);
      expect(r.rows[0].preset).toBe('custom');
      const f = await db.query(
        `update public.memberships set access = access || '{"forms":"write"}' where org_id = $1 and user_id = $2 returning preset, access`, [ORG, FACTORY]);
      expect(f.rows[0].access.forms).toBe('none');
      expect(f.rows[0].preset).toBe('factory');
      // A role change with the map untouched follows the new preset.
      const p = await db.query(`update public.memberships set role = 'reviewer' where org_id = $1 and user_id = $2 returning preset, access`, [ORG, FACTORY]);
      expect(p.rows[0]).toMatchObject({ preset: 'reviewer', access: PRESET_ACCESS.reviewer });
    } finally {
      await db.query('rollback');
    }
  });

  it('must_change_password defaults to false and only the server sets it', async () => {
    const r = await db.query(`select must_change_password from public.memberships where org_id = $1 and user_id = $2`, [ORG, STAFF]);
    expect(r.rows[0].must_change_password).toBe(false);
    await expect(as(db, 'authenticated', STAFF, () => db.query(`update public.memberships set must_change_password = false where user_id = $1`, [STAFF]))).rejects.toThrow(/permission denied/);
  });

  it('rejects a bad status', async () => {
    await expect(db.query(`update public.memberships set status = 'owner' where org_id = $1 and user_id = $2`, [ORG, STAFF])).rejects.toThrow(/memberships_status_check/);
  });

  it('clients cannot write memberships, not even an admin', async () => {
    await expect(as(db, 'authenticated', ADMIN, () => db.query(`update public.memberships set access = '{}' where user_id = $1`, [STAFF]))).rejects.toThrow(/permission denied/);
    await expect(as(db, 'authenticated', ADMIN, () => db.query(`insert into public.memberships(org_id, user_id, role) values ($1, $2, 'admin')`, [ORG, OTHER_ADMIN]))).rejects.toThrow(/permission denied/);
    await expect(as(db, 'authenticated', ADMIN, () => db.query(`delete from public.memberships where user_id = $1`, [STAFF]))).rejects.toThrow(/permission denied/);
  });
});

describe('has_access()', () => {
  const has = (user: string, area: string, level: string, org = ORG) =>
    as(db, 'authenticated', user, async () => (await db.query(`select public.has_access($1, $2, $3) as ok`, [org, area, level])).rows[0].ok as boolean);

  it('follows each preset for every area and level', async () => {
    const users: Record<string, string> = { admin: ADMIN, staff: STAFF, reviewer: REVIEWER, factory: FACTORY, inspector: INSPECTOR };
    for (const [role, user] of Object.entries(users)) {
      for (const area of AREAS) {
        const level = PRESET_ACCESS[role as keyof typeof PRESET_ACCESS][area];
        expect(await has(user, area, 'read'), `${role} ${area} read`).toBe(level !== 'none');
        expect(await has(user, area, 'write'), `${role} ${area} write`).toBe(level === 'write');
      }
    }
  });

  it('is false for invited and disabled members (admins included), other orgs, anon and junk levels', async () => {
    for (const user of [INVITED, DISABLED]) expect(await has(user, 'home', 'read')).toBe(false);
    expect(await has(OTHER_ADMIN, 'forms', 'read')).toBe(false);
    expect(await has(ADMIN, 'forms', 'owner')).toBe(false);
    expect(await has(ADMIN, 'bogus', 'read')).toBe(false);
    expect(await as(db, 'anon', null, async () => (await db.query(`select public.has_access($1, 'forms', 'read') as ok`, [ORG]).catch(() => ({ rows: [{ ok: 'denied' }] }))).rows[0].ok)).not.toBe(true);
  });

  it('is_org_member and has_org_role require an active membership', async () => {
    for (const user of [INVITED, DISABLED]) {
      expect(await count(user, `select count(*) as n from public.orgs where id = $1`, [ORG])).toBe(0);
      expect(await count(user, `select count(*) as n from public.forms where org_id = $1`, [ORG])).toBe(0);
      expect(await count(user, `select count(*) as n from public.entry_links where org_id = $1`, [ORG])).toBe(0);
    }
    expect(await count(STAFF, `select count(*) as n from public.orgs where id = $1`, [ORG])).toBe(1);
  });
});

describe('per-area read policies', () => {
  for (const [table, area] of TABLE_AREA) {
    it(`${table}: ${area} none sees nothing, ${area} read sees rows`, async () => {
      const q = `select count(*) as n from public.${table} where org_id = $1`;
      await setProbe({});
      expect(await count(PROBE, q, [ORG]), 'none').toBe(0);
      await setProbe({ [area]: 'read' });
      expect(await count(PROBE, q, [ORG]), 'read').toBeGreaterThan(0);
      // Read on every other area does not open this one.
      await setProbe(Object.fromEntries(AREAS.filter((a) => a !== area).map((a) => [a, 'write'])));
      // (audit_log: stock write opens the stock.* rows only, for the stock Activity tab.)
      expect(await count(PROBE, q, [ORG]), 'other areas').toBe(table === 'audit_log' ? 1 : 0);
    });
  }

  it('xero_contacts follow quotes or invoices', async () => {
    await db.query(`insert into public.xero_contacts(org_id, tenant_id, contact_id, name, raw) values ($1,'t','cm7','Test Contact','{}') on conflict do nothing`, [ORG]);
    const q = `select count(*) as n from public.xero_contacts where org_id = $1`;
    await setProbe({ deals: 'read' });
    expect(await count(PROBE, q, [ORG])).toBe(0);
    await setProbe({ quotes: 'read' });
    expect(await count(PROBE, q, [ORG])).toBe(1);
    await setProbe({ invoices: 'read' });
    expect(await count(PROBE, q, [ORG])).toBe(1);
  });

  it('stock invoice exceptions need stock and invoices', async () => {
    const q = `select count(*) as n from public.stock_invoice_exceptions where org_id = $1`;
    await setProbe({ stock: 'write' });
    expect(await count(PROBE, q, [ORG])).toBe(0);
    await setProbe({ invoices: 'read' });
    expect(await count(PROBE, q, [ORG])).toBe(0);
    await setProbe({ stock: 'read', invoices: 'read' });
    expect(await count(PROBE, q, [ORG])).toBe(1);
  });

  it('entry reads (own) follow forms', async () => {
    await setProbe({ forms: 'read' });
    await as(db, 'authenticated', PROBE, () => db.query(`insert into public.entry_reads(entry_id, user_id) values ($1, $2)`, [entryId, PROBE]));
    await setProbe({ home: 'read' });
    await expect(as(db, 'authenticated', PROBE, () => db.query(`insert into public.entry_reads(entry_id, user_id) values ($1, $2)`, [entryId, PROBE]))).rejects.toThrow(/row-level security/);
  });

  it('audit_log: stock.* rows with stock read, own rows always', async () => {
    await setProbe({ stock: 'read' });
    expect(await count(PROBE, `select count(*) as n from public.audit_log where org_id = $1`, [ORG])).toBe(1);
    await db.query(`insert into public.audit_log(org_id, actor_user, action) values ($1, $2, 'auth.sign_in')`, [ORG, PROBE]);
    await setProbe({ home: 'read' });
    const own = await as(db, 'authenticated', PROBE, async () => (await db.query(`select action from public.audit_log where org_id = $1`, [ORG])).rows.map((r) => r.action));
    expect(own).toEqual(['auth.sign_in']);
  });

  it('memberships and profiles of other users need users read', async () => {
    await setProbe({ home: 'read' });
    expect(await count(PROBE, `select count(*) as n from public.memberships where org_id = $1`, [ORG])).toBe(1);
    expect(await count(PROBE, `select count(*) as n from public.profiles`)).toBe(1);
    await setProbe({ users: 'read' });
    expect(await count(PROBE, `select count(*) as n from public.memberships where org_id = $1`, [ORG])).toBe(8);
    expect(await count(PROBE, `select count(*) as n from public.profiles`)).toBe(8);
    // Never another org's members.
    expect(await count(PROBE, `select count(*) as n from public.memberships where org_id = $1`, [OTHER])).toBe(0);
  });

  it('a disabled or invited user still reads their own membership (to learn their status) and nothing else', async () => {
    for (const user of [INVITED, DISABLED]) {
      expect(await count(user, `select count(*) as n from public.memberships`)).toBe(1);
      for (const [table] of TABLE_AREA) expect(await count(user, `select count(*) as n from public.${table}`), table).toBe(0);
    }
  });

  it('settings write is what lets a client change the org, form definitions and recipients', async () => {
    await setProbe({ settings: 'read' });
    await as(db, 'authenticated', PROBE, async () => {
      expect((await db.query(`update public.orgs set name = 'x' where id = $1`, [ORG])).rowCount).toBe(0);
      expect((await db.query(`update public.forms set is_active = false where org_id = $1`, [ORG])).rowCount).toBe(0);
      expect(Number((await db.query(`select count(*) as n from public.notification_recipients where org_id = $1`, [ORG])).rows[0].n)).toBe(1);
    });
    await setProbe({ settings: 'write' });
    await as(db, 'authenticated', PROBE, async () => {
      expect((await db.query(`update public.orgs set name = 'Org M7' where id = $1`, [ORG])).rowCount).toBe(1);
      expect((await db.query(`update public.notification_recipients set active = true where org_id = $1`, [ORG])).rowCount).toBe(1);
      // Locked settings stay locked (0009, 0011 restrictive policies).
      await expect(db.query(`insert into public.app_settings(org_id, key, value) values ($1, 'stock.invoice_rules', '"live"')`, [ORG])).rejects.toThrow(/row-level security/);
    });
  });

  it('cross-org: an admin of another org sees none of these rows', async () => {
    for (const [table] of TABLE_AREA) {
      expect(await count(OTHER_ADMIN, `select count(*) as n from public.${table} where org_id = $1`, [ORG]), table).toBe(0);
    }
  });
});

describe('last active admin', () => {
  const tx = async (fn: () => Promise<void>) => { await db.query('begin'); try { await fn(); } finally { await db.query('rollback'); } };

  it('cannot be disabled, demoted or removed', async () => {
    for (const sql of [
      `update public.memberships set status = 'disabled' where org_id = $1 and user_id = $2`,
      `update public.memberships set status = 'invited' where org_id = $1 and user_id = $2`,
      `update public.memberships set role = 'staff' where org_id = $1 and user_id = $2`,
      `delete from public.memberships where org_id = $1 and user_id = $2`,
    ]) {
      await tx(async () => { await expect(db.query(sql, [ORG, ADMIN]), sql).rejects.toThrow(/LAST_ADMIN/); });
    }
  });

  it('invited or disabled admins do not count; a second active admin does', async () => {
    await tx(async () => {
      await db.query(`insert into public.memberships(org_id, user_id, role) values ($1, $2, 'admin')`, [ORG, ADMIN2]);
      await db.query(`update public.memberships set status = 'disabled' where org_id = $1 and user_id = $2`, [ORG, ADMIN]);
      await expect(db.query(`delete from public.memberships where org_id = $1 and user_id = $2`, [ORG, ADMIN2])).rejects.toThrow(/LAST_ADMIN/);
    });
  });

  it('other members change freely', async () => {
    await tx(async () => {
      await db.query(`update public.memberships set status = 'disabled' where org_id = $1 and user_id = $2`, [ORG, STAFF]);
      await db.query(`delete from public.memberships where org_id = $1 and user_id = $2`, [ORG, REVIEWER]);
      await db.query(`delete from public.memberships where org_id = $1 and user_id = $2`, [ORG, DISABLED]);
    });
  });
});

describe('stock RPC gate follows the access map', () => {
  const dispatch = (user: string, vin: string) =>
    as(db, 'authenticated', user, () => db.query(`select * from public.stock_dispatch_unit($1, $2, '3000D', 'JHB')`, [ORG, vin]));

  it('stock write dispatches, stock read is refused, whatever the role', async () => {
    await expect(dispatch(REVIEWER, 'M7DISPATCHVIN0001')).rejects.toThrow(/FORBIDDEN/);
    await expect(dispatch(STAFF, 'M7DISPATCHVIN0002')).resolves.toBeTruthy();
    await setProbe({ stock: 'write' }, 'reviewer');
    await expect(dispatch(PROBE, 'M7DISPATCHVIN0003')).resolves.toBeTruthy();
    await setProbe({ stock: 'read' }, 'staff');
    await expect(dispatch(PROBE, 'M7DISPATCHVIN0004')).rejects.toThrow(/FORBIDDEN/);
  });

  it('inactive members are refused even as admin; admin-only RPCs stay admin-only', async () => {
    await expect(dispatch(DISABLED, 'M7DISPATCHVIN0005')).rejects.toThrow(/FORBIDDEN/);
    await setProbe({ stock: 'write' }, 'staff');
    const deal = (await db.query(`select id from public.stock_deals where org_id = $1 limit 1`, [ORG])).rows[0].id;
    await expect(as(db, 'authenticated', PROBE, () => db.query(`select * from public.stock_dismiss_deal($1, $2, 'x')`, [ORG, deal]))).rejects.toThrow(/FORBIDDEN/);
  });
});
