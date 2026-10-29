-- 0006: Xero read-only mirror (M2) and deal files.
-- Xero is the book of record. These tables are a mirror written only by the server (service role) from
-- GET calls; org members can read them. Every money value carries its own currency code; the raw Xero
-- JSON of each record is kept for replay and audit.

-- ---------------------------------------------------------------------------
-- Connection bookkeeping (xero_connections comes from 0004)
-- ---------------------------------------------------------------------------
alter table public.xero_connections
  add column tenant_name text,
  add column status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  add column refresh_locked_until timestamptz,
  add column last_refreshed_at timestamptz,
  add column rate_min_remaining int,
  add column rate_day_remaining int,
  add column rate_seen_at timestamptz,
  add column connected_by uuid references auth.users(id) on delete set null;

-- OAuth state for the connect flow: sha256(state) only, short-lived, bound to the user who started it.
create table public.xero_oauth_states (
  state_hash text primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- One claimant at a time refreshes a connection's tokens (refresh tokens are single use).
create or replace function public.xero_claim_refresh(p_connection uuid, p_seconds int default 30) returns boolean
language sql volatile security invoker set search_path = public as $$
  with c as (
    update public.xero_connections
       set refresh_locked_until = now() + make_interval(secs => p_seconds)
     where id = p_connection and (refresh_locked_until is null or refresh_locked_until < now())
    returning 1
  )
  select exists (select 1 from c)
$$;

-- ---------------------------------------------------------------------------
-- Mirror tables
-- ---------------------------------------------------------------------------
create table public.xero_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenant_id text not null,
  contact_id text not null,
  name text,
  first_name text,
  last_name text,
  email text,
  contact_status text,
  is_customer boolean,
  updated_utc timestamptz,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (org_id, contact_id)
);
create index xero_contacts_email_idx on public.xero_contacts(org_id, lower(email));

create table public.xero_quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenant_id text not null,
  quote_id text not null,
  quote_number text,
  quote_no text,                       -- quote_number without the "QU-" prefix: the value staff type on forms
  reference text,
  status text,
  contact_id text,
  contact_name text,
  quote_date date,
  expiry_date date,
  currency_code char(3),
  sub_total numeric(14,2),
  total_tax numeric(14,2),
  total numeric(14,2),
  updated_utc timestamptz,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (org_id, quote_id)
);
create index xero_quotes_no_idx on public.xero_quotes(org_id, quote_no);
create index xero_quotes_date_idx on public.xero_quotes(org_id, quote_date desc);

create table public.xero_quote_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  quote_id text not null,
  line_no int not null,
  line_item_id text,
  item_code text,
  description text,
  quantity numeric(14,4),
  unit_amount numeric(14,4),
  line_amount numeric(14,2),
  tax_amount numeric(14,2),
  currency_code char(3),
  unique (org_id, quote_id, line_no)
);

create table public.xero_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenant_id text not null,
  invoice_id text not null,
  invoice_number text,
  invoice_type text,                   -- ACCREC (sales) | ACCPAY (bills)
  reference text,
  status text,
  contact_id text,
  contact_name text,
  invoice_date date,
  due_date date,
  currency_code char(3),
  sub_total numeric(14,2),
  total_tax numeric(14,2),
  total numeric(14,2),
  amount_due numeric(14,2),
  amount_paid numeric(14,2),
  amount_credited numeric(14,2),
  fully_paid_on date,
  has_attachments boolean not null default false,
  attachments_synced_at timestamptz,
  updated_utc timestamptz,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (org_id, invoice_id)
);
create index xero_invoices_number_idx on public.xero_invoices(org_id, invoice_number);
create index xero_invoices_reference_idx on public.xero_invoices(org_id, upper(reference));
create index xero_invoices_date_idx on public.xero_invoices(org_id, invoice_date desc);

create table public.xero_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  invoice_id text not null,
  line_no int not null,
  line_item_id text,
  item_code text,
  description text,
  quantity numeric(14,4),
  unit_amount numeric(14,4),
  line_amount numeric(14,2),
  tax_amount numeric(14,2),
  currency_code char(3),
  unique (org_id, invoice_id, line_no)
);

create table public.xero_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenant_id text not null,
  payment_id text not null,
  invoice_id text,
  invoice_number text,
  payment_date date,
  amount numeric(14,2),
  currency_code char(3),
  status text,
  payment_type text,
  reference text,
  updated_utc timestamptz,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (org_id, payment_id)
);
create index xero_payments_invoice_idx on public.xero_payments(org_id, invoice_id);

create table public.xero_attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  attachment_id text not null,
  parent_type text not null,           -- Invoice | Quote
  parent_id text not null,
  file_name text,
  mime_type text,
  content_length bigint,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (org_id, attachment_id)
);
create index xero_attachments_parent_idx on public.xero_attachments(org_id, parent_type, parent_id);

-- Sync cursor per entity: backfill passes first, then incremental by If-Modified-Since.
create table public.xero_sync_state (
  org_id uuid not null references public.orgs(id) on delete cascade,
  entity text not null,                -- contacts | quotes | invoices | payments | attachments
  backfill_done boolean not null default false,
  pass int not null default 0,
  page int not null default 1,
  modified_since timestamptz,          -- next incremental run asks for changes since this instant
  cycle_started_at timestamptz,        -- when the current backfill/incremental cycle began; becomes modified_since when it completes
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text,                     -- redacted
  records_synced bigint not null default 0,
  primary key (org_id, entity)
);

-- ---------------------------------------------------------------------------
-- Deal files: one trailer's life, keyed by quote no (chosen once, linked everywhere)
-- ---------------------------------------------------------------------------
create table public.deal_files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  quote_no text not null,
  quote_id text,
  invoice_ids text[] not null default '{}',
  invoice_numbers text[] not null default '{}',
  vin text,
  customer_name text,
  branch text,
  rep text,
  deal_entry_id uuid references public.entries(id) on delete set null,
  rfi_entry_id uuid references public.entries(id) on delete set null,
  job_card_entry_id uuid references public.entries(id) on delete set null,
  inspection_entry_id uuid references public.entries(id) on delete set null,
  release_entry_id uuid references public.entries(id) on delete set null,
  delivery_entry_id uuid references public.entries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, quote_no)
);
create index deal_files_vin_idx on public.deal_files(org_id, vin);
create trigger deal_files_bu before update on public.deal_files for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: members read the mirror and deal files; only the server writes. OAuth states: no client access.
-- ---------------------------------------------------------------------------
alter table public.xero_oauth_states enable row level security;
alter table public.xero_contacts enable row level security;
alter table public.xero_quotes enable row level security;
alter table public.xero_quote_lines enable row level security;
alter table public.xero_invoices enable row level security;
alter table public.xero_invoice_lines enable row level security;
alter table public.xero_payments enable row level security;
alter table public.xero_attachments enable row level security;
alter table public.xero_sync_state enable row level security;
alter table public.deal_files enable row level security;

create policy xero_contacts_select on public.xero_contacts for select to authenticated using (public.is_org_member(org_id));
create policy xero_quotes_select on public.xero_quotes for select to authenticated using (public.is_org_member(org_id));
create policy xero_quote_lines_select on public.xero_quote_lines for select to authenticated using (public.is_org_member(org_id));
create policy xero_invoices_select on public.xero_invoices for select to authenticated using (public.is_org_member(org_id));
create policy xero_invoice_lines_select on public.xero_invoice_lines for select to authenticated using (public.is_org_member(org_id));
create policy xero_payments_select on public.xero_payments for select to authenticated using (public.is_org_member(org_id));
create policy xero_attachments_select on public.xero_attachments for select to authenticated using (public.is_org_member(org_id));
create policy xero_sync_state_select on public.xero_sync_state for select to authenticated using (public.is_org_member(org_id));
create policy deal_files_select on public.deal_files for select to authenticated using (public.is_org_member(org_id));

revoke all on public.xero_oauth_states, public.xero_contacts, public.xero_quotes, public.xero_quote_lines,
              public.xero_invoices, public.xero_invoice_lines, public.xero_payments, public.xero_attachments,
              public.xero_sync_state, public.deal_files from anon, authenticated;
grant select on public.xero_contacts, public.xero_quotes, public.xero_quote_lines, public.xero_invoices,
                public.xero_invoice_lines, public.xero_payments, public.xero_attachments, public.xero_sync_state,
                public.deal_files to authenticated;
grant all on public.xero_oauth_states, public.xero_contacts, public.xero_quotes, public.xero_quote_lines,
             public.xero_invoices, public.xero_invoice_lines, public.xero_payments, public.xero_attachments,
             public.xero_sync_state, public.deal_files to service_role;

revoke all on function public.xero_claim_refresh(uuid, int) from public, anon, authenticated;
grant execute on function public.xero_claim_refresh(uuid, int) to service_role;
