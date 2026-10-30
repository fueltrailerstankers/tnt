-- 0019: stock invoice guard (M6 review). See docs/M6.md section 12.
-- 1. xero_credit_notes: read-only mirror of Xero /CreditNotes (GET only, like the other xero_* mirror tables). Sales
--    credit notes (ACCRECCREDIT) that name a unit VIN or are allocated to a stock invoice become 'credit_note'
--    exceptions through the stock.invoices job; nothing changes a unit automatically.
-- 2. xero_invoices.credit_note_applied: the sum of credit notes allocated to the invoice (Xero CreditNotes[].
--    AppliedAmount). AmountCredited also counts prepayments and overpayments, which are payments, not credits.
-- 3. stock_invoice_exceptions.source_updated_utc + stock_apply_invoice(p_source_updated): a resolved exception no
--    longer hides a later one after the invoice changes again in Xero.

-- ---------------------------------------------------------------------------
-- 1. Credit notes mirror
-- ---------------------------------------------------------------------------
create table public.xero_credit_notes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  tenant_id text not null,
  credit_note_id text not null,
  credit_note_number text,
  credit_note_type text,               -- ACCRECCREDIT (sales) | ACCPAYCREDIT (bills)
  reference text,
  status text,
  contact_id text,
  contact_name text,
  credit_note_date date,
  currency_code char(3),
  total numeric(14,2),
  remaining_credit numeric(14,2),
  invoice_ids text[] not null default '{}',   -- invoices it is allocated to (Allocations[].Invoice.InvoiceID)
  updated_utc timestamptz,
  raw jsonb not null,
  synced_at timestamptz not null default now(),
  unique (org_id, credit_note_id)
);
create index xero_credit_notes_updated_idx on public.xero_credit_notes(org_id, updated_utc desc);
create index xero_credit_notes_invoices_idx on public.xero_credit_notes using gin (invoice_ids);

alter table public.xero_credit_notes enable row level security;
create policy xero_credit_notes_select on public.xero_credit_notes for select to authenticated using (public.is_org_member(org_id));
-- Factory staff never see the Xero mirror (as 0011 for the other xero_* tables).
create policy xero_credit_notes_not_factory on public.xero_credit_notes as restrictive for all to authenticated
  using (not public.has_org_role(org_id, array['factory']::public.app_role[]));
revoke all on public.xero_credit_notes from anon, authenticated;
grant select on public.xero_credit_notes to authenticated;
grant all on public.xero_credit_notes to service_role;
comment on table public.xero_credit_notes is 'Read-only mirror of Xero credit notes (GET /CreditNotes). Written by the sync with the service role.';

-- ---------------------------------------------------------------------------
-- 2. Credit notes applied to an invoice
-- ---------------------------------------------------------------------------
alter table public.xero_invoices add column credit_note_applied numeric(14,2);
update public.xero_invoices i set credit_note_applied = (
  select coalesce(sum(nullif(c->>'AppliedAmount', '')::numeric), 0)
  from jsonb_array_elements(case when jsonb_typeof(i.raw->'CreditNotes') = 'array' then i.raw->'CreditNotes' else '[]'::jsonb end) c
);
comment on column public.xero_invoices.credit_note_applied is 'Sum of CreditNotes[].AppliedAmount: credit notes only (AmountCredited also counts prepayments and overpayments).';

-- ---------------------------------------------------------------------------
-- 3. Exceptions per Xero state
-- ---------------------------------------------------------------------------
alter table public.stock_invoice_exceptions add column source_updated_utc timestamptz;

drop function public.stock_apply_invoice(uuid, text, text, text, text, text);

create or replace function public.stock_apply_invoice(
  p_org uuid, p_invoice_number text, p_xero_invoice_id text, p_reference text, p_outcome text, p_mode text,
  p_source_updated timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_service boolean := public.stock_is_service();
  v_inv text := nullif(upper(btrim(coalesce(p_invoice_number, ''))), '');
  v_xid text := nullif(btrim(coalesce(p_xero_invoice_id, '')), '');
  v_ref text := public.stock_norm_vin(p_reference);
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
    -- Recorded once per (invoice, reason) while open. A resolved one blocks only the same or an older Xero state
    -- (source_updated_utc): when the invoice changes again and still breaks the rules, a new exception is raised.
    if p_mode = 'live' and not exists (
      select 1 from public.stock_invoice_exceptions e
      where e.org_id = p_org and coalesce(e.invoice_number, e.xero_invoice_id) = coalesce(v_inv, v_xid) and e.reason = v_reason
        and (e.resolved_at is null or p_source_updated is null or e.source_updated_utc >= p_source_updated)
    ) then
      insert into public.stock_invoice_exceptions(org_id, xero_invoice_id, invoice_number, reference, reason, unit_id, source_updated_utc)
      values (p_org, v_xid, v_inv, nullif(left(btrim(coalesce(p_reference, '')), 500), ''), v_reason, v_unit.id, p_source_updated)
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


revoke all on function public.stock_apply_invoice(uuid, text, text, text, text, text, timestamptz) from public, anon;
grant execute on function public.stock_apply_invoice(uuid, text, text, text, text, text, timestamptz) to authenticated, service_role;
