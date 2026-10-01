\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_database()<>'mahima_v41_rehearsal_20260922_072500_351048' THEN RAISE EXCEPTION 'Wrong rehearsal database'; END IF;
 IF to_regclass('migration_v40.task_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Task rehearsal already committed'; END IF;
END $$;
LOCK TABLE public."Tasks" IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE source_tasks AS SELECT * FROM migration_source."Tasks";
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
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM migration_v40.tasks_before b JOIN public."Tasks" t USING("Id") WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Existing tasks changed'; END IF;
 IF EXISTS(SELECT 1 FROM source_tasks s JOIN migration_v40.task_id_map m ON m.source_id=s."Id" LEFT JOIN public."Tasks" t ON t."Id"=m.target_id WHERE t."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid OR t."Title" IS DISTINCT FROM s."Title") THEN RAISE EXCEPTION 'Task reconciliation failed'; END IF;
 IF (SELECT count(*) FROM migration_v40.task_id_map)<>71 THEN RAISE EXCEPTION 'Unexpected task count'; END IF;
END $$;
SELECT count(*) AS root_tasks FROM public."Tasks" WHERE "TenantId"='00000000-0000-0000-0000-000000000001'::uuid;
SELECT action,count(*) FROM migration_v40.task_id_map GROUP BY action;
COMMIT;
\echo 'Task rehearsal committed. Assignment and membership stages remain separate.'
