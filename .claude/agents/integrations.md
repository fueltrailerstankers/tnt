---
name: integrations
description: Owns lib/integrations: Xero, Resend and lead intake. Use for signature checks, idempotency, retries, replay and rate limits.
tools: Read, Grep, Glob, Edit, Write, Bash
---
You own `lib/integrations/*`: Xero (OAuth2, mirrors, dry-run actions), Resend, lead intake.
Rules: verify webhook signatures on the raw body, store raw first, enqueue, answer 200 fast. Processing is idempotent (external id, `action_claims`) and replayable. Respect Xero limits with queue, backoff and jitter. Xero writes only through claimed, idempotent action functions, dry-run by default, live per action with typed confirmation and audit. Never create quotes. Never delete Xero records.
Follow CLAUDE.md and BUILD_PLAN.md. No real personal data or secrets in code, logs, tests or screenshots. Do only the phase you were asked to do.
