# Deal file and Xero mirror (UI handoff: DealFile, XeroMirror)

## Routes

| Route | Permission | What it shows |
|---|---|---|
| `/admin/deal-files` | `deals.read` | Deal files, newest activity first. `?q=` matches quote no (`QU-10482` and `10482` both work), VIN or customer; journey ticks per row. |
| `/admin/deal-files/[quoteNo]` | `deals.read` | Header (customer, quote no, invoice no, VIN, branch, rep, "At <step>" / Delivered), journey Deal → Request for Invoice → Inspection → Release → Delivery (status, when in SAST, who, link), Xero panel (quote Sent / Accepted / Invoiced, invoice total, amount due, paid date), generated PDF versions (v1, v2…, sha256 truncated). `/admin/deal-files/QU-10482` redirects to `/admin/deal-files/10482`. |
| `/admin/xero/quotes` | `quotes.read` | Read-only table: number, contact, date, expiry, status chip, total (ZAR badge), synced. `?q=`, `?status=`, `?page=`; `?id=` opens the drawer. |
| `/admin/xero/invoices` | `invoices.read` | Same, plus due, amount due, `?type=ACCREC|ACCPAY|ALL` and the derived `?status=OVERDUE` (authorised, money due, due date before today in SAST). |
| `/admin/xero/quotes/[id]`, `/admin/xero/invoices/[id]` | as above | Deep links (leads, stock, activity log): check the row exists in the caller's org, then redirect to the list with `?id=`. |

Each section of the deal file checks its own area and says so when it is hidden: the Xero panel needs `quotes.read` /
`invoices.read`; journey entries, who/when and documents need `entries.read` (without it only "Linked" / "Not linked"
shows). Entry data is never read (encrypted DEAL and Delivery Note stay encrypted): only entry metadata,
`entry_events` and `entry_documents` rows.

The drawer is open while the URL has `?id=`: the row link pushes it, so Back closes it; Close, Escape and the scrim
replace the URL with the list's. It shows lines, subtotal / VAT (labelled "VAT 15%" only when the tax is 15% of the
subtotal) / total, payments and attachment details (invoices; quote attachments are not mirrored), "Open in Xero"
(a browser link, new tab, only for Xero GUIDs) and "Go to deal file" (only with `deals.read` and a linked deal).

Nothing on these pages calls Xero or writes anywhere.

## ≈ USD

`app_settings` key `fx.zar_usd` = a positive decimal string, USD per 1 ZAR (`"0.0543"`). It is read with the service
role after `requirePerm` (`lib/deal-view/fx-server.ts`; the row is otherwise visible only with Settings read) and
parsed by `parseFxRate` (anything else, numbers included, means no rate). No rate: no "≈ USD" line.

## Code

- `lib/admin/mirror.ts` (pure): URL state (`parseMirrorQuery` with Zod, `mirrorHref`), status labels and Overdue,
  `taxLabel`, `xeroLink`, `sastToday`.
- `lib/deal-view/` (pure): `journey.ts` (steps, who/when from `entry_events`), `xero.ts` (quote progress, paid),
  `documents.ts` (versions), `search.ts` (quote no search and route param), `fx.ts`.
- `components/deals/` (Journey, XeroPanel, DocumentsList), `components/xero-mirror/` (MirrorHeader, MirrorToolbar,
  MirrorDrawer, RecordParts). Loaders: `app/(admin)/admin/xero/_lib/load.ts`.
- Tests: `tests/unit/deal-view.test.ts`, `tests/unit/xero-mirror-view.test.ts`, `tests/e2e/deals-mirror.spec.ts`
  (set `DM_SCREENSHOT_DIR` to save screenshots).

Open: the quote "Open in Xero" path (`https://go.xero.com/app/quotes/view/<id>`) is unverified against a live Xero
organisation; invoice links use Xero's long-standing `View.aspx?InvoiceID=` pages.
