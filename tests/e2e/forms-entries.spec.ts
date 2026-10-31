import { createCipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn, sql } from './helpers';

// Forms index and entries grid (UI handoff FormsIndex.dc.html, Entries.dc.html). The e2e database is shared:
// every row here carries this run's id and the grid is always filtered by it. Synthetic data only.
const run = `fe${Date.now().toString(36)}`;
const RUN = run.toUpperCase();
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
/** Test-only key from playwright.config (32 bytes of 0x07), so a sealed DEAL row looks exactly like a real one. */
const ENTRY_KEY = Buffer.alloc(32, 7);
const SECRET = `SECRET-${RUN}`;

function seal(value: unknown, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', ENTRY_KEY, iv);
  c.setAAD(Buffer.from(aad));
  const body = Buffer.concat([c.update(Buffer.from(JSON.stringify(value))), c.final()]);
  return `\\x${Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), body]).toString('hex')}`;
}

async function releaseEntry(n: number, status = 'Submitted') {
  const [e] = await sql<{ id: string; number: number }>(
    `insert into entries(form_id, number, status, data, summary, submitted_at)
     select id, 0, $3, jsonb_build_object('VINNO', $1::text, 'INVNO', $2::text), $1::text, now() from forms where slug = 'release-form'
     returning id, number`, [`${RUN}VIN${n}`, `INV-${RUN}-${n}`, status]);
  return e;
}

async function sealedDeal() {
  const [e] = await sql<{ id: string; number: number }>(
    `insert into entries(form_id, number, status, data, summary, submitted_at)
     select id, 0, 'Submitted', '{}'::jsonb, $1::text, now() from forms where slug = 'deal' returning id, number`, [`Deal · ${RUN}`]);
  await sql(`update entries set data_encrypted = decode(substr($2, 3), 'hex') where id = $1`, [e.id, seal({ QuoteNo: SECRET, SalesRep: SECRET }, e.id)]);
  return e;
}

const noSideScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test.describe('desktop (1440)', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('Forms index: cards with access, encrypted and auto badges, counts, flags, New entry and the public link modal', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const [sr] = await sql<{ id: string }>(
      `insert into entries(form_id, number, status, data, summary, submitted_at)
       select id, 0, 'APPROVAL', '{}'::jsonb, $1::text, now() from forms where slug = 'store-room' returning id`, [`Store ${RUN}`]);
    expect(sr.id).toBeTruthy();

    await signIn(page, '/admin/forms');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1, name: 'Forms' })).toBeVisible();
    await expect(main.getByText(/^\d+ forms · [\d,]+ entr(y|ies) · [\d,]+ unread$/)).toBeVisible();

    const deal = page.getByTestId('form-card-deal');
    await expect(deal.getByRole('heading', { name: 'Deal' })).toBeVisible();
    await expect(deal).toContainText('Encrypted');
    await expect(deal.getByRole('link', { name: 'New entry in Deal' })).toHaveAttribute('href', '/admin/forms/deal/new');
    await expect(page.getByTestId('form-card-release-form')).toContainText('Auto-created from Xero');
    await expect(page.getByTestId('form-card-store-room')).toContainText(/\d+ APPROVAL/);
    await expect(page.getByTestId('form-card-delivery-note')).toContainText('Encrypted');
    // Builder and import entry points stay on the page (M8).
    await expect(main.getByRole('link', { name: 'New form' })).toHaveAttribute('href', '/admin/forms/new');
    await expect(main.getByRole('link', { name: 'Import from Cognito' })).toHaveAttribute('href', '/admin/forms/import');
    await expect(page.getByTestId('form-card-job-card').getByRole('link', { name: 'Design' })).toHaveAttribute('href', '/admin/forms/job-card/design');

    // Public link modal: the link, Copy link (announced), Escape closes and focus goes back to the button.
    const rfi = page.getByTestId('form-card-request-for-invoice');
    const open = rfi.getByRole('button', { name: 'Public link for Request for Invoice' });
    await open.click();
    const dialog = page.getByRole('dialog', { name: 'Request for Invoice · public link' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('textbox', { name: 'Public link' })).toHaveValue(/^http:\/\/127\.0\.0\.1:\d+\/f\/request-for-invoice$/);
    await dialog.getByRole('button', { name: 'Copy link' }).click();
    await expect(dialog.getByRole('status')).toHaveText('Link copied.');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/f\/request-for-invoice$/);
    await expect(dialog.getByRole('link', { name: /Open form/ })).toHaveAttribute('href', '/f/request-for-invoice');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(open).toBeFocused();

    // A card title opens its grid.
    await page.getByTestId('form-card-release-form').getByRole('link', { name: 'Release Form', exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/forms\/release-form$/, { timeout: 30_000 }); // first compile in dev
    await expect(main.getByRole('heading', { level: 1, name: 'Release Form entries' })).toBeVisible();
  });

  test('Grid: chips with counts, bulk read/unread, export selected, columns, saved views, date range, empty state', async ({ page }) => {
    test.setTimeout(150_000); // several first compiles in next dev
    const rows = [await releaseEntry(1), await releaseEntry(2), await releaseEntry(3)];
    await signIn(page, '/admin/forms/release-form');
    await page.goto(`/admin/forms/release-form?q=${run}`);
    await page.waitForLoadState('networkidle');
    const main = page.getByRole('main');
    const chips = main.getByRole('group', { name: 'Filter by status' });
    await expect(chips.getByRole('link', { name: 'All entries · 3' })).toHaveAttribute('aria-current', 'page');
    await expect(chips.getByRole('link', { name: 'Unread · 3' })).toBeVisible();
    await expect(chips.getByRole('link', { name: 'Submitted · 3' })).toBeVisible();
    await expect(main.getByText('Showing 1–3 of 3')).toBeVisible();
    // Unread rows carry a named dot (status is never colour alone).
    await expect(page.getByTestId(`entry-${rows[0].number}`).getByRole('img', { name: 'Unread' })).toBeVisible();

    // Select all -> Mark read: the bulk bar counts, the action finishes before the counts move.
    await main.getByRole('checkbox', { name: 'Select all on this page' }).first().check();
    const bar = main.getByRole('region', { name: 'Bulk actions' });
    await expect(bar).toContainText('3 selected');
    await bar.getByRole('button', { name: 'Mark read' }).click();
    await expect(chips.getByRole('link', { name: 'Unread · 0' })).toBeVisible({ timeout: 15_000 });
    await expect(bar).toHaveCount(0);
    await expect(page.getByTestId(`entry-${rows[0].number}`).getByRole('img', { name: 'Read' })).toBeVisible();

    await main.getByRole('checkbox', { name: `Select entry ${rows[1].number}` }).first().check();
    await bar.getByRole('button', { name: 'Mark unread' }).click();
    await expect(chips.getByRole('link', { name: 'Unread · 1' })).toBeVisible();

    // Export selected: only the chosen rows.
    await main.getByRole('checkbox', { name: `Select entry ${rows[0].number}` }).first().check();
    await main.getByRole('checkbox', { name: `Select entry ${rows[2].number}` }).first().check();
    const download = page.waitForEvent('download');
    await bar.getByRole('link', { name: 'Export selected' }).click();
    const csv = readFileSync(await (await download).path(), 'utf8');
    expect(csv).toContain(`${RUN}VIN1`);
    expect(csv).toContain(`${RUN}VIN3`);
    expect(csv).not.toContain(`${RUN}VIN2`);
    await bar.getByRole('button', { name: 'Clear' }).click();
    await expect(bar).toHaveCount(0);

    // Columns: show only INV NO, then Apply keeps the search.
    await main.getByText('Columns', { exact: true }).click();
    const picker = main.getByRole('group', { name: 'Visible columns' });
    for (const box of await picker.getByRole('checkbox').all()) if (await box.isEnabled() && await box.isChecked()) await box.uncheck();
    await picker.getByRole('checkbox', { name: 'INV NO' }).check();
    await picker.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/q=fe.*cols=INVNO/);
    await expect(main.getByRole('columnheader', { name: 'INV NO' })).toBeVisible();
    await expect(page.getByTestId(`entry-${rows[0].number}`)).toContainText(`INV-${RUN}-1`);

    // Save view: stored for this member, selected after saving, and found again on reload; Delete view removes it.
    // Apply is a full GET navigation: wait for the page to hydrate before using its client controls.
    await page.waitForLoadState('networkidle');
    await main.getByRole('button', { name: 'Save view' }).click();
    const save = page.getByRole('dialog', { name: 'Save view' });
    await save.getByLabel('View name').fill(`Run ${RUN}`);
    await save.getByRole('button', { name: 'Save view' }).click();
    await expect(save).toHaveCount(0);
    const select = main.getByLabel('View', { exact: true });
    await expect(select.locator('option:checked')).toHaveText(`Run ${RUN}`);
    expect((await sql(`select query from saved_views where name = $1`, [`Run ${RUN}`]))[0].query).toMatchObject({ q: run, cols: ['INVNO'] });
    await page.goto('/admin/forms/release-form');
    await page.waitForLoadState('networkidle');
    await select.selectOption({ label: `Run ${RUN}` });
    await expect(page).toHaveURL(new RegExp(`q=${run}`));
    await expect(main.getByText('Showing 1–3 of 3')).toBeVisible();
    await main.getByRole('button', { name: 'Delete view' }).click();
    await expect(page).toHaveURL(/\/admin\/forms\/release-form$/);
    await expect(select.locator('option', { hasText: `Run ${RUN}` })).toHaveCount(0);
    expect(await sql(`select 1 from saved_views where name = $1`, [`Run ${RUN}`])).toHaveLength(0);

    // Date range in the future: the empty state, with a way back.
    await page.goto(`/admin/forms/release-form?q=${run}`);
    await main.getByLabel('From').fill('2099-01-01');
    await main.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveURL(/from=2099-01-01/);
    await expect(main.getByText('No entries.')).toBeVisible();
    await main.getByRole('link', { name: 'Clear filters' }).click();
    await expect(page).toHaveURL(/\/admin\/forms\/release-form$/);

    // Form tabs switch forms; the encrypted ones say so.
    await expect(main.getByRole('navigation', { name: 'Forms' }).getByRole('link', { name: 'Deal (encrypted)' })).toHaveAttribute('href', '/admin/forms/deal');
  });

  test('Encrypted grid: number, summary, created and status only; columns locked; banner; export never decrypts', async ({ page }) => {
    const e = await sealedDeal();
    await signIn(page, '/admin/forms/deal');
    await page.goto(`/admin/forms/deal?q=${run}&cols=QuoteNo,SalesRep`);
    const main = page.getByRole('main');
    await expect(main.getByText(/^Encrypted form\. The grid lists only number, summary, created and status\./)).toBeVisible();
    const headers = (await main.getByRole('columnheader').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    expect(headers).toEqual(['#', 'Summary', 'Created', 'Status']);
    await expect(page.getByTestId(`entry-${e.number}`)).toContainText(`Deal · ${RUN}`);
    expect(await page.content()).not.toContain(SECRET);

    await main.getByText('Columns', { exact: true }).click();
    const picker = main.getByRole('group', { name: 'Columns are locked' });
    await expect(picker).toContainText('Encrypted form: the grid lists only number, summary, created and status.');
    for (const box of await picker.getByRole('checkbox').all()) await expect(box).toBeDisabled();

    const csv = await (await page.request.get(`/admin/forms/deal/export?format=csv&q=${run}`)).text();
    expect(csv).toContain('Entry Number,Status,Created,Updated,Summary');
    expect(csv).toContain(`Deal · ${RUN}`);
    expect(csv).not.toContain(SECRET);
    const sel = await (await page.request.get(`/admin/forms/deal/export?format=csv&sel=${e.number}`)).text();
    expect(sel).not.toContain(SECRET);
    expect((await page.request.get(`/admin/forms/deal/export?format=csv&sel=nope`)).status()).toBe(400);
  });
});

test.describe('phone (390)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('single column cards, 44px targets, no sideways scroll', async ({ page }) => {
    const e = await releaseEntry(9);
    await signIn(page, '/admin/forms');
    await noSideScroll(page);
    const newEntry = page.getByTestId('form-card-job-card').getByRole('link', { name: 'New entry in Job Card' });
    expect((await newEntry.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await page.goto(`/admin/forms/release-form?q=${run}`);
    await noSideScroll(page);
    const card = page.getByTestId(`entry-card-${e.number}`);
    await expect(card).toBeVisible();
    await expect(page.getByTestId(`entry-${e.number}`)).toBeHidden();
    const link = card.getByRole('link', { name: `${RUN}VIN9` });
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const box = card.getByRole('checkbox', { name: `Select entry ${e.number}` });
    const hit = (await box.locator('xpath=..').boundingBox())!;
    expect(Math.min(hit.width, hit.height)).toBeGreaterThanOrEqual(44);
    await box.check();
    const apply = page.getByRole('main').getByRole('button', { name: 'Apply' });
    expect((await apply.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toContainText('1 selected');
  });
});

for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`axe ${w}px ${scheme}`, () => {
      test.use({ viewport: { width: w, height: h }, colorScheme: scheme });

      test('forms index and grids have no WCAG AA violations', async ({ page }) => {
        test.setTimeout(120_000);
        await signIn(page, '/admin/forms');
        for (const path of ['/admin/forms', '/admin/forms/release-form', '/admin/forms/deal', `/admin/forms/release-form?q=${run}-none`]) {
          await page.goto(path);
          await page.waitForLoadState('networkidle');
          // The page content (main); the shell has its own checks.
          const { violations } = await new AxeBuilder({ page }).include('main').withTags(TAGS).analyze();
          const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) e.g. ${v.nodes[0]?.target.join(' ')}`);
          expect(summary, `${path} at ${w}px ${scheme}\n${summary.join('\n')}`).toEqual([]);
        }
      });
    });
  }
}
