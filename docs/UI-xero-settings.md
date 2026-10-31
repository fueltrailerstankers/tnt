# Xero integration and Settings (UI handoff: XeroIntegration, Settings)

## Routes

| Route | Permission | What it shows |
|---|---|---|
| `/admin/integrations/xero` | `integrations.read` | Connection (tenant, connected by/on, scopes; Connect/Reconnect and Disconnect for `integrations.manage`), Tokens (access token minutes left of 30, refresh token days left of 60 from the last refresh), Rate-limit headroom (from Xero's last response headers), Last sync per entity, Failures · 24 h, Write actions (Off / Dry-run / Live), Dry-run diff and the month check (`integrations.manage`). |
| `/admin/integrations/xero/actions` | `integrations.manage` | Per action: what it does, setting vs effective mode, the mode control, last runs (30 days), link to its latest dry-run diff, merge plan form. |
| `/admin/settings` | `settings.read` (else the first readable tab) | Organisation: name, display currency (USD/ZAR), timezone, ZAR → USD rate source and manual rate. Editable with `settings.manage`. |
| `/admin/settings/notifications` | `settings.read` | Notification recipients: event key, address, branch, active. Add/Edit with `settings.manage`. |
| `/admin/settings/jobs` | `settings.read` | Job runs: run id, job, started (SAST), duration, processed count, state, redacted error. Filter by state, 50 per page. |

The Settings tab bar (`lib/ui/settings-tabs.ts`) also links M7's Users & access and Activity log and M8's Forms; each
tab shows only to members who can read it.

## Rules

- **Go live** (HANDOFF section 5 rule 1): choosing Live opens `TypedConfirmModal`; "Go live" is enabled only when the
  text equals `LIVE <action>` exactly (e.g. `LIVE rfi.create_invoice`; no trimming, case folding or extra spaces).
  The server action `switchActionMode` re-checks the same phrase in `checkSwitch` (`lib/integrations/xero/write/modes.ts`),
  requires `xero.actions.configure` (admin only), write scopes for actions that write to Xero, and writes
  `audit_log` (`xero.action.live` / `xero.action.mode`, meta `{ from, to, confirmed }`). Off and Dry-run switch at once.
- **Retry (sync)** on sync failures posts to the existing `syncNow` action (`integrations.manage`).
- **Retry (job)** on a failed outbox job calls `retryJobAction` (`app/(admin)/admin/integrations/ops-actions.ts`):
  the same row goes back to `pending` (attempts 0, due now, lock and error cleared) only while it is still `failed`;
  no new row is created. Audit `job.retry` (`entity` `outbox_job`, meta `{ queue, attempts }`). Same button on Tasks.
- **Replay webhook** (failures list) and **Replay** (Webhook events card: the latest 20 stored Xero events with kind,
  status and error label; resource ids are never shown) call `replayEventAction`: it re-queues processing of the
  STORED raw event (`xero.fetch`: a GET of the record and a mirror upsert; `leads.intake` for lead events). It never
  re-verifies a signature and never writes to Xero. Ignored events (unknown org or category) have no Replay. A job
  already pending/running for the event is reused. Audit `integration.replay` (`entity` `integration_event`, meta
  `{ source, queue, from }`). Rules are pure in `lib/integrations/ops.ts`; the runner is `lib/integrations/ops-run.ts`.
  Results show as toasts.
- **Dry-run diff**: left is one recorded dry run (`xero_action_runs.planned_requests`, redacted when stored). The portal
  does not store what Make.com sent, so the right column is empty until an admin pastes Make's requests (a request
  list, one request, or a `tt-make-replay/1` file, docs/M3.md). The pasted text stays in the browser, is never saved,
  and is redacted with the same rules before it is shown. Keys are sorted on both sides; portal-only lines are green
  with `+`, Make-only lines red with `-` (plus screen-reader text), and the count is of changed blocks.
- Nothing on these pages shows token values, emails from job errors, ID numbers or file names. Job and sync errors go
  through `jobErrorLabel`; recipient audit rows hold the recipient id and event key, never the address.

## Settings keys

| Key | Value | Written by |
|---|---|---|
| `fx.zar_usd` | JSON string, positive decimal, **USD per 1 ZAR** (e.g. `"0.0547"` means R 1 = $0.0547), up to 8 decimals, at most 1. Missing = no rate: screens show ZAR only and no "≈ USD" line. | `saveOrg` (`settings.manage`), audited as `settings.fx` with `{ from, to, source: 'manual' }`. Parse/read with `lib/settings/fx.ts` (`parseFxInput`, `fxRateOf`). |
| `xero.action.<name>` | `"off" \| "dry_run" \| "live"` (docs/M3.md) | `switchActionMode` only (0009 blocks client writes). |

Organisation changes are audited as `settings.org` with the changed field names, timezone and currency.

## Code

- `lib/settings/` (pure, `tests/unit/settings.test.ts`, `tests/unit/xero-integration-page.test.ts`): `fx.ts`, `org.ts`,
  `recipients.ts`, `job-runs.ts`, `xero-page.ts` (meters, entity rows, failures, action stats, `liveBlockedReason`),
  `request-diff.ts` (request lines, Make recording parser, LCS line diff). `xero-load.ts` is the server loader
  (service client after the permission check; never selects token columns).
- `components/integrations/` (`ActionModeControl`, `DryRunDiff`, `Meter`, `DisconnectXero`) and
  `components/settings/` (`OrgForm`, `RecipientDialog`).
- e2e: `tests/e2e/xero-settings.spec.ts` (typed confirmation, audit rows, diff, settings tabs, axe at 1440/390 light
  and dark, no horizontal scroll at 390).
