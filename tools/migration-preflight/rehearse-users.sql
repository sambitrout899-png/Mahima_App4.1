\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL DateStyle = 'ISO, YMD';
SET LOCAL lock_timeout = '10s';
DO $$ BEGIN
  IF current_database() <> 'mahima_v41_rehearsal_20260922_072500_351048' THEN
    RAISE EXCEPTION 'This script is restricted to the confirmed V4.1 rehearsal database';
  END IF;
  IF to_regclass('migration_v40.users_before') IS NOT NULL THEN
    RAISE EXCEPTION 'User rehearsal already attempted successfully; inspect results instead of rerunning';
  END IF;
END $$;
LOCK TABLE public.users, public.user_access_blocks IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE incoming_json (payload jsonb NOT NULL);
\copy incoming_json FROM '/var/backups/mahima-migration/rehearsal-input/users.csv' WITH (FORMAT csv)
DO $$ BEGIN
  IF (SELECT count(*) FROM incoming_json) <> 120 THEN RAISE EXCEPTION 'Expected the 120-user source snapshot'; END IF;
  IF (SELECT count(DISTINCT payload->>'id') FROM incoming_json) <> 120 THEN RAISE EXCEPTION 'Duplicate source IDs'; END IF;
END $$;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS isdeleted boolean NOT NULL DEFAULT false;
CREATE TEMP TABLE incoming AS
SELECT (jsonb_populate_record(NULL::public.users, payload)).* FROM incoming_json;
ALTER TABLE incoming ADD PRIMARY KEY (id);
UPDATE incoming SET tenant_id = '00000000-0000-0000-0000-000000000001';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM incoming s JOIN public.users t USING(id)
      WHERE t.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) THEN
    RAISE EXCEPTION 'Source ID belongs to another tenant';
  END IF;
  IF (SELECT count(*) FROM incoming WHERE isdeleted) <> 31 THEN RAISE EXCEPTION 'Unexpected source deletion counts'; END IF;
  IF (SELECT count(*) FROM public.users) <> 122 OR
     (SELECT count(*) FROM incoming s JOIN public.users t USING(id)) <> 80 THEN
    RAISE EXCEPTION 'Rehearsal baseline differs from the reviewed snapshot';
  END IF;
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
DO $$ BEGIN
  IF (SELECT count(*) FROM migration_v40.user_code_map) <> 1 THEN RAISE EXCEPTION 'Unexpected code mapping count'; END IF;
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
  SELECT array_agg(key ORDER BY key) INTO keys
  FROM (SELECT DISTINCT jsonb_object_keys(payload) AS key FROM incoming_json) k;
  IF cardinality(keys) <> 28 OR EXISTS (
      SELECT 1 FROM unnest(keys) k WHERE NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema='public' AND c.table_name='users' AND c.column_name=k
      )) THEN RAISE EXCEPTION 'Source column set differs from reviewed schema'; END IF;
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
DECLARE keys text[];
BEGIN
  SELECT array_agg(key ORDER BY key) INTO keys
  FROM (SELECT DISTINCT jsonb_object_keys(payload) AS key FROM incoming_json) k;
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
  IF (SELECT count(*) FROM public.users)<>162 OR
     (SELECT count(*) FROM public.users WHERE tenant_id='00000000-0000-0000-0000-000000000001')<>121 OR
     (SELECT count(*) FROM incoming s JOIN public.user_access_blocks b ON b.user_id=s.id WHERE s.isdeleted AND b.is_active)<>31 THEN
    RAISE EXCEPTION 'Post-merge count/block verification failed';
  END IF;
END $$;
SELECT count(*) AS total_users,
       count(*) FILTER (WHERE tenant_id='00000000-0000-0000-0000-000000000001') AS root_users,
       count(*) FILTER (WHERE tenant_id<>'00000000-0000-0000-0000-000000000001') AS other_tenant_users,
       count(*) FILTER (WHERE tenant_id='00000000-0000-0000-0000-000000000001' AND isdeleted) AS deleted_root_users
FROM public.users;
SELECT user_id, source_code, target_code FROM migration_v40.user_code_map;
COMMIT;
\echo 'USER REHEARSAL ONLY committed. Other modules, application checks and file migration remain outstanding.'
