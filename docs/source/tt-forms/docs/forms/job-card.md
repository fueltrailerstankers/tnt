# JOB CARD

- Route (public): `/f/job-card`  ·  Admin: `/admin/forms/job-card`
- Cognito form id: 6  ·  internal name `JOBCARD`
- Entries at export: None
- Entry summary / title template: `[QuoteNo]`

## Fields (in display order; 24-column grid)

| Row | Col | Span | Field key (Cognito) | DB key | Label | Type | Rules / notes |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 12 | `Date` | `date` | Untitled | date | Label is literally 'Untitled' in Cognito - consider renaming to 'Date' |
| 1 | 13 | 12 | `QuoteNo` | `quote_no` | Quote no | text |  |
| 2 | 1 | 24 | `Line1` | `line1` | Line 1 | text |  |
| 3 | 1 | 12 | `Text` | `text` | Text | text |  |
| 3 | 13 | 12 | `Text4` | `text4` | Text4 | text |  |
| 4 | 1 | 12 | `Text2` | `text2` | Text2 | text |  |
| 4 | 13 | 12 | `Text5` | `text5` | Text5 | text |  |
| 5 | 1 | 12 | `Text3` | `text3` | Text3 | text |  |
| 5 | 13 | 12 | `Text6` | `text6` | Text6 | text |  |
| 6 | | 24 | — | — | **— page break ** | pagebreak | Next button: "Submit" |

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
