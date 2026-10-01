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
 IF to_regclass('migration_v40.audit_log_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Audit log migration already committed; do not rerun'; END IF;
 IF to_regclass('migration_source."AuditLogs"') IS NULL THEN RAISE EXCEPTION 'Required migration prerequisites missing'; END IF;
END $$;
LOCK TABLE public."AuditLogs" IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE source_audit_logs AS SELECT * FROM migration_source."AuditLogs";
CREATE TABLE migration_v40.audit_logs_before AS SELECT * FROM public."AuditLogs";
DO $$
DECLARE source_count integer; target_count_before integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_audit_logs;
 SELECT count(*) INTO target_count_before FROM public."AuditLogs";
 IF source_count = 0 THEN RAISE EXCEPTION 'No source rows found - refusing to run against an empty source snapshot'; END IF;
 RAISE NOTICE 'Audit logs: % source rows, % pre-existing target rows', source_count, target_count_before;
 IF EXISTS (SELECT 1 FROM source_audit_logs s WHERE s."ActorId" IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM public.users u WHERE u.id=s."ActorId")) THEN
   RAISE EXCEPTION 'Source audit log references an ActorId that does not exist in the migrated users table';
 END IF;
END $$;
CREATE TABLE migration_v40.audit_log_id_map (
 source_id bigint PRIMARY KEY, target_id bigint NOT NULL, action text NOT NULL
);
-- Same reconciliation as daily_page_visits: colliding ids are usually coincidence (both sides
-- generate ids from their own sequence) except where content is byte-identical, which means the
-- target already holds this exact V4.0 row and must not be duplicated. Remapped rows get a fresh
-- id above the highest id in use on either side.
INSERT INTO migration_v40.audit_log_id_map
WITH base AS (
  SELECT greatest(coalesce((SELECT max("Id") FROM public."AuditLogs"),0),
                   coalesce((SELECT max("Id") FROM source_audit_logs),0)) AS v
),
classified AS (
  SELECT s."Id" AS source_id,
         t."Id" IS NOT NULL AS collides,
         t."Id" IS NOT NULL AND (to_jsonb(s)-'Id') IS NOT DISTINCT FROM (to_jsonb(t)-ARRAY['Id','tenant_id']) AS identical
  FROM source_audit_logs s LEFT JOIN public."AuditLogs" t ON t."Id" = s."Id"
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
-- Internal-consistency checks (exhaustive/exclusive classification, unique/free target ids)
-- replace the old fixed reviewed-count assertions, which do not survive real production data
-- continuing to change between rehearsal and cutover.
DO $$
DECLARE insert_count integer; reuse_count integer; remap_count integer; total_map integer; source_count integer;
BEGIN
 SELECT count(*) FILTER (WHERE action='insert'), count(*) FILTER (WHERE action='reuse_identical'),
        count(*) FILTER (WHERE action='insert_remapped'), count(*)
   INTO insert_count, reuse_count, remap_count, total_map
   FROM migration_v40.audit_log_id_map;
 SELECT count(*) INTO source_count FROM source_audit_logs;
 RAISE NOTICE 'Audit logs plan: % insert / % reuse_identical / % insert_remapped', insert_count, reuse_count, remap_count;
 IF insert_count + reuse_count + remap_count <> total_map THEN
   RAISE EXCEPTION 'Action classification is not exhaustive and exclusive';
 END IF;
 IF total_map <> source_count THEN
   RAISE EXCEPTION 'ID map does not cover every source row exactly once (% map rows vs % source rows)', total_map, source_count;
 END IF;
 IF (SELECT count(DISTINCT target_id) FROM migration_v40.audit_log_id_map WHERE action<>'reuse_identical') <> insert_count + remap_count THEN
   RAISE EXCEPTION 'Proposed target IDs are not unique';
 END IF;
 IF EXISTS (SELECT 1 FROM migration_v40.audit_log_id_map m JOIN public."AuditLogs" t ON t."Id"=m.target_id
            WHERE m.action='insert_remapped') THEN
   RAISE EXCEPTION 'Proposed new audit log ID is occupied';
 END IF;
END $$;
INSERT INTO public."AuditLogs"("Id","ActorId","Action","EntityType","EntityId","Details","CreatedAt",tenant_id)
SELECT m.target_id, s."ActorId", s."Action", s."EntityType", s."EntityId", s."Details", s."CreatedAt",
       '00000000-0000-0000-0000-000000000001'
FROM source_audit_logs s JOIN migration_v40.audit_log_id_map m ON m.source_id=s."Id"
WHERE m.action<>'reuse_identical';
DO $$
DECLARE root_before integer; target_count_before integer; inserted_count integer;
BEGIN
 SELECT count(*) INTO root_before FROM migration_v40.audit_logs_before WHERE tenant_id='00000000-0000-0000-0000-000000000001';
 SELECT count(*) INTO target_count_before FROM migration_v40.audit_logs_before;
 SELECT count(*) INTO inserted_count FROM migration_v40.audit_log_id_map WHERE action<>'reuse_identical';
 IF EXISTS (SELECT 1 FROM migration_v40.audit_logs_before b LEFT JOIN public."AuditLogs" t USING("Id")
            WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN
   RAISE EXCEPTION 'Pre-existing audit log record changed';
 END IF;
 IF (SELECT count(*) FROM public."AuditLogs")<>(target_count_before+inserted_count) OR
    (SELECT count(*) FROM public."AuditLogs" WHERE tenant_id='00000000-0000-0000-0000-000000000001')<>root_before+inserted_count THEN
   RAISE EXCEPTION 'Unexpected post-merge audit log totals';
 END IF;
END $$;
-- Identity reset uses transactional ALTER SEQUENCE, never moves the generator back.
DO $$
DECLARE seq regclass; seq_last bigint; seq_called boolean; seq_step bigint; max_id bigint; next_id numeric;
BEGIN
 seq:=pg_get_serial_sequence('public."AuditLogs"','Id')::regclass;
 IF seq IS NULL THEN RAISE EXCEPTION 'Audit log identity generator missing'; END IF;
 SELECT seqincrement INTO seq_step FROM pg_sequence WHERE seqrelid=seq;
 IF seq_step<>1 THEN RAISE EXCEPTION 'Unexpected sequence increment'; END IF;
 EXECUTE format('SELECT last_value,is_called FROM %s',seq) INTO seq_last,seq_called;
 SELECT max("Id") INTO max_id FROM public."AuditLogs";
 next_id:=greatest(max_id::numeric+1,seq_last::numeric+CASE WHEN seq_called THEN seq_step ELSE 0 END);
 IF next_id>9223372036854775807 THEN RAISE EXCEPTION 'Sequence overflow'; END IF;
 EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
END $$;
SELECT count(*) AS total_audit_logs,
       count(*) FILTER(WHERE tenant_id='00000000-0000-0000-0000-000000000001') AS root_audit_logs FROM public."AuditLogs";
SELECT action,count(*) AS mapped_audit_logs FROM migration_v40.audit_log_id_map GROUP BY action ORDER BY action;
COMMIT;
\echo 'Audit log migration committed.'
