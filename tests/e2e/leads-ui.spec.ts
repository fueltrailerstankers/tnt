import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn, sql } from './helpers';

// Redesigned Leads screens (handoff Leads, LeadsPipeline, PhoneLeads). Synthetic data only: fictional company names,
// example.invalid addresses and +27 xx 555 xxxx numbers. The e2e database is shared, so every list here is scoped
// by this run's tag (searching the inbox with ?q= and the board with its search box).
const ORG = '00000000-0000-0000-0000-000000000001';
const ADMIN_ID = '00000000-0000-0000-0000-00000000a001';
const run = `${Date.now()}`;
const tag = `ld${run.slice(-7)}`;
const digits = run.slice(-4);
const PHONE = `+27 23 555 ${digits}`;
const SHOTS = process.env.LEADS_SHOTS; // optional: directory for review screenshots

type Seed = { id: string };
const L: Record<'karoo' | 'dup' | 'test' | 'won' | 'fleet', string> = { karoo: '', dup: '', test: '', won: '', fleet: '' };

async function insert(row: Record<string, unknown>): Promise<string> {
  const keys = Object.keys(row);
  const [r] = await sql<Seed>(
    `insert into public.leads (org_id, ${keys.join(', ')}) values ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) returning id`,
    [ORG, ...keys.map((k) => row[k])],
  );
  return r.id;
}

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const phoneNorm = (p: string) => p.replace(/\D/g, '').slice(-9);

test.beforeAll(async () => {
  L.karoo = await insert({
    source: 'manual', name: `Karoo Demo Transport ${tag}`, email: `karoo-${run}@example.invalid`, email_norm: `karoo-${run}@example.invalid`,
    phone: PHONE, phone_norm: phoneNorm(PHONE), product: 'Diesel bowser quote', branch: 'Cape Town', status: 'quoted', created_at: ago(150),
    matched_quote_id: `e2e-ui-quote-${run}`, matched_quote_number: `QU-U${digits}`, matched_quote_status: 'SENT', matched_quote_total: 198400, matched_quote_currency: 'ZAR',
  });
  L.dup = await insert({
    source: 'manual', name: `Karoo Demo Transport ${tag} (call-in)`, phone: PHONE, phone_norm: phoneNorm(PHONE), product: '2-compartment diesel bowser',
    branch: 'Cape Town', status: 'new', duplicate_of: L.karoo, created_at: ago(48),
  });
  L.test = await insert({
    source: 'test', name: `Webhook test lead ${tag}`, email: `test-${run}@example.invalid`, email_norm: `test-${run}@example.invalid`,
    product: 'Integration test payload', status: 'new', created_at: ago(140),
  });
  L.won = await insert({
    source: 'manual', name: `Demo Haulage CC ${tag}`, email: `haulage-${run}@example.invalid`, email_norm: `haulage-${run}@example.invalid`,
    product: 'Flat-deck trailer, 12 m', branch: 'Cape Town', status: 'won', created_at: ago(240),
    matched_quote_id: `e2e-ui-quote-w-${run}`, matched_quote_number: `QU-W${digits}`, matched_quote_status: 'ACCEPTED', matched_quote_total: 312900, matched_quote_currency: 'ZAR',
  });
  L.fleet = await insert({
    source: 'manual', name: `Test Fleet Pty ${tag}`, email: `fleet-${run}@example.invalid`, email_norm: `fleet-${run}@example.invalid`,
    product: 'Two 38 000 L fuel tankers', branch: 'Durban', status: 'contacted', assigned_to: ADMIN_ID, created_at: ago(72),
  });
});

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** Signs in (the login `next` keeps paths only) and opens `url`. */
async function open(page: Page, url: string) {
  await signIn(page, '/admin/leads');
  await page.goto(url);
}

const column = (page: Page, name: string) => page.getByRole('region', { name: new RegExp(`^${name}\\b`) });

test.describe('desktop 1440', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('inbox: list and detail side by side, source badges, duplicate warning, Xero match, view chips', async ({ page }) => {
    await open(page, `/admin/leads?view=all&q=${tag}`);
    const main = page.getByRole('main');
    const list = main.getByRole('region', { name: 'Lead list' });
    await expect(list.getByTestId('lead-row')).toHaveCount(5);
    await expect(main.getByRole('navigation', { name: 'Leads view' }).getByRole('link', { name: 'Inbox' })).toHaveAttribute('aria-current', 'page');
    // Desktop: the first lead's detail is open beside the list.
    await expect(list.getByRole('link', { name: /Karoo Demo Transport .* \(call-in\)/ })).toHaveAttribute('aria-current', 'page');
    await expect(main.getByRole('heading', { level: 2, name: `Karoo Demo Transport ${tag} (call-in)` })).toBeVisible();
    await expect(list.getByTestId('lead-row').filter({ hasText: 'Webhook test lead' })).toContainText('Test');
    await shot(page, 'inbox-1440-light');

    // Duplicate: warning naming the shared key and linking the original. lib/leads has no merge or dismiss, so neither is offered.
    const dup = main.getByTestId('lead-duplicate');
    await expect(dup).toContainText('Possible duplicate of');
    await expect(dup).toContainText('same phone number');
    await expect(main.getByRole('button', { name: /Merge/ })).toHaveCount(0);
    await expect(main.getByRole('button', { name: /Not a duplicate/ })).toHaveCount(0);
    await dup.getByRole('link', { name: `Karoo Demo Transport ${tag}` }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/leads/${L.karoo}$`), { timeout: 30_000 }); // first visit compiles in next dev
    await expect(main.getByText(/later lead is flagged as a possible duplicate/)).toBeVisible();

    // Matched in Xero: quote number links to the mirror, ZAR amount with its badge, status as users know it.
    const xero = main.getByTestId('lead-xero');
    await expect(xero.getByRole('link', { name: new RegExp(`QU-U${digits}`) })).toHaveAttribute('href', `/admin/xero/quotes/e2e-ui-quote-${run}`);
    await expect(xero).toContainText('R 198,400.00');
    await expect(xero).toContainText('ZAR');
    await expect(xero).toContainText('Sent');

    // Chips: Won narrows the list; the row keeps the search.
    await page.goto(`/admin/leads?q=${tag}`);
    await main.getByRole('group', { name: 'Filter leads' }).getByRole('link', { name: /^Won/ }).click();
    await expect(page).toHaveURL(/view=won/);
    await expect(list.getByTestId('lead-row')).toHaveCount(1);
    await expect(list.getByTestId('lead-row')).toContainText(`Demo Haulage CC ${tag}`);
    await main.getByRole('group', { name: 'Filter leads' }).getByRole('link', { name: /^Open/ }).click();
    await expect(list.getByTestId('lead-row')).toHaveCount(4);
  });

  test('pipeline: stage columns with counts and ZAR sums, Hide test leads, drawer moves a stage and saves a note', async ({ page }) => {
    await signIn(page, '/admin/leads/pipeline');
    const main = page.getByRole('main');
    await expect(main.getByRole('navigation', { name: 'Leads view' }).getByRole('link', { name: 'Pipeline' })).toHaveAttribute('aria-current', 'page');
    await main.getByRole('searchbox', { name: 'Search leads' }).fill(tag);
    const count = (name: string) => column(page, name).getByTestId('stage-count');
    await expect(count('New')).toHaveText('2');
    await expect(count('Contacted')).toHaveText('1');
    await expect(count('Quoted')).toHaveText('1');
    await expect(count('Won')).toHaveText('1');
    await expect(count('Lost')).toHaveText('0');
    await expect(column(page, 'Quoted').getByTestId('stage-sum')).toContainText('R 198,400.00');
    await expect(column(page, 'Won').getByTestId('stage-sum')).toContainText('R 312,900.00');
    await expect(main.getByText('4 open · pipeline')).toBeVisible();
    await shot(page, 'pipeline-1440-light');

    const hide = main.getByRole('button', { name: 'Hide test leads' });
    await expect(hide).toHaveAttribute('aria-pressed', 'false');
    await hide.click();
    await expect(hide).toHaveAttribute('aria-pressed', 'true');
    await expect(count('New')).toHaveText('1');
    await expect(column(page, 'New')).not.toContainText('Webhook test lead');

    // Card -> drawer (?id= in the URL) -> stage change through the server action.
    await column(page, 'New').getByTestId('pipeline-card').filter({ hasText: '(call-in)' }).click();
    const drawer = page.getByRole('dialog', { name: `Karoo Demo Transport ${tag} (call-in)` });
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`id=${L.dup}`));
    await expect(drawer).toContainText('Possible duplicate of');
    await shot(page, 'pipeline-drawer-1440-light');
    const stages = drawer.getByRole('group', { name: 'Stage' });
    await expect(stages.getByRole('button', { name: 'New' })).toHaveAttribute('aria-pressed', 'true');
    await stages.getByRole('button', { name: 'Contacted' }).click();
    await expect(drawer.getByRole('status').filter({ hasText: 'Moved to Contacted.' })).toBeVisible();
    await expect(stages.getByRole('button', { name: 'Contacted' })).toHaveAttribute('aria-pressed', 'true');
    await expect(count('Contacted')).toHaveText('2');
    expect(await sql(`select status from public.leads where id = $1`, [L.dup])).toEqual([{ status: 'contacted' }]);
    expect(await sql(`select meta from public.audit_log where entity = 'lead' and entity_id = $1 and action = 'lead.status'`, [L.dup]))
      .toEqual([{ meta: { from: 'new', to: 'contacted' } }]);

    await drawer.getByLabel('Add note').fill('Left a voicemail.');
    await drawer.getByRole('button', { name: 'Save note' }).click();
    await expect(drawer.getByRole('status').filter({ hasText: 'Note saved.' })).toBeVisible();
    expect(await sql(`select body from public.lead_events where lead_id = $1 and kind = 'note'`, [L.dup])).toEqual([{ body: 'Left a voicemail.' }]);

    await drawer.getByRole('button', { name: 'Done' }).click();
    await expect(drawer).toBeHidden();
    await expect(page).not.toHaveURL(/id=/);
  });

  test('Add lead modal: dedupe note, contact required, a matching phone is flagged as a possible duplicate', async ({ page }) => {
    await signIn(page, '/admin/leads/pipeline');
    await page.getByRole('main').getByRole('link', { name: 'Add lead' }).click();
    const modal = page.getByRole('dialog', { name: 'Add lead' });
    await expect(modal).toContainText('we check the phone and email against existing leads');
    await modal.getByLabel('Name').fill(`Karoo Demo Transport ${tag} (walk-in)`);
    await modal.getByRole('button', { name: 'Save lead' }).click();
    await expect(modal.getByLabel('Email')).toHaveAttribute('aria-invalid', 'true');
    await expect(modal.getByText('Give a valid email, or a phone number with at least 9 digits.')).toBeVisible();
    await shot(page, 'add-lead-1440-light');

    await expect(modal.getByLabel('Name')).toHaveValue(`Karoo Demo Transport ${tag} (walk-in)`); // kept after the error
    await modal.getByLabel('Phone').fill(`023 555 ${digits}`);
    await modal.getByLabel('Product / interest').fill('Diesel bowser');
    await modal.getByRole('button', { name: 'Save lead' }).click();
    await expect(page).toHaveURL(/\/admin\/leads\/[0-9a-f-]{36}$/);
    const id = page.url().split('/').pop()!;
    await expect(page.getByTestId('lead-duplicate')).toContainText('same phone number');
    expect(await sql(`select source, name, duplicate_of from public.leads where id = $1`, [id]))
      .toEqual([{ source: 'manual', name: `Karoo Demo Transport ${tag} (walk-in)`, duplicate_of: L.karoo }]);
  });
});

test.describe('phone 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('stage chips, list then detail with Call/Email, stage pills and notes', async ({ page }) => {
    await open(page, `/admin/leads?q=${tag}`);
    const main = page.getByRole('main');
    const chips = main.getByRole('group', { name: 'Stage' });
    await expect(chips).toBeVisible();
    await expect(main.getByRole('group', { name: 'Filter leads' })).toBeHidden();
    // Phones show the list only until a lead is opened.
    await expect(main.getByRole('region', { name: 'Lead list' })).toBeVisible();
    await expect(main.getByRole('heading', { level: 2 })).toBeHidden();
    await shot(page, 'inbox-390-light');

    await chips.getByRole('link', { name: /^Quoted/ }).click();
    await expect(page).toHaveURL(/status=quoted/);
    await expect(main.getByTestId('lead-row')).toHaveCount(1);
    await main.getByTestId('lead-row').getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/admin/leads/${L.karoo}\\?`), { timeout: 30_000 });
    await expect(main.getByRole('region', { name: 'Lead list' })).toBeHidden();
    await expect(main.getByRole('link', { name: 'Back to leads' })).toHaveAttribute('href', `/admin/leads?q=${tag}&status=quoted`);
    await expect(main.getByRole('link', { name: 'Call', exact: true })).toHaveAttribute('href', `tel:+2723555${digits}`);
    await expect(main.getByRole('link', { name: 'Email', exact: true })).toHaveAttribute('href', `mailto:karoo-${run}@example.invalid`);
    await expect(main.getByLabel('Status')).toBeHidden(); // desktop select; phones use the stage pills
    await shot(page, 'lead-390-light');

    const pills = main.getByRole('group', { name: 'Stage' });
    await pills.getByRole('button', { name: 'Won' }).click();
    await expect(main.getByTestId('lead-status')).toHaveText('Won');
    expect(await sql(`select status from public.leads where id = $1`, [L.karoo])).toEqual([{ status: 'won' }]);

    await main.getByLabel('Add a note').fill('Deposit expected Friday.');
    await main.getByRole('button', { name: 'Save note' }).click();
    await expect(main.getByTestId('lead-notes')).toContainText('Deposit expected Friday.');
  });
});

// Axe (WCAG 2.1 AA) on the leads routes, light and dark, desktop and phone, including the open drawer and modal.
for (const [w, h] of [[1440, 1000], [390, 844]] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`leads routes have no WCAG AA violations at ${w}px ${scheme}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: scheme });
      const audit = async (label: string) => {
        const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(' ')}`), label).toEqual([]);
      };
      await open(page, `/admin/leads?view=all&q=${tag}`);
      await audit('inbox');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
      await page.goto(`/admin/leads/${L.fleet}?q=${tag}`);
      await audit('lead');
      await shot(page, `lead-${w}-${scheme}`);
      await page.goto('/admin/leads/pipeline');
      await page.getByRole('main').getByRole('searchbox', { name: 'Search leads' }).fill(tag);
      await audit('pipeline');
      // The board scrolls inside its own box: no horizontal page scroll.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
      await shot(page, `pipeline-${w}-${scheme}`);
      await page.getByTestId('pipeline-card').filter({ hasText: `Test Fleet Pty ${tag}` }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await audit('pipeline drawer');
      await page.goto('/admin/leads/new');
      await audit('new');
    });
  }
}
