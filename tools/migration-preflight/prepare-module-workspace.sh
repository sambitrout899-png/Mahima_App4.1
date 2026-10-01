#!/usr/bin/env bash
# Runs ONLY on the V4.1 host. Creates a separate source copy and a read-only FDW
# bridge inside the already-confirmed target rehearsal database. No app startup.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
source_db=mahima_v40_sourcecopy_20260922
target_db=mahima_v41_rehearsal_20260922_072500_351048
input_dir=/var/backups/mahima-migration/rehearsal-sourcecopy
archive="$input_dir/mahima_db_3_0.dump"
[[ -f "$archive" && -f "$input_dir/SHA256SUMS" ]] || { echo 'Source backup files missing.' >&2; exit 1; }
(cd "$input_dir" && sha256sum --check SHA256SUMS)
# Preflight before creating a database. No installation/change of server packages.
available=$(sudo -u postgres psql -X -At -d "$target_db" -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_available_extensions WHERE name='postgres_fdw';")
[[ "$available" == 1 ]] || { echo 'postgres_fdw is unavailable; stop for review.' >&2; exit 1; }
socket_directory=$(sudo -u postgres psql -X -At -d "$target_db" -v ON_ERROR_STOP=1 -c "SELECT btrim(split_part(current_setting('unix_socket_directories'), ',', 1));")
[[ "$socket_directory" == /* && -d "$socket_directory" ]] || { echo 'No supported local Unix socket directory found.' >&2; exit 1; }
server_port=$(sudo -u postgres psql -X -At -d "$target_db" -v ON_ERROR_STOP=1 -c 'SHOW port;')
[[ "$server_port" =~ ^[0-9]+$ ]] || exit 1
# Fails if the name already exists. Never drops or restores into an existing DB.
sudo -u postgres createdb --template=template0 --owner=postgres "$source_db"
sudo -u postgres psql -X -d postgres -v ON_ERROR_STOP=1 -c "REVOKE CONNECT ON DATABASE $source_db FROM PUBLIC;"
sudo -u postgres pg_restore --dbname="$source_db" --no-owner --no-privileges --exit-on-error --single-transaction "$archive"
sudo -u postgres psql -X -d postgres -v ON_ERROR_STOP=1 -c "ALTER DATABASE $source_db SET default_transaction_read_only=on;"
sudo -u postgres psql -X -d "$target_db" -v ON_ERROR_STOP=1 \
  -v socket_directory="$socket_directory" -v server_port="$server_port" \
  -f /tmp/mahima-attach-rehearsal-source.sql
echo "SOURCE_COPY_DATABASE=$source_db"
echo "TARGET_REHEARSAL_DATABASE=$target_db"
echo 'Read-only source bridge ready in migration_source. Application data was not merged.'
