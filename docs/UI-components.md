# Admin component library

Shared UI for staff pages, built from the design handoff (`Components.dc.html`, `ComponentsDark.dc.html`). Tokens
only (see `app/globals.css`); no hex or Tailwind palette colours. Gallery: **`/admin/dev/components`** (needs
`admin.access`, 404 in production) renders every component with fictional fixtures, in both themes.

## Components (`components/ui/`)

| Component | What it offers |
|---|---|
| `Button` / `buttonClass` | Pill button (also for `<Link>`): primary, secondary, ghost, destructive, destructive-outline, accent-outline, link; sizes 30-52; `loading` adds a spinner, disables and sets `aria-busy`. The original four variants render exactly as before (pinned by `tests/unit/button-styles.test.ts`). |
| `IconButton` | Round icon-only button; `label` is required and becomes the accessible name. |
| `Icon`, `Spinner` | Design stroke icons (decorative, `aria-hidden`); spinner stops under reduced motion. |
| `Badge`, `CountBadge`, `UnreadDot` | ZAR/auto/encrypted/test/neutral/warning tags; red nav count capped at 99+ ("n waiting"); unread/read dot named for screen readers. |
| `Avatar`, `Kbd` | Initials tile (decorative or `role=img`); keyboard hint. |
| `Card`, `CardHeader` | Surface with border, radius and card shadow; detail or section heading with an action slot. |
| `EmptyState` | Icon circle, title, body and next step; dashed card or plain (inside tables). |
| `Table` parts | `TableWrap` (own horizontal scroll, optional labelled region), `Table`, `THead` (sticky option), `TH`, `TR` (selected tint), `TD` (42px rows; mono, muted, numeric), `NumberCell` (unread dot + link), `TableEmpty`. |
| `TableCheckbox` | 16px checkbox with a 44px hit area and indeterminate state; label required. |
| `BulkBar` | "{n} selected" bar with actions and Clear (button or link). |
| `FilterChips` | Pill filters with dots or counts; link chips (`aria-current`) or button chips (`aria-pressed`). |
| `ColumnPicker` | "Columns" disclosure with a checkbox per column, required and locked columns; client callback or GET form mode. Escape closes it without closing a surrounding dialog. |
| `SavedViewsMenu` | View select with built-in and saved views, Save view (modal with name checks) and Delete view. Persisting views is the caller's job. |
| `Pagination` | Previous/next (links or buttons), "Showing a-b of n", "Page x of y". |
| `Drawer` | Right panel, `role=dialog` + `aria-modal`, labelled by its title, labelled close button focused on open, Tab trap, Escape/scrim close, focus restore, scroll lock. Keep `?id=` in the URL so Back closes it. |
| `Modal` | Centred dialog (sm/md/lg), `role=dialog` or `alertdialog`, `aria-modal`, labelled and described, labelled close button, focus on the first input or action, Escape/scrim close (not while `pending`). |
| `TypedConfirmModal` | Confirmation that enables its button only when the typed text equals the phrase exactly (`typedMatches` in `lib/ui/confirm.ts`; the server action must re-check). Shows server errors under the input. |
| `Toast`, `ToastProvider`, `useToast` | Toast cards (success, info, error; Dismiss; optional link). The provider keeps persistent live regions: success/info are announced politely (`aria-live=polite`), errors assertively; max 3; 5 s auto-dismiss paused on hover/focus; errors stay. Cards slide in only under `prefers-reduced-motion: no-preference` (`.toast-enter` in `app/globals.css`). `AppShell` mounts one `ToastProvider` for every staff page, so any client component under `/admin` can call `useToast().toast({ tone, title, body })`. Token colours only. No personal data, ids, file names or tokens in toast text. |
| `Timeline` | Who did what and which fields changed (names only, never values), times in SAST ("Today 09:14 SAST"). |
| `ZarAmount`, `UsdAmount` | Xero money with its currency badge and an optional muted "≈ USD" line (only with a real rate); portal USD amounts. |
| `ProtectedField` | Server-masked value with a lock; admins get Reveal/Hide through an audited server action. |

### Toasts on staff pages

Use a toast for the result of an in-place action that does not navigate (e.g. `components/integrations/OpsButton.tsx`:
Replay / Retry). Pattern: call the server action in `startTransition`, which returns `{ ok, message }` copy (never ids or
payload values); on success `toast({ tone: 'success', title, body: message })` and `router.refresh()`; on failure
`toast({ tone: 'error', ... })` (errors stay until dismissed). Pages that redirect with `?saved=` keep their inline
`Alert` notices.

`useDialog` (Drawer, Modal) holds the dialog behaviour; the key and focus rules are pure in `lib/ui/focus-trap.ts`.

## Pure helpers (unit-tested)

- `lib/money/fx.ts`: `formatZar` ("R 486,750.00"), `formatUsd` ("$26,450.00"), `formatAmount`, `approxUsd(amount,
  currency, rate)` (null unless the currency is ZAR and the rate is positive). The only rate source is the manual
  `fx.zar_usd` setting (Settings > Organisation, read with `fxRateOf` in `lib/settings/fx.ts`): pass a rate only from
  there, never a hard-coded one.
- `lib/ui/time.ts` (Africa/Johannesburg): `sastClock` ("09:14 SAST"), `dayTime` ("Today 09:14", "Yesterday 15:40",
  "27 Oct 15:40"), `shortDateTime` ("29 Oct, 09:14"), `shortDate` ("29 Oct 2026"), `longDate`
  ("Thursday 29 October 2026"), `longDateTime` ("29 Oct 2026, 14:31 SAST").
- `lib/ui/confirm.ts`, `lib/ui/mask.ts`, `lib/ui/pagination.ts`, `lib/ui/timeline.ts`, `lib/ui/toast.ts`,
  `lib/ui/views.ts`, `lib/ui/initials.ts`, `lib/ui/focus-trap.ts`.

Unit tests can server-render components (`tests/unit/ui-components.test.ts`); the unit project compiles JSX.

## Forms index and entries grid (`components/entries/`)

- `/admin/forms` (`FormCard`, `PublicLinkButton`): one card per form from `formCard()` in `lib/admin/forms-index.ts`
  (access type from the public link and public role, encrypted / auto-created badges, entries, unread, task flag,
  New entry via `newEntryHref`). The public link modal copies `APP_URL/f/<slug>`; no QR code. Test ids `form-card-*`.
- `/admin/forms/[slug]` (`FormTabs`, `ViewMenu`, `EntriesTable`): URL state parsed by `parseGridQuery`; chips and
  counts from `viewChips` + `viewCounts` (one `list_entries` call per count, RLS as the caller); search, From/To and
  the column picker are one GET form (Apply); saved views use `lib/views/saved-views.ts` through `saveFormView` /
  `deleteFormView`; bulk Mark read / Mark unread go through `setEntriesRead` (Zod, ids narrowed to the form);
  Export selected adds `sel=<numbers>` to the export route. Phones (< 640px) get one card per entry instead of the
  table (`entry-card-*`; the table rows keep `entry-*`).
- Encrypted forms (DEAL, Delivery Note): `gridColumns` offers no field columns (picker locked), the list is read with
  `decrypt: false`, and CSV/XLSX exports carry only number, status, timestamps and summary (`clearExportTable`).
  Field values are decrypted only on the entry page. The grid banner (handoff copy) says each open is logged: the
  entry page must write that audit row (rule 6).
