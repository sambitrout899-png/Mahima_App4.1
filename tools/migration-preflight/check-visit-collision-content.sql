\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SELECT
  count(*) AS colliding_rows,
  count(*) FILTER (WHERE (to_jsonb(s)-'id') IS NOT DISTINCT FROM (to_jsonb(t)-ARRAY['id','tenant_id'])) AS identical,
  count(*) FILTER (WHERE (to_jsonb(s)-'id') IS DISTINCT FROM (to_jsonb(t)-ARRAY['id','tenant_id'])) AS different
FROM migration_source.daily_page_visits s JOIN public.daily_page_visits t ON t.id = s.id;
-- sample a few identical ones to see what they look like
SELECT s.id, s.path, s.user_id, s.created_at_utc, s.user_agent, s.ip_address
FROM migration_source.daily_page_visits s JOIN public.daily_page_visits t ON t.id = s.id
WHERE (to_jsonb(s)-'id') IS NOT DISTINCT FROM (to_jsonb(t)-ARRAY['id','tenant_id'])
LIMIT 10;
ROLLBACK;
