\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout='10s';
DO $$ BEGIN
 -- V4.0 and V4.1 share the literal database name "mahima_db_3_0", so a name check alone cannot
 -- tell them apart. public.tenants only exists on V4.1 (V4.0 predates multi-tenancy entirely) and
 -- the root tenant id is checked explicitly, so this fails loudly on the wrong server rather than
 -- silently writing V4.0-shaped data into V4.0 itself.
 IF to_regclass('public.tenants') IS NULL THEN RAISE EXCEPTION 'Not a multi-tenant (V4.1) database - refusing to run here'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id='00000000-0000-0000-0000-000000000001'::uuid AND slug='mahima-root') THEN
   RAISE EXCEPTION 'Mahima Root tenant not found with the expected id/slug - refusing to run';
 END IF;
 IF to_regclass('migration_v40.daily_page_visit_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Daily page visit migration already committed; do not rerun'; END IF;
 IF to_regclass('migration_source.daily_page_visits') IS NULL THEN RAISE EXCEPTION 'Required migration prerequisites missing'; END IF;
END $$;
LOCK TABLE public.daily_page_visits IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE source_visits AS SELECT * FROM migration_source.daily_page_visits;
CREATE TABLE migration_v40.daily_page_visits_before AS SELECT * FROM public.daily_page_visits;
DO $$
DECLARE source_count integer; target_count_before integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_visits;
 SELECT count(*) INTO target_count_before FROM public.daily_page_visits;
 IF source_count = 0 THEN RAISE EXCEPTION 'No source rows found - refusing to run against an empty source snapshot'; END IF;
 RAISE NOTICE 'Daily page visits: % source rows, % pre-existing target rows', source_count, target_count_before;
 IF EXISTS (SELECT 1 FROM source_visits s WHERE s.user_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM public.users u WHERE u.id=s.user_id)) THEN
   RAISE EXCEPTION 'Source page visit references a user_id that does not exist in the migrated users table';
 END IF;
END $$;
CREATE TABLE migration_v40.daily_page_visit_id_map (
 source_id bigint PRIMARY KEY, target_id bigint NOT NULL, action text NOT NULL
);
-- Both sides log independently from their own low-numbered sequences, so a colliding id is
-- usually coincidence (two unrelated events sharing a number), NOT the same event - except where
-- content is byte-identical, which means the target already holds this exact V4.0 row from an
-- earlier partial copy and must be left alone rather than duplicated.
-- Remapped rows get a fresh id above the highest id in use on EITHER side (a non-colliding source
-- row can itself have a high id that would otherwise fall inside a target-only "safe" range).
INSERT INTO migration_v40.daily_page_visit_id_map
WITH base AS (
  SELECT greatest(coalesce((SELECT max(id) FROM public.daily_page_visits),0),
                   coalesce((SELECT max(id) FROM source_visits),0)) AS v
),
classified AS (
  SELECT s.id AS source_id,
         t.id IS NOT NULL AS collides,
         t.id IS NOT NULL AND (to_jsonb(s)-'id') IS NOT DISTINCT FROM (to_jsonb(t)-ARRAY['id','tenant_id']) AS identical
  FROM source_visits s LEFT JOIN public.daily_page_visits t ON t.id = s.id
)
SELECT source_id,
       CASE WHEN NOT collides THEN source_id
            WHEN identical THEN source_id
            ELSE (SELECT v FROM base) + row_number() OVER (PARTITION BY (collides AND NOT identical) ORDER BY source_id)
       END,
       CASE WHEN NOT collides THEN 'insert'
            WHEN identical THEN 'reuse_identical'
            ELSE 'insert_remapped'
       END
FROM classified;
-- Internal-consistency checks: the classification must be exhaustive and exclusive, every
-- proposed new id must be genuinely free, and the map must cover every source row exactly once.
-- These catch a broken CASE/partition regardless of how many rows are actually involved, so they
-- don't need a specific pre-reviewed row count the way earlier drafts of this script did.
DO $$
DECLARE insert_count integer; reuse_count integer; remap_count integer; total_map integer; source_count integer;
BEGIN
 SELECT count(*) FILTER (WHERE action='insert'), count(*) FILTER (WHERE action='reuse_identical'),
        count(*) FILTER (WHERE action='insert_remapped'), count(*)
   INTO insert_count, reuse_count, remap_count, total_map
   FROM migration_v40.daily_page_visit_id_map;
 SELECT count(*) INTO source_count FROM source_visits;
 RAISE NOTICE 'Daily page visits plan: % insert / % reuse_identical / % insert_remapped', insert_count, reuse_count, remap_count;
 IF insert_count + reuse_count + remap_count <> total_map THEN
   RAISE EXCEPTION 'Action classification is not exhaustive and exclusive';
 END IF;
 IF total_map <> source_count THEN
   RAISE EXCEPTION 'ID map does not cover every source row exactly once (% map rows vs % source rows)', total_map, source_count;
 END IF;
 IF (SELECT count(DISTINCT target_id) FROM migration_v40.daily_page_visit_id_map WHERE action<>'reuse_identical') <> insert_count + remap_count THEN
   RAISE EXCEPTION 'Proposed target IDs are not unique';
 END IF;
 IF EXISTS (SELECT 1 FROM migration_v40.daily_page_visit_id_map m JOIN public.daily_page_visits t ON t.id=m.target_id
            WHERE m.action='insert_remapped') THEN
   RAISE EXCEPTION 'Proposed new page visit ID is occupied';
 END IF;
END $$;
INSERT INTO public.daily_page_visits(id,user_id,path,title,referrer,user_agent,ip_address,created_at_utc,tenant_id)
SELECT m.target_id, s.user_id, s.path, s.title, s.referrer, s.user_agent, s.ip_address, s.created_at_utc,
       '00000000-0000-0000-0000-000000000001'
FROM source_visits s JOIN migration_v40.daily_page_visit_id_map m ON m.source_id=s.id
WHERE m.action<>'reuse_identical';
DO $$
DECLARE root_before integer; target_count_before integer; inserted_count integer;
BEGIN
 SELECT count(*) INTO root_before FROM migration_v40.daily_page_visits_before WHERE tenant_id='00000000-0000-0000-0000-000000000001';
 SELECT count(*) INTO target_count_before FROM migration_v40.daily_page_visits_before;
 SELECT count(*) INTO inserted_count FROM migration_v40.daily_page_visit_id_map WHERE action<>'reuse_identical';
 IF EXISTS (SELECT 1 FROM migration_v40.daily_page_visits_before b LEFT JOIN public.daily_page_visits t USING(id)
            WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN
   RAISE EXCEPTION 'Pre-existing page visit record changed';
 END IF;
 IF (SELECT count(*) FROM public.daily_page_visits)<>(target_count_before+inserted_count) OR
    (SELECT count(*) FROM public.daily_page_visits WHERE tenant_id='00000000-0000-0000-0000-000000000001')<>root_before+inserted_count THEN
   RAISE EXCEPTION 'Unexpected post-merge page visit totals';
 END IF;
END $$;
-- Identity reset uses transactional ALTER SEQUENCE, never moves the generator back.
DO $$
DECLARE seq regclass; seq_last bigint; seq_called boolean; seq_step bigint; max_id bigint; next_id numeric;
BEGIN
 seq:=pg_get_serial_sequence('public.daily_page_visits','id')::regclass;
 IF seq IS NULL THEN RAISE EXCEPTION 'Page visit identity generator missing'; END IF;
 SELECT seqincrement INTO seq_step FROM pg_sequence WHERE seqrelid=seq;
 IF seq_step<>1 THEN RAISE EXCEPTION 'Unexpected sequence increment'; END IF;
 EXECUTE format('SELECT last_value,is_called FROM %s',seq) INTO seq_last,seq_called;
 SELECT max(id) INTO max_id FROM public.daily_page_visits;
 next_id:=greatest(max_id::numeric+1,seq_last::numeric+CASE WHEN seq_called THEN seq_step ELSE 0 END);
 IF next_id>9223372036854775807 THEN RAISE EXCEPTION 'Sequence overflow'; END IF;
 EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
END $$;
SELECT count(*) AS total_visits,
       count(*) FILTER(WHERE tenant_id='00000000-0000-0000-0000-000000000001') AS root_visits FROM public.daily_page_visits;
SELECT action,count(*) AS mapped_visits FROM migration_v40.daily_page_visit_id_map GROUP BY action ORDER BY action;
COMMIT;
\echo 'Daily page visit migration committed.'
