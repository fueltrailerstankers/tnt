import { expect, test, type Page } from '@playwright/test';
import { ADMIN, signIn, sql } from './helpers';

// M6 stock pages A: overview (KPIs, model x branch matrix), unit register (search, filters, CSV export), unit record
// with the admin Correct record and Transfer forms, and what a factory member sees. Synthetic data only: made-up
// VINs and invoice numbers, scoped to this run so other specs' units never change the assertions.
const ORG = '00000000-0000-0000-0000-000000000001';
const ADMIN_ID = '00000000-0000-0000-0000-00000000a001';
const FACTORY = { email: 'factory-stock@example.invalid', password: 'factory-stock-e2e-only' }; // matches mini-supabase.mjs

const run = Date.now().toString(36).toUpperCase();
const PREFIX = `OV${run}`;
const VIN = { a: `${PREFIX}A1`, b: `${PREFIX}B2`, c: `${PREFIX}C3`, d: `${PREFIX}D4`, f: `${PREFIX}F5` };
const DEAL_NO = 800_000_000 + (Date.now() % 90_000_000);
const SEQ_B = DEAL_NO + 1;
const INV_C = `INV-${PREFIX}-C`;

test.describe.configure({ mode: 'serial' });

const unitId = async (vin: string) =>
  (await sql<{ id: string }>(`select id from public.stock_units where org_id = $1 and vin_norm = $2`, [ORG, vin]))[0].id;

test.beforeAll(async () => {
  const ins = `insert into public.stock_units (org_id, vin, model_part, location_id, status, invoice_number, accessories, deal_year, sequence, sold_at, dispatch_date)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;
  await sql(ins, [ORG, VIN.a, 'CTLL1', 'JHB', 'available', null, [], null, null, null, '2026-03-02']);
  await sql(ins, [ORG, VIN.b, 'CTLL1', 'JHB', 'available', null, ['Spare wheel', 'Jockey wheel'], 2026, SEQ_B, null, '2026-03-03']);
  await sql(ins, [ORG, VIN.c, 'CTLL1', 'CPT', 'reserved', INV_C, [], null, null, null, null]);
  await sql(ins, [ORG, VIN.d, 'CTLL2', 'DBN', 'sold', `INV-${PREFIX}-D`, [], null, null, new Date().toISOString(), null]);
  await sql(ins, [ORG, VIN.f, 'CTLL2', 'FACTORY', 'available', null, [], null, null, null, null]);
  await sql(`insert into public.stock_deals (org_id, year, number, location_id, model_part) values ($1, 2026, $2, 'JHB', 'CTLL2')`, [ORG, DEAL_NO]);
});

// Warm-up: `next dev` compiles each route on first use, which can outlast a 5s expectation on a cold run. Open the
// stock routes once with generous timeouts so the tests below measure the app, not the compiler.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const base = `http://127.0.0.1:${process.env.E2E_APP_PORT ?? 3100}`;
  const page = await browser.newPage();
  try {
    await page.goto(`${base}/login?next=${encodeURIComponent('/admin/stock')}`, { timeout: 90_000 });
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Password').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/admin\/stock$/, { timeout: 90_000 });
    await page.goto(`${base}/admin/stock/units?q=${PREFIX}`, { timeout: 90_000 });
    await page.goto(`${base}/admin/stock/units/${await unitId(VIN.a)}`, { timeout: 90_000 });
    await page.request.get(`${base}/admin/stock/units/export?q=warmup-${PREFIX}`, { timeout: 90_000 });
  } finally {
    await page.close();
  }
});

/** The stock plan's KPIs computed straight from the database (independent of lib/stock/kpi.ts). */
async function expectedKpis() {
  const [k] = await sql<Record<string, number>>(
    `select count(*) filter (where not l.is_factory and u.status in ('available', 'reserved'))::int as branches,
            count(*) filter (where not l.is_factory and u.status = 'reserved')::int as branch_reserved,
            count(*) filter (where not l.is_factory and u.status = 'available')::int as ready,
            count(*) filter (where u.status = 'reserved')::int as reserved,
            count(*) filter (where l.is_factory and u.status <> 'sold')::int as factory
     from public.stock_units u join public.stock_locations l on l.org_id = u.org_id and l.id = u.location_id
     where u.org_id = $1`, [ORG]);
  return k;
}

const cellCount = async (model: string, location: string) =>
  (await sql<{ n: number; r: number }>(
    `select count(*)::int as n, count(*) filter (where status = 'reserved')::int as r from public.stock_units
     where org_id = $1 and model_part = $2 and location_id = $3 and status in ('available', 'reserved')`, [ORG, model, location]))[0];

async function openSection(page: Page, name: string) {
  const details = page.getByRole('main').locator('details', { has: page.locator('summary', { hasText: name }) });
  if (!(await details.evaluate((d: HTMLDetailsElement) => d.open))) await details.locator('summary').click();
  return details;
}

test('overview: KPIs, matrix with amber reserved cells, "In stock only", cells open the filtered register', async ({ page }) => {
  await signIn(page, '/admin/stock');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Stock overview' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Main navigation' }).getByRole('link', { name: 'Stock' })).toHaveCount(1);

  // Admin sees every stock tab, Overview current.
  const tabs = main.getByRole('navigation', { name: 'Stock sections' });
  await expect(tabs.getByRole('link')).toHaveText(['Overview', 'Units', 'Dispatch', 'Deals', 'Invoices', 'Activity', 'Setup']);
  await expect(tabs.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');

  const k = await expectedKpis();
  await expect(page.getByTestId('kpi-branches-value')).toHaveText(String(k.branches));
  await expect(page.getByTestId('kpi-branches')).toContainText(`Includes ${k.branch_reserved} reserved`);
  await expect(page.getByTestId('kpi-ready-value')).toHaveText(String(k.ready));
  await expect(page.getByTestId('kpi-reserved-value')).toHaveText(String(k.reserved));
  await expect(page.getByTestId('kpi-factory-value')).toHaveText(String(k.factory));
  expect(k.factory).toBeGreaterThanOrEqual(1);
  expect(k.reserved).toBeGreaterThanOrEqual(1);

  await expect(page.getByTestId('branch-count')).toHaveText('3 branches');
  const jhb = await cellCount('CTLL1', 'JHB');
  const cpt = await cellCount('CTLL1', 'CPT');
  await expect(page.getByTestId('cell-CTLL1-JHB')).toContainText(String(jhb.n));
  // Amber marker when the count includes reserved units (and the count stays in stock).
  await expect(page.getByTestId('cell-CTLL1-CPT')).toHaveAttribute('data-reserved', String(cpt.r));
  await expect(page.getByTestId('cell-CTLL1-CPT')).toContainText(String(cpt.n));
  // Sold units are excluded: the Durban cell of CTLL2 does not count the sold unit.
  const dbn = await cellCount('CTLL2', 'DBN');
  await expect(page.getByTestId('cell-CTLL2-DBN')).toContainText(dbn.n ? String(dbn.n) : '—');

  // "In stock only" hides models without branch stock, in the URL.
  const [empty] = await sql<{ part_number: string }>(
    `select m.part_number from public.stock_models m where m.org_id = $1 and m.active and not exists (
       select 1 from public.stock_units u join public.stock_locations l on l.org_id = u.org_id and l.id = u.location_id
       where u.org_id = m.org_id and u.model_part = m.part_number and not l.is_factory and u.status <> 'sold')
     order by m.sort_order limit 1`, [ORG]);
  const footer = page.getByTestId('matrix-footer');
  await expect(footer).toContainText(/(\d+) of \1 models · Amber indicator = reserved units included/);
  await expect(page.getByTestId(`matrix-row-${empty.part_number}`)).toBeVisible();
  await main.getByLabel('In stock only').check();
  await expect(page).toHaveURL(/\/admin\/stock\?instock=1$/);
  await expect(page.getByTestId(`matrix-row-${empty.part_number}`)).toHaveCount(0);
  await expect(page.getByTestId('matrix-row-CTLL1')).toBeVisible();
  const text = (await footer.textContent()) ?? '';
  const [, shown, total] = text.match(/(\d+) of (\d+) models/) ?? [];
  expect(Number(shown)).toBeLessThan(Number(total));
  await main.getByLabel('In stock only').uncheck();
  await expect(page).toHaveURL(/\/admin\/stock$/);

  // A count opens the register filtered by model, location and in-stock status.
  await page.getByTestId('cell-CTLL1-JHB').click();
  await expect(page).toHaveURL(/\/admin\/stock\/units\?model=CTLL1&location=JHB&status=in_stock$/);
  await expect(page.getByTestId('unit-count')).toHaveText(`${jhb.n} ${jhb.n === 1 ? 'unit' : 'units'}`);
  await expect(main.getByRole('navigation', { name: 'Stock sections' }).getByRole('link', { name: 'Units' })).toHaveAttribute('aria-current', 'page');
});

test('register: URL-synced search, filters, deal search, CSV export of the filtered set (audited)', async ({ page }) => {
  await signIn(page, '/admin/stock/units');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Unit register' })).toBeVisible();

  // Debounced search box, synced to ?q=; sold history is searchable.
  await main.getByPlaceholder('Search VIN, sequence, model or invoice…').fill(PREFIX.toLowerCase());
  await expect(page).toHaveURL(new RegExp(`\\?q=${PREFIX.toLowerCase()}$`));
  await expect(page.getByTestId('unit-count')).toHaveText('5 units');
  const table = page.getByTestId('unit-table');
  await expect(table.getByTestId('unit-row')).toHaveCount(5);
  await expect(table.getByTestId('unit-row').filter({ hasText: VIN.b })).toContainText(`Sequence ${SEQ_B}`);

  await main.getByLabel('Status').selectOption('sold');
  await expect(page).toHaveURL(/status=sold/);
  await expect(page.getByTestId('unit-count')).toHaveText('1 unit');
  await expect(table.getByTestId('unit-row')).toContainText(VIN.d);
  await expect(table.getByTestId('unit-row')).toContainText('Sold');

  await main.getByLabel('Status').selectOption('');
  await main.getByLabel('Location').selectOption('FACTORY');
  await expect(page.getByTestId('unit-count')).toHaveText('1 unit');
  await expect(table.getByTestId('unit-row')).toContainText(VIN.f);

  // Export link carries the current filter; the CSV holds exactly the filtered rows.
  await main.getByLabel('Location').selectOption('');
  await expect(page).toHaveURL(new RegExp(`/admin/stock/units\\?q=${PREFIX.toLowerCase()}$`));
  const exportLink = main.getByRole('link', { name: 'Export CSV' });
  await expect(exportLink).toHaveAttribute('href', `/admin/stock/units/export?q=${PREFIX.toLowerCase()}`);
  const before = await sql<{ id: string }>(`select id from public.audit_log where org_id = $1 and action = 'stock.export'`, [ORG]);
  const res = await page.request.get(`/admin/stock/units/export?q=${PREFIX.toLowerCase()}`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/csv');
  const lines = (await res.text()).replace(/^﻿/, '').trim().split('\r\n');
  expect(lines[0]).toBe('VIN,Deal year,Sequence,Model,Description,Location,Status,Invoice,Dispatch date,Accessories,Notes');
  expect(lines).toHaveLength(6);
  expect(lines.find((l) => l.startsWith(VIN.b))).toContain(`${VIN.b},2026,${SEQ_B},CTLL1,`);
  expect(lines.find((l) => l.startsWith(VIN.b))).toContain('Johannesburg,Available,,2026-03-03,Spare wheel; Jockey wheel,');
  expect(lines.find((l) => l.startsWith(VIN.d))).toContain(`Durban,Sold,INV-${PREFIX}-D`);
  const audit = await sql<{ actor_user: string; meta: Record<string, unknown> }>(
    `select actor_user, meta from public.audit_log where org_id = $1 and action = 'stock.export' and not (id = any($2::bigint[])) order by id desc`,
    [ORG, before.map((r) => r.id)]);
  expect(audit).toHaveLength(1);
  expect(audit[0].actor_user).toBe(ADMIN_ID);
  expect(audit[0].meta).toMatchObject({ format: 'csv', rows: 5, search: true });
  expect(JSON.stringify(audit[0].meta)).not.toContain(PREFIX);

  // "year / sequence" finds the one unit; an invoice number finds its unit.
  await main.getByPlaceholder('Search VIN, sequence, model or invoice…').fill(`2026 / ${SEQ_B}`);
  await expect(page.getByTestId('unit-count')).toHaveText('1 unit');
  await expect(table.getByTestId('unit-row')).toContainText(VIN.b);
  await main.getByPlaceholder('Search VIN, sequence, model or invoice…').fill(INV_C.toLowerCase());
  await expect(page.getByTestId('unit-count')).toHaveText('1 unit');
  await expect(table.getByTestId('unit-row')).toContainText(VIN.c);
  await expect(table.getByTestId('unit-row')).toContainText('Reserved');

  await main.getByRole('link', { name: 'Clear' }).click();
  await expect(page).toHaveURL(/\/admin\/stock\/units$/);
  await expect(main.getByPlaceholder('Search VIN, sequence, model or invoice…')).toHaveValue('');

  // A model that is not a part number (here an ID-number-like string) is dropped: no filter, not in the export link.
  await page.goto(`/admin/stock/units?q=${PREFIX}&model=8001015009087`);
  await expect(page.getByTestId('unit-count')).toHaveText('5 units');
  await expect(main.getByRole('link', { name: 'Export CSV' })).toHaveAttribute('href', `/admin/stock/units/export?q=${PREFIX}`);
});

test('unit record: every field; admin Correct record and Transfer with mapped errors, audited', async ({ page }) => {
  await signIn(page, '/admin/stock/units');
  await page.goto(`/admin/stock/units?q=${PREFIX}`);
  await page.getByTestId('unit-table').getByRole('link', { name: `View ${VIN.a}` }).click();
  const idA = await unitId(VIN.a);
  await expect(page).toHaveURL(new RegExp(`/admin/stock/units/${idA}\\?q=${PREFIX}$`));
  const record = page.getByTestId('unit-record');
  await expect(record).toContainText(VIN.a);
  await expect(record).toContainText('Johannesburg');
  await expect(record).toContainText('Available');
  await expect(record).toContainText('None recorded');
  await expect(record).toContainText('2026-03-02');

  // Correct record: only the changed fields are sent; the audit lists their keys, never the values.
  let form = (await openSection(page, 'Correct record')).getByTestId('correct-form');
  await form.getByLabel('Invoice number').fill(`inv-${PREFIX}-a`);
  await form.getByLabel('Notes').fill('Synthetic note for the e2e run');
  await form.getByRole('button', { name: 'Save correction' }).click();
  await expect(form.getByRole('status')).toHaveText('Record corrected: invoice, notes.');
  await expect(record).toContainText(`INV-${PREFIX}-A`);
  await expect(record).toContainText('Synthetic note for the e2e run');
  const [corr] = await sql<{ meta: { changed: string[] } & Record<string, unknown> }>(
    `select meta from public.audit_log where org_id = $1 and action = 'stock.correct' and entity_id = $2 order by id desc limit 1`, [ORG, idA]);
  expect(corr.meta.changed).toEqual(['invoice_number', 'notes']);
  expect(JSON.stringify(corr.meta)).not.toContain('Synthetic note');

  // A VIN that is already used: the stock plan's duplicate message, nothing changed.
  form = page.getByTestId('correct-form');
  await form.getByLabel('VIN').fill(VIN.b.toLowerCase());
  await form.getByRole('button', { name: 'Save correction' }).click();
  await expect(form.getByRole('alert')).toHaveText(`VIN already used — CTLL1; sequence ${SEQ_B}; Johannesburg; Available. Open the existing record instead.`);
  expect((await sql(`select 1 from public.stock_units where org_id = $1 and vin_norm = $2`, [ORG, VIN.a]))).toHaveLength(1);

  // Transfer branch to branch needs a reason; the reason shows on the record and the move is audited.
  await page.reload();
  const transfer = (await openSection(page, 'Transfer branch')).getByTestId('transfer-form');
  await transfer.getByLabel('Destination').selectOption('CPT');
  await transfer.getByLabel('Reason').fill('Rebalance branch stock');
  await transfer.getByRole('button', { name: 'Transfer unit' }).click();
  await expect(transfer.getByRole('status')).toHaveText('Moved to Cape Town.');
  await expect(record).toContainText('Cape Town');
  await expect(record).toContainText('Rebalance branch stock');
  expect(await sql(`select location_id, transfer_reason from public.stock_units where id = $1`, [idA]))
    .toEqual([{ location_id: 'CPT', transfer_reason: 'Rebalance branch stock' }]);
  const [move] = await sql<{ meta: Record<string, unknown> }>(
    `select meta from public.audit_log where org_id = $1 and action = 'stock.move' and entity_id = $2 order by id desc limit 1`, [ORG, idA]);
  expect(move.meta).toMatchObject({ from: 'JHB', to: 'CPT', vin: VIN.a });
  expect(JSON.stringify(move.meta)).not.toContain('Rebalance');
});

test('factory unit: move to a branch with its deal clears the deal; Correct record unlinks it again', async ({ page }) => {
  const idF = await unitId(VIN.f);
  await signIn(page, `/admin/stock/units/${idF}`);
  const record = page.getByTestId('unit-record');
  await expect(record).toContainText('Factory');

  const transfer = (await openSection(page, 'Transfer branch')).getByTestId('transfer-form');
  await expect(transfer.getByLabel('Destination')).toHaveValue('JHB');
  await transfer.getByLabel('Deal year').fill('2026');
  await transfer.getByLabel('Sequence number').fill(String(DEAL_NO + 7));
  await transfer.getByRole('button', { name: 'Transfer unit' }).click();
  await expect(transfer.getByRole('alert')).toHaveText('No matching deal for this year and number.');
  expect(await sql(`select location_id from public.stock_units where id = $1`, [idF])).toEqual([{ location_id: 'FACTORY' }]);

  await transfer.getByLabel('Sequence number').fill(String(DEAL_NO));
  await transfer.getByRole('button', { name: 'Transfer unit' }).click();
  await expect(page.getByTestId('transfer-form').getByRole('status')).toHaveText(`Moved to Johannesburg and linked to deal 2026 / ${DEAL_NO}.`);
  await expect(record).toContainText(`2026 / ${DEAL_NO}`);
  const [deal] = await sql<{ status: string; unit_id: string | null }>(
    `select status, unit_id from public.stock_deals where org_id = $1 and year = 2026 and number = $2`, [ORG, DEAL_NO]);
  expect(deal).toEqual({ status: 'dispatched', unit_id: idF });
  const [moved] = await sql<{ location_id: string; dispatch_date: string | null }>(
    `select location_id, dispatch_date::text from public.stock_units where id = $1`, [idF]);
  expect(moved.location_id).toBe('JHB');
  expect(moved.dispatch_date).not.toBeNull();

  const form = (await openSection(page, 'Correct record')).getByTestId('correct-form');
  await form.getByLabel('Unlink from the deal').check();
  await form.getByRole('button', { name: 'Save correction' }).click();
  await expect(form.getByRole('status')).toHaveText('Record corrected: deal link.');
  expect(await sql(`select status, unit_id from public.stock_deals where org_id = $1 and year = 2026 and number = $2`, [ORG, DEAL_NO]))
    .toEqual([{ status: 'awaiting_dispatch', unit_id: null }]);
  expect(await sql(`select deal_id, deal_year, sequence from public.stock_units where id = $1`, [idF]))
    .toEqual([{ deal_id: null, deal_year: null, sequence: null }]);
});

test('a form opened before someone else changed the unit is refused, not saved over it; notes keep line breaks once', async ({ page }) => {
  const idC = await unitId(VIN.c);
  await signIn(page, '/admin/stock/units');
  await page.goto(`/admin/stock/units/${idC}`);
  const record = page.getByTestId('unit-record');
  await expect(record).toContainText('Cape Town');
  const correct = (await openSection(page, 'Correct record')).getByTestId('correct-form');
  const transfer = (await openSection(page, 'Transfer branch')).getByTestId('transfer-form');

  // Meanwhile another admin moves the unit (any write bumps updated_at).
  await sql(`update public.stock_units set location_id = 'DBN', transfer_reason = 'Moved elsewhere meanwhile' where id = $1`, [idC]);

  await correct.getByLabel('Notes').fill('Note typed on the old form');
  await correct.getByRole('button', { name: 'Save correction' }).click();
  await expect(correct.getByRole('alert')).toHaveText('This unit changed since you opened it. Reload and check.');
  await transfer.getByLabel('Destination').selectOption('JHB');
  await transfer.getByLabel('Reason').fill('Old form transfer');
  await transfer.getByRole('button', { name: 'Transfer unit' }).click();
  await expect(transfer.getByRole('alert')).toHaveText('This unit changed since you opened it. Reload and check.');
  expect(await sql(`select location_id, status, invoice_number, notes from public.stock_units where id = $1`, [idC]))
    .toEqual([{ location_id: 'DBN', status: 'reserved', invoice_number: INV_C, notes: null }]);

  // After a reload the form is current: a notes-only edit keeps the other admin's location.
  await page.reload();
  await expect(record).toContainText('Durban');
  const fresh = (await openSection(page, 'Correct record')).getByTestId('correct-form');
  await fresh.getByLabel('Notes').fill('Line one\nLine two');
  await fresh.getByRole('button', { name: 'Save correction' }).click();
  await expect(fresh.getByRole('status')).toHaveText('Record corrected: notes.');
  expect(await sql(`select location_id, notes from public.stock_units where id = $1`, [idC]))
    .toEqual([{ location_id: 'DBN', notes: 'Line one\nLine two' }]);
  // Saving the same text again changes nothing (the browser posts CRLF; the record keeps LF).
  await page.getByTestId('correct-form').getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByTestId('correct-form').getByRole('status')).toHaveText('No changes to save.');
});

test('an export over the 10,000-unit cap is refused with the reason, never cut short', async ({ page }) => {
  const cap = `CAP${run}`;
  await sql(`insert into public.stock_units (org_id, vin, model_part, location_id)
             select $1, $2 || lpad(g::text, 6, '0'), 'CTLL3', 'FACTORY' from generate_series(1, 10001) g`, [ORG, cap]);
  try {
    await signIn(page, '/admin/stock/units');
    await page.goto(`/admin/stock/units?q=${cap}`);
    await expect(page.getByTestId('unit-count')).toHaveText('10001 units');
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Export CSV' })).toHaveCount(0);
    await expect(page.getByTestId('export-too-many')).toHaveText('Too many units to export (10,001). Narrow the filters to 10,000 units or fewer.');
    const before = (await sql(`select count(*)::int as n from public.audit_log where org_id = $1 and action = 'stock.export'`, [ORG]))[0].n;
    const res = await page.request.get(`/admin/stock/units/export?q=${cap}`);
    expect(res.status()).toBe(422);
    expect(await res.text()).toBe('Too many units to export (10,001). Narrow the filters to 10,000 units or fewer.');
    expect((await sql(`select count(*)::int as n from public.audit_log where org_id = $1 and action = 'stock.export'`, [ORG]))[0].n).toBe(before);
  } finally {
    await sql(`delete from public.stock_units where org_id = $1 and vin_norm like $2`, [ORG, `${cap}%`]);
  }
});

test('factory member: stock tabs by permission, no export, no admin forms', async ({ page }) => {
  // Sanity: the stub seeds this member with the factory role.
  expect(await sql(`select m.role from public.memberships m join auth.users u on u.id = m.user_id where u.email = $1 and m.org_id = $2`, [FACTORY.email, ORG]))
    .toEqual([{ role: 'factory' }]);
  await page.goto(`/login?next=${encodeURIComponent('/admin/stock')}`);
  await page.getByLabel('Email').fill(FACTORY.email);
  await page.getByLabel('Password').fill(FACTORY.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/stock$/);

  const main = page.getByRole('main');
  await expect(main.getByRole('navigation', { name: 'Stock sections' }).getByRole('link')).toHaveText(['Overview', 'Units', 'Dispatch', 'Deals', 'Activity']);
  await expect(main.getByRole('link', { name: 'Dispatch a unit' })).toBeVisible();
  await expect(page.getByTestId('kpi-branches-value')).toHaveText(String((await expectedKpis()).branches));

  await page.goto(`/admin/stock/units?q=${PREFIX}`);
  await expect(page.getByTestId('unit-count')).toHaveText('5 units');
  await expect(main.getByRole('link', { name: 'Export CSV' })).toHaveCount(0);
  expect((await page.request.get(`/admin/stock/units/export?q=${PREFIX}`)).status()).toBe(403);

  await page.goto(`/admin/stock/units/${await unitId(VIN.b)}`);
  await expect(page.getByTestId('unit-record')).toContainText('Spare wheel');
  await expect(page.getByTestId('unit-record')).toContainText('Jockey wheel');
  await expect(main.getByText('Correct record')).toHaveCount(0);
  await expect(main.getByText('Transfer branch')).toHaveCount(0);

  // The shell search sends a VIN to the unit register (factory staff cannot open deal files).
  const search = page.getByRole('searchbox', { name: 'Search by quote no, VIN or invoice no' }).first();
  await search.fill(VIN.b);
  await search.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/admin/stock/units\\?q=${VIN.b}$`));
  await expect(page.getByTestId('unit-count')).toHaveText('1 unit');
});

test.describe('phone (390)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  const noPageScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

  test('overview, register cards and the unit record fit a phone without page-wide scrolling', async ({ page }) => {
    await signIn(page, '/admin/stock');
    await expect(page.getByTestId('kpi-reserved-value')).toBeVisible();
    // The matrix scrolls inside its card; branch columns use their short codes.
    await expect(page.getByTestId('stock-matrix').getByRole('columnheader').filter({ hasText: 'JHB' })).toBeVisible();
    expect(await noPageScroll(page)).toBe(true);

    await page.goto(`/admin/stock/units?q=${PREFIX}`);
    await expect(page.getByTestId('unit-table')).toBeHidden();
    await expect(page.getByTestId('unit-cards').getByRole('listitem')).toHaveCount(5);
    expect(await noPageScroll(page)).toBe(true);

    await page.getByTestId('unit-cards').getByRole('link', { name: `View ${VIN.b}` }).click();
    await expect(page.getByTestId('unit-record')).toContainText(VIN.b);
    await expect(page.getByRole('main').locator('summary', { hasText: 'Correct record' })).toBeVisible();
    expect(await noPageScroll(page)).toBe(true);

    // Admin bottom bar stays at 5 items (Stock is in the menu).
    await expect(page.getByRole('navigation', { name: 'Quick links' }).getByRole('link')).toHaveText(['Home', 'Tasks', 'Forms', 'Deals', 'Leads']);
  });

  test('factory staff get Home and Stock in the bottom bar', async ({ page }) => {
    await page.goto(`/login?next=${encodeURIComponent('/admin/stock')}`);
    await page.getByLabel('Email').fill(FACTORY.email);
    await page.getByLabel('Password').fill(FACTORY.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/stock$/);
    const bar = page.getByRole('navigation', { name: 'Quick links' });
    await expect(bar.getByRole('link')).toHaveText(['Home', 'Stock']);
    await expect(bar.getByRole('link', { name: 'Stock' })).toHaveAttribute('aria-current', 'page');
  });
});
