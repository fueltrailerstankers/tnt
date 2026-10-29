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
| 0013 | M1 fix | DEAL DATE CREATED defaults to today (spec update; 0010-0012 are taken by M6 and the lead-events fix) |
