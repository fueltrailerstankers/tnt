// Forms index and entries grid (UI handoff FormsIndex/Entries): pure helpers, server-rendered card, and server-side
// refusal of the new grid actions. Synthetic data only.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FormCard } from '@/components/entries/FormCard';
import { accessLabel, awaitingStatuses, formCard, formsSummary, publicUrl, taskFlag } from '@/lib/admin/forms-index';
import {
  clearExportTable, currentViewId, defaultColumns, ExportParams, exportHref, gridColumns, gridHref, gridViewQuery,
  hasFilters, parseGridQuery, ReadStateInput, viewChips, viewParam, visibleFieldColumns,
} from '@/lib/admin/grid';
import type { Member } from '@/lib/security/can';
import { formScope, viewHref } from '@/lib/views/query';
import { spec } from './specs';

const ORG = '00000000-0000-0000-0000-000000000001';
const ADMIN: Member = { userId: '00000000-0000-0000-0000-00000000a001', orgId: ORG, role: 'admin', branch: null };
const READER: Member = { ...ADMIN, access: { home: 'read', tasks: 'read', forms: 'read' } as Member['access'], role: 'staff' };
const ID = '00000000-0000-4000-8000-00000000e001';
const noRawColours = (markup: string) => {
  const attrs = [...markup.matchAll(/(?:class|style)="([^"]*)"/g)].map((m) => m[1]).join(' ');
  expect(attrs).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  expect(attrs).not.toMatch(/\b(?:bg|text|border)-(?:neutral|gray|red|green|yellow|orange|teal|slate|zinc)-\d{2,3}\b/);
};

describe('grid URLs', () => {
  const sp = spec('release-form');

  it('keeps the view, search, dates and non-default columns; never page 1', () => {
    const q = parseGridQuery(sp, { view: 'unread', q: 'inv-1', from: '2026-10-01', page: '3' });
    expect(viewParam(q)).toBe('unread');
    expect(gridHref('release-form', sp, q)).toBe('/admin/forms/release-form?view=unread&q=inv-1&from=2026-10-01&page=3');
    expect(gridHref('release-form', sp, q, { page: '1', view: null })).toBe('/admin/forms/release-form?q=inv-1&from=2026-10-01');
    const cols = parseGridQuery(sp, { cols: defaultColumns(sp).join(',') });
    expect(gridHref('release-form', sp, cols)).toBe('/admin/forms/release-form');
    expect(viewParam(parseGridQuery(spec('store-room'), { view: 'status:APPROVAL' }))).toBe('status:APPROVAL');
    expect(hasFilters(q)).toBe(true);
    expect(hasFilters(parseGridQuery(sp, { view: 'unread' }))).toBe(false);
  });

  it('builds export links for the filter and the selection', () => {
    const q = parseGridQuery(sp, { view: 'unread', q: 'x' });
    expect(exportHref('release-form', q, 'csv')).toMatch(/^\/admin\/forms\/release-form\/export\?format=csv&view=unread&q=x&cols=/);
    expect(exportHref('release-form', q, 'xlsx', [12, 9])).toMatch(/format=xlsx.*&sel=12%2C9$/);
  });
});

describe('status chips', () => {
  it('lists All entries, Unread and each status with counts and its tone; archived statuses only with entries', () => {
    const sr = spec('store-room');
    const chips = viewChips(sr, { all: 5, unread: 2, byStatus: { Incomplete: 1, Submitted: 0, APPROVAL: 3, 'APPROVED EMAILED': 1 } });
    expect(chips.map((c) => [c.value, c.label, c.count, c.dot])).toEqual([
      ['all', 'All entries', 5, 'all'],
      ['unread', 'Unread', 2, 'all'],
      ['status:Incomplete', 'Incomplete', 1, 'gray'],
      ['status:APPROVAL', 'APPROVAL', 3, 'red'],
      ['status:APPROVED EMAILED', 'APPROVED EMAILED', 1, 'green'],
    ]);
    const withArchived = viewChips(sr, { all: 1, unread: 0, byStatus: { Submitted: 1 } });
    expect(withArchived.map((c) => c.label)).toContain('Submitted');
  });
});

describe('columns', () => {
  it('encrypted forms offer no field column: number, summary, created and status only, all locked', () => {
    for (const slug of ['deal', 'delivery-note']) {
      const sp = spec(slug);
      const q = parseGridQuery(sp, { cols: defaultColumns(sp).join(',') });
      const cols = gridColumns(sp, true, q.cols);
      expect(cols.map((c) => c.label)).toEqual(['#', 'Summary', 'Created', 'Status']);
      expect(cols.every((c) => c.required)).toBe(true);
      expect(visibleFieldColumns(sp, true, q.cols)).toEqual([]);
    }
  });

  it('other forms offer every data field between Summary and Created, the chosen ones visible', () => {
    const sp = spec('release-form');
    const q = parseGridQuery(sp, {});
    const cols = gridColumns(sp, false, q.cols);
    expect(cols[0].key).toBe('_number');
    expect(cols.at(-1)!.key).toBe('_status');
    expect(cols.filter((c) => !c.required).length).toBeGreaterThan(q.cols.length - 1);
    expect(cols.filter((c) => c.visible && !c.required).map((c) => c.key)).toEqual(q.cols);
    expect(visibleFieldColumns(sp, false, ['nope', ...q.cols]).map((c) => c.name)).toEqual(q.cols);
  });
});

describe('inputs', () => {
  it('Mark read / unread takes 1..200 entry ids and a mode, nothing else', () => {
    expect(ReadStateInput.safeParse({ ids: [ID], mode: 'read' }).success).toBe(true);
    expect(ReadStateInput.safeParse({ ids: [], mode: 'read' }).success).toBe(false);
    expect(ReadStateInput.safeParse({ ids: ["1' or 1=1"], mode: 'read' }).success).toBe(false);
    expect(ReadStateInput.safeParse({ ids: [ID], mode: 'delete' }).success).toBe(false);
    expect(ReadStateInput.safeParse({ ids: [ID], mode: 'read', userId: ID }).success).toBe(false);
    expect(ReadStateInput.safeParse({ ids: Array(201).fill(ID), mode: 'read' }).success).toBe(false);
  });

  it('export options: csv unless xlsx, selection as unique entry numbers', () => {
    expect(ExportParams.parse({ format: 'xlsx' })).toEqual({ format: 'xlsx', sel: null });
    expect(ExportParams.parse({ format: 'pdf' })).toEqual({ format: 'csv', sel: null });
    expect(ExportParams.parse({ format: 'csv', sel: '12,9,12' })).toEqual({ format: 'csv', sel: [12, 9] });
    for (const bad of ['0', '1,,2', 'a', '-1', '1;2', Array(201).fill('1').join(',')]) {
      expect(ExportParams.safeParse({ sel: bad }).success, bad).toBe(false);
    }
  });

  it('encrypted export has the clear columns only', () => {
    const t = clearExportTable([{ number: 7, status: 'Submitted', createdAt: '2026-10-29T08:00:00Z', updatedAt: '2026-10-29T09:00:00Z', summary: 'Deal · QU-10482' }], 'Africa/Johannesburg');
    expect(t).toEqual([
      ['Entry Number', 'Status', 'Created', 'Updated', 'Summary'],
      ['7', 'Submitted', '2026/10/29, 10:00', '2026/10/29, 11:00', 'Deal · QU-10482'],
    ]);
  });
});

describe('saved views', () => {
  const sp = spec('release-form');
  const scope = formScope('release-form');

  it('stores the filters and matches them back from the saved href', () => {
    const q = parseGridQuery(sp, { view: 'unread', q: 'inv', cols: 'INVNO' });
    const query = gridViewQuery(sp, q);
    expect(query).toEqual({ view: 'unread', q: 'inv', cols: ['INVNO'] });
    const saved = [{ id: 'v1', href: viewHref(scope, query) }];
    expect(currentViewId('release-form', sp, { ...q, page: 4 }, saved)).toBe('v1');
    expect(currentViewId('release-form', sp, parseGridQuery(sp, {}), saved)).toBe('all');
    expect(currentViewId('release-form', sp, parseGridQuery(sp, { view: 'unread' }), saved)).toBe('unread');
    expect(currentViewId('release-form', sp, parseGridQuery(sp, { q: 'other' }), saved)).toBe('custom');
    expect(currentViewId('job-card', spec('job-card'), parseGridQuery(spec('job-card'), {}), [{ id: 'x', href: '/admin/forms/release-form' }])).toBe('all');
  });
});

describe('forms index', () => {
  const base = (slug: string, over: Partial<{ isActive: boolean; encrypt: boolean }> = {}) => ({ slug, spec: spec(slug), isActive: true, encrypt: false, ...over });

  it('names the access type from the public link and the public role', () => {
    expect(accessLabel(base('request-for-invoice'))).toBe('Public link');
    expect(accessLabel(base('trailer-inspection-checklist'))).toBe('Inspector link');
    expect(accessLabel(base('job-card', { isActive: false }))).toBe('Internal');
  });

  it('flags entries waiting on staff', () => {
    expect(awaitingStatuses(spec('store-room'))).toEqual(['APPROVAL']);
    expect(taskFlag(spec('store-room'), 1)).toEqual({ label: '1 APPROVAL', tone: 'red' });
    expect(taskFlag(spec('trailer-inspection-checklist'), 3)).toEqual({ label: '3 awaiting approval', tone: 'yellow' });
    expect(taskFlag(spec('trailer-inspection-checklist'), 0)).toBeNull();
    expect(taskFlag(spec('job-card'), 4)).toBeNull();
  });

  it('builds cards: encrypted, auto-created, New entry and public path by permission', () => {
    const deal = formCard(base('deal', { encrypt: true, isActive: false }), { entries: 512, unread: 0, awaiting: 0 }, ADMIN);
    expect(deal).toMatchObject({ label: 'Deal', encrypted: true, access: 'Internal', newHref: '/admin/forms/deal/new', publicPath: null, autoFromXero: false });
    const rel = formCard(base('release-form'), { entries: 3, unread: 2, awaiting: 0 }, READER);
    expect(rel).toMatchObject({ autoFromXero: true, publicPath: '/f/release-form', newHref: '/f/release-form' });
    expect(formsSummary([deal, rel])).toBe('2 forms · 515 entries · 2 unread');
    expect(formsSummary([{ entries: 2585, unread: 1 }])).toBe('1 form · 2,585 entries · 1 unread');
    expect(publicUrl('https://portal.example.invalid/', '/f/release-form')).toBe('https://portal.example.invalid/f/release-form');
  });

  it('FormCard keeps form-card-* and Import entries, names its links and uses tokens only', () => {
    const card = formCard(base('request-for-invoice'), { entries: 388, unread: 3, awaiting: 0 }, ADMIN);
    const out = renderToStaticMarkup(h('ul', null, h(FormCard, { card, links: { publicUrl: 'https://portal.example.invalid/f/request-for-invoice', design: true, settings: true, importEntries: true } })));
    expect(out).toContain('data-testid="form-card-request-for-invoice"');
    expect(out).toContain('href="/admin/forms/import#form-request-for-invoice"');
    expect(out).toContain('href="/admin/forms/request-for-invoice/design"');
    expect(out).toContain('aria-label="3 unread in Request for Invoice"');
    expect(out).toContain('aria-label="Public link for Request for Invoice"');
    expect(out).toContain('>New entry<');
    noRawColours(out);

    const internal = formCard(base('deal', { encrypt: true, isActive: false }), { entries: 1, unread: 0, awaiting: 0 }, READER);
    const out2 = renderToStaticMarkup(h('ul', null, h(FormCard, { card: internal, links: { publicUrl: null, design: false, settings: false, importEntries: false } })));
    expect(out2).toContain('Internal only');
    expect(out2).toContain('Encrypted');
    expect(out2).not.toContain('Import entries');
    expect(out2).not.toContain('New entry');
  });
});
