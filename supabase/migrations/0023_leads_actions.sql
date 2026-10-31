-- 0023: Leads actions from the lead detail: Merge a duplicate into its original, "Not a duplicate", and change the
-- lead's branch. Additive: three columns groups on public.leads and three RPCs.
--
-- Nothing is ever deleted. Merge keeps both rows: the duplicate gets merged_into / merged_at / merged_by (its raw
-- payload, events and notes stay), the leads that pointed at it as their original now point at the original, and
-- both leads get a lead_events row. Merged leads drop out of the inbox, the board and the Xero re-match (the app
-- filters on merged_into is null) and are read-only. "Not a duplicate" moves duplicate_of into not_duplicate_of so
-- duplicate detection (lib/leads/duplicates.ts) never flags the lead against that original again.
--
-- The RPCs run as the signed-in user (security definer) and re-check, under the row lock: Leads write in p_org
-- (has_access, active members only), the lead belongs to p_org, and the state the page showed still holds. Each
-- writes its lead_events row(s) and its audit_log row (ids and codes only; branch names are routing labels, not
-- personal data). Errors: message = code, hint = 'leads' (lib/leads-view/actions.ts leadRpcError).

alter table public.leads
  add column merged_into uuid references public.leads(id) on delete set null,
  add column merged_at timestamptz,
  add column merged_by uuid references auth.users(id) on delete set null,
  add column not_duplicate_of uuid references public.leads(id) on delete set null,
  add column duplicate_dismissed_at timestamptz,
  add column duplicate_dismissed_by uuid references auth.users(id) on delete set null,
  add constraint leads_merged_not_self check (merged_into is distinct from id),
  add constraint leads_dismissed_not_flagged check (duplicate_of is null or not_duplicate_of is null or duplicate_of <> not_duplicate_of);

create index leads_merged_into_idx on public.leads(merged_into) where merged_into is not null;

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------
create function public.lead_raise(p_code text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = p_code, hint = 'leads';
end $$;

-- Leads write in the org (active member, not waiting to change a temporary password), or FORBIDDEN.
create function public.lead_require_write(p_org uuid) returns void
language plpgsql stable set search_path = '' as $$
begin
  if auth.uid() is null or p_org is null or not public.has_access(p_org, 'leads', 'write') then
    perform public.lead_raise('FORBIDDEN');
  end if;
end $$;

revoke all on function public.lead_raise(text), public.lead_require_write(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Merge: p_lead (a duplicate) into p_into, which must still be its duplicate_of.
-- ---------------------------------------------------------------------------
create function public.lead_merge(p_org uuid, p_lead uuid, p_into uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads;
  v_into public.leads;
  v_repointed int;
begin
  perform public.lead_require_write(p_org);
  if p_lead is null or p_into is null or p_lead = p_into then perform public.lead_raise('INVALID_INPUT'); end if;
  -- Lock both rows in id order (no deadlock with a merge in the other direction).
  perform 1 from public.leads l where l.org_id = p_org and l.id in (p_lead, p_into) order by l.id for update;
  select * into v_lead from public.leads l where l.org_id = p_org and l.id = p_lead;
  select * into v_into from public.leads l where l.org_id = p_org and l.id = p_into;
  if v_lead.id is null or v_into.id is null then perform public.lead_raise('LEAD_NOT_FOUND'); end if;
  if v_lead.merged_into is not null or v_into.merged_into is not null then perform public.lead_raise('LEAD_MERGED'); end if;
  if v_lead.duplicate_of is distinct from p_into then perform public.lead_raise('DUPLICATE_CHANGED'); end if;

  update public.leads set merged_into = p_into, merged_at = now(), merged_by = auth.uid()
  where org_id = p_org and id = p_lead;
  -- Later duplicates of the merged lead now point at the original (never at a merged lead).
  update public.leads set duplicate_of = p_into
  where org_id = p_org and duplicate_of = p_lead and id <> p_into and not_duplicate_of is distinct from p_into;
  get diagnostics v_repointed = row_count;

  insert into public.lead_events(lead_id, kind, actor, meta) values
    (p_lead, 'merged', auth.uid(), jsonb_build_object('into', p_into)),
    (p_into, 'merged_from', auth.uid(), jsonb_build_object('from', p_lead, 'repointed', v_repointed));
  insert into public.audit_log(org_id, actor_user, action, entity, entity_id, meta)
  values (p_org, auth.uid(), 'lead.merge', 'lead', p_lead::text, jsonb_build_object('into', p_into, 'repointed', v_repointed));
  return jsonb_build_object('lead', p_lead, 'into', p_into, 'repointed', v_repointed);
end $$;

-- ---------------------------------------------------------------------------
-- Not a duplicate: clears duplicate_of (which must still be p_of) and remembers it in not_duplicate_of.
-- ---------------------------------------------------------------------------
create function public.lead_not_duplicate(p_org uuid, p_lead uuid, p_of uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads;
begin
  perform public.lead_require_write(p_org);
  if p_lead is null or p_of is null then perform public.lead_raise('INVALID_INPUT'); end if;
  select * into v_lead from public.leads l where l.org_id = p_org and l.id = p_lead for update;
  if v_lead.id is null then perform public.lead_raise('LEAD_NOT_FOUND'); end if;
  if v_lead.merged_into is not null then perform public.lead_raise('LEAD_MERGED'); end if;
  if v_lead.duplicate_of is distinct from p_of then perform public.lead_raise('DUPLICATE_CHANGED'); end if;

  update public.leads
  set duplicate_of = null, not_duplicate_of = p_of, duplicate_dismissed_at = now(), duplicate_dismissed_by = auth.uid()
  where org_id = p_org and id = p_lead;
  insert into public.lead_events(lead_id, kind, actor, meta) values (p_lead, 'not_duplicate', auth.uid(), jsonb_build_object('of', p_of));
  insert into public.audit_log(org_id, actor_user, action, entity, entity_id, meta)
  values (p_org, auth.uid(), 'lead.not_duplicate', 'lead', p_lead::text, jsonb_build_object('of', p_of));
  return jsonb_build_object('lead', p_lead, 'of', p_of);
end $$;

-- ---------------------------------------------------------------------------
-- Branch: null/blank clears it; otherwise as the intake schema allows (letter first, letters . ' - and spaces, 60).
-- Returns changed = false (and writes nothing) when the branch is already that value.
-- ---------------------------------------------------------------------------
create function public.lead_set_branch(p_org uuid, p_lead uuid, p_branch text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads;
  v_branch text := nullif(btrim(coalesce(p_branch, '')), '');
begin
  perform public.lead_require_write(p_org);
  if p_lead is null or (v_branch is not null and (length(v_branch) > 60 or v_branch !~ '^[A-Za-z][A-Za-z .''-]*$')) then
    perform public.lead_raise('INVALID_INPUT');
  end if;
  select * into v_lead from public.leads l where l.org_id = p_org and l.id = p_lead for update;
  if v_lead.id is null then perform public.lead_raise('LEAD_NOT_FOUND'); end if;
  if v_lead.merged_into is not null then perform public.lead_raise('LEAD_MERGED'); end if;
  if v_lead.branch is not distinct from v_branch then
    return jsonb_build_object('lead', p_lead, 'changed', false);
  end if;

  update public.leads set branch = v_branch where org_id = p_org and id = p_lead;
  insert into public.lead_events(lead_id, kind, actor, meta)
  values (p_lead, 'branch', auth.uid(), jsonb_build_object('from', v_lead.branch, 'to', v_branch));
  insert into public.audit_log(org_id, actor_user, action, entity, entity_id, meta)
  values (p_org, auth.uid(), 'lead.branch', 'lead', p_lead::text, jsonb_build_object('from', v_lead.branch, 'to', v_branch));
  return jsonb_build_object('lead', p_lead, 'changed', true);
end $$;

revoke all on function
  public.lead_merge(uuid, uuid, uuid),
  public.lead_not_duplicate(uuid, uuid, uuid),
  public.lead_set_branch(uuid, uuid, text)
  from public, anon;
grant execute on function
  public.lead_merge(uuid, uuid, uuid),
  public.lead_not_duplicate(uuid, uuid, uuid),
  public.lead_set_branch(uuid, uuid, text)
  to authenticated;

comment on function public.lead_merge(uuid, uuid, uuid) is
  'Leads write: merge duplicate p_lead into its original p_into (DUPLICATE_CHANGED unless p_into is still its duplicate_of). Never deletes. Audit lead.merge.';
comment on function public.lead_not_duplicate(uuid, uuid, uuid) is
  'Leads write: clear the duplicate flag (must still be p_of) and remember it in not_duplicate_of. Audit lead.not_duplicate.';
comment on function public.lead_set_branch(uuid, uuid, text) is
  'Leads write: set or clear the lead branch. Audit lead.branch.';

notify pgrst, 'reload schema';
