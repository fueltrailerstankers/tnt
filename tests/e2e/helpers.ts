import { expect, type Page } from '@playwright/test';
import pg from 'pg';

// Direct database access for assertions (the e2e database built by mini-supabase.mjs). Synthetic data only.
export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const url = new URL(process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres');
  url.pathname = '/tt_e2e';
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  try {
    return (await c.query(text, params)).rows as T[];
  } finally {
    await c.end();
  }
}

export const ADMIN = { email: 'admin@example.invalid', password: 'correct-horse-battery' };

export async function signIn(page: Page, next = '/admin') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Password').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[/?]/g, '\\$&')}$`));
}

/** Draws a short stroke on a signature canvas. */
export async function sign(page: Page, field: string) {
  const c = page.getByTestId(`sig-${field}`);
  await c.scrollIntoViewIfNeeded();
  const box = (await c.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 60, { steps: 5 });
  await page.mouse.move(box.x + 200, box.y + 30, { steps: 5 });
  await page.mouse.up();
}

/** Minimal valid files, identified by magic bytes. */
export const PDF = { name: 'proof.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') };
export const PNG = {
  name: 'photo.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64'),
};
export const FAKE_PDF = { name: 'invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('<html><script>alert(1)</script></html>') };

export async function attach(page: Page, field: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByTestId(`file-${field}`).setInputFiles(file);
  await expect(page.getByText('uploading…')).toHaveCount(0, { timeout: 15_000 });
}
