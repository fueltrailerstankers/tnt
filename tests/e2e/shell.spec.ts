import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.describe('desktop shell (1440)', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('sidebar marks the current page, "/" focuses search, search routes by key type', async ({ page }) => {
    await signIn(page, '/admin/tasks');
    const nav = page.getByRole('complementary', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Tasks' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Home', exact: true })).not.toHaveAttribute('aria-current', 'page');
    // Pages that are not built yet are not linked.
    await expect(nav.getByRole('link', { name: 'Leads' })).toHaveCount(0);

    await page.locator('body').press('/');
    const search = page.getByRole('searchbox', { name: 'Search by quote no, VIN or invoice no' });
    await expect(search).toBeFocused();
    await search.fill('INV-20931');
    await search.press('Enter');
    await expect(page).toHaveURL(/\/admin\/xero\/invoices\?q=INV-20931$/);
  });

  test('theme toggle sets data-theme and survives a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await signIn(page);
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-theme', /.+/);
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
  });

  test('follows the OS theme when nothing is chosen', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await signIn(page);
    await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  });
});

test.describe('phone shell (390)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('hamburger drawer opens, closes with Escape and returns focus; bottom tabs navigate', async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole('complementary', { name: 'Main navigation' })).toBeHidden();

    const open = page.getByRole('button', { name: 'Open menu' });
    await open.click();
    const drawer = page.getByRole('dialog', { name: 'Menu' });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Close menu' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(open).toBeFocused();

    const tabs = page.getByRole('navigation', { name: 'Quick links' });
    await expect(tabs.getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
    await tabs.getByRole('link', { name: 'Forms' }).click();
    await expect(page).toHaveURL(/\/admin\/forms$/);
    await expect(tabs.getByRole('link', { name: 'Forms' })).toHaveAttribute('aria-current', 'page');

    await open.click();
    await drawer.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/admin\/settings$/);
    await expect(drawer).toBeHidden();
  });

  test('search button reveals a search field that routes quote numbers to quotes', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Search quote no, VIN or invoice no' }).click();
    const search = page.getByRole('searchbox', { name: 'Search by quote no, VIN or invoice no' }).last();
    await expect(search).toBeFocused();
    await search.fill('QU-10482');
    await search.press('Enter');
    await expect(page).toHaveURL(/\/admin\/xero\/quotes\?q=QU-10482$/);
  });
});
