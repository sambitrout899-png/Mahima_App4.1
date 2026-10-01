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
 IF to_regclass('migration_v40.account_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Account migration already committed; do not rerun'; END IF;
 IF to_regclass('migration_v40.user_code_map') IS NULL OR to_regclass('migration_source.accounts') IS NULL THEN RAISE EXCEPTION 'Required migration prerequisites missing'; END IF;
END $$;
LOCK TABLE public.accounts IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE source_accounts AS SELECT * FROM migration_source.accounts;
CREATE TABLE migration_v40.accounts_before AS SELECT * FROM public.accounts;
DO $$
DECLARE source_count integer; target_count_before integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_accounts;
 SELECT count(*) INTO target_count_before FROM public.accounts;
 IF source_count = 0 THEN RAISE EXCEPTION 'No source rows found - refusing to run against an empty source snapshot'; END IF;
 RAISE NOTICE 'Accounts: % source rows, % pre-existing target rows', source_count, target_count_before;
 IF EXISTS (SELECT 1 FROM source_accounts GROUP BY lower(name) HAVING count(*)>1) THEN
   RAISE EXCEPTION 'Source account names collide under destination uniqueness rules';
 END IF;
 -- Unlike the byte-identical-collision tables, a same-name account with DIFFERENT other fields
 -- (type, created_at) is a genuine content conflict, not a coincidence - this deliberately still
 -- aborts for a human to resolve rather than silently picking a side.
 IF EXISTS (SELECT 1 FROM source_accounts s JOIN public.accounts t ON lower(t.name)=lower(s.name)
   AND t.tenant_id='00000000-0000-0000-0000-000000000001'
   WHERE (to_jsonb(s)-'id') IS DISTINCT FROM (to_jsonb(t)-ARRAY['id','tenant_id'])) THEN
   RAISE EXCEPTION 'Same-name root account differs; account merge needs review';
 END IF;
END $$;
CREATE TABLE migration_v40.account_id_map (
 source_id bigint PRIMARY KEY, target_id bigint NOT NULL UNIQUE, action text NOT NULL
);
INSERT INTO migration_v40.account_id_map
SELECT s.id,coalesce(t.id,s.id),CASE WHEN t.id IS NULL THEN 'insert' ELSE 'reuse_identical' END
FROM source_accounts s LEFT JOIN public.accounts t ON lower(t.name)=lower(s.name)
 AND t.tenant_id='00000000-0000-0000-0000-000000000001';
DO $$
DECLARE insert_count integer; reuse_count integer; total_map integer; source_count integer;
BEGIN
 SELECT count(*) FILTER (WHERE action='insert'), count(*) FILTER (WHERE action='reuse_identical'), count(*)
   INTO insert_count, reuse_count, total_map FROM migration_v40.account_id_map;
 SELECT count(*) INTO source_count FROM source_accounts;
 RAISE NOTICE 'Accounts plan: % insert / % reuse_identical (matched by name)', insert_count, reuse_count;
 IF insert_count + reuse_count <> total_map OR total_map <> source_count THEN
   RAISE EXCEPTION 'ID map does not cover every source row exactly once';
 END IF;
 IF EXISTS (SELECT 1 FROM migration_v40.account_id_map m JOIN public.accounts t ON t.id=m.target_id WHERE m.action='insert') THEN
   RAISE EXCEPTION 'Proposed new account ID is occupied';
 END IF;
END $$;
INSERT INTO public.accounts(id,name,type,created_at,tenant_id)
SELECT m.target_id,s.name,s.type,s.created_at,'00000000-0000-0000-0000-000000000001'
FROM source_accounts s JOIN migration_v40.account_id_map m ON m.source_id=s.id WHERE m.action='insert';
DO $$
DECLARE root_before integer; target_before integer; insert_count integer;
BEGIN
 SELECT count(*) INTO root_before FROM migration_v40.accounts_before WHERE tenant_id='00000000-0000-0000-0000-000000000001';
 SELECT count(*) INTO target_before FROM migration_v40.accounts_before;
 SELECT count(*) INTO insert_count FROM migration_v40.account_id_map WHERE action='insert';
 IF EXISTS (SELECT 1 FROM migration_v40.accounts_before b LEFT JOIN public.accounts t USING(id)
            WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN
   RAISE EXCEPTION 'Pre-existing account changed';
 END IF;
 IF EXISTS (SELECT 1 FROM source_accounts s JOIN migration_v40.account_id_map m ON m.source_id=s.id
            LEFT JOIN public.accounts t ON t.id=m.target_id
            WHERE (to_jsonb(s)-'id') IS DISTINCT FROM (to_jsonb(t)-ARRAY['id','tenant_id'])
               OR t.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) THEN
   RAISE EXCEPTION 'Account field or ownership reconciliation failed';
 END IF;
 IF (SELECT count(*) FROM public.accounts)<>(target_before+insert_count) OR
    (SELECT count(*) FROM public.accounts WHERE tenant_id='00000000-0000-0000-0000-000000000001')<>(root_before+insert_count) THEN
   RAISE EXCEPTION 'Unexpected post-merge account totals';
 END IF;
END $$;
-- Identity reset uses transactional ALTER SEQUENCE, never moves the generator back.
-- Includes an existing uncalled sequence value when selecting its safe next value.
DO $$
DECLARE seq regclass; seq_last bigint; seq_called boolean; seq_step bigint; max_id bigint; next_id numeric;
BEGIN
 seq:=pg_get_serial_sequence('public.accounts','id')::regclass;
 IF seq IS NULL THEN RAISE EXCEPTION 'Account identity generator missing'; END IF;
 SELECT seqincrement INTO seq_step FROM pg_sequence WHERE seqrelid=seq;
 IF seq_step<>1 THEN RAISE EXCEPTION 'Unexpected sequence increment'; END IF;
 EXECUTE format('SELECT last_value,is_called FROM %s',seq) INTO seq_last,seq_called;
 SELECT max(id) INTO max_id FROM public.accounts;
 next_id:=greatest(max_id::numeric+1,seq_last::numeric+CASE WHEN seq_called THEN seq_step ELSE 0 END);
 IF next_id>9223372036854775807 THEN RAISE EXCEPTION 'Sequence overflow'; END IF;
 EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
END $$;
SELECT count(*) AS total_accounts,
       count(*) FILTER(WHERE tenant_id='00000000-0000-0000-0000-000000000001') AS root_accounts,
       count(*) FILTER(WHERE tenant_id<>'00000000-0000-0000-0000-000000000001') AS other_tenant_accounts FROM public.accounts;
SELECT action,count(*) AS mapped_accounts FROM migration_v40.account_id_map GROUP BY action ORDER BY action;
COMMIT;
\echo 'Account migration committed. Journal entries and journal lines have NOT yet been migrated.'
