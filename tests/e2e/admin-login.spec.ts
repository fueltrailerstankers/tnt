import { expect, test } from '@playwright/test';

const EMAIL = 'admin@example.invalid';
const PASSWORD = 'correct-horse-battery';

test('anonymous visitors are sent to /login', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);
  await expect(page.getByRole('heading', { name: /Trailers & Tankers/ })).toBeVisible();
});

test('wrong password shows a generic error and stays on /login', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Sign in failed')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('admin signs in, sees /admin with 7 forms, and can sign out', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/admin$/);
  // Home greets the signed-in admin (SAST time of day), shows their role and lists the seven forms.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), Test$/);
  await expect(page.getByRole('button', { name: /^User menu, .+, admin$/i })).toBeVisible();
  await expect(page.locator('[data-testid^="form-row-"]')).toHaveCount(7);

  await page.reload();
  await expect(page.locator('[data-testid^="form-row-"]')).toHaveCount(7);

  await page.getByRole('button', { name: /^User menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login/);
});

test('open-redirect attempts via next are ignored', async ({ page, baseURL }) => {
  await page.goto('/login?next=//evil.example');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Exactly our own origin (port from E2E_APP_PORT), never evil.example.
  await expect(page).toHaveURL(`${baseURL}/admin`);
});
