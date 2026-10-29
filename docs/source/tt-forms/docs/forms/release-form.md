# RELEASE FORM

- Route (public): `/f/release-form`  ·  Admin: `/admin/forms/release-form`
- Cognito form id: 8  ·  internal name `RELEASEFORM`
- Entries at export: 1525
- Entry summary / title template: `[VINNO]`

## Fields (in display order; 24-column grid)

| Row | Col | Span | Field key (Cognito) | DB key | Label | Type | Rules / notes |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 12 | `VINNO` | `vinno` | VIN NO  | text |  |
| 1 | 13 | 12 | `Email` | `email` | Email | email | Label hidden |
| 2 | 1 | 12 | `INVNO` | `invno` | INV NO | text |  |
| 3 | 1 | 12 | `COSTOMERDETAILS` | `costomerdetails` | COSTOMER DETAILS  | text |  |
| 4 | | 24 | — | — | **— page break ** | pagebreak | Next button: "Submit" |

## Workflow

**Roles:** Public (public), Internal (internal)

**Statuses:** Incomplete [gray], Submitted [teal]

| Action | Button | Allowed when | → New status | Emails |
|---|---|---|---|---|
| Submit | Submit | `status == 'Incomplete'` | Submitted | to sales@fueltrailers.co.za; body = link to entry [includeReceipt] |
| Update | Update | `status != 'Incomplete'` | (unchanged) | — |

Confirmation message (all actions): "Thank you for filling out the form. Your response has been recorded."

## Documents (PDF)

- #1 view → pdf
- #2 edit → pdf
