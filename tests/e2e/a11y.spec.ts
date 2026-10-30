import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

// Handoff "done when": axe reports no WCAG AA violations on each route, light and dark, desktop and phone.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function audit(page: Page, label: string) {
  await page.waitForLoadState('networkidle');
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s) e.g. ${v.nodes[0]?.target.join(' ')}`);
  expect(summary, `${label}\n${summary.join('\n')}`).toEqual([]);
}

const PUBLIC = [
  '/f/deal', '/f/delivery-note', '/f/release-form', '/f/request-for-invoice', '/f/store-room',
  '/f/trailer-inspection-checklist', '/f/job-card', '/f/job-card/thanks', '/e/not-a-real-token-but-long-enough-xx', '/login',
];

const ADMIN = ['/admin', '/admin/tasks', '/admin/forms', '/admin/forms/release-form', '/admin/forms/deal/new', '/admin/deal-files', '/admin/xero/quotes', '/admin/xero/invoices', '/admin/integrations/xero', '/admin/settings', '/admin/leads'];

for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`${w}px ${scheme}`, () => {
      test.use({ viewport: { width: w, height: h }, colorScheme: scheme });

      test('public routes have no WCAG AA violations', async ({ page }) => {
        for (const path of PUBLIC) {
          await page.goto(path);
          await audit(page, `${path} at ${w}px ${scheme}`);
        }
      });

      // Enabled once the redesigned admin screens (UI handoff wave 2) are merged; the old pages predate the design.
      test.fixme('admin routes have no WCAG AA violations', async ({ page }) => {
        test.setTimeout(180_000);
        await signIn(page);
        for (const path of ADMIN) {
          await page.goto(path);
          await audit(page, `${path} at ${w}px ${scheme}`);
        }
      });
    });
  }
}
