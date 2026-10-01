\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SELECT 'source' side,count(*) records,count(DISTINCT "Id") ids FROM migration_source."Timesheets";
SELECT 'target' side,count(*) records,count(DISTINCT "Id") ids FROM public."Timesheets";
SELECT count(*) AS source_ids_already_present,count(*) FILTER(WHERE t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid) root_ids,count(*) FILTER(WHERE t."TenantId"<>'00000000-0000-0000-0000-000000000001'::uuid) other_tenant_ids FROM migration_source."Timesheets" s JOIN public."Timesheets" t ON t."Id"=s."Id";
ROLLBACK;
