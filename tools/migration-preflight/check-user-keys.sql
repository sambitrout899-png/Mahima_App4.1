\set ON_ERROR_STOP on
\pset pager off
-- Run with psql on V4.1, after copying the V4.0 CSV to /tmp.
-- Only temporary tables are written. Results contain counts, not key values.
BEGIN ISOLATION LEVEL REPEATABLE READ;

CREATE TEMP TABLE migration_source_user_keys (
    id uuid PRIMARY KEY,
    isdeleted boolean,
    usercode_hash text,
    phone_hash text
);
\copy migration_source_user_keys FROM '/tmp/mahima-v40-user-keys.csv' WITH (FORMAT csv, HEADER true)

CREATE TEMP TABLE migration_target_user_keys AS
SELECT id, tenant_id, md5("UserCode"::text) AS usercode_hash,
       md5(NULLIF(CASE WHEN length(digits) > 10 AND digits LIKE '91%'
                      THEN right(digits, 10) ELSE digits END, '')) AS phone_hash
FROM (
    SELECT id, tenant_id, "UserCode",
           regexp_replace(COALESCE(phone, ''), '\D', '', 'g') AS digits
    FROM public.users
) t;

\echo 'A. Source deletion state versus existing destination ID ownership'
SELECT s.isdeleted AS source_isdeleted,
       count(*) AS source_users,
       count(*) FILTER (WHERE t.id IS NULL) AS absent_from_destination,
       count(*) FILTER (WHERE t.tenant_id = '00000000-0000-0000-0000-000000000001'::uuid) AS matching_root,
       count(*) FILTER (WHERE t.id IS NOT NULL AND t.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) AS matching_other_or_unassigned
FROM migration_source_user_keys s
LEFT JOIN migration_target_user_keys t USING (id)
GROUP BY s.isdeleted
ORDER BY s.isdeleted;

\echo 'B. Non-null source key duplicates (all source rows, including deleted users)'
WITH source_keys AS (
    SELECT id, 'UserCode' AS key_type, usercode_hash AS key_hash FROM migration_source_user_keys
    UNION ALL
    SELECT id, 'normalized_phone', phone_hash FROM migration_source_user_keys
), duplicate_groups AS (
    SELECT key_type, key_hash, count(*) AS users
    FROM source_keys WHERE key_hash IS NOT NULL
    GROUP BY key_type, key_hash HAVING count(*) > 1
)
SELECT kinds.key_type, count(d.key_hash) AS duplicate_groups,
       coalesce(sum(d.users), 0) AS users_in_duplicate_groups
FROM (VALUES ('UserCode'), ('normalized_phone')) kinds(key_type)
LEFT JOIN duplicate_groups d USING (key_type)
GROUP BY kinds.key_type ORDER BY kinds.key_type;

\echo 'C. Source keys already used by DIFFERENT destination IDs'
\echo 'These are current-state conflicts requiring review, not a simulation of a final merge.'
WITH conflicts AS (
    SELECT 'UserCode' AS key_type, s.id AS source_id, t.id AS target_id,
           s.isdeleted, t.tenant_id,
           EXISTS (SELECT 1 FROM migration_target_user_keys x WHERE x.id = s.id) AS source_id_exists
    FROM migration_source_user_keys s
    JOIN migration_target_user_keys t ON t.usercode_hash = s.usercode_hash AND t.id <> s.id
    UNION ALL
    SELECT 'normalized_phone', s.id, t.id, s.isdeleted, t.tenant_id,
           EXISTS (SELECT 1 FROM migration_target_user_keys x WHERE x.id = s.id)
    FROM migration_source_user_keys s
    JOIN migration_target_user_keys t ON t.phone_hash = s.phone_hash AND t.id <> s.id
)
SELECT kinds.key_type,
       count(DISTINCT c.source_id) AS conflicting_source_users,
       count(DISTINCT c.source_id) FILTER (WHERE NOT c.source_id_exists) AS conflicting_new_ids,
       count(DISTINCT c.source_id) FILTER (WHERE c.isdeleted IS TRUE) AS conflicting_deleted_users,
       count(DISTINCT c.source_id) FILTER (
           WHERE c.target_id IS NOT NULL AND c.tenant_id IS DISTINCT FROM
                 '00000000-0000-0000-0000-000000000001'::uuid
       ) AS conflicts_with_other_or_unassigned_tenants
FROM (VALUES ('UserCode'), ('normalized_phone')) kinds(key_type)
LEFT JOIN conflicts c USING (key_type)
GROUP BY kinds.key_type ORDER BY kinds.key_type;

\echo 'D. UserCode conflict identities (no UserCode values displayed)'
SELECT s.id AS source_id, s.isdeleted AS source_isdeleted,
       t.id AS existing_owner_id, t.tenant_id AS existing_owner_tenant
FROM migration_source_user_keys s
JOIN migration_target_user_keys t ON t.usercode_hash = s.usercode_hash AND t.id <> s.id
ORDER BY s.id, t.id;

\echo 'E. Phone conflict identities and whether the current owner would release that phone'
\echo 'Release assumes source-authoritative phone updates and requires confirmation before any write.'
SELECT s.id AS source_id, s.isdeleted AS source_isdeleted,
       t.id AS existing_owner_id, t.tenant_id AS existing_owner_tenant,
       owner_source.id IS NOT NULL AS owner_also_in_source,
       owner_source.isdeleted AS owner_source_isdeleted,
       CASE WHEN owner_source.id IS NOT NULL
            THEN owner_source.phone_hash IS DISTINCT FROM t.phone_hash
            ELSE NULL END AS owner_source_phone_differs,
       CASE WHEN owner_source.id IS NOT NULL AND current_source.id IS NOT NULL
            THEN owner_source.phone_hash = current_source.phone_hash
            ELSE NULL END AS reciprocal_phone_swap
FROM migration_source_user_keys s
JOIN migration_target_user_keys t ON t.phone_hash = s.phone_hash AND t.id <> s.id
LEFT JOIN migration_source_user_keys owner_source ON owner_source.id = t.id
LEFT JOIN migration_target_user_keys current_source ON current_source.id = s.id
ORDER BY s.id, t.id;

ROLLBACK;
