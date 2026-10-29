-- 0007: Xero write actions (M3), dry-run first.
-- Xero is the book of record. Every Xero write goes through lib/integrations/xero/write/writer.ts and is
-- recorded here, one row per action attempt. Mode per action lives in app_settings
-- (key "xero.action.<name>", value "off" | "dry_run" | "live"; a missing key means off).
-- A live write is claimed exactly once in action_claims (unique org + action_key) before it is sent.

create table public.xero_action_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  action text not null check (action ~ '^[a-z]+\.[a-z_]+$'),     -- e.g. rfi.create_invoice
  idempotency_key text not null,                                  -- e.g. rfi.create_invoice:90001 (ids/numbers only)
  mode text not null check (mode in ('off', 'dry_run', 'live')),
  status text not null check (status in ('planned', 'sent', 'succeeded', 'failed', 'skipped')),
  source_entry_id uuid references public.entries(id) on delete set null,
  source_ref text,                                                -- e.g. Xero invoice id for release.on_paid
  planned_requests jsonb not null default '[]'::jsonb,            -- method, path, body; personal data REDACTED
  effects jsonb not null default '[]'::jsonb,                     -- non-Xero effects (our entries, emails), redacted
  expected jsonb,                                                 -- expected end state in Xero, redacted
  response_summary jsonb,                                         -- ids and status codes only
  reason text,                                                    -- why skipped / stopped (no personal data)
  error text,                                                     -- redacted
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index xero_action_runs_org_action_idx on public.xero_action_runs(org_id, action, created_at desc);
create index xero_action_runs_key_idx on public.xero_action_runs(org_id, idempotency_key);

alter table public.xero_action_runs enable row level security;
create policy xero_action_runs_select on public.xero_action_runs for select to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]));

revoke all on public.xero_action_runs from anon, authenticated;
grant select on public.xero_action_runs to authenticated;
grant all on public.xero_action_runs to service_role;

comment on table public.xero_action_runs is 'One row per Xero action attempt (off/dry_run/live). Written by the server only; org admins read.';

-- Release emails ("Release Form - {InvoiceNumber}") go to the branches. Configuration, not code.
insert into public.notification_recipients (org_id, event_key, address)
select o.id, r.event_key, r.address
from public.orgs o
cross join (values
  ('release.paid', 'sales@fueltrailers.co.za'),
  ('release.paid', 'durban@fueltrailers.co.za'),
  ('release.paid', 'capetown@fueltrailers.co.za')
) as r(event_key, address)
where o.id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;
