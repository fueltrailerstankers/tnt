import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { attach, PDF, signIn, sql } from './helpers';
import { E2E_XERO } from './xero-env';

// M6 stock pages B: DEAL -> stock deal sync, Deals (dismiss / restore), Dispatch (both modes, every Find unit
// outcome, duplicate VIN incl. sold, factory unit move). Synthetic VINs, quote numbers and deals only.
const ORG = '00000000-0000-0000-0000-000000000001';
const ADMIN_ID = '00000000-0000-0000-0000-00000000a001';
const THANKS = 'Thank you for filling out the form. Your response has been recorded.';
const run = Date.now().toString(36).toUpperCase();
const YEAR = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric' }).format(new Date()));
let nextNumber = 900_000 + (Date.now() % 50_000) * 2;
const vin = (tag: string) => `E2E${run}${tag}`;

async function drainOutbox(request: APIRequestContext) {
  const res = await request.post('/api/jobs/outbox', { headers: { Authorization: `Bearer ${E2E_XERO.JOB_SECRET}` } });
  expect(res.status()).toBe(200);
}

/** An awaiting stock deal made directly (the DEAL sync itself is covered by the first test). */
async function makeDeal(over: { location?: string | null; model?: string | null; accessories?: string[] } = {}) {
  const number = nextNumber++;
  const [d] = await sql<{ id: string }>(
    `insert into public.stock_deals(org_id, year, number, location_id, model_part, quote_number, accessories)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [ORG, YEAR, number, over.location === undefined ? 'CPT' : over.location, over.model === undefined ? '1000DB' : over.model, `SAMPLE-Q-${run}-${number}`, over.accessories ?? []],
  );
  return { id: d.id, number, label: `${YEAR} / ${number}` };
}

const dealStatus = async (id: string) => (await sql<{ status: string }>(`select status from public.stock_deals where id = $1`, [id]))[0]?.status;

async function findUnit(page: Page, number: number) {
  const main = page.getByRole('main');
  await main.getByRole('radio', { name: 'Existing sequence number' }).check();
  await main.getByRole('textbox', { name: 'Deal year', exact: true }).fill(String(YEAR));
  await main.getByRole('textbox', { name: 'Sequence number', exact: true }).fill(String(number));
  await main.getByRole('button', { name: 'Find unit' }).click();
  return page.getByTestId('find-result');
}

test.beforeAll(async () => {
  // Pilot start date (the Setup page writes it; server-only key): every DEAL from 2020 is a stock deal.
  await sql(`insert into public.app_settings(org_id, key, value) values ($1, 'stock.deals_from', '"2020-01-01"')
             on conflict (org_id, key) do update set value = excluded.value`, [ORG]);
});

test('DEAL submit creates exactly one stock deal; an Update re-syncs the same deal', async ({ page, request }) => {
  const quote = `QE2E-${run}`;
  await page.goto('/f/deal');
  await page.getByLabel('CPT').check();
  await page.getByLabel('QUOTE NO').fill(quote);
  await page.getByLabel('PART NO 1').fill('1000 db');
  await page.getByLabel('LINE 1', { exact: true }).fill('1000 litre metal bowser');
  await page.getByLabel('LINE 2', { exact: true }).fill('Sample hose reel');
  await page.getByLabel('Total').fill('12345');
  await attach(page, 'POP', PDF);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(THANKS)).toBeVisible();

  const [entry] = await sql<{ id: string; number: number }>(
    `select e.id, e.number from public.entries e join public.forms f on f.id = e.form_id where f.slug = 'deal' and e.summary = $1`, [quote]);
  expect(await sql(`select 1 from public.outbox_jobs where queue = 'stock.deal-sync' and payload->>'entryId' = $1`, [entry.id])).toHaveLength(1);
  const deals = async () => sql<{ id: string; year: number; number: number; location_id: string; model_part: string; quote_number: string; accessories: string[]; status: string }>(
    `select id, year, number, location_id, model_part, quote_number, accessories, status from public.stock_deals where entry_id = $1`, [entry.id]);
  await expect.poll(async () => { await drainOutbox(request); return (await deals()).length; }, { timeout: 20_000 }).toBe(1);
  const [deal] = await deals();
  expect(deal).toMatchObject({ year: YEAR, number: entry.number, location_id: 'CPT', model_part: '1000DB', quote_number: quote, accessories: ['Sample hose reel'], status: 'awaiting_dispatch' });
  expect(await sql(`select 1 from public.job_runs where job = 'stock.deal-sync' and ok`)).not.toHaveLength(0);

  // Staff update: the same stock deal follows the DEAL (no second row).
  await signIn(page, `/admin/forms/deal/entries/${entry.number}`);
  await page.getByRole('main').getByLabel('LINE 3', { exact: true }).fill('Sample spare wheel');
  await page.getByRole('button', { name: 'Update' }).click();
  await expect(page.getByText('Saved. Status: Submitted')).toBeVisible();
  await expect.poll(async () => { await drainOutbox(request); return (await deals())[0]?.accessories; }, { timeout: 20_000 })
    .toEqual(['Sample hose reel', 'Sample spare wheel']);
  expect(await deals()).toHaveLength(1);

  // Deals page lists it with a link to the DEAL entry and Dispatch ->.
  await page.goto(`/admin/stock/deals?branch=CPT`);
  const row = page.locator(`[data-testid="deal-row"][data-deal="${YEAR} / ${entry.number}"]`);
  await expect(row).toContainText('Cape Town');
  await expect(row).toContainText(quote);
  await expect(row.getByRole('link', { name: `${YEAR} / ${entry.number}`, exact: true })).toHaveAttribute('href', `/admin/forms/deal/entries/${entry.number}`);
  await expect(page.getByTestId('deals-footer')).toContainText('Dispatches without a deal number do not clear this list.');

  // Dispatch -> prefilled existing-sequence mode; complete it.
  await row.getByRole('link', { name: `Dispatch deal ${YEAR} / ${entry.number}` }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/stock/dispatch\\?year=${YEAR}&number=${entry.number}$`));
  const main = page.getByRole('main');
  await expect(page.getByTestId('find-result')).toHaveText(`Deal ${YEAR} / ${entry.number} · 1000DB · Cape Town. Add or confirm the VIN and destination.`);
  await expect(main.getByRole('radio', { name: 'Existing sequence number' })).toBeChecked();
  await expect(main.getByLabel('Model / part number')).toHaveValue('1000DB');
  await expect(main.getByLabel('Destination branch')).toHaveValue('CPT');
  await expect(main.getByLabel('Accessory 01')).toHaveValue('Sample hose reel');
  await expect(main.getByLabel('Accessory 02')).toHaveValue('Sample spare wheel');
  await main.getByRole('textbox', { name: 'VIN', exact: true }).fill(` ${vin('A').toLowerCase()} `);
  await main.getByRole('button', { name: 'Complete dispatch →' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/stock/units\\?q=${vin('A')}&saved=dispatch$`));

  const [unit] = await sql<{ id: string; location_id: string; deal_year: number; sequence: number; accessories: string[]; status: string }>(
    `select id, location_id, deal_year, sequence, accessories, status from public.stock_units where org_id = $1 and vin_norm = $2`, [ORG, vin('A')]);
  expect(unit).toMatchObject({ location_id: 'CPT', deal_year: YEAR, sequence: entry.number, accessories: ['Sample hose reel', 'Sample spare wheel'], status: 'available' });
  expect(await dealStatus(deal.id)).toBe('dispatched');
  const audit = await sql<{ meta: Record<string, unknown> }>(`select meta from public.audit_log where action = 'stock.dispatch' and entity_id = $1`, [unit.id]);
  expect(audit).toHaveLength(1);
  expect(audit[0].meta).toMatchObject({ vin: vin('A'), deal_number: entry.number, location: 'CPT' });

  // Already dispatched: Find unit blocks a second dispatch.
  await page.goto('/admin/stock/dispatch');
  await expect(await findUnit(page, entry.number)).toHaveText(`Deal ${YEAR}/${entry.number} was already dispatched with VIN ${vin('A')}.`);
  await expect(page.getByRole('button', { name: 'Complete dispatch →' })).toBeDisabled();

  // A re-sync never downgrades the dispatched deal.
  await sql(`insert into public.outbox_jobs(org_id, queue, payload) values ($1, 'stock.deal-sync', $2)`, [ORG, { entryId: entry.id }]);
  await drainOutbox(request);
  expect(await dealStatus(deal.id)).toBe('dispatched');
});

test('Find unit: not found and dismissed block; admin dismisses with a reason and restores', async ({ page }) => {
  const deal = await makeDeal({ location: 'JHB', accessories: ['Sample hose reel'] });
  await signIn(page);
  await page.goto('/admin/stock/dispatch');
  await expect(await findUnit(page, 99_999_999)).toHaveText('No matching deal for this year and number.');
  await expect(page.getByRole('button', { name: 'Complete dispatch →' })).toBeDisabled();

  await page.goto(`/admin/stock/deals?branch=JHB`);
  const row = page.locator(`[data-testid="deal-row"][data-deal="${deal.label}"]`);
  await row.getByRole('button', { name: `Dismiss deal ${deal.label}` }).click();
  const dialog = page.getByRole('dialog', { name: `Dismiss deal ${deal.label}` });
  await dialog.getByLabel('Reason').fill('SENT 26/03');
  await dialog.getByRole('button', { name: 'Dismiss' }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toHaveCount(0);
  expect(await dealStatus(deal.id)).toBe('dismissed');

  await page.goto(`/admin/stock/deals?branch=JHB&dismissed=1`);
  await expect(row).toContainText('Dismissed');
  await expect(row.getByTestId('dismissed-reason')).toHaveText('SENT 26/03');
  await expect(page.getByTestId('dismissal-history')).toContainText(`${deal.label} · SENT 26/03`);

  await page.goto('/admin/stock/dispatch');
  await expect(await findUnit(page, deal.number)).toHaveText('This deal has been dismissed. Only an admin can restore it before dispatch.');
  await expect(page.getByRole('button', { name: 'Complete dispatch →' })).toBeDisabled();

  await page.goto(`/admin/stock/deals?branch=JHB&dismissed=1`);
  await row.getByRole('button', { name: `Restore deal ${deal.label}` }).click();
  await expect(row).toHaveCount(0);
  expect(await dealStatus(deal.id)).toBe('awaiting_dispatch');
  // History survives the restore; audit rows carry ids, never the reason.
  expect(await sql(`select reason from public.stock_deal_dismissals where deal_id = $1`, [deal.id])).toEqual([{ reason: 'SENT 26/03' }]);
  const audit = await sql<{ action: string; meta: Record<string, unknown> }>(`select action, meta from public.audit_log where entity_id = $1 order by id`, [deal.id]);
  expect(audit.map((a) => a.action)).toEqual(['stock.dismiss', 'stock.restore']);
  expect(JSON.stringify(audit)).not.toContain('SENT 26/03');
});

test('Duplicate VIN is blocked, sold units included; a free dispatch never clears a deal', async ({ page }) => {
  const deal = await makeDeal();
  await sql(`insert into public.stock_units(org_id, vin, model_part, location_id, status, sequence, sold_at) values ($1, $2, '2500D', 'JHB', 'sold', 248, now())`, [ORG, vin('SOLD')]);
  await signIn(page);
  await page.goto('/admin/stock/dispatch');
  const main = page.getByRole('main');
  await main.getByLabel('Model / part number').selectOption('1000DB');
  await main.getByRole('textbox', { name: 'VIN', exact: true }).fill(vin('SOLD'));
  await main.getByRole('textbox', { name: 'VIN', exact: true }).press('Tab');
  await main.getByLabel('Destination branch').selectOption('CPT');
  const dup = 'VIN already used — 2500D; sequence 248; Johannesburg; Sold. Open the existing record instead.';
  await expect(page.getByTestId('vin-note')).toHaveText(dup); // checked on blur
  await main.getByRole('button', { name: 'Complete dispatch →' }).click();
  await expect(main.getByRole('alert')).toContainText(dup);
  expect(await sql(`select 1 from public.stock_units where org_id = $1 and vin_norm = $2`, [ORG, vin('SOLD')])).toHaveLength(1);

  // Free dispatch with a new VIN: saved, and the deal stays outstanding.
  await main.getByRole('textbox', { name: 'VIN', exact: true }).fill(vin('FREE'));
  await main.getByLabel('Accessory 01').fill('Sample hose reel');
  await main.getByRole('button', { name: 'Complete dispatch →' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/stock/units\\?q=${vin('FREE')}&saved=dispatch$`));
  const [u] = await sql<{ deal_id: string | null; sequence: number | null; accessories: string[] }>(
    `select deal_id, sequence, accessories from public.stock_units where org_id = $1 and vin_norm = $2`, [ORG, vin('FREE')]);
  expect(u).toEqual({ deal_id: null, sequence: null, accessories: ['Sample hose reel'] });
  expect(await dealStatus(deal.id)).toBe('awaiting_dispatch');
});

test('A unit registered at the Factory moves to its branch with the deal (factory staff, 390px phone)', async ({ page }) => {
  const deal = await makeDeal({ model: null });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto('/admin/stock/dispatch');
  await sql(`update public.memberships set role = 'factory' where org_id = $1 and user_id = $2`, [ORG, ADMIN_ID]);
  try {
    // Factory staff: no Dismiss on the Deals page.
    await page.goto('/admin/stock/deals');
    await expect(page.getByRole('heading', { name: 'Outstanding deals' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Dismiss deal/ })).toHaveCount(0);
    await expect(page.getByText('View access · Only an admin can dismiss or restore deals.')).toBeVisible();

    // Register the unit at the Factory (free mode).
    await page.goto('/admin/stock/dispatch');
    const main = page.getByRole('main');
    await main.getByLabel('Model / part number').selectOption('2500D');
    await main.getByRole('textbox', { name: 'VIN', exact: true }).fill(vin('FAC'));
    await main.getByLabel('Destination branch').selectOption('FACTORY');
    await main.getByLabel('Dispatch notes').fill('Pre-registered at the factory');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await main.getByRole('button', { name: 'Complete dispatch →' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/stock/units\\?q=${vin('FAC')}&saved=dispatch$`));

    // Its deal arrives later: dispatching the same VIN to a branch offers the move instead of a duplicate error.
    await page.goto('/admin/stock/dispatch');
    await expect(await findUnit(page, deal.number)).toHaveText(`Deal ${deal.label} · Model not recognised · Cape Town. Add or confirm the VIN and destination.`);
    await expect(main.getByText('Model not recognised on the DEAL: choose the model.')).toBeVisible();
    await expect(main.getByLabel('Destination branch').locator('option[value="FACTORY"]')).toBeDisabled();
    await main.getByLabel('Model / part number').selectOption('2500D');
    await main.getByRole('textbox', { name: 'VIN', exact: true }).fill(vin('FAC'));
    await main.getByRole('textbox', { name: 'VIN', exact: true }).press('Tab');
    await expect(page.getByTestId('vin-note')).toHaveText('This VIN is already registered at the Factory. Choose a destination branch to move it.');
    await main.getByRole('button', { name: 'Complete dispatch →' }).click();
    await expect(main.getByRole('alert')).toContainText('This VIN is already registered at the Factory. Move this factory unit to Cape Town instead.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await main.getByRole('button', { name: 'Move this factory unit to Cape Town' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/stock/units\\?q=${vin('FAC')}&saved=move$`));

    const [u] = await sql<{ id: string; location_id: string; deal_id: string; sequence: number; notes: string }>(
      `select id, location_id, deal_id, sequence, notes from public.stock_units where org_id = $1 and vin_norm = $2`, [ORG, vin('FAC')]);
    expect(u).toMatchObject({ location_id: 'CPT', deal_id: deal.id, sequence: deal.number, notes: 'Pre-registered at the factory' });
    expect(await dealStatus(deal.id)).toBe('dispatched');
    expect(await sql(`select 1 from public.audit_log where action = 'stock.move' and entity_id = $1`, [u.id])).toHaveLength(1);
  } finally {
    await sql(`update public.memberships set role = 'admin' where org_id = $1 and user_id = $2`, [ORG, ADMIN_ID]);
  }
});
