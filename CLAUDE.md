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

## Repo notes (UI handoff, step 1)
- Design handoff: `tt-platform-handoff` (HANDOFF.md, `styles/`, `design/*.dc.html`). Staff routes keep the `/admin` prefix; handoff `/x` maps to `/admin/x` (quotes/invoices are `/admin/xero/*`, deals are `/admin/deal-files`).
- Tokens live in `app/globals.css` (`:root`, `[data-theme="dark"]`, OS dark fallback) and are mapped to Tailwind names in its `@theme inline` block (`bg-surface`, `text-fg-muted`, `bg-accent text-accent-fg`, `bg-status-red-bg`, `rounded-pill`, `shadow-card`, `text-h1`...). Never hard-code hex or Tailwind palette colours (`neutral-*`, `red-*`) in components. `tests/unit/contrast.test.ts` checks AA on token pairs.
- Text on orange is `text-accent-fg` (near-black), never white. Orange as text is `text-accent-text`.
- Theme: `ThemeToggle` sets `data-theme` on `<html>` and stores it in localStorage (`tt-theme`); an inline script in `app/layout.tsx` applies it before paint. No stored value follows the OS.
- Shell: `components/shell/AppShell.tsx` (server: nav, badges, Xero status) renders `ShellFrame` (client: desktop sidebar + top bar at >= 1024px, phone top bar + drawer + bottom tabs below). Nav is `NAV` in `lib/ui/nav.ts`; set `built: true` when a page exists so no dead links show.
- Base UI: `components/ui/` (`Button`/`buttonClass`, `Input`/`Select`/`Textarea`/`Label`/`FieldError`, `StatusChip`, `SegmentedControl`, `Tabs`, `Logo`, `Icon`). Status tones come from `lib/ui/status.ts`.
- Logo: `public/logo-on-dark.png` on charcoal (sidebar 40px, phone header 30px, public header 40px), `logo-on-light.png` on light surfaces and PDFs. Never recolour or stretch.
- e2e: the shell adds a search box labelled "Search by quote no, VIN or invoice no"; scope form label lookups to `page.getByRole('main')` on staff pages. Sign out is in the user menu.

## Repo notes (UI handoff, forms)
- Forms render through `lib/spec/presentation.ts` (pure): steps, section cards and display rows over the spec. It never renames or drops a field; `tests/unit/presentation.test.ts` fails if any spec cell is missing or shown twice. Per-form layouts live in `PRESENTATIONS`; forms without one get their spec pages with narrow rows packed side by side.
- Delivery Note is 5 steps; each step's `requireSigned` blocks Next, and `gate` keeps Customer signature 1 locked until the terms box is scrolled to the end. Server validation still applies on Submit (the form jumps to the first step with an error).
- Field controls: `components/form-engine/` (`FileField` drop zone, `SignaturePad` theme-aware ink with black-ink PNG export, `Checklist` Pass/Fail chips, `CountField` Store Room minimums parsed from labels). Keep input names (`f.<Field>`, `sig.<Field>`, `file.<Field>`, `cl.<n>.pass|fail|comments`) and test ids (`sig-*`, `file-*`, `terms-scroll`) stable.
- DEAL "Import from Xero" (staff only) reads the mirror via `importQuoteStaff` and fills fields with `dealFieldsFromQuote` (shared with the M3 Submit job). It never calls or writes Xero.
- Public forms verify Cloudflare Turnstile in `submitPublic` when `TURNSTILE_SECRET_KEY` is set (fails closed); production must set it and `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- `/e/<token>`: `inspectRoleLink` + pure `linkStatus` give expired/revoked/unknown pages; `resolveRoleLink` (all reads and saves) accepts only `ok`.
- The throwaway Postgres for tests must be UTF-8 (`pg_createcluster ... --encoding=UTF8 --locale=C.UTF-8`); SQL_ASCII breaks the M6 VIN tests.

## Repo notes (Cognito import in the app)
- `/admin/forms/import` (permission `import.run`, admin only): save/replace/remove the Cognito API key, Test connection, Dry run / Import per form or All forms, live progress, Stop/Resume. docs/M5.md section 3a.
- Key: `cognito_api_keys` (0020), service role only, AES-256-GCM with `ENCRYPTION_KEY` (AAD `cognito-api-key:<org>`), last 4 characters in clear. Decrypt only in `lib/import/cognito/job.ts` (job + Test connection); never return, log or audit it.
- Runs: `import_runs` (0020), org admins read, server writes; `report` is counts/reason codes only, `error` is a code (check constraint). One queued/running run per form (unique index).
- Job `cognito.import` `{ run_id }`: one leased, time-boxed slice (`importSlice`, at most 40 s and within the drain's deadline, passed to handlers as `ctx.deadline`), checkpoints report + cursor together, re-enqueues itself, then the next form of a batch; an apply queues `deal-files.rebuild`. `/api/jobs/cognito-import` drains only these (optional every-minute schedule in `supabase/scheduler.sql`).
- The importer is shared with the CLI: `runImport` (CLI) and `runImportSlice` (job) both use `importForm`. Sources resume through `listPositioned` (positions: by-number `next`/`misses`, list `skip`); a source without it is resumed by index.
- `COGNITO_API_URL` overrides the API base (e2e: `tests/e2e/mock-cognito.mjs`, port `E2E_COGNITO_PORT`, default 54598). The e2e spec numbers mock entries above existing ones and deletes what it imported in `afterAll`.
- The route `/admin/forms/import` shadows a form slug `import`: a form builder must not allow that slug.
## Repo notes (M6 stock overview and unit register)
- Stock pages live under `app/(admin)/admin/stock`; its `layout.tsx` renders the stock tabs (`lib/stock/tabs.ts` `STOCK_TABS`, filtered by `can()`, `built` flag like NAV) for every stock page. New stock pages render inside it, start with `components/stock/StockHeader.tsx`, and still call `requirePerm`. One `stock` item in NAV.
- Register logic is pure in `lib/stock/register.ts` (URL query, search -> PostgREST `or()`, CSV table, export audit row, Correct/Transfer inputs); reads go through `lib/stock/register-query.ts` (server-only, caller's RLS). Link to the register with `unitsHref({ model, location, status })`; `?q=<VIN>` finds a unit.
- Unit edits call `stock_correct_unit` / `stock_move_unit` with the caller's client after `requirePerm('stock.manage')` (the RPC re-checks the role and writes the audit row); show errors with `stockMessageFor`. Unit forms post the rendered `updated_at`; actions refuse stale forms (`isStale`) and pass it as `p_expected_updated_at` (0017: `UNIT_CHANGED` under the row lock). The CSV export counts first (refuses over 10,000), reads with an id keyset (`readExport`), and writes its `stock.export` audit row with the service role, refusing without it.
- Phone bottom bar: `phoneTabKeys` keeps at most 5 `tab` items by `TAB_PRIORITY`; add a new tab key there. Global search takes `searchAccessOf(member)`: stock-only members search the unit register.
- e2e: `tests/e2e/stock-overview.spec.ts`; the stub has a factory member `factory-stock@example.invalid` (role factory). `next=` on /login takes a plain /admin path only (no query); sign in, then `page.goto` the filtered URL.
## Repo notes (M6 deals and dispatch)
- DEAL -> stock deal: `lib/stock/deal-sync.ts` (pure scope/plan rules), `lib/stock/deal-sync-run.ts` (sync/backfill against a `DealSyncStore`, unit tested with an in-memory store), `lib/stock/deal-jobs.ts` (Supabase store + outbox handlers `stock.deal-sync`, `stock.deals-backfill`; `enqueueStockJobsForSave` is called from `runAction` afterSave and `systemUpdateEntry`). The sync never writes status/unit/dismissal columns.
- Stock deals exist only for DEALs dated on/after app_settings `stock.deals_from`; unset = none. "Rebuild deals" = `enqueueDealsBackfill`.
- Deals and Dispatch pages read through the caller's RLS (`lib/stock/lookup.ts`) and write only through the stock RPCs called as the signed-in user after `requirePerm` (the RPCs write the audit rows). Copy lives in `lib/stock/deals-view.ts` / `lib/stock/dispatch.ts`; error copy in `lib/stock/errors.ts`.
- Dispatch success redirects to `/admin/stock/units?q=VIN&saved=dispatch|move`; `savedNotice()` gives the confirmation text.
- Outbox handlers get an optional `{ deadline }` (from `drain()`); long jobs cap their budget to it. `tests/unit/fake-supabase.ts` is an in-memory supabase-js stand-in for unit-testing jobs and stores (logs every query's filters).
- The e2e stub answers 416 (PGRST103) for a counted range past the last row, as PostgREST does.
- e2e `tests/e2e/stock-dispatch.spec.ts` switches the admin's membership to `factory` for the phone test and restores it in `finally`.
## Repo notes (M6 stock pages C: invoices job, Invoice review, Activity, Pilot setup)
- Job `stock.invoices` (`lib/stock/invoice-job.ts`): queued with invoice and credit note ids from `upsertList` (merged only into the org's untried pending ids job; the handler re-reads its payload after the claim and throws if it cannot) and as a nightly sweep from `scheduledSync` full mode. One job runs at a time per org (later claims re-queue themselves); live re-reads each mirror row before calling the RPC. Only documents changed on/after `stock.invoices_from` (else `stock.deals_from`) are checked; `stock.invoice_rules` off/preview(default)/live; live calls `stock_apply_invoice` (service role), preview only counts. Job and Invoice review share `evaluateInvoice` (`lib/stock/invoice-review.ts`), so the page shows previews live without storing them.
- Stock settings are read with `stockSettingsFrom`/`loadStockSettings` (`lib/stock/settings.ts` has no imports so client forms can use it) and written only by `/admin/stock/setup` actions (stock.manage, service role, audit `stock.settings`). Live needs the typed word `live`.
- Opening stock CSV: pure `lib/stock/opening.ts` (parse, validate, plan, report); reports echo VINs and model codes only, never other cell values. Apply re-checks on the server and only inserts new VINs (idempotent); it never updates registered units or touches deals.
- Activity wording lives in `lib/stock/activity.ts` (`activityLine`); add a case there when a new `stock.*` audit action appears. Member names for stock pages: `lib/stock/members.ts` (service role, org members only, after requirePerm).
- Stock client forms submit with `startTransition(() => dispatch(fd))` from `onSubmit` instead of `<form action>`, so React's automatic form reset does not wipe typed values on an error.
- `components/stock/StockHeader.tsx` is byte-identical to the stock-overview branch's copy.
- Xero credit notes are mirrored read-only into `xero_credit_notes` (0019; entity `credit_notes`, quick and full sync). `xero_invoices.credit_note_applied` (CreditNotes[].AppliedAmount) is what counts as credited, not AmountCredited. Exceptions dedupe per Xero state (`source_updated_utc`).

## Repo notes (M8)
- Field types and options: `lib/spec/types.ts` (zod, all optional). Show-when: `parseShowWhen` (lib/spec/expressions) + `lib/spec/visibility.ts`; the browser and `runAction` run the same `readFormData` -> `prepareSave` (readOnly/internalOnly locks keep the saved value even when hidden; hidden fields are not validated, posted values for them are ignored and an existing entry keeps what it stored) -> `validateEntry(..., { skip })`. `checkPost` is the client check.
- Kit forms must render, read, validate, export and print as before: `tests/unit/kit-forms-unchanged.test.ts` against `tests/fixtures/kit-forms/baseline.json` (only `aria-required` may differ). Regenerate only for an intended kit change.
- A heading is a `section` without `children` (the kit checklist keeps `children`); headings become section cards in `lib/spec/presentation.ts`. Builder forms use `settings.layout: 'exact'` (no row packing) and `cognitoFormId: 0`.
- Builder: pure rules in `lib/forms/builder/*` (names, layout, palette, workflow, spec guards); writes in `service.ts` (service role after `adminForm(slug, 'forms.manage')`). Publish = parseSpec + `specProblems` + `changeProblems` (fields with data from `form_data_keys`). `form_versions` is append-only.
- Reserved form slugs: `RESERVED_FORM_SLUGS` in `lib/spec/types.ts` (parseSpec refuses them). Add any new fixed `/admin/forms/<segment>` there.
- allowedWhen also accepts `status in ('A', 'B')`. Emails to entry addresses (`[Field]`) attach `publicDocument` (no internalOnly fields).
- Public pages (`/f`, `/e`) get `publicSpec`, public defaults/data and `pickPublic` files/signatures only; public lookups only through `publicLookupOf` (allow-list `PUBLIC_LOOKUPS` in `lib/forms/public-policy.ts`); public upload tickets only for visible, unlocked file fields (`publicUploadAllowed`).
- 0022: clients cannot write `public.forms` (server only, service role after `requirePerm`); triggers keep `deal`/`delivery-note` encrypted, forbid encryption changes once entries exist, keep archived forms inactive, and make every entry match its form's encryption. `sync_form_workflow` (atomic) and `form_usage` (statuses/roles in use) back the publish guards.
