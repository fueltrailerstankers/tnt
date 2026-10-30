-- 0014: M7 users, access levels and activity log (docs/M7.md).
--
-- Each membership stores its resolved access map (area -> none | read | write), the preset it came from (or
-- 'custom') and a status (invited | active | disabled). public.has_access() reads the caller's membership and the
-- per-area RLS select policies below use it, so a member with "none" for an area reads nothing from it through the
-- API either. Only active members get anything: is_org_member() and has_org_role() now require status 'active'.
-- The area and preset lists mirror lib/security/can.ts (tests/db/access.test.ts compares them).
-- Clients still cannot write memberships (no grant): changes go through server actions (users.manage) that audit.

-- ---------------------------------------------------------------------------
-- Pure helpers: presets, clamping, validation
-- ---------------------------------------------------------------------------
create or replace function public.access_areas() returns text[]
language sql immutable set search_path = '' as $$
  select array['home','tasks','forms','deals','quotes','invoices','leads','stock','integrations','settings','users','activity']
$$;

create or replace function public.preset_access(p_role public.app_role) returns jsonb
language sql immutable set search_path = '' as $$
  select case p_role
    when 'admin' then '{"home":"write","tasks":"write","forms":"write","deals":"write","quotes":"write","invoices":"write","leads":"write","stock":"write","integrations":"write","settings":"write","users":"write","activity":"write"}'::jsonb
    when 'staff' then '{"home":"read","tasks":"read","forms":"write","deals":"read","quotes":"read","invoices":"read","leads":"write","stock":"write","integrations":"none","settings":"none","users":"none","activity":"none"}'::jsonb
    when 'reviewer' then '{"home":"read","tasks":"read","forms":"read","deals":"read","quotes":"read","invoices":"read","leads":"none","stock":"read","integrations":"none","settings":"none","users":"none","activity":"none"}'::jsonb
    when 'factory' then '{"home":"read","tasks":"none","forms":"none","deals":"none","quotes":"none","invoices":"none","leads":"none","stock":"write","integrations":"none","settings":"none","users":"none","activity":"none"}'::jsonb
    else '{"home":"none","tasks":"none","forms":"none","deals":"none","quotes":"none","invoices":"none","leads":"none","stock":"none","integrations":"none","settings":"none","users":"none","activity":"none"}'::jsonb
  end
$$;

-- The effective map (lib/security/can.ts clampAccess): admin is all write; unknown values are none; factory never
-- reads entries, the Xero mirror or leads (0011's restrictive *_not_factory policies agree).
create or replace function public.clamp_access(p_role public.app_role, p_access jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_object_agg(a, case
      when p_role = 'admin' then 'write'
      when p_role = 'factory' and a = any (array['tasks','forms','deals','quotes','invoices','leads']) then 'none'
      when coalesce(p_access ->> a, '') in ('none', 'read', 'write') then p_access ->> a
      else 'none' end)
  from unnest(public.access_areas()) as a
$$;

create or replace function public.valid_access(p jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
     and (select count(*) from jsonb_object_keys(p)) = cardinality(public.access_areas())
     and not exists (select 1 from jsonb_each(p) e
                     where not (e.key = any (public.access_areas())) or e.value not in ('"none"', '"read"', '"write"'))
$$;

-- ---------------------------------------------------------------------------
-- Membership columns
-- ---------------------------------------------------------------------------
alter table public.memberships
  add column display_name text,
  add column access jsonb,
  add column preset text,
  add column status text not null default 'active',
  add column invited_by uuid references auth.users(id) on delete set null,
  add column invited_at timestamptz,
  add column accepted_at timestamptz,
  add column disabled_at timestamptz,
  add column last_seen_at timestamptz;

-- Fills and normalises access and preset on every write, so the stored map is always the effective one and a
-- membership inserted with only a role (create-admin, older code) gets that role's preset.
create or replace function public.memberships_access_defaults() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.access is null
     or (tg_op = 'UPDATE' and new.role is distinct from old.role and new.access is not distinct from old.access
         and old.preset is distinct from 'custom') then
    new.access := public.preset_access(new.role);
  end if;
  new.access := public.clamp_access(new.role, new.access);
  new.preset := case when new.access = public.clamp_access(new.role, public.preset_access(new.role))
                     then new.role::text else 'custom' end;
  if tg_op = 'INSERT' and new.status = 'active' and new.accepted_at is null then new.accepted_at := now(); end if;
  return new;
end $$;
create trigger memberships_access before insert or update on public.memberships
  for each row execute function public.memberships_access_defaults();

-- Backfill: existing members are active with their role's preset.
update public.memberships set access = public.preset_access(role), status = 'active', accepted_at = created_at;

alter table public.memberships
  alter column access set not null,
  alter column preset set not null,
  add constraint memberships_status_check check (status in ('invited', 'active', 'disabled')),
  add constraint memberships_access_check check (public.valid_access(access)),
  add constraint memberships_preset_check check (preset in ('admin', 'staff', 'reviewer', 'inspector', 'factory', 'custom')),
  add constraint memberships_display_name_check check (display_name is null or char_length(display_name) between 1 and 120);
create index memberships_org_status_idx on public.memberships(org_id, status);

-- An org always keeps at least one active admin: removing, disabling or demoting the last one is refused.
-- The advisory lock serialises concurrent admin changes per org so two admins cannot demote each other at once.
create or replace function public.memberships_keep_last_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'admin' or new.status <> 'active' or new.org_id <> old.org_id) then
    perform pg_advisory_xact_lock(hashtext('memberships.admins:' || old.org_id::text));
    if exists (select 1 from public.orgs o where o.id = old.org_id)
       and not exists (select 1 from public.memberships m
                       where m.org_id = old.org_id and m.id <> old.id and m.role = 'admin' and m.status = 'active') then
      raise exception using errcode = 'P0001', message = 'LAST_ADMIN',
        hint = 'An organisation needs at least one active admin.';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger memberships_last_admin before update or delete on public.memberships
  for each row execute function public.memberships_keep_last_admin();

-- ---------------------------------------------------------------------------
-- Access helpers (security definer so policies can read memberships without recursion)
-- ---------------------------------------------------------------------------
create or replace function public.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.memberships m
                  where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active') $$;

create or replace function public.has_org_role(p_org uuid, p_roles public.app_role[]) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.memberships m
                  where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active' and m.role = any (p_roles)) $$;

create or replace function public.shares_org_as_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.memberships mine
                  join public.memberships theirs on theirs.org_id = mine.org_id
                  where mine.user_id = auth.uid() and mine.role = 'admin' and mine.status = 'active' and theirs.user_id = p_user) $$;

-- True when the caller is an active member of the org with at least p_level ('read' | 'write') for p_area.
-- Admins pass for every area.
create or replace function public.has_access(p_org uuid, p_area text, p_level text default 'read') returns boolean
language sql stable security definer set search_path = '' as $$
  select p_level in ('read', 'write') and p_area = any (public.access_areas()) and exists (
    select 1 from public.memberships m
    where m.org_id = p_org and m.user_id = auth.uid() and m.status = 'active'
      and (m.role = 'admin'
           or case p_level when 'read' then coalesce(m.access ->> p_area, 'none') in ('read', 'write')
                           when 'write' then coalesce(m.access ->> p_area, 'none') = 'write'
                           else false end))
$$;

-- True when the caller may see p_user's profile: they share an org where the caller has Users read.
create or replace function public.can_see_member(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships theirs
                 where theirs.user_id = p_user and public.has_access(theirs.org_id, 'users', 'read'))
$$;

-- ---------------------------------------------------------------------------
-- Stock RPCs: the role gate now follows the access map. Admin-only RPCs (correct, dismiss, restore, manual
-- invoice) pass array['admin']; the others (dispatch, move) need Stock write. Inactive members are refused.
-- ---------------------------------------------------------------------------
create or replace function public.stock_require_role(p_org uuid, p_roles public.app_role[]) returns public.app_role
language plpgsql stable set search_path = '' as $$
declare
  v_role public.app_role;
  v_status text;
  v_stock text;
begin
  if auth.uid() is null then perform public.stock_raise('FORBIDDEN'); end if;
  select m.role, m.status, m.access ->> 'stock' into v_role, v_status, v_stock
  from public.memberships m where m.org_id = p_org and m.user_id = auth.uid();
  if v_role is null or v_status is distinct from 'active' then perform public.stock_raise('FORBIDDEN'); end if;
  if v_role = 'admin' then return v_role; end if;
  if not (p_roles && array['staff', 'reviewer', 'inspector', 'factory']::public.app_role[])
     or coalesce(v_stock, 'none') <> 'write' then
    perform public.stock_raise('FORBIDDEN');
  end if;
  return v_role;
end $$;

-- ---------------------------------------------------------------------------
-- RLS: read policies per area
-- ---------------------------------------------------------------------------
-- identity: own row always (so a disabled or invited user can learn their status); others with Users read.
drop policy memberships_select on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
  using (user_id = auth.uid() or public.has_access(org_id, 'users', 'read'));
drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.can_see_member(id));

-- settings write (org, form definitions, recipients, settings)
drop policy orgs_update on public.orgs;
create policy orgs_update on public.orgs for update to authenticated
  using (public.has_access(id, 'settings', 'write')) with check (public.has_access(id, 'settings', 'write'));
drop policy forms_admin on public.forms;
create policy forms_admin on public.forms for all to authenticated
  using (public.has_access(org_id, 'settings', 'write')) with check (public.has_access(org_id, 'settings', 'write'));
drop policy statuses_admin on public.form_statuses;
create policy statuses_admin on public.form_statuses for all to authenticated
  using (public.has_access(org_id, 'settings', 'write')) with check (public.has_access(org_id, 'settings', 'write'));
drop policy roles_admin on public.form_roles;
create policy roles_admin on public.form_roles for all to authenticated
  using (public.has_access(org_id, 'settings', 'write')) with check (public.has_access(org_id, 'settings', 'write'));
drop policy recipients_admin on public.notification_recipients;
create policy recipients_select on public.notification_recipients for select to authenticated
  using (public.has_access(org_id, 'settings', 'read'));
create policy recipients_write on public.notification_recipients for all to authenticated
  using (public.has_access(org_id, 'settings', 'write')) with check (public.has_access(org_id, 'settings', 'write'));
drop policy settings_admin on public.app_settings;
create policy settings_admin on public.app_settings for all to authenticated
  using (public.has_access(org_id, 'settings', 'write')) with check (public.has_access(org_id, 'settings', 'write'));

-- forms: entries and their children (entry_links stays admin-only: its tokens grant access)
drop policy entries_select on public.entries;
create policy entries_select on public.entries for select to authenticated using (public.has_access(org_id, 'forms', 'read'));
drop policy reads_own on public.entry_reads;
create policy reads_own on public.entry_reads for all to authenticated
  using (user_id = auth.uid() and public.has_access(org_id, 'forms', 'read'))
  with check (user_id = auth.uid() and public.has_access(org_id, 'forms', 'read'));
drop policy files_select on public.entry_files;
create policy files_select on public.entry_files for select to authenticated using (public.has_access(org_id, 'forms', 'read'));
drop policy events_select on public.entry_events;
create policy events_select on public.entry_events for select to authenticated using (public.has_access(org_id, 'forms', 'read'));
drop policy email_select on public.email_log;
create policy email_select on public.email_log for select to authenticated using (public.has_access(org_id, 'forms', 'read'));
drop policy docs_select on public.entry_documents;
create policy docs_select on public.entry_documents for select to authenticated using (public.has_access(org_id, 'forms', 'read'));

-- deals, quotes, invoices (the Xero mirror); contacts serve both quotes and invoices; sync state is Integrations
drop policy deal_files_select on public.deal_files;
create policy deal_files_select on public.deal_files for select to authenticated using (public.has_access(org_id, 'deals', 'read'));
drop policy xero_quotes_select on public.xero_quotes;
create policy xero_quotes_select on public.xero_quotes for select to authenticated using (public.has_access(org_id, 'quotes', 'read'));
drop policy xero_quote_lines_select on public.xero_quote_lines;
create policy xero_quote_lines_select on public.xero_quote_lines for select to authenticated using (public.has_access(org_id, 'quotes', 'read'));
drop policy xero_invoices_select on public.xero_invoices;
create policy xero_invoices_select on public.xero_invoices for select to authenticated using (public.has_access(org_id, 'invoices', 'read'));
drop policy xero_invoice_lines_select on public.xero_invoice_lines;
create policy xero_invoice_lines_select on public.xero_invoice_lines for select to authenticated using (public.has_access(org_id, 'invoices', 'read'));
drop policy xero_payments_select on public.xero_payments;
create policy xero_payments_select on public.xero_payments for select to authenticated using (public.has_access(org_id, 'invoices', 'read'));
drop policy xero_attachments_select on public.xero_attachments;
create policy xero_attachments_select on public.xero_attachments for select to authenticated using (public.has_access(org_id, 'invoices', 'read'));
drop policy xero_contacts_select on public.xero_contacts;
create policy xero_contacts_select on public.xero_contacts for select to authenticated
  using (public.has_access(org_id, 'quotes', 'read') or public.has_access(org_id, 'invoices', 'read'));
drop policy xero_sync_state_select on public.xero_sync_state;
create policy xero_sync_state_select on public.xero_sync_state for select to authenticated using (public.has_access(org_id, 'integrations', 'read'));

-- leads
drop policy lead_sources_select on public.lead_sources;
create policy lead_sources_select on public.lead_sources for select to authenticated using (public.has_access(org_id, 'leads', 'read'));
drop policy leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated using (public.has_access(org_id, 'leads', 'read'));
drop policy lead_events_select on public.lead_events;
create policy lead_events_select on public.lead_events for select to authenticated using (public.has_access(org_id, 'leads', 'read'));

-- stock (exceptions carry raw Xero references: stock and invoices, the can() rule for stock.invoices)
drop policy stock_locations_select on public.stock_locations;
create policy stock_locations_select on public.stock_locations for select to authenticated using (public.has_access(org_id, 'stock', 'read'));
drop policy stock_models_select on public.stock_models;
create policy stock_models_select on public.stock_models for select to authenticated using (public.has_access(org_id, 'stock', 'read'));
drop policy stock_deals_select on public.stock_deals;
create policy stock_deals_select on public.stock_deals for select to authenticated using (public.has_access(org_id, 'stock', 'read'));
drop policy stock_deal_dismissals_select on public.stock_deal_dismissals;
create policy stock_deal_dismissals_select on public.stock_deal_dismissals for select to authenticated using (public.has_access(org_id, 'stock', 'read'));
drop policy stock_units_select on public.stock_units;
create policy stock_units_select on public.stock_units for select to authenticated using (public.has_access(org_id, 'stock', 'read'));
drop policy stock_invoice_exceptions_select on public.stock_invoice_exceptions;
create policy stock_invoice_exceptions_select on public.stock_invoice_exceptions for select to authenticated
  using (public.has_access(org_id, 'stock', 'read') and public.has_access(org_id, 'invoices', 'read'));

-- activity: the whole log with Activity read; stock.* rows with Stock read (the stock Activity tab); own rows always
drop policy audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated using (public.has_access(org_id, 'activity', 'read'));
drop policy audit_stock_select on public.audit_log;
create policy audit_stock_select on public.audit_log for select to authenticated
  using (action like 'stock.%' and public.has_access(org_id, 'stock', 'read'));
create policy audit_own_select on public.audit_log for select to authenticated
  using (actor_user = auth.uid() and public.is_org_member(org_id));

-- Activity log filters and the user detail history.
create index audit_log_org_actor_idx on public.audit_log(org_id, actor_user, created_at desc);
create index audit_log_org_entity_idx on public.audit_log(org_id, entity_id);

-- ---------------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------------
revoke all on function public.access_areas(), public.preset_access(public.app_role), public.clamp_access(public.app_role, jsonb),
                       public.valid_access(jsonb), public.has_access(uuid, text, text), public.can_see_member(uuid),
                       public.memberships_access_defaults(), public.memberships_keep_last_admin()
  from public, anon;
grant execute on function public.access_areas(), public.preset_access(public.app_role), public.clamp_access(public.app_role, jsonb),
                          public.valid_access(jsonb), public.has_access(uuid, text, text), public.can_see_member(uuid)
  to authenticated, service_role;
revoke all on function public.stock_require_role(uuid, public.app_role[]) from public, anon, authenticated;
