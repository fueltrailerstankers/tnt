# Delivery Note , Terms and Conditions

- Route (public): `/f/delivery-note`  ·  Admin: `/admin/forms/delivery-note`
- Cognito form id: 5  ·  internal name `DeliveryNoteTermsAndConditions`
- Entries at export: 1095
- Entry summary / title template: `[TrailerVinNO]`
- Entries encrypted at rest (Cognito 'Encrypt entries' ON) → encrypt `data` column / use pgsodium or app-level encryption

## Fields (in display order; 24-column grid)

| Row | Col | Span | Field key (Cognito) | DB key | Label | Type | Rules / notes |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 12 | `TrailerVinNO` | `trailer_vin_no` | Trailer Vin NO | text | Error when TrailerVinNO is empty AND Email is empty → "(Cognito default - no custom message set) suggest: 'Enter the Trailer VIN or an Email'" (`=(TrailerVinNO = null and Email = null)`) |
| 2 | 1 | 12 | `QuoteNo` | `quote_no` | Quote no: | lookup dropdown | Lookup → request-for-invoice (shows QuoteNo) |
| 2 | 13 | 12 | `INVOICENO` | `invoiceno` | INVOICE NO | text | Error when TrailerVinNO is empty AND INVOICENO is empty → "(Cognito default) suggest: 'Enter the Trailer VIN or the Invoice No'" (`=(TrailerVinNO = null and INVOICENO = null)`) |
| 3 | 1 | 24 | `QuoteNoNameQuoteNoNameFirst...QuoteNoVINASONUNIT` | `customer_details_from_quote` | [QuoteNo.Name] [QuoteNo.Name.First] [QuoteNo.Name.Last] [QuoteNo.IDNO] [QuoteNo.Address] [QuoteNo.Address.Line1][QuoteNo.Address.Line2] [QuoteNo.Address.Line2] [QuoteNo.Address.City] [QuoteNo.Address.State] [QuoteNo.Address.Country] [QuoteNo.VINASONUNIT]  | table | QuoteNo.VINASONUNIT references a field that no longer exists on Request For Invoice - drop it or add 'VIN AS ON UNIT' to RFI (confirm with client); Rebuild: Read-only 'Customer details' panel that renders the selected Request For Invoice entry: Name (First Last), ID NO, Address (Line1, Line2, City, State, Country). In Cognito this is an empty repeating table used only to show the merged label. |
| 4 | 1 | 6 | `Signature4` | `signature4` | Signature | signature draw | Customer signs acceptance of Standard Trading Terms + Warranty |
| 4 | 7 | 18 | — | — | (content block) | content | content/terms-and-conditions.md |
| 5 | 1 | 12 | `Signature` | `signature` | Signature | signature draw |  |
| 5 | 13 | 12 | — | — | (content block) | content | inline: the above documetns have been ready by myself the signatory and ID provided is that of myself |
| 6 | 1 | 24 | — | — | (content block) | content | content/polyurethane-tanks-waiver.md |
| 7 | 1 | 8 | `Signature2` | `signature2` | Signature | signature draw | Customer signs Polyurethane Tanks Waiver |
| 8 | 1 | 24 | — | — | (content block) | content | inline: the above individual confirms that they have received as set out in the above quote and the above invoice no on this date recorded |
| 9 | 1 | 8 | `Signature3` | `signature3` | Signature | signature draw | Customer signs receipt of goods |
| 9 | 9 | 8 | `COPYOfSignatoryID` | `copyof_signatory_id` | COPY of Signatory ID  | file multiple |  |
| 9 | 17 | 8 | `NATIS` | `natis` | NATIS  | file multiple |  |
| 10 | 1 | 12 | `PAYMENT` | `payment` | PAYMENT  | file multiple |  |
| 10 | 13 | 12 | `Payment2` | `payment2` | Payment 2 | file multiple |  |
| 11 | 1 | 12 | `DeliveryDate` | `delivery_date` | Delivery Date  | date |  |
| 12 | 1 | 12 | `Email` | `email` | Email | email | Protected/masked; Protected field: masked in entry list/emails, visible only to authorised staff |
| 13 | 1 | 6 | `SalesRepSignature` | `sales_rep_signature` | Sales Rep Signature | signature draw |  |
| 13 | 7 | 8 | `RELEASENOTE` | `releasenote` | RELEASE NOTE | file multiple |  |
| 14 | 1 | 8 | `Pic1FRONT` | `pic1_front` | Pic 1 FRONT | file multiple | accept image/* |
| 15 | 1 | 12 | `PIC2LEFT` | `pic2_left` | PIC 2 LEFT  | file multiple | accept image/* |
| 16 | 1 | 12 | `PIC3RIGHT` | `pic3_right` | PIC 3 RIGHT  | file multiple | accept image/* |
| 17 | 1 | 12 | `Pic4REAR` | `pic4_rear` | Pic 4 REAR  | file multiple | accept image/* |
| 18 | | 24 | — | — | **— page break ** | pagebreak | Next button: "Submit" |

## Workflow

**Roles:** Public (public), Internal (internal)

**Statuses:** Incomplete [gray], Submitted [teal]

| Action | Button | Allowed when | → New status | Emails |
|---|---|---|---|---|
| Submit | Submit | `status == 'Incomplete'` | Submitted | to sales@fueltrailers.co.za; body = link to entry [includeReceipt] |
| Update | Update | `status != 'Incomplete'` | (unchanged) | — |

Confirmation message (all actions): "Thank you for filling out the form. Your response has been recorded."

## Documents (PDF)

- #1 view → pdf — Must render T&C, waiver and all signature images - this PDF is the signed delivery note
- #2 edit → pdf
