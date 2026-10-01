\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SELECT 'source' side,count(*) records,count(DISTINCT "Id") ids FROM migration_source."Attachments";
SELECT 'target' side,count(*) records,count(DISTINCT "Id") ids FROM public."Attachments";
SELECT count(*) AS source_ids_already_present,count(*) FILTER(WHERE t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid) root_ids,count(*) FILTER(WHERE t."TenantId"<>'00000000-0000-0000-0000-000000000001'::uuid) other_tenant_ids FROM migration_source."Attachments" s JOIN public."Attachments" t ON t."Id"=s."Id";
SELECT count(*) AS source_file_keys FROM migration_source."Attachments" WHERE NULLIF(trim("S3Key"),'') IS NOT NULL;
ROLLBACK;
