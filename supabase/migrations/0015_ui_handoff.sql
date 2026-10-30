-- 0015: database foundation for the UI handoff.
--
-- 1) saved_views: a staff user's own named filters for a list (the entries grid of a form, Xero quotes,
--    Xero invoices, leads). A row holds list query parameters only (view, status, search, dates, columns),
--    never entry values. Each user reads and writes only their own rows, and only within orgs they belong to.
--    The server (lib/views/saved-views.ts) sets org_id from the caller's membership and validates the
--    scope and query shape; RLS is the backstop.
-- 2) terms_versions: the exact legal text blocks shown to a signer (Delivery Note terms, waiver, declaration,
--    receipt), stored once per (org, key, sha256). Written by the server only (service role, after the form or
--    role-link checks) through lib/terms/versions.ts. Append-only, like audit_log.
-- 3) entry_files signature metadata: signed_at (UTC, server-set, never after the row is stored), signer_role,
--    sign_method and terms_version_id. Additive and nullable; only signature rows may carry them. entry_files
--    stays server-written (0005: no client insert, update or delete), so these columns are set by runAction only.

-- ---------------------------------------------------------------------------
-- Saved views
-- ---------------------------------------------------------------------------
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 'form:<slug>' | 'xero_quotes' | 'xero_invoices' | 'leads'. The app holds the closed list; the database
  -- checks the format only, so a new list needs no migration.
  scope text not null check (scope ~ '^[a-z][a-z0-9_]{0,31}(:[a-z0-9][a-z0-9_-]{0,63})?$'),
  name text not null check (char_length(name) between 1 and 60 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  query jsonb not null default '{}'::jsonb
    check (jsonb_typeof(query) = 'object' and octet_length(query::text) <= 4096),
  created_at timestamptz not null default now(),
  unique (org_id, user_id, scope, name)
);
create index saved_views_user_idx on public.saved_views(user_id);

alter table public.saved_views enable row level security;

create policy saved_views_own on public.saved_views for all to authenticated
  using (user_id = (select auth.uid()) and public.is_org_member(org_id))
  with check (user_id = (select auth.uid()) and public.is_org_member(org_id));

revoke all on public.saved_views from anon, authenticated;
grant select, delete on public.saved_views to authenticated;
-- Clients never choose id or created_at, and a view never moves to another user, org or list.
grant insert (org_id, user_id, scope, name, query) on public.saved_views to authenticated;
grant update (name, query) on public.saved_views to authenticated;
grant all on public.saved_views to service_role;

-- Caps, enforced here too because a member can reach the table through the API without the app's checks:
-- 50 views per list (VIEWS_PER_LIST_MAX) and 500 per user and org (VIEWS_PER_USER_MAX; the scope format allows
-- any form slug). Inserts are serialised per (org, user) so concurrent saves cannot overshoot. Runs as the
-- caller: RLS limits the count to the caller's own rows, which are the only rows its insert may add to.
create or replace function public.saved_views_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('saved_views:' || new.org_id::text || ':' || new.user_id::text, 0));
  if (select count(*) from public.saved_views v
      where v.org_id = new.org_id and v.user_id = new.user_id and v.scope = new.scope) >= 50
     or (select count(*) from public.saved_views v
         where v.org_id = new.org_id and v.user_id = new.user_id) >= 500 then
    raise exception 'saved_views: limit reached' using errcode = '54000';
  end if;
  return new;
end $$;
create trigger saved_views_limit before insert on public.saved_views
  for each row execute function public.saved_views_limit();
revoke all on function public.saved_views_limit() from public, anon, authenticated;

comment on table public.saved_views is 'A user''s own named list filters (query parameters only, never entry values).';

-- ---------------------------------------------------------------------------
-- Terms versions (append-only)
-- ---------------------------------------------------------------------------
create table public.terms_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),          -- no cascade: signed records point here
  key text not null check (key ~ '^[a-z][a-z0-9-]{1,63}$'),  -- e.g. 'delivery-note'
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),    -- over the canonical blocks (lib/terms/versions.ts)
  body jsonb not null                                        -- ordered [{id, text}] exactly as shown to the signer
    check (case when jsonb_typeof(body) = 'array' then jsonb_array_length(body) > 0 else false end),
  created_at timestamptz not null default now(),
  unique (org_id, key, sha256),
  unique (id, org_id)                                        -- target of the entry_files org-consistent foreign key
);

-- sha256 of a body, computed exactly as lib/terms/versions.ts does: JSON.stringify of the ordered [{id, text}]
-- list (no whitespace, non-ASCII unescaped) as UTF-8. to_json(text) escapes as JSON.stringify does (", \,
-- \b \f \n \r \t, other controls below U+0020 as \u00xx); Postgres text holds no NUL or lone surrogate.
-- tests/db/ui-handoff.test.ts checks both sides agree over every BMP code point and astral characters.
create or replace function public.terms_body_sha256(p_body jsonb) returns text
language sql stable strict set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    '[' || pg_catalog.string_agg(
      '{"id":' || pg_catalog.to_json(t.e ->> 'id')::text || ',"text":' || pg_catalog.to_json(t.e ->> 'text')::text || '}',
      ',' order by t.o) || ']',
    'UTF8')), 'hex')
  from pg_catalog.jsonb_array_elements(p_body) with ordinality as t(e, o)
$$;

-- A new version must be what lib/terms/versions.ts writes: blocks of exactly {id, text} (strings, id format,
-- unique ids, non-empty text with LF line endings) and a sha256 that matches the body. Signed records rely on
-- the stored body being the hashed one, so this is checked here and not only in the app.
create or replace function public.terms_versions_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if pg_catalog.jsonb_typeof(new.body) is distinct from 'array' or pg_catalog.jsonb_array_length(new.body) = 0 then
    raise exception 'terms_versions: body must be a non-empty list of {id, text} blocks' using errcode = '23514';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(new.body) as t(e)
    where case when pg_catalog.jsonb_typeof(t.e) = 'object' then not (
            t.e ?& array['id', 'text']
            and (select count(*) from pg_catalog.jsonb_object_keys(t.e)) = 2
            and pg_catalog.jsonb_typeof(t.e -> 'id') = 'string'
            and pg_catalog.jsonb_typeof(t.e -> 'text') = 'string'
            and (t.e ->> 'id') ~ '^[a-z][a-z0-9_-]{0,63}$'
            and (t.e ->> 'text') <> ''
            and pg_catalog.strpos(t.e ->> 'text', pg_catalog.chr(13)) = 0)
          else true end
  ) or (select count(distinct t.e ->> 'id') from pg_catalog.jsonb_array_elements(new.body) as t(e))
       <> pg_catalog.jsonb_array_length(new.body) then
    raise exception 'terms_versions: body must be a list of {id, text} blocks with unique ids' using errcode = '23514';
  end if;
  if new.sha256 is distinct from public.terms_body_sha256(new.body) then
    raise exception 'terms_versions: sha256 does not match the body' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger terms_versions_check before insert on public.terms_versions
  for each row execute function public.terms_versions_check();
revoke all on function public.terms_body_sha256(jsonb), public.terms_versions_check() from public, anon, authenticated;
grant execute on function public.terms_body_sha256(jsonb) to service_role;

create or replace function public.terms_versions_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'terms_versions is append-only'; end $$;
create trigger terms_versions_no_update before update or delete on public.terms_versions
  for each row execute function public.terms_versions_immutable();
create trigger terms_versions_no_truncate before truncate on public.terms_versions
  for each statement execute function public.terms_versions_immutable();
revoke all on function public.terms_versions_immutable() from public, anon, authenticated;

alter table public.terms_versions enable row level security;

create policy terms_versions_select on public.terms_versions for select to authenticated
  using (public.is_org_member(org_id));

revoke all on public.terms_versions from anon, authenticated, service_role;
grant select on public.terms_versions to authenticated;
grant select, insert on public.terms_versions to service_role;

comment on table public.terms_versions is 'Legal text blocks shown to a signer, one row per (org, key, sha256). Server-written, append-only.';

-- ---------------------------------------------------------------------------
-- Signature metadata on entry_files (additive, nullable)
-- ---------------------------------------------------------------------------
alter table public.entry_files
  add column signed_at timestamptz,                                                -- time of signing, UTC (server-set)
  add column signer_role text check (signer_role ~ '^[a-z][a-z0-9_]{0,31}$'),      -- e.g. customer, sales_rep; never a name
  add column sign_method text check (sign_method in ('draw', 'type')),
  add column terms_version_id uuid,
  add constraint entry_files_signature_meta_check check (
    kind = 'signature'
    or (signed_at is null and signer_role is null and sign_method is null and terms_version_id is null)
  ),
  -- A signature is never dated after the row that stores it (5 minutes of clock skew allowed).
  add constraint entry_files_signed_at_check check (signed_at is null or signed_at <= created_at + interval '5 minutes'),
  -- References terms_versions(id), and the version must belong to the entry's org (org_id comes from the entry).
  add constraint entry_files_terms_version_fk foreign key (terms_version_id, org_id)
    references public.terms_versions(id, org_id);
create index entry_files_terms_version_idx on public.entry_files(terms_version_id) where terms_version_id is not null;

comment on column public.entry_files.signed_at is 'Signature rows: signing time (UTC), set by the server: its receive time, or a client-reported time only after clamping it to the form session and now. Never later than created_at (+5 min). Displayed in Africa/Johannesburg.';
comment on column public.entry_files.signer_role is 'Signature rows: signer role key (customer, sales_rep, ...). Never a person''s name.';
comment on column public.entry_files.sign_method is 'Signature rows: draw | type.';
comment on column public.entry_files.terms_version_id is 'Signature rows: the terms_versions row shown when this signature was captured.';
