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
| 0012 | M4 fix | one-time lead intake events: unique (lead_id, kind) for created, duplicate, routed, emailed |
| 0013 | M1 fix | DEAL DATE CREATED defaults to today (spec update) |
| 0015 | UI handoff | saved views (own rows), append-only terms versions, signature metadata on entry_files |

0010 and 0011 are reserved by another branch. If 0012 reaches a project first, the Supabase CLI applies the
lower-numbered files later only with `supabase db push --include-all`. 0012 depends on 0008 only.

0012 never deletes rows. If a lead already has a repeated `created`/`duplicate`/`routed`/`emailed` event (two
intake jobs raced before this fix), the migration stops with a message and a query that lists them. Review those
rows, delete the later copy of each pair by hand (keep the earliest), and apply 0012 again.

0015 (UI handoff) depends on 0001, 0004 and 0005 only. Numbers on other lines: the main line has M6's 0010
(`factory` role) and 0011 (stock), 0014 is reserved for M7 (`0014_access.sql`, docs/M7.md) and 0018 for M8
(docs/M8.md); none is 0015, and 0015 touches none of their objects (0011's restrictive `entry_files_not_factory`
policy also covers the new `entry_files` columns). Apply 0015 with `--include-all` if it lands before 0014.
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
