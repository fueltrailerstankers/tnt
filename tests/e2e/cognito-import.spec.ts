import { expect, test, type APIRequestContext } from '@playwright/test';
import { COGNITO_KEY, COGNITO_URL } from './cognito-env';
import { signIn, sql } from './helpers';
import { E2E_XERO } from './xero-env';

// In-app Cognito import against tests/e2e/mock-cognito.mjs (synthetic entries, one with a PDF) and the Supabase
// stub: save key, test connection, dry run, import, re-run imports nothing new, stop/resume an "All forms" run,
// remove the key. Entry numbers are seeded above the platform's own, and everything imported is removed at the end
// so other specs see the database as before.
test.describe.configure({ mode: 'serial' });

const ORG = '00000000-0000-0000-0000-000000000001';
const PAGE = '/admin/forms/import';
let base = 0;
let counterBefore: number | null = null;

const mock = async (request: APIRequestContext, path: string, body: unknown = {}) => {
  const res = await request.post(`${COGNITO_URL}${path}`, { data: body });
  expect(res.ok()).toBe(true);
};
const cognitoLog = async (request: APIRequestContext) =>
  (await (await request.get(`${COGNITO_URL}/__log`)).json()) as Array<{ method: string; path: string; authed: boolean }>;
const job = (request: APIRequestContext) =>
  request.post('/api/jobs/cognito-import', { headers: { Authorization: `Bearer ${E2E_XERO.JOB_SECRET}` }, data: {} });

type Run = { id: string; form_slug: string; mode: string; status: string; report: Record<string, unknown>; batch_id: string | null };
const runs = () => sql<Run>(`select id, form_slug, mode, status, report, batch_id from import_runs where org_id = $1 order by created_at desc, seq desc`, [ORG]);

/** Drives the job queue until every run matching `done` is finished (the scheduler does this every minute in production). */
async function drive(request: APIRequestContext, until: (rs: Run[]) => boolean) {
  for (let i = 0; i < 40; i++) {
    if (until(await runs())) return;
    const res = await job(request);
    expect(res.status()).toBe(200);
  }
  throw new Error('import runs did not finish');
}

/** Runs of the most recent "All forms" set. */
const latestBatch = (rs: Run[]) => {
  const id = rs.find((r) => r.batch_id)?.batch_id;
  return id ? rs.filter((r) => r.batch_id === id) : [];
};

const rfiIds = () => [1, 2, 4].map((i) => `4-${base + i}`);

test.beforeAll(async ({ request }) => {
  await mock(request, '/__reset');
  // Number the mock's entries after anything other specs created in this database.
  const [r] = await sql<{ max: number; counter: number | null }>(
    `select coalesce((select max(e.number) from entries e join forms f on f.id = e.form_id where f.slug = 'request-for-invoice' and f.org_id = $1), 0)::int as max,
            (select c.last_number from form_counters c join forms f on f.id = c.form_id where f.slug = 'request-for-invoice' and f.org_id = $1) as counter`, [ORG]);
  counterBefore = r.counter;
  base = Math.max(r.max, r.counter ?? 0) + 10;
  await mock(request, '/__seed', { base });
});

test.afterAll(async () => {
  // Remove what the import wrote (entries cascade to files and events) and restore the RFI counter.
  await sql(`delete from external_refs where org_id = $1 and source = 'cognito' and external_id = any($2)`, [ORG, rfiIds()]);
  await sql(`delete from entries where cognito_entry_id = any($1)`, [rfiIds()]);
  if (counterBefore === null) await sql(`delete from form_counters where form_id = (select id from forms where slug = 'request-for-invoice' and org_id = $1)`, [ORG]);
  else await sql(`update form_counters set last_number = $2 where form_id = (select id from forms where slug = 'request-for-invoice' and org_id = $1)`, [ORG, counterBefore]);
});

test('the import page needs a signed-in admin; the job endpoint needs the job secret', async ({ page, request }) => {
  await page.goto(PAGE);
  await expect(page).toHaveURL(/\/login/);
  expect((await request.post('/api/jobs/cognito-import')).status()).toBe(401);
});

test('Forms page links to the import; a wrong key fails Test connection; the right key is saved encrypted and never shown', async ({ page, request }) => {
  await signIn(page, '/admin/forms');
  await expect(page.getByTestId('form-card-request-for-invoice').getByRole('link', { name: 'Import entries' })).toHaveAttribute('href', '/admin/forms/import#form-request-for-invoice');
  await page.getByRole('link', { name: 'Import from Cognito' }).click();
  await expect(page).toHaveURL(new RegExp(`${PAGE}$`), { timeout: 60_000 }); // first compile in dev
  await expect(page.getByTestId('cognito-key-status')).toContainText('No key saved');
  await expect(page.getByTestId('run-form-request-for-invoice').getByRole('button', { name: 'Dry run' })).toBeDisabled();

  const main = page.getByRole('main');
  await main.getByLabel('Cognito API key').fill('wrong-key-not-real-9999');
  await main.getByRole('button', { name: 'Save key' }).click();
  await expect(page.getByTestId('cognito-key-status')).toContainText('ending in 9999');
  await main.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByTestId('connection-error')).toContainText('Cognito did not accept the key');

  await main.getByLabel('Replace the API key').fill(COGNITO_KEY);
  await main.getByRole('button', { name: 'Replace key' }).click();
  await expect(page.getByTestId('cognito-key-status')).toContainText('ending in 0123');
  await expect(main.getByLabel('Replace the API key')).toHaveValue('');

  const html = await page.content();
  expect(html).not.toContain(COGNITO_KEY);
  const [k] = await sql<{ key_hex: string; last4: string; n: number }>(
    `select encode(key_enc, 'hex') as key_hex, last4, (select count(*)::int from cognito_api_keys where org_id = $1) as n from cognito_api_keys where org_id = $1`, [ORG]);
  expect(k.n).toBe(1);
  expect(k.last4).toBe('0123');
  expect(k.key_hex).not.toContain(Buffer.from(COGNITO_KEY).toString('hex'));
  expect(k.key_hex).not.toContain(Buffer.from('cognito-key').toString('hex'));
  const audits = await sql<{ action: string; meta: unknown }>(`select action, meta from audit_log where org_id = $1 and action like 'cognito.%'`, [ORG]);
  expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['cognito.key.save', 'cognito.test_connection']));
  expect(JSON.stringify(audits)).not.toContain(COGNITO_KEY);
  expect(JSON.stringify(audits)).not.toContain('0123');
  // The wrong key was sent once (to the form list), the right one is not used yet.
  expect((await cognitoLog(request)).filter((l) => l.path === '/api/forms').map((l) => l.authed)).toEqual([false]);
});

test('Test connection lists Cognito forms, maps them to platform forms, and shows forms that are not in the platform', async ({ page }) => {
  await signIn(page, PAGE);
  await page.getByRole('main').getByRole('button', { name: 'Test connection' }).click();
  const result = page.getByTestId('connection-result');
  await expect(result).toContainText('Cognito lists 4 forms');
  await expect(result).toContainText('The key can read entries.');
  const rows = result.getByTestId('cognito-form');
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: 'Request For Invoice' })).toContainText('Imports into');
  await expect(rows.filter({ hasText: 'Request For Invoice' })).toContainText('not reported (the dry run counts them)');
  await expect(rows.filter({ hasText: 'STORE ROOM' })).toContainText('Imports into');
  await expect(rows.filter({ hasText: 'Synthetic Feedback Survey' })).toContainText('Not in the platform yet — form definition import is not supported');
  await expect(rows.filter({ hasText: 'Synthetic Feedback Survey' })).toContainText('entries: 3');
  await expect(result).toContainText('Not found in Cognito');
});

test('dry run reads Cognito and writes nothing; the report shows counts by reason', async ({ page, request }) => {
  await signIn(page, PAGE);
  const card = page.getByTestId('import-form-request-for-invoice');
  await card.getByRole('button', { name: 'Dry run' }).click();
  await expect(card.getByText('Dry run started.')).toBeVisible();
  await drive(request, (rs) => rs.some((r) => r.form_slug === 'request-for-invoice' && r.mode === 'dry_run' && r.status === 'done'));

  await page.reload();
  const report = page.getByTestId('report-request-for-invoice');
  await expect(card.getByText('Done')).toBeVisible();
  await expect(page.getByTestId('report-request-for-invoice-seen')).toContainText('3');
  await expect(page.getByTestId('report-request-for-invoice-to-import')).toContainText('2');
  await expect(page.getByTestId('report-request-for-invoice-skipped')).toContainText('unknown status 1');
  await expect(page.getByTestId('report-request-for-invoice-files')).toContainText('1 (');
  await expect(report).not.toContainText('Testy');
  expect(await sql(`select 1 from entries where cognito_entry_id = any($1)`, [rfiIds()])).toHaveLength(0);
  // Dry run downloads no files.
  expect((await cognitoLog(request)).some((l) => l.path.startsWith('/api/files/'))).toBe(false);
});

test('import writes entries with their Cognito numbers, files and refs, then rebuilds deal files; a second import adds nothing', async ({ page, request }) => {
  await signIn(page, PAGE);
  const card = page.getByTestId('import-form-request-for-invoice');
  await card.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(card.getByText('Import started.')).toBeVisible();
  await drive(request, (rs) => rs.some((r) => r.form_slug === 'request-for-invoice' && r.mode === 'apply' && r.status === 'done'));
  await page.reload();
  await expect(page.getByTestId('report-request-for-invoice-imported')).toContainText('2');
  await expect(page.getByTestId('report-request-for-invoice-stored')).toContainText('1 files');

  const entries = await sql<{ id: string; number: number; status: string; cognito_entry_id: string }>(
    `select id, number, status, cognito_entry_id from entries where cognito_entry_id = any($1) order by number`, [rfiIds()]);
  expect(entries.map((e) => [e.number, e.status, e.cognito_entry_id])).toEqual([[base + 1, 'Submitted', `4-${base + 1}`], [base + 2, 'Submitted', `4-${base + 2}`]]);
  const files = await sql<{ content_type: string; size_bytes: number; storage_path: string }>(`select content_type, size_bytes, storage_path from entry_files where entry_id = $1`, [entries[0].id]);
  expect(files).toHaveLength(1);
  expect(files[0].content_type).toBe('application/pdf');
  expect(files[0].storage_path).toMatch(new RegExp(`^request-for-invoice/${entries[0].id}/_1stDeposit/`));
  expect(await sql(`select 1 from external_refs where org_id = $1 and source = 'cognito' and external_id = any($2)`, [ORG, rfiIds()])).toHaveLength(2);
  expect(await sql(`select 1 from entry_events where entry_id = any($1) and action = 'Import'`, [entries.map((e) => e.id)])).toHaveLength(2);
  const [c] = await sql<{ last_number: number }>(`select last_number from form_counters c join forms f on f.id = c.form_id where f.slug = 'request-for-invoice' and f.org_id = $1`, [ORG]);
  expect(c.last_number).toBeGreaterThanOrEqual(base + 2);
  expect(await sql(`select 1 from outbox_jobs where queue = 'deal-files.rebuild' and org_id = $1`, [ORG])).not.toHaveLength(0);
  expect(await sql(`select 1 from job_runs where job = 'cognito.import' and org_id = $1 and ok`, [ORG])).not.toHaveLength(0);

  // The imported entry opens in the admin like any other.
  await page.goto(`/admin/forms/request-for-invoice/entries/${base + 1}`);
  await expect(page.getByRole('main')).toContainText(`Entry #${base + 1}`);
  await expect(page.getByRole('main')).toContainText('synthetic-deposit.pdf');
  await expect(page.getByRole('main')).toContainText('Import → Submitted');

  // Again: nothing new.
  await page.goto(PAGE);
  await card.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(card.getByText('Import started.')).toBeVisible();
  await drive(request, (rs) => rs.filter((r) => r.form_slug === 'request-for-invoice' && r.mode === 'apply' && r.status === 'done').length === 2);
  await page.reload();
  await expect(page.getByTestId('report-request-for-invoice-imported')).toContainText('0');
  await expect(page.getByTestId('report-request-for-invoice-already')).toContainText('2');
  expect(await sql(`select 1 from entries where cognito_entry_id = any($1)`, [rfiIds()])).toHaveLength(2);
  expect(await sql(`select 1 from entry_files f join entries e on e.id = f.entry_id where e.cognito_entry_id = any($1)`, [rfiIds()])).toHaveLength(1);
});

test('"All forms" dry run can be stopped and resumed; it then finishes every form', async ({ page, request }) => {
  await signIn(page, PAGE);
  await mock(request, '/__delay', { ms: 150 });
  const all = page.getByTestId('import-all');
  await page.getByTestId('run-form-all').getByRole('button', { name: 'Dry run' }).click();
  await expect(all.getByText('Dry run started.')).toBeVisible();
  // The first form (Request for invoice) starts; stop the set while it reads.
  await expect.poll(async () => latestBatch(await runs()).length).toBe(7);
  await page.reload();
  await all.getByRole('button', { name: 'Stop' }).click();
  await expect(all.getByText('Stopping.')).toBeVisible();
  await expect.poll(async () => latestBatch(await runs()).every((r) => r.status === 'paused'), { timeout: 20_000 }).toBe(true);
  await page.reload();
  await expect(all.getByText('Paused').first()).toBeVisible();

  await mock(request, '/__delay', { ms: 0 });
  await all.getByRole('button', { name: 'Resume' }).click();
  await expect(all.getByText('Resumed.')).toBeVisible();
  await drive(request, (rs) => latestBatch(rs).every((r) => r.status === 'done'));
  const batch = latestBatch(await runs());
  expect(batch.find((r) => r.form_slug === 'request-for-invoice')!.report).toMatchObject({ seen: 3, alreadyImported: 2, toImport: 0 });
  expect(batch.find((r) => r.form_slug === 'delivery-note')!.report).toMatchObject({ seen: 0 });
  await page.reload();
  await all.getByText('Totals for this set').click();
  await expect(page.getByTestId('report-all-seen')).toContainText('3');
  // No queued work is left behind for other specs (a job queued before the stop finds its run done and ends).
  await expect.poll(async () => {
    await job(request);
    return (await sql(`select 1 from outbox_jobs where queue = 'cognito.import' and status in ('pending', 'running')`)).length;
  }).toBe(0);
});

test('removing the key stops new runs', async ({ page }) => {
  await signIn(page, PAGE);
  await page.getByRole('main').getByRole('button', { name: 'Remove key' }).click();
  await expect(page.getByTestId('cognito-key-status')).toContainText('No key saved');
  expect(await sql(`select 1 from cognito_api_keys where org_id = $1`, [ORG])).toHaveLength(0);
  await expect(page.getByTestId('run-form-request-for-invoice').getByRole('button', { name: 'Import' })).toBeDisabled();
});
