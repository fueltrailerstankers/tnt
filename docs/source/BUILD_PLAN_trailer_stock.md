# Trailers & Tankers — Stock Control
## Full rebuild plan for Claude Code (Next.js + Supabase + Vercel)

> Reverse-engineered on 28 Oct 2026 from the live review build at `trailers-tankers-stock.geraldbez.chatgpt.site` ("Review version 4").
> Everything marked **[observed]** was seen working in the UI. Everything marked **[inferred]** is a sensible design decision for the production version where the review build is silent or stubbed.
>
> Drop this file into the repo root as `BUILD_PLAN.md` and work through the phases in §10 with Claude Code, one phase per session.

---

## 1. What the app is

A stock-control system for **Trailers and Tankers (Pty) Ltd**, a South African manufacturer of trailers, bowsers and tanks. Units are built at a **Factory** and dispatched to three **branches** (Johannesburg, Cape Town, Durban). Every unit is tracked individually by **VIN**.

Three external signals drive stock:

| Source | What it sends | Effect on stock |
|---|---|---|
| **Cognito Forms** (sales/deal form) | A new deal: year, deal number, branch, model, quote number, accessories | Creates an *outstanding deal* awaiting factory dispatch |
| **Factory dispatch** (in-app form) | VIN + model + branch + accessories, optionally linked to a deal | Creates the unit record at a branch; clears the deal |
| **Xero** invoices (via Make.com or Xero webhooks) | Invoice number, reference = VIN, payment status | Unpaid/partly paid → **Reserved**; fully paid → **Sold** |

The current build is a static front end (`index.html`, `app.js`, `models.js`, `style.css`) that keeps stock in `localStorage` (key `tt-stock-review-v1`), plus a small server with three endpoints (`/api/dismissals`, `/api/integration-feed`, `/api/integration-setup`). The rebuild moves everything to Supabase.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript, Server Actions) |
| UI | Tailwind CSS + shadcn/ui (Dialog, Select, Table, Toast/Sonner, Checkbox, RadioGroup) |
| DB / Auth | Supabase (Postgres, Auth with email magic link or password, RLS) |
| Validation | Zod (shared between server actions and webhooks) |
| Data fetching | Server Components + Server Actions; `@supabase/ssr` |
| CSV | `papaparse` (unparse) or a hand-rolled serializer |
| Hosting | Vercel (Production + Preview), env vars per environment |
| Integrations | Next.js Route Handlers as webhook receivers (`/api/webhooks/cognito`, `/api/webhooks/xero`) |
| Tests | Vitest (rules), Playwright (flows) |

---

## 3. Design system [observed]

- **Layout:** fixed left sidebar (~195px, dark teal `#122E32`), main column on `--bg #F5F7F6`, white cards with 1px `--line` border and ~12px radius.
- **Tokens:**
  ```css
  --ink:   #172C31;  /* headings/text */
  --muted: #738286;  /* secondary text */
  --teal:  #007F73;  /* primary buttons, eyebrow labels, active accents */
  --line:  #E1E8E7;  /* borders */
  --bg:    #F5F7F6;  /* page background */
  --sidebar: #122E32;
  --amber: (reserved badge/indicator) ~#F6E3C4 bg / #9A6A1F text
  --green-badge: ~#E3F1EC bg / #2F7D5B text (Available)
  --red-error: ~#FCE9E7 bg / #B3261E text
  ```
- **Font:** Arial / system sans. H1 32px, regular weight, tight letter spacing.
- **Page header pattern:** small uppercase teal eyebrow (e.g. `FACTORY TO BRANCH`), H1, one-line muted subtitle, primary action top-right.
- **Top bar:** breadcrumb `OPERATIONS / <Page>` + user initials avatar (e.g. `GB`).
- **Banner** (review mode only): pale green strip "Review version · Sample stock · Changes are saved in this browser only…". In production, replace with an environment banner only when `APP_MODE=staging`.
- **Sidebar:** logo tile "T&T" + "TRAILERS AND TANKERS"; section label `OPERATIONS`; nav items with glyph icons; footer: green dot "Review workspace" + "Trailers and Tankers (Pty) Ltd".
- **Footer:** `TRAILERS AND TANKERS` left, `Stock control · Review version 4` right.
- **Status badges:** Available (green), Reserved (amber), Sold (grey), Dismissed (grey), Awaiting dispatch (teal outline).
- **Toasts:** dark pill bottom-centre ("Dispatch saved…", "Fully paid: unit marked Sold.").
- **Modal:** "Unit record" detail sheet with label/value rows and a Close button.

---

## 4. Navigation / routes

| Sidebar item | Route | Purpose |
|---|---|---|
| Stock overview | `/` | KPIs + model × branch matrix |
| Outstanding deals | `/deals` | Deals awaiting factory dispatch |
| Unit register | `/units` | Search all units incl. sold history, CSV export, detail modal |
| Factory dispatch | `/dispatch` (supports `?year=&number=` prefill) | Create a unit / send to branch |
| Invoice review | `/invoices` | Manual/simulated invoice → stock update + exception queue |
| Connections | `/connections` | Integration setup + delivery feed (superuser only for credentials) |
| Activity history | `/activity` | Audit log + dismissal history |
| — | `/login` | Supabase auth |

---

## 5. Domain rules (the important part)

### 5.1 Units
- A unit = one physical item, unique by **VIN**.
- VIN normalisation **[inferred, required]**: `upper(trim(vin))`, strip internal spaces. Uniqueness is enforced on the normalised value.
- **VIN is checked against ALL records including Sold** [observed]. Duplicate error text:
  `VIN already used — {model}; sequence {seq}; {location}; {Status}. Open the existing record instead.`
- Fields: VIN, sequence (deal number), deal year, model, location (Factory / Johannesburg / Cape Town / Durban), status (`available | reserved | sold`), invoice number, dispatch date, up to **10 accessory lines**, notes.

### 5.2 Stock counting [observed]
- **Stock across branches** = units at a *branch* (not Factory) with status `available` or `reserved`. Sub-label "Includes N reserved".
- **Ready to sell** = branch units with status `available`.
- **Reserved** = units with status `reserved` ("Awaiting full payment").
- **At factory** = units at Factory not sold ("Not in branch quantities").
- **Sold units are excluded** from all counts but stay searchable in the register.
- **Stock by model** table: one row per model (description + part number), one column per branch + Total; cells show `—` for zero; an **amber indicator** on a cell when its count includes reserved units. Header chip "3 branches"; toggle "In stock only" hides zero rows; footer "N of 52 models".

### 5.3 Deals [observed]
- Identified by **(year, number)**, e.g. `2026 / 260`. Carry branch, model, quote number (e.g. `SAMPLE-Q-260`) and optional accessories (e.g. "Sample hose reel").
- Status: `awaiting_dispatch` → `dispatched` (when a dispatch is completed against its year+number) or `dismissed`.
- **A deal clears only when a dispatch is completed against its year and number.** Dispatches without a deal number never clear the list.
- **Payment status is tracked separately** from deals (deals ≠ invoices).
- **Dismiss / restore** is **superuser-only** ("Only Gerald can dismiss or restore deals"). Dismiss requires a reason (observed reason: "SENT 26/03"). Every dismiss/restore writes an audit row.
- Page KPIs: outstanding counts for All branches + each branch, for the selected year ("Awaiting dispatch · 2026").
- Filters: year (2026, 2025…), branch, "Show dismissed" (when ticked, the table shows **only** dismissed deals).
- Row action: **Dispatch →** opens `/dispatch?year=2026&number=260` in "existing sequence" mode, pre-filled.

### 5.4 Factory dispatch [observed]
Two modes (radio):
1. **Without sequence number** — free dispatch: model, VIN, destination branch, dispatch date (defaults to today), 10 accessory lines, notes.
2. **Existing sequence number** — Deal year (default current year) + Sequence number + **Find unit** button. Outcomes:
   - Found & outstanding → message `Sample deal 2026 / 260 · 1000DB · Cape Town. Add or confirm the VIN and destination.` and pre-fill model, branch, accessories.
   - Found but dismissed → `This deal has been dismissed. Only Gerald can restore it before dispatch.` and block submit.
   - Not found → `No matching deal for this year and number.` (live version: query the Cognito-fed `deals` table).
   - **[inferred, add]** Already dispatched → block: `Deal 2026/260 was already dispatched with VIN X.` (the review build did not block this).

Required fields: model, VIN, destination branch, dispatch date. Footer note: "VIN is checked against all records, including sold units."

On **Complete dispatch →**:
1. Validate (Zod) + VIN uniqueness.
2. Insert unit: `status=available`, `location=branch`, `sequence=deal number` (null in free mode), accessories (non-empty lines only), notes, `dispatched_by`.
3. If linked to a deal → set deal `status=dispatched`, `unit_id`, `dispatched_at`.
4. Write activity row: `Dispatched {model} · {VIN} to {branch} · deal {year}/{number}`.
5. Toast "Dispatch saved." and redirect to `/units?q={VIN}`.

**[inferred, add]** If the VIN already exists *at Factory* and is not sold, offer "Move this factory unit to {branch}" instead of the duplicate error (the sample had a 2500D at Factory, which implies factory stock can be pre-registered).

### 5.5 Invoice → stock rules [observed]
"One invoice covers one unit."
1. **Match the reference** — the invoice reference contains the VIN; normalise and look up one unit.
2. **Reserve while unpaid** — unpaid / partly paid → `status=reserved`, store invoice number. The unit stays in branch counts with an amber Reserved label.
3. **Remove when fully paid** — fully paid → `status=sold`, keep the invoice number, `sold_at=now()`; remains searchable.

Errors (no change made):
- `VIN not found. No stock record has been changed.`
- `This unit is linked to another invoice. Review the conflict before proceeding.` (unit already has a *different* invoice number)
- **[inferred]** Invoice number already linked to a different VIN → conflict.
- **[inferred]** Missing VIN in reference → exception.
- Cancellations, voids and credit notes → **exception queue, no automatic change** ("require an agreed handling rule before live integration").

Activity row: `{VIN} marked Sold · {invoice}` / `{VIN} reserved · {invoice}`.

### 5.6 Integrations / Connections [observed]
- Receivers **store** delivered Cognito deals and Xero invoice updates in a feed table. In the **setup stage they do not change the stock register**; a global switch moves to live processing.
- Deliveries have a **mode: test | live**, stored separately. The feed shows the latest **200** records: Source/Mode, Deal or Invoice, Branch/VIN, Result, Received.
- "Make connection settings" + "Show setup credentials" (webhook URLs + shared secret) are **superuser-only** (API returns 403 for others).
- Copy on page: "Import the prepared Make blueprint as an inactive copy. Test delivery first; keep the existing scenario running until the replacement is checked."
- "Refresh feed" re-fetches.

### 5.7 Roles [observed + inferred]
| Role | Can |
|---|---|
| `superuser` (Gerald) | Everything + dismiss/restore deals, view integration credentials, toggle integration live mode, manage users |
| `admin` | Dispatch, invoice review, export, view connections feed |
| `dispatcher` (factory) | Dispatch, view register/stock/deals |
| `branch` | Read-only stock & register (optionally scoped to own branch) |

---

## 6. Database schema (Supabase migration `0001_init.sql`)

```sql
-- Enums
create type unit_status as enum ('available','reserved','sold');
create type deal_status as enum ('awaiting_dispatch','dispatched','dismissed');
create type app_role as enum ('superuser','admin','dispatcher','branch');
create type delivery_source as enum ('cognito','xero');
create type delivery_mode as enum ('test','live');

-- Locations
create table locations (
  id text primary key,                 -- 'FACTORY','JHB','CPT','DBN'
  name text not null,
  is_factory boolean not null default false,
  sort_order int not null default 0
);
insert into locations values
 ('FACTORY','Factory',true,0),('JHB','Johannesburg',false,1),
 ('CPT','Cape Town',false,2),('DBN','Durban',false,3);

-- Product models
create table models (
  part_number text primary key,
  description text not null,
  category text not null,              -- animal_trailer, car_trailer, metal_bowser, poly_bowser, stainless_bowser, cradle_tank, skid_tank, cargo_trailer, vendor_box
  active boolean not null default true,
  sort_order int not null
);

-- Users
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null,
  initials text generated always as (upper(left(split_part(full_name,' ',1),1) || left(split_part(full_name,' ',2),1))) stored,
  role app_role not null default 'branch',
  location_id text references locations
);

-- Deals (fed by Cognito)
create table deals (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  number int not null,
  location_id text not null references locations,
  model text references models(part_number),
  quote_number text,
  customer_name text,
  accessories text[] not null default '{}',
  status deal_status not null default 'awaiting_dispatch',
  unit_id uuid,
  dispatched_at timestamptz,
  source_delivery_id uuid,
  created_at timestamptz not null default now(),
  unique (year, number)
);

-- Units
create table units (
  id uuid primary key default gen_random_uuid(),
  vin text not null,
  vin_norm text generated always as (upper(regexp_replace(vin,'\s','','g'))) stored unique,
  deal_year int,
  sequence int,
  model text not null references models(part_number),
  location_id text not null references locations,
  status unit_status not null default 'available',
  invoice_number text,
  dispatch_date date,
  accessories text[] not null default '{}' check (cardinality(accessories) <= 10),
  notes text,
  sold_at timestamptz,
  dispatched_by uuid references profiles,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index units_invoice_unique on units(invoice_number) where invoice_number is not null;
alter table deals add constraint deals_unit_fk foreign key (unit_id) references units(id);

-- Dismissal audit
create table deal_audit (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals on delete cascade,
  action text not null check (action in ('dismiss','restore')),
  reason text,
  actor uuid references profiles,
  at timestamptz not null default now()
);

-- Activity log
create table activity (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid references profiles,
  kind text not null,            -- dispatch | invoice | deal_dismiss | deal_restore | integration
  text text not null,
  unit_id uuid references units,
  deal_id uuid references deals,
  payload jsonb
);

-- Integration feed
create table integration_deliveries (
  id uuid primary key default gen_random_uuid(),
  source delivery_source not null,
  mode delivery_mode not null,
  external_ref text,             -- deal "2026/260" or invoice number
  branch_or_vin text,
  result text not null default 'stored',   -- stored | applied | vin_not_found | conflict | exception | duplicate | invalid
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index on integration_deliveries (received_at desc);

-- Exceptions queue (invoice problems needing a human)
create table invoice_exceptions (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid references integration_deliveries,
  invoice_number text,
  reference text,
  reason text not null,
  resolved_at timestamptz,
  resolved_by uuid references profiles
);

-- Settings (singleton)
create table app_settings (
  id int primary key default 1 check (id = 1),
  integration_live boolean not null default false,   -- false = setup stage: store only
  webhook_secret text not null default encode(gen_random_bytes(24),'hex')
);
insert into app_settings default values;

-- Stock view used by overview
create view stock_matrix as
select m.part_number, m.description, m.sort_order, u.location_id,
       count(*) filter (where u.status in ('available','reserved')) as qty,
       count(*) filter (where u.status = 'reserved') as reserved
from models m
left join units u on u.model = m.part_number and u.status <> 'sold'
group by 1,2,3,4;
```

### 6.1 Core logic as Postgres functions (atomic, callable via `supabase.rpc`)

- `dispatch_unit(p_vin, p_model, p_location, p_date, p_accessories text[], p_notes, p_deal_year int default null, p_deal_number int default null) returns units`
  - Raises `VIN_EXISTS` with the existing unit's details if `vin_norm` matches.
  - If deal given: lock deal `for update`; raise `DEAL_NOT_FOUND`, `DEAL_DISMISSED`, `DEAL_ALREADY_DISPATCHED` as appropriate.
  - Insert unit, update deal, insert activity — all in one transaction.
- `apply_invoice(p_invoice text, p_reference text, p_paid boolean, p_actor uuid) returns jsonb`
  - Extract VIN from reference (normalise; if reference contains other text, regex match against known VINs).
  - Errors: `VIN_NOT_FOUND`, `UNIT_LINKED_OTHER_INVOICE`, `INVOICE_LINKED_OTHER_UNIT`.
  - unpaid → reserved; paid → sold + `sold_at`. Activity row.
- `dismiss_deal(p_deal_id, p_reason)` / `restore_deal(p_deal_id)` — check `role = 'superuser'` inside the function (`security definer`), write `deal_audit` + `activity`.

### 6.2 RLS
- Enable RLS on every table. `select` for any authenticated profile.
- `units`/`deals` writes only through the RPCs above (`security definer`, role-checked). No direct insert/update policies for clients.
- `app_settings.webhook_secret`, `integration_deliveries.payload`: select only where `role = 'superuser'` (expose a sanitized view for admins).
- Webhook route handlers use the **service role key** server-side only.

### 6.3 Seed (`supabase/seed.sql`)
All 52 models in this order (part number — description):

```
CTLL1  — 3 meter animal trailer NO BRAKES 750 KGS GWM
CTLL2  — 3 meter animal trailer SINGEL BRAKE 1500KG GWM
CTLL3  — 4 meter animal trailer SINGEL BRAKE 1500 KG GWM
CTLL3D — 4 meter animal trailer TWIN BRAKE 3000 KG GWM
CTTL4D — 5 meter animal trailer TWIN BRAKE 3000 KG GWM
CT1    — 4 meter car trailer SINGEL BRAKE 1500 GWM
CT2    — 5 meter car trailer SINGEL BRAKE 1500 KG GWM
CT3    — 5 meter car trailer TWIN BRAKE 3000 KG GWM
500D   — 500 litre metal bowser
1000D  — 1000 litre metal bowser
1000DB — 1000 litre metal bowser
2000D  — 2000 litre metal bowser
2500D  — 2500 litre metal bowser
3000D  — 3000 litre metal bowser
5000D  — 5000 litre metal bowser
500P   — 500 litre polyurethane bowser
1000PB — 1000 litre polyurethane bowser
1000P  — 1000 litre polyurethane bowser
2500P  — 2500 litre polyurethane bowser
500S   — 500 litre stainless bowser MADE FROM 3CR12
1000SB — 1000 litre stainless bowser MADE FROM 3CR12
2000S  — 2000 litre stainless steel bowser MADE FROM 3CR12
2500S  — 2500 litre stainless bowser MADE FROM 3CR12
3000S  — 3000 litre stainless bowser MADE FROM 3CR12
TS1    — 1000 LITER TANK ON LOOSE CRADEL STAND
TS2    — 2000 LITER TANK ON LOOSE CRADEL STAND
TS25   — 2500 LITER TANK ON LOOSE CRADEL STAND
TS3    — 3000 LITER TANK ON LOOSE CRADEL STAND
TS5    — 5000 LITER TANK ON LOOSE CRADEL STAND
SK5P   — 500 LITER PLASTIC TANK ON METAL SKID BASE
SK1P   — 1000 LITER PLASTIC TANK ON METAL SKID BASE
SK25P  — 2500 LITER PLASTIC TANK ON METAL SKID BASE
SK1    — 500 LITER TANK ON SKID
SK2    — 1000 LITER TANK ON SKID
SK3    — 2000 LITER TANK ON SKID
SK4    — 2500 LITER TANK ON SKID
SK5    — 3000 LITER TANK ON SKID
SK6    — 5000 LITER TANK ON SKID
C200   — 2 meter cargo trailer
C30075 — 3 meter cargo trailer
C30015 — 3 meter cargo trailer
C400   — 4 meter cargo trailer
C400D  — 4 meter cargo trailer double axel
C300D  — 3 meter cargo trailer Dubbel axel
FTE    — VENDOR TRAILER
BOX01  — 2, 4 METER BOX
BOX02  — 3 METER BOX
BOX04  — 4 METER BOX
BOX07  — ISOLATED VENDOR TRAILER
BOX08  — 2 METER ISOLATED VENDOR TRAILER
BOX09  — 3 METER ISOLATED VENDOR TRAILER
BOX10  — 4 METER ISOLATED VENDOR TRAILER
```
(Keep the client's spelling — "SINGEL", "CRADEL", "Dubbel axel" — so they match Cognito/Xero text. Add a "clean description" column later if wanted.)

Demo data (dev/preview only): 12 units `DEMO0000000000001…012`, sequences 248–259 (3000D ×4, 1000D ×2, 5000D, CTLL1, C400D, SK1P, 2000S sold on `DEMO-INV-001`, 2500D at Factory; #002 reserved on `DEMO-INV-002`), deals 2026/259 (JHB, 2500D, dismissed "SENT 26/03"), 2026/260 (CPT, 1000DB, accessory "Sample hose reel"), 2026/261 (DBN, 3000D).

---

## 7. Screens — detailed specs

### 7.1 Stock overview `/`
- Eyebrow `YOUR NETWORK, AT A GLANCE`, H1 "Stock overview", subtitle "Find the right unit. See every branch.", button **+ Dispatch a unit** → `/dispatch`.
- 4 KPI cards (2×2): Stock across branches / Ready to sell / Reserved / At factory with sub-labels (§5.2) and small icon tiles.
- Card "Stock by model" — subtitle "Branch counts include reserved units. Fully paid units are excluded."; chip "3 branches"; checkbox "In stock only"; table columns MODEL / PART NUMBER · JOHANNESBURG · CAPE TOWN · DURBAN · TOTAL; footer "N of 52 models · Amber indicator = reserved units included". Clicking a number → `/units?model=X&location=Y` **[inferred]**.

### 7.2 Outstanding deals `/deals`
- Eyebrow `DEALS AWAITING DISPATCH`; status chip showing integration state ("Cognito connected · live" / "Sample deals · Cognito not connected").
- Info callout: "A deal clears only when dispatch is completed against its year and number. Payment status is tracked separately."
- Permission line: "View access · Only {superuser name} can dismiss or restore deals." (superuser sees "Super user access" instead) + **Refresh dismissals** button.
- 4 KPI cards: All branches / JHB / CPT / DBN — "Awaiting dispatch · {year}".
- Table card "Awaiting factory dispatch" — "Created deals stay here until linked to a completed dispatch." Filters: Show dismissed (checkbox), Year select, Branch select. Columns: YEAR / DEAL (with sub-label), BRANCH, MODEL, QUOTE NUMBER, STATUS, action.
  - Awaiting rows: **Dispatch →**; superuser also gets **Dismiss** (dialog with required reason).
  - Dismissed rows: grey "Dismissed" + reason ("SENT 26/03"); superuser gets **Restore**.
- Footer: "{n} outstanding deals · Dispatches without a deal number do not clear this list."

### 7.3 Unit register `/units`
- Eyebrow `EVERY UNIT, ONE RECORD`, subtitle "Search current stock and sold history by VIN or sequence.", button **↓ Export CSV** (exports the current filtered set: VIN, Deal year, Sequence, Model, Description, Location, Status, Invoice, Dispatch date, Accessories (`; `-joined), Notes).
- Search box "Search VIN, sequence, model or invoice…" (debounced, URL-synced `?q=`), Location select (All / Factory / branches), Status select (All / Available / Reserved / Sold), **Clear**.
- Columns: VIN / SEQUENCE (VIN bold + "Sequence 248"), MODEL, LOCATION, STATUS badge, INVOICE (`—` if none), **View →**.
- View modal "UNIT RECORD": model as title, description, VIN, Deal / sequence (`2026 / 249`), Location, Status, Invoice, Dispatch date, Accessories ("None recorded" if empty), Notes; Close. **[inferred]** Admins get "Correct record" (edit with audit) and "Transfer branch".
- Pagination (50/page) server-side.

### 7.4 Factory dispatch `/dispatch`
- Eyebrow `FACTORY TO BRANCH`, H1 "Dispatch a unit", subtitle "Add a VIN, confirm the equipment and choose its destination."
- Card "Unit details": mode radio (Without sequence number / Existing sequence number); in existing mode: Deal year (number), Sequence number ("e.g. 259"), **Find unit**, result message line.
- Grid: Model / part number* (select "PART — description"), VIN* ("Enter the full VIN"), Destination branch* ("Choose a branch"), Dispatch date* (default today).
- Inline VIN error under fields (red callout) — also run a debounced uniqueness check on blur **[inferred]**.
- "Fitted products & accessories — Ten optional lines. Record the equipment fitted to this individual unit." — 2-column grid of 10 inputs numbered 01–10, placeholder "Product or accessory".
- "Dispatch notes" textarea ("Delivery or unit notes").
- Footer: "VIN is checked against all records, including sold units." + **Complete dispatch →**.
- Use react-hook-form + Zod; server action calls `dispatch_unit` RPC; map RPC errors to the exact messages in §5.4.

### 7.5 Invoice review `/invoices`
- Eyebrow `INVOICE TO STOCK`, subtitle "Apply the agreed payment rules"; status chip "Xero connected/not connected".
- Card "Manual invoice update" (was "Simulate an invoice update"): Invoice number* (placeholder `INV-0042`), Invoice reference (VIN)*, Payment status select (Unpaid / partly paid — Reserved | Fully paid — Sold), **Apply update**. Inline error/success; toast "Fully paid: unit marked Sold." / "Unpaid: unit reserved."
- Card "Agreed stock rules" — numbered 1–3 (§5.5) + warning about missing/unknown/conflicting VINs and cancellations/credits.
- **[inferred, add]** Card "Exceptions to review" listing `invoice_exceptions` with Resolve action.

### 7.6 Connections `/connections`
- Eyebrow `COGNITO & XERO`, subtitle "Check deliveries before enabling shared live stock.", **Refresh feed**.
- Stage callout: "Setup stage — Receivers store delivered deals and invoice updates. They do not yet change the stock register." (or "Live — deliveries update stock" when `integration_live`).
- Card "Make connection settings": connection check (last delivery per source/mode), guidance text, **Show setup credentials** (superuser: webhook URLs for cognito/xero × test/live + shared secret, copy buttons, "Rotate secret"; others: "Only {superuser} can view connection setup."). Superuser toggle "Go live".
- Card "Latest deliveries — Up to 200 source records. Test and live deliveries are stored separately." Table: SOURCE / MODE, DEAL OR INVOICE, BRANCH / VIN, RESULT, RECEIVED. Empty state "No feed loaded." Optional filter by source/mode; row click → JSON payload drawer (superuser).

### 7.7 Activity history `/activity`
- Eyebrow `A CLEAR RECORD`, subtitle "Dispatches and invoice changes."
- Feed list: text line + `YYYY/MM/DD, HH:mm:ss · {user}`. Empty state "No changes yet…".
- Card "Dismissal history — Server records · {superuser}, super user": `Dismissed 2026/259`, reason, timestamp.
- Filters by kind and date range **[inferred]**.

---

## 8. API / webhooks

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/webhooks/cognito?mode=test\|live` | POST | `x-webhook-secret` header = `app_settings.webhook_secret` | Store delivery; if live: upsert deal by (year, number) |
| `/api/webhooks/xero?mode=test\|live` | POST | same (or Xero's HMAC `x-xero-signature` if direct) | Store delivery; if live: call `apply_invoice` per invoice; failures → `invoice_exceptions` |
| `/api/integration-feed` | GET | admin+ | Last 200 deliveries (sanitized for non-superusers) |
| `/api/integration-setup` | POST | superuser (else 403) | Return webhook URLs/secret, rotate secret, toggle live |
| `/api/dismissals` | GET | authenticated | `{ isSuperuser, dismissals[{year,number,reason,dismissedAt}], audit[{dealKey,action,reason,at}] }` (kept for parity) |
| `/api/units/export` | GET | admin+ | CSV stream of filtered register |

**Cognito payload mapping [inferred — confirm against the real form]:** `Year`, `DealNumber`, `Branch` (map name → location id), `PartNumber`, `QuoteNumber`, `CustomerName`, `Accessories[]` (up to 10). Idempotent on (year, number); duplicates → result `duplicate`.

**Xero payload mapping:** `InvoiceNumber`, `Reference` (contains VIN), `Status` (`AUTHORISED` + `AmountDue>0` → unpaid; `PAID` → paid; `VOIDED`/`DELETED`/credit notes → exception), `AmountDue`, `AmountPaid`. Via Make: Xero "Watch invoices" → HTTP POST to the receiver. Direct alternative: Xero webhooks (they only send event IDs; fetch the invoice via Xero API with OAuth2 — more work, so keep Make for v1).

Every receiver: verify secret → Zod-validate → insert `integration_deliveries` → if `integration_live` and mode=live, process inside a transaction → update `result`/`processed_at` → 200 quickly.

---

## 9. Project structure

```
app/
  (auth)/login/page.tsx
  (app)/layout.tsx              # sidebar + topbar + env banner
  (app)/page.tsx                # stock overview
  (app)/deals/page.tsx
  (app)/units/page.tsx
  (app)/dispatch/page.tsx
  (app)/invoices/page.tsx
  (app)/connections/page.tsx
  (app)/activity/page.tsx
  api/webhooks/cognito/route.ts
  api/webhooks/xero/route.ts
  api/integration-feed/route.ts
  api/integration-setup/route.ts
  api/dismissals/route.ts
  api/units/export/route.ts
components/  (Sidebar, Topbar, PageHeader, KpiCard, StatusBadge, StockMatrix, DealsTable, UnitTable, UnitModal, DispatchForm, InvoiceForm, DeliveriesTable, ActivityFeed)
lib/
  supabase/{server,client,admin}.ts
  rules/{vin.ts, invoice.ts, stock.ts}   # pure functions, unit-tested
  schemas.ts                             # Zod
  actions/{dispatch.ts, invoice.ts, deals.ts}
supabase/
  migrations/0001_init.sql
  migrations/0002_functions.sql
  migrations/0003_rls.sql
  seed.sql
tests/ (vitest + playwright)
middleware.ts                            # auth guard
```

---

## 10. Build phases — paste these to Claude Code one at a time

**Phase 0 — Scaffold**
> Read BUILD_PLAN.md. Scaffold a Next.js 15 App Router TypeScript app with Tailwind and shadcn/ui, `@supabase/ssr`, zod, react-hook-form, sonner. Add the design tokens from §3 to Tailwind config and globals.css. Build the app shell (sidebar with the 7 nav items, topbar breadcrumb + initials avatar, footer, optional env banner) exactly per §3–4. Stub each page with its header.

**Phase 1 — Database**
> Create `supabase/migrations` from §6 (tables, enums, view), §6.1 (RPC functions with the exact error codes) and §6.2 (RLS). Create `seed.sql` with locations, the 52 models in order, and the demo data. Generate TS types. Write `lib/rules` pure functions + Vitest tests for VIN normalisation, stock KPI maths and invoice rule outcomes.

**Phase 2 — Auth & roles**
> Supabase email auth, `/login`, middleware guard, `profiles` row on signup (trigger), role helper `requireRole()`. Hide superuser-only controls in UI and enforce in RPC/route handlers.

**Phase 3 — Stock overview + Unit register**
> Build §7.1 and §7.3 with server components, URL-synced filters, the View modal, and CSV export route.

**Phase 4 — Factory dispatch**
> Build §7.4. Both modes, Find unit lookup with all four outcomes, `?year=&number=` prefill, 10 accessory lines, server action → `dispatch_unit` RPC, exact error copy, toast, redirect to `/units?q=VIN`.

**Phase 5 — Outstanding deals**
> Build §7.2 with KPIs, filters, show-dismissed behaviour, superuser Dismiss (reason dialog) / Restore, audit rows, and `/api/dismissals`.

**Phase 6 — Invoice review**
> Build §7.5 using `apply_invoice` RPC, exact messages, exceptions card with resolve.

**Phase 7 — Integrations**
> Build webhook receivers (§8), `integration_deliveries`, `/connections` page (§7.6), superuser credentials panel, live/setup toggle, test vs live separation, 200-row feed. Add a `scripts/send-test-delivery.ts` that posts sample Cognito and Xero payloads.

**Phase 8 — Activity history + polish**
> Build §7.7. Add loading skeletons, empty states, mobile layout (sidebar collapses to a drawer < 900px), keyboard focus states, Playwright tests for: duplicate VIN blocked (incl. sold), dispatch clears deal, dismissed deal blocks dispatch, unpaid → reserved stays in counts, paid → sold leaves counts but stays searchable, conflicting invoice rejected, non-superuser gets 403 on integration-setup.

**Phase 9 — Deploy**
> See §11.

---

## 11. Deploy (Supabase + Vercel)

1. `supabase init` → `supabase link --project-ref <ref>` → `supabase db push` → run `seed.sql` (models + locations only in prod; demo data only in a separate staging project/branch).
2. Supabase Auth: set Site URL + redirect URLs to the Vercel domains; disable public sign-ups and invite staff instead.
3. Create the first user, then `update profiles set role='superuser' where id=…`.
4. Vercel: import GitHub repo → env vars:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (all envs)
   - `SUPABASE_SERVICE_ROLE_KEY` (server only)
   - `APP_MODE=staging|production`, `NEXT_PUBLIC_APP_URL`
5. Preview deployments → point at a Supabase branch/staging project.
6. Make.com: import the Cognito and Xero scenarios as **inactive copies**, set the HTTP module to `https://<domain>/api/webhooks/{cognito|xero}?mode=test` with header `x-webhook-secret`. Fire test deliveries, check `/connections`, then switch to `mode=live` and turn on `integration_live`. Keep the old scenario running until the new one is verified.
7. Backfill: import current stock spreadsheet → `units` via a one-off script (validate VIN uniqueness first) and current outstanding Cognito deals → `deals`.

---

## 12. Open questions for the client (flagged in the review build)

1. Cancellations, voids and credit notes in Xero — what should happen to a Reserved/Sold unit?
2. Partly paid → currently Reserved; confirm no deposit threshold.
3. Branch-to-branch transfers and returns to factory — needed in v1?
4. Should branch users see only their own branch?
5. Exact Cognito form field names and how deal numbers/years are allocated.
6. Should a deal be dispatchable twice (e.g. 2 units on one deal)? Current rule: one deal = one unit.
7. Is factory stock pre-registered with VINs before a deal exists (the "At factory" KPI suggests yes)?
