\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SELECT 'source' side,count(*) records,count(DISTINCT id) ids FROM migration_source.daily_page_visits;
SELECT 'target' side,count(*) records,count(DISTINCT id) ids FROM public.daily_page_visits;
SELECT count(*) AS source_ids_already_present,
 count(*) FILTER (WHERE t.tenant_id='00000000-0000-0000-0000-000000000001'::uuid) AS root_ids,
 count(*) FILTER (WHERE t.tenant_id<>'00000000-0000-0000-0000-000000000001'::uuid) AS other_tenant_ids
FROM migration_source.daily_page_visits s JOIN public.daily_page_visits t ON t.id=s.id;
SELECT count(*) AS source_rows_with_user_id_not_in_target_users
FROM migration_source.daily_page_visits s
WHERE s.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id=s.user_id);
ROLLBACK;
