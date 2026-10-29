# Trailers & Tankers platform

Central platform replacing Cognito Forms and the Make.com glue. Next.js 15, TypeScript, Supabase, Vercel.
Read `BUILD_PLAN.md` for the full plan and `CLAUDE.md` for the working rules. Current phase: **M0 (bootstrap)**.

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
pnpm test:e2e    # Playwright smoke against a Supabase stub (no real project needed)
```

`pnpm test:db` needs `DATABASE_URL` pointing at a disposable Postgres 15+ superuser connection
(default `postgres://postgres@127.0.0.1:54329/postgres`). It creates and drops a `tt_test` database.
`tests/db/shim.sql` is a test-only stand-in for Supabase's `auth` and `storage` schemas.

## Database

`supabase/migrations/0001..0003` come unchanged from the forms kit (`docs/source/tt-forms`).
`0004` adds orgs, memberships, org-keyed RLS, audit, notification recipients, settings and integration plumbing.
Never edit an applied migration; add a new one.

Apply to a Supabase project with `supabase db push` (or paste the files in order into the SQL editor).

## First admin

There is no public sign-up. Create the first admin with the service role key:

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='at-least-12-characters' pnpm create-admin
```

The script prints only the user id.
