import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn, sql } from './helpers';

// Redesigned Xero integration and Settings screens (HANDOFF XeroIntegration.dc.html, Settings.dc.html).
// Synthetic data only; every row a test adds carries this run's id and is removed or restored afterwards.
test.describe.configure({ mode: 'serial' });

const ORG = '00000000-0000-0000-0000-000000000001';
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function audit(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) e.g. ${v.nodes[0]?.target.join(' ')}`);
  expect(summary, `${label}\n${summary.join('\n')}`).toEqual([]);
}

async function setting(key: string): Promise<unknown | undefined> {
  const rows = await sql<{ value: unknown }>(`select value from public.app_settings where org_id = $1 and key = $2`, [ORG, key]);
  return rows.length ? rows[0].value : undefined;
}
async function restore(key: string, prior: unknown | undefined) {
  if (prior === undefined) await sql(`delete from public.app_settings where org_id = $1 and key = $2`, [ORG, key]);
  else await sql(`insert into public.app_settings(org_id, key, value) values ($1, $2, $3::jsonb) on conflict (org_id, key) do update set value = excluded.value`, [ORG, key, JSON.stringify(prior)]);
}
const auditRows = (action: string, entityId: string, since: Date) =>
  sql<{ meta: Record<string, unknown> }>(`select meta from public.audit_log where org_id = $1 and action = $2 and entity_id = $3 and created_at >= $4 order by id`, [ORG, action, entityId, since]);

test.describe('Xero integration', () => {
  test('cards, sync table, failures and write actions render from recorded rows', async ({ page }) => {
    // A failed sync run in the last 24 h: listed with Retry when connected, error text redacted.
    const [r] = await sql<{ id: string }>(
      `insert into job_runs(org_id, job, started_at, finished_at, ok, processed, error) values ($1, 'xero.sync.quick', now() - interval '5 minutes', now() - interval '4 minutes', false, 0, 'xero 429') returning id::text`, [ORG]);
    try {
      await signIn(page, '/admin/integrations/xero');
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { name: 'Xero', level: 1 })).toBeVisible();
      await expect(main.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Integrations');
      await expect(page.getByTestId('xero-connection')).toBeVisible();
      await expect(page.getByTestId('xero-tokens').getByRole('progressbar', { name: 'Access token' })).toBeVisible();
      await expect(page.getByTestId('xero-tokens').getByRole('progressbar', { name: 'Refresh token' })).toBeVisible();
      await expect(page.getByTestId('xero-rate').getByRole('progressbar', { name: 'This minute' })).toBeVisible();
      await expect(main.getByRole('heading', { name: 'Last sync per entity' })).toBeVisible();
      const failure = page.getByTestId(`failure-run-${r.id}`);
      await expect(failure).toContainText('xero.sync.quick · 429 Too Many Requests');
      await expect(failure).toContainText(`run #${r.id}`);
      // Write actions: one row per real action with Off / Dry-run / Live.
      for (const a of ['deal.import_quote', 'rfi.create_invoice', 'delivery.update_invoice', 'release.on_paid', 'invoice.merge_attachments']) {
        const row = page.getByTestId(`action-${a}`);
        await expect(row).toBeVisible();
        await expect(row.getByRole('group', { name: `${a} mode` }).getByRole('button')).toHaveText(['Off', 'Dry-run', 'Live']);
      }
      // Merge is plan only: Live cannot be chosen.
      await expect(page.getByTestId('action-invoice.merge_attachments').getByRole('button', { name: 'Live' })).toBeDisabled();
      // No token material in the HTML.
      const html = await page.content();
      expect(html).not.toMatch(/mock-at-|mock-rt-|access_token|refresh_token/);
    } finally {
      await sql(`delete from job_runs where id = $1`, [r.id]);
    }
  });

  test('Live needs exactly "LIVE <action>"; the switch and the way back are audited', async ({ page }) => {
    const action = 'release.on_paid'; // writes no Xero data, so Live does not need write scopes
    const key = `xero.action.${action}`;
    const prior = await setting(key);
    await restore(key, 'off');
    const since = new Date(Date.now() - 1000);
    try {
      await signIn(page, '/admin/integrations/xero');
      const row = page.getByTestId(`action-${action}`);
      await expect(row.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'true');

      // Off -> Dry-run switches straight away.
      await row.getByRole('button', { name: 'Dry-run' }).click();
      await expect(row.getByRole('button', { name: 'Dry-run' })).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => setting(key)).toBe('dry_run');
      await expect(row.getByTestId(`dry-run-note-${action}`)).toContainText('currently does nothing');

      // Live opens the typed confirmation.
      await row.getByRole('button', { name: 'Live' }).click();
      const dialog = page.getByRole('alertdialog', { name: `Switch ${action} to Live?` });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Turn off the matching Make.com scenario first');
      const input = dialog.getByLabel(`Type LIVE ${action} to confirm`);
      const go = dialog.getByRole('button', { name: 'Go live' });
      await expect(go).toBeDisabled();
      for (const wrong of [action, `live ${action}`, `LIVE ${action} `, ` LIVE ${action}`, `LIVE  ${action}`, 'LIVE rfi.create_invoice']) {
        await input.fill(wrong);
        await expect(go, JSON.stringify(wrong)).toBeDisabled();
      }
      // Cancel leaves the mode alone.
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
      expect(await setting(key)).toBe('dry_run');

      await row.getByRole('button', { name: 'Live' }).click();
      await dialog.getByLabel(`Type LIVE ${action} to confirm`).fill(`LIVE ${action}`);
      await expect(go).toBeEnabled();
      await go.click();
      await expect(dialog).toBeHidden();
      await expect(row.getByRole('button', { name: 'Live' })).toHaveAttribute('aria-pressed', 'true');
      await expect.poll(() => setting(key)).toBe('live');
      expect((await auditRows('xero.action.live', action, since)).map((a) => a.meta)).toEqual([{ from: 'dry_run', to: 'live', confirmed: true }]);

      // Back to Off: no phrase needed, audited as a mode change.
      await row.getByRole('button', { name: 'Off' }).click();
      await expect.poll(() => setting(key)).toBe('off');
      expect((await auditRows('xero.action.mode', action, since)).map((a) => a.meta)).toEqual([
        { from: 'off', to: 'dry_run', confirmed: false },
        { from: 'live', to: 'off', confirmed: false },
      ]);
    } finally {
      await restore(key, prior);
    }
  });

  test('the actions page offers the same typed confirmation', async ({ page }) => {
    const action = 'deal.import_quote';
    const key = `xero.action.${action}`;
    const prior = await setting(key);
    await restore(key, 'off');
    try {
      await signIn(page, '/admin/integrations/xero/actions');
      const card = page.getByTestId(`action-${action}`);
      await card.getByRole('button', { name: 'Live' }).click();
      const dialog = page.getByRole('alertdialog', { name: `Switch ${action} to Live?` });
      await dialog.getByLabel(`Type LIVE ${action} to confirm`).fill(action); // the old M3 phrase
      await expect(dialog.getByRole('button', { name: 'Go live' })).toBeDisabled();
      await dialog.getByLabel(`Type LIVE ${action} to confirm`).fill(`LIVE ${action}`);
      await dialog.getByRole('button', { name: 'Go live' }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(() => setting(key)).toBe('live');
    } finally {
      await restore(key, prior);
    }
  });

  test('dry-run diff shows the recorded run, and a pasted Make.com recording line by line', async ({ page }) => {
    const planned = [{
      step: 'invoice', method: 'PUT', path: '/Invoices', purpose: 'Create the invoice from the quote',
      body: { Type: 'ACCREC', Contact: { ContactID: `c-${run}`, Name: '[redacted]' }, Reference: 'QU-10482 / TT9DEMO24D0010482', DueDate: '2026-11-24', Status: 'AUTHORISED' },
    }];
    const [row] = await sql<{ id: string }>(
      `insert into xero_action_runs(org_id, action, idempotency_key, mode, status, planned_requests, created_at) values ($1, 'rfi.create_invoice', $2, 'dry_run', 'planned', $3::jsonb, now() + interval '1 hour') returning id`,
      [ORG, `rfi.create_invoice:e2e${run}`, JSON.stringify(planned)]);
    try {
      await signIn(page, '/admin/integrations/xero');
      await page.getByRole('link', { name: 'View dry-run diff for rfi.create_invoice' }).click();
      await expect(page).toHaveURL(/diff=rfi\.create_invoice/);
      const diff = page.getByTestId('dry-run-diff');
      await expect(diff.getByRole('heading', { name: 'Dry-run diff · rfi.create_invoice' })).toBeVisible();
      await expect(diff.getByTestId('diff-run')).toContainText(`rfi.create_invoice:e2e${run}`);
      const portal = diff.getByRole('region', { name: 'Portal would send' });
      await expect(portal).toContainText('PUT /Invoices');
      await expect(portal).toContainText('"Reference": "QU-10482 / TT9DEMO24D0010482"');
      await expect(diff).toContainText('No Make.com recording loaded');

      // Make's recording (synthetic): different DueDate and Status (two separate blocks once keys are sorted), and a
      // name that must be redacted before it is shown.
      const make = [{ method: 'PUT', path: 'Invoices', body: { Type: 'ACCREC', Contact: { ContactID: `c-${run}`, Name: 'Sample Customer Name' }, Reference: 'QU-10482 / TT9DEMO24D0010482', DueDate: '2026-11-25', Status: 'DRAFT' } }];
      await diff.getByLabel('Make.com requests (JSON)').fill(JSON.stringify(make));
      await diff.getByRole('button', { name: 'Compare' }).click();
      await expect(diff.getByTestId('diff-count')).toHaveText('2 differences');
      const sent = diff.getByRole('region', { name: 'Make.com sent' });
      await expect(sent).toContainText('Only Make.com sent: "DueDate": "2026-11-25"');
      await expect(portal).toContainText('Only the portal sends: "DueDate": "2026-11-24"');
      await expect(sent).toContainText('Only Make.com sent: "Status": "DRAFT"');
      await expect(portal).toContainText('Only the portal sends: "Status": "AUTHORISED"');
      await expect(sent).not.toContainText('Sample Customer Name');
      await expect(sent).toContainText('"Name": "[redacted]"');

      // Junk is refused without echoing it.
      await diff.getByLabel('Make.com requests (JSON)').fill('{ not json');
      await diff.getByRole('button', { name: 'Compare' }).click();
      await expect(diff.getByRole('alert')).toHaveText('That is not valid JSON. Paste the request list from Make.com as JSON.');
    } finally {
      await sql(`delete from xero_action_runs where id = $1`, [row.id]);
    }
  });
});

test.describe('Settings', () => {
  test('the tab bar covers every settings area', async ({ page }) => {
    await signIn(page, '/admin/settings');
    const tabs = page.getByRole('main').getByRole('navigation', { name: 'Settings sections' }).getByRole('link');
    await expect(tabs).toHaveText(['Organisation', 'Users & access', 'Notification recipients', 'Activity log', 'Job runs', 'Forms']);
    await expect(tabs.first()).toHaveAttribute('aria-current', 'page');
    await tabs.filter({ hasText: 'Job runs' }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/jobs$/);
    await page.getByRole('main').getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Notification recipients' }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/notifications$/);
  });

  test('Organisation saves display currency and the manual ZAR to USD rate (fx.zar_usd), audited', async ({ page }) => {
    const prior = await setting('fx.zar_usd');
    const [org] = await sql<{ currency_code: string }>(`select currency_code from orgs where id = $1`, [ORG]);
    const since = new Date(Date.now() - 1000);
    try {
      await signIn(page, '/admin/settings');
      const form = page.getByTestId('org-form');
      await form.getByLabel('USD per 1 ZAR').fill('-1');
      await form.getByRole('button', { name: 'Save changes' }).click();
      await expect(form.getByRole('alert')).toContainText('Check the highlighted fields.');
      await expect(form.getByLabel('USD per 1 ZAR')).toHaveAttribute('aria-invalid', 'true');
      expect(await setting('fx.zar_usd')).toEqual(prior);

      await form.getByLabel('Display currency').selectOption('ZAR');
      await form.getByLabel('USD per 1 ZAR').fill('0.0547');
      await form.getByRole('button', { name: 'Save changes' }).click();
      await expect(form.getByRole('status')).toHaveText('Saved.');
      expect(await setting('fx.zar_usd')).toBe('0.0547');
      expect((await sql<{ currency_code: string }>(`select currency_code from orgs where id = $1`, [ORG]))[0].currency_code).toBe('ZAR');
      const fx = await auditRows('settings.fx', 'fx.zar_usd', since);
      expect(fx.at(-1)?.meta).toMatchObject({ to: '0.0547', source: 'manual' });

      await page.reload();
      await expect(form.getByLabel('USD per 1 ZAR')).toHaveValue('0.0547');
      await expect(form.getByLabel('Timezone')).toHaveValue('Africa/Johannesburg');
      await expect(form.getByLabel('Timezone').locator('option:checked')).toHaveText('Africa/Johannesburg (SAST, UTC+2)');
    } finally {
      await restore('fx.zar_usd', prior);
      await sql(`update orgs set currency_code = $2 where id = $1`, [ORG, org.currency_code]);
    }
  });

  test('Notification recipients: add and edit, audited without the address', async ({ page }) => {
    const address = `e2e-${run}@example.com`;
    const since = new Date(Date.now() - 1000);
    try {
      await signIn(page, '/admin/settings/notifications');
      const main = page.getByRole('main');
      await main.getByRole('button', { name: 'Add recipient' }).click();
      const dialog = page.getByRole('dialog', { name: 'Add recipient' });
      await dialog.getByLabel('Event key').fill('Not a key');
      await dialog.getByLabel('Address').fill(address);
      await dialog.getByRole('button', { name: 'Add recipient' }).click();
      await expect(dialog).toContainText('Use an event key like release.paid');
      await dialog.getByLabel('Event key').fill(`e2e${run}.done`);
      await dialog.getByLabel('Branch (optional)').fill('Durban');
      await dialog.getByRole('button', { name: 'Add recipient' }).click();
      await expect(dialog).toBeHidden();
      const [rec] = await sql<{ id: string; branch: string; active: boolean }>(`select id, branch, active from notification_recipients where org_id = $1 and address = $2`, [ORG, address]);
      expect(rec).toMatchObject({ branch: 'Durban', active: true });
      const row = page.getByTestId(`recipient-${rec.id}`);
      await expect(row).toContainText(`e2e${run}.done`);
      await expect(row).toContainText('Durban');

      await row.getByRole('button', { name: `Edit recipient e2e${run}.done ${address}` }).click();
      const edit = page.getByRole('dialog', { name: 'Edit recipient' });
      await edit.getByLabel('Branch (optional)').fill('');
      await edit.getByLabel('Active (gets emails)').uncheck();
      await edit.getByRole('button', { name: 'Save recipient' }).click();
      await expect(edit).toBeHidden();
      await expect(row).toContainText('All branches');
      await expect(row).toContainText('Paused');
      expect((await sql(`select branch, active from notification_recipients where id = $1`, [rec.id]))[0]).toEqual({ branch: null, active: false });

      const rows = await sql<{ action: string; meta: Record<string, unknown> }>(`select action, meta from audit_log where org_id = $1 and entity_id = $2 and created_at >= $3 order by id`, [ORG, rec.id, since]);
      expect(rows.map((r) => r.action)).toEqual(['settings.recipient.add', 'settings.recipient.update']);
      expect(JSON.stringify(rows)).not.toContain(address);
    } finally {
      await sql(`delete from notification_recipients where org_id = $1 and address = $2`, [ORG, address]);
    }
  });

  test('Job runs: ids and counts only, errors redacted, filter by state', async ({ page }) => {
    const [r] = await sql<{ id: string }>(
      `insert into job_runs(org_id, job, started_at, finished_at, ok, processed, error) values ($1, $2, now() + interval '1 hour', now() + interval '1 hour 2 seconds', false, 7, 'mail to someone@example.com failed 8001015009087') returning id::text`,
      [ORG, `e2e.${run}`]);
    try {
      await signIn(page, '/admin/settings/jobs');
      const row = page.getByTestId(`job-run-${r.id}`);
      await expect(row).toContainText(`#${r.id}`);
      await expect(row).toContainText(`e2e.${run}`);
      await expect(row).toContainText('2.0 s');
      await expect(row).toContainText('Failed');
      await expect(row).toContainText('[email]');
      await expect(row).not.toContainText('someone@example.com');
      await expect(row).not.toContainText('8001015009087');
      await page.getByRole('main').getByRole('link', { name: 'Succeeded' }).click();
      await expect(page).toHaveURL(/state=succeeded/);
      await expect(page.getByTestId(`job-run-${r.id}`)).toHaveCount(0);
      await page.getByRole('main').getByRole('link', { name: 'Failed' }).click();
      await expect(page.getByTestId(`job-run-${r.id}`)).toBeVisible();
    } finally {
      await sql(`delete from job_runs where id = $1`, [r.id]);
    }
  });
});

for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`no WCAG AA violations at ${w}px ${scheme}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      await signIn(page, '/admin/integrations/xero');
      for (const path of ['/admin/integrations/xero', '/admin/integrations/xero/actions', '/admin/settings', '/admin/settings/notifications', '/admin/settings/jobs']) {
        await page.goto(path);
        await audit(page, `${path} at ${w}px ${scheme}`);
        // No horizontal page scroll at phone width: wide tables scroll inside their own box.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${path} at ${w}px`).toBeLessThanOrEqual(0);
      }
    });
  }
}
