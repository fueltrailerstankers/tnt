# BUILD_PLAN_trailer_stock_v2.md — Trailers & Tankers Stock Control (live site walkthrough, 20 Nov 2026)

Site: `https://trailers-tankers-stock.geraldbez.chatgpt.site/` · App footer reads "Stock control · Live pilot · version 5".

## 0. Read this first — limits of this walkthrough

1. **No baseline comparison.** `BUILD_PLAN_trailer_stock.md` and `M6.md` were not attached, so this document cannot say what is unchanged. It records **everything seen**. The "New, changed or removed" column below says **New (per brief)** only where your brief already named the item as new; everything else says **Not compared**. Once the two files are available, any row that matches v1 can be deleted.
2. **Live data was not visible.** The browser's sign-in to the private site had expired. Every live request returned the "Sign in required" page (HTTP 401), so the Live pilot workspace showed only its "not loaded" and error states. Live behaviour below comes from on-screen text plus message text built into the app, and is tagged **[inferred]**.
3. **Read-only.** Nothing was saved, submitted, dispatched, applied, dismissed, imported or confirmed. "Show setup credentials" and "PRINT" were not pressed. The workspace picker was switched to Sample review, as the brief asked, and set back to **Live pilot · shared stock** at the end. The CSV export and the CSV template were captured inside the page, so no file was downloaded.
4. **Tags.** **[observed]** = seen on screen, or measured in the page as it ran. **[inferred]** = a guess, or text that exists in the app's code but did not appear on screen during this session.
5. **Placeholders.** Sample VINs are written as VIN-001… and invoice numbers as INV-001…. No customer data appeared anywhere in the sample workspace.
6. **390px screenshots.** Chrome's window could not be resized, so the 390px images are a copy of the page with the site's own stylesheet, drawn in a 390px-wide frame. Layout rules apply exactly. Dialog positioning in those images is approximate.

---

## 1. Summary

| # | Area | What changed | New, changed or removed | Confidence |
|---|---|---|---|---|
| 1 | Global | Workspace bar: "Sample review" / "Live pilot · shared stock", status text, "Refresh live stock" | New (per brief) | High |
| 2 | Global | Workspace choice is remembered in the browser (`localStorage` key `tt-workspace-preference` = `review` / `live`) | Not compared | High |
| 3 | Global | No "Demo" option exists; only two workspaces | Not compared | High |
| 4 | Global | URL never changes (single page; no paths, no URL parameters) | Not compared | High |
| 5 | Global | GB avatar is plain text: no menu, not clickable | Not compared | High |
| 6 | Global | Sidebar footer "Review workspace / Trailers and Tankers (Pty) Ltd" is identical in both workspaces (never changes) | Not compared | High |
| 7 | Stock overview | "Factory build" button and dialog (model, quantity 1–50, start date, notes) plus a "Factory bulk stock and builds" list | New (per brief) | High (fields) / Medium (lifecycle) |
| 8 | Stock overview | Factory column; counts are buttons that open the Factory build dialog for that model | New (per brief) | High |
| 9 | Stock overview | "Total at branches" leaves out factory units | New (per brief) | High |
| 10 | Stock overview | Branch count buttons open the Unit register filtered by part number and branch | Not compared | High |
| 11 | Stock overview | Four number cards with sub-labels (sample); a single "Shared live stock" card when live data isn't loaded; cards not clickable | New (per brief) | High |
| 12 | Stock overview | Search matches model name and part number, ignores capitals, partial match; combines with "In stock only" (AND) | New (per brief) | High |
| 13 | Stock overview | "3 branches + factory" tag is fixed text, always shown | New (per brief) | High |
| 14 | Stock overview | Amber dot on a branch count = reserved units included | Not compared | High |
| 15 | Transfer | "Transfer unit" dialog (destination, date, reason / storage note) | Not compared | High |
| 16 | Sequence | "Remove sequence" / "Assign sequence" dialog with required reason; differs for Reserved units | Not compared | High (remove) / Medium (assign) |
| 17 | Outstanding deals | Live vs sample source tags and notices; dismiss/restore (Gerald only); Show dismissed; year and branch filters; PRINT label; Dispatch → pre-fills dispatch | Not compared | High (seen) / Medium (Gerald-only) |
| 18 | Unit register | Detail popup actions: Transfer unit, Remove/Assign sequence; Gerald-only Correct unit model, Remove duplicate unit/Remove from register; "Removed units" panel | Not compared | High (seen) / Medium (Gerald-only) |
| 19 | Unit register | CSV export: 10 columns, follows the current filters | Not compared | High |
| 20 | Factory dispatch | Third mode "Dispatch factory-built unit" with optional deal year/number | Not compared | High |
| 21 | Factory dispatch | Live VIN duplicate check (ignores capitals and surrounding spaces) | Not compared | High |
| 22 | Invoice review | Live: "Live invoice exceptions" table; simulator hidden. Sample: simulator only | Not compared | High |
| 23 | Pilot setup | Owner-only: opening stock check, CSV opening stock import (≤100 units), email login invitations, staff branch permissions | Not compared | Medium (only the locked state was seen) |
| 24 | Connections | Make connection settings, Show/Hide setup credentials (two secrets), Latest deliveries feed (≤200) | Not compared | Medium |
| 25 | Activity history | Dismissal history panel (server records); activity meta shows Xero sync / Staff update / Review user | Not compared | High (dismissals) / Medium (activity) |
| 26 | Roles | Gerald (super user), branch/factory staff with changes enabled, View only, Review user | Not compared | Medium |
| 27 | Mobile (≤700px) | Sidebar becomes a top bar with a sideways-scrolling nav; header row (breadcrumb + GB) hidden; tables scroll sideways | Not compared | High |

---

## 7. Pages (same numbering style as the original section 7)

### 7.0 Global shell

- **Layout** [observed]: dark left sidebar holds the logo ("T&T" + "TRAILERS / AND TANKERS", a link to `#`), the label "OPERATIONS" and 8 nav buttons. A top header shows the breadcrumb "OPERATIONS / <page name>" and a round "GB" avatar. Below that sits the workspace bar, then the page, then a page footer with "TRAILERS AND TANKERS" on the left and "Stock control · Live pilot · version 5" on the right.
- **Nav** [observed], in order, with icons: ▦ Stock overview · ◷ Outstanding deals · ☷ Unit register · ↗ Factory dispatch · ▤ Invoice review · ⚙ Pilot setup · ⇄ Connections · ◷ Activity history. The active item is highlighted.
- **Routing** [observed]: the address stays `/` on every page and every state. All 8 pages are hidden sections of one document.
- **GB avatar** [observed]: plain text with no click action, no menu and no tooltip. There are no user-menu entries (no sign-out, no profile).
- **Sidebar footer** [observed]: a green dot + "Review workspace", then "Trailers and Tankers (Pty) Ltd". It reads the same in both workspaces and does not change. [inferred] It is fixed text in the page; no app code updates it. Hidden at 390px [observed].
- **Toast** [observed]: a dark pill at the bottom centre, e.g. "Choose Live pilot to load shared stock."

#### 7.0.1 Workspace bar
- **Controls** [observed]:
  - Label "Workspace" + dropdown with exactly two options: "Sample review" (value `review`) and "Live pilot · shared stock" (value `live`).
  - Button "Refresh live stock".
  - Status text on the right.
- **What each workspace changes**:
  - **Sample review** [observed]: built-in sample data (12 units, 3–4 sample deals); status "Sample data · separate from live stock". Pages show sample tags: "Sample deals", "Sample simulator". Pilot setup is locked ("Choose Live pilot to manage opening stock and staff access."). [inferred] Changes go to sample records held in the browser and never reach the server ("This updates sample records only.").
  - **Live pilot · shared stock** [observed]: reads `/api/stock`, `/api/dismissals` and `/api/integration-feed` from the server. Pages show "Live Cognito deals" and "Live Xero feed". Writes go to `/api/stock` (POST) [inferred from code].
- **Switching** [inferred]: reloads sample data, reloads dismissals, hides the Connections credentials, updates labels and (in live) reloads live stock. The choice is saved in `localStorage` under `tt-workspace-preference` [observed].
- **"Refresh live stock"** [observed]: requests `GET /api/stock` again. It fetches from the server; it does not recount locally. In Sample review it only shows the toast "Choose Live pilot to load shared stock." and changes nothing. In live with an expired sign-in it shows the error below.
- **Status text states**:
  - Sample: "Sample data · separate from live stock" [observed].
  - Live, while loading: "Loading shared stock…" [inferred].
  - Live, request failed: `<browser error text> Live counts are unavailable.` [observed], e.g. "Unexpected token '<', "<!DOCTYPE "... is not valid JSON Live counts are unavailable."
  - Live, loaded: "Shared stock loaded · <time> · Opening stock confirmed|Opening stock not confirmed · <role>" [inferred]. `<time>` is a time of day in en-ZA format, Africa/Johannesburg time zone. `<role>` is "Gerald, super user" for the owner, otherwise the user's assigned branch, otherwise "View only".
  - Live, server says the record list was cut short: "Record limit reached · updates disabled. Contact the administrator." [inferred]
- **Meaning of the three phrases in your brief** [inferred]:
  - "Shared stock loaded": the last `GET /api/stock` succeeded.
  - "Opening stock confirmed": Gerald pressed "Confirm opening stock has been checked" in Pilot setup (the server flag `openingVerified`).
  - "View only": signed in and admitted to the site, but with no assigned branch.
- **390px** [observed]: the dropdown and button stack and the status text wraps under them.

### 7.1 Stock overview

- **Header** [observed]: eyebrow "YOUR NETWORK, AT A GLANCE", title "Stock overview", subtitle "Find the right unit. See every branch." Buttons "Factory build" (secondary) and "+ Dispatch a unit" (primary). "+ Dispatch a unit" opens Factory dispatch in "Without sequence number" mode [observed].
- **Number cards (Sample review)** [observed], each with an icon:

  | Card | Number (sample) | Sub-label | Icon |
  |---|---|---|---|
  | Stock across branches | 10 | "Includes 1 reserved" (template "Includes N reserved") | ▦ |
  | Ready to sell | 9 | "Available, unreserved units" | ↗ |
  | Reserved | 1 | "Awaiting full payment" | ◷ |
  | At factory | 1 | "Not in branch quantities" | ⌂ |

  None of the cards is clickable: no handler, normal cursor, and clicking does nothing [observed].
- **Number cards (Live, not loaded)** [observed]: one card "Shared live stock", value "—", sub-label "Refresh live stock after signing in". [inferred] Once live data loads, the same four cards appear.
- **"Stock by model" panel** [observed]: title, subtitle "Branch counts include reserved units. Fully paid units are excluded.", tag "3 branches + factory". Search box with placeholder "Search model name or part number…" (accessible name "Search models"). Checkbox "In stock only".
- **Columns** [observed]: MODEL / PART NUMBER · JOHANNESBURG · CAPE TOWN · DURBAN · FACTORY · TOTAL AT BRANCHES. The model cell shows the name in bold and the part number underneath. 57 models are listed.
- **Count cells** [observed]: every branch and factory cell is a button. Zero shows "—". Accessible names follow "<n> <part> units in <Branch>" or "<n> <part> units at Factory".
  - Branch cell click: opens the **Unit register** with search = part number and Location = that branch; Status is left at "All statuses" [observed]. This works for "—" cells too, which then show "No matching units." [observed].
  - Factory cell click: opens the **Factory build** dialog with that model already selected, for zero and non-zero counts alike [observed].
  - "TOTAL AT BRANCHES" is plain bold text, not clickable [observed].
- **Amber dot** [observed]: a small amber dot after a branch count when that count includes Reserved units, e.g. "2 ●" for 3000D Johannesburg. Legend under the table: "Amber indicator = reserved units included".
- **Footer line** [observed]: "57 of 57 models" / "N of 57 models". Live, not loaded: "Stock counts unavailable".
- **Empty / error rows** [observed]: "No models match your search." · live: "Live stock is not loaded. Counts are unavailable."
- **390px** [observed]: the title block and the two buttons sit side by side and the title wraps. Cards are two per row. The table scrolls sideways (about 751px of content in a 358px box), so only MODEL and JOHANNESBURG show at first.

#### 7.1.a Factory build dialog
- **Open from** [observed]: the "Factory build" button (no model selected) or any FACTORY cell (that model selected).
- **Header** [observed]: eyebrow "FACTORY PRODUCTION", title "Factory build", text "Start any model from the stock list. A VIN and deal number can be assigned when dispatching."

  | Field | Type | Required | Options / limits | Default |
  |---|---|---|---|---|
  | Model / part number * | dropdown | yes | "Choose a model" + 57 entries shown as "<part> — <name>" (e.g. "CTLL1 — 3 meter animal trailer NO BRAKES 750 KGS GWM"). 1500D and 3000SKI have no name, so they read "1500D — 1500D" and "3000SKI — 3000SKI" | "Choose a model", or the clicked model |
  | Quantity * | number | yes | min 1, max 50, whole numbers only | 1 |
  | Start date * | date | yes | no min or max | today (2026-11-20) |
  | Build notes | textarea | no | — | empty |

- **Buttons** [observed]: "Close" and "Start build" (primary; not pressed).
- **Browser validation messages** [observed]: "Please select an item in the list." (model) · "Value must be greater than or equal to 1." · "Value must be less than or equal to 50." · "Please enter a valid value. The two nearest valid values are 2 and 3." · "Please fill in this field." (quantity or date empty).
- **Permission** [observed]: in live without a loaded role, every field and "Start build" is disabled, with the message "Only assigned factory staff or Gerald can start or dispatch builds."
- **List "Factory bulk stock and builds"** [observed]: columns MODEL · VIN / BUILD · DEAL / STATUS · STARTED · NOTES · (action).
  - Sample row: "2500D / 2500 litre metal bowser · VIN-012 · 2026 / 259, Available · 2026-11-20 · Illustrative sample unit; not actual company stock." with the button "Transfer / dispatch →".
  - Empty: "No factory builds or bulk stock." [observed]. Variant: "No factory builds or bulk stock for this model" [inferred].
- **Row buttons**:
  - Factory unit that already has a VIN ("bulk stock"): "Transfer / dispatch →" opens the **Transfer unit** dialog, not the dispatch page [observed].
  - Build without a VIN: "Dispatch →" [inferred]. It is expected to open Factory dispatch in "Dispatch factory-built unit" mode with that build selected [inferred].
  - Build rows show the first 8 characters of the build ID in the VIN / BUILD column [inferred].
- **What a factory build appears to be** [inferred]: a planned or in-progress batch of N units of one model at the factory, with no VIN and no deal yet. Each build later goes through Factory dispatch → "Dispatch factory-built unit", where the full VIN, the destination and an optional deal year/number are entered. That turns it into a normal unit at a branch (Available, or Reserved/Sold once Xero matches an invoice).
  - "Factory bulk stock" means finished units that already have a VIN and sit at location **Factory**. They can be transferred to a branch or stay in storage.
  - **Status path** [inferred]: Build started → dispatched (unit created with VIN at branch, Available) → Reserved (unpaid Xero invoice) → Sold (fully paid). The status label used for an open build was not seen.
  - **Deals** [inferred]: a deal number is optional at factory dispatch. With one, the Cognito deal leaves Outstanding deals. Without one it is a stock dispatch, and "Dispatches without a deal number do not clear this list." [observed text].
  - **"At factory" count** [observed]: counts units whose location is Factory (sample = 1). Whether open builds without a VIN are included is **unconfirmed** (no sample build exists).

#### 7.1.b Transfer unit dialog (from the factory list "Transfer / dispatch →" or the unit popup "Transfer unit")
- [observed] Eyebrow "STOCK MOVEMENT", title "Transfer unit", summary "<part> · VIN <VIN> · From <location> · Deal <year> / <seq> · <status>". It includes a sequence button ("Remove sequence", or "Assign sequence" [inferred]). Text: "The VIN, deal number, reservation, invoice and equipment stay with this unit. Factory bulk stock can remain in storage until dispatched again."
- **Fields** [observed]:
  - Destination * — "Choose destination" + every location except the current one. For a factory unit: Johannesburg, Cape Town, Durban.
  - Transfer date * — today.
  - Reason / storage note — optional; placeholder "For example: return to factory storage".
- **Buttons** [observed]: "Cancel", "Save transfer" (not pressed).
- **Permission message** [inferred]: "You cannot transfer this unit. Refresh stock or ask Gerald." The staff help text says "Only Gerald can transfer between branches" [observed text in Pilot setup].

#### 7.1.c Sequence (deal link) dialog
- [observed] Eyebrow "STOCK ALLOCATION".
- **Remove, Available unit** [observed]: title "Remove sequence"; text "Remove this deal link and make the unit Available. The original Cognito deal returns to Outstanding Deals."; Reason * (placeholder "For example: use existing branch stock"); buttons "Cancel" / "Remove sequence · make Available".
- **Remove, Reserved unit** [observed]: text "Remove the deal link. This unit will remain Reserved by Xero invoice INV-002; it cannot become Available until the invoice reservation is resolved."; button "Remove sequence (keep Reserved)".
- **Assign** [inferred; no unit without a sequence exists in the sample]: title "Assign sequence number". Fields: Deal year * (2000–2100), Sequence number * (≥1), button "Find deal", a deal preview, Reason *. Buttons "Cancel" / "Save allocation" (static label) or "Assign sequence". Permission error: "You cannot allocate this unit. Refresh stock or ask Gerald."

### 7.2 Outstanding deals

- **Header** [observed]: eyebrow "DEALS AWAITING DISPATCH", title "Outstanding deals", subtitle "Track which deal numbers still need a unit sent to each branch." Source tag: "Live Cognito deals" (live) / "Sample deals" (sample).
- **Notice** [observed]:
  - Live: "Only LIVE deliveries from Cognito appear here. Completed shared dispatches and Gerald’s dismissals leave the outstanding list. Reconcile older deals before relying on totals."
  - Sample: "These are illustrative deals, separate from the live pilot."
- **Access line + "Refresh dismissals"** [observed / inferred]:
  - Default and View access: "View access · Only Gerald can dismiss or restore deals." [observed]
  - Gerald: "Signed in as super user · Only you can dismiss or restore deals." [inferred]
  - Errors: "Could not check access." / "Dismissal service unavailable." [inferred]
  - Failed load [observed]: "<error> Dismiss actions are disabled; any previously loaded list may be out of date."
- **Cards**:
  - Sample [observed]: "All branches", "Johannesburg", "Cape Town", "Durban", each with a count and "Awaiting dispatch · <year>". The cards follow the **year** filter only, not branch or search [observed]. They are not clickable [observed].
  - Live, not loaded [observed]: one card "Outstanding live deals" / "—" / "Load shared stock first".
- **Table panel** [observed]: title "Awaiting factory dispatch", subtitle "Created deals stay here until linked to a completed dispatch."
  - Search, placeholder "Search deal number, model or quote…": matches deal number, model/part number and quote number; ignores capitals; partial match; does **not** match branch names ("durban" → 0) [observed].
  - "Show dismissed" checkbox: **replaces** the list with dismissed deals only, e.g. "0 dismissed sample deals" [observed].
  - Deal year dropdown: live offered only 2026; sample offered 2026 and 2025 [observed]. [inferred] The options are built from the years present in the data.
  - Deal branch dropdown: "All branches", Johannesburg, Cape Town, Durban.
  - All filters combine (AND) [observed].
- **Columns** [observed]: YEAR / DEAL (e.g. "2026 / 259" with a small "Sample deal" or "Cognito deal" underneath) · BRANCH · MODEL · QUOTE NUMBER · STATUS · actions.
- **Status values**:
  - "Awaiting dispatch" [observed].
  - "Needs review", "Dismissed", "Reserved", "Sold" [inferred]. Deals with problems list them as "<issue>; <issue>" [inferred].
- **Row actions**:
  - "Dispatch →" [observed]: opens Factory dispatch in "Existing sequence number" mode, pre-filling deal year, sequence, model (locked), destination branch and today's date. If a unit already carries that sequence (e.g. the factory unit with 2026/259), its VIN is filled in too. Lookup message: "Sample deal 2026 / 259 · 2500D · Johannesburg. Add or confirm the VIN and destination."
  - "PRINT" [not exercised]: opens a pop-up label. Messages: "Allow pop-ups for this site, then select PRINT again.", "Loading trailer label…", "Could not load trailer details.", "The Cognito deal is unavailable. Refresh the outstanding list.", "Workspace changed. Select PRINT again in the correct workspace.", "Label not printed: <reason>" [inferred].
  - "Dismiss" / "Restore": Gerald only [inferred].
- **Count line** [observed]: "3 outstanding sample deals" · "1 outstanding sample deal" · "0 dismissed sample deals" · live: "Live count unavailable". Note under the table: "Dispatches without a deal number do not clear this list."
- **Empty states** [observed]: "No outstanding sample deals match these filters." · "No dismissed sample deals match these filters." · live: "Live deals are not loaded. Refresh live stock after signing in."
- **Dismiss / Restore dialog** [static fields observed, behaviour inferred]:
  - Eyebrow "SUPER USER ONLY", title "Dismiss deal" or "Restore deal".
  - Text: "Remove this deal from the outstanding list. Its dismissal history will be retained. You can restore it later." / "Return this deal to the outstanding list. This does not change dispatch or payment records."
  - Reason * — placeholder "Why is this deal being dismissed?" / "Why is this deal being restored?"
  - Buttons "Cancel" / "Dismiss deal" or "Restore deal".
- **PRINT label content** [inferred]: "TRAILERS AND TANKERS"; "SAMPLE · NOT A LIVE DEAL" in sample; fields DEAL NO, YEAR, BRANCH, TRAILER / CAPACITY, MODEL, QUOTE NO, PART / ITEM; section "TRAILER & EQUIPMENT DETAILS"; "Equipment not recorded" or "Not recorded"; "REVIEW REQUIRED: <issues>"; label setting "90 mm wide · continuous thermal roll"; buttons "Print label" and "Close".
- **390px** [observed]: the source tag sits next to the title; cards are two per row; the table scrolls sideways.

### 7.3 Unit register

- **Header** [observed]: eyebrow "EVERY UNIT, ONE RECORD", title "Unit register", subtitle "Search current stock and sold history by VIN or sequence.", button "↓ Export CSV".
- **Filters** [observed]:
  - Search, placeholder "Search VIN, sequence, model or invoice…": partial match; ignores capitals; covers VIN, sequence number, part number and invoice number; does **not** cover location ("durban" → none).
  - Location: "All locations", Factory, Johannesburg, Cape Town, Durban.
  - Status: "All statuses", Available, Reserved, Sold.
  - "Clear" resets all three.
  - Filters combine (AND).
- **Columns** [observed]: VIN / SEQUENCE (VIN in bold, "Sequence <n>" underneath) · MODEL (part number) · LOCATION · STATUS (badge: Available green, Reserved amber, Sold) · INVOICE ("—" when none) · "View →".
- **Empty states** [observed]: "No matching units." · live: "Live stock is not loaded."
- **Detail popup** [observed]:
  - Eyebrow "UNIT RECORD · SAMPLE WORKSPACE". Live probably "UNIT RECORD · SHARED LIVE STOCK" [inferred].
  - Title = part number; model name underneath.
  - Rows: VIN · Deal / sequence ("2026 / 249") · Location · Status (badge) · Invoice ("None" when empty) · Dispatch date · Accessories (one per line, or "None recorded") · Notes.
  - Buttons:
    - Available or Reserved: "Transfer unit" (primary) and "Remove sequence"; "Assign sequence" when there is no sequence [inferred]. Then "Close".
    - Sold: "Close" only [observed].
  - Gerald only [inferred]:
    - "Correct unit model" (not for Sold units). Dialog eyebrow "GERALD · STOCK CORRECTION", fields Correct model and Reason (both required), buttons "Cancel" / "Save correction".
    - "Remove duplicate unit" / "Remove from register" (Available units only). Dialog eyebrow "GERALD · REGISTER CORRECTION", text "Removed units leave stock counts and the active register. Their history is kept, and Gerald can restore them below the unit register.", Reason (required), buttons "Cancel" / "Save".
- **Removed units panel** (under the table; empty in the sample) [inferred]: title "Removed units", text "Recoverable duplicate records. Only Gerald can restore them.", button per row "Restore unit" (dialog title "Restore removed unit").
- **CSV export** [observed]:
  - File name in sample: `Stock_Review_Export.csv`. The live file name was not seen.
  - Header line, exactly: `"VIN","Sequence","Part number","Model","Location","Status","Invoice","Dispatch date","Accessories","Notes"`.
  - Every value is in double quotes; lines end with CRLF.
  - Sequence holds the number only (no year). Invoice is blank when empty. Accessories are joined with "; ".
  - The export **follows the current filters** (Location = Factory → 1 row).
- **390px** [observed]: the export button sits beside the title; filters wrap onto two rows; the table scrolls sideways.

### 7.4 Factory dispatch (nav label "Factory dispatch"; page title "Dispatch a unit")

- **Header** [observed]: eyebrow "FACTORY TO BRANCH", title "Dispatch a unit", subtitle "Add a VIN, confirm the equipment and choose its destination."
- **Step 1 — "Unit details", mode radios** [observed]: "Without sequence number" (default) · "Existing sequence number" · "Dispatch factory-built unit".
  - **Existing sequence number** [observed]:
    - Deal year (number 2000–2100, required) + Sequence number (placeholder "e.g. 259") + "Find unit".
    - Sample lookup results: "Sample deal 2026 / 260 · 1000DB · Cape Town. Add or confirm the VIN and destination." or "No matching sample deal for this year and number. Live Cognito lookup is not connected."
    - A found deal fills model (locked) and branch.
    - After a failed lookup the model is cleared but the branch keeps its old value. With an empty sequence, the previous model stays [observed; probably a bug].
    - Live lookup [inferred]: reads `/api/stock`; shows "Live deal …", "Imported Cognito deal · quote <quote>", the quote lines (part or "Quote note" + description) and "Review fitted accessories below. Original quote lines may include notes." Errors: "Refresh shared stock before looking up a deal." / "Lookup failed."
  - **Dispatch factory-built unit** [observed]:
    - Factory-built unit * — options "Choose a factory unit" + "<part> — <VIN>".
    - Deal year (optional) — 2000–2100.
    - Deal / sequence number (optional) — ≥1.
    - Help text: "Leave the deal number blank for stock dispatch. Enter the full VIN before dispatching."
    - Choosing a unit fills model (locked), VIN and the unit's deal year/number. It does **not** change the destination branch.
    - In live there were no options [observed].
- **Common fields** [observed]:
  - Model / part number * (dropdown, "Choose a model").
  - VIN * (placeholder "Enter the full VIN").
  - Destination branch * ("Choose a branch", Johannesburg, Cape Town, Durban; Factory is not offered).
  - Dispatch date * (date, default today).
- **VIN check** [observed]:
  - Runs on every keystroke.
  - Matches the whole VIN against all records (including sold units), ignoring capitals and surrounding spaces.
  - Message: "VIN already used — <part>; sequence <n>; <location>; <status>. Open the existing record instead."
  - No length or format check: "ABC" is accepted, and there is no minimum or maximum length and no pattern.
  - Partial VINs do not match.
- **Step 2 — "Fitted products & accessories"** [observed]: text "Ten optional lines. Record the equipment fitted to this individual unit."; 10 text inputs labelled 01–10, placeholder "Product or accessory".
- **Other fields and button** [observed]: "Dispatch notes" textarea, placeholder "Delivery or unit notes". Help "VIN is checked against all records, including sold units." Button "Complete dispatch →" (not pressed).
- **Browser validation** [observed]: "Please fill in this field." (VIN etc.) · "Value must be greater than or equal to 1." · "Value must be greater than or equal to 2000." · "Value must be less than or equal to 2100." · "Please enter a valid value. The two nearest valid values are 1 and 2."
- **Submit messages** [not exercised; inferred from app text]:
  - "Refresh shared stock before dispatching."
  - "Find and select the live deal first."
  - "Choose a factory-built unit first."
  - "Factory unit is no longer available. Refresh stock."
  - "Saving dispatch…"
  - "Dispatch service did not return a confirmation. Refresh live stock and check this VIN before retrying."
  - "Dispatch failed. Refresh before retrying."
  - "Dispatch saved." / "Dispatch saved to shared stock." / "Factory unit dispatched in sample workspace."
- **390px** [observed]: the radios stack vertically; all fields are one column.

### 7.5 Invoice review

- **Header** [observed]: eyebrow "INVOICE TO STOCK", title "Invoice review", subtitle "Test the agreed payment rules before connecting Xero." Tag "Live Xero feed" (live) / "Sample simulator" (sample).
- **Live** [observed]: only the panel "Live invoice exceptions" — "Missing VINs, conflicting links and payment reversals stay here for review."
  - Columns INVOICE · VIN / REFERENCE · REVIEW REQUIRED.
  - Empty: "No invoice exceptions loaded. Verify the live Xero feed is enabled."
  - The simulator and rules panels are hidden in live.
- **Sample** [observed]: exceptions panel hidden; "Simulate an invoice update" is shown.
  - Text: "This updates sample records only. One invoice covers one unit."
  - Invoice number * (placeholder "INV-0042"); Invoice reference (VIN) * (placeholder "Exact VIN from the reference field"); Payment status: "Unpaid / partly paid — Reserved" (default) or "Fully paid — Sold".
  - Button "Apply test update" (not pressed).
  - Panel "Agreed stock rules": 1 "Match the reference", 2 "Reserve while unpaid", 3 "Remove when fully paid", plus the closing note (Wording, section 9).

### 7.6 Pilot setup

- **Header** [observed]: eyebrow "CONTROLLED ROLLOUT", title "Pilot setup", subtitle "Load opening stock, assign staff branches and verify the live cycle."
- **Access notice**:
  - Sample: "Choose Live pilot to manage opening stock and staff access." [observed]
  - Live, not owner or not loaded: "Only Gerald can administer the live pilot. Refresh shared stock after signing in." [observed]
  - Owner: "Gerald · Live pilot administration. Staff sign-in must also be admitted through the private site’s sharing settings." [inferred]
- **Owner-only sections** [static fields observed while hidden; behaviour inferred]:
  1. **Opening stock check.**
     - State: "Not confirmed." → "Gerald has confirmed opening stock." or "Opening stock has not been confirmed. Availability counts remain pilot figures."
     - Text: "Compare all factory and branch VINs with the physical stock before confirming. This is a pilot until opening stock, live feeds and staff access are checked."
     - Button "Confirm opening stock has been checked".
     - Live feed line: "Live records received: <n>…".
  2. **Opening stock import.**
     - Text: "CSV: vin, model, branch, date, dealYear, sequence, notes. VIN/model/branch are required. Add accessory1 through accessory10 if needed. Import up to 100 units at once." and "Opening stock must include units still physically held, even if invoiced. Matching live invoice feeds will apply Reserved or Sold. Use Factory for factory stock."
     - Buttons "Download CSV template", file input "Opening stock CSV", "Preview import", "Import these units".
     - Template file `Opening_Stock_Template.csv`, header only: `vin,model,branch,date,dealYear,sequence,notes,accessory1,…,accessory10` [observed].
  3. **Email login accounts.**
     - Text: "Invite staff to the separate email-login portal. Only you can approve users; nobody can sign themselves up for stock access."
     - Status "Checking email login setup…" [observed] → "Email login is prepared but not activated. Authentication project, email sender and portal hosting still need to be configured." [inferred]
     - Fields: Staff work email (email, required); Assigned location (Factory, Johannesburg, Cape Town, Durban; default Factory); "Allow stock changes at this location" (checkbox, **ticked by default**).
     - Button "Send invitation" (**disabled** [observed]).
     - Rows: "<email> · <branch|View only|Gerald, super user> · Login enabled|Login disabled" + "Disable login"/"Enable login". Error "Account action failed." [inferred]
  4. **Staff branch permissions.**
     - Text: "Everyone admitted to this private site can read all branches. Assign a branch here to permit changes. Factory staff can dispatch; branch staff can update units at their own branch. Only Gerald can transfer between branches, import or dismiss deals." and "This does not invite staff or grant access to the site. Add approved staff through the site's sharing settings separately."
     - Fields: Staff sign-in email (email, required); Assigned location (same 4 options; default Factory); "Enable stock changes" (checkbox, **ticked by default**).
     - Button "Save staff permissions".
     - Rows: "<email> · <branch> · Changes enabled|View only"; empty "No staff branch permissions assigned." [inferred]

### 7.7 Connections — does it do more than show sync status?

Yes, partly. It does not push anything to Cognito or Xero, but it now also:
- hands Gerald the Make connection credentials;
- gives setup instructions for the Make blueprint;
- lists up to 200 received deliveries, split into live and test [observed text; inferred behaviour].

- **Header** [observed]: eyebrow "COGNITO & XERO", title "Connections", subtitle "Check Cognito and Xero deliveries to the live pilot.", button "Refresh feed" (reads `/api/integration-feed`; the feed also loads automatically when the page opens [observed]).
- **Notice** [observed]: bold "Live pilot ready", then "Live Cognito deliveries populate the Live pilot deal list. Live Xero deliveries reconcile shared stock by VIN. Test deliveries remain separate. Opening stock and staff access must be checked before rollout." The same text appears in both workspaces.
- **"Make connection settings" panel** [observed]:
  - Status line: "Sign in as Gerald to check integration setup." (before loading) → "Connection check unavailable." (after the failed load). OK text: "Receivers ready · Live deliveries reconcile the shared pilot register; test deliveries stay separate." [inferred]
  - Text: "Import the prepared Make blueprint as an inactive copy. Test delivery first; keep the existing scenario running until the replacement is checked."
  - Buttons "Show setup credentials" / "Hide credentials" [not exercised]. They reveal: "Copy these only into your private Make connection headers. Do not email them or include them in screenshots.", "Private site access token", "Stock sync key" (two read-only text areas).
  - Error box: "<error> Previously loaded deliveries may be out of date." [observed]
- **"Latest deliveries" table** [observed]: text "Up to 200 source records. Test and live deliveries are stored separately."
  - Columns SOURCE / MODE · DEAL OR INVOICE · BRANCH / VIN · RESULT · RECEIVED. Empty: "No feed loaded." [observed] / "No deliveries yet. Configure Make and send a test delivery." [inferred]. Error "Unable to load feed." [inferred]
  - Values [inferred]: source "Cognito" or "Xero"; mode "Live feed · see stock / exceptions" or "Test feed · no stock changes"; result "Deal received" or "Review required"; received time in Africa/Johannesburg.

### 7.8 Activity history

- **Header** [observed]: eyebrow "A CLEAR RECORD", title "Activity history", subtitle "Dispatches and invoice changes made in this review workspace." The subtitle says "review workspace" even in Live pilot.
- **Activity panel**:
  - Empty states [observed]: sample "No changes yet. Your test dispatches and invoice updates will appear here."; live, not loaded "Load shared stock to view activity."
  - Item format [inferred]: bold event text, then "<date-time, en-ZA, Africa/Johannesburg> · <actor>". Actor is "Xero sync" (Xero-driven changes in live), "Staff update" (other live changes) or "Review user" (sample).
  - Known event wording [inferred]: "Dispatched factory build <part> · <VIN> to <branch>". Other live event wording comes from the server and was **not visible** (Open questions).
- **Dismissal history panel** [observed]: title "Dismissal history", subtitle "Server records · Gerald, super user".
  - Item: bold "Dismissed live/<year>/<deal>" (or "Restored …"), then the reason, then a time stamp like "2026/11/18, 08:23:11".
  - At page load there were 24 dismissals from 2 to 18 Nov 2026, e.g. deals 2026/740–818. Reasons included "scam", "DUPLICATE", "ALREADY SENT TO JHB GERALD" and a "1/20"…"20/20" series.
  - After the session expired: "No dismissal activity loaded."

### 7.9 Pages, menus, tabs or user-menu entries not in the v1 plan

v1 could not be compared, so these are the items most likely to be new:
- Dialogs: Factory build, Transfer unit, Sequence (assign/remove), Correct unit model, Remove/Restore unit, Dismiss/Restore deal, Deal label print [observed/inferred as marked above].
- The "Removed units" panel.
- Pilot setup's "Email login accounts".
- Connections' credentials reveal.
- No tabs anywhere.
- No user menu.

---

## 8. Data — fields, statuses and rules (written so they can be tested)

**Entities and fields**
- **Unit** [observed in popup/CSV]: VIN, deal year, sequence, part number (model), location (Factory | Johannesburg | Cape Town | Durban), status (Available | Reserved | Sold), invoice, dispatch date, accessories[0..10], notes. [inferred] Also an archived/removed flag with a reason, and a history of model corrections.
- **Factory build** [inferred]: id, model, quantity (1–50), start date, notes, created by. Turned into a Unit at dispatch.
- **Deal** (from Cognito) [observed]: year, deal/sequence number, branch, model, quote number, status. Source shown as "Cognito deal" or "Sample deal". [inferred] Also issues[] and the quote lines.
- **Dismissal** [observed]: deal key (`live/<year>/<deal>`), action (dismiss | restore), reason, time stamp.
- **Delivery** [inferred]: source (Cognito | Xero), mode (live | test), deal or invoice, branch or VIN, result, received time. The 200 most recent are kept.
- **Staff permission** [inferred]: email, assigned location, changes enabled (yes/no). **Portal user**: email, branch, active, owner.
- **Pilot flags** [inferred]: `openingVerified` (bool), `truncated` (record limit reached).

**Count rules** [observed with sample data unless marked]
1. Branch cell (model M, branch B) = number of units with model M, location B and status Available or Reserved. Sold units are left out. (Sample 2000S Durban is Sold → shows "—".)
2. FACTORY cell (model M) = number of units with model M and location Factory, excluding Sold. (Whether open builds without a VIN count is unconfirmed.)
3. TOTAL AT BRANCHES (model M) = JHB + CPT + DBN cells. **The factory cell is never added** (2500D: factory 1, total "—").
4. Stock across branches = sum of all branch cells, all models (sample 10). Sub-label "Includes N reserved" uses N = Reserved units at branches (1).
5. Ready to sell = Stock across branches − Reserved at branches (10 − 1 = 9).
6. Reserved card = units with status Reserved (1). [inferred] Branches only.
7. At factory = units at Factory, excluding Sold (1). Never part of rules 3–5.
8. Amber dot shows on a branch cell when at least 1 of its units is Reserved.
9. "In stock only" keeps a model when (any branch cell + factory cell) > 0. A factory-only model (2500D) is kept.
10. Model search: keep a row when the lower-cased query appears inside the lower-cased "name" or "part number". The query is **not trimmed**: a leading or trailing space changes the result ("  bowser  " → 0, "bowser " → 5).
11. Outstanding deal cards: count deals that are not dismissed and not linked to a completed dispatch, for the selected **year**, per branch. Branch and search filters do not change the cards.
12. A deal leaves Outstanding when a completed dispatch carries its year + sequence, or when Gerald dismisses it. Dispatches without a deal number never clear deals [observed text].
13. Removing a sequence from an Available unit makes it Available and returns the deal to Outstanding. On a Reserved unit the status stays Reserved until the invoice reservation is resolved [observed text].
14. Invoice rules [observed text]: the VIN in the invoice reference identifies one unit; unpaid or partly paid → Reserved (still counted at the branch); fully paid → Sold (removed from counts; invoice number kept and searchable). Missing VINs, unknown VINs, conflicting links and payment reversals go to "Live invoice exceptions". Cancellations and credits have no rule yet.
15. VIN uniqueness: a new VIN is rejected when it matches any existing VIN, Sold included, ignoring capitals and surrounding spaces.
16. Quantity of a factory build: whole number from 1 to 50.
17. Opening-stock CSV import: VIN, model and branch are required; up to 100 rows per import; branch may be "Factory".
18. Unit register CSV export = the rows visible under the current filters.

**Statuses**
- Unit: Available · Reserved · Sold [observed]; removed/archived [inferred].
- Deal: Awaiting dispatch [observed]; Needs review · Dismissed · Reserved · Sold [inferred].
- Delivery result: Deal received · Review required [inferred].
- Login: Login enabled · Login disabled [inferred].
- Staff: Changes enabled · View only [inferred].

**API** (seen in network requests and app code)

| Endpoint | Methods |
|---|---|
| `/api/stock` | GET; POST for dispatch and other writes [inferred] |
| `/api/dismissals` | GET |
| `/api/integration-feed` | GET |
| `/api/portal-users` | GET/POST |

All return 401 with an HTML sign-in page once the private-site sign-in expires. The app then shows the raw JSON parse error to the user [observed].

**Roles** [inferred, from on-screen text]
- **Gerald (super user)**: everything, including the owner-only actions: transfer between branches, import, dismiss/restore deals, model correction, remove/restore units, opening stock confirmation, staff and portal access, credentials.
- **Factory staff with changes enabled**: start builds; dispatch.
- **Branch staff with changes enabled**: update units at their own branch.
- **View only**: admitted to the site, reads all branches, changes nothing.
- **Review user**: anyone in the Sample review workspace.

---

## 9. Wording (exact, as on screen)

Static text was copied from the page; dynamic text is marked (code) where it was only found in the app's code.

**Workspace bar / global**
- "Workspace" · "Sample review" · "Live pilot · shared stock" · "Refresh live stock"
- "Sample data · separate from live stock"
- "Unexpected token '<', "<!DOCTYPE "... is not valid JSON Live counts are unavailable." (browser error + suffix)
- (code) "Loading shared stock…" · "Could not load shared stock." · "Shared stock loaded · " · "Opening stock confirmed" · "Opening stock not confirmed" · "Gerald, super user" · "View only" · "Record limit reached · updates disabled. Contact the administrator." · "Browser storage is unavailable. Your change could not be saved."
- Toast: "Choose Live pilot to load shared stock."
- Sidebar: "OPERATIONS" · "Review workspace" · "Trailers and Tankers (Pty) Ltd" · footer "TRAILERS AND TANKERS" · "Stock control · Live pilot · version 5"

**Stock overview**
- "YOUR NETWORK, AT A GLANCE" · "Stock overview" · "Find the right unit. See every branch." · "Factory build" · "+ Dispatch a unit"
- Cards: "Stock across branches" / "Includes 1 reserved" · "Ready to sell" / "Available, unreserved units" · "Reserved" / "Awaiting full payment" · "At factory" / "Not in branch quantities" · live: "Shared live stock" / "—" / "Refresh live stock after signing in"
- "Stock by model" · "Branch counts include reserved units. Fully paid units are excluded." · "3 branches + factory" · "Search model name or part number…" · "In stock only"
- Columns "MODEL / PART NUMBER" "JOHANNESBURG" "CAPE TOWN" "DURBAN" "FACTORY" "TOTAL AT BRANCHES"
- "57 of 57 models" · "No models match your search." · "Live stock is not loaded. Counts are unavailable." · "Stock counts unavailable" · "Amber indicator = reserved units included"
- Model-name typos kept as on screen: "SINGEL BRAKE", "NO BRAKES 750 KGS GWM", "4 meter cargo trailer double axel", "1000 LITER PLASTIC TANK ON METAL SKID BASE", "2000 litre stainless steel bowser MADE FROM 3CR12"

**Factory build**
- "FACTORY PRODUCTION" · "Factory build" · "Start any model from the stock list. A VIN and deal number can be assigned when dispatching."
- "Model / part number *" · "Choose a model" · "Quantity *" · "Start date *" · "Build notes" · "Close" · "Start build"
- "Factory bulk stock and builds" · columns "MODEL" "VIN / BUILD" "DEAL / STATUS" "STARTED" "NOTES" · "Transfer / dispatch →" · (code) "Dispatch →"
- "No factory builds or bulk stock." · "Only assigned factory staff or Gerald can start or dispatch builds."
- Note: the page's hidden starting markup says "Units being built"; the heading actually rendered is "Factory bulk stock and builds".

**Transfer / sequence**
- "STOCK MOVEMENT" · "Transfer unit" · "The VIN, deal number, reservation, invoice and equipment stay with this unit. Factory bulk stock can remain in storage until dispatched again." · "Destination *" · "Choose destination" · "Transfer date *" · "Reason / storage note" · "For example: return to factory storage" · "Cancel" · "Save transfer"
- "STOCK ALLOCATION" · "Remove sequence" · "Remove this deal link and make the unit Available. The original Cognito deal returns to Outstanding Deals." · "Remove the deal link. This unit will remain Reserved by Xero invoice INV-002; it cannot become Available until the invoice reservation is resolved." · "Reason *" · "For example: use existing branch stock" · "Remove sequence · make Available" · "Remove sequence (keep Reserved)"
- (code) "Assign sequence number" · "Assign sequence" · "Deal year *" · "Sequence number *" · "Find deal" · "Save allocation" · "You cannot transfer this unit. Refresh stock or ask Gerald." · "You cannot allocate this unit. Refresh stock or ask Gerald."

**Outstanding deals**
- "DEALS AWAITING DISPATCH" · "Outstanding deals" · "Track which deal numbers still need a unit sent to each branch." · "Live Cognito deals" · "Sample deals"
- "Only LIVE deliveries from Cognito appear here. Completed shared dispatches and Gerald’s dismissals leave the outstanding list. Reconcile older deals before relying on totals." · "These are illustrative deals, separate from the live pilot."
- "View access · Only Gerald can dismiss or restore deals." · (code) "Signed in as super user · Only you can dismiss or restore deals." · "Could not check access." · "Dismissal service unavailable." · "<error> Dismiss actions are disabled; any previously loaded list may be out of date." · "Refresh dismissals"
- "Outstanding live deals" · "Load shared stock first" · "All branches" · "Awaiting dispatch · 2026" · "Awaiting factory dispatch" · "Created deals stay here until linked to a completed dispatch."
- "Search deal number, model or quote…" · "Show dismissed"
- Columns "YEAR / DEAL" "BRANCH" "MODEL" "QUOTE NUMBER" "STATUS"
- "Sample deal" · (code) "Cognito deal" · "Awaiting dispatch" · (code) "Needs review" "Dismissed" · "Dispatch →" · "PRINT" · (code) "Dismiss" "Restore"
- "3 outstanding sample deals" · "1 outstanding sample deal" · "0 dismissed sample deals" · "Live count unavailable" · "No outstanding sample deals match these filters." · "No dismissed sample deals match these filters." · "Live deals are not loaded. Refresh live stock after signing in." · "Dispatches without a deal number do not clear this list."
- Dismiss dialog: "SUPER USER ONLY" · "Dismiss deal" · "Reason *" · "Why is this deal being dismissed?" · "Cancel" · "Dismiss deal" · (code) "Restore deal" · "Why is this deal being restored?" · "Remove this deal from the outstanding list. Its dismissal history will be retained. You can restore it later." · "Return this deal to the outstanding list. This does not change dispatch or payment records."
- Print (code): "Allow pop-ups for this site, then select PRINT again." · "Loading trailer label…" · "Could not load trailer details." · "The Cognito deal is unavailable. Refresh the outstanding list." · "Workspace changed. Select PRINT again in the correct workspace." · "Label not printed: " · "Print label" · "90 mm wide · continuous thermal roll" · "SAMPLE · NOT A LIVE DEAL" · "TRAILER & EQUIPMENT DETAILS" · "Equipment not recorded" · "Not recorded" · "REVIEW REQUIRED: " · "DEAL NO" "YEAR" "BRANCH" "TRAILER / CAPACITY" "MODEL" "QUOTE NO" "PART / ITEM"

**Unit register**
- "EVERY UNIT, ONE RECORD" · "Unit register" · "Search current stock and sold history by VIN or sequence." · "↓ Export CSV" · "Search VIN, sequence, model or invoice…" · "All locations" · "All statuses" · "Clear"
- Columns "VIN / SEQUENCE" "MODEL" "LOCATION" "STATUS" "INVOICE" · "Sequence 248" · "View →" · "No matching units." · "Live stock is not loaded."
- Popup: "UNIT RECORD · SAMPLE WORKSPACE" · (code) "SHARED LIVE STOCK" · "VIN" "Deal / sequence" "Location" "Status" "Invoice" "Dispatch date" "Accessories" "Notes" · "None" · "None recorded" · "Transfer unit" · "Remove sequence" · "Close" · "Illustrative sample unit; not actual company stock."
- (code) "GERALD · STOCK CORRECTION" · "Correct unit model" · "Correct model" · "Reason" · "Save correction" · "GERALD · REGISTER CORRECTION" · "Remove duplicate unit" · "Remove from register" · "Restore removed unit" · "Restore unit" · "Removed units leave stock counts and the active register. Their history is kept, and Gerald can restore them below the unit register." · "Save" · "Removed units" · "Recoverable duplicate records. Only Gerald can restore them."

**Factory dispatch**
- "FACTORY TO BRANCH" · "Dispatch a unit" · "Add a VIN, confirm the equipment and choose its destination." · "Unit details"
- "Without sequence number" · "Existing sequence number" · "Dispatch factory-built unit"
- "Deal year" · "Sequence number" · "e.g. 259" · "Find unit"
- "Factory-built unit *" · "Choose a factory unit" · "Deal year (optional)" · "Deal / sequence number (optional)" · "Leave the deal number blank for stock dispatch. Enter the full VIN before dispatching."
- "Model / part number *" · "Choose a model" · "VIN *" · "Enter the full VIN" · "Destination branch *" · "Choose a branch" · "Dispatch date *"
- "Fitted products & accessories" · "Ten optional lines. Record the equipment fitted to this individual unit." · "Product or accessory" · "Dispatch notes" · "Delivery or unit notes" · "VIN is checked against all records, including sold units." · "Complete dispatch →"
- "Sample deal 2026 / 259 · 2500D · Johannesburg. Add or confirm the VIN and destination." · "No matching sample deal for this year and number. Live Cognito lookup is not connected."
- "VIN already used — 2500D; sequence 259; Factory; Available. Open the existing record instead."
- (code) "Refresh shared stock before looking up a deal." · "Lookup failed." · "Imported Cognito deal · quote " · "Review fitted accessories below. Original quote lines may include notes." · "Quote note" · "Refresh shared stock before dispatching." · "Find and select the live deal first." · "Choose a factory-built unit first." · "Factory unit is no longer available. Refresh stock." · "Saving dispatch…" · "Dispatch service did not return a confirmation. Refresh live stock and check this VIN before retrying." · "Dispatch failed. Refresh before retrying." · "Dispatch saved." · "Dispatch saved to shared stock." · "Factory unit dispatched in sample workspace."

**Invoice review**
- "INVOICE TO STOCK" · "Invoice review" · "Test the agreed payment rules before connecting Xero." · "Live Xero feed" · "Sample simulator"
- "Live invoice exceptions" · "Missing VINs, conflicting links and payment reversals stay here for review." · "INVOICE" "VIN / REFERENCE" "REVIEW REQUIRED" · "No invoice exceptions loaded. Verify the live Xero feed is enabled."
- "Simulate an invoice update" · "This updates sample records only. One invoice covers one unit." · "Invoice number *" · "INV-0042" · "Invoice reference (VIN) *" · "Exact VIN from the reference field" · "Payment status" · "Unpaid / partly paid — Reserved" · "Fully paid — Sold" · "Apply test update"
- "Agreed stock rules" · "Match the reference" · "Use the VIN in the invoice reference to identify one stock record." · "Reserve while unpaid" · "The unit stays in branch counts, with a visible Reserved label." · "Remove when fully paid" · "Mark Sold and retain the invoice number and searchable history." · "Missing VINs, unknown VINs and conflicting invoice links must be reviewed. Cancellations and credits require an agreed handling rule before live integration."

**Pilot setup**
- "CONTROLLED ROLLOUT" · "Pilot setup" · "Load opening stock, assign staff branches and verify the live cycle." · "Choose Live pilot to manage opening stock and staff access." · "Only Gerald can administer the live pilot. Refresh shared stock after signing in." · (code) "Gerald · Live pilot administration. Staff sign-in must also be admitted through the private site’s sharing settings."
- "Opening stock check" · "Not confirmed." · "Compare all factory and branch VINs with the physical stock before confirming. This is a pilot until opening stock, live feeds and staff access are checked." · "Confirm opening stock has been checked" · (code) "Gerald has confirmed opening stock." · "Opening stock has not been confirmed. Availability counts remain pilot figures." · "Live records received: "
- "Opening stock import" · "CSV: vin, model, branch, date, dealYear, sequence, notes. VIN/model/branch are required. Add accessory1 through accessory10 if needed. Import up to 100 units at once." · "Opening stock must include units still physically held, even if invoiced. Matching live invoice feeds will apply Reserved or Sold. Use Factory for factory stock." · "Download CSV template" · "Opening stock CSV" · "Preview import" · "Import these units"
- "Email login accounts" · "Invite staff to the separate email-login portal. Only you can approve users; nobody can sign themselves up for stock access." · "Checking email login setup…" · "Staff work email" · "Assigned location" · "Allow stock changes at this location" · "Send invitation" · (code) "Email login is prepared but not activated. Authentication project, email sender and portal hosting still need to be configured." · "Disable login" · "Enable login" · "Login enabled" · "Login disabled" · "Account action failed."
- "Staff branch permissions" · "Everyone admitted to this private site can read all branches. Assign a branch here to permit changes. Factory staff can dispatch; branch staff can update units at their own branch. Only Gerald can transfer between branches, import or dismiss deals." · "This does not invite staff or grant access to the site. Add approved staff through the site's sharing settings separately." · "Staff sign-in email" · "Enable stock changes" · "Save staff permissions" · (code) "Changes enabled" · "No staff branch permissions assigned."
- Note the apostrophes: "private site’s" (curly) in the owner notice, but "site's" (straight) in the staff text.

**Connections**
- "COGNITO & XERO" · "Connections" · "Check Cognito and Xero deliveries to the live pilot." · "Refresh feed"
- "Live pilot ready" + "Live Cognito deliveries populate the Live pilot deal list. Live Xero deliveries reconcile shared stock by VIN. Test deliveries remain separate. Opening stock and staff access must be checked before rollout."
- "Make connection settings" · "Sign in as Gerald to check integration setup." · "Connection check unavailable." · "Import the prepared Make blueprint as an inactive copy. Test delivery first; keep the existing scenario running until the replacement is checked." · "Show setup credentials" · "Hide credentials" · "Copy these only into your private Make connection headers. Do not email them or include them in screenshots." · "Private site access token" · "Stock sync key"
- "<error> Previously loaded deliveries may be out of date."
- "Latest deliveries" · "Up to 200 source records. Test and live deliveries are stored separately." · columns "SOURCE / MODE" "DEAL OR INVOICE" "BRANCH / VIN" "RESULT" "RECEIVED" · "No feed loaded."
- (code) "No deliveries yet. Configure Make and send a test delivery." · "Unable to load feed." · "Receivers ready · Live deliveries reconcile the shared pilot register; test deliveries stay separate." · "Live feed · see stock / exceptions" · "Test feed · no stock changes" · "Deal received" · "Review required"

**Activity history**
- "A CLEAR RECORD" · "Activity history" · "Dispatches and invoice changes made in this review workspace." · "No changes yet. Your test dispatches and invoice updates will appear here." · "Load shared stock to view activity."
- "Dismissal history" · "Server records · Gerald, super user" · "Dismissed live/2026/818" · "No dismissal activity loaded."
- (code) "Xero sync" · "Staff update" · "Review user" · "Restored " · "Dispatched factory build <part> · <VIN> to <branch>"

---

## 10. Open questions (each needs a signed-in live session, or an action not allowed here)

1. Live overview with real data: are the four cards the same as in sample, and what are the real counts?
2. Do open factory builds (no VIN yet) count in "At factory", or only factory units that already have a VIN?
3. What status label does a build show in "DEAL / STATUS" (e.g. "In build")? Does "Start build" with quantity N create N separate records?
4. Who counts as "assigned factory staff"? Is it the Factory location in Staff branch permissions with "Enable stock changes" ticked?
5. Every live activity event type and its wording (transfers, allocations, corrections, removals, invoice changes, imports). Only the factory-build dispatch wording was visible.
6. What appears in the live dispatch "Find unit" result (quote lines, accessories pre-fill)?
7. The live CSV export file name (sample: `Stock_Review_Export.csv`), and whether live exports include removed units.
8. "Assign sequence" dialog in practice: its title, buttons and preview text for a unit with no sequence.
9. How Gerald-only controls look (Dismiss/Restore buttons in rows, Correct unit model, Remove from register, Removed units panel, owner Pilot setup sections, credentials reveal).
10. When "Record limit reached · updates disabled." triggers, i.e. the record limit.
11. Whether "+ Dispatch a unit" and the Dispatch page behave differently for View only users (disabled vs hidden).
12. PRINT label: the real layout and pop-up behaviour.
13. Email login portal: whether it has been activated since; the invitation flow and the separate portal site.
14. Payment reversals and credits: the rule is still marked "require an agreed handling rule".
15. The branch-cell drill-down sets Location + search but not Status, so Sold units of that model at that branch also appear (e.g. 2000S Durban shows "—" but 1 Sold unit in the register) [inferred]. Is that intended?
16. Should an expired sign-in show a friendly message instead of the raw "Unexpected token '<'…" error?

---

## 11. Screenshots (folder `screenshots/`)
Desktop = 1084×678 browser view; 390 = phone-width copy (section 0, note 6). VINs and invoice numbers are blurred where shown; no personal data appeared.

| File | Shows |
|---|---|
| 01-overview-live-signin-expired-desktop.png, 01-overview-live-desktop.png, 01-overview-live-390.png | Live, data not loaded |
| 01-overview-sample-desktop.png, 01-overview-sample-390-top.png, 01-overview-sample-390-table.png | Sample overview |
| 01b-factory-build-dialog-sample-desktop.png / -from-factory-count- / -live-no-permission- / -sample-390 | Factory build dialog |
| 01c-overview-matrix-factory-column-sample-desktop.png | Factory column, amber dot, totals |
| 01d-transfer-unit-dialog-sample-desktop.png | Transfer unit dialog |
| 01e-remove-sequence-dialog-sample-desktop.png | Remove sequence dialog |
| 01f-refresh-live-stock-in-sample-toast-desktop.png | Refresh live stock pressed in sample |
| 02-outstanding-{sample,live}-{desktop,390}.png | Outstanding deals |
| 03-unit-register-{sample,live}-desktop.png, 03-unit-register-sample-390.png, 03b-unit-detail-reserved-sample-desktop.png | Unit register and detail popup |
| 04-dispatch-live-desktop.png, 04-dispatch-existing-sequence-sample-desktop.png, 04b-dispatch-from-outstanding-deal-sample-desktop.png, 04c-dispatch-factory-built-unit-sample-desktop.png, 04-dispatch-sample-390.png | Factory dispatch |
| 05-invoice-review-{sample,live}-desktop.png, 05-invoice-review-sample-390.png | Invoice review |
| 06-pilot-setup-{sample,live}-desktop.png, 06-pilot-setup-sample-390.png | Pilot setup (locked) |
| 07-connections-{sample,live}-desktop.png, 07-connections-sample-390.png | Connections |
| 08-activity-history-{sample,live}-desktop.png, 08-activity-history-sample-390.png | Activity history |
