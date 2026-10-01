\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_database()<>'mahima_v41_rehearsal_20260922_072500_351048' THEN RAISE EXCEPTION 'Wrong rehearsal database'; END IF;
 IF to_regclass('migration_v40.attendance_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Attendance rehearsal already committed'; END IF;
END $$;
LOCK TABLE public."AttendanceRecords" IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE recovery_before AS SELECT * FROM public."AttendanceRecords";
CREATE TEMP TABLE source_attendance AS SELECT * FROM migration_source."AttendanceRecords";
CREATE TABLE migration_v40.attendance_before AS SELECT * FROM public."AttendanceRecords";
CREATE TABLE migration_v40.attendance_id_map(source_id integer PRIMARY KEY,target_id integer NOT NULL UNIQUE,action text NOT NULL);
INSERT INTO migration_v40.attendance_id_map
SELECT s."Id",CASE WHEN t."Id" IS NOT NULL AND t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid THEN s."Id" ELSE (SELECT coalesce(max("Id"),0) FROM public."AttendanceRecords")+row_number() OVER (ORDER BY s."Id") END,
CASE WHEN t."Id" IS NOT NULL AND t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid THEN 'reuse_root' ELSE 'insert_remapped' END
FROM source_attendance s LEFT JOIN public."AttendanceRecords" t ON t."Id"=s."Id";
UPDATE public."AttendanceRecords" t SET "UserId"=s."UserId","Date"=s."Date","Status"=s."Status"
FROM source_attendance s JOIN migration_v40.attendance_id_map m ON m.source_id=s."Id" WHERE m.action='reuse_root' AND t."Id"=m.target_id AND t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid;
INSERT INTO public."AttendanceRecords"("Id","UserId","Date","Status","TenantId")
SELECT m.target_id,s."UserId",s."Date",s."Status",'00000000-0000-0000-0000-000000000001'::uuid
FROM source_attendance s JOIN migration_v40.attendance_id_map m ON m.source_id=s."Id" WHERE m.action='insert_remapped';
DO $$ BEGIN
 IF (SELECT count(*) FROM public."AttendanceRecords" WHERE "TenantId"<>'00000000-0000-0000-0000-000000000001'::uuid)<>28 THEN RAISE EXCEPTION 'Other-tenant attendance count changed'; END IF;
 IF (SELECT count(*) FROM migration_v40.attendance_id_map)<>782 OR (SELECT count(*) FROM public."AttendanceRecords" WHERE "TenantId"='00000000-0000-0000-0000-000000000001'::uuid)<782 THEN RAISE EXCEPTION 'Attendance reconciliation failed'; END IF;
END $$;
SELECT action,count(*) FROM migration_v40.attendance_id_map GROUP BY action ORDER BY action;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM recovery_before b LEFT JOIN public."AttendanceRecords" t ON t."Id"=b."Id"
 WHERE NOT EXISTS(SELECT 1 FROM migration_v40.attendance_id_map m WHERE m.action='reuse_root' AND m.target_id=b."Id")
 AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Unmapped destination row changed'; END IF;
 IF EXISTS(SELECT 1 FROM source_attendance s LEFT JOIN migration_v40.attendance_id_map m ON m.source_id=s."Id"
 LEFT JOIN public."AttendanceRecords" t ON t."Id"=m.target_id WHERE t."Id" IS NULL OR t."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid OR t."UserId" IS DISTINCT FROM s."UserId" OR t."Date" IS DISTINCT FROM s."Date" OR t."Status" IS DISTINCT FROM s."Status") THEN RAISE EXCEPTION 'Mapped content reconciliation failed'; END IF;
END $$;
COMMIT;
\echo 'Attendance rehearsal committed. Continue with Meetings.'
