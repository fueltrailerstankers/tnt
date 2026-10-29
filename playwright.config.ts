import { defineConfig, devices } from '@playwright/test';

const APP_PORT = 3100;
const STUB_PORT = 54399;

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
      env: { STUB_PORT: String(STUB_PORT) },
      gracefulShutdown: { signal: 'SIGTERM', timeout: 2000 },
    },
    {
      // Dev server: NEXT_PUBLIC_* values are read at runtime, so the stub URL needs no rebuild.
      command: `pnpm exec next dev -p ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}/login`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${STUB_PORT}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'stub-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'stub-service-key',
        APP_URL: `http://127.0.0.1:${APP_PORT}`,
        // Test-only key (not a secret): 32 bytes of 0x07.
        ENTRY_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
        RESEND_API_KEY: '',
        NEXT_TELEMETRY_DISABLED: '1',
      },
    },
  ],
});
