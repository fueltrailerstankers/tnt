-- 0009: Xero action modes (app_settings "xero.action.*") change only through the server action, which checks
-- xero.actions.configure, the typed confirmation for live, and writes the audit row. Clients may still read
-- them; no client may insert, update or delete them directly through the API.

create policy settings_no_client_xero_action_insert on public.app_settings as restrictive for insert to authenticated
  with check (key not like 'xero.action.%');
create policy settings_no_client_xero_action_update on public.app_settings as restrictive for update to authenticated
  using (key not like 'xero.action.%')
  with check (key not like 'xero.action.%');
create policy settings_no_client_xero_action_delete on public.app_settings as restrictive for delete to authenticated
  using (key not like 'xero.action.%');
