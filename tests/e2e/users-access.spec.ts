import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ADMIN, signIn, sql } from './helpers';

// M7 users, access levels and activity log (docs/M7.md section 4). Synthetic people only (example.invalid).
const run = Date.now().toString(36);
const READER = { name: `Rea Reader ${run}`, email: `reader-${run}@example.invalid`, password: 'reader-password-e2e' };
const EXISTING = { name: `Ex Isting ${run}`, email: `existing-${run}@example.invalid`, password: 'existing-own-password-e2e' };
const ADDED = { name: `Al Added ${run}`, email: `added-${run}@example.invalid`, password: 'added-own-password-e2e' };
const MANAGER = { name: `Mo Manager ${run}`, email: `manager-${run}@example.invalid`, password: 'manager-password-e2e' };
const ADMIN_ID = '00000000-0000-0000-0000-00000000a001';
const ORG = '00000000-0000-0000-0000-000000000001';
const STUB = `http://127.0.0.1:${process.env.E2E_STUB_PORT ?? 54399}`;
const ANON = { apikey: 'stub-anon-key' };

async function token(request: APIRequestContext, email: string, password: string): Promise<string | null> {
  const r = await request.post(`${STUB}/auth/v1/token?grant_type=password`, { data: { email, password }, headers: ANON });
  return r.ok() ? ((await r.json()) as { access_token: string }).access_token : null;
}
const rest = (request: APIRequestContext, tok: string, path: string) =>
  request.get(`${STUB}/rest/v1/${path}`, { headers: { ...ANON, Authorization: `Bearer ${tok}` } });

async function setPassword(page: Page, password: string) {
  await expect(page.getByRole('heading', { name: 'Set your password' })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Repeat new password').fill(password);
  await page.getByRole('button', { name: 'Set password and continue' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

async function signInAs(page: Page, who: { email: string; password: string }, next = '/admin') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(who.email);
  await page.getByLabel('Password').fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, '\\$&')}$`), { timeout: 30_000 });
}

/** Clicks the None / Read / Write pill of an area in the access matrix. */
async function setLevel(page: Page, area: string, level: 'None' | 'Read' | 'Write') {
  const group = page.getByRole('main').getByRole('group', { name: area, exact: true });
  await group.getByText(level, { exact: true }).click();
  await expect(group.getByRole('radio', { name: level })).toBeChecked();
}

const auditActions = async (entityId: string) =>
  (await sql<{ action: string; meta: string }>(`select action, meta::text as meta from public.audit_log where entity_id = $1 order by id`, [entityId]));

test.describe.serial('users, access levels and activity log', () => {
  let readerId = '';
  let inviteLink = '';

  test('admin invites with a custom access map and copies the invite link', async ({ page }) => {
    await signIn(page, '/admin/settings/users');
    const main = page.getByRole('main');
    await expect(main.getByRole('navigation', { name: 'Settings sections' }).getByRole('link')).toHaveText(['Organisation', 'Users & access', 'Activity log', 'Forms']);
    await main.getByRole('link', { name: 'Invite user' }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/users\/invite$/, { timeout: 30_000 });

    await main.getByLabel('Name').fill(READER.name);
    await main.getByLabel('Email').fill(READER.email);
    await main.getByLabel('Preset').selectOption('reviewer');
    await expect(main.getByTestId('preset-label')).toHaveText('Reviewer preset');
    await main.getByLabel('Preset').selectOption('staff');
    await expect(main.getByTestId('preset-label')).toHaveText('Staff preset');
    await setLevel(page, 'Forms', 'Read');
    await setLevel(page, 'Leads', 'Read');
    await setLevel(page, 'Quotes', 'None');
    await setLevel(page, 'Stock', 'None');
    await expect(main.getByTestId('preset-label')).toHaveText('Custom (based on Staff)');
    await main.getByRole('button', { name: 'Create invite link' }).click();

    const box = main.getByRole('textbox', { name: 'Invite link' });
    await expect(box).toBeVisible();
    inviteLink = await box.inputValue();
    expect(inviteLink).toMatch(/\/auth\/confirm\?token_hash=[0-9a-f]+&type=invite&next=%2Fadmin%2Faccount%2Fpassword$/);

    const [m] = await sql<{ user_id: string; status: string; preset: string; access: Record<string, string> }>(
      `select m.user_id, m.status, m.preset, m.access from public.memberships m join auth.users u on u.id = m.user_id where u.email = $1`, [READER.email]);
    readerId = m.user_id;
    expect(m).toMatchObject({ status: 'invited', preset: 'custom' });
    expect(m.access).toMatchObject({ forms: 'read', leads: 'read', quotes: 'none', stock: 'none', deals: 'read', users: 'none' });
    const rows = await auditActions(readerId);
    expect(rows.map((r) => r.action)).toEqual(['user.invite', 'user.invite_link']);
    for (const r of rows) for (const secret of [READER.email, READER.name, 'token']) expect(r.meta).not.toContain(secret);

    // Listed as Invited, Custom.
    await page.goto('/admin/settings/users');
    const row = main.getByTestId(`user-row-${readerId}`);
    await expect(row).toContainText('Custom');
    await expect(row).toContainText('Invited');
  });

  test('the invite is accepted: set password, then only the allowed menus; read-only areas have no write buttons', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(inviteLink);
    await expect(page).toHaveURL(/\/admin\/account\/password$/);
    // No access until the password is set: the admin area sends them back.
    await page.goto('/admin/forms');
    await expect(page).toHaveURL(/\/admin\/account\/password$/);
    await setPassword(page, READER.password);
    expect((await sql<{ status: string }>(`select status from public.memberships where user_id = $1`, [readerId]))[0].status).toBe('active');

    const primary = page.getByRole('navigation', { name: 'Primary' });
    for (const n of ['Home', 'Tasks', 'Forms', 'Deals', 'Invoices', 'Leads']) await expect(primary.getByRole('link', { name: new RegExp(`^${n}`) })).toBeVisible();
    for (const n of ['Quotes', 'Integrations', 'Settings']) await expect(primary.getByRole('link', { name: new RegExp(`^${n}`) })).toHaveCount(0);
    await expect(page.getByTestId('home-tiles').getByRole('link', { name: 'Quotes' })).toHaveCount(0);
    // Search never routes to Quotes for them: a quote number goes to deal files.
    const search = page.getByRole('searchbox', { name: 'Search by quote no, VIN or invoice no' });
    await search.fill('QU-10482');
    await search.press('Enter');
    await expect(page).toHaveURL(/\/admin\/deal-files\?q=QU-10482$/);

    // Forms: read only.
    await page.goto('/admin/forms/job-card');
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New entry' })).toHaveCount(0);
    const newEntry = await page.goto('/admin/forms/job-card/new');
    expect(newEntry?.status()).toBe(403);
    await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible();

    // Leads: read only.
    await page.goto('/admin/leads');
    await expect(page.getByRole('link', { name: 'New lead' })).toHaveCount(0);
    expect((await page.goto('/admin/leads/new'))?.status()).toBe(403);

    // None: 403 on the page.
    for (const path of ['/admin/xero/quotes', '/admin/settings/users', '/admin/settings/activity', '/admin/integrations/xero']) {
      expect((await page.goto(path))?.status(), path).toBe(403);
    }
    expect((await page.goto('/admin/settings'))?.status()).toBe(403);

    // My account: name, own access, own activity.
    await page.goto('/admin/account');
    await expect(page.getByRole('heading', { name: 'My account' })).toBeVisible();
    await expect(page.getByRole('main')).toContainText('Custom');
    await expect(page.getByTestId('activity-rows')).toContainText('accepted the invite and set a password');
    await ctx.close();
  });

  test('the database agrees: API reads of areas with none come back empty, members cannot write memberships', async ({ request }) => {
    const qid = `m7-${run}`;
    await sql(`insert into public.xero_quotes(org_id, tenant_id, quote_id, quote_number, quote_no, currency_code, total, raw) values ($1, 'tenant-m7', $2, $3, $4, 'ZAR', 1, '{}')`,
      [ORG, qid, `QU-M7${run}`, `M7${run}`]);
    const admin = (await token(request, ADMIN.email, ADMIN.password))!;
    const reader = (await token(request, READER.email, READER.password))!;
    expect(reader).toBeTruthy();
    expect(await (await rest(request, admin, `xero_quotes?select=quote_id&quote_id=eq.${qid}`)).json()).toHaveLength(1);
    expect(await (await rest(request, reader, `xero_quotes?select=quote_id&quote_id=eq.${qid}`)).json()).toEqual([]);
    expect(await (await rest(request, reader, 'memberships?select=user_id')).json()).toEqual([{ user_id: readerId }]);
    expect(await (await rest(request, reader, `audit_log?select=action&entity_id=eq.${readerId}&actor_user=eq.${ADMIN_ID}`)).json()).toEqual([]);
    const write = await request.patch(`${STUB}/rest/v1/memberships?user_id=eq.${readerId}`, {
      data: { access: { users: 'write' } }, headers: { ...ANON, Authorization: `Bearer ${reader}`, 'content-type': 'application/json' },
    });
    expect(write.status()).toBe(403);
  });

  test('a member with Users write manages users but not admins; Settings opens on their first tab', async ({ page, browser, request }) => {
    await signIn(page, '/admin/settings/users/invite');
    const main = page.getByRole('main');
    await main.getByLabel('Name').fill(MANAGER.name);
    await main.getByLabel('Email').fill(MANAGER.email);
    await setLevel(page, 'Users', 'Write');
    await main.getByRole('button', { name: 'Send invite email' }).click();
    await expect(main.getByRole('status')).toContainText('Invite email sent');

    // The stub keeps the "sent" email; open its link like the person would.
    const mails = await (await request.get(`${STUB}/__stub/mail?to=${encodeURIComponent(MANAGER.email)}`)).json() as Array<{ token_hash: string; type: string; redirect_to: string }>;
    expect(mails).toHaveLength(1);
    expect(mails[0].redirect_to).toMatch(/\/auth\/confirm\?next=%2Fadmin%2Faccount%2Fpassword$/);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const mp = await ctx.newPage();
    await mp.goto(`/auth/confirm?token_hash=${mails[0].token_hash}&type=invite`);
    await setPassword(mp, MANAGER.password);
    // The same link works once.
    const again = await (await browser.newContext()).newPage();
    await again.goto(`/auth/confirm?token_hash=${mails[0].token_hash}&type=invite`);
    await expect(again).toHaveURL(/\/login\?error=link$/);
    await expect(again.getByRole('main').getByRole('alert')).toContainText('invalid or has expired');

    await mp.goto('/admin/settings');
    await expect(mp).toHaveURL(/\/admin\/settings\/users$/);
    await expect(mp.getByRole('main').getByRole('navigation', { name: 'Settings sections' }).getByRole('link')).toHaveText(['Users & access']);

    // Not the admin: Disable refused, Admin preset not offered.
    await mp.goto(`/admin/settings/users/${ADMIN_ID}`);
    await mp.getByRole('button', { name: 'Disable' }).click();
    await expect(mp.getByRole('main').getByRole('alert')).toContainText('Only an admin can invite, change, disable or remove an admin');
    expect((await sql<{ status: string }>(`select status from public.memberships where user_id = $1`, [ADMIN_ID]))[0].status).toBe('active');
    await mp.goto('/admin/settings/users/invite');
    await expect(mp.getByLabel('Preset').locator('option')).toHaveText(['Staff', 'Reviewer', 'Inspector', 'Factory']);
    // M2: Write on Users, Integrations and Settings is granted by admins only.
    for (const area of ['Users', 'Integrations', 'Settings']) {
      await expect(mp.getByRole('main').getByRole('group', { name: area, exact: true }).getByRole('radio', { name: 'Write' }), area).toBeDisabled();
    }
    await ctx.close();
  });

  test('admins cannot lock themselves out; the last active admin is protected in SQL', async ({ page }) => {
    await signIn(page, `/admin/settings/users/${ADMIN_ID}`);
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Disable' })).toHaveCount(0);
    await expect(main.getByText('Remove from organisation')).toHaveCount(0);
    await page.goto(`/admin/settings/users/${ADMIN_ID}/edit`);
    await expect(main.getByText('You cannot change your own access. Ask another admin.')).toBeVisible();
    await expect(main.getByRole('group', { name: 'Users', exact: true }).getByRole('radio', { name: 'None' })).toBeDisabled();
    await expect(sql(`update public.memberships set status = 'disabled' where user_id = $1`, [ADMIN_ID])).rejects.toThrow(/LAST_ADMIN/);
    await expect(sql(`delete from public.memberships where user_id = $1`, [ADMIN_ID])).rejects.toThrow(/LAST_ADMIN/);
  });

  test('disable stops access on the next request; enable restores it', async ({ page, browser, request }) => {
    const ctx = await browser.newContext();
    const rp = await ctx.newPage();
    await signInAs(rp, READER, '/admin/forms');
    const readerToken = (await token(request, READER.email, READER.password))!;
    expect(await (await rest(request, readerToken, 'forms?select=id&slug=eq.job-card')).json()).toHaveLength(1);

    await signIn(page, `/admin/settings/users/${readerId}`);
    await page.getByRole('main').getByRole('button', { name: 'Disable' }).click();
    await expect(page.getByRole('main').getByRole('status')).toContainText('Disabled');

    await rp.reload();
    await expect(rp.getByRole('heading', { name: 'No access' })).toBeVisible();
    await expect(rp.getByText('Your access to this organisation has been disabled.')).toBeVisible();
    // Their still-valid token reads nothing now, and they cannot sign in again (banned in Auth).
    expect(await (await rest(request, readerToken, 'forms?select=id&slug=eq.job-card')).json()).toEqual([]);
    expect(await token(request, READER.email, READER.password)).toBeNull();

    await page.getByRole('main').getByRole('button', { name: 'Enable' }).click();
    await expect(page.getByRole('main').getByRole('status')).toContainText('Enabled');
    await rp.goto('/admin/forms');
    await expect(rp.getByRole('main').getByRole('heading', { name: 'Forms' })).toBeVisible();
    await ctx.close();
  });

  test('Add user: temporary password shown once, changed on first sign-in before anything else', async ({ page, browser }) => {
    await signIn(page, '/admin/settings/users');
    const main = page.getByRole('main');
    await main.getByRole('link', { name: 'Add user' }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/users\/add$/, { timeout: 30_000 });
    await main.getByLabel('Name').fill(ADDED.name);
    await main.getByLabel('Email').fill(ADDED.email);
    // A typed temporary password must be at least 12 characters.
    await main.getByLabel('Generate one for me (shown once)').uncheck();
    await main.getByRole('textbox', { name: 'Temporary password' }).fill('short-pass1');
    await main.getByRole('textbox', { name: 'Temporary password' }).evaluate((el) => el.removeAttribute('minlength'));
    await main.getByRole('button', { name: 'Add user' }).click();
    await expect(main.getByRole('alert')).toContainText('at least 12 characters');
    // Generated instead.
    await main.getByLabel('Generate one for me (shown once)').check();
    await setLevel(page, 'Leads', 'None');
    await main.getByRole('button', { name: 'Add user' }).click();
    const box = main.getByRole('textbox', { name: 'Temporary password' });
    await expect(box).toBeVisible();
    const temp = await box.inputValue();
    expect(temp).toHaveLength(16);

    const [m] = await sql<{ user_id: string; status: string; must_change_password: boolean; access: Record<string, string> }>(
      `select m.user_id, m.status, m.must_change_password, m.access from public.memberships m join auth.users u on u.id = m.user_id where u.email = $1`, [ADDED.email]);
    expect(m).toMatchObject({ status: 'active', must_change_password: true });
    expect(m.access.leads).toBe('none');
    const rows = await auditActions(m.user_id);
    expect(rows.map((r) => r.action)).toEqual(['user.add']);
    for (const secret of [ADDED.email, ADDED.name, temp]) expect(rows[0].meta).not.toContain(secret);

    // First sign-in: every admin page sends them to choose a password (no current password asked).
    const ctx = await browser.newContext();
    const ap = await ctx.newPage();
    await ap.goto('/login?next=%2Fadmin%2Fforms');
    await ap.getByLabel('Email').fill(ADDED.email);
    await ap.getByLabel('Password').fill(temp);
    await ap.getByRole('button', { name: 'Sign in' }).click();
    await expect(ap).toHaveURL(/\/admin\/account\/password$/);
    await expect(ap.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await expect(ap.getByLabel('Current password')).toHaveCount(0);
    await ap.goto('/admin/leads');
    await expect(ap).toHaveURL(/\/admin\/account\/password$/);
    await ap.getByLabel('New password', { exact: true }).fill(ADDED.password);
    await ap.getByLabel('Repeat new password').fill(ADDED.password);
    await ap.getByRole('button', { name: 'Set password and continue' }).click();
    await expect(ap).toHaveURL(/\/admin$/);
    expect((await sql<{ must_change_password: boolean }>(`select must_change_password from public.memberships where user_id = $1`, [m.user_id]))[0].must_change_password).toBe(false);
    await ap.goto('/admin/forms');
    await expect(ap.getByRole('main').getByRole('heading', { name: 'Forms' })).toBeVisible();
    expect((await auditActions(m.user_id)).map((r) => r.action)).toContain('auth.password');
    await ctx.close();
  });

  test('C1: inviting an email that already has an account never returns a link; they accept with their own password', async ({ page, browser, request }) => {
    // An account that exists already (e.g. a member removed earlier, or a member of another org), with its own password.
    const made = await request.post(`${STUB}/auth/v1/admin/users`, {
      data: { email: EXISTING.email, password: EXISTING.password, email_confirm: true },
      headers: { apikey: 'stub-service-key', Authorization: 'Bearer stub-service-key' },
    });
    expect(made.ok()).toBe(true);
    const existingId = ((await made.json()) as { id: string }).id;
    await sql(`insert into public.profiles(id, email, full_name) values ($1, $2, $3)`, [existingId, EXISTING.email, EXISTING.name]);

    await signIn(page, '/admin/settings/users/invite');
    const main = page.getByRole('main');
    await main.getByLabel('Name').fill(EXISTING.name);
    await main.getByLabel('Email').fill(EXISTING.email);
    await main.getByRole('button', { name: 'Create invite link' }).click();
    await expect(main.getByRole('status')).toContainText('already has an account, so no email or link is made');
    await expect(main.getByRole('textbox', { name: 'Invite link' })).toHaveCount(0);
    const mails = await (await request.get(`${STUB}/__stub/mail?to=${encodeURIComponent(EXISTING.email)}`)).json();
    expect(mails).toEqual([]);
    const [m] = await sql<{ status: string; invite_new_account: boolean }>(`select status, invite_new_account from public.memberships where user_id = $1`, [existingId]);
    expect(m).toEqual({ status: 'invited', invite_new_account: false });
    // No Copy invite link either, and the server refuses one.
    await page.goto(`/admin/settings/users/${existingId}`);
    await expect(main.getByRole('button', { name: 'Copy invite link' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Resend invite' })).toHaveCount(0);
    // Magic links are not accepted at /auth/confirm (L4).
    const probe = await (await browser.newContext()).newPage();
    await probe.goto('/auth/confirm?token_hash=abcdef123456&type=magiclink');
    await expect(probe).toHaveURL(/\/login\?error=link$/);

    // The owner signs in with their own password and accepts; a wrong password does not accept.
    const ctx = await browser.newContext();
    const xp = await ctx.newPage();
    await xp.goto('/login');
    await xp.getByLabel('Email').fill(EXISTING.email);
    await xp.getByLabel('Password').fill(EXISTING.password);
    await xp.getByRole('button', { name: 'Sign in' }).click();
    await expect(xp).toHaveURL(/\/admin\/account\/password$/);
    await expect(xp.getByRole('heading', { name: 'Accept the invitation' })).toBeVisible();
    await expect(xp.getByLabel('New password', { exact: true })).toHaveCount(0);
    await xp.getByLabel('Current password').fill('not-their-password');
    await xp.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(xp.getByRole('main').getByRole('alert')).toContainText('current password is not right');
    expect((await sql<{ status: string }>(`select status from public.memberships where user_id = $1`, [existingId]))[0].status).toBe('invited');
    await xp.getByLabel('Current password').fill(EXISTING.password);
    await xp.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(xp).toHaveURL(/\/admin$/);
    expect((await sql<{ status: string }>(`select status from public.memberships where user_id = $1`, [existingId]))[0].status).toBe('active');
    // Their password did not change.
    expect(await token(request, EXISTING.email, EXISTING.password)).toBeTruthy();
    await ctx.close();
  });

  test('a pending invite can be resent or cancelled from the list, and the same email can be invited again', async ({ page, request }) => {
    const P = { name: `Pen Ding ${run}`, email: `pending-${run}@example.invalid` };
    const mailsOf = async () => (await (await request.get(`${STUB}/__stub/mail?to=${encodeURIComponent(P.email)}`)).json()) as unknown[];
    await signIn(page, '/admin/settings/users/invite');
    const main = page.getByRole('main');
    await main.getByLabel('Name').fill(P.name);
    await main.getByLabel('Email').fill(P.email);
    await main.getByRole('button', { name: 'Send invite email' }).click();
    await expect(main.getByRole('status')).toBeVisible();
    expect(await mailsOf()).toHaveLength(1);
    const [row] = await sql<{ user_id: string }>(`select m.user_id from public.memberships m join auth.users u on u.id = m.user_id where u.email = $1`, [P.email]);

    // Resend from the list: a new email, back on the list.
    await page.goto('/admin/settings/users');
    await main.getByRole('button', { name: `Resend invite to ${P.name}` }).click();
    await expect(main.getByRole('status')).toContainText('Invite email sent again');
    await expect(page).toHaveURL(/\/admin\/settings\/users\?sent=1$/);
    expect(await mailsOf()).toHaveLength(2);

    // Cancel from the list (the confirm prompt is accepted): the membership is gone.
    page.once('dialog', (d) => void d.accept());
    await main.getByRole('button', { name: `Cancel invite ${P.name}` }).click();
    await expect(main.getByRole('status')).toContainText('Invite cancelled');
    await expect(main.getByTestId(`user-row-${row.user_id}`)).toHaveCount(0);
    expect(await sql(`select 1 from public.memberships where user_id = $1`, [row.user_id])).toHaveLength(0);

    // Inviting the same email again sends a fresh invite email (it never signed in, so it is not an existing account).
    await page.goto('/admin/settings/users/invite');
    await main.getByLabel('Name').fill(P.name);
    await main.getByLabel('Email').fill(P.email);
    await main.getByRole('button', { name: 'Send invite email' }).click();
    await expect(main.getByRole('status')).toBeVisible();
    expect(await mailsOf()).toHaveLength(3);
    const [again] = await sql<{ status: string; invite_new_account: boolean }>(`select status, invite_new_account from public.memberships where user_id = $1`, [row.user_id]);
    expect(again).toEqual({ status: 'invited', invite_new_account: true });
  });

  test('Add user reuses the leftover account of a cancelled invite', async ({ page }) => {
    const L = { name: `Lef Tover ${run}`, email: `leftover-${run}@example.invalid` };
    await signIn(page, '/admin/settings/users/invite');
    const main = page.getByRole('main');
    await main.getByLabel('Name').fill(L.name);
    await main.getByLabel('Email').fill(L.email);
    await main.getByRole('button', { name: 'Send invite email' }).click();
    await expect(main.getByRole('status')).toBeVisible();
    const [row] = await sql<{ user_id: string }>(`select m.user_id from public.memberships m join auth.users u on u.id = m.user_id where u.email = $1`, [L.email]);
    await page.goto(`/admin/settings/users/${row.user_id}`);
    await main.getByText('Cancel invite', { exact: true }).first().click();
    await main.getByLabel(/cancel the invite for/i).check();
    await main.getByRole('button', { name: 'Cancel invite' }).click();
    await expect(page).toHaveURL(/removed=invite/);

    await page.goto('/admin/settings/users/add');
    await main.getByLabel('Name').fill(L.name);
    await main.getByLabel('Email').fill(L.email);
    await main.getByRole('button', { name: /add user/i }).last().click();
    await expect(main.getByRole('status')).toBeVisible();
    // Even when the profile row was deleted by hand, the Auth account is found by email.
    const [m] = await sql<{ status: string }>(`select status from public.memberships where user_id = $1`, [row.user_id]);
    expect(m.status).toBe('active');
  });

  test('every user and access change, sign-in and export is in the activity log with the actor', async ({ page }) => {
    // A failed sign-in for the reader's account: recorded without the email.
    await page.goto('/login');
    await page.getByLabel('Email').fill(READER.email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Sign in failed')).toBeVisible();
    const failed = await sql<{ meta: string; actor_user: string | null }>(`select meta::text as meta, actor_user from public.audit_log where action = 'auth.sign_in_failed' and entity_id = $1`, [readerId]);
    expect(failed).toHaveLength(1);
    expect(failed[0].actor_user).toBeNull();
    expect(failed[0].meta).not.toContain(READER.email);

    await signIn(page, '/admin/settings/activity');
    await page.goto('/admin/settings/activity?area=users');
    const list = page.getByTestId('activity-rows');
    for (const text of [
      `Test Admin invited ${READER.name}`, `Test Admin created an invite link for ${READER.name}`, `${READER.name} accepted the invite and set a password`,
      `${READER.name} signed in`, `Test Admin disabled ${READER.name}`, `Test Admin enabled ${READER.name}`, `Failed sign-in for ${READER.name}`,
      `Test Admin invited ${MANAGER.name}`, `Test Admin added ${ADDED.name} as Custom with a temporary password`,
    ]) await expect(list.getByText(text).first(), text).toBeVisible();
    await list.getByRole('link', { name: `Test Admin disabled ${READER.name}` }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/settings/users/${readerId}$`));
    await expect(page.getByRole('main').getByRole('heading', { name: 'Sign-ins' })).toBeVisible();

    // Filter by user: only what that person did.
    await page.goto(`/admin/settings/activity?user=${readerId}`);
    await expect(list.getByText(`${READER.name} accepted the invite and set a password`)).toBeVisible();
    await expect(list.getByText(`Test Admin disabled ${READER.name}`)).toHaveCount(0);

    // CSV export, audited.
    const before = (await sql(`select 1 from public.audit_log where org_id = $1 and action = 'audit.export'`, [ORG])).length;
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Export CSV' }).click()]);
    const csv = await readFile((await download.path())!, 'utf8');
    expect(csv.split('\r\n')[0]).toBe('"Time","Who","Area","Action","What","Record","Record id"');
    expect(csv).toContain(`"${READER.name}"`);
    expect(csv).toContain('"user.accept"');
    expect(csv).not.toContain(READER.email);
    await expect.poll(async () => (await sql(`select 1 from public.audit_log where org_id = $1 and action = 'audit.export' and actor_user = $2`, [ORG, ADMIN_ID])).length).toBe(before + 1);
  });
});
