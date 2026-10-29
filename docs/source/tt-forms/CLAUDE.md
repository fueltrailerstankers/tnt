# CLAUDE.md — Trailers & Tankers Forms rebuild

You are rebuilding 7 Cognito Forms (org `trailersandtankers1`) as a Next.js 15 + Supabase app deployed on Vercel.
Read `BUILD_PLAN.md` first, then the phase you are asked to do.

## Source of truth
- `spec/forms/*.json` — every field, layout (row/col/span on a 24-col grid), options, defaults, validation, roles, statuses, workflow actions, emails, documents. **Never invent fields; never rename `name` keys** — they equal the Cognito FieldName and are the keys in `entries.data`, which keeps the data import 1:1.
- `content/*.md` — legal text, render verbatim (typos intentional).
- `docs/forms/*.md` — generated, human-readable. Regenerate with `python3 scripts/generate.py` after editing a spec (also regenerates `supabase/migrations/0002_form_views.sql` and `0003_seed_forms.sql`).
- `supabase/migrations/0001_core.sql` — core schema. Add new migrations as `0004_*.sql`…; don't edit applied ones.

## Rules
- Forms render from the spec at runtime (`forms.spec`); no per-form hardcoded JSX except PDF layouts (DealPdf, DeliveryNotePdf).
- Labels, button texts, confirmation messages, email subjects/bodies/recipients exactly as in the spec.
- All writes go through server actions using the service-role client; check role + `allowedWhen` server-side.
- Files/signatures → Storage bucket `entry-files` at `<form-slug>/<entry-id>/<field>/<uuid>-<filename>`; row in `entry_files`.
- Use `Africa/Johannesburg` for date display unless told otherwise.
- Keep the quirks listed in BUILD_PLAN §8 unless the user approves a change.
- After each phase: run `npm run build`, `npm run lint`, and test the phase's acceptance criteria in the browser.

## Stack
Next.js 15 App Router + TS · Tailwind + shadcn/ui · react-hook-form + zod · @supabase/ssr · react-signature-canvas · @react-pdf/renderer · Resend · Vercel.
