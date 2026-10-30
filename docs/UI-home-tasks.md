# Home and Tasks (UI handoff: Home, HomeDark, PhoneHome, Tasks)

## Routes

| Route | Permission | What it shows |
|---|---|---|
| `/admin` | `admin.access` | Greeting by SAST hour with the date line, summary tiles (Unread entries, My tasks, Awaiting approval, Xero sync health), My tasks (top 5), Recent entries (6, unread dot), Forms with `{n} new` and `+` links, Sync by entity. Below `lg` a separate phone block: two tiles, Xero alert banner, 3 task cards, New entry grid. |
| `/admin/tasks` | `tasks.read` | Filter chips (`role=tablist`, arrow keys, `?filter=inspections|store-room|failed-jobs|leads`) with live counts, one row per task, oldest first within each category. |

Every block is gated on its own permission and fails soft (`—` or an inline message), so one broken source never
breaks the page: entries need `entries.read`, tasks `tasks.read`, the Xero tile, sync card and phone banner `xero.read`,
`New deal` and staff `+` links `entries.write` (otherwise `+` goes to the public `/f/<slug>` link while the form is active).

## Code

- `lib/home/` (pure, `tests/unit/home-tasks.test.ts`): `greeting.ts` (greeting, date lines), `forms.ts` (`FORM_UI` labels,
  icons and design order, `newEntryHref`, `entryReference`), `recent.ts` (Recent entries rows and "By"),
  `xero-health.ts` (tile, sync rows, phone banner). `load.ts` is the server loader.
- `lib/tasks/` (pure, unit-tested): `build.ts` (one `TaskRow` model for Tasks, the Home card and the phone cards; role
  filtering, order, counts, filters), `format.ts` (ages and SAST stamps), `jobs.ts` (job error labels; emails and long
  numbers in free text are masked), `carry.ts` (see below). `load.ts` and `names.ts` are server-only.
- `components/home/` (Home parts), `app/(admin)/admin/tasks/` (`TaskList`, `TaskFilters`, `actions.ts`, `loading.tsx`).

## Who sees which task

| Category | Rows | Needs |
|---|---|---|
| Inspections | Submitted → **Mark reviewed**; Reviewed → **Approve** | `entries.review` / `entries.approve` (admin, reviewer; staff are read-only) |
| Store Room | APPROVAL → **Mark APPROVED EMAILED** | `entries.write` (admin, staff) |
| Failed jobs | outbox jobs with status `failed` (own org), Xero sync entities with `last_error` | `integrations.manage` (admin) |
| Leads | status `new`, assigned to the member | `leads.read` (admin, staff) |

## Actions

- **Mark reviewed / Approve** (`inspectionTaskAction`): `requirePerm('tasks.read')`, Zod, `adminForm(slug, entries.review|approve)`,
  status and version check, then `runAction` (the only save path; it re-checks role, `allowedWhen`, the per-action
  permission and the version, and sends the spec's emails). `runAction` reads the whole entry from the posted form, so
  `carryFormData` rebuilds that form from the stored entry, keeps every file and signature, and proves the round trip
  (`readFormData` must give back exactly the stored data). If it cannot, nothing is saved and the user is sent to the
  entry page. Success removes the row (optimistic, restored on error) and announces it in a `role=status` line.
- **Mark APPROVED EMAILED** posts to the existing `setStatus` action of the entry page (manual status, `entries.write`),
  which then opens the entry.
- **Retry** appears only on Xero sync failures and posts to the existing `syncNow` action (`integrations.manage`).
  Failed outbox jobs have no Retry: no server action re-queues one yet. **Details** opens `/admin/integrations/xero`.
- **Open lead** is a link. Home never mutates: its row actions are links.

## Known gaps

- The nav Tasks badge (`lib/ui/shell-data.ts`) still counts inspection and Store Room entries for anyone with
  `tasks.read`; the Home tile and the Tasks `All` chip count the member's actionable tasks including failed jobs and leads.
- No notifications bell (no data model), no lead numbers (`L-0931`), no Store Room branch or reference, no outbox retry.
