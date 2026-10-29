# Trailer Inspection Checklist

- Route (public): `/f/trailer-inspection-checklist`  ·  Admin: `/admin/forms/trailer-inspection-checklist`
- Cognito form id: 13  ·  internal name `TrailerInspectionChecklist`
- Entries at export: 690
- Entry summary / title template: `[InspectedByName]`

## Fields (in display order; 24-column grid)

| Row | Col | Span | Field key (Cognito) | DB key | Label | Type | Rules / notes |
|---|---|---|---|---|---|---|---|
| 1 | 1 | 12 | `TRAILERVINNUMBER` | `trailervinnumber` | TRAILER VIN NUMBER  | text |  |
| 1 | 13 | 12 | `_1STDATEINSPECTION` | `f_1_stdateinspection` | 1ST DATE INSPECTION  | date |  |
| 2 | 1 | 24 | `InspectedByName` | `inspected_by_name` | Inspected By (Name) | name (First, Last) | **Required** |
| 3 | 1 | 24 | `InspectorEmail` | `inspector_email` | Inspector Email | email | **Required**; Default: `admin@trailersandtankers.co.za` |
| 4 | 1 | 24 | `TrailerInspectionResults` | `trailer_inspection_results` | Trailer Inspection Results | section |  |
| 5 | 1 | 24 | `InspectorSignature` | `inspector_signature` | Inspector Signature | signature draw |  |
| 6 | 1 | 24 | `InspectionDate` | `inspection_date` | Inspection Date | date |  |
| 7 | | 24 | — | — | **— page break ** | pagebreak | Next button: "Submit" |

## Checklist items (section `Trailer Inspection Results`)

Each item renders as a sub-section titled with the item text, containing: **Fail** (checkbox, col 1 span 12) · **Pass** (checkbox, col 13 span 12) · **Comments** (multi-line, full width). No validation (Pass/Fail are independent checkboxes, both can be ticked in Cognito).

| # | Item | Cognito names (Fail / Pass / Comments) |
|---|---|---|
| 1 | 1. Chassis inspected for weld quality, damage, cracks and overall finish. | Fail / Pass / Comments |
| 2 | 2. Suspension, axle(s), U-bolts and mounting hardware securely fastened and correctly aligned. | Fail / Pass1 / Comments1 |
| 3 | 3. Wheel bearings checked and correctly adjusted/lubricated. | Fail / Pass2 / Comments2 |
| 4 | 4. Wheel nuts/bolts torqued to manufacturer's specification. | Fail / Pass3 / Comments3 |
| 5 | 5. Tyres inspected for correct size, pressure, condition and tread. | Fail / Pass4 / Comments4 |
| 6 | 6. Coupler operates correctly, locks securely and matches the specified tow ball size. | Fail / Pass5 / Comments5 |
| 7 | 7. Safety chains correctly fitted, securely attached and undamaged. | Fail / Pass6 / Comments6 |
| 8 | 8. Jockey wheel fitted correctly and operates smoothly. | Fail / Pass7 / Comments7 |
| 9 | 9. Braking system (if fitted) tested and adjusted correctly, including handbrake operation. | Fail / Pass8 / Comments8 |
| 10 | 10. Breakaway cable/system (where applicable) installed and functioning correctly. | Fail / Pass9 / Comments9 |
| 11 | 11. Electrical wiring secured and protected against chafing or damage. | Fail / Pass / Comments10 |
| 12 | 12. Trailer plug tested and all electrical functions operate correctly. | Fail / Pass11 / Comments11 |
| 13 | 13. Brake lights, tail lights, indicators, number plate light and reflectors checked. | Fail / Pass12 / Comments12 |
| 14 | 14. Mudguards, fenders and mounting brackets securely fitted. | Fail / Pass13 / Comments13 |
| 15 | 15. Load body, floor, tailgate, hinges, latches and catches inspected and operating correctly. | Fail / Pass14 / Comments14 |
| 16 | 16. Fuel tank, water tank or bowser (where applicable) inspected for leaks, fittings secure and pressure tested where required. | Fail / Pass15 / Comments15 |
| 17 | 17. Pump, hose reel, valves and accessories (where fitted) tested for correct operation. | Fail / Pass16 / Comments16 |
| 18 | 18. Reflective tape, chevron board, warning decals and VIN plate correctly installed. | Fail / Pass17 / Comments17 |
| 19 | 19. General cosmetic inspection completed (paint, galvanizing, decals, cleanliness and presentation). | Fail / Pass18 / Comments18 |
| 20 | 20. Road test completed (where applicable) and final quality inspection passed. | Fail / Pass19 / Comments19 |

## Workflow

**Roles:** Inspector (public), Form Creator / Internal Reviewer (internal)

**Statuses:** Incomplete [gray], Submitted [teal], Reviewed [yellow], Approved [green]

| Action | Button | Allowed when | → New status | Emails |
|---|---|---|---|---|
| SubmitInspection | SubmitInspection | `status == 'Incomplete' AND role == 'Inspector'` | Submitted | to sales@fueltrailers.co.za (from sales@fueltrailers.co.za); subject "Trailer Inspection Submitted"; body "An inspector has submitted the Trailer Inspection Checklist. Please review the inspection results." [includeEntryDetails, contains link for role 'Form Creator / Internal Reviewer'] |
| RequestReviewChanges | RequestReviewChanges | `status == 'Submitted' AND role == 'Form Creator / Internal Reviewer'` | Submitted | to [InspectorEmail] (from sales@fueltrailers.co.za); subject "Trailer Inspection Needs Changes"; body "Your Trailer Inspection Checklist submission requires changes. Please update the inspection details and resubmit." [includeEntryDetails, contains link for role 'Inspector'] — _Cognito keeps status at Submitted (probably intended to go back to Incomplete so the Inspector can edit - confirm with client)_ |
| MarkReviewed | MarkReviewed | `status == 'Submitted' AND role == 'Form Creator / Internal Reviewer'` | Reviewed | to [InspectorEmail] (from sales@fueltrailers.co.za); subject "Trailer Inspection Reviewed"; body "Your Trailer Inspection Checklist has been reviewed." [includeEntryDetails, contains link for role 'Inspector'] |
| ApproveInspection | ApproveInspection | `status == 'Reviewed' AND role == 'Form Creator / Internal Reviewer'` | Approved | to [InspectorEmail] (from sales@fueltrailers.co.za); subject "Trailer Inspection Approved"; body "Your Trailer Inspection Checklist has been approved." [includeEntryDetails, contains link for role 'Inspector'] |

Confirmation message (all actions): "Thank you for filling out the form. Your response has been recorded."

## Documents (PDF)

- #1 view → pdf
- #2 edit → pdf
