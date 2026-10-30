import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { as, connect } from './helpers';

const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_B = '00000000-0000-0000-0000-0000000000b2';
const ADMIN_A = '00000000-0000-0000-0000-00000000a001';
const ADMIN_B = '00000000-0000-0000-0000-00000000b001';

// Every table that carries org_id and is readable by org members.
const ORG_READABLE = [
  'forms', 'form_statuses', 'form_roles', 'form_counters', 'entries', 'entry_reads', 'entry_files',
  'entry_events', 'entry_links', 'email_log', 'entry_documents', 'audit_log',
  'notification_recipients', 'app_settings', 'memberships', 'orgs',
  'xero_contacts', 'xero_quotes', 'xero_quote_lines', 'xero_invoices', 'xero_invoice_lines', 'xero_payments',
  'xero_attachments', 'xero_sync_state', 'deal_files',
  'lead_sources', 'routing_rules', 'leads', 'lead_events',
  'xero_action_runs', // M3: org admins only
  'stock_locations', 'stock_models', 'stock_deals', 'stock_units', 'stock_invoice_exceptions', 'stock_deal_dismissals', // M6
  'xero_credit_notes', // M6 0019
  'saved_views', 'terms_versions', // 0015: own saved views; terms versions readable by members
  'import_runs', // Cognito import: org admins only
];
// Service-role-only tables: no client may read them at all.
const SERVICE_ONLY = ['integration_events', 'outbox_jobs', 'job_runs', 'external_refs', 'action_claims', 'xero_connections', 'xero_oauth_states',
  'cognito_api_keys'];

let db: Client;
let entryA: string;

beforeAll(async () => {
  db = await connect();
  // Synthetic fixtures only. No real people, emails or documents.
  await db.query(`insert into auth.users(id, email) values ($1,'admin-a@example.invalid'), ($2,'admin-b@example.invalid')`, [ADMIN_A, ADMIN_B]);
  await db.query(`insert into public.orgs(id, name) values ($1, 'Org B')`, [ORG_B]);
  await db.query(`insert into public.memberships(org_id, user_id, role) values ($1,$2,'admin'), ($3,$4,'admin')`, [ORG_A, ADMIN_A, ORG_B, ADMIN_B]);

  const form = await db.query(`select id from public.forms where slug = 'release-form' and org_id = $1`, [ORG_A]);
  const e = await db.query(
    `insert into public.entries(form_id, number, status, data) values ($1, 0, 'Submitted', '{"VINNO":"TESTVIN0000000001"}') returning id`,
    [form.rows[0].id],
  );
  entryA = e.rows[0].id;
  await db.query(`insert into public.entry_files(entry_id, field_key, storage_path, file_name) values ($1,'X','release-form/x/a.txt','a.txt')`, [entryA]);
  await db.query(`insert into public.entry_events(entry_id, action) values ($1,'Submit')`, [entryA]);
  await db.query(`insert into public.entry_links(token, entry_id, role_name) values (repeat('a', 64), $1,'Reviewer')`, [entryA]);
  await db.query(`insert into public.entry_reads(entry_id, user_id) values ($1,$2)`, [entryA, ADMIN_A]);
  await db.query(`insert into public.email_log(entry_id, to_addresses, subject) values ($1, array['sales@example.invalid'], 'test')`, [entryA]);
  await db.query(`insert into public.entry_documents(entry_id, template_number, storage_path) values ($1, 1, 'release-form/x/doc.pdf')`, [entryA]);
  await db.query(`insert into public.audit_log(org_id, action) values ($1,'test.action')`, [ORG_A]);
  await db.query(`insert into public.notification_recipients(org_id, event_key, address) values ($1,'deal.created','sales@example.invalid')`, [ORG_A]);
  await db.query(`insert into public.app_settings(org_id, key, value) values ($1,'k','{}')`, [ORG_A]);
  await db.query(`insert into public.xero_connections(org_id, tenant_id) values ($1,'tenant-test')`, [ORG_A]);
  await db.query(`insert into public.integration_events(org_id, source, signature_ok, payload) values ($1,'xero',true,'{}')`, [ORG_A]);
  await db.query(`insert into public.xero_oauth_states(state_hash, org_id, user_id, expires_at) values ('h', $1, $2, now())`, [ORG_A, ADMIN_A]);
  // Synthetic Xero mirror rows (M2).
  await db.query(`insert into public.xero_contacts(org_id, tenant_id, contact_id, name, raw) values ($1,'t','c1','Test Contact','{}')`, [ORG_A]);
  await db.query(`insert into public.xero_quotes(org_id, tenant_id, quote_id, quote_number, quote_no, currency_code, total, raw) values ($1,'t','q1','QU-90001','90001','ZAR',100,'{}')`, [ORG_A]);
  await db.query(`insert into public.xero_quote_lines(org_id, quote_id, line_no, description) values ($1,'q1',1,'x')`, [ORG_A]);
  await db.query(`insert into public.xero_invoices(org_id, tenant_id, invoice_id, invoice_number, currency_code, total, raw) values ($1,'t','i1','INV-90001','ZAR',100,'{}')`, [ORG_A]);
  await db.query(`insert into public.xero_invoice_lines(org_id, invoice_id, line_no, description) values ($1,'i1',1,'x')`, [ORG_A]);
  await db.query(`insert into public.xero_payments(org_id, tenant_id, payment_id, invoice_id, amount, currency_code, raw) values ($1,'t','p1','i1',100,'ZAR','{}')`, [ORG_A]);
  await db.query(`insert into public.xero_credit_notes(org_id, tenant_id, credit_note_id, credit_note_type, raw) values ($1,'t','cn1','ACCRECCREDIT','{}')`, [ORG_A]);
  await db.query(`insert into public.xero_attachments(org_id, attachment_id, parent_type, parent_id, raw) values ($1,'a1','Invoice','i1','{}')`, [ORG_A]);
  await db.query(`insert into public.xero_sync_state(org_id, entity) values ($1,'invoices')`, [ORG_A]);
  await db.query(`insert into public.deal_files(org_id, quote_no, quote_id) values ($1,'90001','q1')`, [ORG_A]);
  // Synthetic lead (M4); lead_sources and routing_rules are seeded by 0008 for the default org.
  const lead = await db.query(`insert into public.leads(org_id, source, name, email, email_norm) values ($1,'test','Test Lead','lead@example.invalid','lead@example.invalid') returning id`, [ORG_A]);
  await db.query(`insert into public.lead_events(lead_id, kind, meta) values ($1,'created','{}')`, [lead.rows[0].id]);
  // M3 action run (redacted plan only).
  await db.query(`insert into public.xero_action_runs(org_id, action, idempotency_key, mode, status) values ($1,'rfi.create_invoice','rfi.create_invoice:90001','dry_run','planned')`, [ORG_A]);
  // M6 stock (locations and models are seeded by 0011 for the default org). Synthetic VINs only.
  const deal = await db.query(`insert into public.stock_deals(org_id, year, number, location_id, model_part) values ($1, 2026, 90001, 'JHB', '3000D') returning id`, [ORG_A]);
  await db.query(`insert into public.stock_deal_dismissals(org_id, deal_id, reason) values ($1, $2, 'Synthetic reason')`, [ORG_A, deal.rows[0].id]);
  const unit = await db.query(`insert into public.stock_units(org_id, vin, model_part, location_id) values ($1, 'RLSTESTVIN0000001', '3000D', 'JHB') returning id`, [ORG_A]);
  await db.query(`insert into public.stock_invoice_exceptions(org_id, invoice_number, reason, unit_id) values ($1, 'INV-RLS-1', 'voided', $2)`, [ORG_A, unit.rows[0].id]);
  // 0015: a saved view owned by ADMIN_A and a synthetic terms version (server-written).
  await db.query(`insert into public.saved_views(org_id, user_id, scope, name, query) values ($1,$2,'form:release-form','Unread','{"view":"unread"}')`, [ORG_A, ADMIN_A]);
  await db.query(`insert into public.terms_versions(org_id, key, sha256, body) select $1, 'rls-test', public.terms_body_sha256(b), b from (select '[{"id":"t","text":"Synthetic terms."}]'::jsonb as b) x`, [ORG_A]);
  // Cognito import: an encrypted key (synthetic bytes) and a run with counts only.
  await db.query(`insert into public.cognito_api_keys(org_id, key_enc, last4) values ($1, '\\x01', 'abcd')`, [ORG_A]);
  await db.query(`insert into public.import_runs(org_id, form_slug, mode, status) values ($1, 'store-room', 'dry_run', 'done')`, [ORG_A]);
});

afterAll(async () => { await db.end(); });

describe('schema', () => {
  it('seeds exactly 7 forms', async () => {
    const r = await db.query(`select count(*)::int as n from public.forms`);
    expect(r.rows[0].n).toBe(7);
  });

  it('has RLS enabled on every public table', async () => {
    const r = await db.query(`select tablename from pg_tables where schemaname = 'public' and not rowsecurity`);
    expect(r.rows).toEqual([]);
  });

  it('every org-readable table is covered by the isolation test', async () => {
    const r = await db.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r'`);
    const covered = new Set([...ORG_READABLE, ...SERVICE_ONLY]);
    expect(r.rows.map((x) => x.relname).filter((t) => !covered.has(t))).toEqual([]);
  });
});

describe('cross-org isolation', () => {
  it('org A admin sees org A data', async () => {
    const n = await as(db, 'authenticated', ADMIN_A, async () =>
      (await db.query(`select count(*)::int as n from public.forms`)).rows[0].n);
    expect(n).toBe(7);
  });

  for (const t of ORG_READABLE.filter((x) => !['orgs', 'memberships'].includes(x))) {
    it(`positive control: org A admin sees rows of ${t}`, async () => {
      const n = await as(db, 'authenticated', ADMIN_A, async () =>
        (await db.query(`select count(*)::int as n from public.${t} where org_id = $1`, [ORG_A])).rows[0].n);
      expect(n).toBeGreaterThan(0);
    });

    it(`org B member sees no rows of ${t}`, async () => {
      const n = await as(db, 'authenticated', ADMIN_B, async () =>
        (await db.query(`select count(*)::int as n from public.${t} where org_id = $1`, [ORG_A])).rows[0].n);
      expect(n).toBe(0);
    });
  }

  it('org B member sees only their own org and membership', async () => {
    await as(db, 'authenticated', ADMIN_B, async () => {
      expect((await db.query(`select id from public.orgs`)).rows.map((r) => r.id)).toEqual([ORG_B]);
      expect((await db.query(`select user_id from public.memberships`)).rows.map((r) => r.user_id)).toEqual([ADMIN_B]);
      expect((await db.query(`select count(*)::int as n from public.profiles`)).rows[0].n).toBe(0);
    });
  });

  it('org B member sees no org A rows through the stock matrix view (security_invoker)', async () => {
    const a = await as(db, 'authenticated', ADMIN_A, async () =>
      (await db.query(`select count(*)::int as n from public.stock_matrix where org_id = $1`, [ORG_A])).rows[0].n);
    expect(a).toBeGreaterThan(0);
    const b = await as(db, 'authenticated', ADMIN_B, async () =>
      (await db.query(`select count(*)::int as n from public.stock_matrix where org_id = $1`, [ORG_A])).rows[0].n);
    expect(b).toBe(0);
  });

  it('org B member sees no org A rows through the per-form views', async () => {
    const n = await as(db, 'authenticated', ADMIN_B, async () =>
      (await db.query(`select count(*)::int as n from public.v_release_form`)).rows[0].n);
    expect(n).toBe(0);
  });

  it('org B member cannot insert into an org A form, even when spoofing org_id', async () => {
    const formA = (await db.query(`select id from public.forms where slug = 'deal' and org_id = $1`, [ORG_A])).rows[0].id;
    await expect(
      as(db, 'authenticated', ADMIN_B, () =>
        db.query(`insert into public.entries(form_id, org_id, number, data) values ($1, $2, 0, '{}')`, [formA, ORG_B])),
    ).rejects.toThrow(/permission denied|row-level security/);
  });

  it('org B member cannot update or delete org A entries', async () => {
    await expect(as(db, 'authenticated', ADMIN_B, () => db.query(`update public.entries set status = 'Approved' where id = $1`, [entryA]))).rejects.toThrow(/permission denied/);
    await expect(as(db, 'authenticated', ADMIN_B, () => db.query(`delete from public.entries where id = $1`, [entryA]))).rejects.toThrow(/permission denied/);
    const still = await db.query(`select status from public.entries where id = $1`, [entryA]);
    expect(still.rows[0].status).toBe('Submitted');
  });

  it('org B member cannot attach a file to an org A entry', async () => {
    await expect(
      as(db, 'authenticated', ADMIN_B, () =>
        db.query(`insert into public.entry_files(entry_id, field_key, storage_path, file_name) values ($1,'X','p','f')`, [entryA])),
    ).rejects.toThrow(/permission denied|row-level security/);
  });

  it('org B admin cannot grant themselves membership in org A', async () => {
    await expect(
      as(db, 'authenticated', ADMIN_B, () =>
        db.query(`insert into public.memberships(org_id, user_id, role) values ($1,$2,'admin')`, [ORG_A, ADMIN_B])),
    ).rejects.toThrow(/permission denied/);
  });

  it('org B admin cannot edit org A settings or recipients', async () => {
    await as(db, 'authenticated', ADMIN_B, async () => {
      expect((await db.query(`update public.app_settings set value = '{"x":1}' where org_id = $1`, [ORG_A])).rowCount).toBe(0);
      expect((await db.query(`update public.orgs set name = 'x' where id = $1`, [ORG_A])).rowCount).toBe(0);
    });
  });
});

describe('anon and service-only tables', () => {
  it('anon cannot read any table', async () => {
    for (const t of ['forms', 'entries', 'orgs', 'memberships', 'profiles']) {
      await expect(as(db, 'anon', null, () => db.query(`select 1 from public.${t}`))).rejects.toThrow(/permission denied/);
    }
  });

  for (const t of SERVICE_ONLY) {
    it(`authenticated users cannot read ${t}`, async () => {
      await expect(as(db, 'authenticated', ADMIN_A, () => db.query(`select 1 from public.${t}`))).rejects.toThrow(/permission denied/);
    });
  }

  it('authenticated users cannot call the entry numbering function directly', async () => {
    const f = (await db.query(`select id from public.forms limit 1`)).rows[0].id;
    await expect(as(db, 'authenticated', ADMIN_A, () => db.query(`select public.next_entry_number($1)`, [f]))).rejects.toThrow(/permission denied/);
  });
});

describe('Xero mirror (M2)', () => {
  it('members cannot write the mirror or deal files; only the server does', async () => {
    for (const sql of [
      `update public.xero_invoices set total = 1`,
      `insert into public.xero_quotes(org_id, tenant_id, quote_id, raw) values ('${ORG_A}','t','qx','{}')`,
      `delete from public.deal_files`,
      `update public.xero_sync_state set backfill_done = true`,
    ]) {
      await expect(as(db, 'authenticated', ADMIN_A, () => db.query(sql))).rejects.toThrow(/permission denied/);
    }
  });

  it('the refresh claim is exclusive and service-only', async () => {
    const c = (await db.query(`select id from public.xero_connections limit 1`)).rows[0].id;
    expect((await db.query(`select public.xero_claim_refresh($1) as ok`, [c])).rows[0].ok).toBe(true);
    expect((await db.query(`select public.xero_claim_refresh($1) as ok`, [c])).rows[0].ok).toBe(false);
    await expect(as(db, 'authenticated', ADMIN_A, () => db.query(`select public.xero_claim_refresh($1)`, [c]))).rejects.toThrow(/permission denied/);
  });
});

describe('append-only audit and member writes', () => {
  it('audit_log rows cannot be updated or deleted, even by the service role', async () => {
    await expect(db.query(`update public.audit_log set action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`delete from public.audit_log`)).rejects.toThrow(/append-only/);
  });

  it('entries are written by the server only: even an org admin cannot write them directly (0005)', async () => {
    const f = (await db.query(`select id from public.forms where slug = 'job-card'`)).rows[0].id;
    await expect(as(db, 'authenticated', ADMIN_A, () =>
      db.query(`insert into public.entries(form_id, number, data) values ($1, 0, '{}')`, [f]))).rejects.toThrow(/permission denied/);
    await expect(as(db, 'authenticated', ADMIN_A, () =>
      db.query(`update public.entries set status = 'Approved' where id = $1`, [entryA]))).rejects.toThrow(/permission denied/);
    await expect(as(db, 'authenticated', ADMIN_A, () =>
      db.query(`insert into public.entry_files(entry_id, field_key, storage_path, file_name) values ($1,'X','p','f')`, [entryA]))).rejects.toThrow(/permission denied/);
  });

  it('server-side inserts still number entries and take org_id from the form', async () => {
    const f = (await db.query(`select id from public.forms where slug = 'job-card'`)).rows[0].id;
    const r = await db.query(`insert into public.entries(form_id, number, data) values ($1, 0, '{}') returning number, org_id`, [f]);
    expect(r.rows[0].org_id).toBe(ORG_A);
    expect(r.rows[0].number).toBeGreaterThan(0);
  });
});
