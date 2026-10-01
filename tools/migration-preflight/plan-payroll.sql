\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SELECT 'source' side,count(*) records,count(DISTINCT id) ids FROM migration_source.staff_payroll_settings;
SELECT 'target' side,count(*) records,count(DISTINCT id) ids FROM public.staff_payroll_settings;
SELECT count(*) AS source_ids_already_present,count(*) FILTER(WHERE t.tenant_id='00000000-0000-0000-0000-000000000001'::uuid) root_ids,count(*) FILTER(WHERE t.tenant_id<>'00000000-0000-0000-0000-000000000001'::uuid) other_tenant_ids FROM migration_source.staff_payroll_settings s JOIN public.staff_payroll_settings t ON t.id=s.id;
ROLLBACK;
