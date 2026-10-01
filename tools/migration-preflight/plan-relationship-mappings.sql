\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL TIME ZONE 'UTC';
DO $$ BEGIN
 IF current_database()<>'mahima_v41_rehearsal_20260922_072500_351048' THEN RAISE EXCEPTION 'Wrong rehearsal database'; END IF;
 IF to_regclass('migration_v40.account_id_map') IS NULL OR to_regclass('migration_v40.team_id_map') IS NULL OR to_regclass('migration_v40.position_id_map') IS NULL THEN RAISE EXCEPTION 'Reference maps are required'; END IF;
END $$;
CREATE TEMP TABLE source_counts AS
SELECT 'teammembers' table_name,count(*) records FROM migration_source.teammembers
UNION ALL SELECT 'user_positions',count(*) FROM migration_source.user_positions
UNION ALL SELECT 'Tasks',count(*) FROM migration_source."Tasks"
UNION ALL SELECT 'TaskAssignees',count(*) FROM migration_source."TaskAssignees";
SELECT * FROM source_counts ORDER BY table_name;
SELECT 'teammembers_missing_team' issue,count(*) records FROM migration_source.teammembers s LEFT JOIN migration_v40.team_id_map m ON m.source_id=s.teamid WHERE m.source_id IS NULL
UNION ALL SELECT 'teammembers_missing_user',count(*) FROM migration_source.teammembers s LEFT JOIN public.users u ON u.id=s.userid WHERE u.id IS NULL
UNION ALL SELECT 'user_positions_missing_position',count(*) FROM migration_source.user_positions s LEFT JOIN migration_v40.position_id_map m ON m.source_id=s.position_id WHERE m.source_id IS NULL
UNION ALL SELECT 'user_positions_missing_user',count(*) FROM migration_source.user_positions s LEFT JOIN public.users u ON u.id=s.user_id WHERE u.id IS NULL
UNION ALL SELECT 'task_id_map_not_yet_created',count(*) FROM migration_source."Tasks" s
UNION ALL SELECT 'assignment_task_map_not_yet_created',count(*) FROM migration_source."TaskAssignees" s
UNION ALL SELECT 'assignment_missing_user',count(*) FROM migration_source."TaskAssignees" s LEFT JOIN public.users u ON s."AssigneeType"='user' AND u.id=s."AssigneeId"::uuid WHERE s."AssigneeType"='user' AND u.id IS NULL
UNION ALL SELECT 'assignment_missing_team',count(*) FROM migration_source."TaskAssignees" s LEFT JOIN migration_v40.team_id_map m ON s."AssigneeType"='team' AND m.source_id=s."AssigneeId"::bigint WHERE s."AssigneeType"='team' AND m.source_id IS NULL;
SELECT 'existing_task_assignments' issue,count(*) records FROM public."TaskAssignmentsV2";
ROLLBACK;
