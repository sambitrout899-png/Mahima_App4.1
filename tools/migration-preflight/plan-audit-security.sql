\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SELECT 'AuditLogs target' side, count(*) records FROM public."AuditLogs";
SELECT 'security_events target' side, count(*) records FROM public.security_events;
SELECT count(*) AS audit_dangling_actor
FROM migration_source."AuditLogs" s
WHERE s."ActorId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = s."ActorId");
SELECT count(*) AS security_dangling_user
FROM migration_source.security_events s
WHERE s.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = s.user_id);
ROLLBACK;
