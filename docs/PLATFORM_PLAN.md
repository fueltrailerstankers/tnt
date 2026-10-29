# Trailers & Tankers — Central Platform Plan

Status: PLAN ONLY. Nothing is built. Written 28 Oct 2026 after reading:
- the Make.com team (org 2713978, team 1167159, zone eu2): 23 scenarios, 14 webhooks, 2 data stores, 24 connections
- `BUILD_PLAN_1.md` (Cognito forms rebuild) and `tt-forms-rebuild-kit.zip` (specs, schema, T&Cs)
- `BUILD_PLAN_trailer_stock.md` (stock control review build)

## 1. What exists today

Five systems that do not share a database. Make glues them together.

| System | Role | Notes |
|---|---|---|
| Google Ads lead forms, Facebook Lead Ads, website Gravity Form "Product Inquiry" | Lead sources | Leads are emailed to sales inboxes; only the website form lands in a sheet |
| Xero | Quotes and invoices (book of record) | Quotes `QU-xxxxx`, invoices `INV-xxxxxx`, VIN carried in the invoice Reference |
| Cognito Forms (7 forms) | DEAL, Request for Invoice (RFI), Job Card, Inspection, Release, Delivery Note, Store Room | ~5,200 entries, signatures, photos, payment proofs |
| Make.com | Glue | See section 2 |
| Google Sheets / Gmail / Drive | Lead tracking, emails, deal PDFs | |
| Stock app (review build) | VIN-level stock | Not live; test scenarios post to it |

### Business flow as it actually runs

```
Lead (Google / Facebook / website)  -> email to sales + (website only) Leads sheet
  Sales raises QUOTE in Xero (QU-xxxxx)
  DEAL form (sales rep, quote no, POP, parts)   -> Make pulls Xero quote, fills lines + total, builds 2 sheets-to-PDF docs, emails factory + branches
  REQUEST FOR INVOICE (customer + deposit proofs) -> Make: quote SENT > ACCEPTED > INVOICED, creates Xero invoice, uploads proofs to the invoice
  JOB CARD / TRAILER INSPECTION (QC, 2 approvals)
  RELEASE FORM  <- auto-created by Make when a Xero invoice is fully paid (AmountDue = 0), PDF of invoice emailed to branches
  DELIVERY NOTE + T&Cs (customer signs) -> Make: finds invoice, writes VIN to invoice reference, uploads signed docs, NATIS, ID, photos to Xero
STORE ROOM (independent stock count -> factory approval)
```
Linking keys staff use: Quote no, VIN, Invoice no. Only Delivery Note to RFI is a real lookup in Cognito; the rest is typed text.

## 2. What each Make scenario does (and what replaces it)

Active (15):

| Scenario | Trigger | Does | Replaced by |
|---|---|---|---|
| Google Leads, leads 2 | Google Ads lead-form webhook (two assets) | Skips `is_test`, emails 4 to 6 sales/branch inboxes | Lead intake endpoint + lead routing rules |
| Facebook Lead Ads 1 and 2 | Poll hourly, two lead forms on the Johannesburg page | GetLeadDetails, emails 4 inboxes | Meta `leadgen` webhook (realtime) |
| Product Inquiry Form Leads | Poll Gravity Forms every 4h | Adds row to the Leads sheet: normalised email, phone (last 9 digits), GCLID | Gravity Forms webhook to lead intake; same normalisation |
| Xero invoice to Invoiced Leads sheet | Poll every 4h, invoices from 1 Oct 2026, value > 0 | Matches the Xero contact email to a lead, keeps a running invoiced total per lead | Lead-to-quote-to-invoice matching in Postgres |
| Xero quote sent to lead to Quote Matches sheet | Poll every 4h | Matches quote contact email to a lead, records quote number and value | Same |
| Quote status every 4h | Poll | Writes quote status into the Quote Matches notes | Xero webhook updates the quote mirror |
| Form 1 (RFI) and Form 1 Update | Cognito new / update entry | Find quote by QuoteNo, find or create Xero contact, set quote SENT > ACCEPTED > INVOICED, create invoice, upload form PDF + 4 payment proofs, store (RFI no, quote no, invoice id) in data store 45592 | Native RFI action `create_invoice_from_quote` (Xero API, idempotent) |
| Form 2 (Delivery Note) and Form 2 Update | Cognito new / update entry | Find `INV-{INVOICENO}`, update invoice (VIN), attach delivery note PDF, signed ID, payments, NATIS, photos; also re-attaches the RFI PDF | Native Delivery Note action + Xero attachment sync |
| Deal Update | Cognito DEAL submit | Reads Xero quote (`QU-{QUOTENO}`), writes lines, part numbers and total back into the DEAL, makes two Google Sheet PDFs (deal sheet, collection sheet), emails factory + 5 branch inboxes "New Deal n" | Native deal creation with quote import, PDF generation, notification |
| Release Form | Poll Xero every 15 min (07:00 to 22:00) | Fully paid invoice: create RELEASE FORM entry (VIN from invoice Reference, invoice no, contact), email branches with invoice PDF + release PDF; data store 103348 holds invoice id to entry id | Xero payment event creates Release task; same email |
| Xero merge attachments (on demand) | Manual | Merges multiple invoice attachments into one PDF via PDF.co, uploads, deletes originals | Platform document merge (pdf-lib), original kept in our storage |

Off or test only (8): ROLLBACK COPY of Deal Update, Integration Cognito Forms (backfilled Total on DEAL), Integration Xero (x2, empty watchers), Merge Xero Invoice Attachments (older copy), Trailer Inspection Checklist (creates inspection entries from a Google Sheet by VIN, attaches PDF to the Xero invoice), and two TEST ONLY scenarios that post deals and invoices to the stock app.

Things found that matter for the build:
1. The test scenarios contain a live-looking bearer token and a sync key in plain text. I have not copied them anywhere. Rotate them and treat that stock-app endpoint as burned.
2. The Facebook connection shows an expiry of 11 Dec 2025 yet the scenarios report no failures. Confirm lead flow is really arriving before we rely on it as the baseline.
3. Two Facebook forms and two Google lead assets feed identical emails. The platform needs one lead model with a `source_form` field, not four code paths.
4. Branch and sales inboxes are hardcoded in every scenario (sales, sales2, sales4, sales5, durban, capetown, capetown2, factory, leads). These become routing rules in a table.
5. Xero polling uses `If-Modified-Since` and a 15-minute watcher. Xero webhooks plus a reconciliation poll is more reliable and cheaper.
6. The RFI "invoice" step has branching for contact exists / does not exist / invoice already exists. The rewrite must be idempotent on (quote no, invoice reference) so a retry never double-invoices.
7. Gmail accounts used: fueltrailersleads@, fueltrailersreleaseform@, saveezwork@. The platform sends from one verified domain instead.

## 3. Target platform

One Next.js app and one Supabase project. Everything is a record in one place with a timeline.

### Modules

1. Leads inbox: Google, Facebook, website form, email-to-lead (the IMAP leads@ mailbox is already connected but unused), manual entry. Dedupe by normalised email and phone. Assign to branch/rep, status, notes, GCLID/fbclid kept for attribution.
2. Customers (contacts and companies), mirrored from and linked to Xero contacts.
3. Quotes, mirrored from Xero (number, status, lines, totals, contact). Status history kept.
4. Deals (native DEAL form): quote import from Xero, rep, month, collection branch, POP, 8 lines, PDF.
5. Invoicing view, mirrored from Xero: status, amount due, payments, attachments. Actions that Make performs today are kept as explicit, logged actions: raise invoice from quote, set VIN in reference, attach documents.
6. Forms: schema-driven engine from the kit (`spec/forms/*.json`), keeping Cognito field names so history imports 1:1. Roles, statuses, approvals, signatures, uploads, notification emails.
7. Documents: every PDF, photo, signature, proof and generated pack stored once, linked to the lead, deal, invoice and unit. Download pack per deal.
8. Stock: units by VIN, branch matrix, dispatch, reserved/sold from invoice payment (rules from the stock plan).
9. Tasks and approvals: Inspection review, Store Room approval, Release tasks.
10. Integrations and admin: connection health, raw event log with replay, routing rules, users and roles, audit log.
11. Reporting: leads by source and cost, lead to quote to invoice conversion, deals per rep per month, stock by branch, time from deposit to release.

### The unit timeline (the central idea)

A `deal_file` row ties a customer, quote no, invoice(s), VIN, RFI, inspection, release and delivery note together. Today staff retype keys across forms. The platform picks the quote once and carries it, so one page shows a trailer's whole life from first lead to signed delivery.

## 4. Stack decision

| Layer | Choice | Why |
|---|---|---|
| App | Next.js 15 App Router, TypeScript strict, server actions | Matches both kit plans and your Pulse repo, one language end to end |
| UI | Tailwind, shadcn/ui, TanStack Table, react-hook-form, Zod | Dense grids and forms |
| DB, auth, files | Supabase Postgres, Auth, Storage (private buckets, signed URLs), RLS | As requested |
| Jobs | Postgres outbox table drained by Vercel Cron and `pg_cron` + `pg_net`; pgmq if volume grows | No separate worker, same pattern as Pulse. Vercel functions are short, so every job is batched and idempotent |
| Xero | Direct OAuth2 app (offline refresh token), webhooks plus a daily reconcile poll | Replaces 12+ Make scenarios, no per-operation fees, retries under our control |
| Google Ads | Lead form webhook extension (key check), later offline conversion upload using stored GCLID | The sheet already has "Conversion Sent At", so this was the intent |
| Meta | Lead Ads `leadgen` webhook with X-Hub-Signature-256, Graph fetch of lead details | Realtime instead of hourly poll |
| Website | Gravity Forms webhook add-on to our endpoint with a shared secret | Replaces 4-hourly poll |
| Email | Resend, verified fueltrailers.co.za; inbound routing optional | One sender, delivery log |
| PDF | `@react-pdf/renderer` for generated docs, `pdf-lib` to merge | Replaces Sheets-to-PDF and PDF.co |
| Observability | Sentry, `job_runs`, `integration_events` | Make's execution history is the thing you lose, so replace it deliberately |
| Tests | Vitest for rules, Playwright for flows, DB tests for RLS | |
| Hosting | Vercel (Preview and Production), Supabase staging branch plus production project | |

Make is not removed on day one. See the migration strategy.

## 5. Data model (summary)

New migrations start where the kit leaves off. Core tables:

- Identity: `orgs`, `profiles`, `roles`, `memberships` (branch scope), `audit_log`.
- Forms (from kit `0001`): `forms`, `form_statuses`, `form_roles`, `form_counters`, `entries`, `entry_reads`, `entry_files`, `entry_events`, `email_log`, `entry_links`.
- CRM: `leads`, `lead_events`, `customers`, `lead_sources`, `routing_rules`.
- Xero mirrors: `xero_contacts`, `xero_quotes`, `xero_quote_lines`, `xero_invoices`, `xero_payments`, `xero_attachments`, `xero_tokens` (encrypted), `xero_sync_state`.
- Link: `deal_files` (customer, quote, invoice(s), vin, deal entry, rfi entry, release entry, delivery entry, branch, rep).
- Stock (from stock plan): `locations`, `models` (52 seeded), `units`, `deal_audit`, `activity`, `invoice_exceptions`; RPCs `dispatch_unit`, `apply_invoice`.
- Plumbing: `integration_events` (raw payload, signature result, status, replay), `outbox_jobs`, `job_runs`, `app_settings`.

Rules carried over from your other projects:
- RLS on every table, keyed on org and branch scope. Service role only after a permission check.
- Raw webhook payload is stored first, then processed. Processing is idempotent by external id and replayable.
- Forms keep Cognito `FieldName` as the key in `entries.data`.
- Encrypted forms (DEAL, Delivery Note) use AES-256-GCM at the application layer. Secrets and Xero tokens encrypted at rest.
- Personal data under POPIA: ID numbers, signatures, NATIS, payment proofs. Private buckets, short signed links, access logging, retention setting, no real data in seeds or tests.

## 6. Build phases (one Claude Code session each)

| Phase | Deliverable | Done when |
|---|---|---|
| 0 | Repo scaffold, Supabase and Vercel linked, CI, migrations from kit `0001` to `0003`, auth, roles, agents and CLAUDE.md | `/admin` behind login, 7 forms seeded |
| 1 | Form engine read-only render from specs | All 7 forms render like Cognito |
| 2 | Submit, validation, uploads, signatures, workflow engine, emails, tasks | Inspection 4-step flow works end to end |
| 3 | Admin: Home, grids, entry page, export, read tracking | Staff can find, open, edit, export |
| 4 | Lead model, intake endpoint, routing rules, leads inbox; manual and test sources only (Google, Facebook, Gravity connectors deferred) | A test lead posted to the endpoint lands once, is routed and emailed |
| 5 | Xero connection: OAuth, contact/quote/invoice mirrors, webhooks, reconcile, health page | Mirrors match Xero for a sample month |
| 6 | Deal and RFI native: quote import, create invoice from quote, attachments to Xero, `deal_files` | Replays of 20 real RFIs give identical Xero results in a sandbox org |
| 7 | Delivery note, release automation on payment, PDFs (deal, delivery, release, merged attachments) | Signed delivery PDF contains T&Cs, waiver and 5 signatures |
| 8 | Stock: units, dispatch, matrix, invoice to reserved/sold rules, exception queue | Stock plan acceptance tests pass |
| 9 | Lead attribution and reporting, Google offline conversions (behind a switch, off by default) | Funnel report reconciles with Xero |
| 10 | History import from Cognito, Leads and Quote Matches sheets, stock spreadsheet | Counts match Cognito: 550, 1,345, 1,525, 1,095, 690, 8 |
| 11 | Parallel run, cutover, retire Make scenarios one by one | Two clean weeks, then switch links and QR codes |

Phases 1 to 3 and phase 4 can run in parallel once phase 0 is done.

## 6a. MVP cut (decided 28 Oct 2026)

Quotes are created in Xero. Checked against every Make blueprint: no scenario creates a quote. Make only reads quotes (`GET /2.0/Quotes`) and moves their status (SENT, ACCEPTED, INVOICED) with `POST /2.0/Quotes`. The platform does the same and never creates quotes.

Stock rules are deferred. The MVP replaces Cognito and the Make glue; it does not include stock control, reporting or Google offline conversions.

| MVP phase | Deliverable | Done when |
|---|---|---|
| M0 | Scaffold, Supabase and Vercel, CI, kit migrations 0001 to 0003, single admin login, CLAUDE.md, agents | Admin logs in, 7 forms seeded |
| M1 | Form engine, validation, uploads, signatures, workflow actions and emails, Tasks, admin grids, entry page, export, PDFs (generic, Delivery Note with T&Cs and 5 signatures, Deal) | All 7 forms work end to end without Cognito; Inspection 4-step flow passes |
| M2 | Xero OAuth, read-only mirror of contacts, quotes, invoices, attachments, webhooks plus nightly reconcile, health page, `deal_files` linking by quote no, VIN, invoice no | Mirror matches Xero for a sample month; quote picker on forms; Delivery Note lookup works |
| M3 | Xero actions, dry-run first then live: Deal quote import (lines and total), RFI invoice creation, attachments to the invoice, Delivery Note VIN and documents; Release created and emailed when an invoice is fully paid | 20 replayed RFIs and deliveries give the same Xero result as Make in a sandbox |
| M4 | Basic leads inbox: model, intake endpoint, manual and test sources, routing rules, notifications | A test lead is routed and emailed once |
| M5 | Cognito history import via API, parallel run, Make scenarios retired one at a time | Counts match: 550, 1,345, 1,525, 1,095, 690, 8; two clean weeks |

M1 and M2 can run in parallel after M0. Everything in section 6 beyond M5 (stock, reporting, Google conversions, real lead connectors) is post-MVP.

## 7. Migration strategy

1. Shadow first. Keep Make live. Add a second HTTP module to each source scenario that forwards the payload to the platform in `test` mode. The platform stores and processes into a staging project only.
2. Compare. A nightly report compares what the platform would have done with what Make did (same invoice, same attachments, same emails).
3. Cut over per flow, in this order: leads, then DEAL, then RFI, then Delivery Note, then Release, then stock. Turn off the matching Make scenario only after two clean weeks. Never edit active Make scenarios in place; clone and keep the ROLLBACK COPY habit you already use.
4. Write-safety on Xero. Nothing writes to Xero until the dry-run diff matches. Writes use an idempotency key (quote no plus action) and are logged in `integration_events`.
5. Data import. Cognito entries and files via export or API (check the Cognito plan allows API access), Leads and Quote Matches sheets, stock spreadsheet. Idempotent through an external reference table with a dry-run report.

## 8. Agents to set up in the repo (`.claude/agents/`)

Reusing the shape of your Pulse agents. Each has a narrow brief and read/write limits.

| Agent | Job |
|---|---|
| `db-architect` | Migrations, RLS policies, RPCs, indexes, cross-org and cross-branch test suite. Reviews every schema change |
| `forms-engine` | Spec to zod, renderer, workflow engine, quirk list from the kit |
| `integrations` | Xero, Google Ads, Meta, Gravity, Resend: signature checks, idempotency, retries, replay. Owns `lib/integrations/*` |
| `documents-pdf` | PDF layouts, merge, storage paths, signed links |
| `security-reviewer` | POPIA, secrets, webhook verification, upload limits, RLS gaps. Runs before each phase merges |
| `parity-checker` | Replays Make scenario inputs against the platform and diffs outputs (the migration safety net) |
| `ui-designer` and `a11y-auditor` | Layout, dark mode, keyboard and contrast, phone use for factory staff |
| `qa-e2e` | Playwright flows per phase acceptance list |

CLAUDE.md for the repo would carry the non-negotiables from section 5 plus: Xero is the book of record, never delete financial rows, webhooks store raw first, and no secrets in code or logs.

## 9. Risks

- Xero rate limits (60 calls a minute, 5,000 a day) and token refresh. Mitigate with webhooks, batched reconcile, and queueing writes.
- Cognito history needs API or export access. Confirm the plan before phase 10.
- Behaviour hidden in Make filters (for example `SubTotal > 0`, quote prefix `QU-`, invoices from 1 Oct 2026 only). Capture each as a documented rule with a test. The scenario walk-through above is the starting list.
- Factory staff on phones: forms must work offline-tolerant on bad signal (draft save, retry uploads).
- Signed customer documents are legal records: store the exact PDF once, hash it, never regenerate it silently.

## 10. Decisions (28 Oct 2026)

Settled by the owner:
1. Xero stays the invoicing book of record. The platform mirrors it and performs only the actions Make does today.
2. New `trailer` repo, separate from Pulse.
3. Cognito API access is available, so phase 10 imports entries and files through the API (no Excel export needed).
4. Currency follows Cognito: USD as the platform default. Xero data is ZAR, so every money field stores its own currency code and the default is only a display and entry fallback. Timezone is not decided: default to Africa/Johannesburg, configurable in org settings.
5. Lead-form connections (Google, Facebook, Gravity) are skipped for now. Phase 4 builds the lead model, intake endpoint and routing with a manual/test source only; real sources are wired later.
6. Reviewers and approvers: a single admin user for now. Permissions are modelled from the start (roles, memberships, `allowedWhen` from the form specs) but everyone with access is admin until user access is set up later.

Still open (not blocking phase 0):
- Quotes created in the platform later, or always in Xero? (default: Xero)
- Stock rules from the stock plan: credit notes, partial payment threshold, branch transfers, branch-scoped views.
- Which Google Ads and Facebook forms and developer apps are live (needed when lead connections are configured).

1. Is Xero staying as the invoicing book of record? Recommended yes. The platform mirrors it and performs only the actions Make does today.
2. Create quotes in the platform (later) or keep creating them in Xero?
3. New repo `trailer` (recommended, separate from Pulse) and one Supabase project plus one staging branch?
4. Cognito: do you have API access or only Excel export?
5. Currency and timezone for the platform: ZAR and Africa/Johannesburg (Cognito is currently US, USD, UTC).
6. Which Google Ads and Facebook forms are live today (two of each are wired), and who owns each Google and Meta developer app?
7. Who are the reviewers and approvers for Inspection and Store Room, and which inboxes should become real user accounts?
8. Stock rules open questions from the stock plan (credit notes, partial payment threshold, branch transfers, branch-scoped views).
