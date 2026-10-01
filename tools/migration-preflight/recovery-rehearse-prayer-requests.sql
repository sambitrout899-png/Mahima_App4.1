\set ON_ERROR_STOP on
\pset pager off
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.tenants') IS NULL THEN RAISE EXCEPTION 'Not a multi-tenant (V4.1) database - refusing to run here'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id='00000000-0000-0000-0000-000000000001'::uuid AND slug='mahima-root') THEN
   RAISE EXCEPTION 'Mahima Root tenant not found with the expected id/slug - refusing to run';
 END IF;
 IF to_regclass('migration_v40.prayer_request_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Prayer request migration already committed'; END IF;
END $$;
LOCK TABLE public.prayerrequests IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE recovery_before AS SELECT * FROM public.prayerrequests;
CREATE TEMP TABLE source_requests AS SELECT * FROM migration_source.prayerrequests;
DO $$
DECLARE source_count integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_requests;
 IF source_count = 0 THEN RAISE EXCEPTION 'No source rows found - refusing to run against an empty source snapshot'; END IF;
 RAISE NOTICE 'Prayer requests: % source rows', source_count;
END $$;
CREATE TABLE migration_v40.prayer_request_id_map(source_id bigint PRIMARY KEY,target_id bigint NOT NULL UNIQUE,action text NOT NULL);
INSERT INTO migration_v40.prayer_request_id_map
SELECT s.id,CASE WHEN t.id IS NOT NULL AND t.tenant_id='00000000-0000-0000-0000-000000000001'::uuid THEN s.id ELSE (SELECT coalesce(max(id),0) FROM public.prayerrequests)+row_number() OVER(ORDER BY s.id) END,CASE WHEN t.id IS NOT NULL AND t.tenant_id='00000000-0000-0000-0000-000000000001'::uuid THEN 'reuse_root' ELSE 'insert_remapped' END FROM source_requests s LEFT JOIN public.prayerrequests t ON t.id=s.id;
UPDATE public.prayerrequests t SET userid=s.userid,title=s.title,message=s.message,anonymous=s.anonymous,status=s.status,assignedto=s.assignedto,createdat=s.createdat,createdby=s.createdby,closecomment=s.closecomment FROM source_requests s JOIN migration_v40.prayer_request_id_map m ON m.source_id=s.id WHERE m.action='reuse_root' AND t.id=m.target_id AND t.tenant_id='00000000-0000-0000-0000-000000000001'::uuid;
INSERT INTO public.prayerrequests(id,userid,title,message,anonymous,status,assignedto,createdat,createdby,closecomment,tenant_id) SELECT m.target_id,s.userid,s.title,s.message,s.anonymous,s.status,s.assignedto,s.createdat,s.createdby,s.closecomment,'00000000-0000-0000-0000-000000000001'::uuid FROM source_requests s JOIN migration_v40.prayer_request_id_map m ON m.source_id=s.id WHERE m.action='insert_remapped';
DO $$
DECLARE source_count integer;
BEGIN
 SELECT count(*) INTO source_count FROM source_requests;
 IF (SELECT count(*) FROM migration_v40.prayer_request_id_map)<>source_count THEN RAISE EXCEPTION 'Prayer request reconciliation failed'; END IF;
END $$;
SELECT action,count(*) FROM migration_v40.prayer_request_id_map GROUP BY action ORDER BY action;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM recovery_before b LEFT JOIN public.prayerrequests t ON t.id=b.id
 WHERE NOT EXISTS(SELECT 1 FROM migration_v40.prayer_request_id_map m WHERE m.action='reuse_root' AND m.target_id=b.id)
 AND to_jsonb(b) IS DISTINCT FROM to_jsonb(t)) THEN RAISE EXCEPTION 'Unmapped destination row changed'; END IF;
 IF EXISTS(SELECT 1 FROM source_requests s LEFT JOIN migration_v40.prayer_request_id_map m ON m.source_id=s.id
 LEFT JOIN public.prayerrequests t ON t.id=m.target_id WHERE t.id IS NULL OR t.tenant_id IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid OR t.userid IS DISTINCT FROM s.userid OR t.title IS DISTINCT FROM s.title OR t.message IS DISTINCT FROM s.message OR t.anonymous IS DISTINCT FROM s.anonymous OR t.status IS DISTINCT FROM s.status OR t.assignedto IS DISTINCT FROM s.assignedto OR t.createdat IS DISTINCT FROM s.createdat OR t.createdby IS DISTINCT FROM s.createdby OR t.closecomment IS DISTINCT FROM s.closecomment) THEN RAISE EXCEPTION 'Mapped content reconciliation failed'; END IF;
END $$;
COMMIT;
\echo 'Prayer request migration committed. Responses and testimonies remain.'
