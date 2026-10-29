import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { sign, signIn, sql } from './helpers';

const THANKS = 'Thank you for filling out the form. Your response has been recorded.';

test('Inspection runs Submitted -> Reviewed -> Approved with an email at each step', async ({ page }) => {
  // 1. Inspector submits from the public link.
  await page.goto('/f/trailer-inspection-checklist');
  await expect(page.getByRole('button', { name: 'SubmitInspection' })).toBeVisible();
  await page.getByLabel('TRAILER VIN NUMBER').fill('TESTVIN0000000777');
  await page.getByLabel('First').fill('Test');
  await page.getByLabel('Last').fill('Inspector');
  await page.getByLabel('Inspector Email').fill('inspector@example.invalid');
  await page.locator('input[name="cl.1.pass"]').check();
  await page.locator('input[name="cl.2.fail"]').check();
  await page.locator('textarea[name="cl.2.comments"]').fill('Loose U-bolt');
  await sign(page, 'InspectorSignature');
  await page.getByRole('button', { name: 'SubmitInspection' }).click();
  await expect(page.getByText(THANKS)).toBeVisible();

  const [e] = await sql<{ id: string; number: number; status: string }>(
    `select e.id, e.number, e.status from entries e join forms f on f.id = e.form_id where f.slug = 'trailer-inspection-checklist' and e.summary = 'Test Inspector'`);
  expect(e.status).toBe('Submitted');
  const submitted = await sql(`select subject, to_addresses from email_log where entry_id = $1`, [e.id]);
  expect(submitted).toEqual([{ subject: 'Trailer Inspection Submitted', to_addresses: ['sales@example.invalid'] }]);

  // 2. Reviewer: the task shows up, Mark Reviewed emails the inspector a role link.
  await signIn(page, '/admin/tasks');
  await expect(page.getByTestId('tasks-trailer-inspection-checklist')).toContainText(`#${e.number} Test Inspector`);
  await page.goto(`/admin/forms/trailer-inspection-checklist/entries/${e.number}`);
  await expect(page.getByTestId('entry-status')).toHaveText('Submitted');
  await expect(page.locator('input[name="cl.2.fail"]')).toBeChecked();
  await expect(page.getByRole('button', { name: 'RequestReviewChanges' })).toBeVisible();
  await page.getByRole('button', { name: 'MarkReviewed' }).click();
  await expect(page.getByTestId('entry-status')).toHaveText('Reviewed');
  await expect(page.getByTestId('emails')).toContainText('Trailer Inspection Reviewed');
  await expect(page.getByTestId('emails')).toContainText('inspector@example.invalid');

  // 3. Approve.
  await page.getByRole('button', { name: 'ApproveInspection' }).click();
  await expect(page.getByTestId('entry-status')).toHaveText('Approved');
  await expect(page.getByText('No action is available for this entry at its current status.')).toBeVisible();

  const mails = await sql<{ subject: string }>(`select subject from email_log where entry_id = $1 order by id`, [e.id]);
  expect(mails.map((m) => m.subject)).toEqual(['Trailer Inspection Submitted', 'Trailer Inspection Reviewed', 'Trailer Inspection Approved']);
  const events = await sql<{ action: string; to_status: string; actor_role: string }>(`select action, to_status, actor_role from entry_events where entry_id = $1 order by id`, [e.id]);
  expect(events).toEqual([
    { action: 'SubmitInspection', to_status: 'Submitted', actor_role: 'Inspector' },
    { action: 'MarkReviewed', to_status: 'Reviewed', actor_role: 'Form Creator / Internal Reviewer' },
    { action: 'ApproveInspection', to_status: 'Approved', actor_role: 'Form Creator / Internal Reviewer' },
  ]);
  // Inspector role links are stored hashed (64 hex chars), never as the raw token.
  const links = await sql<{ token: string; role_name: string; revoked: boolean }>(
    `select token, role_name, revoked_at is not null as revoked from entry_links where entry_id = $1 order by created_at`, [e.id]);
  expect(links.length).toBe(2);
  for (const l of links) expect(l).toMatchObject({ role_name: 'Inspector', token: expect.stringMatching(/^[0-9a-f]{64}$/) });
  // Only the newest inspector link works.
  expect(links.map((l) => l.revoked)).toEqual([true, false]);
});

test('Inspector role link opens the entry read-only once it has moved on; bad tokens are refused', async ({ page }) => {
  const [e] = await sql<{ id: string }>(`select e.id from entries e where e.summary = 'Test Inspector'`);
  const token = 'e2e-synthetic-role-link-token-000001';
  await sql(`insert into entry_links(token, entry_id, role_name, expires_at) values ($1, $2, 'Inspector', now() + interval '1 day')`,
    [createHash('sha256').update(token).digest('hex'), e.id]);
  await page.goto(`/e/${token}`);
  await expect(page.getByText('No action is available for you at this stage.')).toBeVisible();
  await expect(page.getByLabel('TRAILER VIN NUMBER')).toHaveValue('TESTVIN0000000777');
  await expect(page.getByRole('button', { name: 'SubmitInspection' })).toHaveCount(0);

  // Turning the public link off also stops role links.
  await sql(`update forms set is_active = false where slug = 'trailer-inspection-checklist'`);
  try {
    await page.goto(`/e/${token}`);
    await expect(page.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
  } finally {
    await sql(`update forms set is_active = true where slug = 'trailer-inspection-checklist'`);
  }

  await page.goto('/e/not-a-real-token-but-long-enough-xx');
  await expect(page.getByRole('heading', { name: 'Link not valid' })).toBeVisible();
});

test('Store Room APPROVAL is a task; staff set APPROVED EMAILED by hand', async ({ page }) => {
  await page.goto('/f/store-room');
  await page.locator('input[name="f.OTHER"]').fill('Synthetic stock note'); // two Store Room fields are labelled OTHER (kit quirk)
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(THANKS)).toBeVisible();
  const [e] = await sql<{ number: number }>(`select e.number from entries e join forms f on f.id = e.form_id where f.slug = 'store-room' order by e.number desc limit 1`);

  await signIn(page, '/admin/tasks');
  await expect(page.getByTestId('tasks-store-room')).toContainText(`#${e.number}`);
  await page.goto(`/admin/forms/store-room/entries/${e.number}`);
  await page.getByLabel('Set status').selectOption('APPROVED EMAILED');
  await page.getByRole('button', { name: 'Set status' }).click();
  await expect(page.getByTestId('entry-status')).toHaveText('APPROVED EMAILED');
  await expect(page.getByTestId('timeline')).toContainText('SetStatus → APPROVED EMAILED');
  await page.goto('/admin/tasks');
  await expect(page.getByTestId('tasks-store-room')).not.toContainText(`#${e.number} `);
});

test('Grid: unread badge, views, search, export, mark read; entry PDF downloads', async ({ page, request }) => {
  await page.goto('/f/release-form');
  await page.getByLabel('VIN NO').fill('TESTVIN0000000555');
  await page.getByLabel('INV NO').fill('INV-TEST-1');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(THANKS)).toBeVisible();

  await signIn(page);
  await expect(page.getByTestId('unread-release-form')).toHaveText(/\d+/);
  await page.getByTestId('form-row-release-form').getByRole('link', { name: 'RELEASE FORM' }).click();
  await page.getByRole('link', { name: 'Unread' }).click();
  await expect(page.getByRole('link', { name: 'TESTVIN0000000555' })).toBeVisible();

  await page.getByPlaceholder('Search entries').fill('inv-test-1');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export CSV' }).click();
  const csv = readFileSync(await (await download).path(), 'utf8');
  expect(csv).toContain('Entry Number,Status,Created,Updated');
  expect(csv).toContain('TESTVIN0000000555');
  expect((await sql(`select 1 from audit_log where action = 'entries.export'`)).length).toBeGreaterThan(0);

  const xlsx = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export XLSX' }).click();
  expect((await xlsx).suggestedFilename()).toMatch(/^release-form-\d{4}-\d{2}-\d{2}\.xlsx$/);

  await page.locator('tbody input[type="checkbox"]').first().check();
  // Wait for the server action to finish before navigating, or the Unread view can render first.
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/admin/forms/release-form')),
    page.getByRole('button', { name: 'Mark read' }).click(),
  ]);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('link', { name: 'Unread' }).click();
  await expect(page.getByRole('link', { name: 'TESTVIN0000000555' })).toHaveCount(0);

  const [e] = await sql<{ number: number }>(`select number from entries where summary = 'TESTVIN0000000555'`);
  const pdf = await page.request.get(`/admin/forms/release-form/entries/${e.number}/documents/1`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');

  // Signed out: admin routes redirect to login, exports are not served.
  const anon = await request.get(`/admin/forms/release-form/export?format=csv`, { maxRedirects: 0 });
  expect([302, 303, 307]).toContain(anon.status());
});

test('Staff edit keeps files, records a timeline diff, and rejects stale saves', async ({ page, browser }) => {
  await signIn(page);
  await page.goto('/admin/forms/job-card/new');
  await page.getByLabel('Quote no').fill('QTEST-4004');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Saved. Status: Submitted')).toBeVisible();
  const url = page.url();

  // A second tab loads the same entry, then the first saves: the second tab's save is refused.
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await signIn(p2);
  await p2.goto(url);
  await page.getByLabel('Line 1').fill('Edited line');
  await page.getByRole('button', { name: 'Update' }).click();
  await expect(page.getByText('Saved. Status: Submitted')).toBeVisible();
  await p2.getByLabel('Line 1').fill('Conflicting edit');
  await p2.getByRole('button', { name: 'Update' }).click();
  await expect(p2.getByText('This entry was changed by someone else.')).toBeVisible();
  await other.close();

  const ev = await sql<{ action: string; diff: { changed: string[] } }>(
    `select ev.action, ev.diff from entry_events ev join entries e on e.id = ev.entry_id where e.summary = 'QTEST-4004' order by ev.id`);
  expect(ev.map((x) => x.action)).toEqual(['Submit', 'Update']);
  expect(ev[1].diff.changed).toEqual(['Line1']);
});

test('Admin can delete an entry after typing its number; it is audited', async ({ page }) => {
  await signIn(page);
  await page.goto('/admin/forms/job-card/new');
  await page.getByLabel('Quote no').fill('QTEST-DELETE');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Saved. Status: Submitted')).toBeVisible();
  const [e] = await sql<{ id: string; number: number }>(`select id, number from entries where summary = 'QTEST-DELETE'`);
  await page.getByLabel('Entry number').fill('999999');
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('The number did not match.')).toBeVisible();
  await page.getByLabel('Entry number').fill(String(e.number));
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page).toHaveURL(/\/admin\/forms\/job-card$/);
  expect(await sql(`select 1 from entries where id = $1`, [e.id])).toHaveLength(0);
  expect(await sql(`select 1 from audit_log where action = 'entry.delete' and entity_id = $1`, [e.id])).toHaveLength(1);
});
