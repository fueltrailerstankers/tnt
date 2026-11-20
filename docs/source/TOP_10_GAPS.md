# Top 10 gaps to build next (priority order)

Based on the 20 Nov 2026 walkthrough. The v1 notes (BUILD_PLAN_trailer_stock.md, M6.md) were not available, so drop any item already built in M6.

1. **Factory builds + "Dispatch factory-built unit".** Build the dialog (model, quantity 1–50, start date, notes), the "Factory bulk stock and builds" list, and the third dispatch mode. In that mode a factory unit fills model and VIN, and deal year/number are optional (left blank = stock dispatch). Permission: factory staff or Gerald only.
2. **Count rules for the overview matrix.** Factory column shown but never added to "Total at branches". Sold units are excluded everywhere. Amber dot when a count includes Reserved units. Four cards: Stock across branches / Ready to sell / Reserved / At factory. Test against rules 1–9 in section 8.
3. **Matrix drill-downs.** A branch cell opens the Unit register filtered by part number + branch. A factory cell opens Factory build with that model selected.
4. **Workspace switch (Sample review vs Live pilot).** Remembered in the browser. Sample data never reaches the server. Show the status line (loaded time · opening stock state · role) and the record-limit lock.
5. **Sequence (deal link) allocation.** Assign or remove a deal link with a required reason. Removing it from an Available unit makes the unit Available and returns the deal to Outstanding. A Reserved unit keeps its reservation.
6. **Transfer unit.** Destination (every location except the current one), date and storage note; VIN, deal, invoice and equipment stay with the unit. Only Gerald can transfer between branches.
7. **Outstanding deals controls.** Year/branch/search filters; "Show dismissed" view; Gerald-only Dismiss/Restore with a required reason and a server-side dismissal history; "Dispatch →" pre-fill; cards that follow the year filter only.
8. **Roles and permissions.** Gerald super user; staff branch permissions (assigned location + "Enable stock changes"); View only; the matching disabled states and messages. The email-login portal invite can come later; it is not activated on the live site either.
9. **Gerald register corrections.** Correct unit model (not for Sold units); Remove duplicate / Remove from register (Available units only) with a reason; "Removed units" panel with Restore.
10. **Pilot setup + Connections.** Opening stock check/confirm; opening-stock CSV import (template columns, up to 100 rows, preview first); Latest deliveries feed (live/test, up to 200); live invoice exceptions table. Also replace raw "Unexpected token '<'…" errors with a sign-in-expired message.
