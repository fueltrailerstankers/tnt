// Server-side refusal of the stock setup and invoice actions for members without stock.manage (staff, reviewer,
// factory): requirePerm throws before any input is read and before the service role or an RPC is touched.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// requirePerm answers 403 with forbidden() (M7).
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('redirect'); }), forbidden: vi.fn(() => { throw new Error('Forbidden (403)'); }) }));

let role = 'staff';
const touched: string[] = [];
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-0000-0000-00000000a001' } } }) },
    from: (t: string) => {
      if (t !== 'memberships') touched.push(`user:${t}`);
      const b = {
        select: () => b, eq: () => b, order: () => b, limit: () => b,
        maybeSingle: async () => ({ data: { id: 'm1', org_id: '00000000-0000-0000-0000-000000000001', role, branch: null, access: null, status: 'active', last_seen_at: new Date().toISOString() }, error: null }),
      };
      return b;
    },
    rpc: async (name: string) => { touched.push(`rpc:${name}`); return { data: null, error: null }; },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => { touched.push('service-role'); throw new Error('service role used'); } }));

const setup = await import('@/app/(admin)/admin/stock/setup/actions');
const invoices = await import('@/app/(admin)/admin/stock/invoices/actions');

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

const calls: Array<[string, () => Promise<unknown>]> = [
  ['saveStartDate', () => setup.saveStartDate({}, fd({ start: '2026-01-01' }))],
  ['saveInvoicesFrom', () => setup.saveInvoicesFrom({}, fd({ invoices_from: '2026-01-01' }))],
  ['saveInvoiceRules', () => setup.saveInvoiceRules({}, fd({ mode: 'live', confirm: 'live' }))],
  ['rebuildDeals', () => setup.rebuildDeals()],
  ['importOpeningStock', () => setup.importOpeningStock({}, fd({ intent: 'apply', csv: 'VIN,Model,Location,Status\nTESTVIN0000000001,3000D,JHB,available' }))],
  ['applyManualInvoice', () => invoices.applyManualInvoice({}, fd({ invoice_number: 'INV-1', reference: 'TESTVIN0000000001', status: 'sold' }))],
  ['resolveException', () => invoices.resolveException({}, fd({ id: '00000000-0000-0000-0000-000000000009', note: 'x' }))],
];

beforeEach(() => { touched.length = 0; });

describe('stock setup and invoice actions refuse members without stock.manage', () => {
  for (const r of ['staff', 'reviewer', 'factory', 'inspector']) {
    for (const [name, call] of calls) {
      it(`${r}: ${name} is forbidden and touches nothing`, async () => {
        role = r;
        await expect(call()).rejects.toThrow(/Forbidden/);
        expect(touched).toEqual([]);
      });
    }
  }

  it('control: an admin gets past the permission check (and reaches the service role)', async () => {
    role = 'admin';
    await expect(setup.rebuildDeals()).rejects.toThrow('service role used');
    expect(touched).toEqual(['service-role']);
  });
});
