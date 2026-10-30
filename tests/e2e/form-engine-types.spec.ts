// M8 Part A: a synthetic form with every field type, required fields and show-when rules (inserted via SQL),
// submitted on the public link; required and show-when are enforced in the browser and on the server; the
// entry shows every value in the grid, the export and the entry PDF. Synthetic data only.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { signIn, sql } from './helpers';

const SLUG = 'engine-types-test';
const SPEC = JSON.parse(readFileSync(path.resolve(__dirname, '../fixtures/m8/engine-types.json'), 'utf8'));
const THANKS = 'Thank you for filling out the form. Your response has been recorded.';
const RUN = Date.now().toString(36);
const TITLE = `Job ${RUN}`;

/** Text of a react-pdf document (standard fonts write hex strings into Flate streams). */
function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  let out = '';
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let s: string;
    try {
      s = inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const h of s.matchAll(/<([0-9a-fA-F]+)>/g)) out += Buffer.from(h[1], 'hex').toString('latin1');
  }
  return out;
}

test.beforeAll(async () => {
  await sql(
    `insert into forms (org_id, slug, name, internal_name, sort_order, entry_summary_template, encrypt_entries, is_active, spec)
     values ((select org_id from forms where slug = 'job-card'), $1, $2, $3, 99, $4, false, true, $5)
     on conflict (org_id, slug) do update set spec = excluded.spec, entry_summary_template = excluded.entry_summary_template, is_active = true`,
    [SLUG, SPEC.name, SPEC.internalName, SPEC.settings.entrySummary, JSON.stringify(SPEC)],
  );
});

async function fillValid(page: Page) {
  await page.getByLabel('Title', { exact: true }).fill(TITLE);
  await page.getByLabel('Code').fill('ab-1');
  await page.getByLabel('Ref').fill('AB 12');
  await page.getByLabel('Notes').fill('Synthetic notes');
  await page.getByLabel('Email').fill('test@example.invalid');
  await page.getByLabel('Phone').fill('082 000 0001');
  await page.getByLabel('Website').fill('example.invalid/x');
  await page.getByLabel('Price', { exact: true }).fill('1 500.50');
  await page.getByLabel('Quantity').fill('3');
  await page.getByLabel('Due date').fill('2026-11-02');
  await page.getByLabel('Start time').fill('09:15');
  await page.getByLabel('Appointment').fill('2026-11-03T10:30');
  await page.getByRole('switch', { name: 'I agree to the terms' }).check();
  await page.getByRole('radio', { name: '4 stars' }).check();
  await page.getByRole('group', { name: 'Extras' }).getByLabel('Ramp').check();
  await page.getByRole('group', { name: 'Extras' }).getByLabel('Other', { exact: true }).check();
  await page.locator('#f-Extras-other').fill('Toolbox');
  await page.getByLabel('Size').selectOption('L');
  await page.locator('#f-Contact-First').fill('Test');
  await page.locator('#f-Contact-Last').fill('Person');
  await page.locator('#f-Site-City').fill('Test City');
}

test('every field type: public submit with required + show-when, then grid, export and PDF', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes(`/f/${SLUG}`)) posts.push(r.url());
  });
  await page.goto(`/f/${SLUG}`);
  await expect(page.getByRole('heading', { name: 'ENGINE TYPES TEST' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'About the job' })).toBeVisible();
  await expect(page.getByText('Two to forty characters.')).toBeVisible();
  await expect(page.getByText('Bold')).toBeVisible();
  await expect(page.getByRole('link', { name: 'link' })).toHaveAttribute('href', 'https://example.invalid/terms');
  // internalOnly is not on the public form at all.
  await expect(page.getByText('Internal note')).toHaveCount(0);

  // --- required, client side: nothing is posted ----------------------------------------------------
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByLabel('Fixed ref')).toHaveValue('REF-001');
  await expect(page.getByLabel('Fixed ref')).toHaveAttribute('readonly', '');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Please correct the highlighted fields.')).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toBeVisible(); // jumped back to page 1
  await expect(page.getByText('This field is required.')).toHaveCount(7);
  expect(posts).toHaveLength(0);

  // --- show-when, client side ------------------------------------------------------------------------
  await expect(page.getByLabel('Why is it urgent?')).toBeHidden();
  await page.getByRole('radiogroup', { name: 'Urgent?' }).getByLabel('Yes').check();
  await expect(page.getByLabel('Why is it urgent?')).toBeVisible();
  await expect(page.getByLabel('Red delivery note')).toBeHidden();
  await page.getByRole('radiogroup', { name: 'Colour' }).getByLabel('Red').check();
  await expect(page.getByRole('heading', { name: 'Red delivery' })).toBeVisible();
  await page.getByLabel('Red delivery note').fill('should not be saved');
  await page.getByRole('radiogroup', { name: 'Colour' }).getByLabel('Other', { exact: true }).check();
  await page.locator('#f-Colour-other').fill('Orange');
  await expect(page.getByLabel('Red delivery note')).toBeHidden();

  await fillValid(page);
  // A shown required field blocks the submit until filled (still client side).
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('This field is required.')).toHaveCount(1);
  await expect(page.getByLabel('Why is it urgent?')).toBeVisible();
  expect(posts).toHaveLength(0);
  await page.getByLabel('Why is it urgent?').fill('Synthetic reason');

  // --- the server enforces the same rules: a tampered post (Title blanked) is refused ------------------
  await page.route(`**/f/${SLUG}`, async (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    const body = (req.postDataBuffer() ?? Buffer.alloc(0)).toString('latin1');
    const tampered = body.replace(/(name="\d+_f\.Title"\r\n\r\n)[^\r]*/, '$1');
    expect(tampered).not.toBe(body);
    await route.continue({ postData: Buffer.from(tampered, 'latin1') });
  });
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('This field is required.')).toHaveCount(1);
  await expect(page.getByText('Please correct the highlighted fields.')).toBeVisible();
  expect(posts).toHaveLength(1);
  await page.unroute(`**/f/${SLUG}`);
  expect(await sql(`select 1 from entries e join forms f on f.id = e.form_id where f.slug = $1 and e.summary like $2`, [SLUG, `${TITLE}%`])).toHaveLength(0);

  // readOnly and internalOnly cannot be changed by the public role, even with a forged value.
  await page.evaluate(() => {
    const ro = document.querySelector<HTMLInputElement>('#f-FixedRef')!;
    ro.removeAttribute('readonly');
    ro.value = 'FORGED';
    const extra = document.createElement('input');
    extra.type = 'hidden';
    extra.name = 'f.InternalNote';
    extra.value = 'forged';
    document.querySelector('form')!.appendChild(extra);
  });
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText(THANKS)).toBeVisible();

  // --- stored values -------------------------------------------------------------------------------
  const [e] = await sql<{ id: string; number: number; status: string; summary: string; data: Record<string, unknown> }>(
    `select e.id, e.number, e.status, e.summary, e.data from entries e join forms f on f.id = e.form_id where f.slug = $1 and e.summary like $2`,
    [SLUG, `${TITLE}%`],
  );
  expect(e).toMatchObject({ status: 'Submitted', summary: `${TITLE} 082 000 0001` });
  expect(e.data).toEqual({
    Title: TITLE, Code: 'AB-1', Ref: 'AB 12', Notes: 'Synthetic notes', Email: 'test@example.invalid',
    Phone: { phone: '082 000 0001', digits: '0820000001' }, Website: 'https://example.invalid/x',
    Price: { amount: 1500.5, currency: 'ZAR' }, Qty: 3, Due: '2026-11-02', StartTime: '09:15',
    Appointment: '2026-11-03T08:30:00.000Z', // entered 10:30 Africa/Johannesburg, stored UTC
    Urgent: true, UrgentReason: 'Synthetic reason', Agree: true, Score: 4, Colour: 'Orange', Extras: ['Ramp', 'Toolbox'], Size: 'L',
    Contact: { First: 'Test', Last: 'Person' }, Site: { City: 'Test City' }, FixedRef: 'REF-001',
  });
  expect(e.data).not.toHaveProperty('RedNote'); // hidden by show-when: not saved
  expect(e.data).not.toHaveProperty('InternalNote'); // internalOnly: the public cannot set it

  // --- staff: grid (with phone digits search), entry page, export, PDF --------------------------------
  await signIn(page, `/admin/forms/${SLUG}?q=0820000001&cols=Phone,Price,Appointment,Score`);
  const row = page.getByTestId(`entry-${e.number}`);
  await expect(row).toContainText('082 000 0001');
  await expect(row).toContainText('ZAR 1,500.50');
  await expect(row).toContainText('2026-11-03 10:30');
  await expect(row).toContainText('4/5');

  await page.goto(`/admin/forms/${SLUG}/entries/${e.number}`);
  const main = page.getByRole('main');
  await expect(main.getByLabel('Appointment')).toHaveValue('2026-11-03T10:30');
  await expect(main.getByLabel('Price', { exact: true })).toHaveValue('1500.50');
  await expect(main.locator('#f-Colour-other')).toHaveValue('Orange');
  await main.getByRole('button', { name: 'Next' }).click();
  await main.getByLabel('Internal note').fill('Staff only note');
  await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes(`/entries/${e.number}`)),
    main.getByRole('button', { name: 'Update' }).click(),
  ]);
  await expect(page.getByText('Saved. Status: Submitted')).toBeVisible();
  const [after] = await sql<{ data: Record<string, unknown> }>(`select data from entries where id = $1`, [e.id]);
  expect(after.data).toMatchObject({ InternalNote: 'Staff only note', Appointment: '2026-11-03T08:30:00.000Z', Price: { amount: 1500.5, currency: 'ZAR' } });

  const csv = await (await page.request.get(`/admin/forms/${SLUG}/export?format=csv&q=${encodeURIComponent(TITLE)}`)).text();
  const [header, line] = csv.replace(/^﻿/, '').trim().split('\r\n');
  const cols = header.split(',');
  const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
  const got = Object.fromEntries(cols.map((h, i) => [h, cells[i]]));
  expect(got).toMatchObject({
    Title: TITLE, Phone: '082 000 0001', Website: 'https://example.invalid/x', Price: '1500.50', 'Price currency': 'ZAR',
    Appointment: '2026-11-03 10:30', 'Start time': '09:15', 'Urgent?': 'Yes', 'I agree to the terms': 'Yes', Score: '4',
    Colour: 'Orange', Extras: 'Ramp, Toolbox', 'Internal note': 'Staff only note', 'Red delivery note': '',
  });
  expect(cols).not.toContain('About the job');

  const pdf = await page.request.get(`/admin/forms/${SLUG}/entries/${e.number}/documents/1`);
  expect(pdf.status()).toBe(200);
  const body = await pdf.body();
  expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  const text = pdfText(body);
  for (const t of ['About the job', TITLE, 'AB-1', '082 000 0001', 'https://example.invalid/x', 'ZAR 1,500.50', '2026-11-03 10:30', '09:15', 'Synthetic reason', '4/5', 'Orange', 'Ramp, Toolbox', 'Test Person', 'Staff only note', 'REF-001', 'First point']) {
    expect(text, t).toContain(t);
  }
  expect(text).not.toContain('Red delivery');
});
