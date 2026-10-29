# DEAL

- Route (public): `/f/deal`  ·  Admin: `/admin/forms/deal`
- Cognito form id: 9  ·  internal name `DEAL`
- Entries at export: 550
- Entry summary / title template: `[QUOTENO]`
- Entries encrypted at rest (Cognito 'Encrypt entries' ON) → encrypt `data` column / use pgsodium or app-level encryption
- Prevent lookup ON: this form cannot be used as a lookup source

## Fields (in display order; 24-column grid)

| Row | Col | Span | Field key (Cognito) | DB key | Label | Type | Rules / notes |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 10 | `MONTH` | `month` | MONTH | choice dropdown | Default: `JAN`; Options: JAN, FEB, MARCH, APR, MAY, JUNE, JULY, AUG, SEP, OCT, NOV, DEC |
| 2 | 1 | 10 | `DATECREATED` | `datecreated` | DATE CREATED  | date |  |
| 3 | 1 | 12 | `COLLECTIONLOCATION` | `collectionlocation` | COLLECTION LOCATION  | choice checkboxes multiple | Options: JHB, DUR, CPT |
| 4 | 1 | 10 | `QUOTENO` | `quoteno` | QUOTE NO | text |  |
| 5 | 1 | 10 | `SALESREP` | `salesrep` | SALES REP | choice dropdown | Default: `MELINDA`; Options: MELINDA, THANDIWE, KULANI, RICUS, ZAANIE, GERALD |
| 6 | 1 | 12 | `POP` | `pop` | POP | file multiple |  |
| 7 | 1 | 10 | `PARTNO1` | `partno1` | PART NO 1 | text |  |
| 8 | 1 | 10 | `LINE1` | `line1` | LINE 1  | text |  |
| 9 | 1 | 10 | `PARTNO2` | `partno2` | PART NO 2 | text |  |
| 10 | 1 | 10 | `LINE2` | `line2` | LINE 2 | text |  |
| 11 | 1 | 10 | `PARTNO3` | `partno3` | PART NO 3 | text |  |
| 12 | 1 | 10 | `LINE3` | `line3` | LINE 3 | text |  |
| 13 | 1 | 10 | `PARTNO4` | `partno4` | PART NO 4 | text |  |
| 14 | 1 | 10 | `LINE4` | `line4` | LINE 4 | text |  |
| 15 | 1 | 10 | `PARTNO5` | `partno5` | PART NO 5 | text |  |
| 16 | 1 | 10 | `LINE5` | `line5` | LINE 5 | text |  |
| 17 | 1 | 10 | `PARTNO6` | `partno6` | PART NO 6 | text |  |
| 18 | 1 | 10 | `LINE6` | `line6` | LINE 6  | text |  |
| 19 | 1 | 10 | `PARTNO7` | `partno7` | PART NO 7 | text |  |
| 20 | 1 | 10 | `LINE7` | `line7` | LINE 7 | text |  |
| 21 | 1 | 10 | `PARTNO8` | `partno8` | PART NO 8 | text |  |
| 22 | 1 | 10 | `LINE8` | `line8` | LINE 8 | text |  |
| 23 | 1 | 12 | `Total` | `total` | Total | number integer, 0 dp | Manual entry - NOT a calculated field in Cognito |
| 24 | | 24 | — | — | **— page break ** | pagebreak | Next button: "Submit" |

## Workflow

**Roles:** Public (public), Internal (internal)

**Statuses:** Incomplete [gray], Submitted [teal]

| Action | Button | Allowed when | → New status | Emails |
|---|---|---|---|---|
| Submit | Submit | `status == 'Incomplete'` | Submitted | — |
| Update | Update | `status != 'Incomplete'` | (unchanged) | — |
| Action | Action | `always` | (unchanged) | — — _Generic extra action, no status change, no email. Actions 4-6 were deleted in Cognito and are omitted._ |

Confirmation message (all actions): "Thank you for filling out the form. Your response has been recorded."

## Documents (PDF)

- #1 view → pdf — name `DEAL - [Entry.Number]`
- #2 edit → pdf — name `DEAL - [Entry.Number]`
- #3 custom → pdf — name `DEAL - [Entry.Number]` — DEAL - [Entry.Number](1).docx (16,645 bytes, Word merge template) — Custom Word template - download it from Cognito (DEAL > Publish/Documents) and place in /content/templates/deal.docx; rebuild as an HTML->PDF template
