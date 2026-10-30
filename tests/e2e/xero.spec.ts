import { createHmac } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { attach, PDF, signIn, sql } from './helpers';
import { E2E_XERO, XERO_URL } from './xero-env';

// M2 acceptance against tests/e2e/mock-xero.mjs (synthetic data, read-only Accounting API) and the Supabase
// stub. The tests share one connection and run in order.
test.describe.configure({ mode: 'serial' });

type J = Record<string, unknown>;
type XInvoice = { InvoiceID: string; InvoiceNumber: string; Reference: string; Status: string; Total: number; CurrencyCode: string; UpdatedDateUTC: string; HasAttachments: boolean; LineItems: unknown[] };
type XQuote = { QuoteID: string; QuoteNumber: string; Total: number; CurrencyCode: string; LineItems: unknown[] };
type XPayment = { PaymentID: string; Amount: number };
type MockData = { tenant: { tenantId: string; tenantName: string }; contacts: J[]; quotes: XQuote[]; invoices: XInvoice[]; payments: XPayment[]; attachments: Record<string, J[]>; creditNotes: J[] };
type LogLine = { method: string; path: string; api: boolean; grant?: string };

const THANKS = 'Thank you for filling out the form. Your response has been recorded.';
const ORG = '00000000-0000-0000-0000-000000000001';
const BACKFILL_FROM = Date.parse('2025-01-01T00:00:00Z');
const OPEN = new Set(['DRAFT', 'SUBMITTED', 'AUTHORISED']);

const mock = async <T = unknown>(request: APIRequestContext, path: string, body?: unknown): Promise<T> => {
  const res = body === undefined && path !== '/__reset' && path !== '/__expire-access-token'
    ? await request.get(`${XERO_URL}${path}`)
    : await request.post(`${XERO_URL}${path}`, { data: body ?? {} });
  expect(res.ok()).toBe(true);
  return (await res.json()) as T;
};
const netMs = (d: string) => Number(d.match(/-?\d+/)![0]);
const refreshes = (log: LogLine[]) => log.filter((l) => l.path === '/connect/token' && l.grant === 'refresh_token').length;
const cents = (n: number | string) => Math.round(Number(n) * 100);

const job = (request: APIRequestContext, queue: string, body: unknown = {}, secret = E2E_XERO.JOB_SECRET) =>
  request.post(`/api/jobs/${queue}`, { headers: { Authorization: `Bearer ${secret}` }, data: body });

async function fullSyncUntilDone(request: APIRequestContext) {
  for (let i = 0; i < 20; i++) {
    const res = await job(request, 'xero-sync', { mode: 'full' });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { results: Array<{ status: string; reason?: string }> };
    expect(body.results).toHaveLength(1);
    expect(['ok', 'partial']).toContain(body.results[0].status);
    const states = await sql<{ entity: string; backfill_done: boolean }>(`select entity, backfill_done from xero_sync_state where org_id = $1`, [ORG]);
    if (states.length === 6 && states.every((s) => s.backfill_done)) return;
  }
  throw new Error('backfill did not finish');
}

async function drainOutbox(request: APIRequestContext) {
  for (let i = 0; i < 10; i++) {
    const res = await job(request, 'outbox');
    expect(res.status()).toBe(200);
    const [{ n }] = await sql<{ n: number }>(`select count(*)::int as n from outbox_jobs where status in ('pending', 'running') and run_at <= now()`);
    if (n === 0) return;
  }
  throw new Error('outbox did not drain');
}

function signed(body: unknown, key = E2E_XERO.XERO_WEBHOOK_KEY) {
  const raw = JSON.stringify(body);
  return { raw, signature: createHmac('sha256', key).update(raw).digest('base64') };
}
const postWebhook = (request: APIRequestContext, raw: string, signature: string) =>
  request.post('/api/webhooks/xero', { headers: { 'content-type': 'application/json', 'x-xero-signature': signature }, data: raw });

const counts = async () => {
  const [r] = await sql<{ events: number; jobs: number }>(`select (select count(*)::int from integration_events where source = 'xero') as events, (select count(*)::int from outbox_jobs) as jobs`);
  return r;
};

let data: MockData;

test.beforeAll(async ({ request }) => {
  await mock(request, '/__reset');
  data = await mock<MockData>(request, '/__data');
});

test('job endpoints refuse a missing or wrong bearer', async ({ request }) => {
  // Other specs (leads) run the outbox too: compare against this test's start, not an empty table.
  const runs = async () => (await sql<{ n: number }>(`select count(*)::int as n from job_runs`))[0].n;
  const before = await runs();
  expect((await request.post('/api/jobs/xero-sync', { data: { mode: 'full' } })).status()).toBe(401);
  expect((await job(request, 'xero-sync', { mode: 'full' }, 'wrong-secret-wrong-secret-wrong-secret')).status()).toBe(401);
  expect((await job(request, 'outbox', {}, `${E2E_XERO.JOB_SECRET}x`)).status()).toBe(401);
  expect((await request.post('/api/jobs/outbox', { headers: { Authorization: E2E_XERO.JOB_SECRET } })).status()).toBe(401);
  expect(await runs()).toBe(before);
});

test('admin connects Xero through the consent flow; tokens are stored encrypted', async ({ page }) => {
  await signIn(page, '/admin/integrations/xero');
  await expect(page.getByTestId('xero-connection')).toContainText('Not connected.');
  await page.getByRole('link', { name: 'Connect to Xero' }).click();
  await expect(page).toHaveURL(/\/admin\/integrations\/xero\?connected=1$/);
  await expect(page.getByRole('status')).toContainText('Connected.');
  await expect(page.getByTestId('xero-tenant')).toHaveText(data.tenant.tenantName);

  const [conn] = await sql<{ tenant_id: string; status: string; at: string; rt: string; scopes: string[] }>(
    `select tenant_id, status, encode(access_token_enc, 'hex') as at, encode(refresh_token_enc, 'hex') as rt, scopes from xero_connections where org_id = $1`, [ORG]);
  expect(conn).toMatchObject({ tenant_id: data.tenant.tenantId, status: 'connected' });
  // The mock's tokens start "mock-at-" / "mock-rt-": neither appears in the stored bytes.
  for (const plain of ['mock-at-', 'mock-rt-', 'mock-']) {
    expect(conn.at).not.toContain(Buffer.from(plain).toString('hex'));
    expect(conn.rt).not.toContain(Buffer.from(plain).toString('hex'));
  }
  expect(conn.at.length).toBeGreaterThan(80);
  expect(conn.scopes).not.toContain('accounting.transactions'); // read-only scopes only
  expect(conn.scopes).toContain('accounting.transactions.read');
});

test('full sync mirrors the mock: counts, totals, ZAR kept; month check matches', async ({ page, request }) => {
  test.setTimeout(240_000);
  // Other specs (leads, quote picker) seed synthetic mirror rows under their own tenant ids in the shared
  // e2e database. Count only what this mock's sync wrote: drop rows from any other tenant first.
  const [{ tenant_id: tenant }] = await sql<{ tenant_id: string }>(`select tenant_id from xero_connections where org_id = $1 and status = 'connected'`, [ORG]);
  for (const t of ['xero_contacts', 'xero_quotes', 'xero_invoices', 'xero_credit_notes', 'xero_payments']) await sql(`delete from ${t} where org_id = $1 and tenant_id <> $2`, [ORG, tenant]);
  await sql(`delete from xero_quote_lines l where org_id = $1 and not exists (select 1 from xero_quotes q where q.org_id = l.org_id and q.quote_id = l.quote_id)`, [ORG]);
  await sql(`delete from xero_invoice_lines l where org_id = $1 and not exists (select 1 from xero_invoices i where i.org_id = l.org_id and i.invoice_id = l.invoice_id)`, [ORG]);
  await fullSyncUntilDone(request);

  // What the mirror must hold: everything updated since the backfill start, plus open invoices and quotes
  // older than that. The old paid invoice (2024) stays out.
  const invoices = data.invoices.filter((i) => netMs(i.UpdatedDateUTC) >= BACKFILL_FROM || OPEN.has(i.Status));
  expect(invoices.length).toBeGreaterThan(200); // more than one page
  expect(invoices.length).toBe(data.invoices.length - 1);
  const m = await sql<{ entity: string; n: number; total: string | null; currencies: string[] }>(`
    select 'contacts' as entity, count(*)::int as n, null as total, array[]::text[] as currencies from xero_contacts where org_id = $1
    union all select 'quotes', count(*)::int, sum(total)::text, array_agg(distinct currency_code::text) from xero_quotes where org_id = $1
    union all select 'quote_lines', count(*)::int, null, array[]::text[] from xero_quote_lines where org_id = $1
    union all select 'invoices', count(*)::int, sum(total)::text, array_agg(distinct currency_code::text) from xero_invoices where org_id = $1
    union all select 'invoice_lines', count(*)::int, null, array[]::text[] from xero_invoice_lines where org_id = $1
    union all select 'payments', count(*)::int, sum(amount)::text, array_agg(distinct currency_code::text) from xero_payments where org_id = $1
    union all select 'credit_notes', count(*)::int, sum(total)::text, array_agg(distinct currency_code::text) from xero_credit_notes where org_id = $1
    union all select 'attachments', count(*)::int, null, array[]::text[] from xero_attachments where org_id = $1`, [ORG]);
  const got = Object.fromEntries(m.map((r) => [r.entity, r]));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + cents(b), 0);

  expect(got.contacts.n).toBe(data.contacts.length);
  expect(got.quotes.n).toBe(data.quotes.length);
  expect(cents(got.quotes.total!)).toBe(sum(data.quotes.map((q) => q.Total)));
  expect(got.quote_lines.n).toBe(data.quotes.reduce((a, q) => a + q.LineItems.length, 0));
  expect(got.invoices.n).toBe(invoices.length);
  expect(cents(got.invoices.total!)).toBe(sum(invoices.map((i) => i.Total)));
  expect(got.invoice_lines.n).toBe(invoices.reduce((a, i) => a + i.LineItems.length, 0));
  expect(got.payments.n).toBe(data.payments.length);
  expect(cents(got.payments.total!)).toBe(sum(data.payments.map((p) => p.Amount)));
  expect(got.attachments.n).toBe(Object.values(data.attachments).flat().length);
  // Credit notes (M6 0019): read-only mirror, allocations kept as invoice ids.
  expect(got.credit_notes.n).toBe(data.creditNotes.length);
  const [cn1] = await sql<{ invoice_ids: string[]; credit_note_type: string }>(`select invoice_ids, credit_note_type from xero_credit_notes where org_id = $1 and credit_note_number = 'CN-0001'`, [ORG]);
  expect(cn1).toEqual({ invoice_ids: [data.invoices[0].InvoiceID], credit_note_type: 'ACCRECCREDIT' });
  for (const e of ['quotes', 'invoices', 'payments']) expect(got[e].currencies).toEqual(['ZAR']);
  // The old open invoice came in through the open-status pass; the old paid one did not.
  expect(await sql(`select invoice_number from xero_invoices where invoice_number in ('INV-0420', 'INV-0421')`)).toEqual([{ invoice_number: 'INV-0420' }]);
  // Raw payloads kept.
  const [raw] = await sql<{ raw: J }>(`select raw from xero_invoices where invoice_number = 'INV-9001'`);
  expect(raw.raw).toMatchObject({ InvoiceNumber: 'INV-9001', CurrencyCode: 'ZAR' });

  // Month check on the health page: live from the mock vs the mirror.
  await signIn(page, '/admin/integrations/xero');
  for (const month of ['2026-09', '2026-08']) {
    await page.getByLabel('Month').fill(month);
    await page.getByRole('button', { name: 'Compare with Xero' }).click();
    const table = page.getByTestId('month-check');
    await expect(table).toBeVisible();
    await expect(table.locator('tbody tr').first()).toBeVisible();
    const rows = await table.locator('tbody tr').allInnerTexts();
    const entities = rows.map((r) => r.split('\t')[0].trim());
    expect(entities).toEqual(expect.arrayContaining(month === '2026-09' ? ['Quotes', 'Invoices', 'Payments'] : ['Invoices']));
    for (const r of rows) {
      expect(r.split('\t')[1].trim()).toMatch(/^(ZAR|-)$/); // '-' = nothing that month on either side
      expect(r.trim().endsWith('Match')).toBe(true);
    }
    expect(rows.filter((r) => r.includes('ZAR')).length).toBeGreaterThan(0);
    await expect(table.getByText('Differs')).toHaveCount(0);
  }
});

test('webhook: signed event fetches the change; replay is a no-op; bad signature 401; intent to receive 200', async ({ request }) => {
  test.setTimeout(120_000);
  const target = data.invoices.find((i) => i.InvoiceNumber === 'INV-9001')!;
  await mock(request, '/__mutate', { invoiceId: target.InvoiceID, status: 'PAID' });
  await drainOutbox(request);
  const before = await counts();

  const payload = {
    events: [{
      resourceUrl: `https://api.xero.invalid/api.xro/2.0/Invoices/${target.InvoiceID}`,
      resourceId: target.InvoiceID,
      eventDateUtc: '2026-10-29T10:00:00.000',
      eventType: 'UPDATE',
      eventCategory: 'INVOICE',
      tenantId: data.tenant.tenantId,
      tenantType: 'ORGANISATION',
    }],
    firstEventSequence: 1,
    lastEventSequence: 1,
    entropy: 'SYNTHETICENTROPYVALUE',
  };
  const { raw, signature } = signed(payload);
  expect((await postWebhook(request, raw, signature)).status()).toBe(200);
  const events = await sql<{ status: string; signature_ok: boolean; org_id: string }>(`select status, signature_ok, org_id from integration_events where source = 'xero'`);
  expect(events).toHaveLength(before.events + 1);
  expect(events[events.length - 1]).toMatchObject({ signature_ok: true, org_id: ORG });

  await drainOutbox(request);
  await expect.poll(async () => (await sql<{ status: string }>(`select status from xero_invoices where invoice_id = $1`, [target.InvoiceID]))[0]?.status).toBe('PAID');
  const [inv] = await sql<{ amount_due: string; fully_paid_on: string | null }>(`select amount_due::text, fully_paid_on::text from xero_invoices where invoice_id = $1`, [target.InvoiceID]);
  expect(Number(inv.amount_due)).toBe(0);
  expect(inv.fully_paid_on).toBeTruthy();
  expect(await sql(`select status from integration_events where source = 'xero'`)).toEqual([{ status: 'processed' }]);
  const fetches = await sql(`select status from outbox_jobs where queue = 'xero.fetch'`);
  expect(fetches).toEqual([{ status: 'done' }]);
  await drainOutbox(request);

  // Replay of the identical delivery: acknowledged, nothing stored, nothing queued.
  const settled = await counts();
  expect((await postWebhook(request, raw, signature)).status()).toBe(200);
  expect(await counts()).toEqual(settled);

  // Bad signature: 401, nothing stored.
  const forged = { ...payload, events: [{ ...payload.events[0], eventDateUtc: '2026-10-29T11:00:00.000' }] };
  const f = signed(forged, 'not-the-webhook-key');
  expect((await postWebhook(request, f.raw, f.signature)).status()).toBe(401);
  expect((await postWebhook(request, f.raw, '')).status()).toBe(401);
  expect((await postWebhook(request, raw, signed(payload, 'wrong').signature)).status()).toBe(401);
  expect(await counts()).toEqual(settled);

  // Intent to receive: no events, valid signature.
  const intent = signed({ events: [], firstEventSequence: 0, lastEventSequence: 0, entropy: 'SYNTHETICINTENT' });
  expect((await postWebhook(request, intent.raw, intent.signature)).status()).toBe(200);
  expect(await counts()).toEqual(settled);
});

test('token refresh survives a restart: refreshed once, re-encrypted, sync succeeds', async ({ request }) => {
  test.setTimeout(120_000);
  const tokens = () => sql<{ at: string; rt: string; expires_at: Date }>(`select encode(access_token_enc, 'hex') as at, encode(refresh_token_enc, 'hex') as rt, expires_at from xero_connections where org_id = $1 and status = 'connected'`, [ORG]);
  const [old] = await tokens();
  // "Restart": the access token is dead at Xero and nothing in memory says otherwise; state is only the DB.
  await mock(request, '/__expire-access-token');
  await sql(`update xero_connections set expires_at = now() - interval '5 minutes' where org_id = $1`, [ORG]);
  const n0 = refreshes(await mock<LogLine[]>(request, '/__log'));

  const res = await job(request, 'xero-sync', { mode: 'quick' });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { results: Array<{ status: string; calls: number }> };
  expect(body.results[0].status).toBe('ok');
  expect(body.results[0].calls).toBeGreaterThan(0);
  expect(refreshes(await mock<LogLine[]>(request, '/__log'))).toBe(n0 + 1);

  const [now] = await tokens();
  expect(now.at).not.toBe(old.at);
  expect(now.rt).not.toBe(old.rt);
  expect(new Date(now.expires_at).getTime()).toBeGreaterThan(Date.now() + 20 * 60_000);

  // A second sync straight after uses the stored token.
  const again = await job(request, 'xero-sync', { mode: 'quick' });
  expect(((await again.json()) as { results: Array<{ status: string }> }).results[0].status).toBe('ok');
  expect(refreshes(await mock<LogLine[]>(request, '/__log'))).toBe(n0 + 1);
  const [still] = await tokens();
  expect(still.rt).toBe(now.rt);
});

test('deal file links the Xero quote and invoice with the RFI and Release entries', async ({ page, request }) => {
  test.setTimeout(180_000);
  const quote = data.quotes.find((q) => q.QuoteNumber === 'QU-0101')!;
  const invoice = data.invoices.find((i) => i.InvoiceNumber === 'INV-9001')!;
  expect(invoice.Reference).toBe('0101');

  await page.goto('/f/request-for-invoice');
  await page.getByLabel('Quote no').fill('0101');
  await page.getByLabel('First').fill('Dealfile');
  await page.getByLabel('Last').fill('Customer');
  await attach(page, '_1stDeposit', PDF);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(THANKS)).toBeVisible();
  const [rfi] = await sql<{ id: string }>(`select e.id from entries e join forms f on f.id = e.form_id where f.slug = 'request-for-invoice' and e.summary = 'Dealfile Customer'`);

  await page.goto('/f/release-form');
  await page.getByLabel('VIN NO').fill('SYNTHVIN00000101');
  await page.getByLabel('INV NO').fill('INV-9001');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(THANKS)).toBeVisible();
  const [release] = await sql<{ id: string }>(`select e.id from entries e join forms f on f.id = e.form_id where f.slug = 'release-form' and e.summary = 'SYNTHVIN00000101'`);

  // A full sync queues and runs the deal-file rebuild.
  const res = await job(request, 'xero-sync', { mode: 'full' });
  expect(res.status()).toBe(200);
  await drainOutbox(request);

  const files = await sql<{ quote_id: string; invoice_ids: string[]; invoice_numbers: string[]; rfi_entry_id: string; release_entry_id: string; vin: string; customer_name: string }>(
    `select quote_id, invoice_ids, invoice_numbers, rfi_entry_id, release_entry_id, vin, customer_name from deal_files where org_id = $1 and quote_no = '0101'`, [ORG]);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({
    quote_id: quote.QuoteID,
    invoice_ids: [invoice.InvoiceID],
    invoice_numbers: ['INV-9001'],
    rfi_entry_id: rfi.id,
    release_entry_id: release.id,
    vin: 'SYNTHVIN00000101',
  });
  expect(files[0].customer_name).toContain('Dealfile');

  // Rebuilding again changes nothing (idempotent).
  await job(request, 'xero-sync', { mode: 'full' });
  await drainOutbox(request);
  expect(await sql(`select 1 from deal_files where org_id = $1 and quote_no = '0101'`, [ORG])).toHaveLength(1);
});

test('no writes: the mock saw only GETs to the Accounting API', async ({ request }) => {
  const log = await mock<LogLine[]>(request, '/__log');
  expect(log.filter((l) => l.api && l.method === 'GET').length).toBeGreaterThan(5);
  expect(log.filter((l) => l.api && l.method !== 'GET')).toEqual([]);
  // The only non-GETs at all are token requests to the identity server.
  expect([...new Set(log.filter((l) => l.method !== 'GET').map((l) => l.path))]).toEqual(['/connect/token']);

  // The detector works: a write would be refused and recorded.
  const put = await request.put(`${XERO_URL}/api.xro/2.0/Invoices`, { data: {} });
  expect(put.status()).toBe(405);
  const after = await mock<LogLine[]>(request, '/__log');
  expect(after.filter((l) => l.api && l.method !== 'GET')).toEqual([{ method: 'PUT', path: '/api.xro/2.0/Invoices', api: true }]);
});

test('actions page: an action without Xero writes set to dry run says it currently does nothing', async ({ page }) => {
  const key = 'xero.action.release.on_paid';
  const prior = await sql<{ value: unknown }>(`select value from public.app_settings where org_id = $1 and key = $2`, [ORG, key]);
  await sql(`insert into public.app_settings(org_id, key, value) values ($1, $2, $3::jsonb) on conflict (org_id, key) do update set value = excluded.value`, [ORG, key, JSON.stringify('dry_run')]);
  try {
    await signIn(page);
    await page.goto('/admin/integrations/xero/actions'); // a cold dev compile can outlast signIn's URL wait
    const release = page.getByTestId('action-release.on_paid');
    await expect(release.getByTestId('dry-run-note-release.on_paid')).toContainText('currently does nothing');
    await expect(release).toContainText('no Xero writes; dry run only records the entries/emails it would make, live applies them');
    await expect(release).not.toContainText('behave the same');
    // Off, or an action that records Xero requests in dry run: no note.
    await expect(page.getByTestId('dry-run-note-deal.import_quote')).toHaveCount(0);
    await expect(page.getByTestId('dry-run-note-rfi.create_invoice')).toHaveCount(0);
  } finally {
    if (prior.length) await sql(`update public.app_settings set value = $3::jsonb where org_id = $1 and key = $2`, [ORG, key, JSON.stringify(prior[0].value)]);
    else await sql(`delete from public.app_settings where org_id = $1 and key = $2`, [ORG, key]);
  }
});
