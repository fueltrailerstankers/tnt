-- 0011: stock control (M6). Units by VIN, stock deals derived from DEAL entries, branch matrix,
-- invoice -> reserved/sold. See docs/M6.md sections 2 and 3.
--
-- Access: every table is org-keyed. Members with stock.read (admin, staff, reviewer, factory) read; nobody writes
-- directly. Writes go through the stock_* RPCs below (security definer, empty search_path, membership and role
-- checked inside, audited) or the service role in server code after requirePerm (deal sync, opening stock).
--
-- RPC errors: RAISE with message = a stable code (VIN_EXISTS, DEAL_NOT_FOUND, ...), hint = 'stock' and
-- detail = JSON context (ids, VIN, model, location, status, deal year/number, invoice number). Never personal
-- data. lib/stock/errors.ts maps the codes to the copy shown to users.
--
-- Audit: audit_log rows with action 'stock.<verb>' (dispatch, move, correct, dismiss, restore, reserve, sell,
-- exception) and meta holding ids, VIN, invoice number, model, location codes and deal year/number only.
-- Free text (notes, reasons, references) never goes into the audit meta.

-- ---------------------------------------------------------------------------
-- Reference data: locations and product models
-- ---------------------------------------------------------------------------
create table public.stock_locations (
  org_id uuid not null references public.orgs(id) on delete cascade,
  id text not null check (id ~ '^[A-Z][A-Z0-9_]{1,15}$'),       -- FACTORY, JHB, CPT, DBN
  name text not null,
  is_factory boolean not null default false,
  sort_order int not null default 0,
  primary key (org_id, id)
);
create unique index stock_locations_one_factory_idx on public.stock_locations(org_id) where is_factory;

create table public.stock_models (
  org_id uuid not null references public.orgs(id) on delete cascade,
  part_number text not null check (part_number ~ '^[A-Z0-9][A-Z0-9_./-]*$'),
  description text not null,
  category text not null check (category in ('animal_trailer', 'car_trailer', 'metal_bowser', 'poly_bowser',
                                             'stainless_bowser', 'cradle_tank', 'skid_tank', 'cargo_trailer', 'vendor_box')),
  active boolean not null default true,
  sort_order int not null,
  primary key (org_id, part_number)
);

-- ---------------------------------------------------------------------------
-- Deals (one per DEAL entry; written by the deal sync job with the service role) and units
-- ---------------------------------------------------------------------------
create table public.stock_deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  entry_id uuid references public.entries(id) on delete set null,
  year int not null check (year between 2000 and 2100),
  number int not null check (number > 0),                          -- the DEAL entry number ("sequence")
  location_id text,                                                -- null when the DEAL names no known branch
  model_part text,                                                 -- null = "Model not recognised"
  quote_number text check (quote_number is null or char_length(quote_number) <= 50),
  accessories text[] not null default '{}' check (cardinality(accessories) <= 10),
  status text not null default 'awaiting_dispatch' check (status in ('awaiting_dispatch', 'dispatched', 'dismissed')),
  unit_id uuid,
  dismissed_reason text check (dismissed_reason is null or char_length(dismissed_reason) <= 200),
  dismissed_at timestamptz,
  dismissed_by uuid references auth.users(id) on delete set null,
  dispatched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, year, number),
  unique (org_id, entry_id),
  unique (org_id, id),
  foreign key (org_id, location_id) references public.stock_locations(org_id, id),
  foreign key (org_id, model_part) references public.stock_models(org_id, part_number),
  constraint stock_deals_dispatched_has_unit check ((status = 'dispatched') = (unit_id is not null)),
  constraint stock_deals_dismissed_has_reason check (status <> 'dismissed' or dismissed_reason is not null)
);

create table public.stock_units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  vin text not null,
  vin_norm text generated always as (upper(regexp_replace(vin, '\s', '', 'g'))) stored,
  deal_year int check (deal_year between 2000 and 2100),
  sequence int check (sequence > 0),
  deal_id uuid,
  model_part text not null,
  location_id text not null,
  status text not null default 'available' check (status in ('available', 'reserved', 'sold')),
  invoice_number text check (invoice_number is null or (invoice_number = upper(btrim(invoice_number)) and invoice_number <> '' and char_length(invoice_number) <= 50)),
  xero_invoice_id text,
  dispatch_date date,
  accessories text[] not null default '{}' check (cardinality(accessories) <= 10),
  notes text check (notes is null or char_length(notes) <= 2000),
  transfer_reason text check (transfer_reason is null or char_length(transfer_reason) <= 200),  -- last transfer
  sold_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id),
  foreign key (org_id, deal_id) references public.stock_deals(org_id, id),
  foreign key (org_id, model_part) references public.stock_models(org_id, part_number),
  foreign key (org_id, location_id) references public.stock_locations(org_id, id),
  constraint stock_units_vin_length check (char_length(upper(regexp_replace(vin, '\s', '', 'g'))) between 5 and 40),
  constraint stock_units_sold_at check (status = 'sold' or sold_at is null)
);

alter table public.stock_deals add constraint stock_deals_unit_fk
  foreign key (org_id, unit_id) references public.stock_units(org_id, id);

-- VIN is unique per org on its normalised form, across every unit including sold ones.
create unique index stock_units_vin_key on public.stock_units(org_id, vin_norm);
-- One invoice covers one unit.
create unique index stock_units_invoice_key on public.stock_units(org_id, invoice_number) where invoice_number is not null;
-- One deal = one unit.
create unique index stock_units_deal_key on public.stock_units(deal_id) where deal_id is not null;
create unique index stock_deals_unit_key on public.stock_deals(unit_id) where unit_id is not null;
-- Register search (VIN / invoice prefix, sequence, model, location, status) and the matrix.
create index stock_units_vin_prefix_idx on public.stock_units(org_id, vin_norm text_pattern_ops);
create index stock_units_invoice_prefix_idx on public.stock_units(org_id, invoice_number text_pattern_ops) where invoice_number is not null;
create index stock_units_sequence_idx on public.stock_units(org_id, deal_year, sequence);
create index stock_units_model_idx on public.stock_units(org_id, model_part, location_id) where status <> 'sold';
create index stock_units_location_status_idx on public.stock_units(org_id, location_id, status);
create index stock_units_status_idx on public.stock_units(org_id, status);
create index stock_units_created_idx on public.stock_units(org_id, created_at desc);
create index stock_deals_status_idx on public.stock_deals(org_id, status, year, location_id);
create index stock_deals_entry_idx on public.stock_deals(entry_id);

-- Invoices that could not be applied automatically (voids, credit notes, VIN problems, conflicts).
create table public.stock_invoice_exceptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  xero_invoice_id text,
  invoice_number text,
  reference text check (reference is null or char_length(reference) <= 500),
  reason text not null check (reason ~ '^[a-z_]{1,40}$'),
  unit_id uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution text check (resolution is null or char_length(resolution) <= 500),
  foreign key (org_id, unit_id) references public.stock_units(org_id, id),
  constraint stock_invoice_exceptions_has_invoice check (invoice_number is not null or xero_invoice_id is not null)
);
create unique index stock_invoice_exceptions_open_key on public.stock_invoice_exceptions
  (org_id, (coalesce(invoice_number, xero_invoice_id)), reason) where resolved_at is null;
create index stock_invoice_exceptions_open_idx on public.stock_invoice_exceptions(org_id, created_at desc) where resolved_at is null;
create index stock_invoice_exceptions_unit_idx on public.stock_invoice_exceptions(unit_id) where unit_id is not null;

-- Timestamps and org keying
create trigger stock_deals_bu before update on public.stock_deals for each row execute function public.touch_updated_at();
create trigger stock_units_bu before update on public.stock_units for each row execute function public.touch_updated_at();
-- A deal linked to a DEAL entry always takes the entry's org.
create trigger stock_deals_org before insert or update on public.stock_deals
  for each row execute function public.tg_org_from_parent('entries', 'entry_id');

-- ---------------------------------------------------------------------------
-- Stock by model x location: qty = available + reserved, reserved count; sold excluded. RLS of the caller applies.
-- ---------------------------------------------------------------------------
create view public.stock_matrix with (security_invoker = true) as
select m.org_id, m.part_number, m.description, m.category, m.active, m.sort_order, u.location_id,
       (count(u.id) filter (where u.status in ('available', 'reserved')))::int as qty,
       (count(u.id) filter (where u.status = 'reserved'))::int as reserved
from public.stock_models m
left join public.stock_units u on u.org_id = m.org_id and u.model_part = m.part_number and u.status <> 'sold'
group by m.org_id, m.part_number, m.description, m.category, m.active, m.sort_order, u.location_id;

-- ---------------------------------------------------------------------------
-- RLS and grants: read for stock.read roles; no client writes
-- ---------------------------------------------------------------------------
alter table public.stock_locations enable row level security;
alter table public.stock_models enable row level security;
alter table public.stock_deals enable row level security;
alter table public.stock_units enable row level security;
alter table public.stock_invoice_exceptions enable row level security;

create policy stock_locations_select on public.stock_locations for select to authenticated
  using (public.has_org_role(org_id, array['admin', 'staff', 'reviewer', 'factory']::public.app_role[]));
create policy stock_models_select on public.stock_models for select to authenticated
  using (public.has_org_role(org_id, array['admin', 'staff', 'reviewer', 'factory']::public.app_role[]));
create policy stock_deals_select on public.stock_deals for select to authenticated
  using (public.has_org_role(org_id, array['admin', 'staff', 'reviewer', 'factory']::public.app_role[]));
create policy stock_units_select on public.stock_units for select to authenticated
  using (public.has_org_role(org_id, array['admin', 'staff', 'reviewer', 'factory']::public.app_role[]));
-- Exceptions carry the raw Xero reference: same audience as the Xero mirror (not factory).
create policy stock_invoice_exceptions_select on public.stock_invoice_exceptions for select to authenticated
  using (public.has_org_role(org_id, array['admin', 'staff', 'reviewer']::public.app_role[]));

revoke all on public.stock_locations, public.stock_models, public.stock_deals, public.stock_units,
              public.stock_invoice_exceptions, public.stock_matrix from anon, authenticated;
grant select on public.stock_locations, public.stock_models, public.stock_deals, public.stock_units,
                public.stock_invoice_exceptions, public.stock_matrix to authenticated;
grant all on public.stock_locations, public.stock_models, public.stock_deals, public.stock_units,
             public.stock_invoice_exceptions, public.stock_matrix to service_role;

-- The Activity page (stock.read) reads the stock.* audit rows; their meta holds ids and codes only.
create policy audit_stock_select on public.audit_log for select to authenticated
  using (action like 'stock.%' and public.has_org_role(org_id, array['admin', 'staff', 'reviewer', 'factory']::public.app_role[]));

-- Factory staff see stock only: never entries (and their files, events, documents, emails) or the Xero mirror,
-- even through the API with their own token. Restrictive: narrows the existing member policies for this role.
do $$
declare t text;
begin
  foreach t in array array['entries', 'entry_reads', 'entry_files', 'entry_events', 'entry_links', 'entry_documents',
                           'email_log', 'xero_contacts', 'xero_quotes', 'xero_quote_lines', 'xero_invoices',
                           'xero_invoice_lines', 'xero_payments', 'xero_attachments', 'xero_sync_state', 'deal_files',
                           'leads', 'lead_events'] loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (not public.has_org_role(org_id, array[''factory'']::public.app_role[]))',
      t || '_not_factory', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients)
-- ---------------------------------------------------------------------------
create or replace function public.stock_raise(p_code text, p_detail jsonb default '{}'::jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, '{}'::jsonb)::text, hint = 'stock';
end $$;

-- True when the request carries the service role (the server's jobs). Clients cannot set these claims.
create or replace function public.stock_is_service() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
$$;

-- The caller's role in the org when it is one of p_roles; FORBIDDEN otherwise (signed out, not a member, wrong role).
create or replace function public.stock_require_role(p_org uuid, p_roles public.app_role[]) returns public.app_role
language plpgsql stable set search_path = '' as $$
declare v_role public.app_role;
begin
  if auth.uid() is null then perform public.stock_raise('FORBIDDEN'); end if;
  select m.role into v_role from public.memberships m where m.org_id = p_org and m.user_id = auth.uid();
  if v_role is null or not (v_role = any (p_roles)) then perform public.stock_raise('FORBIDDEN'); end if;
  return v_role;
end $$;

-- Trimmed, non-empty accessory lines; at most 10 of at most 200 characters.
create or replace function public.stock_clean_accessories(p text[]) returns text[]
language plpgsql set search_path = '' as $$
declare v text[];
begin
  select coalesce(array_agg(btrim(a) order by o), '{}'::text[]) into v
  from unnest(coalesce(p, '{}'::text[])) with ordinality as t(a, o)
  where nullif(btrim(a), '') is not null;
  if cardinality(v) > 10 then
    perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'accessories', 'max', 10));
  end if;
  if exists (select 1 from unnest(v) a where char_length(a) > 200) then
    perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'accessories', 'max_length', 200));
  end if;
  return v;
end $$;

create or replace function public.stock_audit(p_org uuid, p_action text, p_entity text, p_entity_id text, p_meta jsonb) returns void
language sql set search_path = '' as $$
  insert into public.audit_log(org_id, actor_user, action, entity, entity_id, meta)
  values (p_org, auth.uid(), p_action, p_entity, p_entity_id, jsonb_strip_nulls(p_meta));
$$;

-- Error context for a unit: ids and codes only.
create or replace function public.stock_unit_detail(p_unit public.stock_units) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'unit_id', p_unit.id, 'vin', p_unit.vin_norm, 'model', p_unit.model_part, 'deal_year', p_unit.deal_year,
    'sequence', p_unit.sequence, 'location', p_unit.location_id,
    'location_name', (select l.name from public.stock_locations l where l.org_id = p_unit.org_id and l.id = p_unit.location_id),
    'status', p_unit.status, 'invoice_number', p_unit.invoice_number)
$$;

-- Raises unless the (locked) deal can take a dispatch. p_deal has null fields when no deal was found.
create or replace function public.stock_check_deal(p_deal public.stock_deals, p_year int, p_number int) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_deal.id is null then
    perform public.stock_raise('DEAL_NOT_FOUND', jsonb_build_object('year', p_year, 'number', p_number));
  end if;
  if p_deal.status = 'dismissed' then
    perform public.stock_raise('DEAL_DISMISSED', jsonb_build_object('deal_id', p_deal.id, 'year', p_deal.year, 'number', p_deal.number));
  end if;
  if p_deal.status = 'dispatched' then
    perform public.stock_raise('DEAL_ALREADY_DISPATCHED', jsonb_build_object(
      'deal_id', p_deal.id, 'year', p_deal.year, 'number', p_deal.number, 'unit_id', p_deal.unit_id,
      'vin', (select u.vin_norm from public.stock_units u where u.id = p_deal.unit_id)));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- stock_dispatch_unit [admin, staff, factory]
-- Free mode (no deal) or against a deal (year + number). The VIN is checked against every unit, sold included.
-- A VIN already registered at the Factory and not sold, dispatched to a branch, raises FACTORY_UNIT_EXISTS so
-- the UI can offer stock_move_unit instead. Dispatching to the Factory itself registers factory stock.
-- ---------------------------------------------------------------------------
create or replace function public.stock_dispatch_unit(
  p_org uuid, p_vin text, p_model text, p_location text, p_date date default null,
  p_accessories text[] default '{}'::text[], p_notes text default null,
  p_deal_year int default null, p_deal_number int default null
) returns public.stock_units
language plpgsql security definer set search_path = '' as $$
declare
  v_norm text := upper(regexp_replace(coalesce(p_vin, ''), '\s', '', 'g'));
  v_model text := upper(regexp_replace(coalesce(p_model, ''), '\s', '', 'g'));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_loc public.stock_locations;
  v_deal public.stock_deals;
  v_other public.stock_units;
  v_other_at_factory boolean;
  v_acc text[];
  v_unit public.stock_units;
begin
  perform public.stock_require_role(p_org, array['admin', 'staff', 'factory']::public.app_role[]);

  if char_length(v_norm) not between 5 and 40 then
    perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'vin'));
  end if;
  if not exists (select 1 from public.stock_models m where m.org_id = p_org and m.part_number = v_model and m.active) then
    perform public.stock_raise('MODEL_NOT_FOUND', jsonb_build_object('model', left(v_model, 40)));
  end if;
  select * into v_loc from public.stock_locations l where l.org_id = p_org and l.id = upper(btrim(coalesce(p_location, '')));
  if not found then
    perform public.stock_raise('LOCATION_NOT_FOUND', jsonb_build_object('location', left(p_location, 20)));
  end if;
  v_acc := public.stock_clean_accessories(p_accessories);
  if char_length(v_notes) > 2000 then
    perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'notes', 'max_length', 2000));
  end if;
  if (p_deal_year is null) <> (p_deal_number is null) then
    perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'deal'));
  end if;

  if p_deal_year is not null then
    select * into v_deal from public.stock_deals d
    where d.org_id = p_org and d.year = p_deal_year and d.number = p_deal_number
    for update;
    perform public.stock_check_deal(v_deal, p_deal_year, p_deal_number);
  end if;

  select * into v_other from public.stock_units u where u.org_id = p_org and u.vin_norm = v_norm;
  if found then
    select l.is_factory into v_other_at_factory from public.stock_locations l
    where l.org_id = p_org and l.id = v_other.location_id;
    if v_other_at_factory and v_other.status <> 'sold' and not v_loc.is_factory then
      perform public.stock_raise('FACTORY_UNIT_EXISTS', public.stock_unit_detail(v_other) || jsonb_build_object('to', v_loc.id));
    end if;
    perform public.stock_raise('VIN_EXISTS', public.stock_unit_detail(v_other));
  end if;

  begin
    insert into public.stock_units(org_id, vin, deal_year, sequence, deal_id, model_part, location_id, status,
                                   dispatch_date, accessories, notes, created_by)
    values (p_org, v_norm, v_deal.year, v_deal.number, v_deal.id, v_model, v_loc.id, 'available',
            coalesce(p_date, (now() at time zone 'Africa/Johannesburg')::date), v_acc, v_notes, auth.uid())
    returning * into v_unit;
  exception when unique_violation then
    -- A concurrent dispatch registered the same VIN first.
    perform public.stock_raise('VIN_EXISTS', jsonb_build_object('vin', v_norm));
  end;

  if v_deal.id is not null then
    update public.stock_deals d set status = 'dispatched', unit_id = v_unit.id, dispatched_at = now() where d.id = v_deal.id;
  end if;

  perform public.stock_audit(p_org, 'stock.dispatch', 'stock_unit', v_unit.id::text, jsonb_build_object(
    'unit_id', v_unit.id, 'vin', v_unit.vin_norm, 'model', v_unit.model_part, 'location', v_unit.location_id,
    'deal_id', v_deal.id, 'deal_year', v_deal.year, 'deal_number', v_deal.number));
  return v_unit;
end $$;

-- ---------------------------------------------------------------------------
-- stock_move_unit [admin: any transfer; staff and factory: Factory -> branch only]
-- A reason is required for every transfer except Factory -> branch. Optionally links a deal (year + number) to a
-- unit that has none, which clears the deal like a dispatch (factory stock registered before its deal existed).
-- Factory -> branch sets the dispatch date to today (Africa/Johannesburg).
-- ---------------------------------------------------------------------------
create or replace function public.stock_move_unit(
  p_org uuid, p_unit uuid, p_location text, p_reason text default null,
  p_deal_year int default null, p_deal_number int default null
) returns public.stock_units
language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role;
  v_unit public.stock_units;
  v_from public.stock_locations;
  v_to public.stock_locations;
  v_deal public.stock_deals;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_factory_to_branch boolean;
begin
  v_role := public.stock_require_role(p_org, array['admin', 'staff', 'factory']::public.app_role[]);

  select * into v_unit from public.stock_units u where u.org_id = p_org and u.id = p_unit for update;
  if not found then
    perform public.stock_raise('UNIT_NOT_FOUND', jsonb_build_object('unit_id', p_unit));
  end if;
  select * into v_to from public.stock_locations l where l.org_id = p_org and l.id = upper(btrim(coalesce(p_location, '')));
  if not found then
    perform public.stock_raise('LOCATION_NOT_FOUND', jsonb_build_object('location', left(p_location, 20)));
  end if;
  select * into v_from from public.stock_locations l where l.org_id = p_org and l.id = v_unit.location_id;
  v_factory_to_branch := v_from.is_factory and not v_to.is_factory;

  if v_role <> 'admin' and not v_factory_to_branch then
    perform public.stock_raise('FORBIDDEN');
  end if;
  if v_unit.status = 'sold' then
    perform public.stock_raise('UNIT_SOLD', public.stock_unit_detail(v_unit));
  end if;
  if v_to.id = v_from.id then
    perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'location', 'reason', 'same_location'));
  end if;
  if v_reason is null and not v_factory_to_branch then
    perform public.stock_raise('REASON_REQUIRED');
  end if;
  if char_length(v_reason) > 200 then
    perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'reason', 'max_length', 200));
  end if;
  if (p_deal_year is null) <> (p_deal_number is null) then
    perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'deal'));
  end if;

  if p_deal_year is not null then
    if v_unit.deal_id is not null then
      perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'deal', 'reason', 'unit_has_deal'));
    end if;
    select * into v_deal from public.stock_deals d
    where d.org_id = p_org and d.year = p_deal_year and d.number = p_deal_number
    for update;
    perform public.stock_check_deal(v_deal, p_deal_year, p_deal_number);
  end if;

  update public.stock_units u set
    location_id = v_to.id,
    transfer_reason = v_reason,
    dispatch_date = case when v_factory_to_branch then (now() at time zone 'Africa/Johannesburg')::date else u.dispatch_date end,
    deal_id = coalesce(v_deal.id, u.deal_id),
    deal_year = coalesce(v_deal.year, u.deal_year),
    sequence = coalesce(v_deal.number, u.sequence)
  where u.id = v_unit.id
  returning * into v_unit;

  if v_deal.id is not null then
    update public.stock_deals d set status = 'dispatched', unit_id = v_unit.id, dispatched_at = now() where d.id = v_deal.id;
  end if;

  perform public.stock_audit(p_org, 'stock.move', 'stock_unit', v_unit.id::text, jsonb_build_object(
    'unit_id', v_unit.id, 'vin', v_unit.vin_norm, 'model', v_unit.model_part, 'from', v_from.id, 'to', v_to.id,
    'deal_id', v_deal.id, 'deal_year', v_deal.year, 'deal_number', v_deal.number));
  return v_unit;
end $$;

-- ---------------------------------------------------------------------------
-- stock_correct_unit [admin]: edit a unit record. p_fields is a JSON object with any of
-- vin, model_part, location_id, status, invoice_number, xero_invoice_id, dispatch_date, accessories (array), notes,
-- deal_year, sequence (the last two only on units not linked to a deal). Unknown keys are rejected.
-- The audit row lists the changed field keys, never the values (VIN excepted).
-- ---------------------------------------------------------------------------
create or replace function public.stock_correct_unit(p_org uuid, p_unit uuid, p_fields jsonb) returns public.stock_units
language plpgsql security definer set search_path = '' as $$
declare
  c_allowed constant text[] := array['vin', 'model_part', 'location_id', 'status', 'invoice_number', 'xero_invoice_id',
                                     'dispatch_date', 'accessories', 'notes', 'deal_year', 'sequence'];
  v_bad text[];
  v_old public.stock_units;
  v_new public.stock_units;
  v_other public.stock_units;
  v_changed text[];
  v_constraint text;
begin
  perform public.stock_require_role(p_org, array['admin']::public.app_role[]);

  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or p_fields = '{}'::jsonb then
    perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'fields'));
  end if;
  select array_agg(left(k, 40) order by k) into v_bad from jsonb_object_keys(p_fields) k where not (k = any (c_allowed));
  if v_bad is not null then
    perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'fields', 'unknown', v_bad));
  end if;

  select * into v_old from public.stock_units u where u.org_id = p_org and u.id = p_unit for update;
  if not found then
    perform public.stock_raise('UNIT_NOT_FOUND', jsonb_build_object('unit_id', p_unit));
  end if;
  v_new := v_old;

  if p_fields ? 'vin' then
    v_new.vin := upper(regexp_replace(coalesce(p_fields ->> 'vin', ''), '\s', '', 'g'));
    if char_length(v_new.vin) not between 5 and 40 then
      perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'vin'));
    end if;
    select * into v_other from public.stock_units u where u.org_id = p_org and u.vin_norm = v_new.vin and u.id <> v_old.id;
    if found then
      perform public.stock_raise('VIN_EXISTS', public.stock_unit_detail(v_other));
    end if;
    if v_new.vin = v_old.vin_norm then v_new.vin := v_old.vin; end if;   -- same VIN, only spacing/case differed
  end if;
  if p_fields ? 'model_part' then
    v_new.model_part := upper(regexp_replace(coalesce(p_fields ->> 'model_part', ''), '\s', '', 'g'));
    if not exists (select 1 from public.stock_models m where m.org_id = p_org and m.part_number = v_new.model_part) then
      perform public.stock_raise('MODEL_NOT_FOUND', jsonb_build_object('model', left(v_new.model_part, 40)));
    end if;
  end if;
  if p_fields ? 'location_id' then
    v_new.location_id := upper(btrim(coalesce(p_fields ->> 'location_id', '')));
    if not exists (select 1 from public.stock_locations l where l.org_id = p_org and l.id = v_new.location_id) then
      perform public.stock_raise('LOCATION_NOT_FOUND', jsonb_build_object('location', left(v_new.location_id, 20)));
    end if;
  end if;
  if p_fields ? 'status' then
    v_new.status := p_fields ->> 'status';
    if v_new.status is null or v_new.status not in ('available', 'reserved', 'sold') then
      perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'status'));
    end if;
  end if;
  if p_fields ? 'invoice_number' then
    v_new.invoice_number := nullif(upper(btrim(coalesce(p_fields ->> 'invoice_number', ''))), '');
    if char_length(v_new.invoice_number) > 50 then
      perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'invoice_number', 'max_length', 50));
    end if;
    select * into v_other from public.stock_units u
    where u.org_id = p_org and u.invoice_number = v_new.invoice_number and u.id <> v_old.id;
    if found then
      perform public.stock_raise('INVOICE_LINKED_OTHER_UNIT', jsonb_build_object(
        'invoice_number', v_new.invoice_number, 'unit_id', v_old.id, 'other_unit_id', v_other.id, 'other_vin', v_other.vin_norm));
    end if;
    if v_new.invoice_number is distinct from v_old.invoice_number and not (p_fields ? 'xero_invoice_id') then
      v_new.xero_invoice_id := null;   -- the old Xero id belongs to the old invoice number
    end if;
  end if;
  if p_fields ? 'xero_invoice_id' then
    v_new.xero_invoice_id := nullif(btrim(coalesce(p_fields ->> 'xero_invoice_id', '')), '');
  end if;
  if p_fields ? 'dispatch_date' then
    -- ISO dates only (Postgres would also accept words such as 'yesterday').
    if coalesce(p_fields ->> 'dispatch_date', '') !~ '^(\d{4}-\d{2}-\d{2})?$' then
      perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'dispatch_date'));
    end if;
    begin
      v_new.dispatch_date := nullif(p_fields ->> 'dispatch_date', '')::date;
    exception when others then
      perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'dispatch_date'));
    end;
  end if;
  if p_fields ? 'accessories' then
    if jsonb_typeof(p_fields -> 'accessories') <> 'array' then
      perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'accessories'));
    end if;
    v_new.accessories := public.stock_clean_accessories(array(select jsonb_array_elements_text(p_fields -> 'accessories')));
  end if;
  if p_fields ? 'notes' then
    v_new.notes := nullif(btrim(coalesce(p_fields ->> 'notes', '')), '');
    if char_length(v_new.notes) > 2000 then
      perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'notes', 'max_length', 2000));
    end if;
  end if;
  if p_fields ? 'deal_year' or p_fields ? 'sequence' then
    if v_old.deal_id is not null then
      perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'deal', 'reason', 'unit_has_deal'));
    end if;
    begin
      if p_fields ? 'deal_year' then v_new.deal_year := nullif(p_fields ->> 'deal_year', '')::int; end if;
      if p_fields ? 'sequence' then v_new.sequence := nullif(p_fields ->> 'sequence', '')::int; end if;
    exception when others then
      perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'deal'));
    end;
  end if;

  if v_new.status = 'sold' and v_old.status <> 'sold' then v_new.sold_at := now();
  elsif v_new.status <> 'sold' then v_new.sold_at := null;
  end if;

  v_changed := array_remove(array[
    case when v_new.vin is distinct from v_old.vin then 'vin' end,
    case when v_new.model_part is distinct from v_old.model_part then 'model_part' end,
    case when v_new.location_id is distinct from v_old.location_id then 'location_id' end,
    case when v_new.status is distinct from v_old.status then 'status' end,
    case when v_new.invoice_number is distinct from v_old.invoice_number then 'invoice_number' end,
    case when v_new.xero_invoice_id is distinct from v_old.xero_invoice_id then 'xero_invoice_id' end,
    case when v_new.dispatch_date is distinct from v_old.dispatch_date then 'dispatch_date' end,
    case when v_new.accessories is distinct from v_old.accessories then 'accessories' end,
    case when v_new.notes is distinct from v_old.notes then 'notes' end,
    case when v_new.deal_year is distinct from v_old.deal_year then 'deal_year' end,
    case when v_new.sequence is distinct from v_old.sequence then 'sequence' end
  ], null);
  if cardinality(v_changed) = 0 then
    return v_old;   -- nothing changed: no write, no audit row
  end if;

  begin
    update public.stock_units u set
      vin = v_new.vin, model_part = v_new.model_part, location_id = v_new.location_id, status = v_new.status,
      invoice_number = v_new.invoice_number, xero_invoice_id = v_new.xero_invoice_id, dispatch_date = v_new.dispatch_date,
      accessories = v_new.accessories, notes = v_new.notes, deal_year = v_new.deal_year, sequence = v_new.sequence,
      sold_at = v_new.sold_at
    where u.id = v_old.id
    returning * into v_new;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'stock_units_invoice_key' then
        perform public.stock_raise('INVOICE_LINKED_OTHER_UNIT', jsonb_build_object('invoice_number', v_new.invoice_number, 'unit_id', v_old.id));
      end if;
      perform public.stock_raise('VIN_EXISTS', jsonb_build_object('vin', v_new.vin));
    when check_violation then
      perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'fields'));
  end;

  perform public.stock_audit(p_org, 'stock.correct', 'stock_unit', v_new.id::text, jsonb_build_object(
    'unit_id', v_new.id, 'vin', v_new.vin_norm, 'model', v_new.model_part,
    'previous_vin', case when 'vin' = any (v_changed) then v_old.vin_norm end,
    'changed', to_jsonb(v_changed)));
  return v_new;
end $$;

-- ---------------------------------------------------------------------------
-- stock_dismiss_deal / stock_restore_deal [admin only]. Dismiss needs a reason (kept on the deal, not in the audit).
-- ---------------------------------------------------------------------------
create or replace function public.stock_dismiss_deal(p_org uuid, p_deal uuid, p_reason text) returns public.stock_deals
language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_deal public.stock_deals;
begin
  perform public.stock_require_role(p_org, array['admin']::public.app_role[]);
  if v_reason is null then perform public.stock_raise('REASON_REQUIRED'); end if;
  if char_length(v_reason) > 200 then
    perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'reason', 'max_length', 200));
  end if;

  select * into v_deal from public.stock_deals d where d.org_id = p_org and d.id = p_deal for update;
  if not found then perform public.stock_raise('DEAL_NOT_FOUND', jsonb_build_object('deal_id', p_deal)); end if;
  if v_deal.status = 'dispatched' then
    perform public.stock_check_deal(v_deal, v_deal.year, v_deal.number);   -- DEAL_ALREADY_DISPATCHED with the VIN
  end if;
  if v_deal.status = 'dismissed' then
    perform public.stock_raise('DEAL_DISMISSED', jsonb_build_object('deal_id', v_deal.id, 'year', v_deal.year, 'number', v_deal.number));
  end if;

  update public.stock_deals d set status = 'dismissed', dismissed_reason = v_reason, dismissed_at = now(), dismissed_by = auth.uid()
  where d.id = v_deal.id
  returning * into v_deal;

  perform public.stock_audit(p_org, 'stock.dismiss', 'stock_deal', v_deal.id::text,
    jsonb_build_object('deal_id', v_deal.id, 'deal_year', v_deal.year, 'deal_number', v_deal.number));
  return v_deal;
end $$;

create or replace function public.stock_restore_deal(p_org uuid, p_deal uuid) returns public.stock_deals
language plpgsql security definer set search_path = '' as $$
declare
  v_deal public.stock_deals;
begin
  perform public.stock_require_role(p_org, array['admin']::public.app_role[]);

  select * into v_deal from public.stock_deals d where d.org_id = p_org and d.id = p_deal for update;
  if not found then perform public.stock_raise('DEAL_NOT_FOUND', jsonb_build_object('deal_id', p_deal)); end if;
  if v_deal.status <> 'dismissed' then
    perform public.stock_raise('DEAL_NOT_DISMISSED', jsonb_build_object('deal_id', v_deal.id, 'year', v_deal.year, 'number', v_deal.number, 'status', v_deal.status));
  end if;

  update public.stock_deals d set status = 'awaiting_dispatch', dismissed_reason = null, dismissed_at = null, dismissed_by = null
  where d.id = v_deal.id
  returning * into v_deal;

  perform public.stock_audit(p_org, 'stock.restore', 'stock_deal', v_deal.id::text,
    jsonb_build_object('deal_id', v_deal.id, 'deal_year', v_deal.year, 'deal_number', v_deal.number));
  return v_deal;
end $$;

-- ---------------------------------------------------------------------------
-- stock_apply_invoice [admin: modes preview, manual; service role (the stock.invoices job): preview, live]
-- p_outcome: 'reserved' | 'sold' (from lib/stock/invoice.ts invoiceOutcome, or the admin's manual choice), or
-- 'exception:<reason>' for outcomes the rules already decided are exceptions (voided, credit_note, ...).
-- The VIN is matched here, authoritatively: exact normalised reference first, else the one unit whose VIN the
-- normalised reference contains. Conflicts (VIN missing/unknown/ambiguous, invoice on another unit, unit on another
-- invoice, sold unit invoiced as unpaid) change nothing:
--   preview -> returned; live -> recorded once per (invoice, reason) in stock_invoice_exceptions; manual -> raised.
-- The same invoice state applied twice is a no-op ('noop', no audit row).
-- ---------------------------------------------------------------------------
create or replace function public.stock_apply_invoice(
  p_org uuid, p_invoice_number text, p_xero_invoice_id text, p_reference text, p_outcome text, p_mode text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_service boolean := public.stock_is_service();
  v_inv text := nullif(upper(btrim(coalesce(p_invoice_number, ''))), '');
  v_xid text := nullif(btrim(coalesce(p_xero_invoice_id, '')), '');
  v_ref text := upper(regexp_replace(coalesce(p_reference, ''), '\s', '', 'g'));
  v_target text;
  v_reason text;
  v_code text;
  v_match text;
  v_hits int;
  v_unit public.stock_units;
  v_holder public.stock_units;
  v_exc uuid;
  v_from text;
begin
  if p_mode is null or p_mode not in ('preview', 'live', 'manual') then
    perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'mode'));
  end if;
  if v_service then
    if p_mode = 'manual' then perform public.stock_raise('FORBIDDEN'); end if;
    if not exists (select 1 from public.orgs o where o.id = p_org) then
      perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'org'));
    end if;
  else
    perform public.stock_require_role(p_org, array['admin']::public.app_role[]);
    if p_mode = 'live' then perform public.stock_raise('FORBIDDEN'); end if;
  end if;

  if p_outcome in ('reserved', 'sold') then
    v_target := p_outcome;
  elsif p_outcome ~ '^exception:[a-z_]{1,40}$' and p_mode <> 'manual' then
    v_reason := substr(p_outcome, 11);
  else
    perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'outcome'));
  end if;
  if v_inv is null and (v_target is not null or v_xid is null) then
    perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'invoice_number'));
  end if;
  if char_length(v_inv) > 50 or char_length(v_xid) > 100 then
    perform public.stock_raise('INVALID_INPUT', jsonb_build_object('field', 'invoice_number', 'max_length', 50));
  end if;

  -- One invoice at a time (the job and a manual apply may race).
  perform pg_advisory_xact_lock(hashtextextended('stock.invoice:' || p_org::text || ':' || coalesce(v_inv, v_xid), 0));

  if v_ref = '' then
    v_match := 'missing';
  else
    select * into v_unit from public.stock_units u where u.org_id = p_org and u.vin_norm = v_ref for update;
    if found then
      v_match := 'found';
    else
      select count(*) into v_hits from public.stock_units u where u.org_id = p_org and strpos(v_ref, u.vin_norm) > 0;
      if v_hits = 1 then
        select * into v_unit from public.stock_units u where u.org_id = p_org and strpos(v_ref, u.vin_norm) > 0 for update;
        v_match := 'found';
      elsif v_hits > 1 then
        v_match := 'ambiguous';
      else
        v_match := 'none';
      end if;
    end if;
  end if;

  if v_target is not null then
    if v_match = 'missing' then v_reason := 'missing_vin'; v_code := 'VIN_NOT_FOUND';
    elsif v_match = 'none' then v_reason := 'vin_not_found'; v_code := 'VIN_NOT_FOUND';
    elsif v_match = 'ambiguous' then v_reason := 'vin_ambiguous'; v_code := 'VIN_AMBIGUOUS';
    else
      select * into v_holder from public.stock_units u
      where u.org_id = p_org and u.invoice_number = v_inv and u.id <> v_unit.id;
      if found then
        v_reason := 'invoice_linked_other_unit'; v_code := 'INVOICE_LINKED_OTHER_UNIT';
      elsif v_unit.invoice_number is not null and v_unit.invoice_number <> v_inv then
        v_reason := 'unit_linked_other_invoice'; v_code := 'UNIT_LINKED_OTHER_INVOICE';
      elsif v_unit.status = 'sold' and v_target = 'reserved' then
        v_reason := 'unit_sold'; v_code := 'UNIT_SOLD';
      end if;
    end if;
  end if;

  if v_reason is not null then
    if p_mode = 'manual' then
      perform public.stock_raise(v_code, jsonb_build_object(
        'invoice_number', v_inv, 'unit_id', v_unit.id, 'vin', v_unit.vin_norm, 'unit_invoice_number', v_unit.invoice_number,
        'other_unit_id', v_holder.id, 'other_vin', v_holder.vin_norm));
    end if;
    if p_mode = 'live' and not exists (
      select 1 from public.stock_invoice_exceptions e
      where e.org_id = p_org and coalesce(e.invoice_number, e.xero_invoice_id) = coalesce(v_inv, v_xid) and e.reason = v_reason
    ) then
      insert into public.stock_invoice_exceptions(org_id, xero_invoice_id, invoice_number, reference, reason, unit_id)
      values (p_org, v_xid, v_inv, nullif(left(btrim(coalesce(p_reference, '')), 500), ''), v_reason, v_unit.id)
      on conflict do nothing
      returning id into v_exc;
      if v_exc is not null then
        perform public.stock_audit(p_org, 'stock.exception', 'stock_invoice_exception', v_exc::text, jsonb_build_object(
          'exception_id', v_exc, 'invoice_number', v_inv, 'xero_invoice_id', v_xid, 'reason', v_reason,
          'unit_id', v_unit.id, 'vin', v_unit.vin_norm));
      end if;
    end if;
    return jsonb_strip_nulls(jsonb_build_object(
      'result', 'exception', 'reason', v_reason, 'code', v_code, 'mode', p_mode, 'recorded', v_exc is not null,
      'exception_id', v_exc, 'unit_id', v_unit.id, 'vin', v_unit.vin_norm, 'invoice_number', v_inv));
  end if;

  v_from := v_unit.status;
  if v_unit.status = v_target and v_unit.invoice_number = v_inv then
    if p_mode <> 'preview' and v_xid is not null and v_unit.xero_invoice_id is null then
      update public.stock_units u set xero_invoice_id = v_xid where u.id = v_unit.id;
    end if;
    return jsonb_build_object('result', 'noop', 'status', v_unit.status, 'mode', p_mode, 'unit_id', v_unit.id,
                              'vin', v_unit.vin_norm, 'invoice_number', v_inv);
  end if;

  if p_mode <> 'preview' then
    update public.stock_units u set
      status = v_target,
      invoice_number = v_inv,
      xero_invoice_id = coalesce(v_xid, u.xero_invoice_id),
      sold_at = case when v_target = 'sold' then coalesce(u.sold_at, now()) else null end
    where u.id = v_unit.id
    returning * into v_unit;

    perform public.stock_audit(p_org, case when v_target = 'sold' then 'stock.sell' else 'stock.reserve' end,
      'stock_unit', v_unit.id::text, jsonb_build_object(
        'unit_id', v_unit.id, 'vin', v_unit.vin_norm, 'model', v_unit.model_part, 'invoice_number', v_inv,
        'xero_invoice_id', v_xid, 'mode', p_mode, 'from_status', v_from));
  end if;

  return jsonb_build_object('result', v_target, 'from_status', v_from, 'mode', p_mode, 'unit_id', v_unit.id,
                            'vin', v_unit.vin_norm, 'invoice_number', v_inv);
end $$;

-- ---------------------------------------------------------------------------
-- Function privileges: clients call only the RPCs; helpers stay internal.
-- ---------------------------------------------------------------------------
revoke all on function public.stock_raise(text, jsonb), public.stock_is_service(),
                       public.stock_require_role(uuid, public.app_role[]), public.stock_clean_accessories(text[]),
                       public.stock_audit(uuid, text, text, text, jsonb), public.stock_unit_detail(public.stock_units),
                       public.stock_check_deal(public.stock_deals, int, int)
  from public, anon, authenticated;

revoke all on function
  public.stock_dispatch_unit(uuid, text, text, text, date, text[], text, int, int),
  public.stock_move_unit(uuid, uuid, text, text, int, int),
  public.stock_correct_unit(uuid, uuid, jsonb),
  public.stock_dismiss_deal(uuid, uuid, text),
  public.stock_restore_deal(uuid, uuid),
  public.stock_apply_invoice(uuid, text, text, text, text, text)
  from public, anon;
grant execute on function
  public.stock_dispatch_unit(uuid, text, text, text, date, text[], text, int, int),
  public.stock_move_unit(uuid, uuid, text, text, int, int),
  public.stock_correct_unit(uuid, uuid, jsonb),
  public.stock_dismiss_deal(uuid, uuid, text),
  public.stock_restore_deal(uuid, uuid),
  public.stock_apply_invoice(uuid, text, text, text, text, text)
  to authenticated;
grant execute on function public.stock_apply_invoice(uuid, text, text, text, text, text) to service_role;

comment on table public.stock_units is 'One physical unit per VIN (unique per org on vin_norm, sold included). Written only by the stock_* RPCs or the server.';
comment on table public.stock_deals is 'One per DEAL entry (deal sync job). Cleared only by a dispatch against its year and number.';
comment on table public.stock_invoice_exceptions is 'Invoices the stock rules could not apply. Recorded once per invoice and reason; resolved by an admin.';
comment on view public.stock_matrix is 'Units per model x location (available + reserved) and reserved count; sold excluded. security_invoker.';

-- ---------------------------------------------------------------------------
-- Seed for the default org only: locations and the 52 models (order and spelling as lib/stock/models.ts).
-- ---------------------------------------------------------------------------
insert into public.stock_locations (org_id, id, name, is_factory, sort_order) values
  ('00000000-0000-0000-0000-000000000001', 'FACTORY', 'Factory', true, 0),
  ('00000000-0000-0000-0000-000000000001', 'JHB', 'Johannesburg', false, 1),
  ('00000000-0000-0000-0000-000000000001', 'CPT', 'Cape Town', false, 2),
  ('00000000-0000-0000-0000-000000000001', 'DBN', 'Durban', false, 3)
on conflict do nothing;

insert into public.stock_models (org_id, part_number, description, category, sort_order)
select '00000000-0000-0000-0000-000000000001', m.part_number, m.description, m.category, m.sort_order
from (values
  ('CTLL1', '3 meter animal trailer NO BRAKES 750 KGS GWM', 'animal_trailer', 1),
  ('CTLL2', '3 meter animal trailer SINGEL BRAKE 1500KG GWM', 'animal_trailer', 2),
  ('CTLL3', '4 meter animal trailer SINGEL BRAKE 1500 KG GWM', 'animal_trailer', 3),
  ('CTLL3D', '4 meter animal trailer TWIN BRAKE 3000 KG GWM', 'animal_trailer', 4),
  ('CTTL4D', '5 meter animal trailer TWIN BRAKE 3000 KG GWM', 'animal_trailer', 5),
  ('CT1', '4 meter car trailer SINGEL BRAKE 1500 GWM', 'car_trailer', 6),
  ('CT2', '5 meter car trailer SINGEL BRAKE 1500 KG GWM', 'car_trailer', 7),
  ('CT3', '5 meter car trailer TWIN BRAKE 3000 KG GWM', 'car_trailer', 8),
  ('500D', '500 litre metal bowser', 'metal_bowser', 9),
  ('1000D', '1000 litre metal bowser', 'metal_bowser', 10),
  ('1000DB', '1000 litre metal bowser', 'metal_bowser', 11),
  ('2000D', '2000 litre metal bowser', 'metal_bowser', 12),
  ('2500D', '2500 litre metal bowser', 'metal_bowser', 13),
  ('3000D', '3000 litre metal bowser', 'metal_bowser', 14),
  ('5000D', '5000 litre metal bowser', 'metal_bowser', 15),
  ('500P', '500 litre polyurethane bowser', 'poly_bowser', 16),
  ('1000PB', '1000 litre polyurethane bowser', 'poly_bowser', 17),
  ('1000P', '1000 litre polyurethane bowser', 'poly_bowser', 18),
  ('2500P', '2500 litre polyurethane bowser', 'poly_bowser', 19),
  ('500S', '500 litre stainless bowser MADE FROM 3CR12', 'stainless_bowser', 20),
  ('1000SB', '1000 litre stainless bowser MADE FROM 3CR12', 'stainless_bowser', 21),
  ('2000S', '2000 litre stainless steel bowser MADE FROM 3CR12', 'stainless_bowser', 22),
  ('2500S', '2500 litre stainless bowser MADE FROM 3CR12', 'stainless_bowser', 23),
  ('3000S', '3000 litre stainless bowser MADE FROM 3CR12', 'stainless_bowser', 24),
  ('TS1', '1000 LITER TANK ON LOOSE CRADEL STAND', 'cradle_tank', 25),
  ('TS2', '2000 LITER TANK ON LOOSE CRADEL STAND', 'cradle_tank', 26),
  ('TS25', '2500 LITER TANK ON LOOSE CRADEL STAND', 'cradle_tank', 27),
  ('TS3', '3000 LITER TANK ON LOOSE CRADEL STAND', 'cradle_tank', 28),
  ('TS5', '5000 LITER TANK ON LOOSE CRADEL STAND', 'cradle_tank', 29),
  ('SK5P', '500 LITER PLASTIC TANK ON METAL SKID BASE', 'skid_tank', 30),
  ('SK1P', '1000 LITER PLASTIC TANK ON METAL SKID BASE', 'skid_tank', 31),
  ('SK25P', '2500 LITER PLASTIC TANK ON METAL SKID BASE', 'skid_tank', 32),
  ('SK1', '500 LITER TANK ON SKID', 'skid_tank', 33),
  ('SK2', '1000 LITER TANK ON SKID', 'skid_tank', 34),
  ('SK3', '2000 LITER TANK ON SKID', 'skid_tank', 35),
  ('SK4', '2500 LITER TANK ON SKID', 'skid_tank', 36),
  ('SK5', '3000 LITER TANK ON SKID', 'skid_tank', 37),
  ('SK6', '5000 LITER TANK ON SKID', 'skid_tank', 38),
  ('C200', '2 meter cargo trailer', 'cargo_trailer', 39),
  ('C30075', '3 meter cargo trailer', 'cargo_trailer', 40),
  ('C30015', '3 meter cargo trailer', 'cargo_trailer', 41),
  ('C400', '4 meter cargo trailer', 'cargo_trailer', 42),
  ('C400D', '4 meter cargo trailer double axel', 'cargo_trailer', 43),
  ('C300D', '3 meter cargo trailer Dubbel axel', 'cargo_trailer', 44),
  ('FTE', 'VENDOR TRAILER', 'vendor_box', 45),
  ('BOX01', '2, 4 METER BOX', 'vendor_box', 46),
  ('BOX02', '3 METER BOX', 'vendor_box', 47),
  ('BOX04', '4 METER BOX', 'vendor_box', 48),
  ('BOX07', 'ISOLATED VENDOR TRAILER', 'vendor_box', 49),
  ('BOX08', '2 METER ISOLATED VENDOR TRAILER', 'vendor_box', 50),
  ('BOX09', '3 METER ISOLATED VENDOR TRAILER', 'vendor_box', 51),
  ('BOX10', '4 METER ISOLATED VENDOR TRAILER', 'vendor_box', 52)
) as m(part_number, description, category, sort_order)
where exists (select 1 from public.orgs o where o.id = '00000000-0000-0000-0000-000000000001')
on conflict do nothing;
