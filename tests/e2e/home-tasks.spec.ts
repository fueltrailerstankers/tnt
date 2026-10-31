import { expect, test, type Page } from '@playwright/test';
import { sign, signIn, sql } from './helpers';

// Home dashboard and Tasks (handoff Home / PhoneHome / Tasks). Synthetic data only. The e2e database is shared
// with the other specs, so every assertion is scoped to rows this run creates.

const ORG = '00000000-0000-0000-0000-000000000001';
const ADMIN_ID = '00000000-0000-0000-0000-00000000a001';
const THANKS = 'Thank you for filling out the form. Your response has been recorded.';
const run = Date.now().toString(36);

async function submitInspection(page: Page, vin: string, last: string) {
  await page.goto('/f/trailer-inspection-checklist');
  await page.getByLabel('TRAILER VIN NUMBER').fill(vin);
  await page.getByLabel('First').fill('Home');
  await page.getByLabel('Last').fill(last);
  await page.getByLabel('Inspector Email').fill('inspector@example.invalid');
  await page.locator('input[name="cl.1.pass"]').check();
  await page.locator('input[name="cl.2.fail"]').check();
  await page.locator('textarea[name="cl.2.comments"]').fill('Loose U-bolt');
  await sign(page, 'InspectorSignature');
  await page.getByRole('button', { name: 'SubmitInspection' }).click();
  await expect(page.getByText(THANKS)).toBeVisible();
  const [e] = await sql<{ id: string; number: number }>(
    `select e.id, e.number from entries e join forms f on f.id = e.form_id where f.slug = 'trailer-inspection-checklist' and e.data->>'TRAILERVINNUMBER' = $1`, [vin]);
  return e;
}

const snapshot = async (id: string) => {
  const [row] = await sql<{ status: string; data: string }>(`select status, data::text as data from entries where id = $1`, [id]);
  const files = await sql<{ id: string }>(`select id from entry_files where entry_id = $1 order by id`, [id]);
  return { ...row, files: files.map((f) => f.id) };
};

test.describe('desktop (1440)', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('Home: greeting, summary tiles, forms with new links, recent entries with unread dot', async ({ page }) => {
    // A system-created release form (as release.on_paid makes them), newest entry in the table.
    const [rel] = await sql<{ id: string; number: number }>(
      `insert into entries(form_id, number, status, data, summary, submitted_at)
       select id, 0, 'Submitted', jsonb_build_object('VINNO', $1::text, 'INVNO', $2::text), $1::text, now() from forms where slug = 'release-form'
       returning id, number`, [`TESTVIN${run}`.toUpperCase(), `INV-E2E-${run}`]);
    await sql(`insert into entry_events(entry_id, action, to_status, actor_role, diff) values ($1, 'Submit', 'Submitted', 'System', '{"changed":[]}')`, [rel.id]);

    await signIn(page);
    await expect(page).toHaveTitle('Home · Trailers & Tankers');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), Test$/);
    await expect(page.getByText(/^[A-Z][a-z]+day \d{1,2} [A-Z][a-z]+ \d{4} · \d{2}:\d{2} SAST$/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'New deal', exact: true })).toHaveAttribute('href', '/admin/forms/deal/new');

    const summary = page.getByRole('region', { name: 'Summary' });
    await expect(summary.getByRole('link', { name: /^Unread entries/ })).toHaveAttribute('href', '/admin/forms');
    await expect(summary.getByRole('link', { name: /^My tasks/ })).toHaveAttribute('href', '/admin/tasks');
    await expect(summary.getByRole('link', { name: /^Awaiting approval \d+ Inspections \d+ Store Room$/ })).toBeVisible();
    // No Xero connection yet in this database (xero.spec connects later): the tile says so.
    await expect(page.getByTestId('xero-health')).toContainText('Xero sync health');

    // Forms card: the seven kit forms in design order (M8 specs may have added more forms to this shared database;
    // they come after); inspections can only be started from the public link.
    const KIT = ['deal', 'request-for-invoice', 'job-card', 'trailer-inspection-checklist', 'release-form', 'delivery-note', 'store-room'];
    const rows = page.locator('[data-testid^="form-row-"]');
    const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('form-row-', '')));
    expect(ids.filter((id) => KIT.includes(id))).toEqual(KIT);
    expect(ids.slice(0, 7)).toEqual(KIT);
    await expect(page.getByRole('link', { name: 'New Trailer Inspection entry' })).toHaveAttribute('href', '/f/trailer-inspection-checklist');
    await expect(page.getByRole('link', { name: 'New Job Card entry' })).toHaveAttribute('href', '/admin/forms/job-card/new');
    await expect(page.getByTestId('unread-release-form')).toHaveText(/^\d+ new$/);

    // Recent entries: the new release form is unread, referenced by its invoice number, made by Xero automation.
    const table = page.getByRole('table', { name: 'Recent entries' });
    const label = `Release Form #${rel.number}`;
    const row = table.getByRole('row').filter({ has: page.getByRole('link', { name: label, exact: true }) });
    await expect(row).toContainText(`INV-E2E-${run}`);
    await expect(row).toContainText('Auto · Xero');
    await expect(row).toContainText(/Today \d{2}:\d{2}/);
    await expect(row).toContainText('Unread:');
    await row.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/forms/release-form/entries/${rel.number}$`));
    await page.goto('/admin');
    await expect(table.getByRole('row').filter({ has: page.getByRole('link', { name: label, exact: true }) })).not.toContainText('Unread:');
  });

  test('Tasks: Mark reviewed and Approve in one click keep the entry data and files, email the inspector', async ({ page }) => {
    const vin = `TESTVIN${run}A`.toUpperCase();
    const e = await submitInspection(page, vin, `Tasks${run}`);
    const before = await snapshot(e.id);
    expect(before.status).toBe('Submitted');
    expect(before.files.length).toBe(1); // the inspector's signature

    await signIn(page, '/admin/tasks');
    await expect(page).toHaveTitle('Tasks · Trailers & Tankers');
    const task = page.getByTestId(`task-inspection-${e.number}`);
    await expect(task).toContainText(`Inspection #${e.number} · ${vin}`);
    await expect(task).toContainText(`Needs review · Home Tasks${run} · 1 row marked Fail`);
    await expect(task.getByRole('link', { name: 'Open' })).toHaveAttribute('href', `/admin/forms/trailer-inspection-checklist/entries/${e.number}`);

    await task.getByRole('button', { name: 'Mark reviewed' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Inspection #${e.number} marked reviewed` })).toBeVisible();
    await expect(task).toContainText('Needs approval');
    await expect(task.getByRole('button', { name: 'Approve' })).toBeVisible();

    // Same data (jsonb compares regardless of key order) and the same files: only the status moved.
    const reviewed = await snapshot(e.id);
    expect(reviewed).toEqual({ ...before, status: 'Reviewed' });
    const [ev] = await sql<{ action: string; actor_role: string; actor_user: string }>(
      `select action, actor_role, actor_user from entry_events where entry_id = $1 order by id desc limit 1`, [e.id]);
    expect(ev).toEqual({ action: 'MarkReviewed', actor_role: 'Form Creator / Internal Reviewer', actor_user: ADMIN_ID });

    await task.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Inspection #${e.number} approved` })).toBeVisible();
    await expect(task).toHaveCount(0);
    expect(await snapshot(e.id)).toEqual({ ...before, status: 'Approved' });

    const mails = await sql<{ subject: string }>(`select subject from email_log where entry_id = $1 order by id`, [e.id]);
    expect(mails.map((m) => m.subject)).toEqual(['Trailer Inspection Submitted', 'Trailer Inspection Reviewed', 'Trailer Inspection Approved']);
  });

  test('Tasks: a stale row is refused and nothing is saved', async ({ page }) => {
    const e = await submitInspection(page, `TESTVIN${run}B`.toUpperCase(), `Stale${run}`);
    await signIn(page, '/admin/tasks');
    const task = page.getByTestId(`task-inspection-${e.number}`);
    await expect(task).toBeVisible();
    // Someone else moves the entry on after the page loaded.
    await sql(`update entries set updated_at = now() + interval '1 second' where id = $1`, [e.id]);
    await task.getByRole('button', { name: 'Mark reviewed' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'This entry was changed by someone else.' })).toBeVisible();
    expect((await snapshot(e.id)).status).toBe('Submitted');
    await page.getByRole('button', { name: 'Reload' }).click();
    await expect(task.getByRole('button', { name: 'Mark reviewed' })).toBeEnabled();
  });

  test('Tasks: Store Room count is approved through the manual status', async ({ page }) => {
    await page.goto('/f/store-room');
    await page.locator('input[name="f.OTHER"]').fill(`Synthetic count ${run}`);
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText(THANKS)).toBeVisible();
    const [e] = await sql<{ id: string; number: number }>(`select e.id, e.number from entries e where e.data->>'OTHER' = $1`, [`Synthetic count ${run}`]);

    await signIn(page, '/admin/tasks');
    await page.goto('/admin/tasks?filter=store-room');
    await expect(page.getByRole('tab', { name: /^Store Room/ })).toHaveAttribute('aria-selected', 'true');
    const task = page.getByTestId(`task-store-room-${e.number}`);
    await expect(task).toContainText(`Store Room count #${e.number}`);
    await expect(task).toContainText('0 of 31 items below minimum');
    await task.getByRole('button', { name: 'Mark APPROVED EMAILED' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/forms/store-room/entries/${e.number}$`));
    await expect(page.getByTestId('entry-status')).toHaveText('APPROVED EMAILED');
    await page.goto('/admin/tasks');
    await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
    await expect(page.getByTestId(`task-store-room-${e.number}`)).toHaveCount(0);
  });

  test('Tasks: failed jobs (own org only), sync retry, assigned leads, filter chips and keys', async ({ page }) => {
    const other = '00000000-0000-0000-0000-0000000000e2';
    await sql(`insert into orgs(id, name) values ($1, 'Other Demo Org') on conflict (id) do nothing`, [other]);
    const [mine] = await sql<{ id: string }>(
      `insert into outbox_jobs(org_id, queue, status, attempts, last_error, locked_at) values ($1, $2, 'failed', 5, 'xero 429', now()) returning id`, [ORG, `e2e.mine.${run}`]);
    await sql(`insert into outbox_jobs(org_id, queue, status, attempts, last_error, locked_at) values ($1, $2, 'failed', 5, 'xero 429', now())`, [other, `e2e.other.${run}`]);
    const [lead] = await sql<{ id: string }>(
      `insert into leads(org_id, source, name, status, assigned_to) values ($1, 'manual', $2, 'new', $3) returning id`, [ORG, `E2E Lead ${run}`, ADMIN_ID]);
    const existing = await sql(`select 1 from xero_sync_state where org_id = $1 and entity = 'invoices'`, [ORG]);
    if (!existing.length) await sql(`insert into xero_sync_state(org_id, entity, last_run_at, last_error) values ($1, 'invoices', now(), 'xero 429')`, [ORG]);
    try {
      await signIn(page, '/admin/tasks');
      await page.goto('/admin/tasks?filter=failed-jobs');
      const tabs = page.getByRole('tablist', { name: 'Filter tasks' });
      const failedTab = tabs.getByRole('tab', { name: /^Failed jobs/ });
      await expect(failedTab).toHaveAttribute('aria-selected', 'true');
      const job = page.getByTestId(`task-job-${mine.id}`);
      await expect(job).toContainText(`e2e.mine.${run}`);
      await expect(job).toContainText('429 Too Many Requests · 5 attempts');
      await expect(job.getByRole('link', { name: 'Details' })).toHaveAttribute('href', '/admin/integrations/xero');
      await expect(job.getByRole('button')).toHaveCount(0); // nothing re-queues an outbox job yet: no Retry
      await expect(page.getByText(`e2e.other.${run}`)).toHaveCount(0);
      if (!existing.length) await expect(page.getByTestId('task-sync-invoices').getByRole('button', { name: 'Retry' })).toBeVisible();

      // Counts on the chips match the rows shown.
      const list = page.getByTestId('tasks-list').locator(':scope > li');
      const countOf = async (name: RegExp) => Number((await tabs.getByRole('tab', { name }).innerText()).match(/(\d+)\s*$/)![1]);
      expect(await list.count()).toBe(await countOf(/^Failed jobs/));

      // Keyboard: arrows move and select, Home/End jump, URL follows.
      await failedTab.focus();
      await page.keyboard.press('ArrowRight');
      const leadsTab = tabs.getByRole('tab', { name: /^Leads/ });
      await expect(leadsTab).toHaveAttribute('aria-selected', 'true');
      await expect(leadsTab).toBeFocused();
      await expect(page).toHaveURL(/\/admin\/tasks\?filter=leads$/);
      const leadRow = page.getByTestId(`task-lead-${lead.id}`);
      await expect(leadRow).toContainText(`Lead · E2E Lead ${run}`);
      await expect(leadRow).toContainText('Assigned to you');
      await expect(leadRow.getByRole('link', { name: 'Open lead' })).toHaveAttribute('href', `/admin/leads/${lead.id}`);
      expect(await list.count()).toBe(await countOf(/^Leads/));
      await page.keyboard.press('Home');
      await expect(tabs.getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true');
      expect(await list.count()).toBe(await countOf(/^All/));
      await page.keyboard.press('End');
      await expect(leadsTab).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tasks-tab-leads');

      // Home lists them too, and the sync failure shows on the entity card.
      await page.goto('/admin');
      await expect(page.getByTestId('home-tasks')).toBeVisible();
      await expect(page.getByRole('link', { name: /^My tasks \d+ \d+ failed jobs?$/ })).toBeVisible();
      if (!existing.length) await expect(page.getByTestId('sync-by-entity')).toContainText(/Invoices\s*Failed \d{2}:\d{2} · 429/);

      // Retry posts to the existing, permission-checked "Sync now" action.
      if (!existing.length) {
        await page.goto('/admin/tasks?filter=failed-jobs');
        await page.getByTestId('task-sync-invoices').getByRole('button', { name: 'Retry' }).click();
        await expect(page).toHaveURL(/\/admin\/integrations\/xero\?synced=1$/, { timeout: 60_000 }); // Sync now runs a full sync + drain
      }
    } finally {
      await sql(`update outbox_jobs set status = 'done' where queue in ($1, $2)`, [`e2e.mine.${run}`, `e2e.other.${run}`]);
      await sql(`update leads set status = 'spam' where id = $1`, [lead.id]);
      if (!existing.length) await sql(`delete from xero_sync_state where org_id = $1 and entity = 'invoices' and backfill_done = false and records_synced = 0`, [ORG]);
    }
  });
});

test.describe('phone (390)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('Home phone layout: tiles, task cards and New entry grid; Tasks chips are 44px', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), Test$/);
    await expect(page.getByText(/^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} · \d{2}:\d{2} SAST$/)).toBeVisible();
    await expect(page.getByRole('region', { name: 'Summary' })).toBeHidden();
    await expect(page.getByRole('link', { name: /^Unread \d+$/ })).toHaveAttribute('href', '/admin/forms');
    await expect(page.getByRole('link', { name: /^Awaiting approval \d+$/ })).toHaveAttribute('href', '/admin/tasks');
    const grid = page.getByRole('region', { name: 'New entry' });
    await expect(grid.getByRole('link', { name: 'Inspection' })).toHaveAttribute('href', '/f/trailer-inspection-checklist');
    await expect(grid.getByRole('link', { name: 'Store Room' })).toHaveAttribute('href', '/admin/forms/store-room/new');
    for (const link of await grid.getByRole('link').all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);

    await page.goto('/admin/tasks');
    const tabs = page.getByRole('tablist', { name: 'Filter tasks' });
    for (const tab of await tabs.getByRole('tab').all()) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  });
});
