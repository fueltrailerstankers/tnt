-- 0008: Leads inbox (M4) with manual and test sources.
-- Leads hold personal data (name, email, phone): org members with the admin or staff role can read them
-- through RLS; every write goes through server code (service role) after requirePerm('leads.manage').
-- lead_events.meta holds ids and field names only, never personal data. Routing rules are admin-only.

-- ---------------------------------------------------------------------------
-- Sources
-- ---------------------------------------------------------------------------
create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_-]{1,31}$'),   -- manual | test | website | google | facebook
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, key)
);

-- ---------------------------------------------------------------------------
-- Routing rules: first active rule by priority (ascending) wins
-- ---------------------------------------------------------------------------
create table public.routing_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  priority int not null default 100,
  match_source text,                    -- lead_sources.key, null = any
  match_product text,                   -- case-insensitive keyword in the product/interest text, null = any
  match_branch text,                    -- case-insensitive branch given by the lead, null = any
  assign_branch text,                   -- branch set on the lead when the rule matches, null = keep
  notify_event_key text not null default 'leads.new' check (notify_event_key ~ '^leads\.[a-z0-9_-]+$'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index routing_rules_org_idx on public.routing_rules(org_id, priority);

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  source text not null,
  source_form text,
  external_id text,                     -- the source's own id; idempotency key per org + source
  name text,
  email text,
  email_norm text,                      -- lower(trim(email))
  phone text,
  phone_norm text,                      -- digits only, last 9 digits
  product text,                         -- product / interest text
  message text,
  branch text,
  assigned_to uuid references auth.users(id) on delete set null,
  status text not null default 'new' check (status in ('new', 'contacted', 'quoted', 'won', 'lost', 'spam')),
  gclid text,
  fbclid text,
  utm jsonb not null default '{}'::jsonb,
  duplicate_of uuid references public.leads(id) on delete set null,
  routing_rule_id uuid references public.routing_rules(id) on delete set null,
  -- Xero match (ids are Xero ids, matching the /admin/xero/* routes); money carries its currency code
  matched_contact_ids text[] not null default '{}',
  matched_quote_id text,
  matched_quote_number text,
  matched_quote_status text,
  matched_quote_total numeric(14,2),
  matched_quote_currency char(3),
  matched_invoice_id text,              -- most recent matching invoice
  matched_invoice_number text,
  invoice_count int not null default 0,
  invoiced_total numeric(14,2),         -- running total of matching invoices in invoiced_currency
  invoiced_currency char(3),
  matched_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  search_text text generated always as (
    lower(coalesce(name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone_norm, '') || ' ' || coalesce(product, ''))
  ) stored,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (org_id, source) references public.lead_sources(org_id, key),
  unique (org_id, source, external_id)  -- nulls are distinct: manual leads have no external id
);
create index leads_org_created_idx on public.leads(org_id, created_at desc);
create index leads_email_idx on public.leads(org_id, email_norm) where email_norm is not null;
create index leads_phone_idx on public.leads(org_id, phone_norm) where phone_norm is not null;
create index leads_duplicate_idx on public.leads(duplicate_of) where duplicate_of is not null;
create trigger leads_bu before update on public.leads for each row execute function public.touch_updated_at();

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  kind text not null,                   -- created | duplicate | routed | emailed | matched | status | assigned | note
  actor uuid references auth.users(id) on delete set null,
  meta jsonb not null default '{}'::jsonb,   -- ids and field names only
  body text,                            -- staff note text (kind = note) only
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on public.lead_events(lead_id, created_at);
create trigger lead_events_org before insert or update on public.lead_events
  for each row execute function public.tg_org_from_parent('leads', 'lead_id');

-- ---------------------------------------------------------------------------
-- Lead notifications go to email_log too; org_id comes from the lead when there is no entry.
-- ---------------------------------------------------------------------------
alter table public.email_log add column lead_id uuid references public.leads(id) on delete set null;
create index email_log_lead_idx on public.email_log(lead_id) where lead_id is not null;
create trigger email_log_org_lead before insert or update on public.email_log
  for each row execute function public.tg_org_from_parent('leads', 'lead_id');

-- ---------------------------------------------------------------------------
-- Normalised match keys on the Xero contact mirror (derived, additive; the sync never writes them)
-- ---------------------------------------------------------------------------
alter table public.xero_contacts
  add column email_norm text generated always as (nullif(lower(btrim(email)), '')) stored,
  add column phone_norm text;

create or replace function public.xero_contacts_phone_norm() returns trigger
language plpgsql set search_path = public as $$
declare d text;
begin
  -- First phone with at least 9 digits, MOBILE before DEFAULT before the rest; last 9 digits (as leads).
  select right(digits, 9) into d from (
    select regexp_replace(coalesce(p ->> 'PhoneCountryCode', '') || coalesce(p ->> 'PhoneAreaCode', '') || coalesce(p ->> 'PhoneNumber', ''), '\D', '', 'g') as digits,
           case p ->> 'PhoneType' when 'MOBILE' then 0 when 'DEFAULT' then 1 else 2 end as rank
    from jsonb_array_elements(case when jsonb_typeof(new.raw -> 'Phones') = 'array' then new.raw -> 'Phones' else '[]'::jsonb end) p
  ) x where length(digits) >= 9 order by rank limit 1;
  new.phone_norm := d;
  return new;
end $$;
create trigger xero_contacts_phone_norm before insert or update of raw on public.xero_contacts
  for each row execute function public.xero_contacts_phone_norm();
update public.xero_contacts set raw = raw;  -- backfill phone_norm for rows already mirrored
create index xero_contacts_email_norm_idx on public.xero_contacts(org_id, email_norm) where email_norm is not null;
create index xero_contacts_phone_norm_idx on public.xero_contacts(org_id, phone_norm) where phone_norm is not null;
create index xero_quotes_contact_idx on public.xero_quotes(org_id, contact_id);
create index xero_invoices_contact_idx on public.xero_invoices(org_id, contact_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.lead_sources enable row level security;
alter table public.routing_rules enable row level security;
alter table public.leads enable row level security;
alter table public.lead_events enable row level security;

create policy lead_sources_select on public.lead_sources for select to authenticated using (public.is_org_member(org_id));
create policy routing_rules_select on public.routing_rules for select to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]));
create policy leads_select on public.leads for select to authenticated
  using (public.has_org_role(org_id, array['admin','staff']::public.app_role[]));
create policy lead_events_select on public.lead_events for select to authenticated
  using (public.has_org_role(org_id, array['admin','staff']::public.app_role[]));

revoke all on public.lead_sources, public.routing_rules, public.leads, public.lead_events from anon, authenticated;
grant select on public.lead_sources, public.routing_rules, public.leads, public.lead_events to authenticated;
grant all on public.lead_sources, public.routing_rules, public.leads, public.lead_events to service_role;

revoke all on function public.xero_contacts_phone_norm() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed for the default org only
-- ---------------------------------------------------------------------------
insert into public.lead_sources (org_id, key, name, active) values
  ('00000000-0000-0000-0000-000000000001', 'manual', 'Manual entry', true),
  ('00000000-0000-0000-0000-000000000001', 'test', 'Test', true),
  ('00000000-0000-0000-0000-000000000001', 'website', 'Website product inquiry', true),
  ('00000000-0000-0000-0000-000000000001', 'google', 'Google Ads lead form', false),
  ('00000000-0000-0000-0000-000000000001', 'facebook', 'Facebook Lead Ads', false);

insert into public.routing_rules (org_id, name, priority, notify_event_key) values
  ('00000000-0000-0000-0000-000000000001', 'Default: all leads to sales', 1000, 'leads.new');

insert into public.notification_recipients (org_id, event_key, address) values
  ('00000000-0000-0000-0000-000000000001', 'leads.new', 'sales@fueltrailers.co.za')
on conflict do nothing;
