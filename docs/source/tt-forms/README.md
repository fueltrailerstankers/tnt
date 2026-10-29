# Trailers & Tankers Forms (Cognito rebuild kit)

Reverse-engineered definition of the 7 Cognito Forms used by Fuel Trailers / Trailers and Tankers, ready for Claude Code to build as Next.js + Supabase on Vercel.

```
BUILD_PLAN.md                 full plan: inventory, architecture, menus, engine, workflow, PDFs, migration, phases
CLAUDE.md                     instructions Claude Code reads automatically
spec/forms/*.json             machine-readable form definitions (source of truth)
docs/forms/*.md               generated field tables + workflow per form
content/                      verbatim T&Cs and Polyurethane waiver (Delivery Note)
supabase/migrations/          0001 core schema · 0002 per-form views · 0003 seed forms (tested on Postgres)
scripts/generate.py           spec -> docs + views + seed
```

## Use with Claude Code
1. Push this folder to a new GitHub repo, open it in Claude Code.
2. Prompt: *"Read CLAUDE.md and BUILD_PLAN.md. Do Phase 0 and Phase 1."* Then continue phase by phase.
