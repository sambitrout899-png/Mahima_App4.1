\set ON_ERROR_STOP on
\pset pager off
BEGIN;
DO $$ BEGIN IF current_database()<>'mahima_v41_rehearsal_20260922_072500_351048' THEN RAISE EXCEPTION 'Wrong rehearsal database'; END IF; IF to_regclass('migration_v40.sermon_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Sermon rehearsal already committed'; END IF; END $$;
LOCK TABLE public."Sermons" IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE recovery_before AS SELECT * FROM public."Sermons";
CREATE TEMP TABLE source_sermons AS SELECT * FROM migration_source."Sermons";
CREATE TABLE migration_v40.sermon_source_extra AS SELECT "Id","DigitalFilePath","DigitalFileName","DigitalContentType","DigitalSizeBytes","IsFree","PriceAmount","Currency" FROM source_sermons;
CREATE TABLE migration_v40.sermon_id_map(source_id bigint PRIMARY KEY,target_id bigint NOT NULL UNIQUE,action text NOT NULL);
INSERT INTO migration_v40.sermon_id_map
SELECT s."Id",CASE WHEN t."Id" IS NOT NULL AND t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid THEN s."Id" ELSE (SELECT coalesce(max("Id"),0) FROM public."Sermons")+row_number() OVER(ORDER BY s."Id") END,CASE WHEN t."Id" IS NOT NULL AND t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid THEN 'reuse_root' ELSE 'insert_remapped' END
FROM source_sermons s LEFT JOIN public."Sermons" t ON t."Id"=s."Id";
UPDATE public."Sermons" t SET "Title"=s."Title","Description"=s."Description","S3Key"=s."S3Key","DurationSeconds"=s."DurationSeconds","Speaker"=s."Speaker","PublishedAt"=s."PublishedAt","YoutubeUrl"=s."YoutubeUrl","Type"=s."Type" FROM source_sermons s JOIN migration_v40.sermon_id_map m ON m.source_id=s."Id" WHERE m.action='reuse_root' AND t."Id"=m.target_id AND t."TenantId"='00000000-0000-0000-0000-000000000001'::uuid;
INSERT INTO public."Sermons"("Id","Title","Description","S3Key","DurationSeconds","Speaker","PublishedAt","YoutubeUrl","Type","TenantId") SELECT m.target_id,s."Title",s."Description",s."S3Key",s."DurationSeconds",s."Speaker",s."PublishedAt",s."YoutubeUrl",s."Type",'00000000-0000-0000-0000-000000000001'::uuid FROM source_sermons s JOIN migration_v40.sermon_id_map m ON m.source_id=s."Id" WHERE m.action='insert_remapped';
DO $$ BEGIN IF (SELECT count(*) FROM migration_v40.sermon_id_map)<>23 OR (SELECT count(*) FROM public."Sermons" WHERE "TenantId"='00000000-0000-0000-0000-000000000001'::uuid)<23 THEN RAISE EXCEPTION 'Sermon reconciliation failed'; END IF; IF (SELECT count(*) FROM public."Sermons" WHERE "TenantId"<>'00000000-0000-0000-0000-000000000001'::uuid)<>1 THEN RAISE EXCEPTION 'Other-tenant sermon changed'; END IF; END $$;
SELECT action,count(*) FROM migration_v40.sermon_id_map GROUP BY action ORDER BY action;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM recovery_before b LEFT JOIN public."Sermons" t ON t."Id"=b."Id"
 WHERE NOT EXISTS(SELECT 1 FROM migration_v40.sermon_id_map m WHERE m.action='reuse_root' AND m.target_id=b."Id")
 AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Unmapped destination row changed'; END IF;
 IF EXISTS(SELECT 1 FROM source_sermons s LEFT JOIN migration_v40.sermon_id_map m ON m.source_id=s."Id"
 LEFT JOIN public."Sermons" t ON t."Id"=m.target_id WHERE t."Id" IS NULL OR t."TenantId" IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid OR t."Title" IS DISTINCT FROM s."Title" OR t."Description" IS DISTINCT FROM s."Description" OR t."S3Key" IS DISTINCT FROM s."S3Key" OR t."DurationSeconds" IS DISTINCT FROM s."DurationSeconds" OR t."Speaker" IS DISTINCT FROM s."Speaker" OR t."PublishedAt" IS DISTINCT FROM s."PublishedAt" OR t."YoutubeUrl" IS DISTINCT FROM s."YoutubeUrl" OR t."Type" IS DISTINCT FROM s."Type") THEN RAISE EXCEPTION 'Mapped content reconciliation failed'; END IF;
END $$;
COMMIT;
\echo 'Sermon rehearsal committed. Source-only digital fields are retained in migration_v40.sermon_source_extra.'
