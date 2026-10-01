\set ON_ERROR_STOP on
\pset pager off
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout='10s';
DO $$ BEGIN
  IF current_database()<>'mahima_v41_rehearsal_20260922_072500_351048' THEN
    RAISE EXCEPTION 'Wrong rehearsal database';
  END IF;
  IF to_regclass('migration_source.users') IS NULL THEN RAISE EXCEPTION 'Read-only source bridge missing'; END IF;
END $$;
CREATE TEMP TABLE source_refs AS
SELECT 'accounts'::text AS table_name,id,name,to_jsonb(s) AS data FROM migration_source.accounts s
UNION ALL SELECT 'positions',id,name,to_jsonb(s) FROM migration_source.positions s
UNION ALL SELECT 'Teams',"Id","Name",to_jsonb(s) FROM migration_source."Teams" s;
CREATE TEMP TABLE target_refs AS
SELECT 'accounts'::text AS table_name,id,name,tenant_id,to_jsonb(t)-'tenant_id' AS data FROM public.accounts t
UNION ALL SELECT 'positions',id,name,tenant_id,to_jsonb(t)-'tenant_id' FROM public.positions t
UNION ALL SELECT 'Teams',"Id","Name","TenantId",to_jsonb(t)-'TenantId' FROM public."Teams" t;
CREATE TEMP TABLE ref_candidates AS
SELECT s.*, count(*) OVER (PARTITION BY s.table_name,lower(s.name)) AS source_name_count,
       existing.tenant_id AS current_id_owner,
       existing.id IS NOT NULL AS id_exists,
       root_matches.match_count,root_matches.match_id,
       root_matches.match_name
FROM source_refs s
LEFT JOIN target_refs existing ON existing.table_name=s.table_name AND existing.id=s.id
LEFT JOIN LATERAL (
    SELECT count(*) AS match_count,min(t.id) AS match_id,min(t.name) AS match_name
    FROM target_refs t WHERE t.table_name=s.table_name AND lower(t.name)=lower(s.name)
      AND t.tenant_id='00000000-0000-0000-0000-000000000001'
) root_matches ON true;
CREATE TEMP TABLE reference_plan AS
SELECT c.table_name,c.id AS source_id,c.name AS source_name,
       CASE WHEN source_name_count>1 OR match_count>1 THEN NULL
            WHEN match_count=1 THEN match_id
            WHEN NOT id_exists THEN c.id
            ELSE (limits.max_id::numeric+row_number() OVER(PARTITION BY c.table_name ORDER BY c.id))::bigint END AS proposed_target_id,
       CASE WHEN source_name_count>1 OR match_count>1 THEN 'REVIEW_AMBIGUOUS_NAME'
            WHEN match_count=1 THEN 'REVIEW_ROOT_NAME_MATCH'
            WHEN NOT id_exists THEN 'INSERT_WITH_SOURCE_ID'
            ELSE 'INSERT_WITH_REMAPPED_ID' END AS proposed_action,
       source_name_count,match_count AS root_name_matches,match_name AS matched_root_name,
       current_id_owner,id_exists,
       ARRAY[]::text[] AS differing_fields
FROM ref_candidates c
JOIN (
 SELECT table_name,max(id) AS max_id FROM (
     SELECT table_name,id FROM source_refs UNION ALL SELECT table_name,id FROM target_refs
 ) all_ids GROUP BY table_name
) limits USING(table_name);
-- Compare source values after mapping position parents to proposed target IDs.
-- The mapping is a proposal only; no destination application rows are written.
CREATE TEMP TABLE expected_refs AS
SELECT s.table_name,s.id,
       CASE WHEN s.table_name='positions' AND s.data->>'parent_position_id' IS NOT NULL
            THEN jsonb_set(s.data,'{parent_position_id}',coalesce(to_jsonb(parent.proposed_target_id),'null'::jsonb))
            ELSE s.data END AS data,
       s.table_name='positions' AND s.data->>'parent_position_id' IS NOT NULL
          AND parent.proposed_target_id IS NULL AS missing_parent_mapping
FROM source_refs s LEFT JOIN reference_plan parent
 ON s.table_name='positions' AND parent.table_name='positions'
 AND parent.source_id=(s.data->>'parent_position_id')::bigint;
UPDATE reference_plan p SET differing_fields=d.fields
FROM (
 SELECT p2.table_name,p2.source_id,
        ARRAY(SELECT e.key FROM jsonb_each(s.data) e
              WHERE e.key NOT IN ('id','Id') AND e.value IS DISTINCT FROM t.data->e.key
              ORDER BY e.key) AS fields
 FROM reference_plan p2 JOIN expected_refs s ON s.table_name=p2.table_name AND s.id=p2.source_id
 JOIN target_refs t ON t.table_name=p2.table_name AND t.id=p2.proposed_target_id
 WHERE p2.root_name_matches=1
) d WHERE p.table_name=d.table_name AND p.source_id=d.source_id;
UPDATE reference_plan SET proposed_action='REUSE_IDENTICAL_ROOT_RECORD'
WHERE proposed_action='REVIEW_ROOT_NAME_MATCH' AND cardinality(differing_fields)=0;
CREATE TEMP TABLE reference_issues AS
SELECT table_name,id::text AS source_id,'missing_or_ambiguous_parent_position'::text AS issue
FROM expected_refs WHERE missing_parent_mapping
UNION ALL
SELECT 'Teams',s.id::text,'lead_user_missing_or_not_root'
FROM source_refs s LEFT JOIN public.users u ON u.id=(s.data->>'LeadUserId')::uuid
WHERE s.table_name='Teams' AND s.data->>'LeadUserId' IS NOT NULL
  AND (u.id IS NULL OR u.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid)
UNION ALL
SELECT 'reference_plan',proposed_target_id::text,'multiple_source_records_map_to_same_target'
FROM reference_plan WHERE proposed_target_id IS NOT NULL
GROUP BY table_name,proposed_target_id HAVING count(*)>1;
\copy (SELECT * FROM reference_plan ORDER BY table_name,source_id) TO '/var/backups/mahima-migration/rehearsal-input/reference-plan.csv' WITH (FORMAT csv, HEADER true)
\copy reference_issues TO '/var/backups/mahima-migration/rehearsal-input/reference-issues.csv' WITH (FORMAT csv, HEADER true)
SELECT table_name,proposed_action,count(*) AS records FROM reference_plan GROUP BY table_name,proposed_action ORDER BY table_name,proposed_action;
SELECT * FROM reference_issues;
ROLLBACK;
