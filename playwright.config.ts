import { defineConfig, devices } from '@playwright/test';
import { COGNITO_PORT, COGNITO_URL } from './tests/e2e/cognito-env';
import { E2E_XERO, XERO_PORT, XERO_URL } from './tests/e2e/xero-env';

// Ports, database and Next build dir are overridable so parallel runs do not collide.
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? 54399);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: 'off',
    screenshot: 'off',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Real Postgres (shim + migrations) behind a PostgREST/Auth/Storage-compatible test server.
      command: 'node tests/e2e/mini-supabase.mjs',
      url: `http://127.0.0.1:${STUB_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      env: { STUB_PORT: String(STUB_PORT), E2E_DB_NAME: process.env.E2E_DB_NAME ?? 'tt_e2e' },
      gracefulShutdown: { signal: 'SIGTERM', timeout: 2000 },
    },
    {
      // Mock Xero (identity, connections, read-only Accounting API) with synthetic data.
      command: 'node tests/e2e/mock-xero.mjs',
      url: `${XERO_URL}/__health`,
      reuseExistingServer: !process.env.CI,
      env: { XERO_PORT: String(XERO_PORT) },
      gracefulShutdown: { signal: 'SIGTERM', timeout: 2000 },
    },
    {
      // Mock Cognito Forms API (forms list, entries by number, files) with synthetic data.
      command: 'node tests/e2e/mock-cognito.mjs',
      url: `${COGNITO_URL}/__health`,
      reuseExistingServer: !process.env.CI,
      env: { COGNITO_PORT: String(COGNITO_PORT) },
      gracefulShutdown: { signal: 'SIGTERM', timeout: 2000 },
    },
    {
      // Dev server by default: NEXT_PUBLIC_* values are read at runtime, so the stub URL needs no rebuild.
      // E2E_PROD=1 builds and serves production instead: every route is compiled up front, so the whole suite
      // runs without first-visit compile delays (the build bakes in the stub URL and keys below).
      command: process.env.E2E_PROD === '1' ? `pnpm exec next build && pnpm exec next start -p ${APP_PORT}` : `pnpm exec next dev -p ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: process.env.E2E_PROD === '1' ? 600_000 : 120_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'stub-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'stub-service-key',
        APP_URL: `http://127.0.0.1:${APP_PORT}`,
        // Test-only key (not a secret): 32 bytes of 0x07.
        ENTRY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
        RESEND_API_KEY: '',
        // Test-only lead intake secret (40 chars, not a real secret).
        LEADS_WEBHOOK_SECRET: 'test-only-leads-webhook-secret-000000000',
        // Test-only key (not a secret): 32 bytes of 0x09, for Xero tokens at rest.
        ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
        ...E2E_XERO,
        XERO_LOGIN_URL: XERO_URL,
        XERO_IDENTITY_URL: XERO_URL,
        XERO_API_URL: XERO_URL,
        COGNITO_API_URL: `${COGNITO_URL}/api`,
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_DIST_DIR: process.env.NEXT_DIST_DIR ?? '.next',
      },
    },
  ],
});
