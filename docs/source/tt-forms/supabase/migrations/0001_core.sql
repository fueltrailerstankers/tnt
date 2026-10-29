-- Core schema: schema-driven form engine replicating the Cognito Forms org "trailersandtankers1"
-- Forms are defined by spec/forms/*.json (seeded into forms.spec). Entry values live in entries.data (jsonb, keyed by Cognito field name).

create extension if not exists pgcrypto;

-- ---------- users / staff ----------
create type public.app_role as enum ('admin', 'staff', 'reviewer', 'inspector');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text unique,
  role public.app_role not null default 'staff',
  created_at timestamptz not null default now()
);

create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from public.profiles where id = auth.uid()) $$;

-- ---------- forms ----------
create table public.forms (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  internal_name text not null,
  cognito_form_id int,
  sort_order int not null default 0,
  entry_summary_template text,          -- e.g. "[QUOTENO]"
  encrypt_entries boolean not null default false,
  is_active boolean not null default true,  -- public link enabled
  spec jsonb not null,                   -- full spec (fields, workflow, documents)
  created_at timestamptz not null default now()
);

create table public.form_statuses (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  name text not null,
  color text not null,
  sort_order int not null default 0,
  archived boolean not null default false,
  unique (form_id, name)
);

create table public.form_roles (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id) on delete cascade,
  name text not null,
  is_public boolean not null default false,
  unique (form_id, name)
);

-- per-form entry number sequence (Cognito Entry.Number)
create table public.form_counters (
  form_id uuid primary key references public.forms(id) on delete cascade,
  last_number int not null default 0
);

create or replace function public.next_entry_number(p_form uuid) returns int
language plpgsql as $$
declare n int;
begin
  insert into public.form_counters(form_id, last_number) values (p_form, 1)
  on conflict (form_id) do update set last_number = public.form_counters.last_number + 1
  returning last_number into n;
  return n;
end $$;

-- ---------- entries ----------
create table public.entries (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.forms(id),
  number int not null,
  status text not null default 'Incomplete',
  data jsonb not null default '{}'::jsonb,       -- field values keyed by Cognito FieldName
  data_encrypted bytea,                           -- used instead of data when forms.encrypt_entries (see BUILD_PLAN §Security)
  summary text,                                   -- rendered entry_summary_template
  created_by uuid references auth.users(id),
  submitted_by_email text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cognito_entry_id text,                          -- for migrated rows
  unique (form_id, number)
);
create index entries_form_status_idx on public.entries(form_id, status);
create index entries_data_gin on public.entries using gin (data jsonb_path_ops);
create index entries_summary_trgm on public.entries (summary);

create or replace function public.entries_before_insert() returns trigger language plpgsql as $$
begin
  if new.number is null or new.number = 0 then new.number := public.next_entry_number(new.form_id); end if;
  return new;
end $$;
create trigger entries_bi before insert on public.entries for each row execute function public.entries_before_insert();

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger entries_bu before update on public.entries for each row execute function public.touch_updated_at();

-- read/unread per staff user (Cognito "Unread" counts on Home)
create table public.entry_reads (
  entry_id uuid references public.entries(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (entry_id, user_id)
);

-- files + signatures (Supabase Storage bucket 'entry-files', private)
create table public.entry_files (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries(id) on delete cascade,
  field_key text not null,          -- Cognito FieldName, e.g. 'POP', '_1stDeposit', 'Signature4'
  kind text not null default 'file' check (kind in ('file','signature','document')),
  storage_path text not null,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index entry_files_entry_idx on public.entry_files(entry_id, field_key);

-- audit trail of workflow actions
create table public.entry_events (
  id bigserial primary key,
  entry_id uuid not null references public.entries(id) on delete cascade,
  action text not null,             -- Submit / Update / MarkReviewed ...
  from_status text,
  to_status text,
  actor_user uuid references auth.users(id),
  actor_role text,                  -- Public / Internal / Inspector / Form Creator / Internal Reviewer
  diff jsonb,
  created_at timestamptz not null default now()
);

-- role links (Cognito workflow links / "RoleAssignment" in emails)
create table public.entry_links (
  token text primary key default encode(gen_random_bytes(24), 'hex'),
  entry_id uuid not null references public.entries(id) on delete cascade,
  role_name text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- outbound email log
create table public.email_log (
  id bigserial primary key,
  entry_id uuid references public.entries(id) on delete set null,
  action text,
  to_addresses text[] not null,
  from_address text,
  subject text,
  provider_message_id text,
  status text not null default 'queued',
  error text,
  created_at timestamptz not null default now()
);

-- generated PDFs
create table public.entry_documents (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries(id) on delete cascade,
  template_number int not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

-- ---------- RLS ----------
-- Public (anon) never touches tables directly: public form submit goes through Next.js server actions using the service role.
alter table public.profiles enable row level security;
alter table public.forms enable row level security;
alter table public.form_statuses enable row level security;
alter table public.form_roles enable row level security;
alter table public.form_counters enable row level security;
alter table public.entries enable row level security;
alter table public.entry_reads enable row level security;
alter table public.entry_files enable row level security;
alter table public.entry_events enable row level security;
alter table public.entry_links enable row level security;
alter table public.email_log enable row level security;
alter table public.entry_documents enable row level security;

create policy profiles_self on public.profiles for select using (id = auth.uid() or public.current_app_role() = 'admin');
create policy profiles_admin on public.profiles for all using (public.current_app_role() = 'admin');

create policy forms_read on public.forms for select using (true);              -- spec is needed to render public forms
create policy forms_admin on public.forms for all using (public.current_app_role() = 'admin');
create policy statuses_read on public.form_statuses for select using (true);
create policy roles_read on public.form_roles for select using (true);

create policy entries_staff on public.entries for all using (public.is_staff()) with check (public.is_staff());
create policy reads_own on public.entry_reads for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy files_staff on public.entry_files for all using (public.is_staff()) with check (public.is_staff());
create policy events_staff on public.entry_events for select using (public.is_staff());
create policy links_staff on public.entry_links for select using (public.is_staff());
create policy email_staff on public.email_log for select using (public.is_staff());
create policy docs_staff on public.entry_documents for select using (public.is_staff());

-- storage bucket (private)
insert into storage.buckets (id, name, public) values ('entry-files', 'entry-files', false) on conflict do nothing;
create policy "staff read entry files" on storage.objects for select using (bucket_id = 'entry-files' and public.is_staff());
