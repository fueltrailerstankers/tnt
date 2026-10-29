# Request For Invoice

- Route (public): `/f/request-for-invoice`  ·  Admin: `/admin/forms/request-for-invoice`
- Cognito form id: 4  ·  internal name `RequestForInvoice`
- Entries at export: 1345
- Entry summary / title template: `[Name]`

## Fields (in display order; 24-column grid)

| Row | Col | Span | Field key (Cognito) | DB key | Label | Type | Rules / notes |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 12 | `QuoteNo` | `quote_no` | Quote no | text |  |
| 1 | 13 | 12 | `DATE` | `date` | DATE | date |  |
| 2 | 1 | 12 | `SalesRep` | `sales_rep` | Sales Rep | text |  |
| 2 | 13 | 12 | `CostomerVatNo` | `costomer_vat_no` | Costomer Vat no | text |  |
| 3 | 1 | 12 | `BusinessRegNo` | `business_reg_no` | Business reg no  | text |  |
| 3 | 13 | 12 | `CONTACTNO` | `contactno` | CONTACT NO | text |  |
| 4 | 1 | 12 | `Name` | `name` | Name | name (First, Last) |  |
| 4 | 13 | 12 | `IDNO` | `idno` | ID NO | text |  |
| 5 | 1 | 24 | `Address` | `address` | Address | address (Line1, Line2, City, State, PostalCode, Country) |  |
| 6 | 1 | 12 | `_1stDeposit` | `f_1st_deposit` | 1st deposit  | file multiple max 5 files | Error when QuoteNo is empty AND _1stDeposit has 0 files → "NO PAYMENT LOADED FORM NOT SUBMITTED" (`=(QuoteNo = null and _1stDeposit.Count() = 0)`) |
| 6 | 13 | 12 | `_2ndDeposit` | `f_2nd_deposit` | 2nd deposit  | file multiple |  |
| 7 | 1 | 12 | `_3rdDeposit` | `f_3rd_deposit` | 3rd deposit | file multiple |  |
| 7 | 13 | 12 | `_4thPayment` | `f_4th_payment` | 4th payment  | file multiple |  |
| 8 | | 24 | — | — | **— page break ** | pagebreak | Next button: "Submit" |

## Workflow

**Roles:** Public (public), Internal (internal)

**Statuses:** Incomplete [gray], Submitted [teal]

| Action | Button | Allowed when | → New status | Emails |
|---|---|---|---|---|
| Submit | Submit | `status == 'Incomplete'` | Submitted | to sales@fueltrailers.co.za; body = link to entry [includeReceipt] |
| Update | Update | `status != 'Incomplete'` | Submitted | to accounts@fueltrailers.co.za; body "(default entry email)" [includeAttachments, includeDocumentAttachments] |

Confirmation message (all actions): "Thank you for filling out the form. Your response has been recorded."

## Documents (PDF)

- #1 view → pdf
- #2 edit → pdf
