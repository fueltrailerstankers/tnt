# CLAUDE.md: Trailers & Tankers platform
Read BUILD_PLAN.md first, then do only the phase asked. Start each phase in plan mode.
Source of truth for forms: docs/source/tt-forms/spec/forms/*.json. Never rename field names. Legal text in content/*.md is verbatim, typos intentional.

## Non-negotiables
1. Xero is the book of record. Never create quotes. Never delete financial rows or Xero records. Writes only through the claimed, idempotent action functions, dry-run by default.
2. RLS on every table keyed on org. Service role only in server code after can()/requirePerm. Keep cross-org tests green.
3. Webhooks: verify signature, store raw, enqueue, 200 fast. Processing is idempotent and replayable.
4. Every mutation checks permission server-side, including workflow allowedWhen.
5. No real personal data in seeds, tests, fixtures, logs, screenshots or prompts. Never log tokens, ID numbers, emails, file names.
6. Secrets and Xero tokens encrypted at rest (AES-256-GCM). Encrypt DEAL and Delivery Note entry data.
7. Money fields carry currency code. Display default USD, Xero data is ZAR. Time: Africa/Johannesburg for display, UTC stored.
8. Business logic in lib/* as pure functions with unit tests. Route handlers and server actions stay thin, validated with Zod.
9. Jobs are short, batched, idempotent and log to job_runs.
10. Never edit applied migrations. New migration per schema change. Regenerate types.
11. Never activate, edit or delete a Make scenario. Read only.

Definition of done: typecheck, lint, tests pass; acceptance list shown working; docs updated.

## Repo notes (added in M0)
- Commands: `pnpm typecheck`, `pnpm lint`, `pnpm test` (unit), `pnpm test:db` (migrations + RLS on a throwaway Postgres), `pnpm test:e2e` (Playwright against a Supabase stub), `pnpm create-admin`.
- Migrations: `supabase/migrations/0001..0003` are the kit's, unchanged. `0004` adds orgs/memberships, org-keyed RLS and plumbing. Kit view `v_*` filter by form slug only; RLS (security_invoker) scopes them to the caller's orgs.
- Org-owned child tables get `org_id` from their parent via trigger (`tg_org_from_parent`); never trust a client-supplied `org_id`.
- Tables with no client policies or grants (service role only): integration_events, outbox_jobs, job_runs, external_refs, action_claims, xero_connections. audit_log is append-only.
- `tests/db/shim.sql` is a test-only stand-in for Supabase `auth`/`storage`. Never apply it to a real project. A new table must be added to `tests/db/rls.test.ts` or the coverage test fails.
- `tests/e2e/mini-supabase.mjs` serves a PostgREST/Auth/Storage-compatible API over a real Postgres built from the shim + migrations, as the caller's role with JWT claims, so RLS is exercised. It supports only the query syntax the app uses and returns 400 for anything else: extend it when you add a new query pattern. Real-project checks are separate.
- Permissions live in `lib/security/can.ts` (pure, tested). Use `requirePerm()` from `lib/security/require.ts` at the top of every server action and route handler.
- Server actions files (`'use server'`) may export only async functions; keep helpers in separate modules.
- Branch for the current work is set per session; do not open a PR unless asked.

## Repo notes (added in M1)
- Form engine: `lib/spec` (pure: types, layout, expressions, values, content), `lib/workflow` (rules and email templating pure; `run-action.ts` is the only place entries are saved), `components/form-engine` (client renderer).
- Every save goes through `runAction()`: role + `allowedWhen` + per-action permission, then validation, save, files, timeline, documents, emails. Do not write `entries` anywhere else.
- Public and role-link server actions use the service role only after the form/link checks in their own file. Staff actions start with `adminForm(slug, perm)` (`lib/admin/context.ts`).
- Uploads: browser -> Storage via signed upload URLs into `staging/`; the server sniffs magic bytes and moves them on save. Never accept a path outside `staging/` from a client.
- Encrypted forms (DEAL, Delivery Note) keep `data = {}` and `data_encrypted` (AES-256-GCM, AAD = entry id). Only summary/number/status are in clear; `v_*` views show nulls for them.
- Timeline (`entry_events.diff`) stores changed field keys only, never values. `email_log` stores recipients and subject, never bodies.
- Role-link tokens are stored as sha256 hex in `entry_links.token`. Internal roles never use bearer links; they go to `/admin`.
- Generated PDFs are immutable versions in the `documents` bucket with sha256; the Delivery Note PDF is the signed customer record.
- Legal text: edit the kit's `content/*.md`, then `pnpm build:content`.

## Repo notes (added in M2-M5)
- Xero: reads only through `XeroReader` (GET). Every non-GET goes through `lib/integrations/xero/write/writer.ts`; `tests/unit/xero-no-writes.test.ts` enforces it. Actions default to off; mode in app_settings `xero.action.<name>`; every attempt is a redacted `xero_action_runs` row; live writes are claimed once in `action_claims`.
- Mirror sync is resumable (cursor saved per page). Jobs run from `/api/jobs/<queue>` with `JOB_SECRET`, scheduled by `supabase/scheduler.sql` (pg_cron + pg_net + Vault).
- Leads (M4): `lib/leads/*` pure rules and service; webhook verifies, stores raw, dedupes on source id. Lead matching runs nightly after the full sync.
- Cognito import (M5): `scripts/import-cognito.ts` (run with `tsx --conditions=react-server`), dry-run by default; see docs/M5.md.
- E2E tests share one mini-supabase database: specs that count rows must scope by tenant/run id, and a test must wait for a server action's response before navigating.
