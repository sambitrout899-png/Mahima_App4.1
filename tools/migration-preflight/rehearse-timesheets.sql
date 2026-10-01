\set ON_ERROR_STOP on
\pset pager off
BEGIN;
DO $$ BEGIN IF current_database()<>'mahima_v41_rehearsal_20260922_072500_351048' THEN RAISE EXCEPTION 'Wrong rehearsal database'; END IF; IF to_regclass('migration_v40.timesheet_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Timesheet rehearsal already committed'; END IF; END $$;
LOCK TABLE public."Timesheets" IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE recovery_before AS SELECT * FROM public."Timesheets";
CREATE TEMP TABLE source_timesheets AS SELECT * FROM migration_source."Timesheets";
CREATE TABLE migration_v40.timesheet_id_map(source_id integer PRIMARY KEY,target_id integer NOT NULL UNIQUE,action text NOT NULL);
INSERT INTO migration_v40.timesheet_id_map
SELECT s."Id",CASE WHEN t."Id" IS NOT NULL AND t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid THEN s."Id" ELSE (SELECT coalesce(max("Id"),0) FROM public."Timesheets")+row_number() OVER(ORDER BY s."Id") END,CASE WHEN t."Id" IS NOT NULL AND t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid THEN 'reuse_root' ELSE 'insert_remapped' END
FROM source_timesheets s LEFT JOIN public."Timesheets" t ON t."Id"=s."Id";
UPDATE public."Timesheets" t SET "UserId"=s."UserId","Date"=s."Date","Hours"=s."Hours","Task"=s."Task","Notes"=s."Notes" FROM source_timesheets s JOIN migration_v40.timesheet_id_map m ON m.source_id=s."Id" WHERE m.action='reuse_root' AND t."Id"=m.target_id AND t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid;
INSERT INTO public."Timesheets"("Id","UserId","Date","Hours","Task","Notes","TenantId") SELECT m.target_id,s."UserId",s."Date",s."Hours",s."Task",s."Notes",'00000000-0000-0000-0000-000000000001'::uuid FROM source_timesheets s JOIN migration_v40.timesheet_id_map m ON m.source_id=s."Id" WHERE m.action='insert_remapped';
DO $$ BEGIN IF (SELECT count(*) FROM migration_v40.timesheet_id_map)<>491 OR (SELECT count(*) FROM public."Timesheets" WHERE "TenantId"='00000000-0000-0000-0000-000000000001'::uuid)<491 THEN RAISE EXCEPTION 'Timesheet reconciliation failed'; END IF; IF (SELECT count(*) FROM public."Timesheets" WHERE "TenantId"<>'00000000-0000-0000-0000-000000000001'::uuid)<>8 THEN RAISE EXCEPTION 'Other-tenant timesheet changed'; END IF; END $$;
SELECT action,count(*) FROM migration_v40.timesheet_id_map GROUP BY action ORDER BY action;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM recovery_before b LEFT JOIN public."Timesheets" t ON t."Id"=b."Id"
 WHERE NOT EXISTS(SELECT 1 FROM migration_v40.timesheet_id_map m WHERE m.action='reuse_root' AND m.target_id=b."Id")
 AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Unmapped destination row changed'; END IF;
 IF EXISTS(SELECT 1 FROM source_timesheets s LEFT JOIN migration_v40.timesheet_id_map m ON m.source_id=s."Id"
 LEFT JOIN public."Timesheets" t ON t."Id"=m.target_id WHERE t."Id" IS NULL OR t."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid OR t."UserId" IS DISTINCT FROM s."UserId" OR t."Date" IS DISTINCT FROM s."Date" OR t."Hours" IS DISTINCT FROM s."Hours" OR t."Task" IS DISTINCT FROM s."Task" OR t."Notes" IS DISTINCT FROM s."Notes") THEN RAISE EXCEPTION 'Mapped content reconciliation failed'; END IF;
END $$;
COMMIT;
\echo 'Timesheet rehearsal committed. Continue with payroll settings.'
