-- 0022: forms are written by the server only; encryption and archive invariants (M8 security review).
-- Applies after 0018 and 0020 (it only needs 0001, 0004, 0005 and 0018).
--
-- 1. Clients may no longer insert, update or delete public.forms (the app writes with the service role after
--    requirePerm('forms.manage')). Reads are unchanged (forms_select).
-- 2. forms trigger: deal and delivery-note are always encrypted; encrypt_entries changes only while the form has
--    no entries (the trigger re-checks entries inside the update); an archived form cannot be active.
-- 3. entries trigger: an entry must match its form's encryption (encrypted forms get data = '{}' plus
--    data_encrypted; plain forms no data_encrypted). It reads the form row FOR SHARE, so it waits for a concurrent
--    encryption change and the forms trigger then sees the new entry: no plain entry in an encrypted form.
-- 4. sync_form_workflow(form, statuses, roles): replaces form_statuses/form_roles in one call (atomic).
-- 5. form_usage(form): statuses that entries are in and roles with live role links (publish guards).

revoke insert, update, delete on public.forms from authenticated;

create or replace function public.tg_forms_invariants() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.slug in ('deal', 'delivery-note') and not new.encrypt_entries then
    raise exception 'form % is always encrypted', new.slug;
  end if;
  if new.archived_at is not null and new.is_active then
    raise exception 'an archived form cannot have its public link on';
  end if;
  if tg_op = 'UPDATE' and new.encrypt_entries is distinct from old.encrypt_entries
     and exists (select 1 from public.entries e where e.form_id = new.id) then
    raise exception 'encryption cannot change once the form has entries';
  end if;
  return new;
end $$;

create trigger forms_invariants before insert or update on public.forms
  for each row execute function public.tg_forms_invariants();

create or replace function public.tg_entries_match_encryption() returns trigger
language plpgsql set search_path = public as $$
declare enc boolean;
begin
  select f.encrypt_entries into enc from public.forms f where f.id = new.form_id for share;
  if enc and (new.data_encrypted is null and coalesce(new.data, '{}'::jsonb) <> '{}'::jsonb) then
    raise exception 'entries of an encrypted form must be encrypted';
  end if;
  if not enc and new.data_encrypted is not null then
    raise exception 'entries of a plain form cannot be encrypted';
  end if;
  return new;
end $$;

create trigger entries_match_encryption before insert or update of data, data_encrypted on public.entries
  for each row execute function public.tg_entries_match_encryption();

create or replace function public.sync_form_workflow(p_form uuid, p_statuses jsonb, p_roles jsonb)
returns void
language plpgsql set search_path = public as $$
begin
  delete from public.form_statuses where form_id = p_form;
  delete from public.form_roles where form_id = p_form;
  insert into public.form_statuses (form_id, name, color, sort_order, archived)
  select p_form, s->>'name', s->>'color', (s->>'sort_order')::int, coalesce((s->>'archived')::boolean, false)
  from jsonb_array_elements(p_statuses) s;
  insert into public.form_roles (form_id, name, is_public)
  select p_form, r->>'name', coalesce((r->>'is_public')::boolean, false)
  from jsonb_array_elements(p_roles) r;
end $$;
revoke all on function public.sync_form_workflow(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sync_form_workflow(uuid, jsonb, jsonb) to service_role;

create or replace function public.form_usage(p_form uuid)
returns table (kind text, name text)
language sql stable security invoker set search_path = public as $$
  select distinct 'status'::text, e.status from public.entries e where e.form_id = p_form
  union
  select distinct 'role'::text, l.role_name from public.entry_links l join public.entries e on e.id = l.entry_id
  where e.form_id = p_form and l.revoked_at is null and (l.expires_at is null or l.expires_at > now())
$$;
revoke all on function public.form_usage(uuid) from public, anon;
grant execute on function public.form_usage(uuid) to authenticated, service_role;
