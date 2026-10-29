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
