// Leads server actions: members without leads.manage are refused before input is read or the service role is touched;
// an allowed member only ever reaches leads of their own org (every service-role query is filtered by org_id), and
// a lead from another org is "not found" with no write.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn(() => { throw new Error('redirect'); }), forbidden: vi.fn(() => { throw new Error('Forbidden (403)'); }) }));

const ORG = '00000000-0000-0000-0000-000000000001';
const OTHER_ORG_LEAD = '00000000-0000-4000-8000-0000000000b2';
let role = 'staff';
const touched: string[] = [];
const writes: string[] = [];
const filters: Array<[string, string, unknown]> = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-0000-0000-00000000a001' } } }) },
    from: (t: string) => {
      if (t !== 'memberships') touched.push(`user:${t}`);
      const b = {
        select: () => b, eq: () => b, order: () => b, limit: () => b,
        maybeSingle: async () => ({ data: { id: 'm1', org_id: ORG, role, branch: null, access: role === 'staff' ? { leads: 'write' } : null, status: 'active', last_seen_at: new Date().toISOString() }, error: null }),
      };
      return b;
    },
  }),
}));

// Service role: the lead lookup answers only for the caller's org; the other org's lead is invisible.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    touched.push('service-role');
    return {
      from: (t: string) => {
        const eqs: Record<string, unknown> = {};
        const b = {
          select: () => b,
          eq: (c: string, v: unknown) => { eqs[c] = v; filters.push([t, c, v]); return b; },
          maybeSingle: async () => ({ data: t === 'leads' && eqs.org_id === ORG && eqs.id !== OTHER_ORG_LEAD ? { id: eqs.id, status: 'new', assigned_to: null } : null, error: null }),
          update: () => { writes.push(`update:${t}`); return b; },
          insert: async () => { writes.push(`insert:${t}`); return { error: null }; },
          then: (r: (v: unknown) => unknown) => r({ error: null }),
        };
        return b;
      },
    };
  },
}));

const actions = await import('@/app/(admin)/admin/leads/actions');
const ID = '00000000-0000-4000-8000-0000000000a1';
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

const calls: Array<[string, () => Promise<unknown>]> = [
  ['setLeadStatus', () => actions.setLeadStatus({ id: ID, status: 'won' })],
  ['setLeadAssignee', () => actions.setLeadAssignee({ id: ID, assigned_to: '' })],
  ['addLeadNote', () => actions.addLeadNote({ id: ID, body: 'Called back.' })],
  ['addLead', () => actions.addLead(fd({ name: 'Demo', phone: '031 555 0101' }))],
  ['createManualLead', () => actions.createManualLead(fd({ name: 'Demo', phone: '031 555 0101' }))],
  ['rematchLeads', () => actions.rematchLeads()],
];

beforeEach(() => { touched.length = 0; writes.length = 0; filters.length = 0; });

describe('leads actions refuse members without leads.manage', () => {
  for (const r of ['reviewer', 'factory', 'inspector']) {
    for (const [name, call] of calls) {
      it(`${r}: ${name} is forbidden and touches nothing`, async () => {
        role = r;
        await expect(call()).rejects.toThrow(/Forbidden/);
        expect(touched).toEqual([]);
        expect(writes).toEqual([]);
      });
    }
  }

  it('staff (leads write) may not re-match with Xero (integrations.manage)', async () => {
    role = 'staff';
    await expect(actions.rematchLeads()).rejects.toThrow(/Forbidden/);
    expect(touched).toEqual([]);
  });
});

describe('leads actions stay in the caller org and validate input', () => {
  it('a lead of another org is not found and nothing is written', async () => {
    role = 'staff';
    expect(await actions.setLeadStatus({ id: OTHER_ORG_LEAD, status: 'won' })).toEqual({ ok: false, error: 'notfound' });
    expect(await actions.addLeadNote({ id: OTHER_ORG_LEAD, body: 'x' })).toEqual({ ok: false, error: 'notfound' });
    expect(writes).toEqual([]);
    expect(filters.filter(([t, c]) => t === 'leads' && c === 'org_id').every(([, , v]) => v === ORG)).toBe(true);
  });

  it('rejects statuses lib/leads does not have, bad ids and empty notes before any query', async () => {
    role = 'admin';
    expect(await actions.setLeadStatus({ id: ID, status: 'qualified' })).toEqual({ ok: false, error: 'invalid' });
    expect(await actions.setLeadStatus({ id: 'not-a-uuid', status: 'won' })).toEqual({ ok: false, error: 'invalid' });
    expect(await actions.addLeadNote({ id: ID, body: '   ' })).toEqual({ ok: false, error: 'invalid' });
    expect(await actions.addLead(fd({ name: 'No contact' }))).toEqual({ ok: false, error: 'invalid', fields: ['email'] });
    expect(await actions.addLead(fd({ phone: '031 555 0101', source: 'website' }))).toEqual({ ok: false, error: 'invalid', fields: ['source'] });
    expect(touched).toEqual([]);
  });

  it('an allowed change in the own org writes the lead, its event and an audit row', async () => {
    role = 'staff';
    expect(await actions.setLeadStatus({ id: ID, status: 'contacted' })).toEqual({ ok: true });
    expect(writes).toEqual(['update:leads', 'insert:lead_events', 'insert:audit_log']);
    expect(filters).toContainEqual(['leads', 'org_id', ORG]);
  });
});
