# Trailers & Tankers Forms — Rebuild Plan (Cognito Forms → Next.js + Supabase + Vercel)

Source: Cognito Forms org **`trailersandtankers1`** (Fuel Trailers / Trailers and Tankers, South Africa).
Extracted 28 Oct 2026 from Cognito's form-builder model endpoint (`/svc/form-builder/model?formName=<slug>`) — every field, layout position, choice list, default, validation expression, role, status, workflow action, notification email and document template was captured. Nothing is guessed except where marked **(inferred)**.

Single source of truth: `spec/forms/*.json`. Human-readable field tables: `docs/forms/*.md` (generated). Legal copy verbatim: `content/*.md`.

---

## 1. What exists today (inventory)

| # | Form (Cognito name) | Slug | Cognito id | Entries | Fields | Workflow highlights |
|---|---|---|---|---|---|---|
| 1 | DEAL | `deal` | 9 | 550 | 23 + Submit | Encrypted. Month + Sales Rep dropdowns, Collection Location checkboxes, POP upload, 8× Part No/Line pairs, Total. Custom Word→PDF template. No emails. |
| 2 | Request For Invoice | `request-for-invoice` | 4 | 1,345 | 13 | Customer name/address/ID/VAT/reg, 4 payment-proof uploads. **Error "NO PAYMENT LOADED FORM NOT SUBMITTED"**. Submit → sales@, Update → accounts@ (with attachments). Lookup source for Delivery Note. |
| 3 | JOB CARD | `job-card` | 6 | n/a | 9 | Date, Quote no, Line 1, Text…Text6. Submit → sales@. |
| 4 | Trailer Inspection Checklist | `trailer-inspection-checklist` | 13 | 690 | 7 + 20-item checklist | **Multi-role approval**: Inspector → Reviewer (Submitted → Reviewed → Approved), emails each step. |
| 5 | RELEASE FORM | `release-form` | 8 | 1,525 | 4 | VIN, Email, Inv no, Customer details. Submit → sales@. |
| 6 | Delivery Note , Terms and Conditions | `delivery-note` | 5 | 1,095 | 24 | Encrypted. Lookup Quote no → RFI, shows customer details. Full T&Cs + warranty + Polyurethane waiver with 4 customer signatures + sales rep signature, ID/NATIS/payment/release uploads, 4 photos. Submit → sales@. |
| 7 | STORE ROOM | `store-room` | 12 | 8 | 41 over 3 pages | Stock count of parts vs minimums. Submit → status **APPROVAL** + email factory@ with PDF. Status "APPROVED EMAILED" set manually. |

Email addresses used: `sales@fueltrailers.co.za`, `accounts@fueltrailers.co.za`, `factory@fueltrailers.co.za`, default inspector `admin@trailersandtankers.co.za`.

Org settings as found: country US, currency USD, timezone UTC, language en (Cognito defaults). **Rebuild with `Africa/Johannesburg` + ZAR** unless the client wants it identical.

### Business flow (inferred from forms + routing)

```
DEAL (sales rep logs the quote/deal, POP, parts)                      -> internal record, PDF via custom template
  -> REQUEST FOR INVOICE (customer + deposit proofs)                   -> sales@ ; on Update -> accounts@ (invoice raised)
     -> JOB CARD (factory build lines against Quote no)                -> sales@
        -> TRAILER INSPECTION CHECKLIST (QC by inspector, reviewed/approved by office)
           -> RELEASE FORM (VIN + invoice released)                    -> sales@
              -> DELIVERY NOTE + T&Cs (customer signs, picks Quote no from RFI) -> sales@
STORE ROOM (stock take, independent)                                   -> factory@ for approval
```
Linking keys used by staff: **Quote no** (DEAL.QUOTENO, RFI.QuoteNo, JOB CARD.QuoteNo, Delivery Note lookup), **VIN** (Inspection.TRAILERVINNUMBER, Release.VINNO, Delivery.TrailerVinNO), **Invoice no** (Release.INVNO, Delivery.INVOICENO). Only Delivery Note→RFI is a real lookup in Cognito; the rest are typed text. Optional Phase 7 adds cross-links.

---

## 2. Target architecture

- **Next.js 15 (App Router, TypeScript, Server Actions)** on **Vercel**
- **Supabase**: Postgres (schema in `supabase/migrations`), Auth (email magic link / password for staff), Storage bucket `entry-files` (private; uploads, signatures, PDFs)
- UI: Tailwind + shadcn/ui; `react-hook-form` + `zod`; signatures with `react-signature-canvas` (saved as PNG to Storage)
- Email: **Resend** (or SMTP via Nodemailer) — sender domain fueltrailers.co.za verified
- PDF: `@react-pdf/renderer` (runs on Vercel serverless); DEAL custom template rebuilt as a React-PDF layout
- **Schema-driven form engine**: the app renders forms from `forms.spec` (seeded from `spec/forms/*.json`). Values are stored in `entries.data` jsonb **keyed by the original Cognito FieldName** (makes data migration 1:1). Typed SQL views `v_<form>` give reporting columns.

```
app/
  (public)/f/[slug]/page.tsx            public form (role = Public / Inspector)
  (public)/f/[slug]/thanks/page.tsx     confirmation message
  (public)/e/[token]/page.tsx           role link: open existing entry for a role (workflow links)
  (admin)/login/page.tsx
  (admin)/admin/page.tsx                Home: forms list + entry counts + unread badges + "Recent"
  (admin)/admin/tasks/page.tsx          Tasks: entries waiting for an action my role can take
  (admin)/admin/forms/[slug]/page.tsx   Entries grid (views: All Entries | Submitted | Unread | by status)
  (admin)/admin/forms/[slug]/new/page.tsx            internal "New entry"
  (admin)/admin/forms/[slug]/entries/[number]/page.tsx  entry view/edit + actions + timeline + PDFs
  (admin)/admin/forms/[slug]/settings/page.tsx       public link on/off, notification recipients
  (admin)/admin/settings/page.tsx       users & roles, org (name, logo, timezone, currency, sender)
components/form-engine/   FormRenderer, FieldGrid, fields/* (Text, Textarea, Email, Date, Choice, File, Number, Name, Address, Signature, YesNo, Lookup, Section, Table, Content, PageBreak/Stepper)
lib/spec/                 types.ts (FormSpec), load.ts, zod.ts (spec -> zod schema), expressions.ts (custom errors, allowedWhen)
lib/workflow/             run-action.ts, emails.ts (token templating), links.ts
lib/pdf/                  EntryPdf.tsx (generic view doc), DealPdf.tsx (custom template), DeliveryNotePdf.tsx
scripts/                  generate.py (spec -> docs/views/seed), import-cognito.ts (migration)
```

### Menus (mirrors Cognito, minus the form builder)
- **Top bar:** Home · Tasks · Settings · user menu
- **Home:** "Recent" (forms most recently used, with default view link e.g. *All Entries*, *Submitted*), and a list of all forms with **unread** count; each opens its entries
- **Per form:** Entries (views) · New Entry · Public link (copy/QR) · Form settings
- **Entry page:** fields (read/edit), status chip (colour from spec), action buttons allowed for my role+status (e.g. Update, MarkReviewed…), Documents (PDF download), Files, Timeline (entry_events), Emails sent (email_log), Share role link
- Entries grid: column picker, search (summary + text fields), status filter, date range, **Export CSV/XLSX**, bulk mark read, delete (admin only)

---

## 3. Form engine spec (how to render each field type)

24-column grid: each field has `row`, `col` (1–24), `span`. Fields sharing a row sit side by side; stack on mobile.

| spec `type` | Render | Stored in `data[FieldName]` | Notes |
|---|---|---|---|
| `text` | input | string | |
| `textarea` | textarea | string | |
| `email` | input type=email | string | `hideLabel`, `protected` (mask in grid/emails for non-admin) |
| `date` | date picker | `YYYY-MM-DD` | |
| `number` | input numeric | number | `integer`, `decimals` |
| `choice` | `style: dropdown` → select; `checkboxes` (`multi`) → checkbox group | string or string[] | `default` pre-selected |
| `file` | multi upload → Storage | (rows in `entry_files`, field_key = FieldName) | `maxFiles`, `accept` |
| `signature` | draw pad → PNG | `entry_files` kind=signature | |
| `name` | First + Last inputs | `{First, Last}` | |
| `address` | Line1, Line2, City, State, PostalCode, Country | object | |
| `yesno` | single checkbox | boolean | TrueLabel Yes / FalseLabel No |
| `lookup` | dropdown of entries from `lookup.sourceForm`, label = `displayField` | source entry uuid | Delivery Note only |
| `section` | titled group | nested | Inspection checklist → `data.checklist = [{itemNo,label,fail,pass,comments}]` |
| `table` | Delivery Note: read-only customer panel from looked-up RFI | — | see `rebuildAs` |
| `content` | markdown/HTML block; `contentRef` loads `content/*.md` in a scroll box | — | |
| `pagebreak` | step boundary; last one = submit button text; `pageTitle`, back button | — | Steps progress bar |

**Validation rules** (exact Cognito logic):
- Request For Invoice `_1stDeposit`: error **"NO PAYMENT LOADED FORM NOT SUBMITTED"** when `QuoteNo` empty **and** no 1st-deposit file; max 5 files.
- Delivery Note `TrailerVinNO`: error when TrailerVinNO empty **and** Email empty. `INVOICENO`: error when TrailerVinNO empty **and** INVOICENO empty. (Cognito shows its generic invalid message — suggested copy in spec.)
- Trailer Inspection: `InspectedByName` required, `InspectorEmail` required (default `admin@trailersandtankers.co.za`).
- Everything else optional.

**Entry summary** (`entries.summary`): render template, e.g. DEAL `[QUOTENO]`, RFI `[Name]` (First Last), Release `[VINNO]`, Delivery `[TrailerVinNO]`, Job Card `[QuoteNo]`, Inspection `[InspectedByName]`, Store Room `[_14INCX5HoleTIRESMIN50]`. Used in grid title and lookup labels.

---

## 4. Workflow engine

Per form (`spec.workflow`): `roles`, `statuses`, `actions[]` with `allowedWhen`, `newStatus`, `emails[]`.

`runAction(entryId|null, formSlug, actionName, role, values)`:
1. Load spec; evaluate `allowedWhen` against current status (new entry = `Incomplete`) and role → 403 if false.
2. Validate values with zod built from spec (+ custom errors).
3. Upsert entry (`next_entry_number` on insert), persist files, compute summary, encrypt if `encrypt_entries`.
4. Set `status = newStatus` if present; insert `entry_events` (from/to, actor, diff).
5. For each email: resolve tokens (`[Entry.AdminLink]` → `/admin/forms/<slug>/entries/<n>`, `[InspectorEmail]` → field value, `[Entry.Number]`), attach entry details / files / PDFs as flagged, create `entry_links` token when `linkForRole` (link → `/e/<token>`), send via Resend, log to `email_log`.
6. Return confirmation message → thanks page.

Actions per form are listed in each `docs/forms/*.md`. Trailer Inspection is the only multi-step one:

| Step | Who | Status | Button | Email |
|---|---|---|---|---|
| 1 | Inspector (public link) | Incomplete → Submitted | SubmitInspection | to sales@ "Trailer Inspection Submitted" + reviewer link |
| 2a | Reviewer (staff) | Submitted → Submitted | RequestReviewChanges | to [InspectorEmail] "Trailer Inspection Needs Changes" + inspector edit link |
| 2b | Reviewer | Submitted → Reviewed | MarkReviewed | to [InspectorEmail] "Trailer Inspection Reviewed" |
| 3 | Reviewer | Reviewed → Approved | ApproveInspection | to [InspectorEmail] "Trailer Inspection Approved" |

All emails From `sales@fueltrailers.co.za`. Generic forms: Public submits (`Submit`, Incomplete→Submitted), Internal edits (`Update`, any non-Incomplete status). Store Room Submit → **APPROVAL**; staff set **APPROVED EMAILED** manually (status dropdown on entry page, admin/staff).

Tasks page = entries where some action's `allowedWhen` is true for the current user's role (e.g. Reviewer sees Submitted/Reviewed inspections; Store Room entries in APPROVAL).

Role mapping: Cognito `Public`/`Inspector` = unauthenticated public link or role link; `Internal`/`Form Creator / Internal Reviewer` = logged-in staff (`profiles.role` in staff/reviewer/admin).

---

## 5. Documents (PDF)

- Every form: **#1 View** PDF = title, logo, all fields incl. blanks, files list, signatures as images, entry number/status. Name pattern `<FORM> - [Entry.Number]` where set.
- DEAL **#3 custom**: Cognito Word template `DEAL - [Entry.Number](1).docx` — **download it manually from Cognito** (DEAL → Publish → Documents) into `content/templates/deal.docx`, then reproduce layout in `lib/pdf/DealPdf.tsx`.
- Store Room: PDF #1 attached to the factory@ email on Submit.
- Delivery Note PDF must include full T&Cs, waiver, and all 5 signatures — it is the signed customer document.
- PDFs generated on demand and cached in Storage (`entry_documents`).

---

## 6. Security

- Staff auth via Supabase Auth; no public sign-up. Admin invites users and sets role.
- Public forms: server actions with service role; rate-limit + honeypot/Turnstile; upload size limit (e.g. 20 MB/file).
- RLS: staff-only on entries/files (see `0001_core.sql`).
- **Encrypted forms (DEAL, Delivery Note):** encrypt `data` app-side with AES-256-GCM (`ENTRY_ENCRYPTION_KEY` env) into `data_encrypted`; keep only non-sensitive search fields (summary, number, status) in clear. Views for these forms then need a decrypting server route instead of SQL views.
- `protected` fields (Delivery Note Email) masked in grid/emails unless admin.

---

## 7. Data migration from Cognito

Volumes: ~5,200 entries + files (signatures, photos, payment proofs).
1. Cognito → each form → Entries → **Export to Excel** with "include file links", or use the Cognito Forms API (Settings → Integrations → API key; check plan availability) to pull entries JSON + file URLs.
2. `scripts/import-cognito.ts`: map columns → `data[FieldName]` (names already match the spec), keep `Entry.Number` as `number`, `Entry.Status` → status, timestamps; download each file → Storage → `entry_files`; set `cognito_entry_id`; after import, `update form_counters set last_number = max(number)`.
3. Inspection checklist: map per-item `Fail`/`PassN`/`CommentsN` (names in spec `checklist[].fields[].cognitoName`) → `data.checklist[]`.
4. Delivery Note lookup: map Cognito RFI entry id → new RFI uuid.
5. Run parallel for 1–2 weeks, then switch links (QR codes / website buttons) to the new `/f/<slug>` URLs.

---

## 8. Quirks to confirm with client (kept as-is in spec)

1. RFI field label typos "Costomer", Release "COSTOMER DETAILS", Store Room "SINGEL", "DOUBBEL", "SCHACELS"; T&C typos — kept verbatim.
2. JOB CARD date field label is literally **"Untitled"**; Text…Text6 have placeholder labels.
3. DEAL `Total` is manual, not calculated.
4. Delivery Note references `QuoteNo.VINASONUNIT` which no longer exists on RFI.
5. Delivery Note "table" has zero columns — only used to show the customer label; rebuild as a read-only panel.
6. Inspection: Pass/Fail are independent checkboxes (could both be ticked); item 1 and 11 share Cognito name `Pass`. Suggest a Pass/Fail radio in v2.
7. Inspection `RequestReviewChanges` leaves status at Submitted — probably should return to Incomplete so the inspector can edit.
8. Locale is US/USD/UTC in Cognito.
9. DEAL has an orphan generic "Action" button (no effect).

---

## 9. Build phases (each = one Claude Code session; acceptance criteria included)

**Phase 0 — Bootstrap**
`npx create-next-app@latest` (TS, Tailwind, App Router, src/), shadcn init, Supabase project, `supabase link`, apply `supabase/migrations/*`, env vars, Vercel project linked to GitHub.
✅ `/admin` loads behind login; `select count(*) from forms` = 7.

**Phase 1 — Spec types + form engine (read-only render)**
`lib/spec/types.ts` from the JSON shape; `FormRenderer` with 24-col grid, all field types, page breaks as steps, content blocks from `content/*.md`.
✅ All 7 forms render at `/f/<slug>` visually matching Cognito field order/widths; Store Room shows Page 1/2/3 with Back/Next.

**Phase 2 — Validation + submit + files/signatures**
zod from spec, custom errors, defaults, uploads to Storage, signature pad, `runAction('Submit')`, thanks page.
✅ RFI blocks with "NO PAYMENT LOADED FORM NOT SUBMITTED"; Delivery Note VIN/Email/Invoice rules; inspection required fields; entries appear with correct numbers.

**Phase 3 — Admin: Home, entries grid, entry page**
Home (Recent + forms + unread), grid views (All / Submitted / Unread / per status), search, export CSV/XLSX, entry view/edit, `Update` action, status change, timeline, read tracking.
✅ Staff can find, open, edit, export any entry.

**Phase 4 — Workflow emails + role links + Tasks**
Email templating + Resend, `email_log`, `entry_links` + `/e/[token]`, Trailer Inspection 4-step flow, Tasks page, Store Room APPROVAL.
✅ End-to-end inspection: inspector submits → sales@ gets mail with reviewer link → MarkReviewed → Approve, inspector gets each mail.

**Phase 5 — Lookup + Delivery Note specifics**
Lookup dropdown of RFI entries (label = Quote no, searchable), read-only customer panel (Name, ID NO, Address), protected Email masking.
✅ Selecting Quote no shows RFI customer data; signatures + photos stored.

**Phase 6 — PDFs**
Generic EntryPdf, DeliveryNotePdf (T&Cs + waiver + signatures), DealPdf (from Word template), Store Room PDF attached to factory@ mail, RFI Update attaches files+docs to accounts@.
✅ PDFs downloadable from entry page; email attachments verified.

**Phase 7 — Encryption, hardening, migration, go-live**
AES-GCM for DEAL + Delivery Note, Turnstile on public forms, rate limit, `import-cognito.ts`, counters reset, Vercel prod domain (e.g. forms.fueltrailers.co.za), DNS for Resend.
✅ All historical entries + files imported and spot-checked against Cognito counts (550 / 1,345 / 1,525 / 1,095 / 690 / 8).

**Optional Phase 8 — improvements** (only if client agrees): link DEAL → RFI → Job Card → Inspection → Release → Delivery by Quote no/VIN into a "Unit timeline"; calculated DEAL total; Pass/Fail radio.

---

## 10. Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # server only
RESEND_API_KEY=
MAIL_FROM="Fuel Trailers <sales@fueltrailers.co.za>"
APP_URL=https://forms.fueltrailers.co.za
ENTRY_ENCRYPTION_KEY=               # 32-byte base64, server only
TURNSTILE_SECRET_KEY=
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
```

## 11. Deploy
1. `supabase db push` (or apply migrations in the dashboard SQL editor in order 0001→0003).
2. Create first admin: sign up via Supabase Auth dashboard, then `insert into profiles (id,email,role) values ('<uid>','<email>','admin')`.
3. Vercel: import GitHub repo, set env vars (Production + Preview), deploy, add custom domain.
4. Resend: verify fueltrailers.co.za (SPF/DKIM), send test from each workflow action.
