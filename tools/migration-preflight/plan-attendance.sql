\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SELECT 'source' side,count(*) records,count(DISTINCT "Id") ids FROM migration_source."AttendanceRecords";
SELECT 'target' side,count(*) records,count(DISTINCT "Id") ids FROM public."AttendanceRecords";
SELECT 'source_by_user' scope,count(*) records,count(DISTINCT "UserId") users FROM migration_source."AttendanceRecords";
SELECT 'target_by_tenant' scope,count(*) records,count(DISTINCT "TenantId") tenants FROM public."AttendanceRecords";
SELECT count(*) AS source_ids_already_present,
 count(*) FILTER (WHERE t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid) AS root_ids,
 count(*) FILTER (WHERE t."TenantId"<>'00000000-0000-0000-0000-000000000001'::uuid) AS other_tenant_ids
FROM migration_source."AttendanceRecords" s JOIN public."AttendanceRecords" t ON t."Id"=s."Id";
SELECT 'missing_user' issue,count(*) records FROM migration_source."AttendanceRecords" s LEFT JOIN public.users u ON u.id=s."UserId"::uuid WHERE u.id IS NULL
UNION ALL SELECT 'missing_tenant_user',count(*) FROM migration_source."AttendanceRecords" s JOIN public.users u ON u.id=s."UserId"::uuid WHERE u.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid;
ROLLBACK;
