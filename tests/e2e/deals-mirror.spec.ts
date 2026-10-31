import { randomUUID } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn, sql } from './helpers';

// Redesigned Deal file and Xero mirror screens (UI handoff). Synthetic mirror rows, entries and a deal file under this
// run's own tenant id and quote numbers; nothing calls Xero. The tests share the seed and run in order.
test.describe.configure({ mode: 'serial' });

const ORG = '00000000-0000-0000-0000-000000000001';
const OTHER_ORG = '00000000-0000-0000-0000-0000000d0e01';
const ADMIN_ID = '00000000-0000-0000-0000-00000000a001';
const run = String(Date.now()).slice(-6);
const TENANT = `dm-${run}`;
const QNO = `77${run}`;
const QUOTE = { id: randomUUID(), number: `QU-${QNO}` };
const PAID = { id: randomUUID(), number: `INV-DM${run}` };
const OVERDUE = { id: randomUUID(), number: `INV-DO${run}` };
const OTHER = { id: randomUUID(), number: `QU-88${run}` };
const CUSTOMER = `Synthetic Agri Co-op ${run}`;
const VIN = `TT9DEMO24D${run}X`;
const FX_KEY = 'fx.zar_usd';
const SHOTS = process.env.DM_SCREENSHOT_DIR;

const entryIds: Record<string, string> = {};
let docSha = '';

async function formId(slug: string) {
  const [f] = await sql<{ id: string }>(`select id from forms where org_id = $1 and slug = $2`, [ORG, slug]);
  return f.id;
}

async function addEntry(slug: string, status: string, summary: string) {
  const [e] = await sql<{ id: string; number: number }>(
    `insert into entries(form_id, status, data, summary) values ($1, $2, '{}'::jsonb, $3) returning id, number`, [await formId(slug), status, summary]);
  return e;
}

async function cleanup() {
  await sql(`delete from deal_files where org_id = $1 and quote_no = $2`, [ORG, QNO]);
  await sql(`delete from xero_quote_lines where quote_id = any($1::text[])`, [[QUOTE.id, OTHER.id]]);
  await sql(`delete from xero_invoice_lines where invoice_id = any($1::text[])`, [[PAID.id, OVERDUE.id]]);
  await sql(`delete from xero_attachments where parent_id = $1`, [PAID.id]);
  await sql(`delete from xero_payments where invoice_id = $1`, [PAID.id]);
  await sql(`delete from xero_quotes where tenant_id = $1`, [TENANT]);
  await sql(`delete from xero_invoices where tenant_id = $1`, [TENANT]);
  const ids = Object.values(entryIds);
  if (ids.length) await sql(`delete from entries where id = any($1::uuid[])`, [ids]);
  await sql(`delete from app_settings where org_id = $1 and key = $2`, [ORG, FX_KEY]);
}

test.beforeAll(async () => {
  await cleanup();
  await sql(`insert into orgs(id, name) values ($1, 'Other Demo Org') on conflict (id) do nothing`, [OTHER_ORG]);
  await sql(
    `insert into xero_quotes(org_id, tenant_id, quote_id, quote_number, quote_no, reference, status, contact_name, quote_date, expiry_date, currency_code, sub_total, total_tax, total, raw)
     values ($1, $2, $3, $4, $5, $6, 'INVOICED', $7, '2026-10-20', '2026-11-19', 'ZAR', 423260.87, 63489.13, 486750.00, '{}')`,
    [ORG, TENANT, QUOTE.id, QUOTE.number, QNO, VIN, CUSTOMER]);
  for (const [n, code, desc, amt] of [[1, 'TT-45K-FT', 'Fuel tanker 45 000 L, tri-axle', 358260.87], [2, 'BLK-KIT-04', 'Bottom-loading kit', 65000], [3, 'DOC-RW-01', 'Roadworthy pack', 0]] as const) {
    await sql(`insert into xero_quote_lines(org_id, quote_id, line_no, item_code, description, quantity, unit_amount, line_amount, currency_code) values ($1, $2, $3, $4, $5, 1, $6, $6, 'ZAR')`,
      [ORG, QUOTE.id, n, code, desc, amt]);
  }
  // A quote in another org: never listed, never opened.
  await sql(
    `insert into xero_quotes(org_id, tenant_id, quote_id, quote_number, quote_no, status, contact_name, currency_code, total, raw)
     values ($1, $2, $3, $4, $5, 'SENT', $6, 'ZAR', 1, '{}')`, [OTHER_ORG, TENANT, OTHER.id, OTHER.number, `88${run}`, `Other Org Customer ${run}`]);

  await sql(
    `insert into xero_invoices(org_id, tenant_id, invoice_id, invoice_number, invoice_type, reference, status, contact_name, invoice_date, due_date, currency_code, sub_total, total_tax, total, amount_due, amount_paid, fully_paid_on, has_attachments, attachments_synced_at, raw)
     values ($1, $2, $3, $4, 'ACCREC', $5, 'PAID', $6, '2026-10-25', '2026-11-24', 'ZAR', 423260.87, 63489.13, 486750.00, 0, 486750.00, '2026-10-28', true, now(), '{}')`,
    [ORG, TENANT, PAID.id, PAID.number, QNO, CUSTOMER]);
  await sql(`insert into xero_invoice_lines(org_id, invoice_id, line_no, item_code, description, quantity, unit_amount, line_amount, currency_code) values ($1, $2, 1, 'TT-45K-FT', 'Fuel tanker', 1, 423260.87, 423260.87, 'ZAR')`, [ORG, PAID.id]);
  await sql(`insert into xero_payments(org_id, tenant_id, payment_id, invoice_id, invoice_number, payment_date, amount, currency_code, status, payment_type, reference, raw) values ($1, $2, $3, $4, $5, '2026-10-28', 486750.00, 'ZAR', 'AUTHORISED', 'ACCRECPAYMENT', 'EFT', '{}')`,
    [ORG, TENANT, randomUUID(), PAID.id, PAID.number]);
  await sql(`insert into xero_attachments(org_id, attachment_id, parent_type, parent_id, file_name, mime_type, content_length, raw) values ($1, $2, 'Invoice', $3, $4, 'application/pdf', 20480, '{}')`,
    [ORG, randomUUID(), PAID.id, `${PAID.number}.pdf`]);
  await sql(
    `insert into xero_invoices(org_id, tenant_id, invoice_id, invoice_number, invoice_type, reference, status, contact_name, invoice_date, due_date, currency_code, sub_total, total_tax, total, amount_due, raw)
     values ($1, $2, $3, $4, 'ACCREC', 'none', 'AUTHORISED', $5, '2026-09-18', '2026-10-01', 'ZAR', 56086.96, 8413.04, 64500.00, 64500.00, '{}')`,
    [ORG, TENANT, OVERDUE.id, OVERDUE.number, `Synthetic Logistics ${run}`]);

  // Entries (plain forms only; metadata is all the deal file reads). No Deal entry: that step shows as a gap.
  const rfi = await addEntry('request-for-invoice', 'Submitted', `Dealview Customer ${run}`);
  const ins = await addEntry('trailer-inspection-checklist', 'Approved', VIN);
  const rel = await addEntry('release-form', 'Submitted', VIN);
  Object.assign(entryIds, { rfi: rfi.id, ins: ins.id, rel: rel.id });
  await sql(`insert into entry_events(entry_id, action, from_status, to_status, actor_user, actor_role, diff, created_at) values
    ($1, 'Submit', null, 'Submitted', null, 'Public', '{"changed":[]}', '2026-10-25T06:52:00Z'),
    ($2, 'Submit', null, 'Submitted', null, 'Inspector', '{"changed":[]}', '2026-10-27T14:40:00Z'),
    ($2, 'Approve', 'Submitted', 'Approved', $4, 'Internal', '{"changed":[]}', '2026-10-28T08:15:00Z'),
    ($3, 'Submit', null, 'Submitted', null, 'System', '{"changed":[]}', '2026-10-28T11:20:00Z')`, [rfi.id, ins.id, rel.id, ADMIN_ID]);
  docSha = 'c80d' + 'ab'.repeat(28) + '5b19';
  await sql(`insert into entry_documents(entry_id, template_number, storage_path, name, sha256, created_at) values ($1, 1, $2, 'Inspection.pdf', $3, '2026-10-28T08:15:00Z')`,
    [ins.id, `synthetic/${run}/inspection-v1.pdf`, docSha]);

  await sql(
    `insert into deal_files(org_id, quote_no, quote_id, invoice_ids, invoice_numbers, vin, customer_name, branch, rep, rfi_entry_id, inspection_entry_id, release_entry_id)
     values ($1, $2, $3, $4, $5, $6, $7, 'Cape Town', 'Demo Rep', $8, $9, $10)`,
    [ORG, QNO, QUOTE.id, [PAID.id], [PAID.number], VIN, CUSTOMER, rfi.id, ins.id, rel.id]);
});

test.afterAll(async () => {
  await cleanup();
  await sql(`delete from xero_quotes where org_id = $1 and tenant_id = $2`, [OTHER_ORG, TENANT]);
});

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function axe(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.length} e.g. ${v.nodes[0]?.target.join(' ')}`), label).toEqual([]);
}

const actionRuns = async () => (await sql<{ n: number }>(`select count(*)::int as n from xero_action_runs`))[0].n;
let runsBefore = 0;

test('quotes: read-only table with chips and ZAR; the row opens a drawer that Back and Escape close', async ({ page }) => {
  runsBefore = await actionRuns();
  await signIn(page);
  await page.goto(`/admin/xero/quotes?q=${QUOTE.number}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { level: 1, name: 'Quotes' })).toBeVisible();
  await expect(main).toContainText('Read-only mirror of Xero');
  await expect(page.getByTestId('last-synced')).toContainText('Last synced');
  const table = page.getByTestId('quotes-table');
  const row = table.getByRole('row').filter({ hasText: QUOTE.number });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Invoiced');
  await expect(row).toContainText('R 486,750.00');
  await expect(row).toContainText('ZAR');
  // Another org's quote is never listed.
  await page.goto(`/admin/xero/quotes?q=${OTHER.number}`);
  await expect(page.getByTestId('quotes-table')).not.toContainText(OTHER.number);
  await page.goto(`/admin/xero/quotes?id=${OTHER.id}`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('not in the mirror');

  await page.goto(`/admin/xero/quotes?q=${QUOTE.number}`);
  await page.getByRole('link', { name: QUOTE.number }).click();
  await expect(page).toHaveURL(new RegExp(`id=${QUOTE.id}`));
  const dialog = page.getByRole('dialog', { name: QUOTE.number });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close details' })).toBeFocused();
  await expect(dialog.getByTestId('mirror-lines').getByRole('listitem')).toHaveCount(3);
  const totals = dialog.getByTestId('mirror-totals');
  await expect(totals).toContainText('Subtotal');
  await expect(totals).toContainText('R 423,260.87');
  await expect(totals).toContainText('VAT 15%');
  await expect(totals).toContainText('R 63,489.13');
  await expect(totals).toContainText('R 486,750.00');
  await expect(totals).not.toContainText('USD'); // no fx.zar_usd setting: no USD line
  await expect(dialog.getByRole('link', { name: /Open in Xero/ })).toHaveAttribute('href', new RegExp(`^https://go\\.xero\\.com/.*${QUOTE.id}`));
  await expect(dialog.getByRole('link', { name: /Open in Xero/ })).toHaveAttribute('target', '_blank');
  await expect(dialog.getByRole('link', { name: 'Go to deal file' })).toHaveAttribute('href', `/admin/deal-files/${QNO}`);
  await shot(page, 'quotes-drawer-1440-light');

  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/admin/xero/quotes\\?q=${QUOTE.number}$`));

  await page.getByRole('link', { name: QUOTE.number }).click();
  await expect(page.getByRole('dialog', { name: QUOTE.number })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/admin/xero/quotes\\?q=${QUOTE.number}$`));
});

test('quotes: the ≈ USD line comes from app_settings fx.zar_usd only', async ({ page }) => {
  await sql(`insert into app_settings(org_id, key, value) values ($1, $2, $3::jsonb) on conflict (org_id, key) do update set value = excluded.value`, [ORG, FX_KEY, JSON.stringify('0.05')]);
  try {
    await signIn(page);
  await page.goto(`/admin/xero/quotes?id=${QUOTE.id}`);
    const totals = page.getByRole('dialog', { name: QUOTE.number }).getByTestId('mirror-totals');
    await expect(totals).toContainText('≈ USD');
    await expect(totals).toContainText('$24,337.50');
    // A malformed rate shows nothing rather than a wrong figure.
    await sql(`update app_settings set value = $3::jsonb where org_id = $1 and key = $2`, [ORG, FX_KEY, JSON.stringify(-1)]);
    await page.reload();
    await expect(page.getByRole('dialog', { name: QUOTE.number }).getByTestId('mirror-totals')).not.toContainText('USD');
  } finally {
    await sql(`delete from app_settings where org_id = $1 and key = $2`, [ORG, FX_KEY]);
  }
});

test('invoices: overdue chip and filter, drawer with payments and attachments, deep link opens the drawer', async ({ page }) => {
  await signIn(page);
  await page.goto(`/admin/xero/invoices?q=${run}`);
  const table = page.getByTestId('invoices-table');
  await expect(table.getByRole('row').filter({ hasText: PAID.number })).toContainText('Paid');
  await expect(table.getByRole('row').filter({ hasText: OVERDUE.number })).toContainText('Overdue');

  await page.getByRole('group', { name: 'Filter by status' }).getByRole('link', { name: 'Overdue' }).click();
  await expect(page).toHaveURL(new RegExp(`q=${run}&status=OVERDUE`));
  await expect(page.getByTestId('invoices-table').getByRole('row').filter({ hasText: OVERDUE.number })).toHaveCount(1);
  await expect(page.getByTestId('invoices-table')).not.toContainText(PAID.number);
  // The search keeps the status filter.
  await page.getByRole('search', { name: 'Search invoices' }).getByRole('searchbox').fill(OVERDUE.number);
  await page.getByRole('search', { name: 'Search invoices' }).getByRole('button', { name: 'Search' }).click();
  await expect(page).toHaveURL(/status=OVERDUE/);

  // Deep link from other pages (leads, stock, activity): /admin/xero/invoices/<id> opens the drawer.
  await page.goto(`/admin/xero/invoices/${PAID.id}`);
  await expect(page).toHaveURL(new RegExp(`/admin/xero/invoices\\?id=${PAID.id}$`));
  const dialog = page.getByRole('dialog', { name: PAID.number });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('invoice-payments')).toContainText('R 486,750.00');
  await expect(dialog.getByTestId('invoice-attachments')).toContainText(`${PAID.number}.pdf`);
  await expect(dialog.getByTestId('mirror-totals')).toContainText('Amount due');
  await expect(dialog.getByRole('link', { name: /Open in Xero/ })).toHaveAttribute('href', `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${PAID.id}`);
  await shot(page, 'invoices-drawer-1440-light');
  await dialog.getByRole('link', { name: 'Go to deal file' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/deal-files/${QNO}$`));

  expect((await page.goto(`/admin/xero/quotes/${OTHER.id}`))?.status()).toBe(404);
  expect((await page.goto('/admin/xero/invoices/not..an..id'))?.status()).toBe(404);
});

test('deal file: header, journey, Xero panel and documents', async ({ page }) => {
  await signIn(page);
  await page.goto(`/admin/deal-files?q=${QUOTE.number}`);
  await page.getByTestId('deal-files-table').getByRole('link', { name: QUOTE.number }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/deal-files/${QNO}$`));
  // The QU- form of the route lands on the canonical one.
  await page.goto(`/admin/deal-files/${QUOTE.number}`);
  await expect(page).toHaveURL(new RegExp(`/admin/deal-files/${QNO}$`));

  const header = page.getByTestId('deal-header');
  await expect(header.getByRole('heading', { level: 1 })).toHaveText(CUSTOMER);
  for (const t of [QUOTE.number, PAID.number, VIN, 'Cape Town', 'Demo Rep']) await expect(header).toContainText(t);
  await expect(page.getByTestId('deal-status')).toHaveText('At Delivery');

  const step = (k: string) => page.getByTestId(`journey-step-${k}`);
  await expect(step('deal')).toHaveAttribute('data-state', 'todo');
  await expect(step('deal')).toContainText('Not linked');
  await expect(step('rfi')).toHaveAttribute('data-state', 'done');
  await expect(step('rfi')).toContainText('Public link');
  await expect(step('rfi')).toContainText('25 Oct 2026, 08:52 SAST');
  await expect(step('inspection')).toContainText('Approved');
  await expect(step('inspection')).toContainText('Test Admin');
  await expect(step('release')).toContainText('Auto-created from Xero');
  await expect(step('delivery')).toHaveAttribute('data-state', 'current');
  await expect(step('delivery')).toHaveAttribute('aria-current', 'step');
  await expect(step('delivery')).toContainText('Awaiting delivery note');
  await expect(step('rfi').getByRole('link', { name: /^Open / })).toHaveAttribute('href', /\/admin\/forms\/request-for-invoice\/entries\/\d+$/);

  const xero = page.getByTestId('deal-xero');
  await expect(xero.getByRole('list', { name: 'Quote progress' })).toContainText('Invoiced (reached)');
  await expect(xero).toContainText('R 486,750.00');
  await expect(xero).toContainText('R 0.00');
  await expect(xero).toContainText('28 Oct 2026');
  await expect(xero.getByRole('link', { name: /Open invoice detail/ })).toHaveAttribute('href', `/admin/xero/invoices?id=${PAID.id}`);

  const docs = page.getByTestId('deal-documents');
  await expect(docs).toContainText('v1');
  await expect(docs).toContainText(`sha256 ${docSha.slice(0, 4)}…${docSha.slice(-4)}`);
  await expect(docs.getByRole('link', { name: /^Download / })).toHaveAttribute('href', /\/documents\/1\?version=/);
  await shot(page, 'deal-1440-light');

  // Nothing here wrote to Xero.
  expect(await actionRuns()).toBe(runsBefore);
});

for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`no WCAG AA violations at ${w}px ${scheme}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await signIn(page);
  await page.goto(`/admin/deal-files/${QNO}`);
      await expect(page.getByTestId('deal-journey')).toBeVisible();
      await axe(page, `deal file ${w} ${scheme}`);
      await shot(page, `deal-${w}-${scheme}`);
      await page.goto(`/admin/deal-files?q=${QNO}`);
      await axe(page, `deal files ${w} ${scheme}`);
      await page.goto(`/admin/xero/quotes?q=${QUOTE.number}&id=${QUOTE.id}`);
      await expect(page.getByRole('dialog')).toBeVisible();
      await axe(page, `quote drawer ${w} ${scheme}`);
      await shot(page, `quotes-drawer-${w}-${scheme}`);
      await page.goto(`/admin/xero/invoices?q=${run}`);
      await axe(page, `invoices ${w} ${scheme}`);
      await shot(page, `invoices-${w}-${scheme}`);
      // No sideways page scroll on phones.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
}
