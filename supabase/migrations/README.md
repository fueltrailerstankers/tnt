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
| 0016 | M6 deals | `stock_remove_untouched_deal` (service role): the DEAL sync removes an out-of-scope deal only when it never had a unit, dismissal or stock audit row, checked in the delete itself (dismissal history cascades on delete) |

The live project got 0012 and 0013 before 0010/0011: apply 0010 and 0011 next (with the Supabase CLI: `supabase db push --include-all`). 0012 depends on 0008 only.

0012 never deletes rows. If a lead already has a repeated `created`/`duplicate`/`routed`/`emailed` event (two
intake jobs raced before this fix), the migration stops with a message and a query that lists them. Review those
rows, delete the later copy of each pair by hand (keep the earliest), and apply 0012 again.
