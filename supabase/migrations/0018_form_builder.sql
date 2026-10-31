-- 0018: form builder (M8 Part B, docs/M8.md).
-- Depends on 0001, 0004 and 0005 only. Additive: existing forms keep their spec as version 1.
--
-- forms: draft_spec (the designer's work in progress; null = no draft), version (published version number),
--        archived_at (hidden from the forms list and the public link; entries kept), published_at/by.
--        Slugs are already unique per org (0004 forms_org_slug_key).
-- form_versions: every published spec, append-only (who, when, note). Org members read; only the server
--        (service role, after requirePerm('forms.manage')) inserts; nobody updates or deletes.
-- form_data_keys(form): which field keys hold data (entries.data keys + entry_files field keys), for the
--        builder's rename/delete/type-change guards. Runs as the caller (RLS applies).
-- form_overview(): unchanged columns; archived forms are left out.

alter table public.forms
  add column draft_spec jsonb,
  add column version int not null default 1 check (version >= 1),
  add column archived_at timestamptz,
  add column published_at timestamptz,
  add column published_by uuid references auth.users(id);

create table public.form_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  form_id uuid not null references public.forms(id) on delete cascade,
  version int not null check (version >= 1),
  spec jsonb not null,
  note text check (note is null or char_length(note) <= 500),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (form_id, version)
);
create index form_versions_form_idx on public.form_versions(form_id, version desc);
create index form_versions_org_idx on public.form_versions(org_id);

-- org_id always comes from the form, never from the caller.
create trigger form_versions_org before insert on public.form_versions
  for each row execute function public.tg_org_from_parent('forms', 'form_id');

-- Append-only: no update, delete or truncate, even for the table owner (a form is archived, never deleted).
create or replace function public.tg_form_versions_append_only() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'form_versions is append-only';
end $$;
create trigger form_versions_no_update before update or delete on public.form_versions
  for each row execute function public.tg_form_versions_append_only();
create trigger form_versions_no_truncate before truncate on public.form_versions
  for each statement execute function public.tg_form_versions_append_only();

alter table public.form_versions enable row level security;
create policy form_versions_select on public.form_versions for select to authenticated using (public.is_org_member(org_id));
revoke all on public.form_versions from anon, authenticated;
grant select on public.form_versions to authenticated;

-- Existing forms: their current spec is version 1.
insert into public.form_versions (form_id, version, spec, note)
select id, 1, spec, 'Initial version' from public.forms;

-- Field keys that hold data in a form's entries (encrypted forms keep data = '{}': the caller treats every field
-- of an encrypted form with entries as holding data).
create or replace function public.form_data_keys(p_form uuid)
returns setof text
language sql stable security invoker set search_path = public as $$
  select distinct k from (
    select jsonb_object_keys(e.data) as k from public.entries e where e.form_id = p_form and jsonb_typeof(e.data) = 'object'
    union
    select f.field_key from public.entry_files f join public.entries e on e.id = f.entry_id where e.form_id = p_form
  ) x
$$;
revoke all on function public.form_data_keys(uuid) from public, anon;
grant execute on function public.form_data_keys(uuid) to authenticated, service_role;

create or replace function public.form_overview()
returns table (form_id uuid, slug text, name text, sort_order int, is_active boolean,
               entries bigint, unread bigint, last_activity timestamptz)
language sql stable security invoker set search_path = public as $$
  select f.id, f.slug, f.name, f.sort_order, f.is_active,
         count(e.id),
         count(e.id) filter (where e.status <> 'Incomplete'
                             and not exists (select 1 from public.entry_reads r where r.entry_id = e.id and r.user_id = auth.uid())),
         max(e.updated_at)
  from public.forms f
  left join public.entries e on e.form_id = f.id
  where f.archived_at is null
  group by f.id
  order by f.sort_order, f.name
$$;
revoke all on function public.form_overview() from public, anon;
grant execute on function public.form_overview() to authenticated, service_role;
