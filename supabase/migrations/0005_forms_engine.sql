-- 0005: forms engine support (M1).
-- Search text for the entries grid, immutable PDF versions with hashes, role-link token hashing,
-- notification recipients seeded from the kit specs, the admin home overview, and upload limits.

-- ---------------------------------------------------------------------------
-- Entries: search text for the grid. Encrypted forms keep data = '{}', so only their summary is searchable.
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;

alter table public.entries
  add column search_text text generated always as (lower(coalesce(summary, '') || ' ' || data::text)) stored;
create index entries_search_trgm on public.entries using gin (search_text extensions.gin_trgm_ops);
create index entries_form_number_idx on public.entries(form_id, number desc);

-- ---------------------------------------------------------------------------
-- Generated documents are immutable versions: a signed Delivery Note PDF is stored once and never
-- overwritten. A later edit produces a new version row; the old one stays.
-- ---------------------------------------------------------------------------
alter table public.entry_documents
  add column name text,
  add column sha256 text,
  add column size_bytes bigint,
  add column created_by uuid references auth.users(id) on delete set null;
create index entry_documents_entry_idx on public.entry_documents(entry_id, template_number, created_at desc);

create or replace function public.entry_documents_immutable() returns trigger language plpgsql as $$
begin raise exception 'entry_documents rows are immutable'; end $$;
create trigger entry_documents_no_update before update on public.entry_documents
  for each row execute function public.entry_documents_immutable();

-- Role links: the app stores sha256(token) in entry_links.token, never the token itself.
comment on column public.entry_links.token is 'sha256 hex of the role-link token; the raw token only ever appears in the emailed URL';
alter table public.entry_links alter column token drop default;
alter table public.entry_links add column revoked_at timestamptz;

alter table public.email_log add column event_key text;

-- ---------------------------------------------------------------------------
-- Notification recipients: the inboxes hardcoded in the Cognito specs, now configuration.
-- Event key = "<form-slug>.<Action>". Field tokens such as [InspectorEmail] stay in the spec.
-- ---------------------------------------------------------------------------
insert into public.notification_recipients (org_id, event_key, address)
select o.id, r.event_key, r.address
from public.orgs o
cross join (values
  ('delivery-note.Submit', 'sales@fueltrailers.co.za'),
  ('job-card.Submit', 'sales@fueltrailers.co.za'),
  ('release-form.Submit', 'sales@fueltrailers.co.za'),
  ('request-for-invoice.Submit', 'sales@fueltrailers.co.za'),
  ('request-for-invoice.Update', 'accounts@fueltrailers.co.za'),
  ('store-room.Submit', 'factory@fueltrailers.co.za'),
  ('trailer-inspection-checklist.SubmitInspection', 'sales@fueltrailers.co.za')
) as r(event_key, address)
where o.id = '00000000-0000-0000-0000-000000000001'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Admin home: per-form totals, unread for the caller, last activity. Runs as the caller (RLS applies).
-- ---------------------------------------------------------------------------
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
  group by f.id
  order by f.sort_order, f.name
$$;
revoke all on function public.form_overview() from public, anon;
grant execute on function public.form_overview() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage: per-object size limits on the private buckets (uploads go straight to Storage via signed URLs).
-- ---------------------------------------------------------------------------
update storage.buckets set file_size_limit = 20 * 1024 * 1024 where id = 'entry-files';
update storage.buckets set file_size_limit = 50 * 1024 * 1024 where id = 'documents';
