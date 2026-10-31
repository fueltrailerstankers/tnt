// M8 Part B acceptance (docs/M8.md): create a form with every palette type, required + show-when; publish; submit
// publicly; grid, export and PDF; edit (add, reorder, relabel) with old entries still rendering; deleting or
// retyping a field with data is refused; export JSON and import it as a new form; version history and restore;
// staff without forms.manage are refused. Synthetic data only.
import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { signIn, sql } from './helpers';

const RUN = Date.now().toString(36);
const NAME = `Builder ${RUN}`;
const SLUG = `builder-${RUN}`;
const THANKS = 'Thank you for filling out the form. Your response has been recorded.';

function pdfText(pdf: Buffer): string {
  let out = '';
  for (const m of pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let s: string;
    try { s = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
    for (const h of s.matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(h[1], 'hex').toString('latin1');
  }
  return out;
}

async function select(page: Page, name: string) {
  await page.getByTestId(`item-${name}`).locator('button[aria-pressed]').click();
}

async function publish(page: Page) {
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/design')),
    page.getByRole('button', { name: 'Publish', exact: true }).click(),
  ]);
}

test('form builder: create, publish, submit, edit with guards, export/import, history, permissions', async ({ page, browser }) => {
  test.setTimeout(180_000);
  // --- create a blank form -------------------------------------------------------------------------
  await signIn(page, '/admin/forms');
  await page.getByRole('main').getByRole('link', { name: 'New form' }).click();
  await expect(page).toHaveURL(/\/admin\/forms\/new$/);
  await page.getByLabel('Form name').fill(NAME);
  await page.getByLabel('Public link on').check();
  await page.getByRole('button', { name: 'Create form' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/forms/${SLUG}/design\\?created=1$`), { timeout: 90_000 }); // first compile of the designer
  await expect(page.getByText('Form created. Add fields, then Publish.')).toBeVisible();

  // --- every palette type -------------------------------------------------------------------------
  const palette = ['Text', 'Paragraph', 'Email', 'Phone', 'Website', 'Number', 'Amount', 'Date', 'Time', 'Date and time', 'Yes/No', 'Choice',
    'Name', 'Address', 'File upload', 'Signature', 'Lookup', 'Rating', 'Section', 'Text block', 'Page break'];
  for (const label of palette) await page.getByRole('button', { name: `Add ${label}`, exact: true }).click();
  await expect(page.getByTestId('canvas').locator('li')).toHaveCount(palette.length);

  await select(page, 'Text');
  await page.getByTestId('field-panel').getByLabel('Required', { exact: true }).check();
  await select(page, 'Paragraph');
  await page.locator('#sw-field').selectOption('YesNo');
  await page.locator('#sw-op').selectOption('=');
  await page.locator('#sw-value').fill('true');
  await page.getByRole('button', { name: 'Set rule' }).click();
  await expect(page.locator('#fp-showWhen')).toHaveValue('YesNo = true');
  await select(page, 'Lookup');
  await page.locator('#fp-lsrc').selectOption('request-for-invoice');
  await page.locator('#fp-lfield').selectOption('QuoteNo');
  // Live preview: the show-when rule already applies there.
  await expect(page.getByTestId('preview').locator('#f-Paragraph')).toBeHidden();
  await page.getByRole('radiogroup', { name: 'Preview width' }).getByText('Phone (390px)').click();
  await expect(page.getByTestId('preview')).toHaveClass(/max-w-\[390px\]/);

  await page.getByRole('button', { name: 'settings', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Text', exact: true }).check();
  await publish(page);
  await expect(page.getByText('Published version 2.')).toBeVisible();
  const [form] = await sql<{ id: string; version: number; spec: { cognitoFormId: number; settings: { layout: string } } }>(`select id, version, spec from forms where slug = $1`, [SLUG]);
  expect(form.version).toBe(2);
  expect(form.spec.cognitoFormId).toBe(0);
  expect(form.spec.settings.layout).toBe('exact');
  expect(await sql(`select name from form_statuses where form_id = $1 order by sort_order`, [form.id])).toEqual([{ name: 'Incomplete' }, { name: 'Submitted' }]);

  // --- public submit: required and show-when, client side -------------------------------------------
  await page.goto(`/f/${SLUG}`);
  await expect(page.getByRole('heading', { name: NAME })).toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('This field is required.')).toHaveCount(1);
  await expect(page.locator('#f-Paragraph')).toBeHidden();
  await page.locator('#f-Text').fill('Synthetic text');
  await page.getByRole('radiogroup', { name: 'Yes/No' }).getByLabel('Yes').check();
  await expect(page.locator('#f-Paragraph')).toBeVisible();
  await page.locator('#f-Paragraph').fill('Shown because Yes');
  await page.locator('#f-Amount').fill('250');
  await page.locator('#f-Phone').fill('082 000 0002');
  await page.locator('#f-Choice').selectOption('Option 2');
  await page.getByRole('radio', { name: '4 stars' }).check();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(THANKS)).toBeVisible();
  const [entry] = await sql<{ number: number; summary: string; data: Record<string, unknown> }>(
    `select e.number, e.summary, e.data from entries e where e.form_id = $1`, [form.id]);
  expect(entry).toMatchObject({ number: 1, summary: 'Synthetic text' });
  expect(entry.data).toMatchObject({ Text: 'Synthetic text', YesNo: true, Paragraph: 'Shown because Yes', Amount: { amount: 250, currency: 'USD' }, Choice: 'Option 2', Rating: 4 });

  // --- grid, export, PDF ---------------------------------------------------------------------------
  await page.goto(`/admin/forms/${SLUG}?cols=Text,Amount,Rating`);
  const row = page.getByTestId('entry-1');
  await expect(row).toContainText('Synthetic text');
  await expect(row).toContainText('$250.00');
  await expect(row).toContainText('4/5');
  const csv = await (await page.request.get(`/admin/forms/${SLUG}/export?format=csv`)).text();
  expect(csv).toContain('Amount currency');
  expect(csv).toContain('Synthetic text');
  expect(csv).toContain('250.00,USD');
  const pdf = await page.request.get(`/admin/forms/${SLUG}/entries/1/documents/1`);
  expect(pdf.status()).toBe(200);
  const text = pdfText(await pdf.body());
  for (const t of ['Synthetic text', 'Shown because Yes', '$250.00', 'Option 2', '4/5']) expect(text, t).toContain(t);

  // --- edit: add, reorder, relabel; old entries still render ------------------------------------------
  await page.goto(`/admin/forms/${SLUG}/design`);
  await select(page, 'Text');
  await page.getByRole('button', { name: 'Add Number', exact: true }).click();
  await page.locator('#fp-label').fill('Quantity two');
  await expect(page.getByTestId('field-panel')).toContainText('Saved as QuantityTwo');
  await page.getByRole('button', { name: 'Move Quantity two up' }).click();
  await expect(page.getByTestId('canvas').locator('li').first()).toHaveAttribute('data-testid', 'item-QuantityTwo');
  await select(page, 'Text');
  await page.locator('#fp-label').fill('Title text');
  await expect(page.getByTestId('field-panel')).toContainText('Saved as Text');
  await publish(page);
  await expect(page.getByText('Published version 3.')).toBeVisible();
  await page.goto(`/admin/forms/${SLUG}/entries/1`);
  await expect(page.getByRole('main').locator('#f-Text')).toHaveValue('Synthetic text');
  await expect(page.getByRole('main').locator('label[for="f-Text"]')).toContainText('Title text'); // the timeline also names the field

  // --- guards: a field with data cannot be deleted or retyped ---------------------------------------
  await page.goto(`/admin/forms/${SLUG}/design`);
  await expect(page.getByRole('button', { name: 'Remove Title text' })).toBeDisabled();
  await select(page, 'Text');
  await page.locator('#fp-type').selectOption('number');
  await publish(page);
  await expect(page.getByTestId('publish-problems')).toContainText('type cannot change from text to number');
  expect((await sql<{ version: number }>(`select version from forms where id = $1`, [form.id]))[0].version).toBe(3);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('#fp-type')).toHaveValue('text');

  // --- export JSON and import it as a new form ------------------------------------------------------
  const exported = await page.request.get(`/admin/forms/${SLUG}/spec.json`);
  expect(exported.status()).toBe(200);
  const json = await exported.body();
  expect(JSON.parse(json.toString()).slug).toBe(SLUG);
  await page.goto('/admin/forms/new');
  await page.getByRole('radiogroup', { name: 'Start from' }).getByText('Import JSON').click();
  await page.getByLabel('Form name').fill(`Imported ${RUN}`);
  await page.locator('#nf-file').setInputFiles({ name: 'form.json', mimeType: 'application/json', buffer: json });
  await page.getByRole('button', { name: 'Create form' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/forms/imported-${RUN}/design\\?created=1$`), { timeout: 30_000 });
  await expect(page.getByTestId('item-QuantityTwo')).toBeVisible();
  await expect(page.getByTestId('canvas').locator('li')).toHaveCount(palette.length + 1);

  // --- history and restore ---------------------------------------------------------------------------
  await page.goto(`/admin/forms/${SLUG}/design?tab=history`);
  await expect(page.getByTestId('versions').locator('li')).toHaveCount(3);
  await page.getByTestId('versions').locator('li', { hasText: 'Version 2' }).getByRole('button', { name: 'Restore as draft' }).click();
  await expect(page).toHaveURL(/\?restored=2$/);
  await expect(page.getByText('Version 2 restored as the draft. Publish to use it.')).toBeVisible();
  await expect(page.getByTestId('item-QuantityTwo')).toHaveCount(0);
  await expect(page.getByTestId('item-Text')).toBeVisible();

  const audit = await sql<{ action: string }>(
    `select action from audit_log where entity_id in (select id::text from forms where slug in ($1, $2)) order by created_at`, [SLUG, `imported-${RUN}`]);
  expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['form.create', 'form.publish', 'form.import', 'form.restore_draft', 'form.export']));

  // --- staff without forms.manage cannot reach the builder (the server refuses) ------------------------
  const ctx = await browser.newContext();
  const staff = await ctx.newPage();
  await staff.goto('/login?next=%2Fadmin%2Fforms');
  await staff.getByLabel('Email').fill('staff-m8@example.invalid');
  await staff.getByLabel('Password').fill('correct-horse-battery');
  await staff.getByRole('button', { name: 'Sign in' }).click();
  await expect(staff).toHaveURL(/\/admin\/forms$/);
  await expect(staff.getByRole('main').getByRole('link', { name: 'New form' })).toHaveCount(0);
  await expect(staff.getByRole('main').getByRole('link', { name: 'Design' })).toHaveCount(0);
  for (const url of [`/admin/forms/${SLUG}/design`, '/admin/forms/new']) {
    const res = await staff.goto(url);
    expect(res?.status(), url).toBeGreaterThanOrEqual(400);
    await expect(staff.getByRole('heading', { name: /^Design ·|^New form$/ })).toHaveCount(0);
  }
  expect((await staff.request.get(`/admin/forms/${SLUG}/spec.json`)).status()).toBeGreaterThanOrEqual(400);
  await ctx.close();
});
