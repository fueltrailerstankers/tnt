-- 0012: the one-time lead intake stages (created, duplicate, routed, emailed) are recorded at most once per lead.
-- Two leads.intake jobs for the same lead (a webhook retry and the scheduler) could both find a stage missing and
-- both insert its lead_events row. With this index the second insert fails with 23505, which lib/leads/service.ts
-- treats as "already done". `matched` is excluded (logged again whenever the Xero match changes), and so are the
-- staff kinds (status, assigned, note), which repeat by design.
--
-- Existing data: lead_events is the lead's history, so this migration never deletes rows. If a lead already has a
-- repeated one-time event the migration stops with the message below; review those rows, remove the later copies
-- by hand, and apply it again (see supabase/migrations/README.md).

do $$
declare n int;
begin
  select count(*) into n from (
    select 1 from public.lead_events
    where kind in ('created', 'duplicate', 'routed', 'emailed')
    group by lead_id, kind
    having count(*) > 1
  ) d;
  if n > 0 then
    raise exception '0012_lead_events_once: % lead/kind pair(s) already have a repeated created/duplicate/routed/emailed event', n
      using hint = 'Find them with: select lead_id, kind, count(*) from public.lead_events where kind in (''created'',''duplicate'',''routed'',''emailed'') group by 1, 2 having count(*) > 1; keep the earliest row of each, then re-apply.';
  end if;
end $$;

create unique index lead_events_once on public.lead_events(lead_id, kind)
  where kind in ('created', 'duplicate', 'routed', 'emailed');
