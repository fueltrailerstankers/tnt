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
-- 3) entry_files signature metadata: signed_at (client time, stored UTC), signer_role, sign_method and
--    terms_version_id. Additive and nullable; only signature rows may carry them. entry_files stays
--    server-written (0005), so these columns are set by runAction only.

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
grant select, insert, delete on public.saved_views to authenticated;
grant update (name, query) on public.saved_views to authenticated;   -- a view never moves to another user, org or list
grant all on public.saved_views to service_role;

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
  add column signed_at timestamptz,                                                -- client time of signing, UTC
  add column signer_role text check (signer_role ~ '^[a-z][a-z0-9_]{0,31}$'),      -- e.g. customer, sales_rep; never a name
  add column sign_method text check (sign_method in ('draw', 'type')),
  add column terms_version_id uuid,
  add constraint entry_files_signature_meta_check check (
    kind = 'signature'
    or (signed_at is null and signer_role is null and sign_method is null and terms_version_id is null)
  ),
  -- References terms_versions(id), and the version must belong to the entry's org (org_id comes from the entry).
  add constraint entry_files_terms_version_fk foreign key (terms_version_id, org_id)
    references public.terms_versions(id, org_id);
create index entry_files_terms_version_idx on public.entry_files(terms_version_id) where terms_version_id is not null;

comment on column public.entry_files.signed_at is 'Signature rows: client-reported signing time (UTC). Displayed in Africa/Johannesburg.';
comment on column public.entry_files.signer_role is 'Signature rows: signer role key (customer, sales_rep, ...). Never a person''s name.';
comment on column public.entry_files.sign_method is 'Signature rows: draw | type.';
comment on column public.entry_files.terms_version_id is 'Signature rows: the terms_versions row shown when this signature was captured.';
