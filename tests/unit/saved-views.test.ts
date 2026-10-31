// Saved views: scope parsing, per-list query whitelists, hrefs and input schemas (pure), plus the server CRUD
// helpers against an in-memory stand-in for the RLS client. Synthetic data only.
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ForbiddenError, type Member } from '@/lib/security/can';
import {
  SavedViewCreate, SavedViewDelete, SavedViewUpdate, VIEWS_PER_LIST_MAX,
  parseScope, scopePath, scopePermission, viewHref, viewName, viewQueryFromParams, viewQuerySchema,
} from '@/lib/views/query';

vi.mock('server-only', () => ({}));
const { SavedViewError, createSavedView, deleteSavedView, listSavedViews, updateSavedView } = await import('@/lib/views/saved-views');

const ORG = '00000000-0000-0000-0000-000000000001';
const OTHER_ORG = '00000000-0000-0000-0000-0000000000e5';
const STAFF: Member = { userId: '00000000-0000-0000-0000-00000000a502', orgId: ORG, role: 'staff', branch: null };
const OTHER_USER = '00000000-0000-0000-0000-00000000a501';
const INSPECTOR: Member = { ...STAFF, role: 'inspector' };
const REVIEWER: Member = { ...STAFF, role: 'reviewer' };

describe('scopes', () => {
  it('parses form scopes and the fixed lists, rejects anything else', () => {
    expect(parseScope('form:delivery-note')).toEqual({ kind: 'form', slug: 'delivery-note' });
    expect(parseScope('xero_quotes')).toEqual({ kind: 'xero_quotes' });
    expect(parseScope('leads')).toEqual({ kind: 'leads' });
    for (const bad of ['', 'form:', 'form:Job Card', 'form:../x', 'quotes', 'Leads', 'leads:x', 'form:a/b']) {
      expect(parseScope(bad)).toBeNull();
    }
  });

  it('maps each list to the permission and route its page uses', () => {
    expect(scopePermission('form:job-card')).toBe('entries.read');
    expect(scopePermission('xero_quotes')).toBe('quotes.read');
    expect(scopePermission('xero_invoices')).toBe('invoices.read');
    expect(scopePermission('leads')).toBe('leads.read');
    expect(scopePath('form:job-card')).toBe('/admin/forms/job-card');
    expect(scopePath('xero_quotes')).toBe('/admin/xero/quotes');
    expect(scopePath('xero_invoices')).toBe('/admin/xero/invoices');
    expect(scopePath('leads')).toBe('/admin/leads');
  });
});

describe('query whitelists', () => {
  it('accepts a form grid query and normalises it', () => {
    const r = viewQuerySchema('form:job-card').parse({ view: 'status:APPROVED EMAILED', q: '  QU-10482 ', from: '2026-10-01', to: '', cols: ['QuoteNo', 'QuoteNo', 'TrailerVinNO'] });
    expect(r).toEqual({ view: 'status:APPROVED EMAILED', q: 'QU-10482', from: '2026-10-01', cols: ['QuoteNo', 'TrailerVinNO'] });
    expect(viewQuerySchema('form:job-card').parse({ view: 'all', cols: [] })).toEqual({});
  });

  it('rejects unknown keys, paging and bad values', () => {
    const form = viewQuerySchema('form:job-card');
    for (const bad of [
      { page: '2' }, { secret: 'x' }, { view: 'everything' }, { from: '2026-02-30' }, { q: 'x'.repeat(101) },
      { cols: ['a b'] }, { cols: Array.from({ length: 13 }, (_, i) => `F${i}`) }, { q: 'tab\u0007' }, { view: 'status:' },
    ]) {
      expect(form.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(viewQuerySchema('xero_quotes').safeParse({ type: 'ACCPAY' }).success).toBe(false);
    expect(viewQuerySchema('xero_invoices').safeParse({ status: 'paid' }).success).toBe(false);
    expect(viewQuerySchema('leads').safeParse({ status: 'open' }).success).toBe(false);
    expect(viewQuerySchema('leads').safeParse({ assigned: 'someone' }).success).toBe(false);
    expect(viewQuerySchema('leads').safeParse({ dups: 'yes' }).success).toBe(false);
  });

  it('accepts each list shape', () => {
    expect(viewQuerySchema('xero_invoices').parse({ q: 'INV-20931', status: 'AUTHORISED', type: 'ACCREC' })).toEqual({ q: 'INV-20931', status: 'AUTHORISED' });
    expect(viewQuerySchema('xero_invoices').parse({ type: 'ALL' })).toEqual({ type: 'ALL' });
    expect(viewQuerySchema('xero_invoices').parse({ q: '', status: '', type: '' })).toEqual({});
    expect(viewQuerySchema('leads').parse({ status: 'new', source: 'website', branch: 'Durban', assigned: 'me', dups: '1' }))
      .toEqual({ status: 'new', source: 'website', branch: 'Durban', assigned: 'me', dups: '1' });
    expect(viewQuerySchema('leads').parse({ assigned: OTHER_USER })).toEqual({ assigned: OTHER_USER });
  });

  it('picks storable keys from page params the way the page reads them', () => {
    expect(viewQueryFromParams('form:job-card', { view: 'unread', page: '3', cols: 'QuoteNo, Line1', q: ['first', 'second'], junk: 'x', from: 'not-a-date' }))
      .toEqual({ view: 'unread', cols: ['QuoteNo', 'Line1'], q: 'first' });
    expect(viewQueryFromParams('form:job-card', { cols: ['QuoteNo', 'bad name'] })).toEqual({ cols: ['QuoteNo'] });
    expect(viewQueryFromParams('form:job-card', { cols: ',' })).toEqual({});
    expect(viewQueryFromParams('leads', { status: 'won', dups: '1', assigned: 'nobody', page: '2' })).toEqual({ status: 'won', dups: '1' });
  });

  it('builds stable hrefs in whitelist order, with repeated cols', () => {
    expect(viewHref('form:job-card', { cols: ['QuoteNo', 'Line1'], q: 'a&b', view: 'unread' }))
      .toBe('/admin/forms/job-card?view=unread&q=a%26b&cols=QuoteNo&cols=Line1');
    expect(viewHref('xero_quotes', {})).toBe('/admin/xero/quotes');
    expect(viewHref('leads', { dups: '1', status: 'new' })).toBe('/admin/leads?status=new&dups=1');
  });
});

describe('input schemas', () => {
  it('trims and collapses names, bounds them at 60 code points', () => {
    expect(viewName.parse('  Durban \n branch ')).toBe('Durban branch');
    expect(viewName.safeParse('   ').success).toBe(false);
    expect(viewName.safeParse('x'.repeat(61)).success).toBe(false);
    expect(viewName.parse('é'.repeat(60))).toHaveLength(60);
    expect(viewName.safeParse('bell\u0007').success).toBe(false);
  });

  it('create validates the query against its list and defaults it to {}', () => {
    expect(SavedViewCreate.parse({ scope: 'leads', name: 'Mine' })).toEqual({ scope: 'leads', name: 'Mine', query: {} });
    const bad = SavedViewCreate.safeParse({ scope: 'leads', name: 'Mine', query: { view: 'unread' } });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0].message).toBe('This view has filters that cannot be saved');
    expect(SavedViewCreate.safeParse({ scope: 'deals', name: 'x' }).success).toBe(false);
    expect(SavedViewCreate.safeParse({ scope: 'leads', name: 'x', org_id: OTHER_ORG }).success).toBe(false);
    expect(SavedViewCreate.safeParse({ scope: 'leads', name: 'x', user_id: OTHER_USER }).success).toBe(false);
  });

  it('update needs an id, the scope and something to change; delete needs id and scope', () => {
    const id = '7d0b1c9e-4f7a-4c55-9a1e-3f1f0a2b9c10';
    expect(SavedViewUpdate.parse({ id, scope: 'leads', name: ' Renamed ' })).toEqual({ id, scope: 'leads', name: 'Renamed', query: undefined });
    expect(SavedViewUpdate.safeParse({ id, scope: 'leads' }).success).toBe(false);
    expect(SavedViewUpdate.safeParse({ id: 'nope', scope: 'leads', name: 'x' }).success).toBe(false);
    expect(SavedViewDelete.safeParse({ id }).success).toBe(false);
    expect(SavedViewDelete.parse({ id, scope: 'form:deal' })).toEqual({ id, scope: 'form:deal' });
  });
});

// ---------------------------------------------------------------------------
// Server helpers against an in-memory saved_views table that mimics the unique key and the RLS filters.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function fakeDb(seed: Row[] = [], opts: { insertError?: { code: string; message: string } } = {}) {
  const rows: Row[] = seed.map((r) => ({ ...r }));
  const queries: Array<{ op: string; filters: Array<[string, unknown]> }> = [];
  let n = 0;
  const from = (table: string) => {
    if (table !== 'saved_views') throw new Error(`unexpected table ${table}`);
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row = {};
    let head = false;
    const filters: Array<[string, unknown]> = [];
    const match = (r: Row) => filters.every(([k, v]) => r[k] === v);
    const run = async () => {
      queries.push({ op, filters });
      if (op === 'insert') {
        if (opts.insertError) return { data: null, error: opts.insertError, count: null };
        if (rows.some((r) => ['org_id', 'user_id', 'scope', 'name'].every((k) => r[k] === payload[k]))) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' }, count: null };
        }
        const row = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, created_at: '2026-10-29T13:02:00Z', ...payload };
        rows.push(row);
        return { data: [row], error: null, count: null };
      }
      const hit = rows.filter(match);
      if (op === 'update') {
        if (payload.name && rows.some((r) => !hit.includes(r) && hit.some((h) => ['org_id', 'user_id', 'scope'].every((k) => r[k] === h[k])) && r.name === payload.name)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' }, count: null };
        }
        hit.forEach((r) => Object.assign(r, payload));
      }
      if (op === 'delete') hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
      return { data: head ? null : hit, error: null, count: hit.length };
    };
    const b = {
      select(_cols?: string, opts?: { head?: boolean }) { head = !!opts?.head; return b; },
      insert(p: Row) { op = 'insert'; payload = p; return b; },
      update(p: Row) { op = 'update'; payload = p; return b; },
      delete() { op = 'delete'; return b; },
      eq(k: string, v: unknown) { filters.push([k, v]); return b; },
      order() { return b; },
      limit() { return b; },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej),
    };
    return b;
  };
  return { db: { from } as unknown as SupabaseClient, rows, queries };
}

const mine = (over: Row = {}): Row => ({
  id: '00000000-0000-4000-8000-0000000000aa', org_id: ORG, user_id: STAFF.userId, scope: 'form:job-card',
  name: 'Durban branch', query: { view: 'unread', q: 'durban' }, created_at: '2026-10-28T08:00:00Z', ...over,
});

describe('saved views CRUD', () => {
  it("creates a view with the caller's org and user id, never the client's", async () => {
    const f = fakeDb();
    const v = await createSavedView(f.db, STAFF, { scope: 'form:job-card', name: ' Unread ', query: { view: 'unread', cols: ['QuoteNo'] } });
    expect(v).toMatchObject({ scope: 'form:job-card', name: 'Unread', query: { view: 'unread', cols: ['QuoteNo'] }, href: '/admin/forms/job-card?view=unread&cols=QuoteNo' });
    expect(f.rows[0]).toMatchObject({ org_id: ORG, user_id: STAFF.userId });
  });

  it('maps a duplicate name to a friendly error and enforces the per-list cap', async () => {
    const f = fakeDb([mine()]);
    await expect(createSavedView(f.db, STAFF, { scope: 'form:job-card', name: 'Durban branch' })).rejects.toMatchObject({ code: 'duplicate' });
    const full = fakeDb(Array.from({ length: VIEWS_PER_LIST_MAX }, (_, i) => mine({ id: `v${i}`, name: `View ${i}` })));
    await expect(createSavedView(full.db, STAFF, { scope: 'form:job-card', name: 'One more' })).rejects.toMatchObject({ code: 'limit' });
  });

  it('maps the database cap (a save that raced past the count, or the per-user cap) to the limit error', async () => {
    const f = fakeDb([], { insertError: { code: '54000', message: 'saved_views: limit reached' } });
    await expect(createSavedView(f.db, STAFF, { scope: 'leads', name: 'Raced' })).rejects.toMatchObject({ code: 'limit' });
  });

  it('checks the list permission before touching the database', async () => {
    const f = fakeDb();
    await expect(createSavedView(f.db, INSPECTOR, { scope: 'form:job-card', name: 'x' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listSavedViews(f.db, REVIEWER, 'leads')).rejects.toBeInstanceOf(ForbiddenError);
    expect(f.queries).toEqual([]);
  });

  it('rejects bad input as SavedViewError before any query', async () => {
    const f = fakeDb();
    await expect(createSavedView(f.db, STAFF, { scope: 'form:job-card', name: '' })).rejects.toBeInstanceOf(SavedViewError);
    await expect(listSavedViews(f.db, STAFF, 'form:Bad Slug')).rejects.toMatchObject({ code: 'invalid' });
    expect(f.queries).toEqual([]);
  });

  it("lists only the caller's views of that list and skips rows with an unsavable query", async () => {
    const f = fakeDb([
      mine(),
      mine({ id: 'b', name: 'Someone else', user_id: OTHER_USER }),
      mine({ id: 'c', name: 'Other org', org_id: OTHER_ORG }),
      mine({ id: 'd', name: 'Other list', scope: 'leads', query: {} }),
      mine({ id: 'e', name: 'Tampered', query: { secret: 'x' } }),
    ]);
    const list = await listSavedViews(f.db, STAFF, 'form:job-card');
    expect(list.map((v) => v.name)).toEqual(['Durban branch']);
    expect(list[0].href).toBe('/admin/forms/job-card?view=unread&q=durban');
    expect(f.queries[0].filters).toEqual([['org_id', ORG], ['user_id', STAFF.userId], ['scope', 'form:job-card']]);
  });

  it('renames and replaces the query of own views only', async () => {
    const theirs = '00000000-0000-4000-8000-00000000000b';
    const f = fakeDb([mine(), mine({ id: theirs, name: 'Theirs', user_id: OTHER_USER })]);
    const v = await updateSavedView(f.db, STAFF, { id: mine().id, scope: 'form:job-card', name: 'Durban', query: { view: 'status:Approved' } });
    expect(v).toMatchObject({ name: 'Durban', query: { view: 'status:Approved' } });
    await expect(updateSavedView(f.db, STAFF, { id: theirs, scope: 'form:job-card', name: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    expect(f.rows.find((r) => r.id === theirs)?.name).toBe('Theirs');
    await expect(updateSavedView(f.db, STAFF, { id: mine().id, scope: 'leads', name: 'Moved' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('deletes own views and reports a missing one', async () => {
    const f = fakeDb([mine()]);
    await deleteSavedView(f.db, STAFF, { id: mine().id, scope: 'form:job-card' });
    expect(f.rows).toEqual([]);
    await expect(deleteSavedView(f.db, STAFF, { id: mine().id, scope: 'form:job-card' })).rejects.toMatchObject({ code: 'not_found' });
  });
});
