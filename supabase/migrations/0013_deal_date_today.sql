-- 0013: DEAL "DATE CREATED" is pre-filled with today's date (org timezone) on a new entry and stays editable.
-- Mirrors docs/source/tt-forms/spec/forms/deal.json (field DATECREATED, "default": "today"). Idempotent.
update public.forms f
   set spec = jsonb_set(f.spec, '{fields}', (
     select jsonb_agg(case when x ->> 'name' = 'DATECREATED' then x || '{"default": "today"}'::jsonb else x end order by i)
       from jsonb_array_elements(f.spec -> 'fields') with ordinality as t(x, i)
   ))
 where f.slug = 'deal'
   and exists (select 1 from jsonb_array_elements(f.spec -> 'fields') x where x ->> 'name' = 'DATECREATED');
