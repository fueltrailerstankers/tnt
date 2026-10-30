// 0016 stock_remove_untouched_deal: the DEAL sync removes only untouched deals, checked in the same statement as the
// delete, so a dismissal (history cascades on delete) or a dispatch relinked away is never lost. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { as, connect } from './helpers';

const ORG_A = '00000000-0000-0000-0000-000000000001';
const ORG_R = '00000000-0000-0000-0000-0000000000f6';
const ADMIN_R = '00000000-0000-0000-0000-00000000f601';
const REMOVE = `select public.stock_remove_untouched_deal($1, $2) as removed`;
let db: Client;
let n = 0;

beforeAll(async () => {
  db = await connect();
  await db.query(`insert into public.orgs(id, name) values ($1, 'Remove test org') on conflict do nothing`, [ORG_R]);
  await db.query(`insert into public.stock_locations(org_id, id, name, is_factory, sort_order) values ($1, 'FACTORY', 'Factory', true, 0), ($1, 'JHB', 'Johannesburg', false, 1) on conflict do nothing`, [ORG_R]);
  await db.query(`insert into public.stock_models(org_id, part_number, description, category, active, sort_order) values ($1, '3000D', 'Sample bowser', 'metal_bowser', true, 1) on conflict do nothing`, [ORG_R]);
  await db.query(`insert into auth.users(id, email) values ($1, 'stock-remove@example.invalid') on conflict do nothing`, [ADMIN_R]);
  await db.query(`insert into public.memberships(org_id, user_id, role) values ($1, $2, 'admin') on conflict do nothing`, [ORG_R, ADMIN_R]);
});

afterAll(async () => {
  // Committed fixtures only (deals, reference rows, the org): leave nothing for the other test files.
  await db.query(`delete from public.orgs where id = $1`, [ORG_R]);
  await db.query(`delete from auth.users where id = $1`, [ADMIN_R]);
  await db.end();
});

/** A committed awaiting deal in the test org (2027 / 98xxx). */
async function deal(org = ORG_R): Promise<{ id: string; number: number }> {
  const number = 98_000 + ++n;
  const { rows } = await db.query(`insert into public.stock_deals(org_id, year, number, location_id, model_part) values ($1, 2027, $2, 'JHB', '3000D') returning id`, [org, number]);
  return { id: rows[0].id as string, number };
}

const exists = async (id: string) => (await db.query(`select 1 from public.stock_deals where id = $1`, [id])).rowCount === 1;

/** Runs fn as the org admin (signed in), then the removal as the service role, in one rolled-back transaction. */
async function adminThenService(fn: () => Promise<void>, dealId: string): Promise<boolean> {
  await db.query('begin');
  try {
    await db.query(`set local role authenticated`);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: ADMIN_R, role: 'authenticated' })]);
    await fn();
    await db.query(`reset role`);
    await db.query(`set local role service_role`);
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })]);
    const { rows } = await db.query(REMOVE, [ORG_R, dealId]);
    return rows[0].removed as boolean;
  } finally {
    await db.query('rollback');
  }
}

describe('stock_remove_untouched_deal', () => {
  it('removes an untouched awaiting deal', async () => {
    const d = await deal();
    await as(db, 'service_role', null, async () => {
      expect((await db.query(REMOVE, [ORG_R, d.id])).rows[0].removed).toBe(true);
      expect((await db.query(`select 1 from public.stock_deals where id = $1`, [d.id])).rowCount).toBe(0);
    });
  });

  it('keeps a deal that was dismissed and restored: its dismissal history survives', async () => {
    const d = await deal();
    const removed = await adminThenService(async () => {
      await db.query(`select public.stock_dismiss_deal($1, $2, 'SENT 26/03')`, [ORG_R, d.id]);
      await db.query(`select public.stock_restore_deal($1, $2)`, [ORG_R, d.id]);
    }, d.id);
    expect(removed).toBe(false);
  });

  it('keeps a deal put back to awaiting by stock_correct_unit (it had a unit)', async () => {
    const d = await deal();
    const removed = await adminThenService(async () => {
      const { rows } = await db.query(`select id from public.stock_dispatch_unit($1, 'TESTVINREMOVE0001', '3000D', 'JHB', null, '{}', null, 2027, $2)`, [ORG_R, d.number]);
      await db.query(`select public.stock_correct_unit($1, $2, '{"deal": null}'::jsonb)`, [ORG_R, rows[0].id]);
      const { rows: [back] } = await db.query(`select status, unit_id, dispatched_at from public.stock_deals where id = $1`, [d.id]);
      expect(back).toEqual({ status: 'awaiting_dispatch', unit_id: null, dispatched_at: null });
    }, d.id);
    expect(removed).toBe(false);
  });

  it('keeps dispatched and dismissed deals', async () => {
    const a = await deal();
    expect(await adminThenService(async () => {
      await db.query(`select public.stock_dispatch_unit($1, 'TESTVINREMOVE0002', '3000D', 'JHB', null, '{}', null, 2027, $2)`, [ORG_R, a.number]);
    }, a.id)).toBe(false);
    const b = await deal();
    expect(await adminThenService(async () => {
      await db.query(`select public.stock_dismiss_deal($1, $2, 'SENT 26/03')`, [ORG_R, b.id]);
    }, b.id)).toBe(false);
  });

  it('never removes another org\'s deal', async () => {
    const other = await deal(ORG_A);
    await as(db, 'service_role', null, async () => {
      expect((await db.query(REMOVE, [ORG_R, other.id])).rows[0].removed).toBe(false);
    });
    expect(await exists(other.id)).toBe(true);
    await db.query(`delete from public.stock_deals where id = $1`, [other.id]);
  });

  it('is for the server only: signed-in users (even admins) and anon cannot call it', async () => {
    const d = await deal();
    for (const [role, user] of [['authenticated', ADMIN_R], ['anon', null]] as const) {
      await expect(as(db, role, user, () => db.query(REMOVE, [ORG_R, d.id]))).rejects.toThrow(/permission denied/);
    }
    expect(await exists(d.id)).toBe(true);
  });
});
