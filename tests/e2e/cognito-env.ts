// Test-only Cognito settings shared by playwright.config.ts and cognito-import.spec.ts. Not secrets.
// The key must match tests/e2e/mock-cognito.mjs.
export const COGNITO_PORT = Number(process.env.E2E_COGNITO_PORT ?? 54598);
export const COGNITO_URL = `http://127.0.0.1:${COGNITO_PORT}`;
export const COGNITO_KEY = 'e2e-cognito-key-not-real-0123';
