// Test-only Xero settings shared by playwright.config.ts and xero.spec.ts. None of these are secrets.
// The client id/secret must match tests/e2e/mock-xero.mjs.
export const E2E_XERO = {
  XERO_CLIENT_ID: 'e2e-xero-client-id',
  XERO_CLIENT_SECRET: 'e2e-xero-client-secret-not-real',
  XERO_WEBHOOK_KEY: 'e2e-xero-webhook-key-not-real',
  JOB_SECRET: 'e2e-job-secret-not-real-0123456789abcdef',
};

export const XERO_PORT = Number(process.env.E2E_XERO_PORT ?? 54599);
export const XERO_URL = `http://127.0.0.1:${XERO_PORT}`;
