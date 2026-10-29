# Trailers & Tankers Central Platform: Full Build Plan (MVP first)

Self-contained. A fresh Claude Code session should be able to build from this file plus the three source documents listed in section 1. Written 29 Oct 2026.
Companion analysis of the current Make setup: `docs/PLATFORM_PLAN.md`.

---

## 1. Inputs the build session must have

Put these in the repo before phase M0 (suggested path `docs/source/`):
1. `tt-forms-rebuild-kit.zip`, unzipped to `docs/source/tt-forms/` (7 form specs in `spec/forms/*.json`, `supabase/migrations/0001..0003`, `content/*.md` T&Cs and waiver, `scripts/generate.py`, kit `BUILD_PLAN.md`).
2. `BUILD_PLAN_1.md` (Cognito forms rebuild plan, same content as the kit's BUILD_PLAN).
3. `BUILD_PLAN_trailer_stock.md` (stock control plan; POST-MVP, read for the 52-model seed and data model only).
4. Make.com MCP access (zone eu2, org 2713978, team 1167159) so the build session can re-read blueprints. Read-only use. Never activate, edit or delete a scenario.

Treat the kit's `spec/forms/*.json` as the single source of truth for fields. Never rename a field `name` (it equals the Cognito FieldName and is the key in `entries.data`).

## 2. Decisions already made

- Xero stays the invoicing book of record. The platform mirrors it and performs only what Make does today. Quotes are created in Xero (verified: no Make scenario creates quotes; Make only GETs them and POSTs status changes SENT, ACCEPTED, INVOICED).
- New repo `trailer`. Not part of Pulse. Borrow Pulse conventions only (RLS everywhere, audit, idempotent jobs, raw-first webhooks).
- Cognito API access is available (history import via API).
- Currency default USD (as in Cognito). Every money value stores its own currency code because Xero data is ZAR. Timezone default Africa/Johannesburg, configurable in org settings.
- Lead connectors (Google Ads, Facebook, Gravity Forms) deferred. MVP lead inbox has manual and test sources only.
- Reviewers and approvers: one admin user for now. Model roles and permissions from day one; everyone is admin until access setup later.
- Stock rules deferred. Stock control is post-MVP.
- Stack: Next.js 15 App Router, TypeScript strict, Tailwind, shadcn/ui, Supabase (Postgres, Auth, Storage, RLS), Vercel, Resend, Zod, react-hook-form, TanStack Table, `@react-pdf/renderer`, `pdf-lib`, Vitest, Playwright, Sentry.

## 3. Business flow the platform must reproduce

```
Quote raised in Xero (QU-xxxxx)                                   [stays in Xero]
DEAL form (sales rep, quote no, POP upload, parts)
   -> import quote lines + total from Xero into the deal
   -> generate deal PDF + collection PDF
   -> email factory + branches "New Deal n"
REQUEST FOR INVOICE (customer details, up to 4 payment proofs)
   -> find quote by QuoteNo; find or create Xero contact; quote SENT > ACCEPTED > INVOICED;
      create invoice from quote; attach RFI PDF + proofs to the invoice; remember (RFI no, quote no, invoice id)
   -> email sales@ (submit) and accounts@ (update, with attachments)
JOB CARD                 -> email sales@
TRAILER INSPECTION       -> Inspector submits; Reviewer: request changes / mark reviewed; Approver: approve; email each step
RELEASE FORM             -> created automatically when a Xero invoice is fully paid (AmountDue = 0)
                            fields: VIN (from invoice Reference), invoice no, customer; email branches with invoice PDF + release PDF
DELIVERY NOTE + T&Cs     -> lookup RFI by quote no; customer signs (4 signatures + rep); ID, NATIS, payment, release uploads, 4 photos
                            -> find invoice INV-{INVOICENO}; write VIN to invoice; attach delivery PDF, signed ID, payments, NATIS, photos
STORE ROOM               -> stock count; Submit sets status APPROVAL and emails factory@ with PDF; APPROVED EMAILED set by staff
LEADS (post-MVP connectors) -> one lead model, routing to branch inboxes
```
Keys staff use: Quote no, VIN, Invoice no. The platform links them in a `deal_file` so they are chosen once.

## 4. Make behaviour to replicate (rules, with sources)

Read the blueprints again before building each action. Scenario ids in brackets.

### 4.1 Deal [Deal Update 8701643, webhook form 9]
- Trigger: new DEAL entry. Xero `GET /2.0/Quotes?QuoteNumber={QUOTENO}`. Accept only the quote whose `QuoteNumber` equals `QU-{QUOTENO}`.
- For line items 1 to 8 write `LINEn` = Description and `PARTNOn` = ItemCode. Write `Total` from the quote total (line 1 route). Total is otherwise manual.
- Build two PDFs from templates: the deal sheet (Deal no, Month, Quote no, Sales rep, Collection, Part no and Line 1 to 8, Date created) and the collection sheet (TO = first collection location, Date, lines 1 to 4).
- Email "New Deal {Entry.Number}" to factory@, sales5@, capetown@, capetown2@, durban@, sales4@ (all @fueltrailers.co.za) with both PDFs. Recipients become a settings table, not code.

### 4.2 Request For Invoice [Form 1 3191686, Form 1 Update 3220601, webhook form 4]
- Only when `QuoteNo` exists.
- With a first-deposit file: `GET` quote by QuoteNumber. Search Xero contact by quote contact email. If not found search by name `Name.FirstAndLast`; create the contact if still missing and a name exists; otherwise update the contact. Then POST the quote three times: SENT, ACCEPTED, INVOICED, with the contact id and the form's name.
- Create the invoice from the quote (skip if any line `UnitAmount` is negative). Before creating, `SearchInvoice` by `Reference == QuoteNo`: if one already exists, do not create another; attach files to it.
- Attach to the invoice: RFI PDF (Document1), `_1stDeposit`, `_2ndDeposit`, `_3rdDeposit`, `_4thPayment` files.
- Store mapping (RFI entry number, quote no, invoice id) for later lookup (Make data store 45592 "Entry Details Form 1", 1,124 rows).
- Without a first-deposit file (no payment loaded): the form must block ("NO PAYMENT LOADED FORM NOT SUBMITTED"), but Make's second route still finds the quote and upserts the contact. Replicate the block in the form; keep the contact upsert as an optional step.
- Idempotency key: (quote no, action). A retry must never double-invoice.

### 4.3 Delivery Note [Form 2 3201078, Form 2 Update 3220429, webhook form 5]
- Search invoice `InvoiceNumber == INV-{INVOICENO}`. Stop (retry later) if not found.
- Update the invoice with the VIN (the `VIN` route writes the VIN to the invoice Reference). Skip when status is DELETED or VOIDED.
- Attach: delivery note PDF (use the freshly re-read entry for live file links), signed ID, payment 1, payment 2, NATIS, then the first file of each of the four photo fields.
- Also re-attach the RFI PDF via the stored (RFI entry, invoice id) mapping.

### 4.4 Release [Release Form 6734365]
- Source: Xero invoices, polled every 15 min between 07:00 and 22:00. Platform replaces this with an invoice webhook plus a reconcile poll.
- Condition: `AmountDue == 0`.
- Mapping store (Make data store 103348, 1,532 rows): invoice id to release entry. If none exists create a RELEASE FORM entry (Email = contact email, INVNO = invoice number, VINNO = invoice Reference, COSTOMERDETAILS = contact name, public Submit) and record the mapping. If one exists update it.
- Download the invoice PDF. Email sales@, durban@, capetown@ "Release Form - {InvoiceNumber}" with body Contact Name, Invoice Number, Fully Paid On, attaching the invoice PDF and, when present, the release form PDF. Sent from the dedicated release address.

### 4.5 Merge attachments (on demand) [9584004]
- For invoices with more than one attachment: download, merge into one PDF named `{InvoiceNumber}-merged.pdf` (slashes replaced), upload to Xero, and only after upload succeeds delete the originals (every original must have been merged). Skip if already merged. Replace PDF.co with `pdf-lib`; keep the "upload first, delete never before upload" rule and keep originals in our own storage too.

### 4.6 Inspection helper [9578840, currently OFF]
- Creates inspection entries from a Google Sheet by VIN and attaches the PDF to the matching invoice (search by invoice Reference = VIN). Document only; not in MVP.

### 4.7 Leads (post-MVP connectors) [Google 6284112 and 7606407, Facebook 8017791 and 8082367, Gravity 9892152, plus 9892116, 9966818, 9966829]
- Google: skip `is_test`; fields Full Name, User Email, User Phone, product questions. Facebook: GetLeadDetails; fields full_name, email, phone_number, product. Gravity "Product Inquiry" form id 2: store name, email, normalised email (lower, trim), phone, normalised phone (last 9 digits), GCLID.
- Matching: lead email to Xero contact email; record quote number, quote value, invoice number, running invoice total, status. Only invoices from 1 Oct 2026 and value greater than 0. Quote statuses SENT, ACCEPTED, DECLINED, INVOICED count as "gone out".
- MVP builds the lead table, matching rules and routing with manual/test sources.

## 5. Architecture

### 5.1 Repo layout
```
app/
  (public)/f/[slug]/            public form + thanks
  (public)/e/[token]/           role link (inspector edit, reviewer)
  (admin)/login/
  (admin)/admin/                home, tasks, forms, entries, deals, invoices, leads, documents, settings, integrations
  api/webhooks/xero/            signed webhook receiver
  api/webhooks/leads/           lead intake (shared-secret, rate limited)
  api/jobs/[queue]/             cron-driven job runner (Vercel Cron + pg_cron)
components/form-engine/         FormRenderer, grid, field types, signature pad
lib/spec/                       FormSpec types, zod builder, expressions
lib/workflow/                   runAction, emails, role links
lib/integrations/xero/          client (OAuth2, retry, rate limit), mappers, actions, reconcile
lib/integrations/resend/
lib/pdf/                        EntryPdf, DealPdf, DeliveryNotePdf, merge
lib/rules/                      pure functions with unit tests (quote matching, status moves, release condition, idempotency keys)
lib/security/                   can(), requirePerm, redact, rate-limit, crypto (AES-256-GCM)
supabase/migrations/            kit 0001..0003 then 0004+
scripts/                        generate.py, import-cognito.ts, replay-make.ts, seed
tests/                          unit, db (RLS), e2e
docs/
.claude/agents/  CLAUDE.md
```

### 5.2 Data model
Kit tables as given: `profiles`, `forms`, `form_statuses`, `form_roles`, `form_counters`, `entries`, `entry_reads`, `entry_files`, `entry_events`, plus `email_log` and `entry_links` from the kit plan. Add:

- Org and access: `orgs` (name, currency default 'USD', timezone), `memberships` (user, role, branch scope), `permissions` map in code; RLS keyed on org. Single admin now.
- `notification_recipients` (event key, address, branch) replacing hardcoded inboxes.
- Xero: `xero_connections` (tenant id, encrypted tokens, scopes, expiry), `xero_contacts`, `xero_quotes` (number, status, totals, currency, contact, updated_utc, raw json), `xero_quote_lines`, `xero_invoices` (number, reference, status, totals, amount_due, paid_at, currency, contact), `xero_attachments`, `xero_sync_state` (cursor per entity).
- Link: `deal_files` (org, customer name, quote_no, invoice_id, vin, deal/rfi/inspection/release/delivery entry ids, branch, rep, created_at). Unique on (org, quote_no).
- Mapping and idempotency: `external_refs` (org, source, entity, external_id, internal_id) and `action_claims` (org, action key, claimed_at, result) so every Xero write is claimed once.
- Plumbing: `integration_events` (source, signature_ok, raw payload, status, attempts, error redacted), `outbox_jobs`, `job_runs`, `audit_log`, `app_settings`.
- Leads (M4): `leads`, `lead_events`, `lead_sources`, `routing_rules`.
- Storage: private buckets `entry-files` (form uploads, signatures, PDFs) and `documents` (generated packs). Path shape `<form>/<entry-id>/<field>/<uuid>-<file>`.

Rules: RLS on every table; service role only in server code after a permission check; raw tables (`integration_events`, `xero_connections`) have no client policies.

### 5.3 Security and compliance
- POPIA: ID numbers, signatures, NATIS, payment proofs are personal data. Private buckets, signed links valid 60 seconds, access logged by id only, retention setting, no real data in seeds, tests or screenshots.
- Encrypt DEAL and Delivery Note entry data with AES-256-GCM (`ENTRY_ENCRYPTION_KEY`), keeping only summary, number and status in clear. `protected` fields (Delivery Note email) masked for non-admin.
- Secrets and Xero tokens encrypted at rest. Never log tokens, full ID numbers, emails or file names.
- Webhooks: verify signature (Xero `x-xero-signature` HMAC-SHA256 of the raw body), store raw, enqueue, answer 200 fast. Process in jobs, idempotent by external id and replayable.
- Public forms: server actions, Turnstile plus honeypot, rate limit, 20 MB per file, content-type sniffing.
- Every mutation checks `can(member, 'perm.key')` server-side, including workflow `allowedWhen`.
- Rotate the credentials found in the TEST ONLY Make scenarios before anything else (bearer token and sync key were in plain text).

### 5.4 Jobs
Postgres outbox drained by Vercel Cron and pg_cron with pg_net. Each handler is short, batched, idempotent, and writes a `job_runs` row. Xero write jobs claim an `action_claims` key first. Long waits use a scheduled-jobs table with `SKIP LOCKED`, never timers.

### 5.5 Xero integration
- OAuth2 app (Authorization Code), offline access, refresh before expiry, encrypted store. Scopes: accounting contacts, transactions (quotes, invoices), attachments, settings read. Files scope only if needed for deleting merged originals.
- Respect limits (60 per minute, 5,000 per day): queue, backoff with jitter, reuse `If-Modified-Since`.
- Webhooks (invoice and contact events) plus a nightly reconcile and a 15-minute reconcile during 07:00 to 22:00 for invoice payment status. Webhooks carry ids only; fetch the record.
- Write actions are explicit functions with dry-run mode that logs the request it would send and diffs against what Make did: `setQuoteStatus`, `upsertContact`, `createInvoiceFromQuote`, `uploadInvoiceAttachment`, `setInvoiceReference`. Live mode off by default and switched on per action in settings, with typed confirmation.
- Sandbox: build and replay against a Xero demo company. Never replay writes against the live organisation until diffs match.

## 6. MVP phases (each is one Claude Code session; start each in plan mode)

### M0 Bootstrap
- Create Next.js 15 app, Tailwind, shadcn, ESLint, Vitest, Playwright, Sentry hook. CI on pull request: typecheck, lint, unit, db tests.
- Link Supabase (staging project) and Vercel. Apply kit migrations 0001 to 0003. Add 0004 for org, memberships, audit, notification recipients, integration plumbing.
- Auth: email login, no public sign-up, first admin created by script. `can()` and `requirePerm` helpers (admin only for now).
- Add CLAUDE.md and `.claude/agents` from Appendix A and B. `.env.example`. README.
- Done when: `/admin` loads behind login, `select count(*) from forms` is 7, CI green, RLS test proves a second org sees nothing.

### M1 Forms engine (replace Cognito)
- Spec types, zod builder (including custom errors from `validation`), 24-column grid renderer, steps from page breaks, content blocks from `content/*.md`, signatures, multi-file uploads to Storage, choice defaults, lookup, yes/no, name, address, table-as-panel.
- `runAction` workflow engine: `allowedWhen`, status moves, numbering, summary template, events, email templating with `[Entry.AdminLink]`-style tokens, role links `/e/[token]`, Resend, `email_log`.
- Admin: Home (recent, forms, unread), entries grid (views, column picker, search, status filter, export CSV and XLSX, bulk mark read), entry page (edit, actions by role and status, timeline, files, emails sent), Tasks page.
- PDFs: generic entry PDF for every form; Delivery Note PDF with full T&Cs, waiver and all five signatures; Deal PDF and collection sheet PDF; Store Room PDF attached to factory email.
- Encryption for DEAL and Delivery Note; masking of protected fields.
- Quirks to keep verbatim: typos in labels, Job Card "Untitled" date, DEAL manual Total, Inspection Pass and Fail independent checkboxes. Flag to owner: RequestReviewChanges leaves status Submitted.
- Done when: all seven forms render in the same order and widths as Cognito; RFI blocks without payment; Delivery Note VIN/email/invoice rules hold; Inspection runs Submitted to Reviewed to Approved with emails; Store Room Submit emails factory@ with PDF; Playwright covers each.

### M2 Xero read-only mirror and deal files
- OAuth connect page, encrypted tokens, health page (last sync, token expiry, rate-limit headroom, failures).
- Mirrors for contacts, quotes (+ lines), invoices, attachment metadata. Initial backfill in batches, then webhooks plus reconcile. Raw payloads kept.
- `deal_files` created and linked by quote no, VIN and invoice no. Quote picker (searchable) on forms replaces typed quote numbers; Delivery Note lookup shows RFI customer panel (name, ID, address).
- Admin pages: Quotes, Invoices, Deal file timeline (one page per trailer from deal to delivery).
- Done when: a sample month's quotes, invoices and payments match Xero totals; a replayed webhook is a no-op; token refresh survives a restart; no write calls exist anywhere in this phase (a test greps for them).

### M3 Xero actions (dry-run, then live)
- Implement section 4.1 to 4.5 behaviours as claimed, idempotent actions: Deal quote import (lines, total) and notification; RFI invoice creation and attachments; Delivery Note VIN and documents; Release creation and email on payment; merge attachments.
- `scripts/replay-make.ts`: feeds recorded Make executions (inputs only, no secrets) to the platform dry-run and diffs requests and outputs against what Make did. The `parity-checker` agent owns this.
- Settings page per action: off, dry-run, live. Live requires typed confirmation and is audited.
- Done when: 20 replayed RFIs, 20 deliveries, 20 releases give identical Xero results in the demo company; a forced retry produces no duplicate; Make is still running untouched.

### M4 Leads inbox (manual and test sources)
- `leads`, `lead_events`, routing rules table, `/api/webhooks/leads` (secret, rate limit, idempotency by source id), normalisation (email lower/trim, phone last 9 digits), duplicate detection, inbox UI (status, assign, notes), notification to routed inboxes through the recipients table.
- Quote and invoice matching by normalised email and phone, using the rules in 4.7 (invoices from a configurable start date, value greater than 0).
- Done when: a posted test lead lands once, routes, emails once; a repeat post is a no-op; match to a Xero quote shows on the lead.

### M5 History import, parallel run, cutover
- `scripts/import-cognito.ts` via the Cognito API: map entries to `entries.data` by FieldName, keep Entry.Number and Status and timestamps, download files and signatures to Storage, map RFI ids for the Delivery Note lookup, reset `form_counters` to max per form. Idempotent through `external_refs`, dry-run report with counts only.
- Expected counts: DEAL 550, RFI 1,345, Release 1,525, Delivery Note 1,095, Inspection 690, Store Room 8 (re-check before import; Job Card count unknown).
- Parallel run: Make stays live and forwards source events to the platform in test mode; nightly parity report. Cut over in this order: forms intake, Deal, RFI, Delivery Note, Release. Retire each Make scenario only after two clean weeks (clone first, keep a ROLLBACK COPY, never edit active scenarios in place).
- Switch public links, QR codes and website buttons to `/f/<slug>` on the production domain. Verify Resend domain (SPF, DKIM).
- Done when: import counts match Cognito, spot checks of 30 entries per form match including files, two clean weeks, Make scenarios off.

## 7. Post-MVP (not in this build)
Stock control (units by VIN, dispatch, branch matrix, invoice to reserved/sold; 52-model seed from the stock plan), live Google Ads, Facebook and Gravity connectors, Google offline conversions using stored GCLID, reporting (lead to quote to invoice funnel, deals per rep, deposit-to-release time), user and branch permissions, inbound email-to-lead from the leads mailbox, native quote creation if ever wanted.

## 8. Testing and acceptance
- Unit tests for every pure rule in `lib/rules` and the zod builder from specs.
- DB tests: cross-org and cross-role access fails on every table; encrypted forms never expose plaintext through views.
- Contract tests: Xero payload fixtures (synthetic) through mappers; webhook signature good and bad.
- E2E (Playwright): one flow per form plus the Deal-to-Delivery chain against the demo Xero company or a mock.
- Every phase ends with: typecheck, lint, tests pass; acceptance list demonstrated in the browser; docs updated; no PHI in logs or fixtures.

## 9. Environment variables
```
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
APP_URL, JOB_SECRET, ENTRY_ENCRYPTION_KEY, ENCRYPTION_KEY
RESEND_API_KEY, MAIL_FROM
XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI, XERO_WEBHOOK_KEY, XERO_TENANT_ID
COGNITO_API_KEY            (import only; remove after cutover)
LEADS_WEBHOOK_SECRET
TURNSTILE_SECRET_KEY, NEXT_PUBLIC_TURNSTILE_SITE_KEY
SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN
```

## 10. Open items (do not block M0)
- Xero demo company for sandbox replays (needed before M3).
- Whether payment-voided or credited invoices should reverse a Release (decide with owner in M3).
- Job Card entry count and whether Job Card is still used.
- Branch and sales inboxes to load into `notification_recipients` (starting list: sales, sales2, sales4, sales5, durban, capetown, capetown2, factory, accounts at fueltrailers.co.za).
- Real reviewer and approver users and roles (later).

---

## Appendix A: CLAUDE.md for the new repo (draft)

```
# CLAUDE.md: Trailers & Tankers platform
Read BUILD_PLAN.md first, then do only the phase asked. Start each phase in plan mode.
Source of truth for forms: docs/source/tt-forms/spec/forms/*.json. Never rename field names. Legal text in content/*.md is verbatim, typos intentional.
Non-negotiables
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
```

## Appendix B: Agent briefs (`.claude/agents/*.md`)

| Agent | Tools | Brief |
|---|---|---|
| db-architect | Read, Grep, Glob, Edit, Bash | Owns migrations, RLS, RPCs, indexes, cross-org tests. Reviews every schema change. Refuses a table without RLS |
| forms-engine | Read, Grep, Glob, Edit, Write, Bash | Spec to zod, renderer, workflow engine. Keeps kit quirks. Never invents fields |
| integrations | Read, Grep, Glob, Edit, Write, Bash | Xero, Resend, lead intake: signatures, idempotency, retries, replay, rate limits. Owns lib/integrations |
| documents-pdf | Read, Grep, Glob, Edit, Write, Bash | PDF layouts, merge, storage paths, signed links, hashes of signed documents |
| parity-checker | Read, Grep, Glob, Bash | Replays recorded Make inputs against dry-run actions and diffs results. Read-only on Make |
| security-reviewer | Read, Grep, Glob, Bash | POPIA, secrets, webhook verification, upload limits, RLS gaps. Runs before every phase merge. Read only |
| ui-designer | Read, Grep, Glob, Edit, Write, Bash | Layout, tables, phone use for factory staff, dark mode, keyboard and contrast |
| qa-e2e | Read, Grep, Glob, Edit, Write, Bash | Playwright per phase acceptance list |
