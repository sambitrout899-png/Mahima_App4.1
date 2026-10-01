\set ON_ERROR_STOP on
\pset pager off
BEGIN READ ONLY;
DO $$ BEGIN
 IF current_database()<>'mahima_v41_rehearsal_20260922_173119_361898' THEN RAISE EXCEPTION 'Wrong rehearsal database'; END IF;
END $$;
SELECT s.id AS source_payroll_id,s.user_id AS source_user_id,
 su.id IS NOT NULL AS user_exists_in_source,
 u.id IS NOT NULL AS user_exists_in_target,u.tenant_id AS target_user_tenant,
 CASE WHEN u.id IS NULL THEN 'missing_target_user' ELSE 'target_user_not_root' END AS issue
FROM migration_source.staff_payroll_settings s
LEFT JOIN migration_source.users su ON su.id=s.user_id::uuid
LEFT JOIN public.users u ON u.id=s.user_id::uuid
WHERE u.id IS NULL OR u.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
ORDER BY s.id;
SELECT s.id AS source_payroll_id,s.user_id AS source_user_id,
 t.id AS target_payroll_id,t.user_id AS existing_target_user_id,t.tenant_id AS existing_payroll_tenant
FROM migration_source.staff_payroll_settings s
JOIN public.staff_payroll_settings t ON t.id=s.id
WHERE t.tenant_id='00000000-0000-0000-0000-000000000001'::uuid
AND t.user_id::uuid IS DISTINCT FROM s.user_id::uuid
ORDER BY s.id;
SELECT user_id AS source_user_id,count(*) AS source_payroll_records
FROM migration_source.staff_payroll_settings GROUP BY user_id HAVING count(*)>1;
ROLLBACK;
