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
 IF to_regclass('migration_v40.attachment_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Attachment migration already committed; do not rerun'; END IF;
 IF to_regclass('migration_v40.baptism_id_map') IS NULL THEN RAISE EXCEPTION 'Baptism migration must run first'; END IF;
 IF to_regclass('migration_source."Attachments"') IS NULL THEN RAISE EXCEPTION 'Required migration prerequisites missing'; END IF;
END $$;
LOCK TABLE public."Attachments" IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE source_attachments AS SELECT * FROM migration_source."Attachments";
CREATE TABLE migration_v40.attachments_before AS SELECT * FROM public."Attachments";
DO $$
DECLARE source_count integer; target_count_before integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_attachments;
 SELECT count(*) INTO target_count_before FROM public."Attachments";
 IF source_count = 0 THEN RAISE EXCEPTION 'No source rows found - refusing to run against an empty source snapshot'; END IF;
 RAISE NOTICE 'Attachments: % source rows, % pre-existing target rows', source_count, target_count_before;
 IF EXISTS (SELECT 1 FROM source_attachments WHERE "OwnerType"<>'baptism-signed-certificate') THEN
   RAISE EXCEPTION 'Unreviewed OwnerType present - extend the remap logic before proceeding';
 END IF;
 IF EXISTS (SELECT 1 FROM source_attachments s WHERE NOT EXISTS (
     SELECT 1 FROM migration_v40.baptism_id_map m WHERE m.source_id=s."OwnerId")) THEN
   RAISE EXCEPTION 'Attachment owner missing from baptism ID map';
 END IF;
 IF EXISTS (SELECT 1 FROM source_attachments s JOIN public."Attachments" t ON t."Id"=s."Id") THEN
   RAISE EXCEPTION 'Attachment ID unexpectedly already exists in target - this table was assumed collision-free; review before proceeding';
 END IF;
END $$;
CREATE TABLE migration_v40.attachment_id_map (
 source_id bigint PRIMARY KEY, target_id bigint NOT NULL UNIQUE
);
INSERT INTO migration_v40.attachment_id_map SELECT "Id","Id" FROM source_attachments;
INSERT INTO public."Attachments"("Id","OwnerType","OwnerId","S3Key","Filename","ContentType","SizeBytes","UploadedBy","UploadedAt","TenantId")
SELECT s."Id", s."OwnerType", m.target_id, s."S3Key", s."Filename", s."ContentType", s."SizeBytes", s."UploadedBy", s."UploadedAt",
 '00000000-0000-0000-0000-000000000001'
FROM source_attachments s JOIN migration_v40.baptism_id_map m ON m.source_id=s."OwnerId";
DO $$
DECLARE target_count_before integer; source_count integer;
BEGIN
 SELECT count(*) INTO target_count_before FROM migration_v40.attachments_before;
 SELECT count(*) INTO source_count FROM source_attachments;
 IF (SELECT count(*) FROM public."Attachments")<>(target_count_before+source_count) OR
    (SELECT count(*) FROM public."Attachments" WHERE "TenantId"='00000000-0000-0000-0000-000000000001')<>source_count THEN
   RAISE EXCEPTION 'Unexpected post-merge attachment totals';
 END IF;
 IF EXISTS (SELECT 1 FROM public."Attachments" a WHERE a."OwnerType"='baptism-signed-certificate'
    AND NOT EXISTS (SELECT 1 FROM public.baptism_requests b WHERE b.id=a."OwnerId")) THEN
   RAISE EXCEPTION 'Attachment owner reference does not resolve to a real baptism record';
 END IF;
END $$;
DO $$
DECLARE seq regclass; seq_last bigint; seq_called boolean; seq_step bigint; max_id bigint; next_id numeric;
BEGIN
 seq:=pg_get_serial_sequence('public."Attachments"','Id')::regclass;
 IF seq IS NULL THEN RAISE EXCEPTION 'Attachment identity generator missing'; END IF;
 SELECT seqincrement INTO seq_step FROM pg_sequence WHERE seqrelid=seq;
 IF seq_step<>1 THEN RAISE EXCEPTION 'Unexpected sequence increment'; END IF;
 EXECUTE format('SELECT last_value,is_called FROM %s',seq) INTO seq_last,seq_called;
 SELECT max("Id") INTO max_id FROM public."Attachments";
 next_id:=greatest(max_id::numeric+1,seq_last::numeric+CASE WHEN seq_called THEN seq_step ELSE 0 END);
 IF next_id>9223372036854775807 THEN RAISE EXCEPTION 'Sequence overflow'; END IF;
 EXECUTE format('ALTER SEQUENCE %s RESTART WITH %s',seq,next_id);
END $$;
SELECT count(*) AS total_attachments FROM public."Attachments";
COMMIT;
\echo 'Attachment migration committed. File bytes behind S3Key have NOT been copied - check them separately.'
