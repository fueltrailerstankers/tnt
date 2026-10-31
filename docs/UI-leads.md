# Leads (UI handoff: Leads, LeadsPipeline, PhoneLeads)

## Routes

| Route | Permission | What it shows |
|---|---|---|
| `/admin/leads` | `leads.read` | Inbox. Desktop (`lg`+): lead list beside the first lead's detail. Phones: the list with stage chips. Filter chips Open (New, Contacted, Quoted) / Mine (open, assigned to me) / Won / Lost / Spam (when any) / All with counts; `?q=` search; the M4 params `status`, `source`, `branch`, `assigned`, `dups` still work. Add lead and (admins) Re-match with Xero. |
| `/admin/leads/<id>` | `leads.read` | The inbox with that lead open. Phones show the lead alone with Back, Call (`tel:`) and Email (`mailto:`), stage pills and notes. |
| `/admin/leads/pipeline` | `leads.read` | Board: New / Contacted / Quoted / Won / Lost with counts and the sum of matched Xero quote totals (ZAR badge; another currency is summed on its own). Search, Owner, Branch and Hide test leads filter in the browser, so search text never reaches a URL. A card opens a drawer (`?id=`, Back closes it): stage pills, duplicate warning, owner/branch/contact, matched quote, Add note. Loads the newest 1000 non-spam leads and says so when there are more; 50 cards per column, the rest link to the inbox. |
| `/admin/leads/new` | `leads.manage` | Full-page Add lead (the inbox and board open the same form in a modal; the link works without JavaScript). |

Write controls (Status select, Assign to, stage pills, notes, Add lead) show only with `leads.manage`.

## Statuses and stages

Stored statuses are lib/leads' own (`new`, `contacted`, `quoted`, `won`, `lost`, `spam`), shown as New, Contacted,
Quoted, Won, Lost, Spam. The board's five stages are those minus Spam; spam leads stay reachable from the inbox
(Spam chip, Status select). Nothing else is invented: the design's "Qualified" and the unread dot are not shown.

## Not built (lib/leads has no support)

- **Merge / Not a duplicate**: lib/leads flags duplicates (`duplicate_of`, same normalised phone or email) but has no
  merge or dismiss. The UI shows the warning with the shared key and a link to the other lead only.
- **Branch change**: there is no branch update in lib/leads; the branch is shown read-only (set at intake or by routing).

## Code

- `lib/leads-view/` (pure, `tests/unit/leads-view.test.ts`): `model.ts` (labels, tones, source badge, inbox
  filters, ages, duplicate reason, `tel:`/`mailto:`, board filter/columns/sums), `params.ts` (inbox URL params),
  `timeline.ts` (activity text: ids and statuses only), `actions.ts` (result types, field errors). `load.ts` is
  server-only (RLS client, every query filtered by org, named columns, never `raw`).
- `app/(admin)/admin/leads/actions.ts`: `addLead`, `createManualLead` (no-JS form), `setLeadStatus`, `setLeadAssignee`,
  `addLeadNote`, `rematchLeads`. Each starts with `requirePerm('leads.manage')`, validates with lib/leads' Zod
  schemas and touches only the caller's org; `tests/unit/leads-actions-perms.test.ts` pins that.
- `components/leads/`: `LeadsInbox`, `LeadList`, `LeadDetail`, `LeadControls` (client forms), `PipelineBoard`
  (client), `AddLead` (modal), `LeadFormFields`, `LeadBits`.
- E2E: `tests/e2e/leads.spec.ts` (intake, matching, create/status/assign/note) and `tests/e2e/leads-ui.spec.ts`
  (inbox, board drawer, Add lead dedupe, phone flow, axe at 1440/390 light and dark).
