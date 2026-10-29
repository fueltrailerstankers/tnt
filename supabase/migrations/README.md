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

0010 and 0011 are reserved by another branch. If 0012 reaches a project first, the Supabase CLI applies the
lower-numbered files later only with `supabase db push --include-all`. 0012 depends on 0008 only.

0012 never deletes rows. If a lead already has a repeated `created`/`duplicate`/`routed`/`emailed` event (two
intake jobs raced before this fix), the migration stops with a message and a query that lists them. Review those
rows, delete the later copy of each pair by hand (keep the earliest), and apply 0012 again.
