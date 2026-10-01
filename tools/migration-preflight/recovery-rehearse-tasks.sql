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
 IF to_regclass('migration_v40.task_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Task migration already committed'; END IF;
END $$;
LOCK TABLE public."Tasks" IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE source_tasks AS SELECT * FROM migration_source."Tasks";
-- Retain attribution and the original timezone-free FollowUpDate verbatim.
CREATE TABLE migration_v40.task_source_snapshot AS SELECT * FROM source_tasks;
DO $$
DECLARE source_count integer; target_count_before integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_tasks;
 SELECT count(*) INTO target_count_before FROM public."Tasks";
 IF source_count = 0 THEN RAISE EXCEPTION 'No source rows found - refusing to run against an empty source snapshot'; END IF;
 RAISE NOTICE 'Tasks: % source rows, % pre-existing target rows', source_count, target_count_before;
 IF EXISTS(SELECT 1 FROM source_tasks s CROSS JOIN LATERAL (VALUES(s."CreatedById"),(s."AssigneeId")) refs(id)
 LEFT JOIN public.users u ON u.id=refs.id WHERE refs.id IS NOT NULL AND (u.id IS NULL OR u.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid)) THEN RAISE EXCEPTION 'Task user missing or not root'; END IF;
 IF EXISTS(SELECT 1 FROM source_tasks s LEFT JOIN source_tasks p ON p."Id"=s."ParentTaskId" WHERE s."ParentTaskId" IS NOT NULL AND p."Id" IS NULL) THEN RAISE EXCEPTION 'Missing parent task'; END IF;
 IF EXISTS(SELECT 1 FROM source_tasks s LEFT JOIN migration_v40.team_id_map m ON m.source_id=s."TeamId" LEFT JOIN public."Teams" t ON t."Id"=m.target_id WHERE s."TeamId" IS NOT NULL AND (t."Id" IS NULL OR t."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid)) THEN RAISE EXCEPTION 'Task team missing or not root'; END IF;
 IF EXISTS(SELECT 1 FROM source_tasks s LEFT JOIN migration_v40.position_id_map m ON m.source_id=s."OwnerPositionId" LEFT JOIN public.positions t ON t.id=m.target_id WHERE s."OwnerPositionId" IS NOT NULL AND (t.id IS NULL OR t.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid)) THEN RAISE EXCEPTION 'Task position missing or not root'; END IF;
END $$;
CREATE TABLE migration_v40.tasks_before AS SELECT * FROM public."Tasks";
CREATE TABLE migration_v40.task_id_map(source_id bigint PRIMARY KEY,target_id bigint NOT NULL UNIQUE,action text NOT NULL);
INSERT INTO migration_v40.task_id_map
SELECT s."Id", greatest((SELECT coalesce(max("Id"),0) FROM public."Tasks"),(SELECT coalesce(max("Id"),0) FROM source_tasks))+row_number() OVER(ORDER BY s."Id"),'insert'
FROM source_tasks s;
INSERT INTO public."Tasks"("Id","Title","Description","CreatedById","AssigneeId","TeamId","Status","Priority","DueDate","CreatedAt","UpdatedAt","ClosedAt","TenantId","ProcessStage","ParentTaskId","TaskType","FollowUpDate","FollowUpNotes","Recurring","EventRef","IsAutoGen","OwnerPositionId","ParentViewerPositionId")
SELECT m.target_id,s."Title",s."Description",s."CreatedById",s."AssigneeId",tm.target_id,s."Status",s."Priority",s."DueDate",s."CreatedAt",s."UpdatedAt",s."ClosedAt",'00000000-0000-0000-0000-000000000001'::uuid,s."ProcessStage",pm.target_id,s."TaskType",s."FollowUpDate"::timestamptz,s."FollowUpNotes",'none',NULL,false,po.target_id,NULL
FROM source_tasks s JOIN migration_v40.task_id_map m ON m.source_id=s."Id"
LEFT JOIN migration_v40.task_id_map pm ON pm.source_id=s."ParentTaskId"
LEFT JOIN migration_v40.team_id_map tm ON tm.source_id=s."TeamId"
LEFT JOIN migration_v40.position_id_map po ON po.source_id=s."OwnerPositionId";
DO $$
DECLARE source_count integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_tasks;
 IF EXISTS(SELECT 1 FROM migration_v40.tasks_before b JOIN public."Tasks" t USING("Id") WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Existing tasks changed'; END IF;
 IF EXISTS(SELECT 1 FROM source_tasks s JOIN migration_v40.task_id_map m ON m.source_id=s."Id" LEFT JOIN public."Tasks" t ON t."Id"=m.target_id WHERE t."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid OR t."Title" IS DISTINCT FROM s."Title") THEN RAISE EXCEPTION 'Task reconciliation failed'; END IF;
 IF (SELECT count(*) FROM migration_v40.task_id_map)<>source_count THEN RAISE EXCEPTION 'Unexpected task count'; END IF;
END $$;
SELECT count(*) AS root_tasks FROM public."Tasks" WHERE "TenantId"='00000000-0000-0000-0000-000000000001'::uuid;
SELECT action,count(*) FROM migration_v40.task_id_map GROUP BY action;
DO $$
DECLARE seq regclass; old_value bigint; called boolean; max_id bigint; next_id numeric; target_before integer; source_count integer;
BEGIN
 IF EXISTS(SELECT 1 FROM migration_v40.tasks_before b LEFT JOIN public."Tasks" t USING("Id") WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Existing task changed or deleted'; END IF;
 IF EXISTS(SELECT 1 FROM source_tasks s
 LEFT JOIN migration_v40.task_id_map m ON m.source_id=s."Id"
 LEFT JOIN migration_v40.task_id_map p ON p.source_id=s."ParentTaskId"
 LEFT JOIN migration_v40.team_id_map tm ON tm.source_id=s."TeamId"
 LEFT JOIN migration_v40.position_id_map po ON po.source_id=s."OwnerPositionId"
 LEFT JOIN public."Tasks" t ON t."Id"=m.target_id
 WHERE t."Id" IS NULL OR
 (to_jsonb(s)-ARRAY['Id','ParentTaskId','TeamId','OwnerPositionId','FollowUpDate','UpdatedById','AssignedByUserId','AssignedByPositionId'])
 IS DISTINCT FROM (to_jsonb(t)-ARRAY['Id','ParentTaskId','TeamId','OwnerPositionId','FollowUpDate','TenantId','Recurring','EventRef','IsAutoGen','ParentViewerPositionId'])
 OR t."ParentTaskId" IS DISTINCT FROM p.target_id OR t."TeamId" IS DISTINCT FROM tm.target_id
 OR t."OwnerPositionId" IS DISTINCT FROM po.target_id
 OR t."FollowUpDate" IS DISTINCT FROM (s."FollowUpDate" AT TIME ZONE 'UTC')
 OR t."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
 OR t."Recurring" IS DISTINCT FROM 'none' OR t."EventRef" IS NOT NULL OR t."IsAutoGen" IS DISTINCT FROM false OR t."ParentViewerPositionId" IS NOT NULL)
 THEN RAISE EXCEPTION 'Full task reconciliation failed'; END IF;
 SELECT count(*) INTO target_before FROM migration_v40.tasks_before;
 SELECT count(*) INTO source_count FROM source_tasks;
 IF (SELECT count(*) FROM public."Tasks")<>(target_before+source_count) THEN RAISE EXCEPTION 'Task count mismatch'; END IF;
 seq:=pg_get_serial_sequence('public."Tasks"','Id')::regclass;
 IF seq IS NULL OR (SELECT seqincrement FROM pg_sequence WHERE seqrelid=seq)<>1 THEN RAISE EXCEPTION 'Unexpected task sequence'; END IF;
 EXECUTE format('SELECT last_value,is_called FROM %s',seq) INTO old_value,called;
 SELECT max("Id") INTO max_id FROM public."Tasks";
 next_id:=greatest(max_id::numeric+1,old_value::numeric+CASE WHEN called THEN 1 ELSE 0 END);
 IF next_id>9223372036854775807 THEN RAISE EXCEPTION 'Task sequence overflow'; END IF;
 EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
END $$;
COMMIT;
\echo 'Task migration committed. Assignment and membership stages remain separate.'
