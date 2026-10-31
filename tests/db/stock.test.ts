// 0010/0011 stock control: seeds, RLS, RPCs, error codes, role checks, audit. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { can, ROLES, type Permission, type Role } from '@/lib/security/can';
import { STOCK_LOCATIONS, STOCK_MODELS } from '@/lib/stock/models';
import { normalizeVin } from '@/lib/stock/vin';
import { as, connect } from './helpers';

const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_E = '00000000-0000-0000-0000-0000000000e6';
const ADMIN_E = '00000000-0000-0000-0000-00000000e601';
const STAFF_E = '00000000-0000-0000-0000-00000000e602';
const REVIEWER_E = '00000000-0000-0000-0000-00000000e603';
const FACTORY_E = '00000000-0000-0000-0000-00000000e604';
const INSPECTOR_E = '00000000-0000-0000-0000-00000000e605';
const ADMIN_A = '00000000-0000-0000-0000-00000000a601';
const STAFF_A = '00000000-0000-0000-0000-00000000a602';
const FACTORY_A = '00000000-0000-0000-0000-00000000a603';

// Units in org E (fixtures, committed).
const U_SOLD = '00000000-0000-0000-0000-0000000e0001';   // 2000S at JHB, sold on INV-E-001
const U_RES = '00000000-0000-0000-0000-0000000e0002';    // 1000D at CPT, reserved on INV-E-002
const U_FACT = '00000000-0000-0000-0000-0000000e0003';   // 2500D at FACTORY, available
const U_AVAIL = '00000000-0000-0000-0000-0000000e0004';  // 3000D at JHB, available, dispatched on deal 2026/104
const U_DBN = '00000000-0000-0000-0000-0000000e0005';    // 3000D at DBN, available
const D_101 = '00000000-0000-0000-0000-0000000d0101';    // JHB 3000D awaiting
const D_102 = '00000000-0000-0000-0000-0000000d0102';    // CPT 1000DB awaiting
const D_103 = '00000000-0000-0000-0000-0000000d0103';    // DBN 2500D dismissed "SENT 26/03"
const D_104 = '00000000-0000-0000-0000-0000000d0104';    // JHB 3000D dispatched with U_AVAIL
// Org A fixtures created here (not by another test file), so the cross-org checks hit rows that exist.
const D_A = '00000000-0000-0000-0000-0000000a9701';     // org A deal 2026/97001, awaiting
const U_A = '00000000-0000-0000-0000-0000000a9702';     // org A unit TESTVINORGA000001 at JHB
const USER_BY_ROLE: Record<Role, string> = { admin: ADMIN_E, staff: STAFF_E, reviewer: REVIEWER_E, inspector: INSPECTOR_E, factory: FACTORY_E };
const holders = (p: Permission) => ROLES.filter((role) => can({ userId: USER_BY_ROLE[role], orgId: ORG_E, role, branch: null }, p));

// The RLS fixture exception (committed in beforeAll) is left out of exception counts.
const NOT_RLS_FIXTURE = `coalesce(invoice_number, '') <> 'INV-E-RLS'`;
const STOCK_TABLES = ['stock_locations', 'stock_models', 'stock_deals', 'stock_units', 'stock_invoice_exceptions', 'stock_deal_dismissals'];
// Free text used below; it must never reach audit_log.meta.
const FREE_TEXT = ['SENT 26/03', 'Synthetic note', 'Swap stock', 'Sample hose reel', 'deposit'];
const AUDIT_META_KEYS = new Set(['unit_id', 'vin', 'model', 'location', 'deal_id', 'deal_year', 'deal_number', 'from', 'to',
  'previous_vin', 'changed', 'invoice_number', 'xero_invoice_id', 'mode', 'from_status', 'exception_id', 'reason',
  'dismissal_id', 'previous_deal_id', 'previous_deal_year', 'previous_deal_number']);

type PgErr = Error & { hint?: string; detail?: string };
type Row = Record<string, unknown>;

let db: Client;

const DISPATCH = `select * from public.stock_dispatch_unit($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
const MOVE = `select * from public.stock_move_unit($1, $2, $3, $4, $5, $6)`;
const CORRECT = `select * from public.stock_correct_unit($1, $2, $3)`;
const DISMISS = `select * from public.stock_dismiss_deal($1, $2, $3)`;
const RESTORE = `select * from public.stock_restore_deal($1, $2)`;
const APPLY = `select public.stock_apply_invoice($1, $2, $3, $4, $5, $6) as r`;

interface DispatchArgs { vin: string; model?: string; location?: string; date?: string | null; acc?: string[]; notes?: string | null; year?: number | null; number?: number | null; org?: string }
const dispatchArgs = (o: DispatchArgs) => [o.org ?? ORG_E, o.vin, o.model ?? '3000D', o.location ?? 'JHB', o.date ?? null, o.acc ?? [], o.notes ?? null, o.year ?? null, o.number ?? null];
const applyArgs = (inv: string | null, ref: string | null, outcome: string, mode: string, xid: string | null = null, org = ORG_E) => [org, inv, xid, ref, outcome, mode];

/** Runs a statement inside the current test transaction; a failure rolls back to a savepoint and is returned. */
async function attempt(sql: string, params: unknown[] = []): Promise<{ rows: Row[]; err: PgErr | null }> {
  await db.query('savepoint attempt');
  try {
    const r = await db.query(sql, params);
    await db.query('release savepoint attempt');
    return { rows: r.rows, err: null };
  } catch (e) {
    await db.query('rollback to savepoint attempt');
    return { rows: [], err: e as PgErr };
  }
}

async function ok(sql: string, params: unknown[] = []): Promise<Row> {
  const { rows, err } = await attempt(sql, params);
  expect(err?.message ?? null, sql).toBeNull();
  return rows[0];
}

/** Asserts the stock error code (message) and hint; returns the parsed detail. */
async function code(sql: string, params: unknown[], expected: string): Promise<Record<string, unknown>> {
  const { err } = await attempt(sql, params);
  expect(err?.message ?? 'no error', `${sql} ${JSON.stringify(params)}`).toBe(expected);
  expect(err?.hint).toBe('stock');
  return JSON.parse(err?.detail ?? '{}');
}

const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
const count = async (sql: string, params: unknown[] = []) => Number((await db.query(sql, params)).rows[0].n);
const auditRows = async (action: string) =>
  (await db.query(`select actor_user, action, entity, entity_id, meta from public.audit_log where org_id = $1 and action = $2 order by id`, [ORG_E, action])).rows;

function expectCleanMeta(meta: Record<string, unknown>) {
  for (const k of Object.keys(meta)) expect(AUDIT_META_KEYS.has(k), `audit meta key ${k}`).toBe(true);
  const text = JSON.stringify(meta);
  for (const t of FREE_TEXT) expect(text).not.toContain(t);
  expect(text).not.toMatch(/@/);
}

beforeAll(async () => {
  db = await connect();
  await db.query(
    `insert into auth.users(id, email) select u, 'stock-' || right(u::text, 4) || '@example.invalid' from unnest($1::uuid[]) u on conflict do nothing`,
    [[ADMIN_E, STAFF_E, REVIEWER_E, FACTORY_E, INSPECTOR_E, ADMIN_A, STAFF_A, FACTORY_A]],
  );
  await db.query(`insert into public.orgs(id, name) values ($1, 'Org E') on conflict do nothing`, [ORG_E]);
  await db.query(
    `insert into public.memberships(org_id, user_id, role) values
       ($1,$2,'admin'), ($1,$3,'staff'), ($1,$4,'reviewer'), ($1,$5,'factory'), ($1,$6,'inspector'),
       ($7,$8,'admin'), ($7,$9,'staff'), ($7,$10,'factory')
     on conflict do nothing`,
    [ORG_E, ADMIN_E, STAFF_E, REVIEWER_E, FACTORY_E, INSPECTOR_E, ORG_A, ADMIN_A, STAFF_A, FACTORY_A],
  );
  // Org E gets the same reference data as the default org (the server would do this for a new org).
  await db.query(`insert into public.stock_locations(org_id, id, name, is_factory, sort_order) select $1, id, name, is_factory, sort_order from public.stock_locations where org_id = $2`, [ORG_E, ORG_A]);
  await db.query(`insert into public.stock_models(org_id, part_number, description, category, active, sort_order) select $1, part_number, description, category, active, sort_order from public.stock_models where org_id = $2`, [ORG_E, ORG_A]);

  await db.query(
    `insert into public.stock_units(id, org_id, vin, model_part, location_id, status, invoice_number, sold_at, deal_year, sequence) values
       ($2, $1, 'TESTVINSOLD000001', '2000S', 'JHB', 'sold', 'INV-E-001', now(), 2026, 90),
       ($3, $1, 'TESTVINRES0000002', '1000D', 'CPT', 'reserved', 'INV-E-002', null, null, null),
       ($4, $1, 'TESTVINFACT000003', '2500D', 'FACTORY', 'available', null, null, null, null),
       ($5, $1, 'TESTVINAVL0000004', '3000D', 'JHB', 'available', null, null, null, null),
       ($6, $1, 'TESTVINDBN0000005', '3000D', 'DBN', 'available', null, null, null, null)`,
    [ORG_E, U_SOLD, U_RES, U_FACT, U_AVAIL, U_DBN],
  );
  await db.query(
    `insert into public.stock_deals(id, org_id, year, number, location_id, model_part, accessories, status, dismissed_reason, unit_id, dispatched_at) values
       ($2, $1, 2026, 101, 'JHB', '3000D', '{}', 'awaiting_dispatch', null, null, null),
       ($3, $1, 2026, 102, 'CPT', '1000DB', '{"Sample hose reel"}', 'awaiting_dispatch', null, null, null),
       ($4, $1, 2026, 103, 'DBN', '2500D', '{}', 'dismissed', 'SENT 26/03', null, null),
       ($5, $1, 2026, 104, 'JHB', '3000D', '{}', 'dispatched', null, $6, now())`,
    [ORG_E, D_101, D_102, D_103, D_104, U_AVAIL],
  );
  await db.query(`update public.stock_units set deal_id = $1, deal_year = 2026, sequence = 104 where id = $2`, [D_104, U_AVAIL]);
  await db.query(`insert into public.stock_deal_dismissals(org_id, deal_id, reason) values ($1, $2, 'SENT 26/03')`, [ORG_E, D_103]);
  // Server-written stock setting (the setup server action uses the service role).
  await db.query(`insert into public.app_settings(org_id, key, value) values ($1, 'stock.invoice_rules', '"preview"')`, [ORG_E]);
  // Org A deal and unit for the cross-org checks (org A's locations and models are seeded by 0011).
  await db.query(`insert into public.stock_deals(id, org_id, year, number, location_id, model_part) values ($1, $2, 2026, 97001, 'JHB', '3000D')`, [D_A, ORG_A]);
  await db.query(`insert into public.stock_units(id, org_id, vin, model_part, location_id) values ($1, $2, 'TESTVINORGA000001', '3000D', 'JHB')`, [U_A, ORG_A]);
  await db.query(`insert into public.stock_invoice_exceptions(org_id, invoice_number, reason) values ($1, 'INV-E-RLS', 'voided')`, [ORG_E]);

  // Org A: an entry and a mirror invoice, to prove factory staff cannot read them.
  await db.query(
    `insert into public.entries(form_id, number, status, data) select id, 0, 'Submitted', '{}' from public.forms where slug = 'job-card' and org_id = $1`,
    [ORG_A],
  );
  await db.query(
    `insert into public.xero_invoices(org_id, tenant_id, invoice_id, invoice_number, currency_code, total, raw) values ($1,'t','stock-test-i1','INV-STOCK-1','ZAR',1,'{}')`,
    [ORG_A],
  );
});

afterAll(async () => { await db.end(); });

describe('0010 role and 0011 seeds', () => {
  it('adds the factory role', async () => {
    const r = await db.query(`select unnest(enum_range(null::public.app_role))::text as r`);
    expect(r.rows.map((x) => x.r)).toContain('factory');
  });

  it('seeds the four locations and the 52 models, in order, for the default org', async () => {
    const locs = (await db.query(`select id, name, is_factory, sort_order from public.stock_locations where org_id = $1 order by sort_order`, [ORG_A])).rows;
    expect(locs).toEqual(STOCK_LOCATIONS.map((l) => ({ id: l.id, name: l.name, is_factory: l.isFactory, sort_order: l.sortOrder })));
    const models = (await db.query(`select part_number, description, category from public.stock_models where org_id = $1 order by sort_order`, [ORG_A])).rows;
    expect(models).toEqual(STOCK_MODELS.map((m) => ({ part_number: m.partNumber, description: m.description, category: m.category })));
  });
});

describe('RLS: read for stock.read roles, isolated per org, no client writes', () => {
  for (const t of [...STOCK_TABLES, 'stock_matrix']) {
    // RLS must agree with can(): exceptions (raw Xero references) follow stock.invoices, the rest stock.read.
    const perm: Permission = t === 'stock_invoice_exceptions' ? 'stock.invoices' : 'stock.read';
    it(`${t}: exactly the ${perm} roles of org E read it; other orgs do not`, async () => {
      const visible = (u: string) => as(db, 'authenticated', u, () => count(`select count(*) as n from public.${t} where org_id = $1`, [ORG_E]));
      const readers = holders(perm);
      expect(readers.length).toBeGreaterThan(0);
      for (const role of ROLES) {
        const n = await visible(USER_BY_ROLE[role]);
        if (readers.includes(role)) expect(n, role).toBeGreaterThan(0);
        else expect(n, role).toBe(0);
      }
      expect(await visible(ADMIN_A)).toBe(0);
    });
  }

  it('nobody writes stock tables directly, not even an org admin', async () => {
    const writes = [
      `insert into public.stock_units(org_id, vin, model_part, location_id) values ('${ORG_E}', 'TESTVINDIRECT0001', '3000D', 'JHB')`,
      `update public.stock_units set status = 'sold'`,
      `delete from public.stock_units`,
      `update public.stock_deals set status = 'dismissed', dismissed_reason = 'x'`,
      `insert into public.stock_deals(org_id, year, number) values ('${ORG_E}', 2026, 999)`,
      `delete from public.stock_deals`,
      `insert into public.stock_locations(org_id, id, name) values ('${ORG_E}', 'PTA', 'Pretoria')`,
      `update public.stock_models set active = false`,
      `delete from public.stock_invoice_exceptions`,
      `update public.stock_invoice_exceptions set resolved_at = now()`,
      `insert into public.stock_deal_dismissals(org_id, deal_id, reason) values ('${ORG_E}', '${D_101}', 'x')`,
      `update public.stock_deal_dismissals set reason = 'x'`,
      `delete from public.stock_deal_dismissals`,
    ];
    for (const u of [ADMIN_E, STAFF_E, FACTORY_E]) {
      for (const sql of writes) await expect(as(db, 'authenticated', u, () => db.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
    await expect(as(db, 'anon', null, () => db.query(`select 1 from public.stock_units`))).rejects.toThrow(/permission denied/);
    await expect(as(db, 'anon', null, () => db.query(`select 1 from public.stock_matrix`))).rejects.toThrow(/permission denied/);
    // Dismissal history is append-only for the server too.
    for (const sql of [`update public.stock_deal_dismissals set reason = 'x'`, `delete from public.stock_deal_dismissals`]) {
      await expect(as(db, 'service_role', null, () => db.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
  });

  it('stock settings (app_settings stock.*) are server-only writes: no client writes them, not even an org admin', async () => {
    for (const u of [ADMIN_E, STAFF_E]) {
      for (const [key, value] of [['stock.invoice_rules', '"live"'], ['stock.deals_from', '"2000-01-01"']]) {
        await expect(as(db, 'authenticated', u, () =>
          db.query(`insert into public.app_settings(org_id, key, value) values ($1, $2, $3) on conflict (org_id, key) do update set value = excluded.value`, [ORG_E, key, value])),
        `${u} ${key}`).rejects.toThrow(/row-level security/);
      }
    }
    await as(db, 'authenticated', ADMIN_E, async () => {
      expect((await db.query(`update public.app_settings set value = '"live"' where org_id = $1 and key like 'stock.%'`, [ORG_E])).rowCount).toBe(0);
      expect((await db.query(`delete from public.app_settings where org_id = $1 and key like 'stock.%'`, [ORG_E])).rowCount).toBe(0);
      // Members still read them; other settings stay admin-writable, but cannot be renamed into stock.*.
      expect((await db.query(`select value from public.app_settings where org_id = $1 and key = 'stock.invoice_rules'`, [ORG_E])).rows).toEqual([{ value: 'preview' }]);
      await db.query(`insert into public.app_settings(org_id, key, value) values ($1, 'm6.test.other', '1')`, [ORG_E]);
      const renamed = await attempt(`update public.app_settings set key = 'stock.invoice_rules_x' where org_id = $1 and key = 'm6.test.other'`, [ORG_E]);
      expect(renamed.err?.message).toMatch(/row-level security/);
    });
    expect(await as(db, 'authenticated', STAFF_E, () => count(`select count(*) as n from public.app_settings where org_id = $1 and key like 'stock.%'`, [ORG_E]))).toBe(1);
    // The server (service role, after stock.manage + confirmation) writes them.
    await as(db, 'service_role', null, async () => {
      expect((await db.query(`update public.app_settings set value = '"live"' where org_id = $1 and key = 'stock.invoice_rules'`, [ORG_E])).rowCount).toBe(1);
    });
    expect((await one(`select value from public.app_settings where org_id = $1 and key = 'stock.invoice_rules'`, [ORG_E])).value).toBe('preview');
  });

  it('VIN normalisation: the database strips exactly the characters normalizeVin strips (NBSP, BOM, zero-width...)', async () => {
    const r = await one(`select array_agg(c order by c) as cps from generate_series(1, 65535) c
                         where (c < 55296 or c > 57343) and public.stock_norm_vin('A' || chr(c) || 'B') = 'AB'`);
    const js: number[] = [];
    for (let c = 1; c <= 65535; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      if (normalizeVin(`A${String.fromCharCode(c)}B`) === 'AB') js.push(c);
    }
    expect(r.cps).toEqual(js);
    for (const c of [0x20, 0x09, 0xa0, 0x2009, 0x200b, 0x202f, 0xfeff]) expect(js, c.toString(16)).toContain(c);
    expect((await one(`select public.stock_norm_vin($1) as v`, ['\ufeff nbsp\u00a0test\u2009 12\u200b345 '])).v).toBe('NBSPTEST12345');
  });

  it('anon cannot call the RPCs and clients cannot call the internal helpers', async () => {
    await expect(as(db, 'anon', null, () => db.query(DISPATCH, dispatchArgs({ vin: 'TESTVINANON00001' })))).rejects.toThrow(/permission denied/);
    for (const sql of [`select public.stock_raise('X')`, `select public.stock_require_role('${ORG_E}', array['admin']::public.app_role[])`,
      `select public.stock_clean_accessories(array['a'])`, `select public.stock_audit('${ORG_E}', 'stock.x', null, null, '{}')`]) {
      await expect(as(db, 'authenticated', ADMIN_E, () => db.query(sql)), sql).rejects.toThrow(/permission denied/);
    }
  });

  it('factory staff read stock.* audit rows but no other audit rows', async () => {
    // Rows inserted and read in one rolled-back transaction, so later audit counts start from zero.
    const asUser = (u: string) => db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u, role: 'authenticated' })]);
    await db.query('begin');
    try {
      await db.query(`insert into public.audit_log(org_id, action, meta) values ($1, 'stock.dispatch', '{}'), ($1, 'settings.change', '{}')`, [ORG_E]);
      await db.query('set local role authenticated');
      await asUser(FACTORY_E);
      expect(await count(`select count(*) as n from public.audit_log where org_id = $1 and action = 'stock.dispatch'`, [ORG_E])).toBe(1);
      expect(await count(`select count(*) as n from public.audit_log where org_id = $1 and action not like 'stock.%'`, [ORG_E])).toBe(0);
      await asUser(INSPECTOR_E);
      expect(await count(`select count(*) as n from public.audit_log where org_id = $1`, [ORG_E])).toBe(0);
      await asUser(ADMIN_E);
      expect(await count(`select count(*) as n from public.audit_log where org_id = $1`, [ORG_E])).toBe(2);
    } finally {
      await db.query('rollback');
    }
  });

  it('factory staff cannot read entries or the Xero mirror; staff of the same org can', async () => {
    for (const t of ['entries', 'xero_invoices']) {
      expect(await as(db, 'authenticated', STAFF_A, () => count(`select count(*) as n from public.${t} where org_id = $1`, [ORG_A])), t).toBeGreaterThan(0);
      expect(await as(db, 'authenticated', FACTORY_A, () => count(`select count(*) as n from public.${t} where org_id = $1`, [ORG_A])), t).toBe(0);
    }
    const policies = (await db.query(`select tablename from pg_policies where schemaname = 'public' and policyname like '%_not_factory' and permissive = 'RESTRICTIVE'`)).rows.map((r) => r.tablename);
    for (const t of ['entries', 'entry_files', 'entry_events', 'entry_documents', 'email_log', 'xero_contacts', 'xero_quotes', 'xero_invoices', 'xero_payments', 'deal_files', 'leads']) {
      expect(policies).toContain(t);
    }
  });

  it('VIN is unique per org on its normalised form (sold included); invoice numbers are unique per org', async () => {
    await expect(db.query(`insert into public.stock_units(org_id, vin, model_part, location_id) values ($1, ' testvin sold 000001 ', '3000D', 'JHB')`, [ORG_E])).rejects.toThrow(/stock_units_vin_key/);
    await expect(db.query(`insert into public.stock_units(org_id, vin, model_part, location_id, invoice_number) values ($1, 'TESTVINDUPINV0001', '3000D', 'JHB', 'INV-E-001')`, [ORG_E])).rejects.toThrow(/stock_units_invoice_key/);
    await expect(db.query(`insert into public.stock_units(org_id, vin, model_part, location_id, accessories) values ($1, 'TESTVINACC000001', '3000D', 'JHB', $2)`, [ORG_E, Array.from({ length: 11 }, (_, i) => `a${i}`)])).rejects.toThrow(/check constraint/);
    // The same VIN and invoice number in another org is fine (org-scoped), inside a rolled-back transaction.
    await db.query('begin');
    try {
      await db.query(`insert into public.stock_units(org_id, vin, model_part, location_id, invoice_number) values ($1, 'TESTVINSOLD000001', '3000D', 'JHB', 'INV-E-001')`, [ORG_A]);
    } finally {
      await db.query('rollback');
    }
  });

  it('stock_matrix counts available + reserved per model and location, excludes sold, keeps models without stock', async () => {
    await as(db, 'authenticated', STAFF_E, async () => {
      const rows = (await db.query(`select part_number, location_id, qty, reserved from public.stock_matrix where org_id = $1 and part_number in ('3000D','1000D','2000S','2500D') order by part_number, location_id`, [ORG_E])).rows;
      expect(rows).toEqual([
        { part_number: '1000D', location_id: 'CPT', qty: 1, reserved: 1 },
        { part_number: '2000S', location_id: null, qty: 0, reserved: 0 },
        { part_number: '2500D', location_id: 'FACTORY', qty: 1, reserved: 0 },
        { part_number: '3000D', location_id: 'DBN', qty: 1, reserved: 0 },
        { part_number: '3000D', location_id: 'JHB', qty: 1, reserved: 0 },
      ]);
      expect(await count(`select count(distinct part_number) as n from public.stock_matrix where org_id = $1`, [ORG_E])).toBe(52);
    });
  });
});

describe('stock_dispatch_unit', () => {
  it('free mode (staff): registers an available unit with a normalised VIN, cleans accessories, audits ids only', async () => {
    await as(db, 'authenticated', STAFF_E, async () => {
      const u = await ok(DISPATCH, dispatchArgs({ vin: ' testvin new 00001 ', location: 'cpt', acc: [' Sample spare wheel ', '', '  ', 'Sample jockey wheel'], notes: ' Synthetic note ' }));
      expect(u).toMatchObject({ vin: 'TESTVINNEW00001', vin_norm: 'TESTVINNEW00001', model_part: '3000D', location_id: 'CPT', status: 'available', deal_id: null, sequence: null, created_by: STAFF_E, notes: 'Synthetic note' });
      expect(u.accessories).toEqual(['Sample spare wheel', 'Sample jockey wheel']);
      const today = (await one(`select (now() at time zone 'Africa/Johannesburg')::date::text as d`)).d;
      expect((await one(`select dispatch_date::text as d from public.stock_units where id = $1`, [u.id])).d).toBe(today);
      // A dispatch without a deal never clears a deal.
      expect(await count(`select count(*) as n from public.stock_deals where org_id = $1 and status = 'awaiting_dispatch'`, [ORG_E])).toBe(2);
      const audit = await auditRows('stock.dispatch');
      const mine = audit.filter((a) => a.entity_id === u.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ actor_user: STAFF_E, entity: 'stock_unit' });
      expect(mine[0].meta).toEqual({ unit_id: u.id, vin: 'TESTVINNEW00001', model: '3000D', location: 'CPT' });
      expectCleanMeta(mine[0].meta);
    });
  });

  it('against a deal (factory): links the unit and clears the deal', async () => {
    await as(db, 'authenticated', FACTORY_E, async () => {
      const u = await ok(DISPATCH, dispatchArgs({ vin: 'TESTVINDEAL00101', location: 'JHB', date: '2026-03-01', year: 2026, number: 101 }));
      expect(u).toMatchObject({ deal_id: D_101, deal_year: 2026, sequence: 101, location_id: 'JHB', status: 'available' });
      expect(String((await one(`select dispatch_date::text as d from public.stock_units where id = $1`, [u.id])).d)).toBe('2026-03-01');
      const d = await one(`select status, unit_id, dispatched_at from public.stock_deals where id = $1`, [D_101]);
      expect(d.status).toBe('dispatched');
      expect(d.unit_id).toBe(u.id);
      expect(d.dispatched_at).toBeTruthy();
      const [a] = (await auditRows('stock.dispatch')).filter((x) => x.entity_id === u.id);
      expect(a.meta).toMatchObject({ deal_id: D_101, deal_year: 2026, deal_number: 101 });
      expectCleanMeta(a.meta);
      // A second dispatch on the same deal is blocked and names the VIN already dispatched.
      const detail = await code(DISPATCH, dispatchArgs({ vin: 'TESTVINDEAL00102', year: 2026, number: 101 }), 'DEAL_ALREADY_DISPATCHED');
      expect(detail).toMatchObject({ year: 2026, number: 101, vin: 'TESTVINDEAL00101', unit_id: u.id });
    });
  });

  it('dispatch to the Factory registers factory stock', async () => {
    await as(db, 'authenticated', FACTORY_E, async () => {
      const u = await ok(DISPATCH, dispatchArgs({ vin: 'TESTVINATFACT001', model: '2500d', location: 'FACTORY' }));
      expect(u).toMatchObject({ location_id: 'FACTORY', model_part: '2500D', status: 'available' });
    });
  });

  it('a deal is not cleared by a dispatch to the Factory; it clears when the unit moves to a branch', async () => {
    await as(db, 'authenticated', FACTORY_E, async () => {
      expect(await code(DISPATCH, dispatchArgs({ vin: 'TESTVINFACTDEAL1', model: '1000DB', location: 'FACTORY', year: 2026, number: 102 }), 'INVALID_INPUT'))
        .toEqual({ field: 'location', reason: 'factory_with_deal' });
      expect(await one(`select status, unit_id from public.stock_deals where id = $1`, [D_102])).toEqual({ status: 'awaiting_dispatch', unit_id: null });
      // Registered at the Factory without the deal; the branch dispatch then offers the move, which clears the deal.
      const u = await ok(DISPATCH, dispatchArgs({ vin: 'TESTVINFACTDEAL1', model: '1000DB', location: 'FACTORY' }));
      expect(await code(DISPATCH, dispatchArgs({ vin: 'TESTVINFACTDEAL1', model: '1000DB', location: 'CPT', year: 2026, number: 102 }), 'FACTORY_UNIT_EXISTS'))
        .toMatchObject({ unit_id: u.id, to: 'CPT' });
      expect(await ok(MOVE, [ORG_E, u.id, 'CPT', null, 2026, 102])).toMatchObject({ location_id: 'CPT', deal_id: D_102, sequence: 102 });
      expect(await one(`select status, unit_id from public.stock_deals where id = $1`, [D_102])).toEqual({ status: 'dispatched', unit_id: u.id });
    });
  });

  it('a VIN pasted with invisible characters (NBSP, BOM, zero-width) is the same VIN everywhere', async () => {
    const pasted = 'NBSP\u00a0TEST\u00a012345\ufeff';
    let id = '';
    await as(db, 'authenticated', STAFF_E, async () => {
      const u = await ok(DISPATCH, dispatchArgs({ vin: pasted }));
      id = String(u.id);
      expect(u.vin_norm).toBe('NBSPTEST12345');
      expect(u.vin_norm).toBe(normalizeVin(pasted));
      expect(await code(DISPATCH, dispatchArgs({ vin: 'NBSPTEST12345', location: 'CPT' }), 'VIN_EXISTS')).toMatchObject({ unit_id: id });
      expect(await code(DISPATCH, dispatchArgs({ vin: 'nbsp test\u200b12345', location: 'CPT' }), 'VIN_EXISTS')).toMatchObject({ unit_id: id });
    });
    await as(db, 'authenticated', ADMIN_E, async () => {
      // Correcting to the same VIN with an NBSP is a no-op; an invoice reference with one still matches.
      await ok(CORRECT, [ORG_E, U_DBN, JSON.stringify({ vin: 'TESTVIN\u00a0DBN0000005' })]);
      expect(await auditRows('stock.correct')).toHaveLength(0);
      const res = (await ok(APPLY, applyArgs('INV-E-NBSP', '\ufeffTESTVIN\u00a0DBN0000005', 'reserved', 'preview'))).r;
      expect(res).toMatchObject({ result: 'reserved', unit_id: U_DBN });
    });
  });

  it('VIN is checked against every unit, sold included, ignoring case and spaces', async () => {
    await as(db, 'authenticated', STAFF_E, async () => {
      const sold = await code(DISPATCH, dispatchArgs({ vin: 'testvin sold 000001' }), 'VIN_EXISTS');
      expect(sold).toMatchObject({ unit_id: U_SOLD, model: '2000S', sequence: 90, location: 'JHB', location_name: 'Johannesburg', status: 'sold' });
      await code(DISPATCH, dispatchArgs({ vin: 'TESTVINRES0000002' }), 'VIN_EXISTS');
      await code(DISPATCH, dispatchArgs({ vin: 'TESTVINAVL0000004', year: 2026, number: 102 }), 'VIN_EXISTS');
      expect((await one(`select status from public.stock_deals where id = $1`, [D_102])).status).toBe('awaiting_dispatch');
    });
  });

  it('a VIN at the Factory and not sold gives FACTORY_UNIT_EXISTS when dispatched to a branch', async () => {
    await as(db, 'authenticated', FACTORY_E, async () => {
      const d = await code(DISPATCH, dispatchArgs({ vin: 'testvinfact000003', location: 'DBN' }), 'FACTORY_UNIT_EXISTS');
      expect(d).toMatchObject({ unit_id: U_FACT, location: 'FACTORY', to: 'DBN', status: 'available' });
      await code(DISPATCH, dispatchArgs({ vin: 'TESTVINFACT000003', location: 'FACTORY' }), 'VIN_EXISTS');
    });
  });

  it('deal errors: not found, dismissed, already dispatched; year without number', async () => {
    await as(db, 'authenticated', STAFF_E, async () => {
      expect(await code(DISPATCH, dispatchArgs({ vin: 'TESTVINERR000001', year: 2026, number: 999 }), 'DEAL_NOT_FOUND')).toEqual({ year: 2026, number: 999 });
      expect(await code(DISPATCH, dispatchArgs({ vin: 'TESTVINERR000001', year: 2026, number: 103 }), 'DEAL_DISMISSED')).toMatchObject({ deal_id: D_103 });
      expect(await code(DISPATCH, dispatchArgs({ vin: 'TESTVINERR000001', year: 2026, number: 104 }), 'DEAL_ALREADY_DISPATCHED')).toMatchObject({ vin: 'TESTVINAVL0000004' });
      expect(await code(DISPATCH, dispatchArgs({ vin: 'TESTVINERR000001', year: 2026 }), 'INVALID_INPUT')).toEqual({ field: 'deal' });
      // Deals of another org are not found (2026/97001 exists in org A: see the cross-org block).
      await code(DISPATCH, dispatchArgs({ vin: 'TESTVINERR000001', year: 2026, number: 97001 }), 'DEAL_NOT_FOUND');
    });
  });

  it('input errors: VIN, model, location, more than 10 accessories', async () => {
    await as(db, 'authenticated', STAFF_E, async () => {
      expect(await code(DISPATCH, dispatchArgs({ vin: ' ab c ' }), 'INVALID_INPUT')).toEqual({ field: 'vin' });
      expect(await code(DISPATCH, dispatchArgs({ vin: 'X'.repeat(41) }), 'INVALID_INPUT')).toEqual({ field: 'vin' });
      await code(DISPATCH, dispatchArgs({ vin: 'TESTVINERR000002', model: 'NOPE' }), 'MODEL_NOT_FOUND');
      await code(DISPATCH, dispatchArgs({ vin: 'TESTVINERR000002', location: 'PTA' }), 'LOCATION_NOT_FOUND');
      const eleven = Array.from({ length: 11 }, (_, i) => `Sample accessory ${i + 1}`);
      expect(await code(DISPATCH, dispatchArgs({ vin: 'TESTVINERR000002', acc: eleven }), 'INVALID_INPUT')).toEqual({ field: 'accessories', max: 10 });
      await code(DISPATCH, dispatchArgs({ vin: 'TESTVINERR000002', acc: ['x'.repeat(201)] }), 'INVALID_INPUT');
      // Ten lines plus blanks is fine.
      await ok(DISPATCH, dispatchArgs({ vin: 'TESTVINERR000002', acc: [...eleven.slice(0, 10), '', ' '] }));
    });
  });

  it('roles: reviewer, inspector, other orgs and signed-out callers cannot dispatch', async () => {
    for (const u of [REVIEWER_E, INSPECTOR_E, ADMIN_A]) {
      await as(db, 'authenticated', u, () => code(DISPATCH, dispatchArgs({ vin: 'TESTVINROLE00001' }), 'FORBIDDEN'));
    }
    await as(db, 'authenticated', null, () => code(DISPATCH, dispatchArgs({ vin: 'TESTVINROLE00001' }), 'FORBIDDEN'));
    await as(db, 'service_role', null, () => code(DISPATCH, dispatchArgs({ vin: 'TESTVINROLE00001' }), 'FORBIDDEN'));
    await as(db, 'authenticated', ADMIN_E, () => ok(DISPATCH, dispatchArgs({ vin: 'TESTVINROLE00001' })));
  });
});

describe('stock_move_unit', () => {
  it('factory staff move a factory unit to a branch (no reason needed); dispatch date becomes today', async () => {
    await as(db, 'authenticated', FACTORY_E, async () => {
      const u = await ok(MOVE, [ORG_E, U_FACT, 'CPT', null, null, null]);
      expect(u).toMatchObject({ location_id: 'CPT', transfer_reason: null });
      const today = (await one(`select (now() at time zone 'Africa/Johannesburg')::date::text as d`)).d;
      expect((await one(`select dispatch_date::text as d from public.stock_units where id = $1`, [U_FACT])).d).toBe(today);
      const [a] = await auditRows('stock.move');
      expect(a.meta).toEqual({ unit_id: U_FACT, vin: 'TESTVINFACT000003', model: '2500D', from: 'FACTORY', to: 'CPT' });
    });
  });

  it('a factory unit can be moved against a deal, which clears it', async () => {
    await as(db, 'authenticated', STAFF_E, async () => {
      const u = await ok(MOVE, [ORG_E, U_FACT, 'CPT', null, 2026, 102]);
      expect(u).toMatchObject({ deal_id: D_102, deal_year: 2026, sequence: 102, location_id: 'CPT' });
      expect(await one(`select status, unit_id from public.stock_deals where id = $1`, [D_102])).toEqual({ status: 'dispatched', unit_id: U_FACT });
      const [a] = await auditRows('stock.move');
      expect(a.meta).toMatchObject({ deal_id: D_102, deal_year: 2026, deal_number: 102 });
      expectCleanMeta(a.meta);
    });
    await as(db, 'authenticated', STAFF_E, async () => {
      await code(MOVE, [ORG_E, U_FACT, 'CPT', null, 2026, 103], 'DEAL_DISMISSED');
      await code(MOVE, [ORG_E, U_FACT, 'CPT', null, 2026, 104], 'DEAL_ALREADY_DISPATCHED');
      await code(MOVE, [ORG_E, U_FACT, 'CPT', null, 2026, 555], 'DEAL_NOT_FOUND');
    });
  });

  it('only admins transfer between branches or back to the Factory, with a reason', async () => {
    for (const u of [STAFF_E, FACTORY_E]) {
      await as(db, 'authenticated', u, () => code(MOVE, [ORG_E, U_DBN, 'JHB', 'Swap stock', null, null], 'FORBIDDEN'));
      await as(db, 'authenticated', u, () => code(MOVE, [ORG_E, U_DBN, 'FACTORY', 'Swap stock', null, null], 'FORBIDDEN'));
    }
    await as(db, 'authenticated', REVIEWER_E, () => code(MOVE, [ORG_E, U_FACT, 'JHB', null, null, null], 'FORBIDDEN'));
    await as(db, 'authenticated', ADMIN_E, async () => {
      await code(MOVE, [ORG_E, U_DBN, 'JHB', '  ', null, null], 'REASON_REQUIRED');
      const u = await ok(MOVE, [ORG_E, U_DBN, 'JHB', ' Swap stock ', null, null]);
      expect(u).toMatchObject({ location_id: 'JHB', transfer_reason: 'Swap stock' });
      const [a] = await auditRows('stock.move');
      expect(a.meta).toMatchObject({ from: 'DBN', to: 'JHB' });
      expectCleanMeta(a.meta);
      await code(MOVE, [ORG_E, U_AVAIL, 'JHB', 'Swap stock', null, null], 'INVALID_INPUT');
      await code(MOVE, [ORG_E, U_SOLD, 'CPT', 'Swap stock', null, null], 'UNIT_SOLD');
      await code(MOVE, [ORG_E, '00000000-0000-0000-0000-00000000dead', 'CPT', 'Swap stock', null, null], 'UNIT_NOT_FOUND');
      await code(MOVE, [ORG_E, U_DBN, 'PTA', 'Swap stock', null, null], 'LOCATION_NOT_FOUND');
      expect(await code(MOVE, [ORG_E, U_AVAIL, 'CPT', 'Swap stock', 2026, 101], 'INVALID_INPUT')).toEqual({ field: 'deal', reason: 'unit_has_deal' });
      // A deal clears only when its unit reaches a branch: not on a move to the Factory.
      expect(await code(MOVE, [ORG_E, U_DBN, 'FACTORY', 'Swap stock', 2026, 101], 'INVALID_INPUT')).toEqual({ field: 'location', reason: 'factory_with_deal' });
      expect((await one(`select status from public.stock_deals where id = $1`, [D_101])).status).toBe('awaiting_dispatch');
    });
  });
});

describe('stock_correct_unit', () => {
  it('admin corrects a record; sold_at follows status; the audit lists changed keys, not values', async () => {
    await as(db, 'authenticated', ADMIN_E, async () => {
      const u = await ok(CORRECT, [ORG_E, U_DBN, JSON.stringify({ notes: 'Synthetic note', status: 'sold', invoice_number: ' inv-e-500 ', accessories: ['Sample canopy', ''] })]);
      expect(u).toMatchObject({ status: 'sold', invoice_number: 'INV-E-500', notes: 'Synthetic note' });
      expect(u.sold_at).toBeTruthy();
      expect(u.accessories).toEqual(['Sample canopy']);
      const [a] = await auditRows('stock.correct');
      expect(a.meta).toEqual({ unit_id: U_DBN, vin: 'TESTVINDBN0000005', model: '3000D', changed: ['status', 'invoice_number', 'accessories', 'notes'] });
      expectCleanMeta(a.meta);
      const back = await ok(CORRECT, [ORG_E, U_DBN, JSON.stringify({ status: 'available', vin: 'testvin dbn 0000005x' })]);
      expect(back).toMatchObject({ status: 'available', sold_at: null, vin_norm: 'TESTVINDBN0000005X' });
      expect((await auditRows('stock.correct'))[1].meta).toMatchObject({ previous_vin: 'TESTVINDBN0000005', changed: ['vin', 'status'] });
    });
  });

  it('rejects unknown fields, duplicates and conflicts; a no-op writes nothing', async () => {
    await as(db, 'authenticated', ADMIN_E, async () => {
      expect(await code(CORRECT, [ORG_E, U_DBN, JSON.stringify({ customer_name: 'x' })], 'INVALID_INPUT')).toEqual({ field: 'fields', unknown: ['customer_name'] });
      await code(CORRECT, [ORG_E, U_DBN, '{}'], 'INVALID_INPUT');
      expect(await code(CORRECT, [ORG_E, U_DBN, JSON.stringify({ vin: 'testvinsold000001' })], 'VIN_EXISTS')).toMatchObject({ unit_id: U_SOLD });
      expect(await code(CORRECT, [ORG_E, U_DBN, JSON.stringify({ invoice_number: 'inv-e-002' })], 'INVOICE_LINKED_OTHER_UNIT')).toMatchObject({ other_unit_id: U_RES });
      await code(CORRECT, [ORG_E, U_DBN, JSON.stringify({ status: 'lost' })], 'INVALID_INPUT');
      await code(CORRECT, [ORG_E, U_DBN, JSON.stringify({ model_part: 'NOPE' })], 'MODEL_NOT_FOUND');
      await code(CORRECT, [ORG_E, U_DBN, JSON.stringify({ dispatch_date: 'yesterday' })], 'INVALID_INPUT');
      await code(CORRECT, [ORG_E, U_DBN, JSON.stringify({ dispatch_date: '2026-02-30' })], 'INVALID_INPUT');
      await code(CORRECT, [ORG_E, U_DBN, JSON.stringify({ accessories: Array.from({ length: 11 }, (_, i) => `a${i}`) })], 'INVALID_INPUT');
      await code(CORRECT, [ORG_E, U_AVAIL, JSON.stringify({ sequence: 5 })], 'INVALID_INPUT');
      await code(CORRECT, [ORG_E, U_DBN, JSON.stringify({ deal_year: 1990 })], 'INVALID_INPUT');
      const same = await ok(CORRECT, [ORG_E, U_DBN, JSON.stringify({ vin: ' testvindbn0000005 ', location_id: 'dbn' })]);
      expect(same.updated_at).toEqual((await one(`select updated_at from public.stock_units where id = $1`, [U_DBN])).updated_at);
      expect(await auditRows('stock.correct')).toHaveLength(0);
    });
  });

  it('relinks a unit dispatched against the wrong deal: the old deal is outstanding again, the new one cleared', async () => {
    await as(db, 'authenticated', ADMIN_E, async () => {
      const u = await ok(CORRECT, [ORG_E, U_AVAIL, JSON.stringify({ deal: { year: 2026, number: 101 } })]);
      expect(u).toMatchObject({ deal_id: D_101, deal_year: 2026, sequence: 101 });
      expect(await one(`select status, unit_id, dispatched_at from public.stock_deals where id = $1`, [D_104])).toEqual({ status: 'awaiting_dispatch', unit_id: null, dispatched_at: null });
      expect(await one(`select status, unit_id from public.stock_deals where id = $1`, [D_101])).toEqual({ status: 'dispatched', unit_id: U_AVAIL });
      const [a] = await auditRows('stock.correct');
      expect(a.meta).toEqual({ unit_id: U_AVAIL, vin: 'TESTVINAVL0000004', model: '3000D', deal_id: D_101, deal_year: 2026, deal_number: 101,
        previous_deal_id: D_104, previous_deal_year: 2026, previous_deal_number: 104, changed: ['sequence', 'deal'] });
      expectCleanMeta(a.meta);
      // The freed deal can be dispatched again; relinking to the deal it already has changes nothing.
      await ok(DISPATCH, dispatchArgs({ vin: 'TESTVINRELINK001', year: 2026, number: 104 }));
      await ok(CORRECT, [ORG_E, U_AVAIL, JSON.stringify({ deal: { year: 2026, number: 101 } })]);
      expect(await auditRows('stock.correct')).toHaveLength(1);
      // Unlink: the deal is outstanding again and the unit carries no deal or sequence.
      expect(await ok(CORRECT, [ORG_E, U_AVAIL, JSON.stringify({ deal: null })])).toMatchObject({ deal_id: null, deal_year: null, sequence: null });
      expect(await one(`select status, unit_id from public.stock_deals where id = $1`, [D_101])).toEqual({ status: 'awaiting_dispatch', unit_id: null });
      expect((await auditRows('stock.correct'))[1].meta).toMatchObject({ previous_deal_id: D_101, changed: ['deal_year', 'sequence', 'deal'] });
    });
  });

  it('relink errors: target deal not found (incl. other orgs), dismissed or dispatched with another unit; bad input', async () => {
    await as(db, 'authenticated', ADMIN_E, async () => {
      const deal = (d: unknown) => JSON.stringify({ deal: d });
      expect(await code(CORRECT, [ORG_E, U_DBN, deal({ year: 2026, number: 999 })], 'DEAL_NOT_FOUND')).toEqual({ year: 2026, number: 999 });
      await code(CORRECT, [ORG_E, U_DBN, deal({ year: 2026, number: 97001 })], 'DEAL_NOT_FOUND');
      await code(CORRECT, [ORG_E, U_DBN, deal({ year: 2026, number: 103 })], 'DEAL_DISMISSED');
      expect(await code(CORRECT, [ORG_E, U_DBN, deal({ year: 2026, number: 104 })], 'DEAL_ALREADY_DISPATCHED')).toMatchObject({ vin: 'TESTVINAVL0000004' });
      for (const bad of ['x', 5, { year: 2026 }, { year: 'abc', number: 1 }]) {
        expect(await code(CORRECT, [ORG_E, U_DBN, deal(bad)], 'INVALID_INPUT'), JSON.stringify(bad)).toEqual({ field: 'deal' });
      }
      expect(await code(CORRECT, [ORG_E, U_DBN, JSON.stringify({ deal: { year: 2026, number: 101 }, sequence: 5 })], 'INVALID_INPUT')).toEqual({ field: 'deal' });
      // A deal clears only when its unit is at a branch.
      expect(await code(CORRECT, [ORG_E, U_FACT, deal({ year: 2026, number: 101 })], 'INVALID_INPUT')).toEqual({ field: 'location', reason: 'factory_with_deal' });
      // null on a unit without a deal changes nothing (its typed-in sequence stays).
      expect(await ok(CORRECT, [ORG_E, U_SOLD, deal(null)])).toMatchObject({ deal_id: null, deal_year: 2026, sequence: 90 });
      expect(await auditRows('stock.correct')).toHaveLength(0);
      expect(await count(`select count(*) as n from public.stock_deals where org_id = $1 and status = 'dispatched'`, [ORG_E])).toBe(1);
    });
    await as(db, 'authenticated', STAFF_E, () => code(CORRECT, [ORG_E, U_AVAIL, JSON.stringify({ deal: null })], 'FORBIDDEN'));
  });

  it('is admin only', async () => {
    for (const u of [STAFF_E, FACTORY_E, REVIEWER_E, ADMIN_A]) {
      await as(db, 'authenticated', u, () => code(CORRECT, [ORG_E, U_DBN, JSON.stringify({ notes: 'x' })], 'FORBIDDEN'));
    }
  });
});

describe('0017 expected version (p_expected_updated_at)', () => {
  const MOVE_V = `select * from public.stock_move_unit(p_org => $1, p_unit => $2, p_location => $3, p_reason => $4, p_deal_year => $5, p_deal_number => $6, p_expected_updated_at => $7)`;
  const CORRECT_V = `select * from public.stock_correct_unit($1, $2, $3, $4)`;
  const unitRow = (id: string) => one(`select location_id, status, notes, transfer_reason, updated_at, to_json(updated_at)#>>'{}' as v from public.stock_units where id = $1`, [id]);

  it('a stale expected version is refused with UNIT_CHANGED and nothing changes', async () => {
    await as(db, 'authenticated', ADMIN_E, async () => {
      const before = await unitRow(U_DBN);
      const stale = '2000-01-01T00:00:00Z';
      expect(await code(CORRECT_V, [ORG_E, U_DBN, JSON.stringify({ notes: 'Synthetic note' }), stale], 'UNIT_CHANGED')).toEqual({ unit_id: U_DBN });
      expect(await code(MOVE_V, [ORG_E, U_DBN, 'JHB', 'Swap stock', null, null, stale], 'UNIT_CHANGED')).toEqual({ unit_id: U_DBN });
      expect(await unitRow(U_DBN)).toEqual(before);
      expect(await auditRows('stock.correct')).toHaveLength(0);
      expect(await auditRows('stock.move')).toHaveLength(0);
      // Someone else wrote the unit after it was read: the version read before is now stale.
      await ok(CORRECT, [ORG_E, U_DBN, JSON.stringify({ notes: 'Synthetic note' })]);
      await code(MOVE_V, [ORG_E, U_DBN, 'JHB', 'Swap stock', null, null, before.v], 'UNIT_CHANGED');
      expect((await unitRow(U_DBN)).location_id).toBe('DBN');
    });
  });

  it('a matching version works (exact to the microsecond), for correct and move', async () => {
    await as(db, 'authenticated', ADMIN_E, async () => {
      const { v } = await unitRow(U_DBN);
      expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(await ok(CORRECT_V, [ORG_E, U_DBN, JSON.stringify({ notes: 'Synthetic note' }), v])).toMatchObject({ notes: 'Synthetic note' });
      const after = await unitRow(U_DBN);
      expect(await ok(MOVE_V, [ORG_E, U_DBN, 'JHB', 'Swap stock', null, null, after.v])).toMatchObject({ location_id: 'JHB', transfer_reason: 'Swap stock' });
      expect(await auditRows('stock.move')).toHaveLength(1);
    });
    // Factory staff's Factory -> branch move with a deal and the current version.
    await as(db, 'authenticated', FACTORY_E, async () => {
      const { v } = await unitRow(U_FACT);
      expect(await ok(MOVE_V, [ORG_E, U_FACT, 'CPT', null, 2026, 102, v])).toMatchObject({ location_id: 'CPT', deal_id: D_102 });
    });
  });

  it('no version behaves as before: positional 0011 calls and named calls without the argument (dispatch page)', async () => {
    await as(db, 'authenticated', FACTORY_E, async () => {
      const named = `select * from public.stock_move_unit(p_org => $1, p_unit => $2, p_location => $3, p_reason => $4, p_deal_year => $5, p_deal_number => $6)`;
      expect(await ok(named, [ORG_E, U_FACT, 'CPT', null, 2026, 102])).toMatchObject({ location_id: 'CPT', deal_id: D_102 });
    });
    await as(db, 'authenticated', ADMIN_E, async () => {
      expect(await ok(MOVE, [ORG_E, U_DBN, 'JHB', 'Swap stock', null, null])).toMatchObject({ location_id: 'JHB' });
      expect(await ok(CORRECT, [ORG_E, U_DBN, JSON.stringify({ notes: 'Synthetic note' })])).toMatchObject({ notes: 'Synthetic note' });
      expect(await ok(CORRECT_V, [ORG_E, U_DBN, JSON.stringify({ status: 'reserved' }), null])).toMatchObject({ status: 'reserved' });
      await code(MOVE, [ORG_E, '00000000-0000-0000-0000-00000000dead', 'CPT', 'Swap stock', null, null], 'UNIT_NOT_FOUND');
      // A missing unit is still UNIT_NOT_FOUND with a version given.
      await code(MOVE_V, [ORG_E, '00000000-0000-0000-0000-00000000dead', 'CPT', 'Swap stock', null, null, '2000-01-01T00:00:00Z'], 'UNIT_NOT_FOUND');
    });
  });

  it('roles are checked first, as before: non-admins and other orgs get FORBIDDEN, never UNIT_CHANGED', async () => {
    const stale = '2000-01-01T00:00:00Z';
    for (const u of [STAFF_E, FACTORY_E, REVIEWER_E, ADMIN_A]) {
      await as(db, 'authenticated', u, () => code(CORRECT_V, [ORG_E, U_DBN, JSON.stringify({ notes: 'x' }), stale], 'FORBIDDEN'));
    }
    for (const u of [STAFF_E, FACTORY_E]) {
      await as(db, 'authenticated', u, () => code(MOVE_V, [ORG_E, U_DBN, 'JHB', 'Swap stock', null, null, null], 'FORBIDDEN'));
    }
    for (const u of [REVIEWER_E, INSPECTOR_E, ADMIN_A]) {
      await as(db, 'authenticated', u, () => code(MOVE_V, [ORG_E, U_FACT, 'JHB', null, null, null, stale], 'FORBIDDEN'));
    }
  });

  it('privileges: clients call only the public names; the 0011 bodies and the version helper are internal', async () => {
    const r = await db.query(
      `select p.oid::regprocedure::text as f, has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('anon', p.oid, 'execute') as anon, p.prosecdef as definer, p.proconfig as cfg
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('stock_move_unit', 'stock_correct_unit', 'stock_move_unit_unchecked', 'stock_correct_unit_unchecked', 'stock_check_unit_version')
       order by 1`);
    const by = Object.fromEntries(r.rows.map((x) => [x.f.replace(/\(.*/, ''), x]));
    expect(Object.keys(by).sort()).toEqual(['stock_check_unit_version', 'stock_correct_unit', 'stock_correct_unit_unchecked', 'stock_move_unit', 'stock_move_unit_unchecked']);
    expect(r.rows).toHaveLength(5);   // one function per name: no ambiguous overloads
    for (const f of ['stock_move_unit', 'stock_correct_unit']) expect(by[f], f).toMatchObject({ auth: true, anon: false, definer: true, cfg: ['search_path=""'] });
    for (const f of ['stock_move_unit_unchecked', 'stock_correct_unit_unchecked', 'stock_check_unit_version']) expect(by[f], f).toMatchObject({ auth: false, anon: false });
  });
});

describe('stock_dismiss_deal / stock_restore_deal', () => {
  it('admin dismisses with a reason (on the deal and in the history, not in the audit) and restores', async () => {
    await as(db, 'authenticated', ADMIN_E, async () => {
      const d = await ok(DISMISS, [ORG_E, D_101, ' SENT 26/03 ']);
      expect(d).toMatchObject({ status: 'dismissed', dismissed_reason: 'SENT 26/03', dismissed_by: ADMIN_E });
      expect(d.dismissed_at).toBeTruthy();
      await code(DISPATCH, dispatchArgs({ vin: 'TESTVINDISMISS01', year: 2026, number: 101 }), 'DEAL_DISMISSED');
      await code(DISMISS, [ORG_E, D_101, 'again'], 'DEAL_DISMISSED');
      const r = await ok(RESTORE, [ORG_E, D_101]);
      expect(r).toMatchObject({ status: 'awaiting_dispatch', dismissed_reason: null, dismissed_at: null, dismissed_by: null });
      const [dis] = await auditRows('stock.dismiss');
      const [res] = await auditRows('stock.restore');
      const history = (await db.query(`select id, reason, dismissed_by from public.stock_deal_dismissals where deal_id = $1 order by dismissed_at`, [D_101])).rows;
      expect(history).toEqual([{ id: expect.any(String), reason: 'SENT 26/03', dismissed_by: ADMIN_E }]);
      expect(dis.meta).toEqual({ deal_id: D_101, deal_year: 2026, deal_number: 101, dismissal_id: history[0].id });
      expect(res.meta).toEqual({ deal_id: D_101, deal_year: 2026, deal_number: 101 });
      expectCleanMeta(dis.meta);
      await ok(DISPATCH, dispatchArgs({ vin: 'TESTVINDISMISS01', year: 2026, number: 101 }));
    });
  });

  it('every dismissal reason survives restore and re-dismiss (Activity: dismissal history)', async () => {
    await as(db, 'authenticated', ADMIN_E, async () => {
      await ok(DISMISS, [ORG_E, D_102, 'SENT 26/03']);
      await ok(RESTORE, [ORG_E, D_102]);
      await ok(DISMISS, [ORG_E, D_102, 'Duplicate deal']);
      const history = (await db.query(`select reason from public.stock_deal_dismissals where deal_id = $1 order by dismissed_at, reason`, [D_102])).rows.map((x) => x.reason);
      expect(history.sort()).toEqual(['Duplicate deal', 'SENT 26/03']);
      const ids = (await auditRows('stock.dismiss')).map((a) => a.meta.dismissal_id);
      expect(new Set(ids).size).toBe(2);
      expect(await count(`select count(*) as n from public.stock_deal_dismissals where id = any($1::uuid[])`, [ids])).toBe(2);
    });
    // Readable by stock.read roles, factory included (the reason is already on the deal row they read).
    expect(await as(db, 'authenticated', FACTORY_E, () => count(`select count(*) as n from public.stock_deal_dismissals where deal_id = $1`, [D_103]))).toBe(1);
  });

  it('requires a reason and a dismissable deal', async () => {
    await as(db, 'authenticated', ADMIN_E, async () => {
      await code(DISMISS, [ORG_E, D_101, '   '], 'REASON_REQUIRED');
      await code(DISMISS, [ORG_E, D_101, null], 'REASON_REQUIRED');
      await code(DISMISS, [ORG_E, D_101, 'x'.repeat(201)], 'INVALID_INPUT');
      expect(await code(DISMISS, [ORG_E, D_104, 'SENT 26/03'], 'DEAL_ALREADY_DISPATCHED')).toMatchObject({ vin: 'TESTVINAVL0000004' });
      await code(DISMISS, [ORG_E, '00000000-0000-0000-0000-00000000dead', 'SENT 26/03'], 'DEAL_NOT_FOUND');
      await code(RESTORE, [ORG_E, D_101], 'DEAL_NOT_DISMISSED');
      await code(RESTORE, [ORG_E, '00000000-0000-0000-0000-00000000dead'], 'DEAL_NOT_FOUND');
    });
  });

  it('staff, factory and reviewers cannot dismiss or restore; nor can another org', async () => {
    for (const u of [STAFF_E, FACTORY_E, REVIEWER_E, ADMIN_A]) {
      await as(db, 'authenticated', u, () => code(DISMISS, [ORG_E, D_101, 'SENT 26/03'], 'FORBIDDEN'));
      await as(db, 'authenticated', u, () => code(RESTORE, [ORG_E, D_103], 'FORBIDDEN'));
    }
    expect((await one(`select status from public.stock_deals where id = $1`, [D_103])).status).toBe('dismissed');
  });
});

describe('stock_apply_invoice', () => {
  const r = (row: Row) => row.r as Record<string, unknown>;

  it('manual (admin): unpaid reserves, paid sells, the same state again is a no-op', async () => {
    await as(db, 'authenticated', ADMIN_E, async () => {
      expect(r(await ok(APPLY, applyArgs(' inv-e-100 ', 'TESTVINDBN0000005', 'reserved', 'manual'))))
        .toMatchObject({ result: 'reserved', from_status: 'available', unit_id: U_DBN, invoice_number: 'INV-E-100' });
      expect(await one(`select status, invoice_number, sold_at from public.stock_units where id = $1`, [U_DBN])).toEqual({ status: 'reserved', invoice_number: 'INV-E-100', sold_at: null });
      expect(r(await ok(APPLY, applyArgs('INV-E-100', 'testvin dbn 0000005', 'sold', 'manual')))).toMatchObject({ result: 'sold', from_status: 'reserved' });
      const sold = await one(`select status, sold_at from public.stock_units where id = $1`, [U_DBN]);
      expect(sold.status).toBe('sold');
      expect(sold.sold_at).toBeTruthy();
      expect(r(await ok(APPLY, applyArgs('INV-E-100', 'TESTVINDBN0000005', 'sold', 'manual')))).toMatchObject({ result: 'noop', status: 'sold' });
      const [res] = await auditRows('stock.reserve');
      const sells = await auditRows('stock.sell');
      expect(sells).toHaveLength(1);
      expect(res.meta).toEqual({ unit_id: U_DBN, vin: 'TESTVINDBN0000005', model: '3000D', invoice_number: 'INV-E-100', mode: 'manual', from_status: 'available' });
      expectCleanMeta(sells[0].meta);
    });
  });

  it('matches a VIN contained in a longer reference', async () => {
    await as(db, 'authenticated', ADMIN_E, async () => {
      expect(r(await ok(APPLY, applyArgs('INV-E-101', 'Trailer TESTVINDBN0000005 deposit', 'reserved', 'manual')))).toMatchObject({ result: 'reserved', unit_id: U_DBN });
    });
  });

  it('preview changes nothing and writes no audit row', async () => {
    await as(db, 'authenticated', ADMIN_E, async () => {
      expect(r(await ok(APPLY, applyArgs('INV-E-102', 'TESTVINDBN0000005', 'sold', 'preview')))).toMatchObject({ result: 'sold', from_status: 'available', mode: 'preview' });
      expect(r(await ok(APPLY, applyArgs('INV-E-102', 'NOPE-NOPE', 'sold', 'preview')))).toMatchObject({ result: 'exception', reason: 'vin_not_found', code: 'VIN_NOT_FOUND', recorded: false });
      expect((await one(`select status, invoice_number from public.stock_units where id = $1`, [U_DBN]))).toEqual({ status: 'available', invoice_number: null });
      expect(await count(`select count(*) as n from public.audit_log where org_id = $1 and action like 'stock.%'`, [ORG_E])).toBe(0);
      expect(await count(`select count(*) as n from public.stock_invoice_exceptions where org_id = $1 and ${NOT_RLS_FIXTURE}`, [ORG_E])).toBe(0);
    });
  });

  it('manual errors change nothing: VIN not found / missing / ambiguous and every conflict', async () => {
    await as(db, 'authenticated', ADMIN_E, async () => {
      await code(APPLY, applyArgs('INV-E-200', 'UNKNOWNVIN000001', 'reserved', 'manual'), 'VIN_NOT_FOUND');
      await code(APPLY, applyArgs('INV-E-200', '   ', 'reserved', 'manual'), 'VIN_NOT_FOUND');
      await code(APPLY, applyArgs('INV-E-200', 'TESTVINDBN0000005 TESTVINAVL0000004', 'reserved', 'manual'), 'VIN_AMBIGUOUS');
      expect(await code(APPLY, applyArgs('INV-E-200', 'TESTVINRES0000002', 'sold', 'manual'), 'UNIT_LINKED_OTHER_INVOICE')).toMatchObject({ unit_id: U_RES, unit_invoice_number: 'INV-E-002' });
      expect(await code(APPLY, applyArgs('inv-e-002', 'TESTVINDBN0000005', 'reserved', 'manual'), 'INVOICE_LINKED_OTHER_UNIT')).toMatchObject({ other_unit_id: U_RES });
      await code(APPLY, applyArgs('INV-E-001', 'TESTVINSOLD000001', 'reserved', 'manual'), 'UNIT_SOLD');
      await code(APPLY, applyArgs(null, 'TESTVINDBN0000005', 'reserved', 'manual'), 'INVALID_INPUT');
      await code(APPLY, applyArgs('INV-E-200', 'TESTVINDBN0000005', 'exception:voided', 'manual'), 'INVALID_INPUT');
      await code(APPLY, applyArgs('INV-E-200', 'TESTVINDBN0000005', 'paid', 'manual'), 'INVALID_INPUT');
      await code(APPLY, applyArgs('INV-E-200', 'TESTVINDBN0000005', 'sold', 'yolo'), 'INVALID_INPUT');
      const units = (await db.query(`select id, status, invoice_number from public.stock_units where org_id = $1 order by id`, [ORG_E])).rows;
      expect(units.find((u) => u.id === U_DBN)).toMatchObject({ status: 'available', invoice_number: null });
      expect(units.find((u) => u.id === U_RES)).toMatchObject({ status: 'reserved', invoice_number: 'INV-E-002' });
      expect(await count(`select count(*) as n from public.audit_log where org_id = $1 and action like 'stock.%'`, [ORG_E])).toBe(0);
    });
  });

  it('live (service role, the job): applies; records each exception once per invoice and reason', async () => {
    await as(db, 'service_role', null, async () => {
      expect(r(await ok(APPLY, applyArgs('INV-E-300', 'TESTVINDBN0000005', 'reserved', 'live', 'xero-inv-300')))).toMatchObject({ result: 'reserved' });
      expect(await one(`select status, invoice_number, xero_invoice_id from public.stock_units where id = $1`, [U_DBN]))
        .toEqual({ status: 'reserved', invoice_number: 'INV-E-300', xero_invoice_id: 'xero-inv-300' });
      const [res] = await auditRows('stock.reserve');
      expect(res.actor_user).toBeNull();
      expect(res.meta).toMatchObject({ mode: 'live', xero_invoice_id: 'xero-inv-300' });

      const first = r(await ok(APPLY, applyArgs('INV-E-301', 'Customer deposit TESTVINRES0000002', 'sold', 'live', 'xero-inv-301')));
      expect(first).toMatchObject({ result: 'exception', reason: 'unit_linked_other_invoice', recorded: true, unit_id: U_RES });
      const again = r(await ok(APPLY, applyArgs('INV-E-301', 'Customer deposit TESTVINRES0000002', 'sold', 'live', 'xero-inv-301')));
      expect(again).toMatchObject({ result: 'exception', recorded: false });
      expect(r(await ok(APPLY, applyArgs('INV-E-302', 'TESTVINAVL0000004', 'exception:voided', 'live', 'xero-inv-302')))).toMatchObject({ result: 'exception', reason: 'voided', recorded: true });
      expect(r(await ok(APPLY, applyArgs(null, 'PO 7788', 'exception:credit_note', 'live', 'xero-cn-1')))).toMatchObject({ result: 'exception', reason: 'credit_note', recorded: true });
      await code(APPLY, applyArgs(null, 'PO 7788', 'reserved', 'live', 'xero-cn-1'), 'INVALID_INPUT');

      const exc = (await db.query(`select invoice_number, xero_invoice_id, reason, unit_id, reference from public.stock_invoice_exceptions where org_id = $1 and ${NOT_RLS_FIXTURE}`, [ORG_E])).rows;
      expect(exc).toHaveLength(3);
      expect(exc.find((e) => e.reason === 'unit_linked_other_invoice')).toMatchObject({ invoice_number: 'INV-E-301', unit_id: U_RES, reference: 'Customer deposit TESTVINRES0000002' });
      expect(exc.find((e) => e.reason === 'voided')).toMatchObject({ invoice_number: 'INV-E-302', unit_id: U_AVAIL });
      expect(exc.find((e) => e.reason === 'credit_note')).toMatchObject({ invoice_number: null, xero_invoice_id: 'xero-cn-1', unit_id: null });
      const excAudit = await auditRows('stock.exception');
      expect(excAudit).toHaveLength(3);
      for (const a of excAudit) {
        for (const k of Object.keys(a.meta)) expect(AUDIT_META_KEYS.has(k), k).toBe(true);
        expect(JSON.stringify(a.meta)).not.toContain('deposit');
      }
      // The units involved in exceptions are unchanged.
      expect(await one(`select status, invoice_number from public.stock_units where id = $1`, [U_RES])).toEqual({ status: 'reserved', invoice_number: 'INV-E-002' });
      expect(await one(`select status, invoice_number from public.stock_units where id = $1`, [U_AVAIL])).toEqual({ status: 'available', invoice_number: null });
    });
  });

  it('a resolved exception is not recorded again for the same invoice and reason', async () => {
    await as(db, 'service_role', null, async () => {
      await ok(APPLY, applyArgs('INV-E-400', 'TESTVINAVL0000004', 'exception:voided', 'live'));
      await db.query(`update public.stock_invoice_exceptions set resolved_at = now(), resolution = 'Checked' where org_id = $1 and invoice_number = 'INV-E-400'`, [ORG_E]);
      expect(r(await ok(APPLY, applyArgs('INV-E-400', 'TESTVINAVL0000004', 'exception:voided', 'live')))).toMatchObject({ recorded: false });
      expect(await count(`select count(*) as n from public.stock_invoice_exceptions where org_id = $1 and invoice_number = 'INV-E-400'`, [ORG_E])).toBe(1);
    });
  });

  it('0019: a resolved exception blocks only the same or an older Xero state; a later change raises a new one', async () => {
    const APPLY7 = `select public.stock_apply_invoice($1, $2, $3, $4, $5, $6, $7) as r`;
    const T1 = '2026-05-01T10:00:00Z';
    const T2 = '2026-05-02T10:00:00Z';
    const n = () => count(`select count(*) as n from public.stock_invoice_exceptions where org_id = $1 and invoice_number = 'INV-E-410'`, [ORG_E]);
    await as(db, 'service_role', null, async () => {
      expect(r(await ok(APPLY7, [...applyArgs('INV-E-410', 'TESTVINAVL0000004', 'exception:voided', 'live', 'xero-inv-410'), T1]))).toMatchObject({ recorded: true });
      // Open: the same or a later state adds nothing.
      expect(r(await ok(APPLY7, [...applyArgs('INV-E-410', 'TESTVINAVL0000004', 'exception:voided', 'live', 'xero-inv-410'), T2]))).toMatchObject({ recorded: false });
      expect(await one(`select source_updated_utc from public.stock_invoice_exceptions where org_id = $1 and invoice_number = 'INV-E-410'`, [ORG_E]))
        .toEqual({ source_updated_utc: new Date(T1) });
      await db.query(`update public.stock_invoice_exceptions set resolved_at = now(), resolution = 'Checked' where org_id = $1 and invoice_number = 'INV-E-410'`, [ORG_E]);
      // Resolved for T1: T1 again (nightly sweep) is not raised again.
      expect(r(await ok(APPLY7, [...applyArgs('INV-E-410', 'TESTVINAVL0000004', 'exception:voided', 'live', 'xero-inv-410'), T1]))).toMatchObject({ recorded: false });
      expect(await n()).toBe(1);
      // The invoice changed again in Xero (T2) and still breaks the rules: a new open exception.
      expect(r(await ok(APPLY7, [...applyArgs('INV-E-410', 'TESTVINAVL0000004', 'exception:voided', 'live', 'xero-inv-410'), T2]))).toMatchObject({ recorded: true });
      expect(await n()).toBe(2);
      expect(await count(`select count(*) as n from public.stock_invoice_exceptions where org_id = $1 and invoice_number = 'INV-E-410' and resolved_at is null`, [ORG_E])).toBe(1);
    });
  });

  it('0019: factory staff cannot read the credit notes mirror; staff can', async () => {
    await db.query(`insert into public.xero_credit_notes(org_id, tenant_id, credit_note_id, credit_note_type, raw) values ($1, 't-e', 'cn-e-1', 'ACCRECCREDIT', '{}') on conflict do nothing`, [ORG_E]);
    expect(await as(db, 'authenticated', FACTORY_E, () => count(`select count(*) as n from public.xero_credit_notes where org_id = $1`, [ORG_E]))).toBe(0);
    expect(await as(db, 'authenticated', STAFF_E, () => count(`select count(*) as n from public.xero_credit_notes where org_id = $1`, [ORG_E]))).toBe(1);
    expect(await as(db, 'authenticated', ADMIN_A, () => count(`select count(*) as n from public.xero_credit_notes where org_id = $1`, [ORG_E]))).toBe(0);
    await as(db, 'authenticated', ADMIN_E, async () => {
      const { err } = await attempt(`insert into public.xero_credit_notes(org_id, tenant_id, credit_note_id, raw) values ($1, 't', 'cn-x', '{}')`, [ORG_E]);
      expect(err).not.toBeNull();
    });
  });

  it('roles and modes: admin only for clients (preview, manual); live and preview for the service role', async () => {
    for (const u of [STAFF_E, FACTORY_E, REVIEWER_E, ADMIN_A]) {
      await as(db, 'authenticated', u, () => code(APPLY, applyArgs('INV-E-500', 'TESTVINDBN0000005', 'reserved', 'manual'), 'FORBIDDEN'));
    }
    await as(db, 'authenticated', ADMIN_E, () => code(APPLY, applyArgs('INV-E-500', 'TESTVINDBN0000005', 'reserved', 'live'), 'FORBIDDEN'));
    await as(db, 'service_role', null, async () => {
      await code(APPLY, applyArgs('INV-E-500', 'TESTVINDBN0000005', 'reserved', 'manual'), 'FORBIDDEN');
      expect(r(await ok(APPLY, applyArgs('INV-E-500', 'TESTVINDBN0000005', 'reserved', 'preview')))).toMatchObject({ result: 'reserved', mode: 'preview' });
      await code(APPLY, applyArgs('INV-E-500', 'TESTVINDBN0000005', 'reserved', 'live', null, '00000000-0000-0000-0000-00000000beef'), 'INVALID_INPUT');
    });
  });
});

describe('cross-org: the RPCs never reach another org\'s deals or units', () => {
  it('org E callers get not-found for org A rows that exist, and org A rows stay unchanged', async () => {
    // Positive control: the org A fixtures exist (created in this file's beforeAll).
    expect(await count(`select count(*) as n from public.stock_deals where org_id = $1 and year = 2026 and number = 97001`, [ORG_A])).toBe(1);
    expect(await count(`select count(*) as n from public.stock_units where org_id = $1 and id = $2`, [ORG_A, U_A])).toBe(1);
    await as(db, 'authenticated', STAFF_E, async () => {
      expect(await code(DISPATCH, dispatchArgs({ vin: 'TESTVINXORG00001', year: 2026, number: 97001 }), 'DEAL_NOT_FOUND')).toEqual({ year: 2026, number: 97001 });
      await code(MOVE, [ORG_E, U_A, 'CPT', null, null, null], 'UNIT_NOT_FOUND');
    });
    await as(db, 'authenticated', ADMIN_E, async () => {
      await code(MOVE, [ORG_E, U_A, 'CPT', 'Swap stock', null, null], 'UNIT_NOT_FOUND');
      await code(MOVE, [ORG_E, U_FACT, 'CPT', null, 2026, 97001], 'DEAL_NOT_FOUND');
      await code(CORRECT, [ORG_E, U_A, JSON.stringify({ notes: 'x' })], 'UNIT_NOT_FOUND');
      await code(DISMISS, [ORG_E, D_A, 'SENT 26/03'], 'DEAL_NOT_FOUND');
      await code(RESTORE, [ORG_E, D_A], 'DEAL_NOT_FOUND');
      await code(APPLY, applyArgs('INV-E-XORG', 'TESTVINORGA000001', 'reserved', 'manual'), 'VIN_NOT_FOUND');
      // Naming org A directly is refused: org E's admin is not a member there.
      await code(MOVE, [ORG_A, U_A, 'CPT', 'Swap stock', null, null], 'FORBIDDEN');
      await code(DISMISS, [ORG_A, D_A, 'SENT 26/03'], 'FORBIDDEN');
      // The same VIN is free in org E (VINs are unique per org).
      await ok(DISPATCH, dispatchArgs({ vin: 'TESTVINORGA000001' }));
    });
    expect(await one(`select status, unit_id from public.stock_deals where id = $1`, [D_A])).toEqual({ status: 'awaiting_dispatch', unit_id: null });
    expect(await one(`select location_id, status, invoice_number, notes from public.stock_units where id = $1`, [U_A]))
      .toEqual({ location_id: 'JHB', status: 'available', invoice_number: null, notes: null });
  });
});
