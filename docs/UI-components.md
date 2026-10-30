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
| `Toast`, `ToastProvider`, `useToast` | Toast cards (success, info, error; Dismiss; optional link). The provider keeps persistent live regions: success/info are announced politely, errors assertively; max 3; 5 s auto-dismiss paused on hover/focus; errors stay. No personal data in toast text. |
| `Timeline` | Who did what and which fields changed (names only, never values), times in SAST ("Today 09:14 SAST"). |
| `ZarAmount`, `UsdAmount` | Xero money with its currency badge and an optional muted "≈ USD" line (only with a real rate); portal USD amounts. |
| `ProtectedField` | Server-masked value with a lock; admins get Reveal/Hide through an audited server action. |

`useDialog` (Drawer, Modal) holds the dialog behaviour; the key and focus rules are pure in `lib/ui/focus-trap.ts`.

## Pure helpers (unit-tested)

- `lib/money/fx.ts`: `formatZar` ("R 486,750.00"), `formatUsd` ("$26,450.00"), `formatAmount`, `approxUsd(amount,
  currency, rate)` (null unless the currency is ZAR and the rate is positive). There is no ZAR to USD rate source
  yet: pass a rate only from a real source, never a hard-coded one.
- `lib/ui/time.ts` (Africa/Johannesburg): `sastClock` ("09:14 SAST"), `dayTime` ("Today 09:14", "Yesterday 15:40",
  "27 Oct 15:40"), `shortDateTime` ("29 Oct, 09:14"), `shortDate` ("29 Oct 2026"), `longDate`
  ("Thursday 29 October 2026"), `longDateTime` ("29 Oct 2026, 14:31 SAST").
- `lib/ui/confirm.ts`, `lib/ui/mask.ts`, `lib/ui/pagination.ts`, `lib/ui/timeline.ts`, `lib/ui/toast.ts`,
  `lib/ui/views.ts`, `lib/ui/initials.ts`, `lib/ui/focus-trap.ts`.

Unit tests can server-render components (`tests/unit/ui-components.test.ts`); the unit project compiles JSX.
