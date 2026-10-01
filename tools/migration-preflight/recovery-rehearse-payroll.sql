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
 IF to_regclass('migration_v40.payroll_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Payroll migration already committed'; END IF;
END $$;
LOCK TABLE public.staff_payroll_settings IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.users IN SHARE MODE;
CREATE TEMP TABLE recovery_before AS SELECT * FROM public.staff_payroll_settings;
CREATE TEMP TABLE source_payroll AS SELECT * FROM migration_source.staff_payroll_settings;
CREATE TABLE migration_v40.payroll_before AS SELECT * FROM recovery_before;
CREATE TABLE migration_v40.payroll_source_snapshot AS SELECT * FROM source_payroll;
-- Generalized orphan detection: any source payroll row whose user_id resolves to no migrated
-- user at all (neither in the source users table nor already in the target) gets archived here
-- instead of blocking the whole migration - not tied to the specific row found during rehearsal.
CREATE TABLE migration_v40.orphan_payroll_settings AS
SELECT s.* FROM source_payroll s
WHERE NOT EXISTS(SELECT 1 FROM migration_source.users u WHERE u.id=s.user_id::uuid)
AND NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=s.user_id::uuid);
DO $$
DECLARE source_count integer; orphan_count integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_payroll;
 SELECT count(*) INTO orphan_count FROM migration_v40.orphan_payroll_settings;
 IF source_count = 0 THEN RAISE EXCEPTION 'No source rows found - refusing to run against an empty source snapshot'; END IF;
 RAISE NOTICE 'Payroll: % source rows, % orphaned (user reference resolves nowhere, archived not migrated)', source_count, orphan_count;
END $$;
-- Only remove verified orphans from temporary import staging, retaining their full source rows.
DELETE FROM source_payroll s USING migration_v40.orphan_payroll_settings o WHERE s.id=o.id;
DO $$
DECLARE source_count integer; target_count_before integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_payroll;
 SELECT count(*) INTO target_count_before FROM recovery_before;
 RAISE NOTICE 'Payroll after orphan removal: % source rows, % pre-existing target rows', source_count, target_count_before;
 IF EXISTS(SELECT 1 FROM source_payroll s LEFT JOIN public.users u ON u.id=s.user_id::uuid WHERE u.id IS NULL OR u.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) THEN RAISE EXCEPTION 'Payroll user missing or not root'; END IF;
 -- A numeric ID alone must not transfer a different employee's payroll settings.
 IF EXISTS(SELECT 1 FROM source_payroll s JOIN recovery_before b ON b.id=s.id WHERE b.tenant_id='00000000-0000-0000-0000-000000000001'::uuid AND b.user_id::uuid IS DISTINCT FROM s.user_id::uuid) THEN RAISE EXCEPTION 'Root payroll ID belongs to a different user; review mapping'; END IF;
 IF EXISTS(SELECT user_id::uuid FROM source_payroll GROUP BY user_id::uuid HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate source payroll user'; END IF;
END $$;
CREATE TABLE migration_v40.payroll_id_map(source_id integer PRIMARY KEY,target_id integer NOT NULL UNIQUE,action text NOT NULL);
INSERT INTO migration_v40.payroll_id_map SELECT s.id,CASE WHEN t.id IS NOT NULL AND t.tenant_id='00000000-0000-0000-0000-000000000001'::uuid THEN s.id ELSE (SELECT coalesce(max(id),0) FROM public.staff_payroll_settings)+row_number() OVER(ORDER BY s.id) END,CASE WHEN t.id IS NOT NULL AND t.tenant_id='00000000-0000-0000-0000-000000000001'::uuid THEN 'reuse_root' ELSE 'insert_remapped' END FROM source_payroll s LEFT JOIN public.staff_payroll_settings t ON t.id=s.id;
UPDATE public.staff_payroll_settings t SET user_id=s.user_id,hourly_rate=s.hourly_rate,monthly_fixed_amount=s.monthly_fixed_amount,allowances=s.allowances,deductions=s.deductions,is_active=s.is_active,"ExpectedMonthlyHours"=s."ExpectedMonthlyHours","SalaryType"=s."SalaryType" FROM source_payroll s JOIN migration_v40.payroll_id_map m ON m.source_id=s.id WHERE m.action='reuse_root' AND t.id=m.target_id AND t.tenant_id='00000000-0000-0000-0000-000000000001'::uuid;
INSERT INTO public.staff_payroll_settings(id,user_id,hourly_rate,monthly_fixed_amount,allowances,deductions,is_active,"ExpectedMonthlyHours","SalaryType",tenant_id) SELECT m.target_id,s.user_id,s.hourly_rate,s.monthly_fixed_amount,s.allowances,s.deductions,s.is_active,s."ExpectedMonthlyHours",s."SalaryType",'00000000-0000-0000-0000-000000000001'::uuid FROM source_payroll s JOIN migration_v40.payroll_id_map m ON m.source_id=s.id WHERE m.action='insert_remapped';
DO $$
DECLARE source_count integer; other_before integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_payroll;
 SELECT count(*) INTO other_before FROM migration_v40.payroll_before WHERE tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid;
 IF (SELECT count(*) FROM migration_v40.payroll_id_map)<>source_count OR (SELECT count(*) FROM public.staff_payroll_settings WHERE tenant_id='00000000-0000-0000-0000-000000000001'::uuid)<source_count THEN RAISE EXCEPTION 'Payroll reconciliation failed'; END IF;
 IF (SELECT count(*) FROM public.staff_payroll_settings WHERE tenant_id<>'00000000-0000-0000-0000-000000000001'::uuid)<>other_before THEN RAISE EXCEPTION 'Other-tenant payroll changed'; END IF;
END $$;
SELECT action,count(*) FROM migration_v40.payroll_id_map GROUP BY action ORDER BY action;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM recovery_before b LEFT JOIN public.staff_payroll_settings t ON t.id=b.id
 WHERE NOT EXISTS(SELECT 1 FROM migration_v40.payroll_id_map m WHERE m.action='reuse_root' AND m.target_id=b.id)
 AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Unmapped destination row changed'; END IF;
 IF EXISTS(SELECT 1 FROM source_payroll s LEFT JOIN migration_v40.payroll_id_map m ON m.source_id=s.id
 LEFT JOIN public.staff_payroll_settings t ON t.id=m.target_id WHERE t.id IS NULL OR t.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid OR t.user_id IS DISTINCT FROM s.user_id OR t.hourly_rate IS DISTINCT FROM s.hourly_rate OR t.monthly_fixed_amount IS DISTINCT FROM s.monthly_fixed_amount OR t.allowances IS DISTINCT FROM s.allowances OR t.deductions IS DISTINCT FROM s.deductions OR t.is_active IS DISTINCT FROM s.is_active OR t."ExpectedMonthlyHours" IS DISTINCT FROM s."ExpectedMonthlyHours" OR t."SalaryType" IS DISTINCT FROM s."SalaryType") THEN RAISE EXCEPTION 'Mapped content reconciliation failed'; END IF;
END $$;
DO $$
DECLARE seq regclass; last_id bigint; called boolean; highest bigint; next_id numeric; source_count integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_payroll;
 IF (SELECT count(*) FROM public.staff_payroll_settings)<>(SELECT count(*) FROM recovery_before)+(SELECT count(*) FROM migration_v40.payroll_id_map WHERE action='insert_remapped')
 OR (SELECT count(*) FROM migration_v40.payroll_id_map)<>source_count
 THEN RAISE EXCEPTION 'Payroll final counts differ'; END IF;
 IF EXISTS(
 (SELECT to_jsonb(s) FROM migration_v40.payroll_source_snapshot s EXCEPT ALL
 (SELECT to_jsonb(s) FROM source_payroll s UNION ALL SELECT to_jsonb(o) FROM migration_v40.orphan_payroll_settings o))
 UNION ALL
 ((SELECT to_jsonb(s) FROM source_payroll s UNION ALL SELECT to_jsonb(o) FROM migration_v40.orphan_payroll_settings o)
 EXCEPT ALL SELECT to_jsonb(s) FROM migration_v40.payroll_source_snapshot s)
 ) THEN RAISE EXCEPTION 'Payroll source disposition differs'; END IF;
 IF EXISTS(SELECT 1 FROM recovery_before b LEFT JOIN public.staff_payroll_settings t USING(id) WHERE t.id IS NULL OR t.weekly_off_day IS DISTINCT FROM b.weekly_off_day) THEN RAISE EXCEPTION 'Existing weekly off day changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_payroll_settings t JOIN migration_v40.payroll_id_map m ON m.target_id=t.id WHERE m.action='insert_remapped' AND t.weekly_off_day IS DISTINCT FROM 0) THEN RAISE EXCEPTION 'Unexpected new weekly off day default'; END IF;
 IF EXISTS(SELECT user_id::uuid FROM public.staff_payroll_settings WHERE tenant_id='00000000-0000-0000-0000-000000000001' GROUP BY user_id::uuid HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate final root payroll user'; END IF;
 seq:=pg_get_serial_sequence('public.staff_payroll_settings','id')::regclass;
 IF seq IS NULL OR (SELECT seqincrement FROM pg_sequence WHERE seqrelid=seq)<>1 THEN RAISE EXCEPTION 'Unexpected payroll sequence'; END IF;
 EXECUTE format('SELECT last_value,is_called FROM %s',seq) INTO last_id,called;
 SELECT max(id) INTO highest FROM public.staff_payroll_settings;
 next_id:=greatest(highest::numeric+1,last_id::numeric+CASE WHEN called THEN 1 ELSE 0 END);
 IF next_id>2147483647 THEN RAISE EXCEPTION 'Payroll ID overflow'; END IF;
 EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
END $$;
SELECT count(*) AS total_payroll,
 count(*) FILTER(WHERE tenant_id='00000000-0000-0000-0000-000000000001') AS root_payroll,
 count(*) FILTER(WHERE tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) AS other_payroll
 FROM public.staff_payroll_settings;
SELECT (SELECT count(*) FROM migration_v40.payroll_id_map) AS imported_source_rows,
       (SELECT count(*) FROM migration_v40.orphan_payroll_settings) AS archived_orphan_rows;
COMMIT;
\echo 'Payroll migration committed. Continue with remaining modules.'
