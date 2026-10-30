import { expect, test } from '@playwright/test';
import { attach, FAKE_PDF, PDF, PNG, sign, signIn, sql } from './helpers';

const THANKS = 'Thank you for filling out the form. Your response has been recorded.';

test('Job Card: public submit numbers the entry and logs the sales@ email (log-only)', async ({ page }) => {
  await page.goto('/f/job-card');
  await expect(page.getByRole('heading', { name: 'JOB CARD' })).toBeVisible();
  await expect(page.getByLabel('Untitled')).toBeVisible(); // Cognito quirk kept: the date label is "Untitled"
  await page.getByLabel('Quote no').fill('QTEST-1001');
  await page.getByLabel('Line 1').fill('Synthetic build line');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(THANKS)).toBeVisible();

  const [e] = await sql<{ id: string; number: number; status: string; summary: string }>(
    `select e.id, e.number, e.status, e.summary from entries e join forms f on f.id = e.form_id where f.slug = 'job-card' and e.summary = 'QTEST-1001'`);
  expect(e).toMatchObject({ status: 'Submitted', summary: 'QTEST-1001' });
  expect(e.number).toBeGreaterThan(0);
  const mails = await sql(`select to_addresses, status, event_key from email_log where entry_id = $1`, [e.id]);
  expect(mails).toEqual([{ to_addresses: ['sales@example.invalid'], status: 'skipped', event_key: 'job-card.Submit' }]);
  const ev = await sql(`select action, from_status, to_status, actor_role from entry_events where entry_id = $1`, [e.id]);
  expect(ev).toEqual([{ action: 'Submit', from_status: null, to_status: 'Submitted', actor_role: 'Public' }]);
});

test('Request For Invoice: blocks with NO PAYMENT LOADED, then saves with a deposit file', async ({ page }) => {
  await page.goto('/f/request-for-invoice');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('NO PAYMENT LOADED FORM NOT SUBMITTED')).toBeVisible();
  expect(await sql(`select 1 from entries e join forms f on f.id = e.form_id where f.slug = 'request-for-invoice'`)).toHaveLength(0);

  await page.getByLabel('First').fill('Test');
  await page.getByLabel('Last').fill('Customer');
  await attach(page, '_1stDeposit', PDF);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(THANKS)).toBeVisible();
  const files = await sql<{ field_key: string; content_type: string; storage_path: string }>(
    `select ef.field_key, ef.content_type, ef.storage_path from entry_files ef join entries e on e.id = ef.entry_id where e.summary = 'Test Customer'`);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({ field_key: '_1stDeposit', content_type: 'application/pdf' });
  expect(files[0].storage_path).toMatch(/^request-for-invoice\/[0-9a-f-]{36}\/_1stDeposit\//);
});

test('uploads are checked by content, not by name', async ({ page }) => {
  await page.goto('/f/request-for-invoice');
  await page.getByLabel('Quote no').fill('QTEST-2002');
  await attach(page, '_1stDeposit', FAKE_PDF);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('This file type is not allowed.')).toBeVisible();
  // The typed value survives the failed save.
  await expect(page.getByLabel('Quote no')).toHaveValue('QTEST-2002');
});

test('Store Room: three pages with Back/Next, Submit moves to APPROVAL and emails factory@', async ({ page }) => {
  await page.goto('/f/store-room');
  await page.getByLabel('14INC x 5 hole TIRES MIN 50').fill('42');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('group', { name: 'Page 2' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByLabel('14INC x 5 hole TIRES MIN 50')).toHaveValue('42');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('NUTS 12MM').fill('7');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(THANKS)).toBeVisible();

  const [e] = await sql<{ id: string; status: string }>(`select e.id, e.status from entries e join forms f on f.id = e.form_id where f.slug = 'store-room' order by e.created_at desc limit 1`);
  expect(e.status).toBe('APPROVAL');
  const mail = await sql(`select to_addresses, event_key from email_log where entry_id = $1`, [e.id]);
  expect(mail).toEqual([{ to_addresses: ['factory@example.invalid'], event_key: 'store-room.Submit' }]);
  // The Store Room PDF (document #1) was generated for the attachment.
  const docs = await sql<{ template_number: number; name: string }>(`select template_number, name from entry_documents where entry_id = $1`, [e.id]);
  expect(docs).toHaveLength(1);
  expect(docs[0]).toMatchObject({ template_number: 1, name: expect.stringMatching(/^STORE ROOM - \d+\.pdf$/) });
});

test('Delivery Note: VIN/email/invoice rules, signatures, photos, masked lookup, encrypted at rest, signed PDF stored', async ({ page }) => {
  // An RFI to look up (synthetic customer).
  await page.goto('/f/request-for-invoice');
  await page.getByLabel('Quote no').fill('QTEST-3003');
  await page.getByLabel('First').fill('Lookup');
  await page.getByLabel('Last').fill('Customer');
  await page.getByLabel('ID NO').fill('0000000000123');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(THANKS)).toBeVisible();

  // Five steps (handoff): each step blocks Next until its signatures are captured; signature 1 unlocks only
  // after the terms are scrolled to the end.
  await page.goto('/f/delivery-note');
  const next = page.getByRole('button', { name: 'Next' });
  await next.click(); // step 1 has no signatures
  await expect(page.getByRole('group', { name: 'Terms and warranty' })).toBeVisible();
  await expect(page.getByText('STANDARD TRADING TERMS AND CONDITIONS.')).toBeVisible();
  await next.click();
  await expect(page.getByText('Sign here to continue.').first()).toBeVisible();
  await expect(page.getByText('Scroll to the end of the terms above to sign.')).toBeVisible();
  await page.getByTestId('terms-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
  await expect(page.getByText('Read to the end')).toBeVisible();
  await sign(page, 'Signature4');
  await sign(page, 'Signature');
  await next.click();
  await expect(page.getByText('POLYURETHANE TANKS WAIVER')).toBeVisible();
  await sign(page, 'Signature2');
  await sign(page, 'Signature3');
  await next.click();
  await sign(page, 'SalesRepSignature');
  await next.click();
  await attach(page, 'Pic1FRONT', PNG);
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();

  // Server rules still apply: no VIN, no email, no invoice no. The summary lists them; the form jumps to step 1.
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Enter the Trailer VIN or an Email').first()).toBeVisible();
  await expect(page.getByText('Enter the Trailer VIN or the Invoice No').first()).toBeVisible();
  await expect(page.getByRole('group', { name: 'Trailer and customer' })).toBeVisible();

  await page.getByLabel('Trailer Vin NO').fill('TESTVIN0000000042');
  await page.getByLabel('Quote no:').fill('QTEST-3003');
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByTestId('customer-panel')).toContainText('Lookup C.');
  await expect(page.getByTestId('customer-panel')).not.toContainText('Lookup Customer');
  await expect(page.getByTestId('customer-panel')).toContainText('*********0123');
  await expect(page.getByTestId('customer-panel')).not.toContainText('0000000000123');

  for (let i = 0; i < 4; i++) await next.click(); // signatures are kept while moving between steps
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(THANKS)).toBeVisible();

  const [e] = await sql<{ id: string; data: object; data_encrypted: string | null; summary: string }>(
    `select e.id, e.data, encode(e.data_encrypted, 'hex') as data_encrypted, e.summary from entries e join forms f on f.id = e.form_id where f.slug = 'delivery-note'`);
  expect(e.summary).toBe('TESTVIN0000000042');
  expect(e.data).toEqual({}); // encrypted form: nothing readable in data
  expect(e.data_encrypted).toBeTruthy();
  expect(e.data_encrypted).not.toContain(Buffer.from('TESTVIN').toString('hex'));
  const sigs = await sql(`select field_key from entry_files where entry_id = $1 and kind = 'signature' order by field_key`, [e.id]);
  expect(sigs.map((s) => s.field_key)).toEqual(['SalesRepSignature', 'Signature', 'Signature2', 'Signature3', 'Signature4']);
  const docs = await sql<{ sha256: string; size_bytes: string }>(`select sha256, size_bytes from entry_documents where entry_id = $1 and template_number = 1`, [e.id]);
  expect(docs).toHaveLength(1);
  expect(docs[0].sha256).toMatch(/^[0-9a-f]{64}$/);
});

test('inactive forms are not reachable publicly', async ({ page }) => {
  await sql(`update forms set is_active = false where slug = 'release-form'`);
  try {
    const res = await page.goto('/f/release-form');
    expect(res?.status()).toBe(404);
  } finally {
    await sql(`update forms set is_active = true where slug = 'release-form'`);
  }
});

test('DEAL: defaults, multi-choice, POP upload, manual Total; encrypted at rest; deal and collection sheets', async ({ page }) => {
  await page.goto('/f/deal');
  await expect(page.getByLabel('MONTH')).toHaveValue('JAN');
  await expect(page.getByLabel('SALES REP')).toHaveValue('MELINDA');
  await page.getByLabel('MONTH').selectOption('MARCH');
  await page.getByLabel('CPT').check();
  await page.getByLabel('JHB').check();
  await page.getByLabel('QUOTE NO').fill('QTEST-5005');
  await page.getByLabel('PART NO 1').fill('1000DB');
  await page.getByLabel('LINE 1', { exact: true }).fill('1000 litre metal bowser');
  await page.getByLabel('Total').fill('12345');
  await attach(page, 'POP', PDF);
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(THANKS)).toBeVisible();

  const [e] = await sql<{ number: number; data: object; summary: string }>(
    `select e.number, e.data, e.summary from entries e join forms f on f.id = e.form_id where f.slug = 'deal' and e.summary = 'QTEST-5005'`);
  expect(e.data).toEqual({});
  // DEAL sends no emails in Cognito.
  expect(await sql(`select 1 from email_log l join entries e on e.id = l.entry_id where e.summary = 'QTEST-5005'`)).toHaveLength(0);

  await signIn(page, `/admin/forms/deal/entries/${e.number}`);
  await expect(page.getByRole('main').getByLabel('QUOTE NO')).toHaveValue('QTEST-5005'); // decrypted for staff
  await expect(page.getByLabel('CPT')).toBeChecked();
  for (const t of [1, 3, 4]) {
    const res = await page.request.get(`/admin/forms/deal/entries/${e.number}/documents/${t}`);
    expect(res.status()).toBe(200);
    expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
  }
});
