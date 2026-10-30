import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN, sql } from './helpers';
import { E2E_XERO } from './xero-env';

// M6 stock pages C: Pilot setup, opening stock import, the stock.invoices job, Invoice review and Activity.
// Synthetic VINs, invoice numbers and notes only. Rows are scoped by a run id (the e2e database is shared).
test.describe.configure({ mode: 'serial' });

const ORG = '00000000-0000-0000-0000-000000000001';
const run = Date.now().toString(36).toUpperCase();
const VIN = (n: number) => `E2E${run}V${String(n).padStart(3, '0')}`;
const INV = (s: string) => `INV-${run}-${s}`;

const main = (page: Page) => page.getByRole('main');

/** helpers.signIn with room for the dev server's first compile of a stock page. */
async function signIn(page: Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, '\\$&')}$`), { timeout: 60_000 });
}

async function drain(request: APIRequestContext) {
  const res = await request.post('/api/jobs/outbox', { headers: { Authorization: `Bearer ${E2E_XERO.JOB_SECRET}` } });
  expect(res.status()).toBe(200);
}

async function setting(key: string): Promise<unknown> {
  return (await sql<{ value: unknown }>(`select value from public.app_settings where org_id = $1 and key = $2`, [ORG, key]))[0]?.value;
}

test('Pilot setup: start date, invoice rules (live needs typed confirmation, audited), rebuild deals', async ({ page }) => {
  // Start from unset settings and no queued stock jobs (the e2e database may be reused).
  await sql(`delete from public.app_settings where org_id = $1 and key like 'stock.%'`, [ORG]);
  await sql(`delete from public.outbox_jobs where org_id = $1 and queue in ('stock.invoices', 'stock.deals-backfill') and status = 'pending'`, [ORG]);
  await signIn(page, '/admin/stock/setup');
  const m = main(page);
  await expect(m.getByRole('heading', { name: 'Pilot setup' })).toBeVisible();

  // Start date.
  await m.getByLabel('Stock start date').fill('2026-01-01');
  await m.getByRole('button', { name: 'Save start date' }).click();
  await expect(m.getByText('Stock start date set to 2026-01-01.')).toBeVisible();
  expect(await setting('stock.deals_from')).toBe('2026-01-01');
  await expect(m.getByTestId('current-start')).toHaveText('2026-01-01');

  // Live without the typed word is refused; with it, saved and audited.
  const rules = m.getByTestId('rules-form');
  await rules.getByText('Live', { exact: true }).click();
  await rules.getByLabel('Type live to confirm').fill('yes');
  await rules.getByRole('button', { name: 'Save invoice rules' }).click();
  await expect(rules.getByText('Type "live" to switch the invoice rules to live.')).toBeVisible();
  expect(await setting('stock.invoice_rules')).toBeUndefined();
  await rules.getByLabel('Type live to confirm').fill('live');
  await rules.getByRole('button', { name: 'Save invoice rules' }).click();
  await expect(rules.getByText('Invoice rules are live.', { exact: false })).toBeVisible();
  expect(await setting('stock.invoice_rules')).toBe('live');
  const audits = await sql<{ meta: Record<string, unknown> }>(
    `select meta from public.audit_log where org_id = $1 and action = 'stock.settings' order by id desc limit 2`, [ORG]);
  expect(audits.map((a) => a.meta)).toEqual([
    { key: 'stock.invoice_rules', from: 'preview', to: 'live', confirmed: true },
    { key: 'stock.deals_from', from: null, to: '2026-01-01' },
  ]);
  // Going live queues a sweep of the invoices changed since the start date.
  expect(await sql(`select 1 from public.outbox_jobs where org_id = $1 and queue = 'stock.invoices' and status = 'pending' and payload->>'kind' = 'sweep'`, [ORG])).toHaveLength(1);

  // Rebuild deals queues the deal backfill once (the deal sync implements the job).
  await m.getByRole('button', { name: 'Rebuild deals' }).click();
  await expect(m.getByText('Rebuild queued.', { exact: false })).toBeVisible();
  const queued = await sql<{ id: string; payload: unknown }>(`select id, payload from public.outbox_jobs where org_id = $1 and queue = 'stock.deals-backfill' and status = 'pending'`, [ORG]);
  expect(queued).toHaveLength(1);
  expect(queued[0].payload).toEqual({ from: 0 });
  expect(await sql(`select 1 from public.audit_log where org_id = $1 and action = 'stock.deals_rebuild'`, [ORG])).toHaveLength(1);
  // Not this branch's job: keep the shared outbox clean for other specs.
  await sql(`delete from public.outbox_jobs where id = $1`, [queued[0].id]);
});

test('Opening stock CSV: dry run lists problems by line, a clean file imports, re-importing adds nothing', async ({ page }) => {
  await signIn(page, '/admin/stock/setup');
  const box = main(page).getByTestId('opening-import');
  const file = box.getByLabel('Opening stock CSV');
  const check = box.getByRole('button', { name: 'Check file' });
  const apply = box.getByRole('button', { name: 'Import units' });
  const upload = async (name: string, text: string) => {
    await file.setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(text) });
    await expect(check).toBeEnabled();
  };
  const head = 'VIN,Model,Location,Status,Invoice,Deal year,Sequence,Dispatch date,Notes';

  await upload('bad.csv', [
    head,
    `${VIN(1)},3000D,JHB,available,,,,,`,
    `${VIN(1)},3000D,CPT,available,,,,,`,
    `${VIN(2)},NOTAMODEL,JHB,available,,,,,`,
    `${VIN(3)},3000D,Pretoria,available,,,,,`,
    `${VIN(4)},3000D,JHB,on hold,,,,,`,
  ].join('\n'));
  await check.click();
  const report = box.getByTestId('opening-report');
  await expect(report.getByTestId('opening-problem-list')).toContainText(`VIN ${VIN(1)} appears more than once: lines 2, 3`);
  await expect(report.getByTestId('opening-problem-list')).toContainText('Unknown model NOTAMODEL: line 4');
  await expect(report.getByTestId('opening-problem-list')).toContainText('Unknown location: line 5');
  await expect(report.getByTestId('opening-problem-list')).toContainText('Line 6: Status must be available, reserved or sold.');
  await expect(report).not.toContainText('Pretoria');
  await expect(report).not.toContainText('on hold');
  await expect(apply).toBeDisabled();
  expect(await sql(`select 1 from public.stock_units where vin like $1`, [`E2E${run}%`])).toHaveLength(0);

  const clean = [
    head,
    `${VIN(1)},3000D,JHB,available,,,,2026-02-01,Synthetic note`,
    `${VIN(2)},1000DB,Cape Town,available,,2026,101,,`,
    `${VIN(3)},2500D,Factory,available,,,,,`,
    `${VIN(4)},3000D,DBN,available,,,,,`,
    `${VIN(5)},CTLL1,jhb,available,,,,,`,
  ].join('\r\n');
  await upload('opening.csv', clean);
  await check.click();
  await expect(report.getByTestId('opening-new')).toHaveText('5');
  await expect(report.getByTestId('opening-problem-list')).toHaveCount(0);
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(box.getByText('Imported 5 new units.')).toBeVisible();
  const units = await sql<{ vin: string; model_part: string; location_id: string; status: string; deal_year: number | null; sequence: number | null; dispatch_date: string | null }>(
    `select vin, model_part, location_id, status, deal_year, sequence, to_char(dispatch_date, 'YYYY-MM-DD') as dispatch_date
     from public.stock_units where org_id = $1 and vin like $2 order by vin`, [ORG, `E2E${run}%`]);
  expect(units).toEqual([
    { vin: VIN(1), model_part: '3000D', location_id: 'JHB', status: 'available', deal_year: null, sequence: null, dispatch_date: '2026-02-01' },
    { vin: VIN(2), model_part: '1000DB', location_id: 'CPT', status: 'available', deal_year: 2026, sequence: 101, dispatch_date: null },
    { vin: VIN(3), model_part: '2500D', location_id: 'FACTORY', status: 'available', deal_year: null, sequence: null, dispatch_date: null },
    { vin: VIN(4), model_part: '3000D', location_id: 'DBN', status: 'available', deal_year: null, sequence: null, dispatch_date: null },
    { vin: VIN(5), model_part: 'CTLL1', location_id: 'JHB', status: 'available', deal_year: null, sequence: null, dispatch_date: null },
  ]);
  const [imp] = await sql<{ meta: Record<string, unknown> }>(`select meta from public.audit_log where org_id = $1 and action = 'stock.opening_import' order by id desc limit 1`, [ORG]);
  expect(imp.meta).toEqual({ inserted: 5, skipped: 0, rows: 5 });

  // The same file again: everything is registered, nothing to import.
  await upload('opening-again.csv', clean);
  await check.click();
  await expect(report.getByTestId('opening-new')).toHaveText('0');
  await expect(report.getByTestId('opening-existing')).toHaveText('5');
  await expect(apply).toBeDisabled();
  expect(await sql(`select 1 from public.stock_units where org_id = $1 and vin like $2`, [ORG, `E2E${run}%`])).toHaveLength(5);
});

// Mirror invoices for the units above (updated now, so after the 2026-01-01 start date unless said otherwise).
const INVOICES = {
  reserve: randomUUID(), // VIN 1, unpaid -> reserved
  sell: randomUUID(), // VIN 2 inside a longer reference, paid -> sold
  voided: randomUUID(), // VIN 4, voided -> exception
  noVin: randomUUID(), // model item code, no VIN -> exception vin_not_found
  parts: randomUUID(), // no VIN, no model line -> not a stock invoice
  old: randomUUID(), // VIN 5 but changed before the start date -> never checked
};

async function seedInvoice(id: string, o: { number: string; status: string; due: number; total: number; reference: string; updated?: string; codes?: string[] }) {
  await sql(
    `insert into public.xero_invoices(org_id, tenant_id, invoice_id, invoice_number, invoice_type, reference, status, currency_code, total, amount_due, amount_paid, updated_utc, raw)
     values ($1, 'tenant-e2e', $2, $3, 'ACCREC', $4, $5, 'ZAR', $6::numeric, $7::numeric, $6::numeric - $7::numeric, $8, '{}')`,
    [ORG, id, o.number, o.reference, o.status, o.total, o.due, o.updated ?? new Date().toISOString()],
  );
  for (const [i, code] of (o.codes ?? []).entries()) {
    await sql(`insert into public.xero_invoice_lines(org_id, invoice_id, line_no, item_code, description) values ($1, $2, $3, $4, 'Synthetic line')`, [ORG, id, i + 1, code]);
  }
}

test('Invoice rules live: the job reserves, sells and records exceptions once; Invoice review; Resolve; manual apply', async ({ page, request }) => {
  await seedInvoice(INVOICES.reserve, { number: INV('A'), status: 'AUTHORISED', due: 1000, total: 1000, reference: VIN(1), codes: ['3000D'] });
  await seedInvoice(INVOICES.sell, { number: INV('B'), status: 'PAID', due: 0, total: 2000, reference: `Unit ${VIN(2).toLowerCase()} delivered` });
  await seedInvoice(INVOICES.voided, { number: INV('C'), status: 'VOIDED', due: 0, total: 1500, reference: VIN(4) });
  await seedInvoice(INVOICES.noVin, { number: INV('D'), status: 'AUTHORISED', due: 800, total: 800, reference: 'Synthetic order', codes: ['3000D-RED'] });
  await seedInvoice(INVOICES.parts, { number: INV('E'), status: 'AUTHORISED', due: 50, total: 50, reference: 'Synthetic parts', codes: ['HOSE-1'] });
  await seedInvoice(INVOICES.old, { number: INV('F'), status: 'PAID', due: 0, total: 900, reference: VIN(5), updated: '2025-06-01T10:00:00Z' });
  const ids = Object.values(INVOICES);
  await sql(`insert into public.outbox_jobs(org_id, queue, payload) values ($1, 'stock.invoices', $2)`, [ORG, JSON.stringify({ kind: 'ids', invoice_ids: ids, rev: 0 })]);
  await drain(request);

  const unit = async (n: number) => (await sql<{ status: string; invoice_number: string | null; xero_invoice_id: string | null; sold: boolean }>(
    `select status, invoice_number, xero_invoice_id, sold_at is not null as sold from public.stock_units where org_id = $1 and vin = $2`, [ORG, VIN(n)]))[0];
  expect(await unit(1)).toEqual({ status: 'reserved', invoice_number: INV('A'), xero_invoice_id: INVOICES.reserve, sold: false });
  expect(await unit(2)).toEqual({ status: 'sold', invoice_number: INV('B'), xero_invoice_id: INVOICES.sell, sold: true });
  expect(await unit(4)).toMatchObject({ status: 'available', invoice_number: null });
  expect(await unit(5)).toMatchObject({ status: 'available', invoice_number: null });
  const exceptions = async () => sql<{ invoice_number: string; reason: string; resolved: boolean }>(
    `select invoice_number, reason, resolved_at is not null as resolved from public.stock_invoice_exceptions where org_id = $1 and invoice_number like $2 order by invoice_number`,
    [ORG, `INV-${run}-%`]);
  expect(await exceptions()).toEqual([
    { invoice_number: INV('C'), reason: 'voided', resolved: false },
    { invoice_number: INV('D'), reason: 'vin_not_found', resolved: false },
  ]);
  const auditCount = async () => (await sql<{ n: number }>(
    `select count(*)::int as n from public.audit_log where org_id = $1 and action in ('stock.reserve', 'stock.sell', 'stock.exception') and meta->>'invoice_number' like $2`,
    [ORG, `INV-${run}-%`]))[0].n;
  expect(await auditCount()).toBe(4);
  const [runRow] = await sql<{ ok: boolean; processed: number }>(`select ok, processed from public.job_runs where org_id = $1 and job = 'stock.invoices' order by id desc limit 1`, [ORG]);
  expect(runRow.ok).toBe(true);

  // Idempotent: the same invoices again change nothing and record nothing new.
  await sql(`insert into public.outbox_jobs(org_id, queue, payload) values ($1, 'stock.invoices', $2)`, [ORG, JSON.stringify({ kind: 'ids', invoice_ids: ids })]);
  await sql(`insert into public.outbox_jobs(org_id, queue, payload) values ($1, 'stock.invoices', '{"kind":"sweep"}')`, [ORG]);
  await drain(request);
  expect(await exceptions()).toHaveLength(2);
  expect(await auditCount()).toBe(4);
  expect(await unit(2)).toMatchObject({ status: 'sold' });

  // Invoice review shows the outcomes and the queue.
  await signIn(page, '/admin/stock/invoices');
  const m = main(page);
  const recent = m.getByTestId('recent-invoices');
  const rowOf = (inv: string) => recent.getByTestId('invoice-row').filter({ hasText: inv });
  await expect(rowOf(INV('A'))).toContainText('Applied: Reserved');
  await expect(rowOf(INV('A'))).toContainText(VIN(1));
  await expect(rowOf(INV('B'))).toContainText('Applied: Sold');
  await expect(rowOf(INV('C'))).toContainText('Exception: Invoice voided');
  await expect(rowOf(INV('D'))).toContainText('Exception: VIN not found');
  await expect(rowOf(INV('E'))).toHaveCount(0);
  await expect(rowOf(INV('F'))).toHaveCount(0);

  const queue = m.getByTestId('exceptions');
  const exRow = queue.getByTestId('exception-row').filter({ hasText: INV('C') });
  await expect(exRow).toContainText('Invoice voided');
  await exRow.getByText('Resolve', { exact: true }).click();
  await exRow.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(exRow.getByText('Enter a resolution note.')).toBeVisible();
  await exRow.getByLabel('Resolution note').fill('Synthetic resolution: voided in error, re-issued');
  await exRow.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(queue.getByTestId('exception-row').filter({ hasText: INV('C') })).toHaveCount(0);
  expect((await exceptions()).find((e) => e.invoice_number === INV('C'))?.resolved).toBe(true);
  const [resolved] = await sql<{ meta: Record<string, unknown>; actor_user: string }>(
    `select meta, actor_user from public.audit_log where org_id = $1 and action = 'stock.exception_resolve' and meta->>'invoice_number' = $2`, [ORG, INV('C')]);
  expect(resolved.meta).toMatchObject({ reason: 'voided', invoice_number: INV('C') });
  expect(JSON.stringify(resolved.meta)).not.toContain('Synthetic resolution');
  await expect(rowOf(INV('C'))).toContainText('Resolved: Invoice voided');
  await m.getByRole('link', { name: 'Show resolved' }).click();
  await expect(m.getByTestId('exceptions').getByTestId('exception-row').filter({ hasText: INV('C') })).toContainText('Synthetic resolution');

  // Manual apply (plan 7.5): reserve, the same again is a no-op, conflicts and unknown VINs change nothing.
  await page.goto('/admin/stock/invoices');
  const form = main(page).getByTestId('manual-invoice-form');
  const manual = async (inv: string, ref: string, status: 'Unpaid / partly paid — Reserved' | 'Fully paid — Sold') => {
    await form.getByLabel('Invoice number').fill(inv);
    await form.getByLabel('Invoice reference (VIN)').fill(ref);
    await form.getByLabel('Payment status').selectOption({ label: status });
    await form.getByRole('button', { name: 'Apply update' }).click();
  };
  await manual(INV('M'), VIN(3), 'Unpaid / partly paid — Reserved');
  await expect(form.getByText('Unpaid: unit reserved.')).toBeVisible();
  expect(await unit(3)).toMatchObject({ status: 'reserved', invoice_number: INV('M'), xero_invoice_id: null });
  await manual(INV('M').toLowerCase(), ` ${VIN(3)} `, 'Unpaid / partly paid — Reserved');
  await expect(form.getByText(`No change: the unit is already Reserved on ${INV('M')}.`)).toBeVisible();
  await manual(INV('N'), VIN(3), 'Fully paid — Sold');
  await expect(form.getByText('This unit is linked to another invoice. Review the conflict before proceeding.')).toBeVisible();
  await expect(form.getByLabel('Invoice number')).toHaveValue(INV('N')); // kept after an error
  await manual(INV('P'), `NOPE${run}`, 'Fully paid — Sold');
  await expect(form.getByText('VIN not found. No stock record has been changed.')).toBeVisible();
  await manual(INV('M'), VIN(3), 'Fully paid — Sold');
  await expect(form.getByText('Fully paid: unit marked Sold.')).toBeVisible();
  expect(await unit(3)).toMatchObject({ status: 'sold', invoice_number: INV('M'), sold: true });
  const [manualAudit] = await sql<{ meta: Record<string, unknown> }>(
    `select meta from public.audit_log where org_id = $1 and action = 'stock.sell' and meta->>'invoice_number' = $2`, [ORG, INV('M')]);
  expect(manualAudit.meta).toMatchObject({ mode: 'manual', vin: VIN(3), from_status: 'reserved' });
});

test('Preview mode changes nothing and shows what each invoice would do', async ({ page, request }) => {
  await signIn(page, '/admin/stock/setup');
  const rules = main(page).getByTestId('rules-form');
  await rules.getByText('Preview', { exact: true }).click();
  await rules.getByRole('button', { name: 'Save invoice rules' }).click();
  await expect(rules.getByText('Invoice rules: Preview.')).toBeVisible();

  const id = randomUUID();
  await seedInvoice(id, { number: INV('Q'), status: 'AUTHORISED', due: 400, total: 400, reference: VIN(5) });
  const voided = randomUUID();
  await seedInvoice(voided, { number: INV('R'), status: 'VOIDED', due: 0, total: 400, reference: VIN(5) });
  await sql(`insert into public.outbox_jobs(org_id, queue, payload) values ($1, 'stock.invoices', $2)`, [ORG, JSON.stringify({ kind: 'ids', invoice_ids: [id, voided] })]);
  await drain(request);
  const [u] = await sql<{ status: string; invoice_number: string | null }>(`select status, invoice_number from public.stock_units where org_id = $1 and vin = $2`, [ORG, VIN(5)]);
  expect(u).toEqual({ status: 'available', invoice_number: null });
  expect(await sql(`select 1 from public.stock_invoice_exceptions where org_id = $1 and invoice_number in ($2, $3)`, [ORG, INV('Q'), INV('R')])).toHaveLength(0);

  await page.goto('/admin/stock/invoices');
  const recent = main(page).getByTestId('recent-invoices');
  await expect(recent.getByTestId('invoice-row').filter({ hasText: INV('Q') })).toContainText('Preview: would reserve');
  await expect(recent.getByTestId('invoice-row').filter({ hasText: INV('R') })).toContainText('Preview: exception, Invoice voided');
  await expect(main(page).getByText('Rules: Preview')).toBeVisible();
});

test('Activity: plain-words lines with actor and time, kind filter, dismissal history', async ({ page }) => {
  // A dismissed deal as stock_dismiss_deal writes it (deal, dismissal history row, audit row with the dismissal id).
  const number = 90000 + Math.floor(Math.random() * 9000);
  const [deal] = await sql<{ id: string }>(
    `insert into public.stock_deals(org_id, year, number, location_id, model_part, status, dismissed_reason, dismissed_at)
     values ($1, 2026, $2, 'CPT', '1000DB', 'dismissed', 'SENT 26/03', now()) returning id`, [ORG, number]);
  const [dm] = await sql<{ id: string }>(`insert into public.stock_deal_dismissals(org_id, deal_id, reason) values ($1, $2, 'SENT 26/03') returning id`, [ORG, deal.id]);
  await sql(`insert into public.audit_log(org_id, actor_user, action, entity, entity_id, meta) values ($1, '00000000-0000-0000-0000-00000000a001', 'stock.dismiss', 'stock_deal', $2, $3)`,
    [ORG, deal.id, JSON.stringify({ deal_id: deal.id, deal_year: 2026, deal_number: number, dismissal_id: dm.id })]);

  await signIn(page, '/admin/stock/activity');
  const m = main(page);
  const rows = m.getByTestId('activity-row');
  await expect(rows.filter({ hasText: `${VIN(1)} reserved · ${INV('A')}` })).toContainText('Xero invoice rules');
  await expect(rows.filter({ hasText: `${VIN(3)} marked Sold · ${INV('M')} (manual)` })).toContainText('Test Admin');
  await expect(rows.filter({ hasText: 'Opening stock imported: 5 new units' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Invoice rules changed from Preview to Live (typed confirmation)' })).toHaveCount(1);
  await expect(rows.filter({ hasText: `Dismissed 2026/${number} · SENT 26/03` })).toHaveCount(1);
  await expect(rows.first()).toContainText(/\d{4}\/\d{2}\/\d{2}, \d{2}:\d{2}:\d{2} · /);
  await expect(m.getByTestId('dismissal-history').getByTestId('dismissal-row').filter({ hasText: `Dismissed 2026/${number}` })).toContainText('SENT 26/03');

  await m.getByLabel('Kind').selectOption({ label: 'Invoices' });
  await m.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/kind=invoices/);
  await expect(rows.filter({ hasText: `${VIN(1)} reserved` })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Opening stock imported' })).toHaveCount(0);
  await expect(rows.filter({ hasText: `Invoice ${INV('C')} needs review · Invoice voided` })).toHaveCount(1);

  // A date range before any of this shows nothing.
  await page.goto('/admin/stock/activity?from=2020-01-01&to=2020-01-31');
  await expect(main(page).getByText('No changes yet.', { exact: false })).toBeVisible();
});

test('Stock pages fit a 390px phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, '/admin/stock/invoices');
  for (const path of ['/admin/stock/invoices', '/admin/stock/activity', '/admin/stock/setup']) {
    await page.goto(path);
    await expect(main(page).getByRole('heading', { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
