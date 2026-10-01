#!/usr/bin/env bash
# Runs on V4.1 (187.127.157.35). Restores the frozen V4.0 backup into a local database on THIS
# server, then attaches migration_source as a postgres_fdw bridge to it from the REAL production
# mahima_db_3_0 - mirroring exactly how the rehearsal's migration_source bridge worked, just
# pointing at frozen production data instead of a rehearsal snapshot. Does not touch
# mahima_db_3_0's application tables in any way; only restores into a brand-new sibling database.
set -euo pipefail

BACKUP_DUMP="${1:?Usage: setup-production-source-bridge.sh <path-to-v40-backup.dump>}"
SOURCECOPY_DB="mahima_v40_prodsource_$(date +%Y%m%d)"

echo "=== Creating $SOURCECOPY_DB and restoring $BACKUP_DUMP into it ==="
sudo -u postgres createdb "$SOURCECOPY_DB"
sudo -u postgres pg_restore -d "$SOURCECOPY_DB" --no-owner --no-privileges --exit-on-error "$BACKUP_DUMP"
echo "Restore complete."
sudo -u postgres psql -X -d "$SOURCECOPY_DB" -c "SELECT count(*) AS restored_users FROM public.users;"

echo ""
echo "=== Attaching migration_source bridge on production mahima_db_3_0 ==="
cat > /tmp/mahima-attach-production-source.sql <<SQL
\set ON_ERROR_STOP on
BEGIN;
DO \$\$ BEGIN
  IF to_regclass('public.tenants') IS NULL THEN RAISE EXCEPTION 'Not the multi-tenant (V4.1) database - refusing to run here'; END IF;
  IF to_regnamespace('migration_source') IS NOT NULL THEN RAISE EXCEPTION 'Source bridge already exists; inspect instead of replacing it'; END IF;
END \$\$;
CREATE EXTENSION IF NOT EXISTS postgres_fdw;
CREATE SCHEMA migration_source;
REVOKE ALL ON SCHEMA migration_source FROM PUBLIC;
SELECT btrim(split_part(current_setting('unix_socket_directories'), ',', 1)) AS socket_directory,
       current_setting('port') AS server_port
\gset
CREATE SERVER mahima_v40_production_source FOREIGN DATA WRAPPER postgres_fdw
OPTIONS (host :'socket_directory', dbname '$SOURCECOPY_DB', port :'server_port', updatable 'false');
CREATE USER MAPPING FOR CURRENT_USER SERVER mahima_v40_production_source OPTIONS (user 'postgres');
IMPORT FOREIGN SCHEMA public FROM SERVER mahima_v40_production_source INTO migration_source;
SELECT current_database() AS target, (SELECT count(*) FROM public.users) AS target_users,
       (SELECT count(*) FROM migration_source.users) AS source_users;
COMMIT;
SQL
sudo -u postgres psql -X -d mahima_db_3_0 -v ON_ERROR_STOP=1 -f /tmp/mahima-attach-production-source.sql

echo ""
echo "SOURCECOPY_DB=$SOURCECOPY_DB"
echo "Bridge attached. Nothing in production mahima_db_3_0's application tables was modified."
