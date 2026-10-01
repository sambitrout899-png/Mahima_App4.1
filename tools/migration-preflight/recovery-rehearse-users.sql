\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';
SET LOCAL lock_timeout = '10s';
DO $$ BEGIN
  IF to_regclass('public.tenants') IS NULL THEN RAISE EXCEPTION 'Not a multi-tenant (V4.1) database - refusing to run here'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id='00000000-0000-0000-0000-000000000001'::uuid AND slug='mahima-root') THEN
    RAISE EXCEPTION 'Mahima Root tenant not found with the expected id/slug - refusing to run';
  END IF;
  IF to_regclass('migration_v40.users_before') IS NOT NULL THEN
    RAISE EXCEPTION 'User migration already committed; inspect results instead of rerunning';
  END IF;
  IF to_regclass('migration_source.users') IS NULL THEN RAISE EXCEPTION 'Required migration prerequisites missing'; END IF;
END $$;
LOCK TABLE public.users, public.user_access_blocks IN ACCESS EXCLUSIVE MODE;
-- Reshape live source rows into the TARGET's column shape (adds tenant_id/isdeleted as NULL/default
-- for columns the source doesn't have yet) via a JSON round-trip, same technique the original
-- rehearsal script used on a CSV export - just sourced live from the FDW bridge instead of a
-- manually re-exported file, so there is nothing to regenerate for the real cutover.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS isdeleted boolean NOT NULL DEFAULT false;
CREATE TEMP TABLE incoming AS
SELECT (jsonb_populate_record(NULL::public.users, to_jsonb(s))).* FROM migration_source.users s;
ALTER TABLE incoming ADD PRIMARY KEY (id);
DO $$
DECLARE source_count integer; deleted_count integer;
BEGIN
  SELECT count(*) INTO source_count FROM incoming;
  SELECT count(*) INTO deleted_count FROM incoming WHERE isdeleted;
  IF source_count = 0 THEN RAISE EXCEPTION 'No source rows found - refusing to run against an empty source snapshot'; END IF;
  RAISE NOTICE 'Users: % source rows, % soft-deleted', source_count, deleted_count;
END $$;
UPDATE incoming SET tenant_id = '00000000-0000-0000-0000-000000000001';
DO $$
DECLARE target_count_before integer; matching_count integer;
BEGIN
  IF EXISTS (SELECT 1 FROM incoming s JOIN public.users t USING(id)
      WHERE t.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) THEN
    RAISE EXCEPTION 'Source ID belongs to another tenant';
  END IF;
  SELECT count(*) INTO target_count_before FROM public.users;
  SELECT count(*) INTO matching_count FROM incoming s JOIN public.users t USING(id);
  RAISE NOTICE 'Users: % pre-existing target rows, % matching by id', target_count_before, matching_count;
END $$;
CREATE SCHEMA IF NOT EXISTS migration_v40;
REVOKE ALL ON SCHEMA migration_v40 FROM PUBLIC;
CREATE TABLE migration_v40.users_before AS SELECT * FROM public.users;
CREATE TABLE migration_v40.access_blocks_before AS SELECT * FROM public.user_access_blocks;
CREATE TABLE migration_v40.user_code_map (
    user_id uuid PRIMARY KEY, source_code text NOT NULL, target_code text NOT NULL,
    reason text NOT NULL
);
INSERT INTO migration_v40.user_code_map
SELECT s.id, s."UserCode", 'M40' || left(replace(s.id::text, '-', ''), 13),
       'Preserve existing destination UserCode held by a different user'
FROM incoming s WHERE EXISTS (
    SELECT 1 FROM public.users t WHERE t."UserCode"=s."UserCode" AND t.id<>s.id
);
UPDATE incoming s SET "UserCode"=m.target_code FROM migration_v40.user_code_map m WHERE s.id=m.user_id;
DO $$
DECLARE code_map_count integer;
BEGIN
  SELECT count(*) INTO code_map_count FROM migration_v40.user_code_map;
  RAISE NOTICE 'UserCode conflicts requiring a remapped code: %', code_map_count;
  IF EXISTS (SELECT 1 FROM incoming GROUP BY "UserCode" HAVING count(*)>1) OR
     EXISTS (SELECT 1 FROM incoming s JOIN public.users t ON t."UserCode"=s."UserCode" AND t.id<>s.id) THEN
    RAISE EXCEPTION 'Unresolved UserCode conflict';
  END IF;
END $$;
-- Clearing only participating root users' phones avoids intermediate conflicts.
-- The full transaction rolls back if any incoming final value is invalid/conflicting.
UPDATE public.users t SET phone=NULL FROM incoming s WHERE t.id=s.id;
DO $$
DECLARE cols text; assignments text; keys text[];
BEGIN
  -- Deliberately the SOURCE's own column set (migration_source.users), not incoming's full
  -- target-shaped columns - jsonb_populate_record fills every target column (mfa_enabled etc.)
  -- with NULL where the source doesn't have it, and several of those are NOT NULL with no
  -- default applied to an explicit NULL, so only ever write the columns the source actually has.
  SELECT array_agg(column_name ORDER BY column_name) INTO keys
  FROM information_schema.columns WHERE table_schema='migration_source' AND table_name='users';
  IF keys IS NULL OR cardinality(keys) = 0 THEN RAISE EXCEPTION 'Could not determine source column set'; END IF;
  IF EXISTS (
      SELECT 1 FROM unnest(keys) k WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema='public' AND c.table_name='users' AND c.column_name=k
      )) THEN RAISE EXCEPTION 'Source columns are not a subset of the target users table - review schema before proceeding'; END IF;
  SELECT string_agg(format('%I', k), ', ' ORDER BY k),
         string_agg(format('%I=EXCLUDED.%I', k, k), ', ' ORDER BY k) FILTER (WHERE k<>'id')
  INTO cols, assignments FROM unnest(keys) k;
  EXECUTE format('INSERT INTO public.users (%s, tenant_id) SELECT %s, tenant_id FROM incoming WHERE true ON CONFLICT(id) DO UPDATE SET %s',
                 cols, cols, assignments);
END $$;
-- Preserve deletion status AND use the existing account-block facility.
-- Do not unblock any non-deleted source user that already has a destination block.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM incoming s JOIN public.user_access_blocks b ON b.user_id=s.id
             WHERE s.isdeleted AND b.tenant_id IS DISTINCT FROM s.tenant_id) THEN
    RAISE EXCEPTION 'Access-block tenant mismatch';
  END IF;
END $$;
INSERT INTO public.user_access_blocks (user_id,tenant_id,reason,is_active)
SELECT id,tenant_id,'V4.0 migration: source user is soft-deleted',true FROM incoming WHERE isdeleted
ON CONFLICT(user_id) DO UPDATE SET is_active=true;
DO $$
DECLARE keys text[]; root_before integer; target_before integer; inserted_or_updated integer;
BEGIN
  SELECT array_agg(column_name ORDER BY column_name) INTO keys
  FROM information_schema.columns WHERE table_schema='migration_source' AND table_name='users';
  IF EXISTS (SELECT 1 FROM incoming s JOIN public.users t USING(id), unnest(keys) k
      WHERE (to_jsonb(s)->k) IS DISTINCT FROM (to_jsonb(t)->k)) THEN
    RAISE EXCEPTION 'Shared-field reconciliation failed';
  END IF;
  IF EXISTS (SELECT 1 FROM migration_v40.users_before b JOIN public.users t USING(id)
      JOIN incoming s USING(id) WHERE (to_jsonb(b)-keys) IS DISTINCT FROM (to_jsonb(t)-keys)) THEN
    RAISE EXCEPTION 'Destination-only user fields changed';
  END IF;
  IF EXISTS (SELECT 1 FROM migration_v40.users_before b LEFT JOIN public.users t USING(id)
      WHERE NOT EXISTS(SELECT 1 FROM incoming s WHERE s.id=b.id)
      AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN
    RAISE EXCEPTION 'Unrelated destination user changed';
  END IF;
  IF EXISTS (SELECT 1 FROM migration_v40.access_blocks_before b LEFT JOIN public.user_access_blocks t USING(user_id)
      WHERE NOT EXISTS(SELECT 1 FROM incoming s WHERE s.id=b.user_id AND s.isdeleted)
      AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN
    RAISE EXCEPTION 'Unrelated access block changed';
  END IF;
  SELECT count(*) INTO root_before FROM migration_v40.users_before WHERE tenant_id='00000000-0000-0000-0000-000000000001';
  SELECT count(*) INTO target_before FROM migration_v40.users_before;
  SELECT count(*) INTO inserted_or_updated FROM incoming;
  IF (SELECT count(*) FROM public.users)<>(target_before + (SELECT count(*) FROM incoming s WHERE NOT EXISTS(
        SELECT 1 FROM migration_v40.users_before b WHERE b.id=s.id))) THEN
    RAISE EXCEPTION 'Unexpected post-merge user count';
  END IF;
  IF (SELECT count(*) FROM public.users WHERE tenant_id='00000000-0000-0000-0000-000000000001')<>
     (root_before + (SELECT count(*) FROM incoming s WHERE NOT EXISTS(
        SELECT 1 FROM migration_v40.users_before b WHERE b.id=s.id AND b.tenant_id='00000000-0000-0000-0000-000000000001'))) THEN
    RAISE EXCEPTION 'Unexpected post-merge root-tenant user count';
  END IF;
  IF (SELECT count(*) FROM incoming s JOIN public.user_access_blocks b ON b.user_id=s.id WHERE s.isdeleted AND b.is_active)
     <> (SELECT count(*) FROM incoming WHERE isdeleted) THEN
    RAISE EXCEPTION 'Not every soft-deleted source user has an active access block';
  END IF;
END $$;
SELECT count(*) AS total_users,
       count(*) FILTER (WHERE tenant_id='00000000-0000-0000-0000-000000000001') AS root_users,
       count(*) FILTER (WHERE tenant_id<>'00000000-0000-0000-0000-000000000001') AS other_tenant_users,
       count(*) FILTER (WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND isdeleted) AS deleted_root_users
FROM public.users;
SELECT user_id, source_code, target_code FROM migration_v40.user_code_map;
COMMIT;
\echo 'USER MIGRATION committed. Other modules, application checks and file migration remain outstanding.'
