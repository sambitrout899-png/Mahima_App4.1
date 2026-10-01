\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout='10s';
DO $$ BEGIN
 IF current_database()<>'mahima_v41_rehearsal_20260922_072500_351048' THEN RAISE EXCEPTION 'Wrong rehearsal database'; END IF;
 IF to_regclass('migration_v40.account_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Account rehearsal already committed; do not rerun'; END IF;
 IF to_regclass('migration_v40.user_code_map') IS NULL OR to_regclass('migration_source.accounts') IS NULL THEN RAISE EXCEPTION 'Required rehearsal prerequisites missing'; END IF;
END $$;
LOCK TABLE public.accounts IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE source_accounts AS SELECT * FROM migration_source.accounts;
CREATE TABLE migration_v40.accounts_before AS SELECT * FROM public.accounts;
DO $$ BEGIN
 IF (SELECT count(*) FROM source_accounts)<>48 OR (SELECT count(*) FROM public.accounts)<>87 THEN
   RAISE EXCEPTION 'Account counts differ from reviewed snapshots';
 END IF;
 IF EXISTS (SELECT 1 FROM source_accounts GROUP BY lower(name) HAVING count(*)>1) THEN
   RAISE EXCEPTION 'Source account names collide under destination uniqueness rules';
 END IF;
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
DO $$ BEGIN
 IF (SELECT count(*) FROM migration_v40.account_id_map WHERE action='insert')<>17 OR
    (SELECT count(*) FROM migration_v40.account_id_map WHERE action='reuse_identical')<>31 THEN
   RAISE EXCEPTION 'Account plan differs from reviewed 17 inserts / 31 reuses';
 END IF;
 IF EXISTS (SELECT 1 FROM migration_v40.account_id_map m JOIN public.accounts t ON t.id=m.target_id WHERE m.action='insert') THEN
   RAISE EXCEPTION 'Proposed new account ID is occupied';
 END IF;
END $$;
INSERT INTO public.accounts(id,name,type,created_at,tenant_id)
SELECT m.target_id,s.name,s.type,s.created_at,'00000000-0000-0000-0000-000000000001'
FROM source_accounts s JOIN migration_v40.account_id_map m ON m.source_id=s.id WHERE m.action='insert';
DO $$ BEGIN
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
 IF (SELECT count(*) FROM public.accounts)<>104 OR
    (SELECT count(*) FROM public.accounts WHERE tenant_id='00000000-0000-0000-0000-000000000001')<>48 THEN
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
\echo 'Account rehearsal committed. Journal entries and journal lines have NOT yet been migrated.'
