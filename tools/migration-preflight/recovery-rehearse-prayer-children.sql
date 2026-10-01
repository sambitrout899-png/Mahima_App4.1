\set ON_ERROR_STOP on
\pset pager off
BEGIN;
DO $$ BEGIN
 IF to_regclass('public.tenants') IS NULL THEN RAISE EXCEPTION 'Not a multi-tenant (V4.1) database - refusing to run here'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id='00000000-0000-0000-0000-000000000001'::uuid AND slug='mahima-root') THEN
   RAISE EXCEPTION 'Mahima Root tenant not found with the expected id/slug - refusing to run';
 END IF;
 IF to_regclass('migration_v40.prayer_response_id_map') IS NOT NULL THEN RAISE EXCEPTION 'Prayer child migration already committed'; END IF;
 IF to_regclass('migration_v40.prayer_request_id_map') IS NULL THEN RAISE EXCEPTION 'Prayer requests stage missing'; END IF;
END $$;
LOCK TABLE public.prayerresponses,public.prayertestimonies IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE sr AS SELECT * FROM migration_source.prayerresponses; CREATE TEMP TABLE st AS SELECT * FROM migration_source.prayertestimonies;
DO $$
DECLARE response_count integer; testimony_count integer;
BEGIN
 SELECT count(*) INTO response_count FROM sr;
 SELECT count(*) INTO testimony_count FROM st;
 RAISE NOTICE 'Prayer children: % source responses, % source testimonies', response_count, testimony_count;
END $$;
CREATE TABLE migration_v40.orphan_prayer_testimonies AS SELECT * FROM st WHERE false;
INSERT INTO migration_v40.orphan_prayer_testimonies SELECT s.* FROM st s LEFT JOIN migration_v40.prayer_request_id_map rm ON rm.source_id=s.prayerrequestid WHERE rm.source_id IS NULL;
CREATE TABLE migration_v40.prayer_response_id_map(source_id bigint PRIMARY KEY,target_id bigint NOT NULL UNIQUE);
INSERT INTO migration_v40.prayer_response_id_map SELECT s.id,(SELECT coalesce(max(id),0) FROM public.prayerresponses)+row_number() OVER(ORDER BY s.id) FROM sr s;
INSERT INTO public.prayerresponses(id,prayerrequestid,userid,message,author,createdat,updatedat) SELECT m.target_id,rm.target_id,s.userid,s.message,s.author,s.createdat,s.updatedat FROM sr s JOIN migration_v40.prayer_response_id_map m ON m.source_id=s.id JOIN migration_v40.prayer_request_id_map rm ON rm.source_id=s.prayerrequestid ON CONFLICT(id) DO NOTHING;
CREATE TABLE migration_v40.prayer_testimony_id_map(source_id bigint PRIMARY KEY,target_id bigint NOT NULL UNIQUE);
INSERT INTO migration_v40.prayer_testimony_id_map SELECT s.id,(SELECT coalesce(max(id),0) FROM public.prayertestimonies)+row_number() OVER(ORDER BY s.id) FROM st s JOIN migration_v40.prayer_request_id_map rm ON rm.source_id=s.prayerrequestid;
INSERT INTO public.prayertestimonies(id,prayerrequestid,userid,title,testimonytext,testimonytexthindi,imageurl,voiceurl,createdat,updatedat) SELECT m.target_id,rm.target_id,s.userid,s.title,s.testimonytext,s.testimonytexthindi,s.imageurl,s.voiceurl,s.createdat,s.updatedat FROM st s JOIN migration_v40.prayer_testimony_id_map m ON m.source_id=s.id JOIN migration_v40.prayer_request_id_map rm ON rm.source_id=s.prayerrequestid ON CONFLICT(prayerrequestid) DO UPDATE SET userid=EXCLUDED.userid,title=EXCLUDED.title,testimonytext=EXCLUDED.testimonytext,testimonytexthindi=EXCLUDED.testimonytexthindi,imageurl=EXCLUDED.imageurl,voiceurl=EXCLUDED.voiceurl,createdat=EXCLUDED.createdat,updatedat=EXCLUDED.updatedat;
DO $$
DECLARE response_count integer; testimony_matched_count integer; orphan_count integer;
BEGIN
 SELECT count(*) INTO response_count FROM sr;
 SELECT count(*) INTO orphan_count FROM migration_v40.orphan_prayer_testimonies;
 SELECT count(*) INTO testimony_matched_count FROM st s JOIN migration_v40.prayer_request_id_map rm ON rm.source_id=s.prayerrequestid;
 IF (SELECT count(*) FROM migration_v40.prayer_response_id_map)<>response_count
    OR (SELECT count(*) FROM migration_v40.prayer_testimony_id_map)<>testimony_matched_count
    OR (SELECT count(*) FROM st)<>testimony_matched_count+orphan_count THEN RAISE EXCEPTION 'Prayer child reconciliation failed'; END IF;
END $$;
SELECT 'responses' table_name,count(*) FROM migration_v40.prayer_response_id_map UNION ALL SELECT 'testimonies_imported',count(*) FROM migration_v40.prayer_testimony_id_map UNION ALL SELECT 'orphan_testimonies_archived',count(*) FROM migration_v40.orphan_prayer_testimonies;
COMMIT;
\echo 'Prayer responses and testimonies migration committed.'
