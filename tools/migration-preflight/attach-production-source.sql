\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF to_regclass('public.tenants') IS NULL THEN RAISE EXCEPTION 'Not the multi-tenant (V4.1) database - refusing to run here'; END IF;
  IF to_regnamespace('migration_source') IS NOT NULL THEN RAISE EXCEPTION 'Source bridge already exists; inspect instead of replacing it'; END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS postgres_fdw;
CREATE SCHEMA migration_source;
REVOKE ALL ON SCHEMA migration_source FROM PUBLIC;
SELECT btrim(split_part(current_setting('unix_socket_directories'), ',', 1)) AS socket_directory,
       current_setting('port') AS server_port
\gset
CREATE SERVER mahima_v40_production_source FOREIGN DATA WRAPPER postgres_fdw
OPTIONS (host :'socket_directory', dbname 'mahima_v40_prodsource_20260923', port :'server_port', updatable 'false');
CREATE USER MAPPING FOR CURRENT_USER SERVER mahima_v40_production_source OPTIONS (user 'postgres');
IMPORT FOREIGN SCHEMA public FROM SERVER mahima_v40_production_source INTO migration_source;
SELECT current_database() AS target, (SELECT count(*) FROM public.users) AS target_users,
       (SELECT count(*) FROM migration_source.users) AS source_users;
COMMIT;
