# Leads (UI handoff: Leads, LeadsPipeline, PhoneLeads)

## Routes

| Route | Permission | What it shows |
|---|---|---|
| `/admin/leads` | `leads.read` | Inbox. Desktop (`lg`+): lead list beside the first lead's detail. Phones: the list with stage chips. Filter chips Open (New, Contacted, Quoted) / Mine (open, assigned to me) / Won / Lost / Spam (when any) / All with counts; `?q=` search; the M4 params `status`, `source`, `branch`, `assigned`, `dups` still work. Add lead and (admins) Re-match with Xero. |
| `/admin/leads/<id>` | `leads.read` | The inbox with that lead open. Phones show the lead alone with Back, Call (`tel:`) and Email (`mailto:`), stage pills and notes. |
| `/admin/leads/pipeline` | `leads.read` | Board: New / Contacted / Quoted / Won / Lost with counts and the sum of matched Xero quote totals (ZAR badge; another currency is summed on its own). Search, Owner, Branch and Hide test leads filter in the browser, so search text never reaches a URL. A card opens a drawer (`?id=`, Back closes it): stage pills, duplicate warning, owner/branch/contact, matched quote, Add note. Loads the newest 1000 non-spam leads and says so when there are more; 50 cards per column, the rest link to the inbox. |
| `/admin/leads/new` | `leads.manage` | Full-page Add lead (the inbox and board open the same form in a modal; the link works without JavaScript). |

Write controls (Status select, Assign to, Branch, stage pills, notes, Add lead, Merge, Not a duplicate) show only with
`leads.manage`. Merged leads are left out of the inbox list, chip counts, board, Tasks and the Xero re-match; their
own page is read-only.

## Statuses and stages

Stored statuses are lib/leads' own (`new`, `contacted`, `quoted`, `won`, `lost`, `spam`), shown as New, Contacted,
Quoted, Won, Lost, Spam. The board's five stages are those minus Spam; spam leads stay reachable from the inbox
(Spam chip, Status select). Nothing else is invented: the design's "Qualified" and the unread dot are not shown.

## Duplicates and branch (migration 0023)

- **Merge into <original>** (duplicate banner on the lead detail and the board drawer; asks to confirm): keeps the
  original, sets `merged_into` / `merged_at` / `merged_by` on the duplicate (status, raw payload, notes and history
  are kept; nothing is deleted), repoints later duplicates of the merged lead to the original, records `merged` /
  `merged_from` events and the audit row `lead.merge`. The detail then opens the original, which lists the leads
  merged into it. Offered only when the original is on the page and neither lead is merged.
- **Not a duplicate**: clears `duplicate_of`, remembers it in `not_duplicate_of` (a check constraint and
  `findDuplicateOf` keep it from being flagged against that original again), event `not_duplicate`, audit
  `lead.not_duplicate`.
- **Branch**: free text with suggestions (branches on recent leads, plus routing rule branches for admins); blank
  clears it; same characters as Add lead. Event `branch`, audit `lead.branch` (from/to). Routing and notifications are
  not re-run.
- All three are RPCs (`lead_merge`, `lead_not_duplicate`, `lead_set_branch`) called with the signed-in user's
  client after `requirePerm('leads.manage')`; the SQL re-checks Leads write (`has_access`) and the org, locks the
  row and refuses a stale page (`DUPLICATE_CHANGED`, `LEAD_MERGED`). Error copy: `leadRpcError` in
  `lib/leads-view/actions.ts`. DB tests: `tests/db/leads-actions.test.ts`.

## Code

- `lib/leads-view/` (pure, `tests/unit/leads-view.test.ts`): `model.ts` (labels, tones, source badge, inbox
  filters, ages, duplicate reason, `tel:`/`mailto:`, board filter/columns/sums), `params.ts` (inbox URL params),
  `timeline.ts` (activity text: ids and statuses only), `actions.ts` (result types, field errors). `load.ts` is
  server-only (RLS client, every query filtered by org, named columns, never `raw`).
- `app/(admin)/admin/leads/actions.ts`: `addLead`, `createManualLead` (no-JS form), `setLeadStatus`, `setLeadAssignee`,
  `addLeadNote`, `rematchLeads`, `mergeLead`, `markNotDuplicate`, `setLeadBranch`. Each starts with `requirePerm('leads.manage')`, validates with lib/leads' Zod
  schemas and touches only the caller's org; `tests/unit/leads-actions-perms.test.ts` pins that.
- `components/leads/`: `LeadsInbox`, `LeadList`, `LeadDetail`, `LeadControls` (client forms), `PipelineBoard`
  (client), `AddLead` (modal), `LeadFormFields`, `LeadBits`.
- E2E: `tests/e2e/leads.spec.ts` (intake, matching, create/status/assign/note) and `tests/e2e/leads-ui.spec.ts`
  (inbox, board drawer, branch / merge / not a duplicate, Add lead dedupe, phone flow, axe at 1440/390 light and dark).
