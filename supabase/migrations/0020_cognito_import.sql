-- 0020: in-app Cognito import (docs/M5.md "Import from the app").
--
-- cognito_api_keys: one Cognito API key per org, service role only (RLS on, no policies, no client grants).
--   The key is AES-256-GCM encrypted with ENCRYPTION_KEY (AAD = 'cognito-api-key:' || org_id), like the Xero
--   tokens. Only the last 4 characters, who saved it and when are kept in clear.
-- import_runs: one row per form per run (dry_run | apply). The outbox job 'cognito.import' works through a run in
--   time-boxed slices: `cursor` is where the next slice resumes, `report` holds counts and reason codes only (no
--   names, emails, ID numbers, file names or field values). Org admins may read their org's runs; only the server
--   writes them.

create table public.cognito_api_keys (
  org_id uuid primary key references public.orgs(id) on delete cascade,
  key_enc bytea not null,                               -- AES-256-GCM, never plaintext
  last4 text not null check (char_length(last4) between 1 and 4),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  form_slug text not null check (form_slug ~ '^[a-z0-9-]{1,64}$'),
  mode text not null check (mode in ('dry_run', 'apply')),
  status text not null default 'queued' check (status in ('queued', 'running', 'paused', 'done', 'failed')),
  batch_id uuid,                                        -- "All forms": one run per form, worked through in seq order
  seq int not null default 1,
  options jsonb not null default '{}'::jsonb,           -- { limit? }
  cursor jsonb not null default '{}'::jsonb,            -- resume point (source position), never entry data
  report jsonb not null default '{}'::jsonb,            -- counts and reason codes only
  error text check (error is null or error ~ '^[a-z0-9_]{1,64}$'),  -- a reason code, never a message
  stop_requested boolean not null default false,
  lease_until timestamptz,                              -- a slice is working on this run until then
  lease_token uuid,                                     -- the claiming slice's token: its saves match on it
  started_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index import_runs_org_created_idx on public.import_runs(org_id, created_at desc);
create index import_runs_batch_idx on public.import_runs(batch_id, seq) where batch_id is not null;
-- At most one active run per form: two runs writing the same form at once could race on the same entries.
create unique index import_runs_one_active_idx on public.import_runs(org_id, form_slug) where status in ('queued', 'running');

create or replace function public.import_runs_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger import_runs_touch before update on public.import_runs
  for each row execute function public.import_runs_touch();

alter table public.cognito_api_keys enable row level security;
alter table public.import_runs enable row level security;

create policy import_runs_select on public.import_runs for select to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]));

revoke all on public.cognito_api_keys, public.import_runs from anon, authenticated;
grant select on public.import_runs to authenticated;
grant all on public.cognito_api_keys, public.import_runs to service_role;
