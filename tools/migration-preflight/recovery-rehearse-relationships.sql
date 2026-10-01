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
 IF to_regclass('migration_v40.relationships_before') IS NOT NULL THEN RAISE EXCEPTION 'Relationship migration already committed'; END IF;
END $$;
LOCK TABLE public.teammembers,public.user_positions,public."TaskAssignmentsV2" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.users,public."Teams",public.positions,public."Tasks",migration_v40.team_id_map,migration_v40.position_id_map,migration_v40.task_id_map IN SHARE MODE;
CREATE TEMP TABLE sm AS SELECT * FROM migration_source.teammembers;
CREATE TEMP TABLE sp AS SELECT * FROM migration_source.user_positions;
CREATE TEMP TABLE sa AS SELECT * FROM migration_source."TaskAssignees";
CREATE TEMP TABLE members AS SELECT m.target_id AS teamid,s.userid,s."RoleInTeam",s."JoinedAt",s."IsLeader" FROM sm s LEFT JOIN migration_v40.team_id_map m ON m.source_id=s.teamid;
CREATE TEMP TABLE positions_in AS SELECT s.user_id,m.target_id AS position_id,s.is_primary,s.assigned_at_utc FROM sp s LEFT JOIN migration_v40.position_id_map m ON m.source_id=s.position_id;
CREATE TEMP TABLE assignments AS SELECT m.target_id AS "TaskId",s."AssigneeType",
 CASE WHEN s."AssigneeType"='user' THEN s."AssigneeId" WHEN s."AssigneeType"='team' THEN tm.target_id::text END AS "AssigneeId",s."AssignedAt" AS "CreatedAt"
 FROM sa s LEFT JOIN migration_v40.task_id_map m ON m.source_id=s."TaskId"
 LEFT JOIN migration_v40.team_id_map tm ON s."AssigneeType"='team' AND tm.source_id::text=s."AssigneeId";
ALTER TABLE members ADD PRIMARY KEY(teamid,userid);
ALTER TABLE positions_in ADD PRIMARY KEY(user_id,position_id);
CREATE UNIQUE INDEX ON positions_in(user_id) WHERE is_primary;
ALTER TABLE assignments ADD PRIMARY KEY("TaskId","AssigneeType","AssigneeId");
DO $$
DECLARE sm_count integer; sp_count integer; sa_count integer;
BEGIN
 SELECT count(*) INTO sm_count FROM sm;
 SELECT count(*) INTO sp_count FROM sp;
 SELECT count(*) INTO sa_count FROM sa;
 RAISE NOTICE 'Source relationships: % memberships, % user positions, % task assignees', sm_count, sp_count, sa_count;
 -- The temp tables above have PK constraints (teamid,userid / user_id,position_id / TaskId,AssigneeType,AssigneeId)
 -- so a row count shrinking versus the source itself already means duplicate source keys collapsed silently.
 IF (SELECT count(*) FROM members)<>sm_count OR (SELECT count(*) FROM positions_in)<>sp_count OR (SELECT count(*) FROM assignments)<>sa_count THEN RAISE EXCEPTION 'Mapping cardinality mismatch - duplicate source keys collapsed'; END IF;
 IF EXISTS(SELECT 1 FROM members s LEFT JOIN public.users u ON u.id=s.userid LEFT JOIN public."Teams" t ON t."Id"=s.teamid
 WHERE u.id IS NULL OR t."Id" IS NULL OR u.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid OR t."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) THEN RAISE EXCEPTION 'Membership reference missing or not root'; END IF;
 IF EXISTS(SELECT 1 FROM positions_in s LEFT JOIN public.users u ON u.id=s.user_id LEFT JOIN public.positions p ON p.id=s.position_id
 WHERE u.id IS NULL OR p.id IS NULL OR u.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid OR p.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) THEN RAISE EXCEPTION 'Position reference missing or not root'; END IF;
 IF EXISTS(SELECT 1 FROM assignments s LEFT JOIN public."Tasks" t ON t."Id"=s."TaskId"
 WHERE t."Id" IS NULL OR t."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid
 OR (s."AssigneeType"='user' AND NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id::text=s."AssigneeId" AND u.tenant_id='00000000-0000-0000-0000-000000000001'))
 OR (s."AssigneeType"='team' AND NOT EXISTS(SELECT 1 FROM public."Teams" tm WHERE tm."Id"::text=s."AssigneeId" AND tm."TenantId"='00000000-0000-0000-0000-000000000001'))
 OR s."AssigneeType" NOT IN ('user','team')) THEN RAISE EXCEPTION 'Assignment reference missing or not root'; END IF;
END $$;
CREATE TABLE migration_v40.relationships_before AS
 SELECT 'teammembers' AS table_name,to_jsonb(t) AS row_data FROM public.teammembers t
 UNION ALL SELECT 'user_positions',to_jsonb(t) FROM public.user_positions t
 UNION ALL SELECT 'TaskAssignmentsV2',to_jsonb(t) FROM public."TaskAssignmentsV2" t;
CREATE TABLE migration_v40.task_assignment_attribution AS SELECT * FROM sa;
-- Build the complete expected final content, retaining every unrelated row.
CREATE TEMP TABLE expected_members AS
 SELECT to_jsonb(t) AS data FROM public.teammembers t WHERE NOT EXISTS(SELECT 1 FROM members s WHERE s.teamid=t.teamid AND s.userid=t.userid)
 UNION ALL SELECT to_jsonb(s) FROM members s;
CREATE TEMP TABLE demotions AS SELECT p.user_id,p.position_id FROM public.user_positions p
 WHERE p.is_primary AND EXISTS(SELECT 1 FROM positions_in s WHERE s.user_id=p.user_id AND s.is_primary AND s.position_id<>p.position_id);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM demotions d LEFT JOIN public.positions p ON p.id=d.position_id WHERE p.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) THEN RAISE EXCEPTION 'Existing primary position outside root'; END IF;
END $$;
CREATE TEMP TABLE expected_positions AS
 SELECT CASE WHEN EXISTS(SELECT 1 FROM demotions d WHERE d.user_id=t.user_id AND d.position_id=t.position_id)
 THEN to_jsonb(t)||jsonb_build_object('is_primary',false) ELSE to_jsonb(t) END AS data
 FROM public.user_positions t WHERE NOT EXISTS(SELECT 1 FROM positions_in s WHERE s.user_id=t.user_id AND s.position_id=t.position_id)
 UNION ALL SELECT to_jsonb(s) FROM positions_in s;
-- Existing assignments are retained; a conflicting value aborts rather than overwrites.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM assignments s JOIN public."TaskAssignmentsV2" t USING("TaskId","AssigneeType","AssigneeId") WHERE to_jsonb(s) IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Existing assignment content differs'; END IF;
END $$;
CREATE TEMP TABLE expected_assignments AS SELECT to_jsonb(t) AS data FROM public."TaskAssignmentsV2" t
 UNION SELECT to_jsonb(s) FROM assignments s;
INSERT INTO public.teammembers SELECT * FROM members
 ON CONFLICT(teamid,userid) DO UPDATE SET "RoleInTeam"=EXCLUDED."RoleInTeam","JoinedAt"=EXCLUDED."JoinedAt","IsLeader"=EXCLUDED."IsLeader";
UPDATE public.user_positions p SET is_primary=false FROM demotions d WHERE p.user_id=d.user_id AND p.position_id=d.position_id;
INSERT INTO public.user_positions(user_id,position_id,is_primary,assigned_at_utc) SELECT * FROM positions_in
 ON CONFLICT(user_id,position_id) DO UPDATE SET is_primary=EXCLUDED.is_primary,assigned_at_utc=EXCLUDED.assigned_at_utc;
INSERT INTO public."TaskAssignmentsV2"("TaskId","AssigneeType","AssigneeId","CreatedAt") SELECT * FROM assignments
 ON CONFLICT("TaskId","AssigneeType","AssigneeId") DO NOTHING;
DO $$ BEGIN
 IF EXISTS((SELECT data FROM expected_members EXCEPT ALL SELECT to_jsonb(t) FROM public.teammembers t)
 UNION ALL (SELECT to_jsonb(t) FROM public.teammembers t EXCEPT ALL SELECT data FROM expected_members)) THEN RAISE EXCEPTION 'Membership full-table reconciliation failed'; END IF;
 IF EXISTS((SELECT data FROM expected_positions EXCEPT ALL SELECT to_jsonb(t) FROM public.user_positions t)
 UNION ALL (SELECT to_jsonb(t) FROM public.user_positions t EXCEPT ALL SELECT data FROM expected_positions)) THEN RAISE EXCEPTION 'Position full-table reconciliation failed'; END IF;
 IF EXISTS((SELECT data FROM expected_assignments EXCEPT ALL SELECT to_jsonb(t) FROM public."TaskAssignmentsV2" t)
 UNION ALL (SELECT to_jsonb(t) FROM public."TaskAssignmentsV2" t EXCEPT ALL SELECT data FROM expected_assignments)) THEN RAISE EXCEPTION 'Assignment full-table reconciliation failed'; END IF;
END $$;
SELECT 'mapped_memberships' AS check_name,count(*) AS records FROM members
 UNION ALL SELECT 'mapped_user_positions',count(*) FROM positions_in
 UNION ALL SELECT 'mapped_assignments',count(*) FROM assignments
 UNION ALL SELECT 'previous_primary_flags_cleared',count(*) FROM demotions;
COMMIT;
\echo 'Relationship migration committed with complete content and preservation checks.'
