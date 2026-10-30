import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/admin/grid';
import { can, ROLES, type Member } from '@/lib/security/can';
import {
  ALL_BRANCHES, changedSummary, correctionFields, CorrectInput, CSV_HEADER, dealLabel, EMPTY_REGISTER_QUERY, exportAuditRow, invalidField,
  parseRegisterQuery, parseRegisterSearch, registerHref, registerOrFilter, registerQueryString, statusesFor, transferArgs,
  TransferInput, unitsCsvTable, unitsHref, type UnitRow,
  EXPORT_MAX_ROWS, exportTooManyMessage, isStale, normalizeNewlines, sortNewestFirst, STALE_MESSAGE, statusFilterOf,
} from '@/lib/stock/register';
import { currentStockTab, STOCK_TABS, stockTabs } from '@/lib/stock/tabs';
import { NAV, visibleNav } from '@/lib/ui/nav';

const LOCS = ['FACTORY', 'JHB', 'CPT', 'DBN'];
const MODELS = ['3000D', 'CTLL1', 'BOX02'];
const V = '2026-03-01T08:00:00.123456+00:00';
const UNIT_ID = '6f1c1e9e-8a39-4b9b-9a3e-1f6d2f1b7c11';
const member = (role: Member['role']): Member => ({ userId: 'u', orgId: 'o', role, branch: null });

const unit = (over: Partial<UnitRow> = {}): UnitRow => ({
  id: UNIT_ID, vin: 'TESTVIN000000001', vin_norm: 'TESTVIN000000001', deal_year: null, sequence: null, deal_id: null,
  model_part: '3000D', location_id: 'JHB', status: 'available', invoice_number: null, xero_invoice_id: null,
  dispatch_date: '2026-03-01', accessories: ['Sample hose reel'], notes: null, transfer_reason: null, sold_at: null,
  created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-01T08:00:00Z', ...over,
});

const input = (u: UnitRow, over: Partial<CorrectInput> = {}): CorrectInput => ({
  unit: u.id, updated_at: u.updated_at, vin: u.vin, model: u.model_part, location: u.location_id, status: u.status, invoice: u.invoice_number ?? '',
  dispatch_date: u.dispatch_date ?? '', accessories: [...(u.accessories ?? []), ...Array(10 - (u.accessories ?? []).length).fill('')],
  notes: u.notes ?? '', deal_year: u.deal_year ? String(u.deal_year) : '', deal_number: u.sequence ? String(u.sequence) : '',
  ...over,
});

describe('register query', () => {
  it('reads filters from the URL and drops unknown values', () => {
    expect(parseRegisterQuery({ q: ' ab,c ', model: ' 3000d ', location: 'jhb', status: 'sold', page: '3' }, LOCS, MODELS))
      .toEqual({ q: 'ab c', model: '3000D', location: 'JHB', status: 'sold', page: 3 });
    expect(parseRegisterQuery({ location: 'branches', status: 'in_stock' }, LOCS, MODELS)).toMatchObject({ location: ALL_BRANCHES, status: 'in_stock' });
    expect(parseRegisterQuery({ location: 'MARS', status: 'lost', model: 'drop table;', page: '-1' }, LOCS, MODELS))
      .toEqual({ q: null, model: null, location: null, status: null, page: 1 });
    expect(parseRegisterQuery({ q: ['first', 'second'] }, LOCS, MODELS).q).toBe('first');
  });
  it('builds links without defaults and round-trips', () => {
    const rq = parseRegisterQuery({ q: 'ABC', location: 'branches', status: 'in_stock', page: '2' }, LOCS, MODELS);
    expect(registerQueryString(rq)).toBe('q=ABC&location=branches&status=in_stock&page=2');
    expect(registerHref(rq, { page: 1 })).toBe('/admin/stock/units?q=ABC&location=branches&status=in_stock');
    expect(registerHref(EMPTY_REGISTER_QUERY)).toBe('/admin/stock/units');
    expect(parseRegisterQuery(Object.fromEntries(new URLSearchParams(registerQueryString(rq))), LOCS, MODELS)).toEqual(rq);
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
    const rq = parseRegisterQuery({ q: 'a,b(c)*d"e\'f\\g:h' }, LOCS, MODELS);
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
  it('audits an export with the row count and filter codes, never the search text', () => {
    const rq = parseRegisterQuery({ q: 'SECRET TEXT', model: '3000d', location: 'jhb', status: 'sold' }, LOCS, MODELS);
    const row = exportAuditRow({ orgId: 'o', userId: 'u' }, rq, 3);
    expect(row).toEqual({
      org_id: 'o', actor_user: 'u', action: 'stock.export', entity: 'stock_units', entity_id: null,
      meta: { format: 'csv', rows: 3, search: true, model: '3000D', location: 'JHB', status: 'sold' },
    });
    expect(JSON.stringify(row)).not.toContain('SECRET');
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
    const t = TransferInput.parse({ unit: UNIT_ID, updated_at: V, location: ' cpt ', reason: ' Swap stock ', deal_year: '', deal_number: '' });
    expect(transferArgs('org', t)).toEqual({ p_org: 'org', p_unit: UNIT_ID, p_location: 'CPT', p_reason: 'Swap stock', p_deal_year: null, p_deal_number: null });
    const d = TransferInput.parse({ unit: UNIT_ID, updated_at: V, location: 'JHB', reason: '', deal_year: '2026', deal_number: '260' });
    expect(transferArgs('org', d)).toMatchObject({ p_reason: null, p_deal_year: 2026, p_deal_number: 260 });
    expect(transferArgs('org', TransferInput.parse({ unit: UNIT_ID, updated_at: V, location: 'JHB', reason: '', deal_year: '2026', deal_number: '' }))).toBeNull();
    expect(TransferInput.safeParse({ unit: UNIT_ID, updated_at: V, location: 'JHB', reason: 'r'.repeat(201), deal_year: '', deal_number: '' }).success).toBe(false);
    // The rendered version is required: a form without it cannot be checked for concurrent changes.
    expect(TransferInput.safeParse({ unit: UNIT_ID, location: 'JHB', reason: 'r', deal_year: '', deal_number: '' }).success).toBe(false);
    expect(CorrectInput.safeParse({ ...input(unit()), updated_at: '' }).success).toBe(false);
  });
});

describe('concurrent changes (review item 1)', () => {
  it('a form rendered from an older row is stale; the same version is not', () => {
    const u = unit({ updated_at: '2026-03-01T08:00:00.123456+00:00' });
    expect(isStale(u, '2026-03-01T08:00:00.123456+00:00')).toBe(false);
    expect(isStale(u, ' 2026-03-01T08:00:00.123456+00:00 ')).toBe(false);
    // Another write in the same millisecond still counts as a change (microseconds differ).
    expect(isStale(u, '2026-03-01T08:00:00.123455+00:00')).toBe(true);
    expect(isStale(u, '2026-02-28T08:00:00+00:00')).toBe(true);
    expect(STALE_MESSAGE).toBe('This unit changed since you opened it. Reload and check.');
  });
  it('without the check a notes-only save over a newer row would revert status, invoice and location', () => {
    // What the review found: the form posts every field, so diffing against the current row undoes other changes.
    const opened = unit({ status: 'available', invoice_number: null, location_id: 'JHB' });
    const now = unit({ status: 'reserved', invoice_number: 'INV-9', location_id: 'CPT', updated_at: '2026-03-02T09:00:00Z' });
    const posted = input(opened, { notes: 'Only a note' });
    expect(Object.keys((correctionFields(now, posted) as { fields: object }).fields)).toEqual(['location_id', 'status', 'invoice_number', 'notes']);
    expect(isStale(now, posted.updated_at)).toBe(true);
  });
  it('both admin actions refuse a stale form before calling the RPC', () => {
    const src = readFileSync(path.resolve(__dirname, '../../app/(admin)/admin/stock/units/actions.ts'), 'utf8');
    expect(src.match(/if \(isStale\(unit, parsed\.data\.updated_at\)\) return \{ error: STALE_MESSAGE \};/g)).toHaveLength(2);
    for (const fn of ['correctUnit', 'transferUnit']) {
      const body = src.slice(src.indexOf(`export async function ${fn}`));
      expect(body.indexOf('isStale(')).toBeLessThan(body.indexOf('db.rpc('));
    }
    const forms = readFileSync(path.resolve(__dirname, '../../app/(admin)/admin/stock/units/[id]/unit-forms.tsx'), 'utf8');
    expect(forms.match(/<input type="hidden" name="updated_at" value=\{unit\.updated_at\} \/>/g)).toHaveLength(2);
  });
});

describe('notes line breaks (review item 6)', () => {
  it('CRLF from a textarea is stored and compared as LF', () => {
    const u = unit({ notes: 'Line one\nLine two' });
    expect(correctionFields(u, input(u, { notes: 'Line one\r\nLine two' }))).toEqual({ fields: {} });
    expect(correctionFields(unit(), input(unit(), { notes: 'A\r\nB\rC' }))).toEqual({ fields: { notes: 'A\nB\nC' } });
    expect(normalizeNewlines('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
  });
  it('the 2000-character limit counts a line break once, as the textarea and the database do', () => {
    const lines = Array(1000).fill('x').join('\r\n');   // 1999 characters stored, 2998 as posted
    expect(normalizeNewlines(lines)).toHaveLength(1999);
    expect(CorrectInput.safeParse({ ...input(unit()), notes: lines }).success).toBe(true);
    expect(CorrectInput.safeParse({ ...input(unit()), notes: `${lines}\r\nyy` }).success).toBe(false);
  });
});

describe('Safari before 17 (review item 2)', () => {
  it('register links do not depend on URLSearchParams.size', () => {
    const desc = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, 'size');
    Object.defineProperty(URLSearchParams.prototype, 'size', { configurable: true, get: () => undefined });
    try {
      expect(unitsHref({ q: 'ABC', status: statusFilterOf('sold') })).toBe('/admin/stock/units?q=ABC&status=sold');
      expect(unitsHref({ q: null, model: null, location: null, status: statusFilterOf('') })).toBe('/admin/stock/units');
      expect(statusFilterOf('lost')).toBeNull();
    } finally {
      if (desc) Object.defineProperty(URLSearchParams.prototype, 'size', desc);
    }
  });
  it('new stock code never reads .size of a URLSearchParams', () => {
    const roots = ['app/(admin)/admin/stock', 'components/stock', 'lib/stock'].map((d) => path.resolve(__dirname, '../..', d));
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
      const f = path.join(d, n);
      return statSync(f).isDirectory() ? walk(f) : /\.tsx?$/.test(n) ? [f] : [];
    });
    const files = roots.flatMap((d) => walk(d));
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // `x.size` where x is a URLSearchParams: any `.size` read that is not a JSX prop or a Set/Map we own.
      expect(src, f).not.toMatch(/URLSearchParams\([^)]*\)\.size|\b(u|params|sp|search|qs|usp)\.size\b/);
    }
    const filters = readFileSync(path.resolve(__dirname, '../../app/(admin)/admin/stock/units/register-filters.tsx'), 'utf8');
    expect(filters).toContain('unitsHref(');
    expect(filters).not.toContain('new URLSearchParams');
  });
});

describe('export (review items 3 and 4)', () => {
  it('drops a model that is not a known part number (no free text such as an ID number reaches the audit row)', () => {
    const rq = parseRegisterQuery({ model: '8001015009087' }, LOCS, MODELS);
    expect(rq.model).toBeNull();
    expect(exportAuditRow({ orgId: 'o', userId: 'u' }, rq, 0).meta.model).toBeNull();
    expect(parseRegisterQuery({ model: ' ctll1 ' }, LOCS, MODELS).model).toBe('CTLL1');
    expect(parseRegisterQuery({ model: 'CTLL1' }, LOCS, []).model).toBeNull();
  });
  it('sorts newest first, ordering the microseconds Date.parse drops, then by id', () => {
    const rows = [
      { id: 'a', created_at: '2026-03-01T08:00:00.1234+00:00' },
      { id: 'b', created_at: '2026-03-01T08:00:00.12345+00:00' },
      { id: 'c', created_at: '2026-03-02T08:00:00+00:00' },
      { id: 'd', created_at: '2026-03-01T08:00:00.1234+00:00' },
    ];
    expect(sortNewestFirst(rows).map((r) => r.id)).toEqual(['c', 'b', 'd', 'a']);
  });
  it('explains a refusal over the cap', () => {
    expect(EXPORT_MAX_ROWS).toBe(10_000);
    expect(exportTooManyMessage(12345)).toBe('Too many units to export (12,345). Narrow the filters to 10,000 units or fewer.');
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
  it('marks a given current tab and leaves out tabs that are not built', () => {
    expect(stockTabs(member('admin'), 'deals').filter((t) => t.current).map((t) => t.key)).toEqual(['deals']);
    expect(stockTabs(member('admin')).some((t) => t.current)).toBe(false);
    const defs = STOCK_TABS.map((t) => (t.key === 'setup' ? { ...t, built: false } : t));
    expect(stockTabs(member('admin'), null, defs).map((t) => t.key)).not.toContain('setup');
    expect(STOCK_TABS.every((t) => t.built)).toBe(true);
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
