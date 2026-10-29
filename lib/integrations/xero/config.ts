import 'server-only';
import { z } from 'zod';
import { appEnv } from '@/lib/env';

// M2 asks Xero for read-only scopes. With these scopes the API itself refuses any write, which backs up the
// code rule (GET only, enforced by tests/unit/xero-no-writes.test.ts). M3 re-consents with write scopes.
export const READ_SCOPES = 'offline_access accounting.transactions.read accounting.contacts.read accounting.attachments.read';
// M3: to allow live Xero actions, set XERO_SCOPES to this and reconnect from the Xero page. The default stays
// read-only; an action can only be live when the stored connection's granted scopes include the write scopes
// (lib/integrations/xero/write/modes.ts).
export const READ_WRITE_SCOPES = 'offline_access accounting.transactions accounting.contacts accounting.attachments';

const schema = z.object({
  XERO_CLIENT_ID: z.string().min(1),
  XERO_CLIENT_SECRET: z.string().min(1),
  XERO_REDIRECT_URI: z.string().url().optional(),
  // Space-separated Xero scopes. Only offline_access and accounting.* scopes are accepted.
  XERO_SCOPES: z.string().min(1)
    .refine((s) => s.split(/\s+/).every((x) => /^(offline_access|openid|profile|email|accounting\.[a-z.]+)$/.test(x)), 'Unknown Xero scope')
    .default(READ_SCOPES),
  XERO_TENANT_ID: z.string().optional(),
  XERO_BACKFILL_FROM: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('2025-01-01'),
  // Overridable only for tests (mock Xero). Defaults are Xero's production endpoints.
  XERO_LOGIN_URL: z.string().url().default('https://login.xero.com'),
  XERO_IDENTITY_URL: z.string().url().default('https://identity.xero.com'),
  XERO_API_URL: z.string().url().default('https://api.xero.com'),
});

export type XeroConfig = z.infer<typeof schema> & { redirectUri: string };

const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export function xeroConfigured(): boolean {
  return !!blank(process.env.XERO_CLIENT_ID) && !!blank(process.env.XERO_CLIENT_SECRET);
}

export function xeroConfig(): XeroConfig {
  const c = schema.parse({
    XERO_CLIENT_ID: blank(process.env.XERO_CLIENT_ID),
    XERO_CLIENT_SECRET: blank(process.env.XERO_CLIENT_SECRET),
    XERO_REDIRECT_URI: blank(process.env.XERO_REDIRECT_URI),
    XERO_SCOPES: blank(process.env.XERO_SCOPES),
    XERO_TENANT_ID: blank(process.env.XERO_TENANT_ID),
    XERO_BACKFILL_FROM: blank(process.env.XERO_BACKFILL_FROM),
    XERO_LOGIN_URL: blank(process.env.XERO_LOGIN_URL),
    XERO_IDENTITY_URL: blank(process.env.XERO_IDENTITY_URL),
    XERO_API_URL: blank(process.env.XERO_API_URL),
  });
  return { ...c, redirectUri: c.XERO_REDIRECT_URI ?? `${appEnv().APP_URL}/admin/integrations/xero/callback` };
}

export function webhookKey(): string | null {
  return blank(process.env.XERO_WEBHOOK_KEY) ?? null;
}
