Design the UI for "Trailers & Tankers Platform", an internal operations portal for a South African trailer and tanker manufacturer (fueltrailers.co.za). It replaces Cognito Forms and Make.com automations. Xero stays the accounting book of record; the portal mirrors it and never creates quotes.

AUDIENCE AND DEVICES
- Staff: sales reps, accounts, branch staff (Durban, Cape Town), factory/store room, inspectors, one admin. Desktop-first admin, but factory staff and inspectors use phones: big touch targets, one-column forms, camera upload, signature pad.
- Customers sign the Delivery Note on a public link (phone or tablet), no login.
- Light and dark mode, keyboard-friendly, WCAG AA contrast. Clean, dense, utilitarian business look. Tailwind + shadcn/ui style. Neutral greys with one strong accent colour; status colours: gray, teal, yellow, green, red.
- Display currency USD by default, with a ZAR badge on Xero-sourced money. Times in Africa/Johannesburg.

DESIGN THESE SCREENS

A. Shell: left sidebar (Home, Tasks, Forms, Deals, Quotes, Invoices, Documents, Leads, Integrations, Settings), top bar with global search (quote no, VIN, invoice no), user menu, theme toggle. Mobile: bottom tab bar + hamburger.

B. Home dashboard: unread entries, my tasks, recent entries, quick links to the 7 forms, Xero sync health tile (last sync, token expiry, failures), "awaiting approval" count (Inspections and Store Room).

C. FORMS section (the core). A Forms index with 7 cards, each showing name, entry count, unread count, "New entry" and "Public link / QR code" buttons:
 1. DEAL (internal): Month, Date created, Collection location, Quote No, Sales rep, POP upload, up to 8 part-number + description line pairs, Total (manual). Statuses Incomplete > Submitted. Show "Import from Xero" button that fills lines and total from the quote.
 2. REQUEST FOR INVOICE (public): Quote No, Date, Sales rep, Customer VAT no, Business reg no, Contact no, Name (first/last), ID no, Address, 1st/2nd/3rd deposit + 4th payment file uploads. Must block submit with message "NO PAYMENT LOADED FORM NOT SUBMITTED" when no first deposit.
 3. JOB CARD: Date, Quote No, 7 short text lines.
 4. TRAILER INSPECTION CHECKLIST: VIN, 1st inspection date, Inspected by (name), inspector email, a long checklist section with Pass and Fail as independent checkboxes per row, inspector signature, inspection date. Status flow Submitted > Reviewed > Approved with actions: Request changes, Mark reviewed, Approve. Show as a stepper plus role-based action buttons.
 5. RELEASE FORM: VIN, Email, Invoice no, Customer details. Mostly auto-created when a Xero invoice is fully paid; show an "auto-created from Xero" badge.
 6. DELIVERY NOTE + T&Cs: VIN, Quote No lookup (shows a read-only customer panel from the Request for Invoice: name, ID, address), Invoice no, long scrollable terms and conditions blocks each followed by a signature pad (4 customer signatures + sales rep signature), uploads (signatory ID copy, NATIS, payment 1, payment 2, release note), delivery date, email, four photos (front, left, right, rear). Multi-step with progress bar. Output is a signed PDF.
 7. STORE ROOM: three-page stock-count sheet of about 45 numeric fields (tyres, axles/brakes, couplers, lamps, bolts, nuts), each label shows its minimum level; highlight values below minimum. Statuses: Submitted (archived) > APPROVAL (red) > APPROVED EMAILED (green, set manually).
 Design ONE reusable form renderer (24-column grid, steps from page breaks, field types: text, number, date, choice, name, address, email, lookup, file multi-upload with thumbnails, signature, content block, yes/no) and show it at desktop and phone width. Include validation error states, autosave "Incomplete" draft, and the public thank-you page.

D. Entries grid per form: TanStack-style table with saved views, column picker, search, status filter chips, unread dot, bulk mark-read, export CSV/XLSX. Encrypted forms (DEAL, Delivery Note) show only summary, number and status.

E. Entry detail page: form on the left (view/edit), right rail with status chip, role-based action buttons, timeline (who changed which fields, never values), files list with 60-second signed preview links, emails sent, generated PDFs (versioned, with hash). Protected fields shown masked for non-admins.

F. Deal file page (one per trailer): header with Customer, Quote no, Invoice no, VIN, branch, rep; horizontal timeline Deal > Request for Invoice > Inspection > Release > Delivery with each step's status, date, and link; Xero panel showing quote status (Sent/Accepted/Invoiced), invoice total, amount due, paid date.

G. Quotes and Invoices lists (read-only Xero mirror): searchable tables with status chips, ZAR amounts, last synced; row opens a detail drawer with lines and attachments.

H. Tasks page: items needing my action (inspections to review/approve, store room approvals, failed jobs).

I. Leads inbox: list + detail with status, assign, notes, source badge (manual/test), matched Xero quote/invoice, duplicate warning.

J. Settings and Integrations:
 - Xero connect page: OAuth button, token expiry, rate-limit headroom, last sync per entity, failure list, replay-webhook button.
 - Xero write actions: a table of 5 actions (setQuoteStatus, upsertContact, createInvoiceFromQuote, uploadInvoiceAttachment, setInvoiceReference) each with an Off / Dry-run / Live segmented control; switching to Live opens a typed-confirmation modal. Show dry-run diff viewer (request that would be sent vs what Make did).
 - Notification recipients table (event key, address, branch).
 - Org settings (currency, timezone), users and roles (everyone admin for now), audit log, job runs.

K. Public/role-link pages: public form layout (logo, minimal chrome, Turnstile placeholder), inspector edit link, reviewer link, thank-you page, expired-link page.

DELIVERABLES
- Design tokens (colours, type scale, spacing, radius), component library sheet (buttons, inputs, status chips, tables, drawers, modals, toasts, empty states, signature pad, file uploader).
- All screens above at desktop (1440) and phone (390), light and dark.
- Interactive clickable prototype of the main journey: Deal > Request for Invoice > Delivery Note, ending on the Deal file timeline.
- Use only fictional sample data (no real names, ID numbers, emails or VINs).
