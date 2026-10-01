\set ON_ERROR_STOP on
\pset pager off
BEGIN;
DO $$ BEGIN IF current_database()<>'mahima_v41_rehearsal_20260922_072500_351048' THEN RAISE EXCEPTION 'Wrong rehearsal database'; END IF; IF to_regclass('migration_v40.payroll_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Payroll rehearsal already committed'; END IF; END $$;
LOCK TABLE public.staff_payroll_settings IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE recovery_before AS SELECT * FROM public.staff_payroll_settings;
CREATE TEMP TABLE source_payroll AS SELECT * FROM migration_source.staff_payroll_settings;
CREATE TABLE migration_v40.payroll_id_map(source_id integer PRIMARY KEY,target_id integer NOT NULL UNIQUE,action text NOT NULL);
INSERT INTO migration_v40.payroll_id_map SELECT s.id,CASE WHEN t.id IS NOT NULL AND t.tenant_id='00000000-0000-0000-0000-000000000001'::uuid THEN s.id ELSE (SELECT coalesce(max(id),0) FROM public.staff_payroll_settings)+row_number() OVER(ORDER BY s.id) END,CASE WHEN t.id IS NOT NULL AND t.tenant_id='00000000-0000-0000-0000-000000000001'::uuid THEN 'reuse_root' ELSE 'insert_remapped' END FROM source_payroll s LEFT JOIN public.staff_payroll_settings t ON t.id=s.id;
UPDATE public.staff_payroll_settings t SET user_id=s.user_id,hourly_rate=s.hourly_rate,monthly_fixed_amount=s.monthly_fixed_amount,allowances=s.allowances,deductions=s.deductions,is_active=s.is_active,"ExpectedMonthlyHours"=s."ExpectedMonthlyHours","SalaryType"=s."SalaryType" FROM source_payroll s JOIN migration_v40.payroll_id_map m ON m.source_id=s.id WHERE m.action='reuse_root' AND t.id=m.target_id AND t.tenant_id='00000000-0000-0000-0000-000000000001'::uuid;
INSERT INTO public.staff_payroll_settings(id,user_id,hourly_rate,monthly_fixed_amount,allowances,deductions,is_active,"ExpectedMonthlyHours","SalaryType",tenant_id) SELECT m.target_id,s.user_id,s.hourly_rate,s.monthly_fixed_amount,s.allowances,s.deductions,s.is_active,s."ExpectedMonthlyHours",s."SalaryType",'00000000-0000-0000-0000-000000000001'::uuid FROM source_payroll s JOIN migration_v40.payroll_id_map m ON m.source_id=s.id WHERE m.action='insert_remapped';
DO $$ BEGIN IF (SELECT count(*) FROM migration_v40.payroll_id_map)<>15 OR (SELECT count(*) FROM public.staff_payroll_settings WHERE tenant_id='00000000-0000-0000-0000-000000000001'::uuid)<15 THEN RAISE EXCEPTION 'Payroll reconciliation failed'; END IF; IF (SELECT count(*) FROM public.staff_payroll_settings WHERE tenant_id<>'00000000-0000-0000-0000-000000000001'::uuid)<>1 THEN RAISE EXCEPTION 'Other-tenant payroll changed'; END IF; END $$;
SELECT action,count(*) FROM migration_v40.payroll_id_map GROUP BY action ORDER BY action;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM recovery_before b LEFT JOIN public.staff_payroll_settings t ON t.id=b.id
 WHERE NOT EXISTS(SELECT 1 FROM migration_v40.payroll_id_map m WHERE m.action='reuse_root' AND m.target_id=b.id)
 AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Unmapped destination row changed'; END IF;
 IF EXISTS(SELECT 1 FROM source_payroll s LEFT JOIN migration_v40.payroll_id_map m ON m.source_id=s.id
 LEFT JOIN public.staff_payroll_settings t ON t.id=m.target_id WHERE t.id IS NULL OR t.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid OR t.user_id IS DISTINCT FROM s.user_id OR t.hourly_rate IS DISTINCT FROM s.hourly_rate OR t.monthly_fixed_amount IS DISTINCT FROM s.monthly_fixed_amount OR t.allowances IS DISTINCT FROM s.allowances OR t.deductions IS DISTINCT FROM s.deductions OR t.is_active IS DISTINCT FROM s.is_active OR t."ExpectedMonthlyHours" IS DISTINCT FROM s."ExpectedMonthlyHours" OR t."SalaryType" IS DISTINCT FROM s."SalaryType") THEN RAISE EXCEPTION 'Mapped content reconciliation failed'; END IF;
END $$;
COMMIT;
\echo 'Payroll rehearsal committed. Continue with prayer and remaining modules.'
