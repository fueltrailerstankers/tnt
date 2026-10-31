import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { attach, PDF, sign, signIn, sql } from './helpers';

// Entry detail (handoff EntryDetail.dc.html, StoreRoom.dc.html): status card with stepper and role actions, timeline
// with field names only, 60-second file previews, emails, PDF versions, Store Room flow, protected fields with an
// audited reveal, and the decrypt audit for encrypted forms. Synthetic data only; rows are scoped by this run's id.

const THANKS = 'Thank you for filling out the form. Your response has been recorded.';
const run = Date.now().toString(36).slice(-6).toUpperCase();

async function signInAs(page: Page, email: string, password: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, '\\$&')}$`), { timeout: 30_000 });
}

/** The e2e app's test-only entry key (32 bytes of 0x07, see playwright.config.ts); AAD = entry id, as sealData does. */
function sealForTest(entryId: string, data: unknown): string {
  const key = Buffer.alloc(32, 7);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(entryId));
  const body = Buffer.concat([c.update(Buffer.from(JSON.stringify(data))), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), body]).toString('hex');
}

async function submitInspection(page: Page, last: string) {
  await page.goto('/f/trailer-inspection-checklist');
  await page.getByLabel('TRAILER VIN NUMBER').fill(`TESTVIN${run}0001`.slice(0, 17));
  await page.getByLabel('First').fill('Detail');
  await page.getByLabel('Last').fill(last);
  await page.getByLabel('Inspector Email').fill('inspector@example.invalid');
  await page.locator('input[name="cl.1.pass"]').check();
  await page.locator('input[name="cl.2.fail"]').check();
  await page.locator('textarea[name="cl.2.comments"]').fill(`Secret comment ${run}`);
  await sign(page, 'InspectorSignature');
  await page.getByRole('button', { name: 'SubmitInspection' }).click();
  await expect(page.getByText(THANKS)).toBeVisible();
  const [e] = await sql<{ id: string; number: number }>(
    `select e.id, e.number from entries e join forms f on f.id = e.form_id where f.slug = 'trailer-inspection-checklist' and e.summary = $1`, [`Detail ${last}`]);
  return e;
}

test.describe('desktop (1440)', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('Inspection: status stepper, rail action, timeline names only, emails', async ({ page }) => {
    const e = await submitInspection(page, `Rail${run}`);
    await signIn(page, `/admin/forms/trailer-inspection-checklist/entries/${e.number}`);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText(`Trailer Inspection Checklist #${e.number}`);
    await expect(page.getByTestId('entry-status')).toHaveText('Submitted');
    const steps = main.getByRole('list', { name: 'Status progress' });
    await expect(steps.getByRole('listitem')).toHaveText(['Submitted (current status)', 'Reviewed (not reached)', 'Approved (not reached)']);
    // Rail actions use readable labels; the form keeps its spec-named buttons.
    await expect(main.getByRole('button', { name: 'Request review changes' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'RequestReviewChanges' })).toBeVisible();
    await main.getByRole('button', { name: 'Mark reviewed' }).click();
    await expect(page.getByTestId('entry-status')).toHaveText('Reviewed');
    await expect(page.getByText('Saved. Status: Reviewed')).toBeVisible();
    await expect(steps.getByRole('listitem').first()).toHaveText('Submitted (done)');
    await expect(page.getByTestId('timeline')).toContainText('MarkReviewed → Reviewed');
    await expect(page.getByTestId('timeline')).toContainText('SubmitInspection → Submitted');
    await expect(page.getByTestId('timeline')).not.toContainText(`Secret comment ${run}`);
    await expect(main.getByText('Field names only. Values are never stored in the timeline.')).toBeVisible();
    await expect(page.getByTestId('emails')).toContainText('Trailer Inspection Reviewed');
    await expect(page.getByTestId('emails')).toContainText('inspector@example.invalid');
    await expect(main.getByRole('button', { name: 'Approve inspection' })).toBeVisible();
    // The PDF card lists the current download link.
    await expect(main.getByRole('link', { name: 'Entry PDF (PDF)' })).toHaveAttribute('href', `/admin/forms/trailer-inspection-checklist/entries/${e.number}/documents/1`);
  });

  test('Store Room: archived → APPROVAL → APPROVED EMAILED flow, Mark button, below-minimum card', async ({ page }) => {
    const note = `Detail stock note ${run}`;
    await page.goto('/f/store-room');
    await page.locator('#f-_14INCX5HoleTIRESMIN50').fill('3');
    await page.locator('input[name="f.OTHER"]').fill(note);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText(THANKS)).toBeVisible();
    const [e] = await sql<{ id: string; number: number }>(
      `select e.id, e.number from entries e join forms f on f.id = e.form_id where f.slug = 'store-room' and e.data->>'OTHER' = $1`, [note]);

    await signIn(page, `/admin/forms/store-room/entries/${e.number}`);
    const main = page.getByRole('main');
    await expect(main.getByRole('list', { name: 'Status flow' }).getByRole('listitem')).toHaveText([
      'Submitted (archived) (done)', 'APPROVAL (current status)', 'APPROVED EMAILED (not reached)',
    ]);
    const low = page.getByTestId('below-minimum');
    await expect(low).toContainText('Below minimum · ');
    await expect(low).toContainText('14INC x 5 hole TIRES MIN 50');
    await expect(low).toContainText('3 / 50');
    await expect(main.getByText('Set manually after the order email has gone to suppliers.')).toBeVisible();
    await main.getByRole('button', { name: 'Mark APPROVED EMAILED' }).click();
    await expect(page.getByTestId('entry-status')).toHaveText('APPROVED EMAILED');
    await expect(page.getByTestId('timeline')).toContainText('SetStatus → APPROVED EMAILED');
    await expect(main.getByRole('button', { name: 'Mark APPROVED EMAILED' })).toHaveCount(0);
    expect(await sql(`select meta from audit_log where action = 'entry.status' and entity_id = $1`, [e.id])).toEqual([{ meta: { from: 'APPROVAL', to: 'APPROVED EMAILED' } }]);
  });

  test('DEAL (encrypted): opening is audited; file preview is a 60-second signed link; PDF versions with sha256', async ({ page }) => {
    const quote = `QDET-${run}`;
    await page.goto('/f/deal');
    await page.getByLabel('QUOTE NO').fill(quote);
    await page.getByLabel('Total').fill('100');
    await attach(page, 'POP', PDF);
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText(THANKS)).toBeVisible();
    const [e] = await sql<{ id: string; number: number }>(`select e.id, e.number from entries e join forms f on f.id = e.form_id where f.slug = 'deal' and e.summary = $1`, [quote]);

    await signIn(page, `/admin/forms/deal/entries/${e.number}`);
    const main = page.getByRole('main');
    await expect(main.getByText('Encrypted', { exact: true })).toBeVisible();
    const audits = await sql<{ meta: Record<string, unknown>; actor_user: string | null }>(`select meta, actor_user from audit_log where action = 'entry.decrypt' and entity_id = $1`, [e.id]);
    expect(audits.length).toBeGreaterThan(0);
    expect(audits[0]).toEqual({ meta: { form: 'deal', number: e.number, via: 'page' }, actor_user: '00000000-0000-0000-0000-00000000a001' });

    // Files: Preview -> "Signed link · expires in 60 s" and an Open link to a signed URL.
    await main.getByRole('button', { name: 'Preview proof.pdf' }).click();
    await expect(main.getByText('Signed link · expires in 60 s')).toBeVisible();
    await expect(main.getByRole('link', { name: 'Open proof.pdf (signed link, new tab)' })).toHaveAttribute('href', /\/storage\/v1\/object\/sign\//);

    // Generate the entry PDF, then it is listed as v1 with its sha256 truncated.
    const res = await page.request.get(`/admin/forms/deal/entries/${e.number}/documents/1`);
    expect(res.status()).toBe(200);
    expect(await sql(`select 1 from audit_log where action = 'entry.decrypt' and entity_id = $1 and meta->>'via' = 'document'`, [e.id])).not.toHaveLength(0);
    const [doc] = await sql<{ sha256: string }>(`select sha256 from entry_documents where entry_id = $1 and template_number = 1 order by created_at desc limit 1`, [e.id]);
    await page.reload();
    const versions = page.getByTestId('pdf-versions');
    await expect(versions).toContainText('v1');
    await expect(versions).toContainText(`sha256 ${doc.sha256.slice(0, 4)}…${doc.sha256.slice(-4)}`);
    await expect(versions).not.toContainText(doc.sha256);
  });

  test('Delivery Note: protected email masked, never in the page; admin reveal is audited; recipients masked; staff cannot reveal or delete', async ({ page, browser }) => {
    const id = randomUUID();
    const email = `protected.${run.toLowerCase()}@example.invalid`;
    const vin = `TESTVINDN${run}`.slice(0, 17);
    const [e] = await sql<{ number: number }>(
      `insert into entries(id, form_id, number, status, data, data_encrypted, summary, submitted_at)
       select $1, id, 0, 'Submitted', '{}'::jsonb, decode($2, 'hex'), $3, now() from forms where slug = 'delivery-note' returning number`,
      [id, sealForTest(id, { Email: email, TrailerVinNO: vin, InvoiceNo: 'INV-TEST-DN' }), vin]);
    await sql(`insert into entry_events(entry_id, action, to_status, actor_role, diff) values ($1, 'Submit', 'Submitted', 'Public', '{"changed":["Email","TrailerVinNO"]}')`, [id]);
    await sql(`insert into email_log(entry_id, action, to_addresses, subject, status) values ($1, 'Submit', $2, 'Delivery note signed', 'sent')`, [id, [email, 'sales@example.invalid']]);

    const url = `/admin/forms/delivery-note/entries/${e.number}`;
    await signIn(page, url);
    const main = page.getByRole('main');
    expect(await page.content()).not.toContain(email);
    const field = main.locator('#protected-Email');
    await expect(field).toHaveValue(/^p•+\w@example\.invalid$/);
    await expect(page.getByTestId('emails')).not.toContainText(email);
    await expect(page.getByTestId('emails')).toContainText('sales@example.invalid');
    // Timeline: field names only.
    await expect(page.getByTestId('timeline')).toContainText('changed fields: Email, Trailer Vin NO');
    await expect(page.getByTestId('timeline')).not.toContainText(vin);

    await main.getByRole('button', { name: 'Reveal' }).click();
    await expect(field).toHaveValue(email);
    const rows = await sql<{ meta: Record<string, unknown> }>(`select meta from audit_log where action = 'entry.reveal' and entity_id = $1`, [id]);
    expect(rows).toEqual([{ meta: { form: 'delivery-note', fields: ['Email'] } }]);
    await main.getByRole('button', { name: 'Hide' }).click();
    await expect(field).not.toHaveValue(email);

    // A staff member (not admin): masked, no Reveal, no Delete.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const staff = await ctx.newPage();
    await signInAs(staff, 'staff-m8@example.invalid', 'correct-horse-battery', url);
    await expect(staff.getByRole('main').locator('#protected-Email')).toHaveValue(/^p•+\w@example\.invalid$/);
    await expect(staff.getByRole('main').getByRole('button', { name: 'Reveal' })).toHaveCount(0);
    await expect(staff.getByRole('main').getByRole('button', { name: 'Delete entry…' })).toHaveCount(0);
    expect(await staff.content()).not.toContain(email);
    await ctx.close();
  });

  test('Delete: the server refusal shows "The number did not match."', async ({ page }) => {
    const e = await submitInspection(page, `Del${run}`);
    await signIn(page, `/admin/forms/trailer-inspection-checklist/entries/${e.number}?delete=confirm`);
    await expect(page.getByText('The number did not match.')).toBeVisible();
    await page.getByRole('button', { name: 'Delete entry…' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('phone (390)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('status card and actions sit above the long form', async ({ page }) => {
    const e = await submitInspection(page, `Phone${run}`);
    await signIn(page, `/admin/forms/trailer-inspection-checklist/entries/${e.number}`);
    const main = page.getByRole('main');
    const status = main.getByRole('region', { name: 'Status', exact: true });
    const action = main.getByRole('button', { name: 'Mark reviewed' });
    await expect(action).toBeInViewport();
    const s = (await status.boundingBox())!;
    const f = (await main.locator('#entry-form form').boundingBox())!;
    expect(s.y + s.height).toBeLessThanOrEqual(f.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
