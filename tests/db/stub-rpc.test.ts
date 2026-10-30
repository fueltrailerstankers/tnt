// The e2e stub's /rpc response shape (tests/e2e/pgrst-rpc.mjs) against real functions. PostgREST answers a
// non-SETOF function with one JSON value (a row object for a composite, the bare value for a scalar) and a SETOF
// function with an array; code written against Supabase must work unchanged under the stub. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { runRpc } from '../e2e/pgrst-rpc.mjs';
import { as, connect } from './helpers';

const ORG_A = '00000000-0000-0000-0000-000000000001';
const STAFF = '00000000-0000-0000-0000-00000000c701';
const quote = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`unsupported identifier ${s}`);
  return `"${s}"`;
};

let db: Client;

beforeAll(async () => {
  db = await connect();
  await db.query(`insert into auth.users(id, email) values ($1, 'stub-rpc@example.invalid') on conflict do nothing`, [STAFF]);
  await db.query(`insert into public.memberships(org_id, user_id, role) values ($1, $2, 'staff') on conflict do nothing`, [ORG_A, STAFF]);
});

afterAll(async () => { await db.end(); });

describe('mini-supabase rpc', () => {
  it('a function returning one composite row (stock_dispatch_unit) answers with an object, as PostgREST does', async () => {
    await as(db, 'authenticated', STAFF, async () => {
      const unit = await runRpc(db, 'stock_dispatch_unit', { p_org: ORG_A, p_vin: 'stub rpc vin 0001', p_model: '3000D', p_location: 'JHB' }, quote);
      expect(Array.isArray(unit)).toBe(false);
      expect(unit).toMatchObject({ vin_norm: 'STUBRPCVIN0001', model_part: '3000D', location_id: 'JHB', status: 'available' });
    });
  });

  it('a SETOF / TABLE function (form_overview) answers with an array', async () => {
    await as(db, 'authenticated', STAFF, async () => {
      const rows = await runRpc(db, 'form_overview', {}, quote);
      expect(Array.isArray(rows)).toBe(true);
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  it('a scalar function answers with the bare value (xero_claim_refresh -> false, stock_apply_invoice -> its jsonb)', async () => {
    await as(db, 'service_role', null, async () => {
      expect(await runRpc(db, 'xero_claim_refresh', { p_connection: '00000000-0000-0000-0000-00000000dead' }, quote)).toBe(false);
      const r = await runRpc(db, 'stock_apply_invoice',
        { p_org: ORG_A, p_invoice_number: 'INV-STUB-1', p_xero_invoice_id: null, p_reference: 'NO VIN HERE', p_outcome: 'sold', p_mode: 'preview' }, quote);
      expect(r).toMatchObject({ result: 'exception', reason: 'vin_not_found', mode: 'preview' });
    });
  });

  it('rejects identifiers it does not expect before running anything', async () => {
    await expect(runRpc(db, 'form_overview(); drop table x; --', {}, quote)).rejects.toThrow(/unsupported identifier/);
  });

  it('an array of objects reaches a jsonb parameter as JSON (sync_form_workflow, M8)', async () => {
    const form = (await db.query(`select id from public.forms where slug = 'job-card' and org_id = $1`, [ORG_A])).rows[0].id;
    await as(db, 'service_role', null, async () => {
      await runRpc(db, 'sync_form_workflow', { p_form: form, p_statuses: [{ name: 'Incomplete', color: 'gray', sort_order: 0 }], p_roles: [{ name: 'Public', is_public: true }] }, quote);
      expect((await db.query(`select name from public.form_statuses where form_id = $1`, [form])).rows).toEqual([{ name: 'Incomplete' }]);
    });
  });
});
