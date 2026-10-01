\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_database()<>'mahima_v41_rehearsal_20260922_072500_351048' THEN
    RAISE EXCEPTION 'Only the confirmed target rehearsal database is allowed';
  END IF;
  IF to_regnamespace('migration_source') IS NOT NULL THEN
    RAISE EXCEPTION 'Source bridge already exists; inspect instead of replacing it';
  END IF;
  IF (SELECT count(*) FROM public.users)<>162 OR to_regclass('migration_v40.user_code_map') IS NULL THEN
    RAISE EXCEPTION 'Expected completed user rehearsal';
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS postgres_fdw;
CREATE SCHEMA migration_source;
REVOKE ALL ON SCHEMA migration_source FROM PUBLIC;
CREATE SERVER mahima_v40_rehearsal_source FOREIGN DATA WRAPPER postgres_fdw
OPTIONS (host :'socket_directory', dbname 'mahima_v40_sourcecopy_20260922', port :'server_port', updatable 'false');
CREATE USER MAPPING FOR CURRENT_USER SERVER mahima_v40_rehearsal_source OPTIONS (user 'postgres');
IMPORT FOREIGN SCHEMA public FROM SERVER mahima_v40_rehearsal_source INTO migration_source;
DO $$ BEGIN
  IF (SELECT count(*) FROM migration_source.users)<>120 THEN RAISE EXCEPTION 'Unexpected source users'; END IF;
END $$;
SELECT current_database() AS target_rehearsal,
       (SELECT count(*) FROM public.users) AS rehearsed_target_users,
       (SELECT count(*) FROM migration_source.users) AS backed_up_source_users;
COMMIT;
