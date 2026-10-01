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
 IF to_regclass('migration_v40.timesheet_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Timesheet migration already committed'; END IF;
END $$;
LOCK TABLE public."Timesheets" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.users IN SHARE MODE;
CREATE TEMP TABLE recovery_before AS SELECT * FROM public."Timesheets";
CREATE TEMP TABLE source_timesheets AS SELECT * FROM migration_source."Timesheets";
CREATE TABLE migration_v40.timesheets_before AS SELECT * FROM recovery_before;
CREATE TABLE migration_v40.timesheet_source_snapshot AS SELECT * FROM source_timesheets;
DO $$
DECLARE source_count integer; target_count_before integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_timesheets;
 SELECT count(*) INTO target_count_before FROM recovery_before;
 IF source_count = 0 THEN RAISE EXCEPTION 'No source rows found - refusing to run against an empty source snapshot'; END IF;
 RAISE NOTICE 'Timesheets: % source rows, % pre-existing target rows', source_count, target_count_before;
 IF EXISTS(SELECT 1 FROM source_timesheets s LEFT JOIN public.users u ON u.id=s."UserId"::uuid WHERE u.id IS NULL OR u.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) THEN RAISE EXCEPTION 'Timesheet user missing or not root'; END IF;
END $$;
CREATE TABLE migration_v40.timesheet_id_map(source_id integer PRIMARY KEY,target_id integer NOT NULL UNIQUE,action text NOT NULL);
INSERT INTO migration_v40.timesheet_id_map
SELECT s."Id",CASE WHEN t."Id" IS NOT NULL AND t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid THEN s."Id" ELSE (SELECT coalesce(max("Id"),0) FROM public."Timesheets")+row_number() OVER(ORDER BY s."Id") END,CASE WHEN t."Id" IS NOT NULL AND t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid THEN 'reuse_root' ELSE 'insert_remapped' END
FROM source_timesheets s LEFT JOIN public."Timesheets" t ON t."Id"=s."Id";
UPDATE public."Timesheets" t SET "UserId"=s."UserId","Date"=s."Date","Hours"=s."Hours","Task"=s."Task","Notes"=s."Notes" FROM source_timesheets s JOIN migration_v40.timesheet_id_map m ON m.source_id=s."Id" WHERE m.action='reuse_root' AND t."Id"=m.target_id AND t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid;
INSERT INTO public."Timesheets"("Id","UserId","Date","Hours","Task","Notes","TenantId") SELECT m.target_id,s."UserId",s."Date",s."Hours",s."Task",s."Notes",'00000000-0000-0000-0000-000000000001'::uuid FROM source_timesheets s JOIN migration_v40.timesheet_id_map m ON m.source_id=s."Id" WHERE m.action='insert_remapped';
DO $$
DECLARE source_count integer; other_before integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_timesheets;
 SELECT count(*) INTO other_before FROM migration_v40.timesheets_before WHERE "TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid;
 IF (SELECT count(*) FROM migration_v40.timesheet_id_map)<>source_count OR (SELECT count(*) FROM public."Timesheets" WHERE "TenantId"='00000000-0000-0000-0000-000000000001'::uuid)<source_count THEN RAISE EXCEPTION 'Timesheet reconciliation failed'; END IF;
 IF (SELECT count(*) FROM public."Timesheets" WHERE "TenantId"<>'00000000-0000-0000-0000-000000000001'::uuid)<>other_before THEN RAISE EXCEPTION 'Other-tenant timesheet changed'; END IF;
END $$;
SELECT action,count(*) FROM migration_v40.timesheet_id_map GROUP BY action ORDER BY action;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM recovery_before b LEFT JOIN public."Timesheets" t ON t."Id"=b."Id"
 WHERE NOT EXISTS(SELECT 1 FROM migration_v40.timesheet_id_map m WHERE m.action='reuse_root' AND m.target_id=b."Id")
 AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Unmapped destination row changed'; END IF;
 IF EXISTS(SELECT 1 FROM source_timesheets s LEFT JOIN migration_v40.timesheet_id_map m ON m.source_id=s."Id"
 LEFT JOIN public."Timesheets" t ON t."Id"=m.target_id WHERE t."Id" IS NULL OR t."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid OR t."UserId" IS DISTINCT FROM s."UserId" OR t."Date" IS DISTINCT FROM s."Date" OR t."Hours" IS DISTINCT FROM s."Hours" OR t."Task" IS DISTINCT FROM s."Task" OR t."Notes" IS DISTINCT FROM s."Notes") THEN RAISE EXCEPTION 'Mapped content reconciliation failed'; END IF;
END $$;
CREATE TABLE migration_v40.timesheet_totals AS SELECT
 (SELECT sum("Hours") FROM source_timesheets) AS source_hours,
 (SELECT sum(t."Hours") FROM public."Timesheets" t JOIN migration_v40.timesheet_id_map m ON m.target_id=t."Id") AS mapped_hours;
DO $$
DECLARE seq regclass; last_id bigint; called boolean; highest bigint; next_id numeric; target_before integer; insert_remapped_count integer;
BEGIN
 SELECT count(*) INTO target_before FROM migration_v40.timesheets_before;
 SELECT count(*) INTO insert_remapped_count FROM migration_v40.timesheet_id_map WHERE action='insert_remapped';
 IF (SELECT count(*) FROM public."Timesheets")<>(target_before+insert_remapped_count) THEN RAISE EXCEPTION 'Timesheet final counts differ'; END IF;
 IF EXISTS(SELECT 1 FROM migration_v40.timesheet_totals WHERE source_hours IS DISTINCT FROM mapped_hours) THEN RAISE EXCEPTION 'Timesheet hours differ'; END IF;
 seq:=pg_get_serial_sequence('public."Timesheets"','Id')::regclass;
 IF seq IS NULL OR (SELECT seqincrement FROM pg_sequence WHERE seqrelid=seq)<>1 THEN RAISE EXCEPTION 'Unexpected timesheet sequence'; END IF;
 EXECUTE format('SELECT last_value,is_called FROM %s',seq) INTO last_id,called;
 SELECT max("Id") INTO highest FROM public."Timesheets";
 next_id:=greatest(highest::numeric+1,last_id::numeric+CASE WHEN called THEN 1 ELSE 0 END);
 IF next_id>2147483647 THEN RAISE EXCEPTION 'Timesheet ID overflow'; END IF;
 EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
END $$;
SELECT * FROM migration_v40.timesheet_totals;
SELECT count(*) AS total_timesheets,
 count(*) FILTER(WHERE "TenantId"='00000000-0000-0000-0000-000000000001') AS root_timesheets,
 count(*) FILTER(WHERE "TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) AS other_timesheets
 FROM public."Timesheets";
COMMIT;
\echo 'Timesheet migration committed. Continue with payroll settings.'
