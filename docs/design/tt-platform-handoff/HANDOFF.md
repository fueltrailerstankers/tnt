# Trailers & Tankers Platform — UI build brief for Claude Code

Internal operations portal for Trailers & Tankers (fueltrailers.co.za). It replaces Cognito Forms and the Make.com automations. **Xero stays the accounting book of record**: the portal mirrors quotes and invoices, never creates quotes, and only writes to Xero through the five gated write actions below.

This folder is the design handoff. Build the UI to match it.

- `styles/tokens.css` — colour, radius, shadow and type tokens (light + dark). Use these variables; do not hard-code hex values in components.
- `styles/tailwind.tokens.ts` — Tailwind `theme.extend` mapping and the status → tone map.
- `design/*.dc.html` — the approved screens. Each is a self-contained HTML mock with its sample data and interaction logic in the `<script type="text/x-dc">` block at the bottom. Open them for exact spacing, copy, states and behaviour. They are **reference, not production code** — rebuild them as React components.
- Live canvas (clickable prototype): https://claude.ai/code/artifact/0fcd40ef-da3b-4bd4-ba63-92ca3e272f42

> If the repo already has a stack, keep it and apply this design. Otherwise use: Next.js (App Router) + TypeScript + Tailwind + shadcn/ui + TanStack Table + react-hook-form/zod + lucide-react icons.

---

## 1. Visual system (must match)

| Thing | Rule |
|---|---|
| Fonts | Manrope (UI), JetBrains Mono for VINs, quote/invoice numbers, amounts, hashes, IDs |
| Accent | Signal orange `--accent #F47B20`. **Text on orange is `--onaccent #17181A` (near-black)**, not white — white fails WCAG AA. Orange as text uses `--accenttext #B4500C`. |
| Sidebar & public headers | Charcoal `--side #1C1D21`, white text, active item `--sideactive`, orange logo tile |
| Shape | Buttons, chips, tabs, segmented controls = pill (999px). Inputs 10px. Cards/tables 12px. Modals/drawers 16px. |
| Elevation | Cards: 1px `--border` + `--cardshadow`. Overlays: `--shadow` on `--overlay` scrim. No gradients, no left-border accent cards, no emoji. |
| Status | Chip = dot + label + tone. Tones: gray, teal, yellow, green, red (see `STATUS_TONE`). Never colour alone. |
| Money | Portal values display in **USD**. Anything sourced from Xero shows in **ZAR with a `ZAR` badge** (optionally "≈ USD" muted underneath). |
| Time | Always Africa/Johannesburg, shown with "SAST". |
| Density | Desktop table rows 40–44px. Phone/inspector/customer targets ≥ 44px (primary buttons 48–52px), single column, 16px inputs (no iOS zoom). |
| Dark mode | Theme toggle in top bar sets `data-theme` on `<html>`; default follows OS. Every screen must work in both. |
| A11y | WCAG AA contrast; real `<button>`/`<a>`/`<label>`; icon buttons get `aria-label`; visible focus ring `--focus`; keyboard shortcut `/` focuses global search. |

## 2. Shared components to build first

`AppShell` (sidebar + top bar; mobile = top bar with hamburger drawer + bottom tab bar) · `GlobalSearch` (quote no / VIN / invoice no) · `ThemeToggle` · `UserMenu` · `StatusChip` · `ZarAmount` / `UsdAmount` · `Button` (primary / secondary / ghost / destructive, sizes 36 / 44 / 52) · `SegmentedControl` · `Tabs` · `DataTable` (TanStack: saved views, column picker, search, status filter chips, unread dot, row select + bulk bar, CSV/XLSX export, pagination) · `Drawer` · `Modal` + `TypedConfirmModal` · `Toast` · `EmptyState` · `Stepper` (horizontal, status-coloured) · `ProgressBar` · `SignaturePad` (canvas, clear, timestamp, required/error state) · `FileUploader` (drop/browse/camera, multi, thumbnails, progress, type/size errors) · `ProtectedField` (masked for non-admins, lock icon, reveal is audited) · `Timeline` · `FormRenderer` (section 4).

Reference: `design/Components.dc.html` (+ `ComponentsDark`), `design/Main.dc.html` for tokens.

## 3. Screens and routes

| Route | Design file | Notes |
|---|---|---|
| `/` | `Home.dc.html` | Unread entries, my tasks, awaiting approval (Inspections + Store Room), Xero sync health tile (last sync, token expiry, failures 24 h), recent entries table, quick links/“new” for the 7 forms, sync by entity |
| `/tasks` | `Tasks.dc.html` | Items needing my action: inspections to review/approve, store-room approvals, failed jobs (Retry), assigned leads. Filter chips with counts. |
| `/forms` | `FormsIndex.dc.html` | 7 cards: name, access type, encrypted badge, entry + unread counts, New entry, Public link / QR modal (public forms only) |
| `/forms/[form]` | `Entries.dc.html` | Data grid per form. **Encrypted forms (Deal, Delivery Note) list only number, summary and status** — no field columns, column picker locked, banner explaining decryption on open is logged. |
| `/forms/[form]/[id]` | `EntryDetail.dc.html` | Form left (View/Edit). Right rail: status chip + stepper, role-based actions, timeline (**field names only, never values**), files with **60-second signed preview links**, emails sent, generated PDFs (versioned, sha256 shown). Protected fields masked for non-admins. |
| `/forms/deal/new` | `DealForm.dc.html` | Month, date created, collection location, quote no + **Import from Xero** (fills up to 8 part/description lines and total from the quote), sales rep, POP upload, total (manual override). Incomplete → Submitted. |
| `/forms/job-card/new` | `FormRenderer.dc.html` | Date, quote no (lookup), 7 short text lines. Also the field-type reference for the renderer. |
| `/forms/store-room/[id]` | `StoreRoom.dc.html`, `PhoneStoreRoom.dc.html` | 3 pages × ~15 numeric fields; each label shows its minimum; values below minimum are red with "short by N"; summary of all low items. Status: Submitted (archived) → **APPROVAL** (red) → **APPROVED EMAILED** (green, set manually by button). Phone uses +/− steppers. |
| `/deals/[quoteNo]` | `DealFile.dc.html` | One per trailer. Header: customer, quote no, invoice no, VIN, branch, rep. Horizontal journey Deal → Request for Invoice → Inspection → Release → Delivery with each step's status, date, who, link. Xero panel: quote Sent/Accepted/Invoiced, invoice total, amount due, paid date. Generated documents list. |
| `/quotes`, `/invoices` | `XeroMirror.dc.html` | Read-only Xero mirror tables (status chips, ZAR amounts, last synced). Row → drawer with lines, totals (subtotal, VAT 15 %, total, ≈ USD), attachments, Open in Xero, Go to deal file. |
| `/leads` | `Leads.dc.html` | Inbox: list + detail. Status, assign, branch, source badge (Manual / Test), **duplicate warning** (merge / not a duplicate), matched Xero quote/invoice, notes. Inbox/Pipeline switch. |
| `/leads/pipeline` | `LeadsPipeline.dc.html` | Board: New / Contacted / Quoted / Won / Lost with counts and ZAR sums; card → drawer to change stage; Add lead modal (dedupe check note); "Hide test leads" switch. |
| `/leads` (phone) | `PhoneLeads.dc.html` | Stage chips, list → detail, Call/Email, stage pills, notes. |
| `/integrations/xero` | `XeroIntegration.dc.html` | Connection + OAuth reconnect/disconnect, token expiry (access + refresh), rate-limit headroom (per minute / per day), last sync per entity, failures with Retry / **Replay webhook**, write-actions table, dry-run diff viewer. |
| `/settings` | `Settings.dc.html` | Tabs: Organisation (display currency USD/ZAR, timezone, FX source), Users & roles (everyone Admin for now; roles ready), Notification recipients (event key, address, branch), Audit log, Job runs. |
| Public `/f/request-for-invoice` | `RequestInvoice.dc.html` | Minimal chrome (logo, secure badge, footer). Turnstile. **Submit without a 1st deposit is blocked with the exact message `NO PAYMENT LOADED FORM NOT SUBMITTED`** plus field error. Thank-you state after submit. |
| Public `/f/delivery-note/[token]` | `DeliveryNote.dc.html` | Phone-first 5-step flow with progress bar: (1) VIN, quote lookup → read-only customer panel from RFI (name, ID, address), invoice no, delivery date, email; (2) 4 T&C blocks each with a customer signature + sales-rep signature — cannot continue until all 5 signed; (3) uploads: signatory ID, NATIS, payment 1, payment 2, release note; (4) photos front/left/right/rear; (5) review → creates signed PDF. |
| Public thank-you | `ThankYou.dc.html` | Signed PDF card + reference. |
| Inspector / reviewer links | `PhoneInspection.dc.html`, `LinkStates.dc.html` | Inspector edit link: checklist with **Pass and Fail as independent toggles per row**, photo prompt on Fail, signature, autosave Incomplete, error per unanswered row. Reviewer link: Mark reviewed / Request changes (note). Expired-link and already-signed pages. |
| Phone shell | `PhoneHome.dc.html` | Charcoal top bar + hamburger drawer, bottom tabs Home / Tasks / Forms / Deals / Leads with badges. |
| Dark references | `*Dark.dc.html` | Same screens with dark tokens. |

Clickable journey to reproduce in E2E tests: Deal form → Import from Xero → Submit → Request for Invoice (blocked without deposit, then succeeds) → Delivery Note 5 steps → Thank-you → Deal file timeline.

## 4. Form renderer (one component for all 7 forms)

Render every form from a schema. Layout is a **24-column grid** on desktop (each field has `span`), single column below 640px. **Page breaks in the schema become steps** with a progress bar. Autosave drafts as status **Incomplete** (show "Autosaved · HH:MM SAST").

Field types: `text`, `number` (optional `min` shown in label + below-min highlight), `date`, `choice`, `name` (first/last), `address` (street, town, province, postal code), `email`, `lookup` (combobox against Xero quotes/invoices/VIN), `file` (multi-upload with thumbnails, camera on phone), `signature`, `content` (read-only block, scrolls on phone), `yesno`.

Validation: inline error under the field (red 2px border, message in `--redt`), plus a summary alert at top on submit listing fields to fix. Required marker `*` in `--red`.

```ts
type Field = {
  key: string; type: "text"|"number"|"date"|"choice"|"name"|"address"|"email"|"lookup"|"file"|"signature"|"content"|"yesno";
  label: string; span?: number /* of 24 */; required?: boolean; min?: number;
  options?: string[]; lookup?: "xeroQuote"|"xeroInvoice"|"vin"; multiple?: boolean;
  protected?: boolean /* masked for non-admins */; pageBreakBefore?: string /* step title */;
};
type FormDef = { slug: string; name: string; access: "internal"|"public"|"inspector"|"auto";
  encrypted?: boolean; statuses: string[]; fields: Field[] };
```

## 5. Business rules the UI must enforce

1. **Xero is read-only except five write actions**: `setQuoteStatus`, `upsertContact`, `createInvoiceFromQuote`, `uploadInvoiceAttachment`, `setInvoiceReference`. Each has an **Off / Dry-run / Live** segmented control. Switching to Live opens a modal that only enables "Go live" when the user types `LIVE <actionName>` exactly. Dry-run logs the request; the diff viewer shows "Portal would send" vs "Make.com sent" with added/removed lines highlighted.
2. **Request for Invoice**: no 1st-deposit file → block submit with `NO PAYMENT LOADED FORM NOT SUBMITTED`.
3. **Release Form** is normally auto-created when a Xero invoice is fully paid → show the "Auto-created from Xero" badge.
4. **Inspection** status flow Submitted → Reviewed → Approved (stepper). Actions by role: Reviewer can Mark reviewed / Request changes; Admin can Approve. Sales is read-only. Approval locks the entry and generates a new PDF version.
5. **Store Room** APPROVED EMAILED is set manually.
6. **Encrypted forms** (Deal, Delivery Note): grid shows summary/number/status only; opening an entry decrypts and writes an audit log row.
7. **Timeline** records who changed which fields, never the values.
8. **Files** open via 60-second signed URLs; show "Signed link · expires in 60 s" after Preview.
9. **PDFs** are versioned (v1, v2…) with sha256 shown truncated.
10. **Leads**: source badge Manual/Test, duplicate detection by phone/email, auto-match to Xero quote/invoice by contact.
11. Times in SAST; currency per section 1.

## 6. Sample data

Use only fictional data (as in the designs): companies like "Bergview Agri Co-op", VINs like `TT9DEMO24D0010482`, quote `QU-10482`, invoice `INV-20931`, emails `@example.com`, phones `+27 xx 555 xxxx`, ID `SAMPLE-ID-0001`. No real customer names, IDs, emails or VINs in seeds, tests or screenshots.

## 7. Placeholders to fill

- Real logo (designs use an orange "T&T" tile) — put SVG in `public/logo.svg` and swap into `AppShell`, public headers and PDFs.
- Xero organisation name, T&C clause text (Delivery Note sections 1–4 and sales-rep declaration), ZAR→USD rate source.

## 8. Suggested build order

1. Tokens + Tailwind + fonts + theme toggle → `AppShell` (desktop + phone) → `StatusChip`, `Button`, inputs.
2. `FormRenderer` + `SignaturePad` + `FileUploader`; render Job Card, then the other six schemas.
3. Entries grid + entry detail (timeline, files, PDFs, role actions).
4. Public pages (RFI, Delivery Note, thank-you, expired/used link) with Turnstile.
5. Deal file, Xero mirror, Xero integration + write-action gating, Settings.
6. Leads inbox, pipeline, phone view. Home + Tasks last (they aggregate everything).

## 9. Done when

- Every route in section 3 matches its design file at 1440 and 390 widths, light and dark.
- The prototype journey in section 3 passes as a Playwright test.
- axe reports no WCAG AA violations on each route; all actions reachable by keyboard.
- Rules 1–11 in section 5 each have a test.
