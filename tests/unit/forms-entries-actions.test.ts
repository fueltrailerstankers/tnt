// Server-side refusal of the entries grid actions (Mark read/unread, Save/Delete view) and the export route for a
// member without Forms access (factory): requirePerm stops them before input is read and before any table, RPC or
// the service role is touched.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => { throw new Error('redirect'); }),
  notFound: vi.fn(() => { throw new Error('not found'); }),
  forbidden: vi.fn(() => { throw new Error('Forbidden (403)'); }),
}));

let role = 'factory';
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

const actions = await import('@/app/(admin)/admin/forms/[slug]/actions');
const exportRoute = await import('@/app/(admin)/admin/forms/[slug]/export/route');

const ID = '00000000-0000-4000-8000-00000000e001';
const calls: Array<[string, () => Promise<unknown>]> = [
  ['setEntriesRead', () => actions.setEntriesRead('release-form', { ids: [ID], mode: 'read' })],
  ['saveFormView', () => actions.saveFormView('release-form', { name: 'Mine', query: { view: 'unread' } })],
  ['deleteFormView', () => actions.deleteFormView('release-form', { id: ID })],
  ['export GET', () => exportRoute.GET(new Request('http://x/admin/forms/deal/export?format=csv&sel=1'), { params: Promise.resolve({ slug: 'deal' }) })],
];

describe('entries grid actions refuse members without Forms access', () => {
  beforeEach(() => { touched.length = 0; role = 'factory'; });

  for (const [name, call] of calls) {
    it(`${name}: 403 before any data access`, async () => {
      await expect(call()).rejects.toThrow('Forbidden (403)');
      expect(touched).toEqual([]);
    });
  }
});
