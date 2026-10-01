\set ON_ERROR_STOP on
\pset pager off
-- Read-only verification against real production, after all 17 migrations. Confirms every other
-- tenant's data is byte-identical to its pre-migration snapshot (proving strict isolation held),
-- and reports key totals for a final human sanity check.
BEGIN;

SELECT 'other-tenant isolation check' AS section;
SELECT 'users' AS tbl, NOT EXISTS(
  SELECT 1 FROM migration_v40.users_before b JOIN public.users t USING(id)
  WHERE b.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
  AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)
) AS unchanged
UNION ALL SELECT 'accounts', NOT EXISTS(
  SELECT 1 FROM migration_v40.accounts_before b JOIN public.accounts t USING(id)
  WHERE b.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
  AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)
)
UNION ALL SELECT 'AttendanceRecords', NOT EXISTS(
  SELECT 1 FROM migration_v40.attendance_before b JOIN public."AttendanceRecords" t USING("Id")
  WHERE b."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
  AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)
)
UNION ALL SELECT 'Sermons', NOT EXISTS(
  SELECT 1 FROM migration_v40.sermons_before b JOIN public."Sermons" t USING("Id")
  WHERE b."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
  AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)
)
UNION ALL SELECT 'Timesheets', NOT EXISTS(
  SELECT 1 FROM migration_v40.timesheets_before b JOIN public."Timesheets" t USING("Id")
  WHERE b."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
  AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)
)
UNION ALL SELECT 'staff_payroll_settings', NOT EXISTS(
  SELECT 1 FROM migration_v40.payroll_before b JOIN public.staff_payroll_settings t USING(id)
  WHERE b.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
  AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)
)
UNION ALL SELECT 'Tasks', NOT EXISTS(
  SELECT 1 FROM migration_v40.tasks_before b JOIN public."Tasks" t USING("Id")
  WHERE b."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
  AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)
)
UNION ALL SELECT 'Teams', NOT EXISTS(
  SELECT 1 FROM migration_v40.teams_before b JOIN public."Teams" t USING("Id")
  WHERE b."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
  AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)
)
UNION ALL SELECT 'positions', NOT EXISTS(
  SELECT 1 FROM migration_v40.positions_before b JOIN public.positions t USING(id)
  WHERE b.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
  AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)
)
UNION ALL SELECT 'AuditLogs', NOT EXISTS(
  SELECT 1 FROM migration_v40.audit_logs_before b JOIN public."AuditLogs" t USING("Id")
  WHERE b.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
  AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)
)
UNION ALL SELECT 'security_events', NOT EXISTS(
  SELECT 1 FROM migration_v40.security_events_before b JOIN public.security_events t USING(id)
  WHERE b.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
  AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)
)
UNION ALL SELECT 'daily_page_visits', NOT EXISTS(
  SELECT 1 FROM migration_v40.daily_page_visits_before b JOIN public.daily_page_visits t USING(id)
  WHERE b.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
  AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)
);

SELECT 'other tenants still active/present' AS section;
SELECT count(DISTINCT id) AS other_tenants_total,
       count(DISTINCT id) FILTER (WHERE status='active') AS other_tenants_active
FROM public.tenants WHERE id <> '00000000-0000-0000-0000-000000000001'::uuid;

SELECT 'key totals' AS section;
SELECT 'users' AS tbl, count(*) total, count(*) FILTER(WHERE tenant_id='00000000-0000-0000-0000-000000000001') root FROM public.users
UNION ALL SELECT 'accounts', count(*), count(*) FILTER(WHERE tenant_id='00000000-0000-0000-0000-000000000001') FROM public.accounts
UNION ALL SELECT 'journal_entries', count(*), count(*) FILTER(WHERE tenant_id='00000000-0000-0000-0000-000000000001') FROM public.journal_entries
UNION ALL SELECT 'AttendanceRecords', count(*), count(*) FILTER(WHERE "TenantId"='00000000-0000-0000-0000-000000000001') FROM public."AttendanceRecords"
UNION ALL SELECT 'AuditLogs', count(*), count(*) FILTER(WHERE tenant_id='00000000-0000-0000-0000-000000000001') FROM public."AuditLogs"
UNION ALL SELECT 'baptism_requests', count(*), count(*) FILTER(WHERE tenant_id='00000000-0000-0000-0000-000000000001') FROM public.baptism_requests
UNION ALL SELECT 'prayerrequests', count(*), count(*) FILTER(WHERE tenant_id='00000000-0000-0000-0000-000000000001') FROM public.prayerrequests;

SELECT 'financial reconciliation' AS section;
SELECT
  (SELECT round(sum(debit),2) FROM public.journal_lines) AS total_debit,
  (SELECT round(sum(credit),2) FROM public.journal_lines) AS total_credit,
  (SELECT round(sum(amount),2) FROM public.expenses) AS total_expenses;

SELECT 'dangling reference check' AS section;
SELECT 'AttendanceRecords->users' AS check_name, count(*) AS dangling FROM public."AttendanceRecords" a
  WHERE NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=a."UserId"::uuid)
UNION ALL SELECT 'Tasks->Teams', count(*) FROM public."Tasks" t WHERE t."TeamId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Teams" tm WHERE tm."Id"=t."TeamId")
UNION ALL SELECT 'journal_lines->accounts', count(*) FROM public.journal_lines l WHERE NOT EXISTS(SELECT 1 FROM public.accounts a WHERE a.id=l.account_id)
UNION ALL SELECT 'Attachments->baptism_requests', count(*) FROM public."Attachments" a WHERE a."OwnerType"='baptism-signed-certificate' AND NOT EXISTS(SELECT 1 FROM public.baptism_requests b WHERE b.id=a."OwnerId");

ROLLBACK;
