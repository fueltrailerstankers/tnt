-- Scheduler for the Xero mirror and the job outbox (Supabase pg_cron + pg_net). NOT a migration:
-- run once in the Supabase SQL editor after the app is deployed, replacing the two placeholders.
-- The job secret is kept in Supabase Vault, never in the cron command text.
--
--   <APP_URL>     e.g. https://trailer-eta.vercel.app   (no trailing slash)
--   <JOB_SECRET>  the same value as the JOB_SECRET env var in Vercel (at least 32 characters)
--
-- Times are UTC. South Africa is UTC+2: 05:00-20:00 UTC = 07:00-22:00 SAST.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('<JOB_SECRET>', 'job_secret', 'Bearer secret for /api/jobs/*');

create or replace function public.call_job(p_queue text, p_body jsonb default '{}'::jsonb) returns bigint
language sql security definer set search_path = public, extensions as $$
  select net.http_post(
    url := '<APP_URL>/api/jobs/' || p_queue,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'job_secret')
    ),
    body := p_body,
    timeout_milliseconds := 60000
  )
$$;
revoke all on function public.call_job(text, jsonb) from public, anon, authenticated;

-- Invoices and payments every 15 minutes in business hours (release on payment depends on this).
select cron.schedule('xero-sync-quick', '*/15 5-20 * * *', $$select public.call_job('xero-sync', '{"mode":"quick"}')$$);
-- Everything (contacts, quotes, invoices, payments, attachment metadata) nightly at 00:30 SAST.
select cron.schedule('xero-sync-full', '30 22 * * *', $$select public.call_job('xero-sync', '{"mode":"full"}')$$);
-- Drain the outbox (webhook fetches, deal-file rebuilds) every 5 minutes.
select cron.schedule('outbox-drain', '*/5 * * * *', $$select public.call_job('outbox')$$);

-- Check:   select jobname, schedule, active from cron.job;
-- History: select * from cron.job_run_details order by start_time desc limit 20;
--          select id, status_code, created from net._http_response order by created desc limit 20;
-- Stop:    select cron.unschedule('xero-sync-quick');  (and the others)
