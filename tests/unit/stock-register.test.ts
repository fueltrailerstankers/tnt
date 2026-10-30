import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/admin/grid';
import { can, ROLES, type Member } from '@/lib/security/can';
import {
  ALL_BRANCHES, changedSummary, correctionFields, CorrectInput, CSV_HEADER, dealLabel, EMPTY_REGISTER_QUERY, invalidField,
  parseRegisterQuery, parseRegisterSearch, registerHref, registerOrFilter, registerQueryString, statusesFor, transferArgs,
  TransferInput, unitsCsvTable, unitsHref, type UnitRow,
} from '@/lib/stock/register';
import { currentStockTab, STOCK_TABS, stockTabs } from '@/lib/stock/tabs';
import { NAV, visibleNav } from '@/lib/ui/nav';

const LOCS = ['FACTORY', 'JHB', 'CPT', 'DBN'];
const UNIT_ID = '6f1c1e9e-8a39-4b9b-9a3e-1f6d2f1b7c11';
const member = (role: Member['role']): Member => ({ userId: 'u', orgId: 'o', role, branch: null });

const unit = (over: Partial<UnitRow> = {}): UnitRow => ({
  id: UNIT_ID, vin: 'TESTVIN000000001', vin_norm: 'TESTVIN000000001', deal_year: null, sequence: null, deal_id: null,
  model_part: '3000D', location_id: 'JHB', status: 'available', invoice_number: null, xero_invoice_id: null,
  dispatch_date: '2026-03-01', accessories: ['Sample hose reel'], notes: null, transfer_reason: null, sold_at: null,
  created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-01T08:00:00Z', ...over,
});

const input = (u: UnitRow, over: Partial<CorrectInput> = {}): CorrectInput => ({
  unit: u.id, vin: u.vin, model: u.model_part, location: u.location_id, status: u.status, invoice: u.invoice_number ?? '',
  dispatch_date: u.dispatch_date ?? '', accessories: [...(u.accessories ?? []), ...Array(10 - (u.accessories ?? []).length).fill('')],
  notes: u.notes ?? '', deal_year: u.deal_year ? String(u.deal_year) : '', deal_number: u.sequence ? String(u.sequence) : '',
  ...over,
});

describe('register query', () => {
  it('reads filters from the URL and drops unknown values', () => {
    expect(parseRegisterQuery({ q: ' ab,c ', model: ' 3000d ', location: 'jhb', status: 'sold', page: '3' }, LOCS))
      .toEqual({ q: 'ab c', model: '3000D', location: 'JHB', status: 'sold', page: 3 });
    expect(parseRegisterQuery({ location: 'branches', status: 'in_stock' }, LOCS)).toMatchObject({ location: ALL_BRANCHES, status: 'in_stock' });
    expect(parseRegisterQuery({ location: 'MARS', status: 'lost', model: 'drop table;', page: '-1' }, LOCS))
      .toEqual({ q: null, model: null, location: null, status: null, page: 1 });
    expect(parseRegisterQuery({ q: ['first', 'second'] }, LOCS).q).toBe('first');
  });
  it('builds links without defaults and round-trips', () => {
    const rq = parseRegisterQuery({ q: 'ABC', location: 'branches', status: 'in_stock', page: '2' }, LOCS);
    expect(registerQueryString(rq)).toBe('q=ABC&location=branches&status=in_stock&page=2');
    expect(registerHref(rq, { page: 1 })).toBe('/admin/stock/units?q=ABC&location=branches&status=in_stock');
    expect(registerHref(EMPTY_REGISTER_QUERY)).toBe('/admin/stock/units');
    expect(parseRegisterQuery(Object.fromEntries(new URLSearchParams(registerQueryString(rq))), LOCS)).toEqual(rq);
  });
  it('overview cells link to the register filtered by model, location and in-stock status', () => {
    expect(unitsHref({ model: '3000D', location: 'JHB', status: 'in_stock' })).toBe('/admin/stock/units?model=3000D&location=JHB&status=in_stock');
    expect(unitsHref({ location: null, status: 'reserved' })).toBe('/admin/stock/units?status=reserved');
  });
  it('in_stock selects available and reserved (what the overview counts)', () => {
    expect(statusesFor('in_stock')).toEqual(['available', 'reserved']);
    expect(statusesFor('sold')).toEqual(['sold']);
  });
});

describe('register search', () => {
  it('matches VIN (normalised), invoice and model, and the sequence when numeric', () => {
    const s = parseRegisterSearch('abc 123');
    expect(s).toEqual({ kind: 'text', vin: 'ABC123', text: 'ABC123', sequence: null });
    expect(registerOrFilter(s as Extract<typeof s, { kind: 'text' }>)).toBe('vin_norm.ilike.*ABC123*,invoice_number.ilike.*ABC123*,model_part.ilike.*ABC123*');
    const n = parseRegisterSearch('248');
    expect(n).toMatchObject({ kind: 'text', sequence: 248 });
    expect(registerOrFilter(n as Extract<typeof n, { kind: 'text' }>)).toContain(',sequence.eq.248');
  });
  it('reads "year / sequence" as one deal', () => {
    expect(parseRegisterSearch('2026 / 248')).toEqual({ kind: 'deal', year: 2026, sequence: 248 });
    expect(parseRegisterSearch('2026/7')).toEqual({ kind: 'deal', year: 2026, sequence: 7 });
  });
  it('ignores empty input and out-of-range sequences', () => {
    expect(parseRegisterSearch(null)).toEqual({ kind: 'none' });
    expect(parseRegisterSearch('   ')).toEqual({ kind: 'none' });
    expect(parseRegisterSearch('999999999')).toMatchObject({ sequence: 999999999 });
    expect(parseRegisterSearch('0')).toMatchObject({ sequence: null });
  });
  it('produces or() values without PostgREST separators (searchTerm strips them first)', () => {
    const rq = parseRegisterQuery({ q: 'a,b(c)*d"e\'f\\g:h' }, LOCS);
    const s = parseRegisterSearch(rq.q);
    expect(s.kind).toBe('text');
    const f = registerOrFilter(s as Extract<typeof s, { kind: 'text' }>);
    expect(f.split(',')).toHaveLength(3);
    expect(f).not.toMatch(/[()"'\\:]/);
  });
});

describe('CSV export table', () => {
  it('has the plan columns, joins accessories with "; " and is formula-safe', () => {
    const t = unitsCsvTable(
      [unit({ deal_year: 2026, sequence: 249, accessories: ['Hose', 'Reel'], invoice_number: 'INV-1', status: 'reserved', notes: '=1+1' })],
      (p) => (p === '3000D' ? '3000 litre metal bowser' : undefined),
      (id) => (id === 'JHB' ? 'Johannesburg' : undefined),
    );
    expect(t[0]).toEqual(CSV_HEADER);
    expect(CSV_HEADER).toEqual(['VIN', 'Deal year', 'Sequence', 'Model', 'Description', 'Location', 'Status', 'Invoice', 'Dispatch date', 'Accessories', 'Notes']);
    expect(t[1]).toEqual(['TESTVIN000000001', '2026', '249', '3000D', '3000 litre metal bowser', 'Johannesburg', 'Reserved', 'INV-1', '2026-03-01', 'Hose; Reel', '=1+1']);
    expect(toCsv(t)).toContain(",'=1+1\r\n");
  });
  it('leaves empty values blank and falls back to the location id', () => {
    const t = unitsCsvTable([unit({ accessories: null, dispatch_date: null, location_id: 'XYZ' })], () => undefined, () => undefined);
    expect(t[1]).toEqual(['TESTVIN000000001', '', '', '3000D', '', 'XYZ', 'Available', '', '', '', '']);
  });
  it('labels deal and sequence', () => {
    expect(dealLabel({ deal_year: 2026, sequence: 249 })).toBe('2026 / 249');
    expect(dealLabel({ deal_year: null, sequence: 12 })).toBe('12');
    expect(dealLabel({ deal_year: 2026, sequence: null })).toBe('—');
  });
});

describe('correctionFields', () => {
  it('sends nothing when nothing changed', () => {
    const u = unit();
    expect(correctionFields(u, input(u))).toEqual({ fields: {} });
  });
  it('sends only changed values, normalised as the RPC stores them', () => {
    const u = unit({ invoice_number: 'INV-1', notes: 'Old' });
    const r = correctionFields(u, input(u, {
      vin: ' testvin 000000002 ', model: ' 1000d', location: 'cpt', status: 'reserved', invoice: ' inv-2 ',
      dispatch_date: '', accessories: [' Hose ', '', 'Reel', ...Array(7).fill('')], notes: '  ',
    }));
    expect(r).toEqual({
      fields: {
        vin: 'TESTVIN000000002', model_part: '1000D', location_id: 'CPT', status: 'reserved', invoice_number: 'INV-2',
        dispatch_date: '', accessories: ['Hose', 'Reel'], notes: null,
      },
    });
    expect(changedSummary((r as { fields: Record<string, unknown> }).fields)).toBe('VIN, model, location, status, invoice, dispatch date, accessories, notes');
  });
  it('clears the invoice with null, keeps the same VIN when only spacing or case differ', () => {
    const u = unit({ invoice_number: 'INV-1' });
    expect(correctionFields(u, input(u, { invoice: '  ', vin: 'testvin 000000001' }))).toEqual({ fields: { invoice_number: null } });
  });
  it('unlinked unit: deal year and sequence are record values; link_deal links the deal instead', () => {
    const u = unit();
    expect(correctionFields(u, input(u, { deal_year: '2025', deal_number: '12' }))).toEqual({ fields: { deal_year: 2025, sequence: 12 } });
    expect(correctionFields(u, input(u, { deal_year: '2026', deal_number: '260', link_deal: '1' }))).toEqual({ fields: { deal: { year: 2026, number: 260 } } });
    expect(correctionFields(u, input(u, { link_deal: '1' }))).toEqual({ error: 'deal_link_needs_deal' });
    expect(correctionFields(unit({ deal_year: 2025, sequence: 3 }), input(unit({ deal_year: 2025, sequence: 3 }), { deal_year: '', deal_number: '' })))
      .toEqual({ fields: { deal_year: null, sequence: null } });
  });
  it('linked unit: a new year/number relinks, unlink_deal unlinks, half a pair is refused', () => {
    const u = unit({ deal_id: '00000000-0000-0000-0000-0000000d0104', deal_year: 2026, sequence: 104 });
    expect(correctionFields(u, input(u))).toEqual({ fields: {} });
    expect(correctionFields(u, input(u, { deal_number: '101' }))).toEqual({ fields: { deal: { year: 2026, number: 101 } } });
    expect(correctionFields(u, input(u, { unlink_deal: '1' }))).toEqual({ fields: { deal: null } });
    expect(correctionFields(u, input(u, { deal_year: '', deal_number: '' }))).toEqual({ error: 'deal_pair' });
    expect(correctionFields(u, input(u, { deal_year: '2026', deal_number: '' }))).toEqual({ error: 'deal_pair' });
  });
});

describe('Correct record and Transfer input', () => {
  it('validates the correct form', () => {
    const u = unit();
    expect(CorrectInput.safeParse(input(u)).success).toBe(true);
    expect(CorrectInput.safeParse({ ...input(u), dispatch_date: '2026-02-30' }).success).toBe(false);
    expect(CorrectInput.safeParse({ ...input(u), accessories: Array(11).fill('x') }).success).toBe(false);
    expect(CorrectInput.safeParse({ ...input(u), status: 'lost' }).success).toBe(false);
    expect(CorrectInput.safeParse({ ...input(u), deal_year: '20x6' }).success).toBe(false);
    expect(CorrectInput.safeParse({ ...input(u), unit: 'not-a-uuid' }).success).toBe(false);
    expect(CorrectInput.safeParse({ ...input(u), notes: 'n'.repeat(2001) }).success).toBe(false);
  });
  it('maps form fields to the stock error copy fields', () => {
    expect(invalidField(['invoice'])).toBe('invoice_number');
    expect(invalidField(['deal_number'])).toBe('deal');
    expect(invalidField(['accessories', 3])).toBe('accessories');
    expect(invalidField([])).toBe('fields');
  });
  it('builds stock_move_unit arguments', () => {
    const t = TransferInput.parse({ unit: UNIT_ID, location: ' cpt ', reason: ' Swap stock ', deal_year: '', deal_number: '' });
    expect(transferArgs('org', t)).toEqual({ p_org: 'org', p_unit: UNIT_ID, p_location: 'CPT', p_reason: 'Swap stock', p_deal_year: null, p_deal_number: null });
    const d = TransferInput.parse({ unit: UNIT_ID, location: 'JHB', reason: '', deal_year: '2026', deal_number: '260' });
    expect(transferArgs('org', d)).toMatchObject({ p_reason: null, p_deal_year: 2026, p_deal_number: 260 });
    expect(transferArgs('org', TransferInput.parse({ unit: UNIT_ID, location: 'JHB', reason: '', deal_year: '2026', deal_number: '' }))).toBeNull();
    expect(TransferInput.safeParse({ unit: UNIT_ID, location: 'JHB', reason: 'r'.repeat(201), deal_year: '', deal_number: '' }).success).toBe(false);
  });
});

describe('stock tabs and nav', () => {
  it('shows each tab only to roles holding its permission', () => {
    for (const role of ROLES) {
      const keys = stockTabs(member(role)).map((t) => t.key);
      for (const t of STOCK_TABS) expect(keys.includes(t.key), `${role} ${t.key}`).toBe(can(member(role), t.perm));
    }
    expect(stockTabs(member('admin')).map((t) => t.key)).toEqual(['overview', 'units', 'dispatch', 'deals', 'invoices', 'activity', 'setup']);
    expect(stockTabs(member('factory')).map((t) => t.key)).toEqual(['overview', 'units', 'dispatch', 'deals', 'activity']);
    expect(stockTabs(member('reviewer')).map((t) => t.key)).toEqual(['overview', 'units', 'deals', 'invoices', 'activity']);
    expect(stockTabs(null)).toEqual([]);
  });
  it('marks the current tab by longest prefix; /admin/stock itself is Overview only', () => {
    const tabs = stockTabs(member('admin'));
    expect(currentStockTab('/admin/stock', tabs)).toBe('overview');
    expect(currentStockTab('/admin/stock/units', tabs)).toBe('units');
    expect(currentStockTab('/admin/stock/units/abc', tabs)).toBe('units');
    expect(currentStockTab('/admin/stock/setup', tabs)).toBe('setup');
    expect(currentStockTab('/admin/stocks', tabs)).toBeNull();
  });
  it('has one Stock sidebar item for stock.read roles', () => {
    expect(NAV.filter((n) => n.href.startsWith('/admin/stock'))).toHaveLength(1);
    for (const role of ['admin', 'staff', 'reviewer', 'factory'] as const) expect(visibleNav(member(role)).map((n) => n.key), role).toContain('stock');
    expect(visibleNav(member('inspector')).map((n) => n.key)).not.toContain('stock');
    expect(visibleNav(member('factory')).map((n) => n.key)).toEqual(['home', 'stock']);
  });
});

describe('stock pages use design tokens only', () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f)) files.push(p);
    }
  };
  walk(path.resolve(__dirname, '../../app/(admin)/admin/stock'));
  walk(path.resolve(__dirname, '../../components/stock'));
  it.each(files.map((f) => [path.relative(path.resolve(__dirname, '../..'), f), f]))('%s', (_rel, f) => {
    const src = readFileSync(f, 'utf8');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\b(?:bg|text|border|ring|fill|stroke)-(?:white|black|neutral|gray|slate|zinc|stone|red|orange|amber|yellow|green|emerald|teal|blue|sky|indigo|violet|purple|pink|rose)(?:-\d{2,3})?\b/);
  });
});
