\set ON_ERROR_STOP on
\pset pager off
BEGIN;
SET LOCAL TIME ZONE 'UTC';
SET LOCAL lock_timeout='10s';
DO $$ BEGIN
 IF current_database()<>'mahima_v41_rehearsal_20260922_072500_351048' THEN RAISE EXCEPTION 'Wrong rehearsal database'; END IF;
 IF to_regclass('migration_v40.team_id_map') IS NOT NULL OR to_regclass('migration_v40.position_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Reference stage already committed; do not rerun'; END IF;
 IF to_regclass('migration_v40.user_code_map') IS NULL THEN RAISE EXCEPTION 'Users stage missing'; END IF;
END $$;
LOCK TABLE public."Teams",public.positions IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE source_teams AS SELECT * FROM migration_source."Teams";
CREATE TEMP TABLE source_positions AS SELECT * FROM migration_source.positions;
CREATE TABLE migration_v40.teams_before AS SELECT * FROM public."Teams";
CREATE TABLE migration_v40.positions_before AS SELECT * FROM public.positions;
DO $$ BEGIN
 IF (SELECT count(*) FROM source_teams)<>7 OR (SELECT count(*) FROM source_positions)<>7 OR
    (SELECT count(*) FROM public."Teams")<>13 OR (SELECT count(*) FROM public.positions)<>29 THEN RAISE EXCEPTION 'Reference baseline differs'; END IF;
 IF EXISTS(SELECT 1 FROM source_teams s JOIN public."Teams" t ON lower(t."Name")=lower(s."Name") AND t."TenantId"='00000000-0000-0000-0000-000000000001' GROUP BY s."Id" HAVING count(*)>1) THEN RAISE EXCEPTION 'Ambiguous existing root team name'; END IF;
 IF EXISTS(SELECT 1 FROM source_positions GROUP BY lower(name) HAVING count(*)>1) THEN RAISE EXCEPTION 'Ambiguous source position name'; END IF;
END $$;
CREATE TABLE migration_v40.team_id_map(source_id bigint PRIMARY KEY,target_id bigint NOT NULL UNIQUE,action text NOT NULL);
CREATE TABLE migration_v40.position_id_map(source_id bigint PRIMARY KEY,target_id bigint NOT NULL UNIQUE,action text NOT NULL);
INSERT INTO migration_v40.team_id_map
SELECT s."Id",CASE WHEN t."Id" IS NOT NULL THEN t."Id" WHEN occupied."Id" IS NULL THEN s."Id"
 ELSE greatest((SELECT max("Id") FROM public."Teams"),(SELECT max("Id") FROM source_teams))+row_number() OVER(ORDER BY s."Id") END,
 CASE WHEN t."Id" IS NOT NULL THEN 'reuse_source_wins' ELSE 'insert' END
FROM source_teams s LEFT JOIN public."Teams" t ON lower(t."Name")=lower(s."Name") AND t."TenantId"='00000000-0000-0000-0000-000000000001'
LEFT JOIN public."Teams" occupied ON occupied."Id"=s."Id";
INSERT INTO migration_v40.position_id_map
SELECT s.id,CASE WHEN t.id IS NOT NULL THEN t.id WHEN occupied.id IS NULL THEN s.id
 ELSE greatest((SELECT max(id) FROM public.positions),(SELECT max(id) FROM source_positions))+row_number() OVER(ORDER BY s.id) END,
 CASE WHEN t.id IS NOT NULL THEN 'reuse_source_wins' ELSE 'insert' END
FROM source_positions s LEFT JOIN public.positions t ON lower(t.name)=lower(s.name) AND t.tenant_id='00000000-0000-0000-0000-000000000001'
LEFT JOIN public.positions occupied ON occupied.id=s.id;
DO $$ BEGIN
 IF (SELECT count(*) FROM migration_v40.team_id_map WHERE action='insert')<>3 OR
    (SELECT count(*) FROM migration_v40.position_id_map WHERE action='insert')<>5 THEN RAISE EXCEPTION 'Unexpected mapping counts'; END IF;
 IF EXISTS(SELECT 1 FROM source_positions s LEFT JOIN migration_v40.position_id_map m ON m.source_id=s.parent_position_id WHERE s.parent_position_id IS NOT NULL AND m.source_id IS NULL) THEN RAISE EXCEPTION 'Missing source parent position'; END IF;
 IF EXISTS(SELECT 1 FROM source_teams s LEFT JOIN public.users u ON u.id=s."LeadUserId" WHERE s."LeadUserId" IS NOT NULL AND (u.id IS NULL OR u.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid)) THEN RAISE EXCEPTION 'Team lead missing or belongs to another tenant'; END IF;
 IF EXISTS(SELECT 1 FROM migration_v40.team_id_map m JOIN public."Teams" t ON t."Id"=m.target_id WHERE m.action='insert' OR t."TenantId"<>'00000000-0000-0000-0000-000000000001') OR
    EXISTS(SELECT 1 FROM migration_v40.position_id_map m JOIN public.positions t ON t.id=m.target_id WHERE m.action='insert' OR t.tenant_id<>'00000000-0000-0000-0000-000000000001') THEN RAISE EXCEPTION 'Unsafe target mapping'; END IF;
END $$;
INSERT INTO public.positions(id,name,description,parent_position_id,visibility_scope,is_active,created_at_utc,updated_at_utc,tenant_id)
SELECT m.target_id,s.name,s.description,NULL,s.visibility_scope,s.is_active,s.created_at_utc,s.updated_at_utc,'00000000-0000-0000-0000-000000000001'
FROM source_positions s JOIN migration_v40.position_id_map m ON m.source_id=s.id WHERE m.action='insert';
UPDATE public.positions t SET name=s.name,description=s.description,parent_position_id=p.target_id,
 visibility_scope=s.visibility_scope,is_active=s.is_active,created_at_utc=s.created_at_utc,updated_at_utc=s.updated_at_utc
FROM source_positions s JOIN migration_v40.position_id_map m ON m.source_id=s.id
LEFT JOIN migration_v40.position_id_map p ON p.source_id=s.parent_position_id WHERE t.id=m.target_id;
INSERT INTO public."Teams"("Id","Name","Description","LeadUserId","CreatedAt","UpdatedAt","TenantId")
SELECT m.target_id,s."Name",s."Description",s."LeadUserId",s."CreatedAt",s."UpdatedAt",'00000000-0000-0000-0000-000000000001'
FROM source_teams s JOIN migration_v40.team_id_map m ON m.source_id=s."Id" WHERE m.action='insert';
UPDATE public."Teams" t SET "Name"=s."Name","Description"=s."Description","LeadUserId"=s."LeadUserId","CreatedAt"=s."CreatedAt","UpdatedAt"=s."UpdatedAt"
FROM source_teams s JOIN migration_v40.team_id_map m ON m.source_id=s."Id" WHERE t."Id"=m.target_id;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM migration_v40.teams_before b LEFT JOIN public."Teams" t USING("Id") WHERE NOT EXISTS(SELECT 1 FROM migration_v40.team_id_map m WHERE m.target_id=b."Id") AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) OR
    EXISTS(SELECT 1 FROM migration_v40.positions_before b LEFT JOIN public.positions t USING(id) WHERE NOT EXISTS(SELECT 1 FROM migration_v40.position_id_map m WHERE m.target_id=b.id) AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Unrelated reference record changed'; END IF;
 IF EXISTS(SELECT 1 FROM source_teams s JOIN migration_v40.team_id_map m ON m.source_id=s."Id" LEFT JOIN public."Teams" t ON t."Id"=m.target_id WHERE (to_jsonb(s)-'Id') IS DISTINCT FROM (to_jsonb(t)-ARRAY['Id','TenantId']) OR t."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) THEN RAISE EXCEPTION 'Team reconciliation failed'; END IF;
 IF EXISTS(SELECT 1 FROM source_positions s JOIN migration_v40.position_id_map m ON m.source_id=s.id LEFT JOIN migration_v40.position_id_map p ON p.source_id=s.parent_position_id LEFT JOIN public.positions t ON t.id=m.target_id WHERE (to_jsonb(s)-ARRAY['id','parent_position_id']) IS DISTINCT FROM (to_jsonb(t)-ARRAY['id','parent_position_id','tenant_id']) OR t.parent_position_id IS DISTINCT FROM p.target_id OR t.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) THEN RAISE EXCEPTION 'Position reconciliation failed'; END IF;
 IF EXISTS(WITH RECURSIVE walk AS (
    SELECT id,parent_position_id,ARRAY[id] AS path,false AS cycle FROM public.positions WHERE tenant_id='00000000-0000-0000-0000-000000000001'
    UNION ALL SELECT p.id,p.parent_position_id,w.path||p.id,p.id=ANY(w.path) FROM walk w JOIN public.positions p ON p.id=w.parent_position_id WHERE NOT w.cycle
 ) SELECT 1 FROM walk WHERE cycle) THEN RAISE EXCEPTION 'Position hierarchy cycle detected'; END IF;
 IF (SELECT count(*) FROM public."Teams")<>16 OR (SELECT count(*) FROM public.positions)<>34 THEN RAISE EXCEPTION 'Unexpected final reference counts'; END IF;
END $$;
DO $$
DECLARE item record; seq regclass; previous bigint; called boolean; maximum bigint; increment_by bigint; next_id numeric;
BEGIN
 FOR item IN SELECT * FROM (VALUES ('Teams','Id'),('positions','id')) v(tbl,col) LOOP
  seq:=pg_get_serial_sequence(format('public.%I',item.tbl),item.col)::regclass;
  IF seq IS NULL THEN RAISE EXCEPTION 'Missing reference sequence'; END IF;
  SELECT seqincrement INTO increment_by FROM pg_sequence WHERE seqrelid=seq;
  IF increment_by<>1 THEN RAISE EXCEPTION 'Unexpected increment'; END IF;
  EXECUTE format('SELECT last_value,is_called FROM %s',seq) INTO previous,called;
  EXECUTE format('SELECT max(%I) FROM public.%I',item.col,item.tbl) INTO maximum;
  next_id:=greatest(maximum::numeric+1,previous::numeric+CASE WHEN called THEN 1 ELSE 0 END);
  IF next_id>9223372036854775807 THEN RAISE EXCEPTION 'Sequence overflow'; END IF;
  EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
 END LOOP;
END $$;
SELECT 'Teams' AS table_name,count(*) AS total,count(*) FILTER(WHERE "TenantId"='00000000-0000-0000-0000-000000000001') AS root,count(*) FILTER(WHERE "TenantId"<>'00000000-0000-0000-0000-000000000001') AS other FROM public."Teams"
UNION ALL SELECT 'positions',count(*),count(*) FILTER(WHERE tenant_id='00000000-0000-0000-0000-000000000001'),count(*) FILTER(WHERE tenant_id<>'00000000-0000-0000-0000-000000000001') FROM public.positions;
SELECT 'Teams' AS table_name,* FROM migration_v40.team_id_map UNION ALL SELECT 'positions',* FROM migration_v40.position_id_map ORDER BY table_name,source_id;
COMMIT;
\echo 'Reference rehearsal committed. Memberships, user positions and task assignments remain separate stages.'
