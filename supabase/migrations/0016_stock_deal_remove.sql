-- 0016 (M6 deals): remove an untouched stock deal in one statement.
-- The DEAL sync (lib/stock/deal-jobs.ts) removes a deal whose DEAL fell out of scope (start date moved later, entry
-- back to draft) only while the deal is untouched. A filtered DELETE through the API could only test the deal row
-- itself, and stock_deal_dismissals cascades on delete, so a dismiss + restore racing the sync could lose the
-- dismissal history. This function checks the row and its history in the same statement:
--   * still awaiting dispatch, no unit, never dispatched, not dismissed (row columns, re-checked under the row lock);
--   * no dismissal rows (append-only history);
--   * no unit linked to it and no stock audit row naming it (stock.dispatch / stock.move / stock.correct, incl.
--     previous_deal_id: a deal put back to awaiting by stock_correct_unit has history).
-- Service role only (the sync job). Returns true when the deal was removed.
create or replace function public.stock_remove_untouched_deal(p_org uuid, p_deal uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  if not public.stock_is_service() then perform public.stock_raise('FORBIDDEN'); end if;
  delete from public.stock_deals d
   where d.org_id = p_org and d.id = p_deal
     and d.status = 'awaiting_dispatch' and d.unit_id is null and d.dispatched_at is null and d.dismissed_at is null
     and not exists (select 1 from public.stock_deal_dismissals x where x.org_id = d.org_id and x.deal_id = d.id)
     and not exists (select 1 from public.stock_units u where u.org_id = d.org_id and u.deal_id = d.id)
     and not exists (select 1 from public.audit_log a
                      where a.org_id = d.org_id and a.action like 'stock.%'
                        and (a.meta ->> 'deal_id' = d.id::text or a.meta ->> 'previous_deal_id' = d.id::text));
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

revoke all on function public.stock_remove_untouched_deal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.stock_remove_untouched_deal(uuid, uuid) to service_role;

comment on function public.stock_remove_untouched_deal(uuid, uuid) is
  'DEAL sync only (service role): deletes an awaiting stock deal that never had a unit, dismissal or stock audit row. True when removed.';
