-- 0017 (M6 stock): optimistic locking for the admin unit edits.
--
-- stock_correct_unit and stock_move_unit get an optional last argument p_expected_updated_at (default null). When it
-- is given, the unit row is locked and its updated_at compared first; if the unit changed since the caller read it,
-- UNIT_CHANGED is raised (message = code, hint 'stock', detail = ids) and nothing is written. The check and the write
-- run under the same row lock, so no write can slip in between.
--
-- Without the argument (every existing caller, e.g. the dispatch page's Factory -> branch move with deal year and
-- number) the behaviour is exactly that of 0011: the 0011 functions are kept unchanged, renamed to *_unchecked
-- (internal: no client grants), and the public names check the role, the version, then call them.
-- 0016 is the dispatch branch's (stock_remove_untouched_deal); this migration touches none of its objects.

alter function public.stock_move_unit(uuid, uuid, text, text, int, int) rename to stock_move_unit_unchecked;
alter function public.stock_correct_unit(uuid, uuid, jsonb) rename to stock_correct_unit_unchecked;
revoke all on function public.stock_move_unit_unchecked(uuid, uuid, text, text, int, int),
                       public.stock_correct_unit_unchecked(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

-- Raises UNIT_CHANGED unless the unit (locked here until the transaction ends) still has p_expected as updated_at.
-- Nothing to check when p_expected is null; a missing unit is left to the 0011 body (UNIT_NOT_FOUND).
create function public.stock_check_unit_version(p_org uuid, p_unit uuid, p_expected timestamptz) returns void
language plpgsql set search_path = '' as $$
declare v_updated timestamptz;
begin
  if p_expected is null then return; end if;
  select u.updated_at into v_updated from public.stock_units u where u.org_id = p_org and u.id = p_unit for update;
  if found and v_updated is distinct from p_expected then
    perform public.stock_raise('UNIT_CHANGED', jsonb_build_object('unit_id', p_unit));
  end if;
end $$;
revoke all on function public.stock_check_unit_version(uuid, uuid, timestamptz) from public, anon, authenticated;

create function public.stock_move_unit(
  p_org uuid, p_unit uuid, p_location text, p_reason text default null,
  p_deal_year int default null, p_deal_number int default null, p_expected_updated_at timestamptz default null
) returns public.stock_units
language plpgsql security definer set search_path = '' as $$
begin
  -- Role first (as in 0011), so a caller outside the org learns nothing about its units.
  perform public.stock_require_role(p_org, array['admin', 'staff', 'factory']::public.app_role[]);
  perform public.stock_check_unit_version(p_org, p_unit, p_expected_updated_at);
  return public.stock_move_unit_unchecked(p_org, p_unit, p_location, p_reason, p_deal_year, p_deal_number);
end $$;

create function public.stock_correct_unit(p_org uuid, p_unit uuid, p_fields jsonb, p_expected_updated_at timestamptz default null)
returns public.stock_units
language plpgsql security definer set search_path = '' as $$
begin
  perform public.stock_require_role(p_org, array['admin']::public.app_role[]);
  perform public.stock_check_unit_version(p_org, p_unit, p_expected_updated_at);
  return public.stock_correct_unit_unchecked(p_org, p_unit, p_fields);
end $$;

-- Privileges exactly as 0011 gives the RPCs.
revoke all on function
  public.stock_move_unit(uuid, uuid, text, text, int, int, timestamptz),
  public.stock_correct_unit(uuid, uuid, jsonb, timestamptz)
  from public, anon;
grant execute on function
  public.stock_move_unit(uuid, uuid, text, text, int, int, timestamptz),
  public.stock_correct_unit(uuid, uuid, jsonb, timestamptz)
  to authenticated;

comment on function public.stock_move_unit(uuid, uuid, text, text, int, int, timestamptz) is
  'Factory -> branch move (admin, staff, factory) or transfer (admin, reason). p_expected_updated_at: refuse with UNIT_CHANGED if the unit changed since read.';
comment on function public.stock_correct_unit(uuid, uuid, jsonb, timestamptz) is
  'Admin correction of a unit record. p_expected_updated_at: refuse with UNIT_CHANGED if the unit changed since read.';

notify pgrst, 'reload schema';
