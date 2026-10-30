import { expect, test } from '@playwright/test';
import { ADMIN, sql } from './helpers';

// Xero quote picker on quote fields. Synthetic mirror rows only (no real customers).
const ORG = '00000000-0000-0000-0000-000000000001';
const QUOTES = [
  { id: 'e2e-qp-1', no: '880011', customer: 'Synthetic Freight One', date: '2026-01-10', total: 125000 },
  { id: 'e2e-qp-2', no: '880012', customer: 'Synthetic Freight Two', date: '2026-02-10', total: 99000.5 },
  { id: 'e2e-qp-3', no: '770001', customer: 'Example Tankers Test', date: '2026-03-10', total: 5000 },
];

test.beforeAll(async () => {
  await sql(`delete from xero_quotes where org_id = $1 and quote_id like 'e2e-qp-%'`, [ORG]);
  for (const q of QUOTES) {
    await sql(
      `insert into xero_quotes (org_id, tenant_id, quote_id, quote_number, quote_no, status, contact_name, quote_date, currency_code, total, raw)
       values ($1, 't', $2, $3, $4, 'SENT', $5, $6, 'ZAR', $7, '{}')`,
      [ORG, q.id, `QU-${q.no}`, q.no, q.customer, q.date, q.total]);
  }
});

test.afterAll(async () => {
  await sql(`delete from xero_quotes where org_id = $1 and quote_id like 'e2e-qp-%'`, [ORG]);
});

test('staff: search by number, pick a suggestion, the field holds the bare number', async ({ page }) => {
  // Signed in inline with a longer wait: on a cold dev server the first admin page can take a while to compile.
  await page.goto(`/login?next=${encodeURIComponent('/admin/forms/request-for-invoice/new')}`);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/forms\/request-for-invoice\/new$/, { timeout: 60_000 });
  const box = page.getByRole('combobox', { name: 'Quote no' });
  await box.fill('8800');
  const list = page.getByRole('listbox', { name: 'Xero quotes' });
  await expect(list.getByRole('option')).toHaveCount(2);
  // Newest first.
  await expect(list.getByRole('option').first()).toContainText('QU-880012 · Synthetic Freight Two · SENT ·');
  await expect(list.getByRole('option').first()).toContainText('ZAR');
  await list.getByRole('option', { name: /QU-880011/ }).click();
  await expect(box).toHaveValue('880011');
  await expect(list).toBeHidden();
  await expect(page.getByText('Not found in Xero')).toHaveCount(0);

  // Keyboard: search by customer name, arrow down, Enter picks; Escape closes.
  await box.fill('Example Tank');
  await expect(list.getByRole('option')).toHaveCount(1);
  await box.press('ArrowDown');
  await expect(box).toHaveAttribute('aria-activedescendant', /.+/);
  await box.press('Enter');
  await expect(box).toHaveValue('770001');
  await box.fill('8800');
  await expect(list).toBeVisible();
  await box.press('Escape');
  await expect(list).toBeHidden();

  // Free typing still works, with a hint when Xero has no such quote.
  await box.fill('919191');
  await expect(page.getByText('Not found in Xero')).toBeVisible();
  await expect(box).toHaveValue('919191');
});

test('public: Check says found or not found, and never shows quotes or customers', async ({ page }) => {
  await page.goto('/f/job-card');
  await expect(page.getByRole('combobox')).toHaveCount(0);
  const input = page.getByLabel('Quote no');
  await input.fill('880011');
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('Quote found')).toBeVisible();
  await expect(page.getByText('Synthetic Freight One')).toHaveCount(0);

  await input.fill('919191');
  await expect(page.getByText('Quote found')).toHaveCount(0);
  await page.getByRole('button', { name: 'Check' }).click();
  await expect(page.getByText('Not found in Xero (you can still submit)')).toBeVisible();

  // Never blocks submission.
  await page.getByLabel('Line 1').fill('Synthetic quote picker line');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Thank you for filling out the form. Your response has been recorded.')).toBeVisible();
  const rows = await sql<{ data: Record<string, unknown> }>(
    `select e.data from entries e join forms f on f.id = e.form_id where f.slug = 'job-card' and e.summary = '919191'`);
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect(r.data.QuoteNo).toBe('919191');
});

test('staff DEAL: Import from Xero fills the lines and total from the mirrored quote', async ({ page }) => {
  await sql(`delete from xero_quote_lines where org_id = $1 and quote_id = 'e2e-qp-1'`, [ORG]);
  await sql(
    `insert into xero_quote_lines (org_id, quote_id, line_no, item_code, description, quantity, unit_amount, line_amount, currency_code)
     values ($1, 'e2e-qp-1', 1, 'TT-45K', 'Fuel tanker 45 000 L', 1, 100000, 100000, 'ZAR'),
            ($1, 'e2e-qp-1', 2, 'BLK-KIT', 'Bottom-loading kit', 1, 25000, 25000, 'ZAR')`, [ORG]);
  await page.goto(`/login?next=${encodeURIComponent('/admin/forms/deal/new')}`);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/forms\/deal\/new$/, { timeout: 60_000 });

  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Import from Xero' }).click();
  await expect(main.getByText('Type a quote number first.')).toBeVisible();

  await main.getByRole('combobox', { name: 'QUOTE NO' }).fill('880011');
  await main.getByRole('button', { name: 'Import from Xero' }).click();
  await expect(main.getByText(/Imported QU-880011 · 2 lines · total/)).toBeVisible();
  await expect(main.getByLabel('PART NO 1')).toHaveValue('TT-45K');
  await expect(main.getByLabel('LINE 1', { exact: true })).toHaveValue('Fuel tanker 45 000 L');
  await expect(main.getByLabel('PART NO 2')).toHaveValue('BLK-KIT');
  await expect(main.getByLabel('LINE 3')).toHaveValue('');
  await expect(main.getByLabel('Total')).toHaveValue('125000');

  await main.getByRole('combobox', { name: 'QUOTE NO' }).fill('990099');
  await main.getByRole('button', { name: 'Import from Xero' }).click();
  await expect(main.getByText('QU-990099 is not in the Xero mirror yet.')).toBeVisible();
  await sql(`delete from xero_quote_lines where org_id = $1 and quote_id = 'e2e-qp-1'`, [ORG]);
});
