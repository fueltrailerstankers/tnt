# Migrations

Apply in order. Never edit a migration once it is applied to a real project; add a new one.

| File | Phase | Owner |
|---|---|---|
| 0001..0003 | kit | unchanged from docs/source/tt-forms |
| 0004 | M0 | orgs, memberships, org-keyed RLS, plumbing |
| 0005 | M1 | forms engine |
| 0006 | M2 | Xero read-only mirror, deal files |
| 0007 | M3 | Xero action runs (dry-run first), release recipients |
| 0008 | M4 | leads, lead sources, routing rules, contact match keys |
| 0009 | M3 | Xero action modes writable by the server only (the M5 import needed no migration) |
| 0010 | M6 | `factory` membership role (alone: a new enum value cannot be used in the transaction that adds it) |
| 0011 | M6 | stock control: locations, 52 models (seeded for the default org), stock deals, append-only dismissal history, units (VIN unique per org on `stock_norm_vin`, sold included), invoice exceptions, `stock_matrix` view; read-only for stock.read roles (invoice exceptions: stock.invoices roles, not factory); writes via the `stock_*` RPCs (audited); `app_settings` `stock.*` keys server-only (as 0009); factory role kept out of entries and the Xero mirror |
| 0012 | M4 fix | one-time lead intake events: unique (lead_id, kind) for created, duplicate, routed, emailed |
| 0013 | M1 fix | DEAL DATE CREATED defaults to today (spec update) |
| 0015 | UI handoff | saved views (own rows), append-only terms versions, signature metadata on entry_files |
| 0016 | M6 deals | `stock_remove_untouched_deal` (service role): the DEAL sync removes an out-of-scope deal only when it never had a unit, dismissal or stock audit row, checked in the delete itself (dismissal history cascades on delete) |
| 0017 | M6 overview | optimistic locking: optional `p_expected_updated_at` on `stock_correct_unit` / `stock_move_unit` (raises `UNIT_CHANGED` under the row lock); the 0011 bodies are kept as internal `*_unchecked`, so calls without it behave as before; grants as 0011 |
| 0019 | M6 invoices | `xero_credit_notes` read-only mirror, `xero_invoices.credit_note_applied`, `stock_invoice_exceptions.source_updated_utc`, `stock_apply_invoice` with optional `p_source_updated` |
| 0020 | M5 | in-app Cognito import: `cognito_api_keys` (one per org, AES-256-GCM with ENCRYPTION_KEY, last 4 characters in clear; service role only) and `import_runs` (per form, dry_run/apply, cursor + counts-only report; org admins read, server writes; one queued/running run per form) |
| 0021 | M7 | users and access levels: `memberships` gets `display_name`, `access` (area -> none/read/write, normalised by trigger), `preset`, `status` (invited/active/disabled), invite/accept/disable timestamps, `last_seen_at`; backfill = active with the role's preset; `must_change_password` (Add user); `has_access()`; per-area RLS select policies (forms, deals, quotes, invoices, leads, stock, integrations, settings, users, activity); inactive members get nothing; last-active-admin trigger; stock RPC gate follows Stock write |

The live project got 0012 and 0013 before 0010/0011: apply 0010 and 0011 next (with the Supabase CLI: `supabase db push --include-all`). 0012 depends on 0008 only.

0012 never deletes rows. If a lead already has a repeated `created`/`duplicate`/`routed`/`emailed` event (two
intake jobs raced before this fix), the migration stops with a message and a query that lists them. Review those
rows, delete the later copy of each pair by hand (keep the earliest), and apply 0012 again.

0015 (UI handoff) depends on 0001, 0004 and 0005 only. Numbers on other lines: the main line has M6's 0010
(`factory` role) and 0011 (stock), M7's users and access is `0021_access.sql` (docs/M7.md; first planned as 0014) and 0018 for M8
(docs/M8.md); none is 0015, and 0015 touches none of their objects (0011's restrictive `entry_files_not_factory`
policy also covers the new `entry_files` columns). 
It is additive:
- `saved_views`: a user's own named list filters (`scope` = `form:<slug>` | `xero_quotes` | `xero_invoices` |
  `leads`; `query` = list URL params only, never entry values). RLS: own rows within the caller's orgs; clients may
  insert `org_id`, `user_id`, `scope`, `name` and `query` (never `id` or `created_at`) and update `name` and `query`
  only. A trigger caps each user at 50 views per list and 500 per org, so the caps hold through the API too.
  Use `lib/views/saved-views.ts` (Zod-validated, per-list permission, RLS client).
- `terms_versions`: the exact text blocks shown to a signer, one row per (org, key, sha256). Members read; only the
  service role inserts (`ensureTermsVersion` in `lib/terms/versions.ts`, after the form or link checks). On insert a
  trigger requires blocks of exactly `{id, text}` and recomputes the sha256 (`terms_body_sha256`, the same canonical
  JSON as the app), so a row's body is always the hashed text. No API role may update or delete, and a trigger
  blocks update, delete and truncate even for the table owner.
- `entry_files`: nullable `signed_at`, `signer_role`, `sign_method` (`draw` | `type`) and `terms_version_id`, allowed
  on signature rows only; the terms version must belong to the entry's org; `signed_at` is server-set and never later
  than the row's `created_at` (+5 minutes). Clients still cannot write `entry_files` (0005). Existing rows are
  unchanged.

**Reserved numbers (work in progress on other branches; pick the next free number above these):**
0018 form builder (M8). 0021 is M7 users and access (written against the schema as of 0020; it keeps the
0016/0017/0019 stock RPCs). Next free number: 0022.
`0019_stock_invoice_guard.sql` (M6 stock invoices review, branch `m6-invoices`): `xero_credit_notes` (read-only
mirror of Xero /CreditNotes; RLS like the other `xero_*` mirror tables, factory excluded), `xero_invoices.
credit_note_applied` (sum of CreditNotes[].AppliedAmount, backfilled from `raw`), `stock_invoice_exceptions.
source_updated_utc`, and `stock_apply_invoice` re-created with a 7th argument `p_source_updated timestamptz default
null` (old 6-argument calls keep working): a resolved exception blocks only the same or an older Xero state.

0018 (M8 form builder) depends on 0001, 0004 and 0005 only and is additive: `forms.draft_spec`, `version`,
`archived_at`, `published_at`, `published_by`; append-only `form_versions` (members read, server-only writes,
version 1 backfilled for every existing form); `form_data_keys(uuid)`; `form_overview()` leaves archived forms out.

0022 (M8 security review) applies after 0018 and 0020 (the live DB gets 0018 then 0022 after 0011-0020;
`tests/db/forms-server-writes.test.ts` applies them in that order): revokes insert/update/delete on `public.forms`
from `authenticated` (server-only writes); `forms_invariants` trigger (deal/delivery-note always encrypted, no
encryption change once entries exist, archived forms stay inactive); `entries_match_encryption` trigger (reads the
form FOR SHARE: an entry's encryption must match its form); `sync_form_workflow(uuid, jsonb, jsonb)` (service role;
replaces statuses and roles atomically); `form_usage(uuid)` (statuses in use, roles with live links).
