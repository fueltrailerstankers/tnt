import { expect, test, type APIRequestContext } from '@playwright/test';
import { attach, PDF, PNG, sign, signIn, sql } from './helpers';
import { E2E_XERO } from './xero-env';

// The whole trailer journey in one run (handoff build order): staff DEAL imported from the Xero mirror -> public
// Request For Invoice (blocked without payment, then accepted) -> Delivery Note in five signed steps -> thank-you
// pages -> the deal file links all of it. Synthetic mirror rows and entries under this run's own quote number;
// everything it creates is removed afterwards so specs that count rows are not affected. Nothing calls Xero.
test.describe.configure({ mode: 'serial' });

const ORG = '00000000-0000-0000-0000-000000000001';
const run = String(Date.now()).slice(-6);
const QNO = `66${run}`;
const QUOTE_ID = `e2e-journey-${run}`;
const TENANT = `journey-${run}`;
const VIN = `TTJOURNEY${run}VX`;
const CUSTOMER = { first: 'Journey', last: `Customer${run}` };

async function entryIds(): Promise<string[]> {
  const rows = await sql<{ id: string }>(
    `select e.id from entries e join forms f on f.id = e.form_id
      where f.org_id = $1 and ((f.slug = 'deal' and e.summary like $2) or (f.slug = 'request-for-invoice' and e.summary like $3)
         or (f.slug = 'delivery-note' and e.summary = $4))`,
    [ORG, `%${QNO}%`, `%${CUSTOMER.last}%`, VIN]);
  return rows.map((r) => r.id);
}

async function cleanup() {
  const ids = await entryIds();
  if (ids.length) await sql(`delete from entries where id = any($1::uuid[])`, [ids]);
  await sql(`delete from deal_files where org_id = $1 and quote_no = $2`, [ORG, QNO]);
  await sql(`delete from xero_quote_lines where quote_id = $1`, [QUOTE_ID]);
  await sql(`delete from xero_quotes where tenant_id = $1`, [TENANT]);
}

async function drainOutbox(request: APIRequestContext) {
  for (let i = 0; i < 10; i++) {
    const res = await request.post('/api/jobs/outbox', { headers: { Authorization: `Bearer ${E2E_XERO.JOB_SECRET}` } });
    expect(res.status()).toBe(200);
    const [{ n }] = await sql<{ n: string }>(`select count(*) as n from outbox_jobs where org_id = $1 and queue = 'deal-files.rebuild' and status = 'pending'`, [ORG]);
    if (Number(n) === 0) return;
  }
  throw new Error('deal-files.rebuild did not finish');
}

test.beforeAll(async () => {
  await cleanup();
  await sql(
    `insert into xero_quotes (org_id, tenant_id, quote_id, quote_number, quote_no, status, contact_name, quote_date, currency_code, total, raw)
     values ($1, $2, $3, $4, $5, 'ACCEPTED', 'Synthetic Journey Freight', '2026-10-01', 'ZAR', 125000, '{}')`,
    [ORG, TENANT, QUOTE_ID, `QU-${QNO}`, QNO]);
  await sql(
    `insert into xero_quote_lines (org_id, quote_id, line_no, item_code, description, quantity, unit_amount, line_amount, currency_code)
     values ($1, $2, 1, 'TT-45K', 'Fuel tanker 45 000 L', 1, 100000, 100000, 'ZAR'),
            ($1, $2, 2, 'BLK-KIT', 'Bottom-loading kit', 1, 25000, 25000, 'ZAR')`, [ORG, QUOTE_ID]);
});

test.afterAll(cleanup);

test('deal -> RFI -> delivery note -> deal file', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const startedAt = new Date().toISOString();

  // 1. Staff DEAL, imported from the Xero mirror.
  await signIn(page, '/admin/forms/deal/new');
  const main = page.getByRole('main');
  await main.getByRole('combobox', { name: 'QUOTE NO' }).fill(QNO);
  await main.getByRole('button', { name: 'Import from Xero' }).click();
  await expect(main.getByText(new RegExp(`Imported QU-${QNO} · 2 lines`))).toBeVisible();
  await expect(main.getByLabel('PART NO 1')).toHaveValue('TT-45K');
  await expect(main.getByLabel('Total')).toHaveValue('125000');
  await main.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/forms\/deal\/entries\/\d+\?saved=/, { timeout: 60_000 });

  // 2. Public Request For Invoice: blocked without a payment, then accepted with a deposit.
  const pub = await (await browser.newContext()).newPage();
  await pub.goto('/f/request-for-invoice');
  // Cognito rule: with neither a quote number nor a deposit, the form is refused.
  await pub.getByRole('button', { name: 'Submit' }).click();
  await expect(pub.getByText('NO PAYMENT LOADED FORM NOT SUBMITTED')).toBeVisible();
  await pub.getByLabel('Quote no').fill(QNO);
  await pub.getByLabel('First').fill(CUSTOMER.first);
  await pub.getByLabel('Last').fill(CUSTOMER.last);
  await attach(pub, '_1stDeposit', PDF);
  await pub.getByRole('button', { name: 'Submit' }).click();
  await expect(pub).toHaveURL(/\/f\/request-for-invoice\/thanks\?.*n=\d+/, { timeout: 60_000 });
  await expect(pub.getByRole('heading', { name: 'Thank you, we have your request' })).toBeVisible();
  await expect(pub.getByText(/RFI-\d+/)).toBeVisible();

  // 3. Public Delivery Note: five steps, each signed; the quote lookup links it to the RFI.
  await pub.goto('/f/delivery-note');
  await pub.getByLabel('Trailer Vin NO').fill(VIN);
  await pub.getByLabel('Quote no:').fill(QNO);
  await pub.getByRole('button', { name: 'Find' }).click();
  await expect(pub.getByTestId('customer-panel')).toContainText(`${CUSTOMER.first} C.`);
  const next = pub.getByRole('button', { name: 'Next' });
  await next.click();
  await expect(pub.getByRole('group', { name: 'Terms and warranty' })).toBeVisible();
  await pub.getByTestId('terms-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
  await expect(pub.getByText('Read to the end')).toBeVisible();
  await sign(pub, 'Signature4');
  await sign(pub, 'Signature');
  await next.click();
  await sign(pub, 'Signature2');
  await sign(pub, 'Signature3');
  await next.click();
  await sign(pub, 'SalesRepSignature');
  await next.click();
  await attach(pub, 'Pic1FRONT', PNG);
  await expect(pub.getByRole('heading', { name: 'Review' })).toBeVisible();
  await pub.getByRole('button', { name: 'Submit' }).click();
  // Server rules: the invoice number or VIN is required; the VIN is there, so only an email/VIN rule could block.
  await expect(pub).toHaveURL(/\/f\/delivery-note\/thanks\?.*n=\d+/, { timeout: 60_000 });
  await expect(pub.getByRole('heading', { name: 'Delivery signed. Safe travels.' })).toBeVisible();
  await expect(pub.getByText(/DN-\d+/)).toBeVisible();
  await pub.context().close();

  // 4. The deal file links all three (the rebuild job runs from the outbox).
  await sql(`insert into outbox_jobs (org_id, queue, payload) values ($1, 'deal-files.rebuild', '{}')`, [ORG]);
  await drainOutbox(page.request);
  const [file] = await sql<{ deal_entry_id: string | null; rfi_entry_id: string | null; delivery_entry_id: string | null }>(
    `select deal_entry_id, rfi_entry_id, delivery_entry_id from deal_files where org_id = $1 and quote_no = $2`, [ORG, QNO]);
  expect(file.deal_entry_id).toBeTruthy();
  expect(file.rfi_entry_id).toBeTruthy();
  expect(file.delivery_entry_id).toBeTruthy();

  await page.goto(`/admin/deal-files/${QNO}`);
  await expect(page.getByTestId('deal-header')).toContainText(`QU-${QNO}`);
  const step = (k: string) => page.getByTestId(`journey-step-${k}`);
  await expect(step('deal')).toHaveAttribute('data-state', 'done');
  await expect(step('rfi')).toHaveAttribute('data-state', 'done');
  await expect(step('rfi').getByRole('link', { name: /^Open / })).toHaveAttribute('href', /\/admin\/forms\/request-for-invoice\/entries\/\d+$/);
  await expect(step('delivery')).toHaveAttribute('data-state', 'done');

  // Nothing in the journey wrote to Xero: each form's Xero action is off by default and only logs a skipped run.
  const runs = await sql<{ mode: string; status: string }>(`select mode, status from xero_action_runs where org_id = $1 and created_at >= $2`, [ORG, startedAt]);
  for (const r of runs) expect(r).toEqual({ mode: 'off', status: 'skipped' });
});
