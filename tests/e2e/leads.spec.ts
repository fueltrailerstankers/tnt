import { expect, test, type APIRequestContext } from '@playwright/test';
import { signIn, sql } from './helpers';
import { E2E_XERO } from './xero-env';

// M4 leads inbox. Synthetic data only (example.invalid addresses, made-up names and numbers).
const SECRET = 'test-only-leads-webhook-secret-000000000'; // matches playwright.config.ts; not a real secret
const ORG = '00000000-0000-0000-0000-000000000001';
const run = `${Date.now()}`;

const post = (request: APIRequestContext, body: unknown, secret: string | null = SECRET) =>
  request.post('/api/webhooks/leads', { data: body, headers: secret === null ? {} : { 'x-leads-secret': secret } });

const eventStatus = async (sourceId: string) =>
  (await sql<{ status: string }>(`select status from public.integration_events where source = 'leads' and payload->>'source_id' = $1`, [sourceId]))[0]?.status ?? null;

/** The webhook only stores and queues; run the outbox (as the scheduler does) until the event is done. */
async function drainUntilDone(request: APIRequestContext, sourceId: string) {
  await expect.poll(async () => {
    const res = await request.post('/api/jobs/outbox', { headers: { Authorization: `Bearer ${E2E_XERO.JOB_SECRET}` } });
    expect(res.status()).toBe(200);
    return eventStatus(sourceId);
  }, { timeout: 20_000, intervals: [100, 250, 500] }).toBe('processed');
}

test('a test lead lands once, is routed and emailed once; a repeat post is a no-op', async ({ request }) => {
  const body = { source: 'test', source_id: `e2e-${run}-1`, name: 'Test Prospect', email: `prospect-${run}@example.invalid`, phone: '+27 82 555 0101', product: 'Fuel trailer' };

  const first = await post(request, body);
  expect(first.status()).toBe(200);
  expect(await first.json()).toEqual({ ok: true, duplicate: false });
  // Stored raw and queued; the lead is made by the leads.intake job.
  const [ev] = await sql<{ id: string }>(`select id from public.integration_events where source = 'leads' and payload->>'source_id' = $1`, [body.source_id]);
  expect(await sql(`select 1 from public.outbox_jobs where queue = 'leads.intake' and payload->>'event_id' = $1`, [ev.id])).toHaveLength(1);
  await drainUntilDone(request, body.source_id);

  const leads = await sql<{ id: string; status: string; routing_rule_id: string | null; email_norm: string; phone_norm: string }>(
    `select id, status, routing_rule_id, email_norm, phone_norm from public.leads where org_id = $1 and source = 'test' and external_id = $2`, [ORG, body.source_id]);
  expect(leads).toHaveLength(1);
  const lead = leads[0];
  expect(lead.status).toBe('new');
  expect(lead.routing_rule_id).not.toBeNull();
  expect(lead.email_norm).toBe(body.email);
  expect(lead.phone_norm).toBe('825550101');

  const kinds = async () => (await sql<{ kind: string }>(`select kind from public.lead_events where lead_id = $1 order by kind`, [lead.id])).map((r) => r.kind);
  expect(await kinds()).toEqual(['created', 'emailed', 'routed']);

  const emails = await sql<{ status: string; to_addresses: string[]; event_key: string; subject: string }>(
    `select status, to_addresses, event_key, subject from public.email_log where lead_id = $1`, [lead.id]);
  expect(emails).toHaveLength(1);
  expect(emails[0].status).toBe('skipped'); // log-only mode: no RESEND_API_KEY
  expect(emails[0].event_key).toBe('leads.new');
  expect(emails[0].to_addresses).toEqual(['sales@example.invalid']);
  expect(emails[0].subject).not.toContain('Prospect');

  const again = await post(request, { ...body, name: 'Changed Name' });
  expect(again.status()).toBe(200);
  expect(await again.json()).toEqual({ ok: true, duplicate: true });
  expect(await sql(`select 1 from public.leads where org_id = $1 and source = 'test' and external_id = $2`, [ORG, body.source_id])).toHaveLength(1);
  expect(await sql(`select 1 from public.email_log where lead_id = $1`, [lead.id])).toHaveLength(1);
  expect(await sql(`select 1 from public.integration_events where source = 'leads' and payload->>'source_id' = $1`, [body.source_id])).toHaveLength(1);

  // An invalid re-post is refused and never touches the stored event.
  const invalid = await post(request, { source: 'test', source_id: body.source_id, name: 'No Contact' });
  expect(invalid.status()).toBe(400);
  expect(await sql(`select status, payload->>'email' as email from public.integration_events where id = $1`, [ev.id])).toEqual([{ status: 'processed', email: body.email }]);

  // A partial failure (routed and emailed events missing, event failed): a retry of the same source_id
  // re-queues it, the job completes only the missing stages, and the email is not sent again.
  await sql(`delete from public.lead_events where lead_id = $1 and kind in ('routed', 'emailed')`, [lead.id]);
  await sql(`update public.integration_events set status = 'failed' where id = $1`, [ev.id]);
  const retry = await post(request, body);
  expect(retry.status()).toBe(200);
  expect(await retry.json()).toEqual({ ok: true, duplicate: true });
  await drainUntilDone(request, body.source_id);
  expect(await kinds()).toEqual(['created', 'emailed', 'routed']);
  expect(await sql(`select 1 from public.email_log where lead_id = $1`, [lead.id])).toHaveLength(1);
  expect(await sql(`select 1 from public.leads where org_id = $1 and source = 'test' and external_id = $2`, [ORG, body.source_id])).toHaveLength(1);
});

test('wrong or missing secret is 401 and stores nothing; bad payloads are 400; oversized is 413', async ({ request }) => {
  const body = { source: 'test', source_id: `e2e-${run}-401`, email: `nobody-${run}@example.invalid` };
  expect((await post(request, body, 'x'.repeat(40))).status()).toBe(401);
  expect((await post(request, body, null)).status()).toBe(401);
  expect(await sql(`select 1 from public.integration_events where payload->>'source_id' = $1`, [body.source_id])).toHaveLength(0);
  expect(await sql(`select 1 from public.leads where external_id = $1`, [body.source_id])).toHaveLength(0);

  expect((await post(request, { ...body, source: 'manual' })).status()).toBe(400);
  expect((await post(request, { ...body, message: 'x'.repeat(70 * 1024) })).status()).toBe(413);
  expect(await sql(`select 1 from public.integration_events where payload->>'source_id' = $1`, [body.source_id])).toHaveLength(0);

  const badId = `e2e-${run}-400`;
  const noContact = await post(request, { source: 'test', source_id: badId, name: 'No Contact' });
  expect(noContact.status()).toBe(400);
  expect(await eventStatus(badId)).toBe('ignored');
  expect(await sql(`select error from public.integration_events where source = 'leads' and payload->>'source_id' = $1 and processed_at is not null`, [badId])).toEqual([{ error: 'invalid: email' }]);
  expect(await sql(`select 1 from public.outbox_jobs j join public.integration_events e on e.id::text = j.payload->>'event_id' where e.payload->>'source_id' = $1`, [badId])).toHaveLength(0);
  expect(await sql(`select 1 from public.leads where external_id = $1`, [badId])).toHaveLength(0);

  // A corrected re-post of an ignored payload is accepted, not reported as a duplicate.
  const fixed = await post(request, { source: 'test', source_id: badId, name: 'No Contact', email: `fixed-${run}@example.invalid` });
  expect(fixed.status()).toBe(200);
  expect(await fixed.json()).toEqual({ ok: true, duplicate: false });
  await drainUntilDone(request, badId);
  expect(await sql(`select 1 from public.leads where external_id = $1`, [badId])).toHaveLength(1);
  expect(await sql(`select 1 from public.integration_events where source = 'leads' and payload->>'source_id' = $1`, [badId])).toHaveLength(1);
});

test('a lead whose email matches a Xero contact shows the matched quote', async ({ page, request }) => {
  const email = `buyer-${run}@example.invalid`;
  const contactId = `e2e-contact-${run}`;
  const quoteId = `e2e-quote-${run}`;
  const quoteNumber = `QU-E${run.slice(-6)}`;
  await sql(`insert into public.xero_contacts(org_id, tenant_id, contact_id, name, email, raw) values ($1,'e2e-tenant',$2,'Synthetic Buyer',$3,'{}')`, [ORG, contactId, email.toUpperCase()]);
  await sql(`insert into public.xero_quotes(org_id, tenant_id, quote_id, quote_number, quote_no, status, contact_id, contact_name, quote_date, currency_code, total, raw)
             values ($1,'e2e-tenant',$2,$3,$4,'SENT',$5,'Synthetic Buyer','2026-10-20','ZAR',125000,'{}')`, [ORG, quoteId, quoteNumber, quoteNumber.slice(3), contactId]);

  const res = await post(request, { source: 'website', source_id: `e2e-${run}-match`, form: 'Product Inquiry', name: 'Synthetic Buyer', email: ` ${email} ` });
  expect(res.status()).toBe(200);
  await drainUntilDone(request, `e2e-${run}-match`);
  const [lead] = await sql<{ id: string; matched_quote_id: string }>(`select id, matched_quote_id from public.leads where source = 'website' and external_id = $1`, [`e2e-${run}-match`]);
  expect(lead.matched_quote_id).toBe(quoteId);

  await signIn(page, `/admin/leads/${lead.id}`);
  const xero = page.getByTestId('lead-xero');
  await expect(xero.getByRole('link', { name: quoteNumber })).toHaveAttribute('href', `/admin/xero/quotes/${quoteId}`);
  await expect(xero).toContainText('Sent'); // Xero SENT, shown as users know it
});

test('manual lead creation, status change, assignment and a note from the inbox', async ({ page }) => {
  const name = `Walk-in Visitor ${run}`;
  await signIn(page, '/admin/leads');
  // Add lead opens the modal (the link also works as the /admin/leads/new page without JavaScript).
  await expect(page.getByRole('link', { name: 'Add lead' })).toHaveAttribute('href', '/admin/leads/new');
  await page.getByRole('link', { name: 'Add lead' }).click();
  const modal = page.getByRole('dialog', { name: 'Add lead' });
  await modal.getByLabel('Name').fill(name);
  await modal.getByLabel('Phone').fill('011 555 0123');
  await modal.getByLabel('Product / interest').fill('Water tanker');
  await modal.getByRole('button', { name: 'Save lead' }).click();

  await expect(page).toHaveURL(/\/admin\/leads\/[0-9a-f-]{36}$/);
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByTestId('lead-status')).toHaveText('New');
  const id = page.url().split('/').pop()!;
  const [row] = await sql<{ source: string; phone_norm: string }>(`select source, phone_norm from public.leads where id = $1`, [id]);
  expect(row).toEqual({ source: 'manual', phone_norm: '115550123' });
  expect(await sql(`select 1 from public.email_log where lead_id = $1`, [id])).toHaveLength(0); // manual: no notification

  await main.getByLabel('Status').selectOption('contacted');
  await main.getByRole('button', { name: 'Set status' }).click();
  await expect(page.getByTestId('lead-status')).toHaveText('Contacted');

  await main.getByLabel('Assign to').selectOption({ label: 'Test Admin' });
  await main.getByRole('button', { name: 'Assign' }).click();
  await expect(main.getByRole('status').filter({ hasText: 'Lead assigned.' })).toBeVisible();
  await expect(main.getByLabel('Assign to').locator('option:checked')).toHaveText('Test Admin');

  await main.getByLabel('Add a note').fill('Called back, wants a quote.');
  await main.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByTestId('lead-notes')).toContainText('Called back, wants a quote.');
  await expect(page.getByTestId('lead-timeline')).toContainText('Note added');

  const audits = await sql<{ action: string; meta: Record<string, unknown> }>(`select action, meta from public.audit_log where entity = 'lead' and entity_id = $1 order by id`, [id]);
  expect(audits.map((a) => a.action)).toEqual(['lead.create', 'lead.status', 'lead.assign']);
  expect(audits[1].meta).toEqual({ from: 'new', to: 'contacted' });
  expect(JSON.stringify(audits)).not.toContain('Walk-in');

  await page.goto(`/admin/leads?status=contacted&q=${encodeURIComponent(`visitor ${run}`)}`);
  await expect(page.getByTestId('lead-row')).toHaveCount(1);
});
