#!/usr/bin/env bash
# Restore one known backup into a NEW database. Never drops/reuses a database.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo 'Run as root.' >&2; exit 1; }
version=${1:?Specify v40 or v41}
backup_dir=${2:?Specify the confirmed backup directory}
case "$version" in v40|v41) ;; *) echo 'Expected v40 or v41' >&2; exit 1 ;; esac
backup_dir=$(realpath -e "$backup_dir")
case "$backup_dir" in
  /var/backups/mahima-migration/"$version"-*) ;;
  *) echo 'Backup path/version does not match the migration backup directory.' >&2; exit 1 ;;
esac
[[ -f "$backup_dir/mahima_db_3_0.dump" && -f "$backup_dir/SHA256SUMS" ]] || {
  echo 'Backup archive or checksum manifest is missing.' >&2; exit 1;
}
(cd "$backup_dir" && sha256sum --check SHA256SUMS)
rehearsal_db="mahima_${version}_rehearsal_$(date -u +%Y%m%d_%H%M%S)_$$"
[[ "$rehearsal_db" =~ ^mahima_v4[01]_rehearsal_[0-9_]+$ ]] || exit 1
echo "Creating new rehearsal database: $rehearsal_db"
# An existing-name collision makes createdb fail; it is never dropped/reused.
sudo -u postgres createdb --template=template0 --owner=postgres "$rehearsal_db"
sudo -u postgres psql -X -d postgres -v ON_ERROR_STOP=1 \
  -c "REVOKE CONNECT ON DATABASE \"$rehearsal_db\" FROM PUBLIC;"
sudo -u postgres pg_restore --dbname="$rehearsal_db" --no-owner --no-privileges \
  --exit-on-error --single-transaction "$backup_dir/mahima_db_3_0.dump"
sudo -u postgres psql -X -d "$rehearsal_db" -v ON_ERROR_STOP=1 \
  -c 'SELECT current_database() AS restored_database, count(*) AS restored_users FROM public.users;' \
  -c "SELECT count(*) AS public_tables FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
if [[ "$version" == v41 ]]; then
  sudo -u postgres psql -X -d "$rehearsal_db" -v ON_ERROR_STOP=1 \
    -c 'SELECT tenant_id, count(*) AS restored_users FROM public.users GROUP BY tenant_id ORDER BY tenant_id;'
fi
echo 'Archive restore completed. No app or worker has been started against this database.'
echo 'This is a separate database on the same PostgreSQL server, not a separate server.'
echo "REHEARSAL_DATABASE=$rehearsal_db"
