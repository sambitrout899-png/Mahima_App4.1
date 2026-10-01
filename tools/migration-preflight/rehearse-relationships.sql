\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_database()<>'mahima_v41_rehearsal_20260922_072500_351048' THEN RAISE EXCEPTION 'Wrong rehearsal database'; END IF;
 IF to_regclass('migration_v40.relationships_before') IS NOT NULL THEN RAISE EXCEPTION 'Relationship rehearsal already committed'; END IF;
 IF to_regclass('migration_v40.task_id_map') IS NULL THEN RAISE EXCEPTION 'Task map required'; END IF;
END $$;
LOCK TABLE public.teammembers,public.user_positions,public."TaskAssignmentsV2" IN ACCESS EXCLUSIVE MODE;
CREATE TABLE migration_v40.relationships_before AS
SELECT 'teammembers' table_name, to_jsonb(t) row_data FROM public.teammembers t
UNION ALL SELECT 'user_positions',to_jsonb(t) FROM public.user_positions t
UNION ALL SELECT 'TaskAssignmentsV2',to_jsonb(t) FROM public."TaskAssignmentsV2" t;
CREATE TABLE migration_v40.task_assignment_attribution AS
SELECT s."TaskId" source_task_id,s."AssigneeType",s."AssigneeId",s."AssignedAt",s."AssignedByUserId",s."AssignedByPositionId"
FROM migration_source."TaskAssignees" s;
INSERT INTO public.teammembers(teamid,userid,"RoleInTeam","JoinedAt","IsLeader")
SELECT tm.target_id,s.userid,s."RoleInTeam",s."JoinedAt",s."IsLeader"
FROM migration_source.teammembers s JOIN migration_v40.team_id_map tm ON tm.source_id=s.teamid
ON CONFLICT(teamid,userid) DO UPDATE SET "RoleInTeam"=EXCLUDED."RoleInTeam","JoinedAt"=EXCLUDED."JoinedAt","IsLeader"=EXCLUDED."IsLeader";
UPDATE public.user_positions p
SET is_primary=false
WHERE p.is_primary
  AND EXISTS (SELECT 1 FROM migration_source.user_positions s
              JOIN migration_v40.position_id_map pm ON pm.source_id=s.position_id
              WHERE s.is_primary AND s.user_id=p.user_id AND pm.target_id<>p.position_id);
INSERT INTO public.user_positions(user_id,position_id,is_primary,assigned_at_utc)
SELECT s.user_id,pm.target_id,s.is_primary,s.assigned_at_utc
FROM migration_source.user_positions s JOIN migration_v40.position_id_map pm ON pm.source_id=s.position_id
ON CONFLICT(user_id,position_id) DO UPDATE SET is_primary=EXCLUDED.is_primary,assigned_at_utc=EXCLUDED.assigned_at_utc;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM migration_source."TaskAssignees" s LEFT JOIN migration_v40.team_id_map tm ON tm.source_id::text=s."AssigneeId" WHERE s."AssigneeType"='team' AND tm.source_id IS NULL) THEN RAISE EXCEPTION 'Unmapped team assignee ID; inspect source TaskAssignees before import'; END IF;
END $$;
INSERT INTO public."TaskAssignmentsV2"("TaskId","AssigneeType","AssigneeId","CreatedAt")
SELECT tm.target_id,s."AssigneeType",
 CASE WHEN s."AssigneeType"='user' THEN s."AssigneeId" ELSE tmm.target_id::text END,
 s."AssignedAt"
FROM migration_source."TaskAssignees" s
JOIN migration_v40.task_id_map tm ON tm.source_id=s."TaskId"
LEFT JOIN migration_v40.team_id_map tmm ON s."AssigneeType"='team' AND tmm.source_id::text=s."AssigneeId"
ON CONFLICT("TaskId","AssigneeType","AssigneeId") DO NOTHING;
DO $$ BEGIN
 IF (SELECT count(*) FROM migration_source.teammembers)<>20 OR (SELECT count(*) FROM migration_source.user_positions)<>101 OR (SELECT count(*) FROM migration_source."TaskAssignees")<>80 THEN RAISE EXCEPTION 'Unexpected relationship source counts'; END IF;
 IF (SELECT count(*) FROM public."TaskAssignmentsV2") < 80 THEN RAISE EXCEPTION 'Assignment import incomplete'; END IF;
 IF EXISTS(SELECT 1 FROM migration_v40.relationships_before b WHERE false) THEN RAISE EXCEPTION 'unreachable'; END IF;
END $$;
SELECT 'teammembers' table_name,count(*) records FROM migration_source.teammembers
UNION ALL SELECT 'user_positions',count(*) FROM migration_source.user_positions
UNION ALL SELECT 'TaskAssignmentsV2_imported',count(*) FROM migration_source."TaskAssignees";
COMMIT;
\echo 'Relationship rehearsal committed. Remaining work is module-by-module data and file migration.'
