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
 IF to_regclass('migration_v40.sermon_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Sermon migration already committed'; END IF;
END $$;
LOCK TABLE public."Sermons" IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE recovery_before AS SELECT * FROM public."Sermons";
CREATE TEMP TABLE source_sermons AS SELECT * FROM migration_source."Sermons";
CREATE TABLE migration_v40.sermons_before AS SELECT * FROM recovery_before;
CREATE TABLE migration_v40.sermon_source_snapshot AS SELECT * FROM source_sermons;
DO $$
DECLARE source_count integer; target_count_before integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_sermons;
 SELECT count(*) INTO target_count_before FROM recovery_before;
 IF source_count = 0 THEN RAISE EXCEPTION 'No source rows found - refusing to run against an empty source snapshot'; END IF;
 RAISE NOTICE 'Sermons: % source rows, % pre-existing target rows', source_count, target_count_before;
END $$;
CREATE TABLE migration_v40.sermon_source_extra AS SELECT "Id","DigitalFilePath","DigitalFileName","DigitalContentType","DigitalSizeBytes","IsFree","PriceAmount","Currency" FROM source_sermons;
CREATE TABLE migration_v40.sermon_id_map(source_id bigint PRIMARY KEY,target_id bigint NOT NULL UNIQUE,action text NOT NULL);
INSERT INTO migration_v40.sermon_id_map
SELECT s."Id",CASE WHEN t."Id" IS NOT NULL AND t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid THEN s."Id" ELSE (SELECT coalesce(max("Id"),0) FROM public."Sermons")+row_number() OVER(ORDER BY s."Id") END,CASE WHEN t."Id" IS NOT NULL AND t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid THEN 'reuse_root' ELSE 'insert_remapped' END
FROM source_sermons s LEFT JOIN public."Sermons" t ON t."Id"=s."Id";
UPDATE public."Sermons" t SET "Title"=s."Title","Description"=s."Description","S3Key"=s."S3Key","DurationSeconds"=s."DurationSeconds","Speaker"=s."Speaker","PublishedAt"=s."PublishedAt","YoutubeUrl"=s."YoutubeUrl","Type"=s."Type" FROM source_sermons s JOIN migration_v40.sermon_id_map m ON m.source_id=s."Id" WHERE m.action='reuse_root' AND t."Id"=m.target_id AND t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid;
INSERT INTO public."Sermons"("Id","Title","Description","S3Key","DurationSeconds","Speaker","PublishedAt","YoutubeUrl","Type","TenantId") SELECT m.target_id,s."Title",s."Description",s."S3Key",s."DurationSeconds",s."Speaker",s."PublishedAt",s."YoutubeUrl",s."Type",'00000000-0000-0000-0000-000000000001'::uuid FROM source_sermons s JOIN migration_v40.sermon_id_map m ON m.source_id=s."Id" WHERE m.action='insert_remapped';
DO $$
DECLARE source_count integer; other_before integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_sermons;
 SELECT count(*) INTO other_before FROM migration_v40.sermons_before WHERE "TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid;
 IF (SELECT count(*) FROM migration_v40.sermon_id_map)<>source_count OR (SELECT count(*) FROM public."Sermons" WHERE "TenantId"='00000000-0000-0000-0000-000000000001'::uuid)<source_count THEN RAISE EXCEPTION 'Sermon reconciliation failed'; END IF;
 IF (SELECT count(*) FROM public."Sermons" WHERE "TenantId"<>'00000000-0000-0000-0000-000000000001'::uuid)<>other_before THEN RAISE EXCEPTION 'Other-tenant sermon changed'; END IF;
END $$;
SELECT action,count(*) FROM migration_v40.sermon_id_map GROUP BY action ORDER BY action;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM recovery_before b LEFT JOIN public."Sermons" t ON t."Id"=b."Id"
 WHERE NOT EXISTS(SELECT 1 FROM migration_v40.sermon_id_map m WHERE m.action='reuse_root' AND m.target_id=b."Id")
 AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Unmapped destination row changed'; END IF;
 IF EXISTS(SELECT 1 FROM source_sermons s LEFT JOIN migration_v40.sermon_id_map m ON m.source_id=s."Id"
 LEFT JOIN public."Sermons" t ON t."Id"=m.target_id WHERE t."Id" IS NULL OR t."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid OR t."Title" IS DISTINCT FROM s."Title" OR t."Description" IS DISTINCT FROM s."Description" OR t."S3Key" IS DISTINCT FROM s."S3Key" OR t."DurationSeconds" IS DISTINCT FROM s."DurationSeconds" OR t."Speaker" IS DISTINCT FROM s."Speaker" OR t."PublishedAt" IS DISTINCT FROM s."PublishedAt" OR t."YoutubeUrl" IS DISTINCT FROM s."YoutubeUrl" OR t."Type" IS DISTINCT FROM s."Type") THEN RAISE EXCEPTION 'Mapped content reconciliation failed'; END IF;
END $$;
DO $$
DECLARE seq regclass; last_id bigint; called boolean; highest bigint; next_id numeric; target_before integer; insert_remapped_count integer;
BEGIN
 SELECT count(*) INTO target_before FROM migration_v40.sermons_before;
 SELECT count(*) INTO insert_remapped_count FROM migration_v40.sermon_id_map WHERE action='insert_remapped';
 IF (SELECT count(*) FROM public."Sermons")<>(target_before+insert_remapped_count) THEN RAISE EXCEPTION 'Sermon final counts differ'; END IF;
 IF EXISTS(
 (SELECT to_jsonb(s)-ARRAY['Title','Description','S3Key','DurationSeconds','Speaker','PublishedAt','YoutubeUrl','Type'] FROM source_sermons s
 EXCEPT ALL SELECT to_jsonb(e) FROM migration_v40.sermon_source_extra e)
 UNION ALL
 (SELECT to_jsonb(e) FROM migration_v40.sermon_source_extra e EXCEPT ALL
 SELECT to_jsonb(s)-ARRAY['Title','Description','S3Key','DurationSeconds','Speaker','PublishedAt','YoutubeUrl','Type'] FROM source_sermons s)
 ) THEN RAISE EXCEPTION 'Source-only sermon fields differ'; END IF;
 seq:=pg_get_serial_sequence('public."Sermons"','Id')::regclass;
 IF seq IS NULL OR (SELECT seqincrement FROM pg_sequence WHERE seqrelid=seq)<>1 THEN RAISE EXCEPTION 'Unexpected sermon sequence'; END IF;
 EXECUTE format('SELECT last_value,is_called FROM %s',seq) INTO last_id,called;
 SELECT max("Id") INTO highest FROM public."Sermons";
 next_id:=greatest(highest::numeric+1,last_id::numeric+CASE WHEN called THEN 1 ELSE 0 END);
 IF next_id>9223372036854775807 THEN RAISE EXCEPTION 'Sermon ID overflow'; END IF;
 EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
END $$;
SELECT count(*) AS total_sermons,
 count(*) FILTER(WHERE "TenantId"='00000000-0000-0000-0000-000000000001') AS root_sermons,
 count(*) FILTER(WHERE "TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid) AS other_sermons
 FROM public."Sermons";
COMMIT;
\echo 'Sermon migration committed. Source-only digital fields are retained in migration_v40.sermon_source_extra.'
