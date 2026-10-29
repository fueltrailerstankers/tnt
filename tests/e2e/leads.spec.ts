import { expect, test } from '@playwright/test';
import { signIn, sql } from './helpers';

// M4 leads inbox. Synthetic data only (example.invalid addresses, made-up names and numbers).
const SECRET = 'test-only-leads-webhook-secret-000000000'; // matches playwright.config.ts; not a real secret
const ORG = '00000000-0000-0000-0000-000000000001';
const run = `${Date.now()}`;

const post = (request: import('@playwright/test').APIRequestContext, body: unknown, secret: string | null = SECRET) =>
  request.post('/api/webhooks/leads', { data: body, headers: secret === null ? {} : { 'x-leads-secret': secret } });

test('a test lead lands once, is routed and emailed once; a repeat post is a no-op', async ({ request }) => {
  const body = { source: 'test', source_id: `e2e-${run}-1`, name: 'Test Prospect', email: `prospect-${run}@example.invalid`, phone: '+27 82 555 0101', product: 'Fuel trailer' };

  const first = await post(request, body);
  expect(first.status()).toBe(200);
  expect(await first.json()).toEqual({ ok: true, duplicate: false });

  const leads = await sql<{ id: string; status: string; routing_rule_id: string | null; email_norm: string; phone_norm: string }>(
    `select id, status, routing_rule_id, email_norm, phone_norm from public.leads where org_id = $1 and source = 'test' and external_id = $2`, [ORG, body.source_id]);
  expect(leads).toHaveLength(1);
  const lead = leads[0];
  expect(lead.status).toBe('new');
  expect(lead.routing_rule_id).not.toBeNull();
  expect(lead.email_norm).toBe(body.email);
  expect(lead.phone_norm).toBe('825550101');

  const kinds = (await sql<{ kind: string }>(`select kind from public.lead_events where lead_id = $1 order by created_at`, [lead.id])).map((r) => r.kind);
  expect(kinds).toEqual(expect.arrayContaining(['created', 'routed', 'emailed']));

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
});

test('wrong or missing secret is 401 and stores nothing; bad payloads are 400', async ({ request }) => {
  const body = { source: 'test', source_id: `e2e-${run}-401`, email: `nobody-${run}@example.invalid` };
  expect((await post(request, body, 'x'.repeat(40))).status()).toBe(401);
  expect((await post(request, body, null)).status()).toBe(401);
  expect(await sql(`select 1 from public.integration_events where payload->>'source_id' = $1`, [body.source_id])).toHaveLength(0);
  expect(await sql(`select 1 from public.leads where external_id = $1`, [body.source_id])).toHaveLength(0);

  expect((await post(request, { ...body, source: 'manual' })).status()).toBe(400);
  const noContact = await post(request, { source: 'test', source_id: `e2e-${run}-400`, name: 'No Contact' });
  expect(noContact.status()).toBe(400);
  expect(await sql(`select 1 from public.leads where external_id = $1`, [`e2e-${run}-400`])).toHaveLength(0);
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
  const [lead] = await sql<{ id: string; matched_quote_id: string }>(`select id, matched_quote_id from public.leads where source = 'website' and external_id = $1`, [`e2e-${run}-match`]);
  expect(lead.matched_quote_id).toBe(quoteId);

  await signIn(page, `/admin/leads/${lead.id}`);
  const xero = page.getByTestId('lead-xero');
  await expect(xero.getByRole('link', { name: quoteNumber })).toHaveAttribute('href', `/admin/xero/quotes/${quoteId}`);
  await expect(xero).toContainText('SENT');
});

test('manual lead creation, status change, assignment and a note from the inbox', async ({ page }) => {
  const name = `Walk-in Visitor ${run}`;
  await signIn(page, '/admin/leads');
  await page.getByRole('link', { name: 'New lead' }).click();
  await expect(page).toHaveURL(/\/admin\/leads\/new$/);
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Phone').fill('011 555 0123');
  await page.getByLabel('Product / interest').fill('Water tanker');
  await page.getByRole('button', { name: 'Create lead' }).click();

  await expect(page).toHaveURL(/\/admin\/leads\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByTestId('lead-status')).toHaveText('new');
  const id = page.url().split('/').pop()!;
  const [row] = await sql<{ source: string; phone_norm: string }>(`select source, phone_norm from public.leads where id = $1`, [id]);
  expect(row).toEqual({ source: 'manual', phone_norm: '115550123' });
  expect(await sql(`select 1 from public.email_log where lead_id = $1`, [id])).toHaveLength(0); // manual: no notification

  await page.getByLabel('Status').selectOption('contacted');
  await page.getByRole('button', { name: 'Set status' }).click();
  await expect(page.getByTestId('lead-status')).toHaveText('contacted');

  await page.getByLabel('Assign to').selectOption({ label: 'Test Admin' });
  await page.getByRole('button', { name: 'Assign' }).click();
  await expect(page.getByText('Assigned toTest Admin')).toBeVisible();

  await page.getByLabel('Add a note').fill('Called back, wants a quote.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByTestId('lead-timeline')).toContainText('Called back, wants a quote.');

  const audits = await sql<{ action: string; meta: Record<string, unknown> }>(`select action, meta from public.audit_log where entity = 'lead' and entity_id = $1 order by id`, [id]);
  expect(audits.map((a) => a.action)).toEqual(['lead.create', 'lead.status', 'lead.assign']);
  expect(audits[1].meta).toEqual({ from: 'new', to: 'contacted' });
  expect(JSON.stringify(audits)).not.toContain('Walk-in');

  await page.goto(`/admin/leads?status=contacted&q=${encodeURIComponent(`visitor ${run}`)}`);
  await expect(page.getByTestId('lead-row')).toHaveCount(1);
});
