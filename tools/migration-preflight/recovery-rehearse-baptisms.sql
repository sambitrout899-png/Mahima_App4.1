\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout='10s';
DO $$ BEGIN
 IF to_regclass('public.tenants') IS NULL THEN RAISE EXCEPTION 'Not a multi-tenant (V4.1) database - refusing to run here'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id='00000000-0000-0000-0000-000000000001'::uuid AND slug='mahima-root') THEN
   RAISE EXCEPTION 'Mahima Root tenant not found with the expected id/slug - refusing to run';
 END IF;
 IF to_regclass('migration_v40.baptism_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Baptism migration already committed; do not rerun'; END IF;
 IF to_regclass('migration_source.baptism_requests') IS NULL THEN RAISE EXCEPTION 'Required migration prerequisites missing'; END IF;
END $$;
LOCK TABLE public.baptism_requests IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE source_baptisms AS SELECT * FROM migration_source.baptism_requests;
CREATE TABLE migration_v40.baptisms_before AS SELECT * FROM public.baptism_requests;
DO $$
DECLARE source_count integer; target_count_before integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_baptisms;
 SELECT count(*) INTO target_count_before FROM public.baptism_requests;
 IF source_count = 0 THEN RAISE EXCEPTION 'No source rows found - refusing to run against an empty source snapshot'; END IF;
 RAISE NOTICE 'Baptism requests: % source rows, % pre-existing target rows', source_count, target_count_before;
END $$;
CREATE TABLE migration_v40.baptism_id_map (
 source_id integer PRIMARY KEY, target_id integer NOT NULL, action text NOT NULL
);
-- Same reconciliation as daily_page_visits/AuditLogs/security_events: colliding ids are usually
-- coincidence (both sides generate ids from their own sequence) except where content is
-- byte-identical, which means the target already holds this exact V4.0 row and must not be
-- duplicated. Remapped rows get a fresh id above the highest id in use on either side.
INSERT INTO migration_v40.baptism_id_map
WITH base AS (
  SELECT greatest(coalesce((SELECT max(id) FROM public.baptism_requests),0),
                   coalesce((SELECT max(id) FROM source_baptisms),0)) AS v
),
classified AS (
  SELECT s.id AS source_id,
         t.id IS NOT NULL AS collides,
         t.id IS NOT NULL AND (to_jsonb(s)-'id') IS NOT DISTINCT FROM (to_jsonb(t)-ARRAY['id','tenant_id']) AS identical
  FROM source_baptisms s LEFT JOIN public.baptism_requests t ON t.id = s.id
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
DO $$
DECLARE insert_count integer; reuse_count integer; remap_count integer; total_map integer; source_count integer;
BEGIN
 SELECT count(*) FILTER (WHERE action='insert'), count(*) FILTER (WHERE action='reuse_identical'),
        count(*) FILTER (WHERE action='insert_remapped'), count(*)
   INTO insert_count, reuse_count, remap_count, total_map
   FROM migration_v40.baptism_id_map;
 SELECT count(*) INTO source_count FROM source_baptisms;
 RAISE NOTICE 'Baptism requests plan: % insert / % reuse_identical / % insert_remapped', insert_count, reuse_count, remap_count;
 IF insert_count + reuse_count + remap_count <> total_map THEN
   RAISE EXCEPTION 'Action classification is not exhaustive and exclusive';
 END IF;
 IF total_map <> source_count THEN
   RAISE EXCEPTION 'ID map does not cover every source row exactly once (% map rows vs % source rows)', total_map, source_count;
 END IF;
 IF (SELECT count(DISTINCT target_id) FROM migration_v40.baptism_id_map WHERE action<>'reuse_identical') <> insert_count + remap_count THEN
   RAISE EXCEPTION 'Proposed target IDs are not unique';
 END IF;
 IF EXISTS (SELECT 1 FROM migration_v40.baptism_id_map m JOIN public.baptism_requests t ON t.id=m.target_id
            WHERE m.action='insert_remapped') THEN
   RAISE EXCEPTION 'Proposed new baptism ID is occupied';
 END IF;
END $$;
INSERT INTO public.baptism_requests(
 id, token, full_name, father_name, mother_name, date_of_birth, contact_number, email, address,
 church_member_id, preferred_date, preferred_service, church_verified, church_verified_by, church_verified_at,
 consent_signed, consent_signed_at, consent_signed_by, status, certificate_pdf_url, baptism_date, baptism_place,
 baptized_by_user_id, created_at, updated_at, tenant_id)
SELECT m.target_id, s.token, s.full_name, s.father_name, s.mother_name, s.date_of_birth, s.contact_number, s.email, s.address,
 s.church_member_id, s.preferred_date, s.preferred_service, s.church_verified, s.church_verified_by, s.church_verified_at,
 s.consent_signed, s.consent_signed_at, s.consent_signed_by, s.status, s.certificate_pdf_url, s.baptism_date, s.baptism_place,
 s.baptized_by_user_id, s.created_at, s.updated_at, '00000000-0000-0000-0000-000000000001'
FROM source_baptisms s JOIN migration_v40.baptism_id_map m ON m.source_id=s.id
WHERE m.action<>'reuse_identical';
DO $$
DECLARE root_before integer; target_count_before integer; inserted_count integer;
BEGIN
 SELECT count(*) INTO root_before FROM migration_v40.baptisms_before WHERE tenant_id='00000000-0000-0000-0000-000000000001';
 SELECT count(*) INTO target_count_before FROM migration_v40.baptisms_before;
 SELECT count(*) INTO inserted_count FROM migration_v40.baptism_id_map WHERE action<>'reuse_identical';
 IF EXISTS (SELECT 1 FROM migration_v40.baptisms_before b LEFT JOIN public.baptism_requests t USING(id)
            WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN
   RAISE EXCEPTION 'Pre-existing baptism record changed';
 END IF;
 IF (SELECT count(*) FROM public.baptism_requests)<>(target_count_before+inserted_count) OR
    (SELECT count(*) FROM public.baptism_requests WHERE tenant_id='00000000-0000-0000-0000-000000000001')<>root_before+inserted_count THEN
   RAISE EXCEPTION 'Unexpected post-merge baptism totals';
 END IF;
END $$;
-- Identity reset uses transactional ALTER SEQUENCE, never moves the generator back.
DO $$
DECLARE seq regclass; seq_last bigint; seq_called boolean; seq_step bigint; max_id bigint; next_id numeric;
BEGIN
 seq:=pg_get_serial_sequence('public.baptism_requests','id')::regclass;
 IF seq IS NULL THEN RAISE EXCEPTION 'Baptism identity generator missing'; END IF;
 SELECT seqincrement INTO seq_step FROM pg_sequence WHERE seqrelid=seq;
 IF seq_step<>1 THEN RAISE EXCEPTION 'Unexpected sequence increment'; END IF;
 EXECUTE format('SELECT last_value,is_called FROM %s',seq) INTO seq_last,seq_called;
 SELECT max(id) INTO max_id FROM public.baptism_requests;
 next_id:=greatest(max_id::numeric+1,seq_last::numeric+CASE WHEN seq_called THEN seq_step ELSE 0 END);
 IF next_id>2147483647 THEN RAISE EXCEPTION 'Sequence overflow'; END IF;
 EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
END $$;
SELECT count(*) AS total_baptisms,
       count(*) FILTER(WHERE tenant_id='00000000-0000-0000-0000-000000000001') AS root_baptisms FROM public.baptism_requests;
SELECT action,count(*) AS mapped_baptisms FROM migration_v40.baptism_id_map GROUP BY action ORDER BY action;
COMMIT;
\echo 'Baptism migration committed.'
