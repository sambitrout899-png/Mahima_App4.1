\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SELECT 'prayerrequests' table_name,(SELECT count(*) FROM migration_source.prayerrequests) source_rows,(SELECT count(*) FROM public.prayerrequests) target_rows;
SELECT 'prayerresponses' table_name,(SELECT count(*) FROM migration_source.prayerresponses),(SELECT count(*) FROM public.prayerresponses);
SELECT 'prayertestimonies' table_name,(SELECT count(*) FROM migration_source.prayertestimonies),(SELECT count(*) FROM public.prayertestimonies);
SELECT 'request_id_collisions' issue,count(*) FROM migration_source.prayerrequests s JOIN public.prayerrequests t ON t.id=s.id
UNION ALL SELECT 'response_id_collisions',count(*) FROM migration_source.prayerresponses s JOIN public.prayerresponses t ON t.id=s.id
UNION ALL SELECT 'testimony_id_collisions',count(*) FROM migration_source.prayertestimonies s JOIN public.prayertestimonies t ON t.id=s.id;
ROLLBACK;
