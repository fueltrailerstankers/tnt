-- 0004: orgs, memberships, org-keyed RLS, audit, notification recipients, settings, integration plumbing.
-- Kit migrations 0001..0003 are applied unchanged; this migration retrofits org keying on top of them.
-- Client access is by org membership. Secret/raw tables have RLS enabled and NO client policies or grants
-- (service role only, used in server code after can()/requirePerm).

-- ---------------------------------------------------------------------------
-- Orgs and memberships
-- ---------------------------------------------------------------------------
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency_code char(3) not null default 'USD',          -- display/entry fallback only; money rows carry their own code
  timezone text not null default 'Africa/Johannesburg',  -- display timezone; timestamps are stored in UTC
  created_at timestamptz not null default now()
);

insert into public.orgs (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Trailers & Tankers');

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'staff',
  branch text,                                            -- optional branch scope, null = all branches
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

-- ---------------------------------------------------------------------------
-- Access helpers (security definer so policies can read memberships without recursion)
-- ---------------------------------------------------------------------------
create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = auth.uid()) $$;

create or replace function public.has_org_role(p_org uuid, p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.memberships m
                  where m.org_id = p_org and m.user_id = auth.uid() and m.role = any (p_roles)) $$;

create or replace function public.shares_org_as_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.memberships mine
                  join public.memberships theirs on theirs.org_id = mine.org_id
                  where mine.user_id = auth.uid() and mine.role = 'admin' and theirs.user_id = p_user) $$;

-- ---------------------------------------------------------------------------
-- Retrofit org_id on the kit tables
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  default_org constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  foreach t in array array['forms','form_statuses','form_roles','form_counters','entries','entry_reads',
                           'entry_files','entry_events','entry_links','email_log','entry_documents'] loop
    execute format('alter table public.%I add column org_id uuid not null default %L references public.orgs(id)', t, default_org);
    execute format('alter table public.%I alter column org_id drop default', t);
    execute format('create index %I on public.%I(org_id)', t || '_org_idx', t);
  end loop;
end $$;

-- slug is unique per org, not globally
alter table public.forms drop constraint forms_slug_key;
alter table public.forms add constraint forms_org_slug_key unique (org_id, slug);

-- Child rows always take org_id from their parent, so a client cannot spoof it.
-- Security definer: resolves the parent regardless of the caller's RLS view of it.
create or replace function public.tg_org_from_parent() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  execute format('select org_id from public.%I where id = $1', tg_argv[0])
    into v using (to_jsonb(new) ->> tg_argv[1])::uuid;
  if v is not null then new.org_id := v; end if;
  return new;
end $$;

create trigger form_statuses_org before insert or update on public.form_statuses
  for each row execute function public.tg_org_from_parent('forms', 'form_id');
create trigger form_roles_org before insert or update on public.form_roles
  for each row execute function public.tg_org_from_parent('forms', 'form_id');
create trigger form_counters_org before insert or update on public.form_counters
  for each row execute function public.tg_org_from_parent('forms', 'form_id');
create trigger entries_org before insert or update on public.entries
  for each row execute function public.tg_org_from_parent('forms', 'form_id');
create trigger entry_reads_org before insert or update on public.entry_reads
  for each row execute function public.tg_org_from_parent('entries', 'entry_id');
create trigger entry_files_org before insert or update on public.entry_files
  for each row execute function public.tg_org_from_parent('entries', 'entry_id');
create trigger entry_events_org before insert or update on public.entry_events
  for each row execute function public.tg_org_from_parent('entries', 'entry_id');
create trigger entry_links_org before insert or update on public.entry_links
  for each row execute function public.tg_org_from_parent('entries', 'entry_id');
create trigger entry_documents_org before insert or update on public.entry_documents
  for each row execute function public.tg_org_from_parent('entries', 'entry_id');
-- email_log.entry_id is nullable (set null on delete): org_id is taken from the entry when present.
create trigger email_log_org before insert or update on public.email_log
  for each row execute function public.tg_org_from_parent('entries', 'entry_id');

-- Numbering runs from the entries trigger and must work for any permitted inserter,
-- but must not be callable directly (execute is revoked below).
create or replace function public.next_entry_number(p_form uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.form_counters(form_id, last_number, org_id)
  values (p_form, 1, (select org_id from public.forms where id = p_form))
  on conflict (form_id) do update set last_number = public.form_counters.last_number + 1
  returning last_number into n;
  return n;
end $$;

create or replace function public.entries_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.number is null or new.number = 0 then new.number := public.next_entry_number(new.form_id); end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Audit, notification recipients, settings
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigserial primary key,
  org_id uuid not null references public.orgs(id),
  actor_user uuid references auth.users(id) on delete set null,
  action text not null,                 -- e.g. entry.update, settings.change, xero.action.live
  entity text,
  entity_id text,                       -- ids only: never emails, ID numbers or file names
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_org_created_idx on public.audit_log(org_id, created_at desc);

create or replace function public.audit_log_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

create table public.notification_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  event_key text not null,              -- e.g. deal.created, release.created, inspection.submitted
  address text not null,
  branch text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, event_key, address)
);

create table public.app_settings (
  org_id uuid not null references public.orgs(id) on delete cascade,
  key text not null,                    -- e.g. xero.action.rfi_invoice = off|dry_run|live. Never secrets.
  value jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (org_id, key)
);

-- ---------------------------------------------------------------------------
-- Integration plumbing (service role only: RLS on, no policies, no client grants)
-- ---------------------------------------------------------------------------
create table public.integration_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id),         -- null until the receiver resolves the org
  source text not null,                            -- xero | leads | resend | ...
  external_id text,                                -- provider event id, for idempotency
  signature_ok boolean not null,
  payload jsonb not null,                          -- raw body stored first
  status text not null default 'received' check (status in ('received','queued','processed','failed','ignored')),
  attempts int not null default 0,
  error text,                                      -- redacted
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index integration_events_dedupe_idx on public.integration_events(source, external_id) where external_id is not null;
create index integration_events_status_idx on public.integration_events(status, received_at);

create table public.outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.orgs(id),
  queue text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','running','done','failed')),
  attempts int not null default 0,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,                                 -- redacted
  created_at timestamptz not null default now()
);
create index outbox_jobs_due_idx on public.outbox_jobs(status, run_at);

create table public.job_runs (
  id bigserial primary key,
  org_id uuid references public.orgs(id),
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  processed int not null default 0,
  error text                                       -- redacted
);

create table public.external_refs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  source text not null,                            -- xero | cognito | make
  entity text not null,                            -- invoice | quote | contact | entry ...
  external_id text not null,
  internal_id text not null,
  created_at timestamptz not null default now(),
  unique (org_id, source, entity, external_id)
);

create table public.action_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  action_key text not null,                        -- idempotency key, e.g. "rfi.create_invoice:<quote_no>"
  claimed_at timestamptz not null default now(),
  result jsonb,
  unique (org_id, action_key)
);

create table public.xero_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenant_id text not null,
  access_token_enc bytea,                          -- AES-256-GCM, never plaintext
  refresh_token_enc bytea,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  connected_at timestamptz not null default now(),
  unique (org_id, tenant_id)
);

-- ---------------------------------------------------------------------------
-- RLS: enable everywhere, replace the kit's global policies with org-keyed ones
-- ---------------------------------------------------------------------------
alter table public.orgs enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_log enable row level security;
alter table public.notification_recipients enable row level security;
alter table public.app_settings enable row level security;
alter table public.integration_events enable row level security;
alter table public.outbox_jobs enable row level security;
alter table public.job_runs enable row level security;
alter table public.external_refs enable row level security;
alter table public.action_claims enable row level security;
alter table public.xero_connections enable row level security;

drop policy profiles_self on public.profiles;
drop policy profiles_admin on public.profiles;
drop policy forms_read on public.forms;
drop policy forms_admin on public.forms;
drop policy statuses_read on public.form_statuses;
drop policy roles_read on public.form_roles;
drop policy entries_staff on public.entries;
drop policy reads_own on public.entry_reads;
drop policy files_staff on public.entry_files;
drop policy events_staff on public.entry_events;
drop policy links_staff on public.entry_links;
drop policy email_staff on public.email_log;
drop policy docs_staff on public.entry_documents;
drop policy "staff read entry files" on storage.objects;
drop function public.is_staff();
drop function public.current_app_role();

-- identity
create policy orgs_select on public.orgs for select to authenticated using (public.is_org_member(id));
create policy orgs_update on public.orgs for update to authenticated
  using (public.has_org_role(id, array['admin']::public.app_role[]))
  with check (public.has_org_role(id, array['admin']::public.app_role[]));
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.has_org_role(org_id, array['admin']::public.app_role[]));
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_org_as_admin(id));

-- forms and their definitions
create policy forms_select on public.forms for select to authenticated using (public.is_org_member(org_id));
create policy forms_admin on public.forms for all to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin']::public.app_role[]));
create policy statuses_select on public.form_statuses for select to authenticated using (public.is_org_member(org_id));
create policy statuses_admin on public.form_statuses for all to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin']::public.app_role[]));
create policy roles_select on public.form_roles for select to authenticated using (public.is_org_member(org_id));
create policy roles_admin on public.form_roles for all to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin']::public.app_role[]));
create policy counters_select on public.form_counters for select to authenticated using (public.is_org_member(org_id));

-- entries and children
create policy entries_select on public.entries for select to authenticated using (public.is_org_member(org_id));
create policy entries_insert on public.entries for insert to authenticated
  with check (public.has_org_role(org_id, array['admin','staff']::public.app_role[]));
create policy entries_update on public.entries for update to authenticated
  using (public.has_org_role(org_id, array['admin','staff']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','staff']::public.app_role[]));
create policy entries_delete on public.entries for delete to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]));
create policy reads_own on public.entry_reads for all to authenticated
  using (user_id = auth.uid() and public.is_org_member(org_id))
  with check (user_id = auth.uid() and public.is_org_member(org_id));
create policy files_select on public.entry_files for select to authenticated using (public.is_org_member(org_id));
create policy files_write on public.entry_files for all to authenticated
  using (public.has_org_role(org_id, array['admin','staff']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','staff']::public.app_role[]));
create policy events_select on public.entry_events for select to authenticated using (public.is_org_member(org_id));
create policy links_select on public.entry_links for select to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]));  -- tokens grant access: admin only
create policy email_select on public.email_log for select to authenticated using (public.is_org_member(org_id));
create policy docs_select on public.entry_documents for select to authenticated using (public.is_org_member(org_id));

-- admin-owned config
create policy audit_select on public.audit_log for select to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]));
create policy recipients_admin on public.notification_recipients for all to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin']::public.app_role[]));
create policy settings_select on public.app_settings for select to authenticated using (public.is_org_member(org_id));
create policy settings_admin on public.app_settings for all to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin']::public.app_role[]));

-- storage: a private object is readable only if an entry_files / entry_documents row (itself org-RLS'd) points at it
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict do nothing;
create policy "org members read entry files" on storage.objects for select to authenticated
  using (
    (bucket_id = 'entry-files' and exists (select 1 from public.entry_files ef where ef.storage_path = name))
    or (bucket_id = 'documents' and exists (select 1 from public.entry_documents d where d.storage_path = name))
  );

-- ---------------------------------------------------------------------------
-- Privileges: nothing for anon; least privilege for authenticated; service_role unchanged
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant select on all tables in schema public to authenticated;   -- includes the v_* views (security_invoker)
revoke all on public.integration_events, public.outbox_jobs, public.job_runs, public.external_refs,
              public.action_claims, public.xero_connections from authenticated;
grant insert, update, delete on public.forms, public.form_statuses, public.form_roles,
                                public.entries, public.entry_reads, public.entry_files,
                                public.notification_recipients, public.app_settings to authenticated;
grant update on public.orgs to authenticated;

grant execute on function public.is_org_member(uuid), public.has_org_role(uuid, public.app_role[]),
                          public.shares_org_as_admin(uuid) to authenticated, service_role;
grant execute on all functions in schema public to service_role;
