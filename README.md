# Trailers & Tankers platform

Central platform replacing Cognito Forms and the Make.com glue. Next.js 15, TypeScript, Supabase, Vercel.
Read `BUILD_PLAN.md` for the full plan and `CLAUDE.md` for the working rules. Current phase: **M1 (forms engine)**. See `docs/M1.md` for what M1 covers and the points to confirm with the owner.

## Local setup

```bash
pnpm install
cp .env.example .env.local   # fill in the Supabase values
pnpm dev
```

## Checks

```bash
pnpm typecheck && pnpm lint
pnpm test        # unit
pnpm test:db     # applies shim + supabase/migrations to a throwaway Postgres and runs RLS tests
pnpm test:e2e    # Playwright flows against tests/e2e/mini-supabase.mjs (real Postgres, no real project)
```

`pnpm test:db` needs `DATABASE_URL` pointing at a disposable Postgres 15+ superuser connection
(default `postgres://postgres@127.0.0.1:54329/postgres`). It creates and drops a `tt_test` database.
`tests/db/shim.sql` is a test-only stand-in for Supabase's `auth` and `storage` schemas.

`pnpm test:e2e` uses the same `DATABASE_URL` server: `tests/e2e/mini-supabase.mjs` builds a `tt_e2e` database from
the shim and migrations and serves a PostgREST/Auth/Storage-compatible API over it, so RLS and grants are real.
Set `PLAYWRIGHT_CHROMIUM_PATH` to use an already installed Chromium.

## UI

Design tokens, fonts (Manrope, JetBrains Mono) and light/dark themes are in `app/globals.css`; the staff shell is
`components/shell`, base components are `components/ui`. Route map from the design handoff to this repo:

| Handoff | Repo |
|---|---|
| `/`, `/tasks`, `/forms`, `/settings` | `/admin`, `/admin/tasks`, `/admin/forms`, `/admin/settings` |
| `/forms/[form]`, `/forms/[form]/[id]`, `/forms/[form]/new` | `/admin/forms/[slug]`, `/admin/forms/[slug]/entries/[number]`, `/admin/forms/[slug]/new` |
| `/deals/[quoteNo]` | `/admin/deal-files/[quoteNo]` |
| `/quotes`, `/invoices` | `/admin/xero/quotes`, `/admin/xero/invoices` |
| `/integrations/xero` | `/admin/integrations/xero` |
| `/leads`, `/leads/pipeline`, Documents | not built yet (hidden from navigation) |
| `/f/...`, `/e/[token]` | unchanged |

### Forms (UI)

All seven forms share one renderer (`components/form-engine/FormRenderer.tsx`) driven by the spec plus a
presentation layer (`lib/spec/presentation.ts`) for section cards, packed columns and steps. Public forms are
phone-first (48px controls, 16px text) and show a secure badge; set `TURNSTILE_SECRET_KEY` and
`NEXT_PUBLIC_TURNSTILE_SITE_KEY` in production to turn on the Cloudflare Turnstile check.

## Database

`supabase/migrations/0001..0003` come unchanged from the forms kit (`docs/source/tt-forms`).
`0004` adds orgs, memberships, org-keyed RLS, audit, notification recipients, settings and integration plumbing.
`0005` adds the forms-engine support: grid search and listing (`list_entries`), the admin overview (`form_overview`),
immutable PDF versions with hashes, hashed role-link tokens, recipients seeded from the spec inboxes and upload limits.
Never edit an applied migration; add a new one.

Apply to a Supabase project with `supabase db push` (or paste the files in order into the SQL editor).

## First admin

There is no public sign-up. Create the first admin with the service role key:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='at-least-12-characters' pnpm create-admin
```

The script prints only the user id.

## Forms (M1)

- Public links: `/f/<slug>` for the 7 kit forms. Role links from workflow emails: `/e/<token>`.
- Admin: `/admin` (home), `/admin/tasks`, `/admin/forms/<slug>` (entries), `/admin/settings`.
- `ENTRY_ENCRYPTION_KEY` is required: DEAL and Delivery Note entries are encrypted with it. Generate one with
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` and keep it safe; losing it loses those entries.
- Emails: with `RESEND_API_KEY` and `MAIL_FROM` set, workflow emails are sent through Resend. Without them nothing is
  sent and `email_log` records each email as `skipped` (log-only mode).
- Legal text (`content/*.md`) ships as `lib/spec/content.generated.ts`. After changing the kit content run `pnpm build:content`;
  a unit test fails if the two drift.

## Xero, leads and import (M2-M5)

- M2 Xero read-only mirror, deal files, scheduler: [docs/M2.md](docs/M2.md). Scheduler SQL: `supabase/scheduler.sql`.
- M3 Xero write actions, all **off** by default; dry run first, live needs write scopes and a typed confirmation:
  [docs/M3.md](docs/M3.md). Settings at `/admin/integrations/xero/actions`. Parity: `scripts/replay-make.ts`.
- M4 leads inbox (manual and test sources, webhook `/api/webhooks/leads`): [docs/M4.md](docs/M4.md).
- M5 Cognito history import (dry-run first, idempotent, resumable), parallel run and cutover: [docs/M5.md](docs/M5.md).
- `pnpm test:e2e` with an already installed Chromium: set `PLAYWRIGHT_CHROMIUM_PATH` to its headless shell binary.
