import { z } from 'zod';

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverSchema = publicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

/** Public Supabase settings. Safe for middleware and browser code. */
export function publicEnv() {
  return publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/** Server-only settings including the service role key. Never import from client code. */
export function serverEnv() {
  return serverSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
}

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

const appSchema = z.object({
  APP_URL: z.string().url().default('http://localhost:3000'),
  /** Org that owns the public /f/<slug> links. One org today. */
  PUBLIC_ORG_ID: z.string().uuid().default(DEFAULT_ORG_ID),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  /** Cloudflare Turnstile on public forms. Empty = no check (local dev and the offline e2e stub only). */
  TURNSTILE_SECRET_KEY: z.string().optional(),
});

/** App settings for server code. Optional integrations stay off when their keys are empty. */
export function appEnv() {
  const blank = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
  return appSchema.parse({
    APP_URL: blank(process.env.APP_URL),
    PUBLIC_ORG_ID: blank(process.env.PUBLIC_ORG_ID),
    RESEND_API_KEY: blank(process.env.RESEND_API_KEY),
    MAIL_FROM: blank(process.env.MAIL_FROM),
    TURNSTILE_SECRET_KEY: blank(process.env.TURNSTILE_SECRET_KEY),
  });
}

/** Turnstile site key for the public form widget, or undefined when Turnstile is not configured. */
export function turnstileSiteKey(): string | undefined {
  const v = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return v && v.trim() ? v.trim() : undefined;
}
