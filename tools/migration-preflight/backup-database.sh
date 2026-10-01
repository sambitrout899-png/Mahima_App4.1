#!/usr/bin/env bash
# Consistent database snapshot only. Does not pause writers or back up files.
set -euo pipefail
if [[ ${EUID} -ne 0 ]]; then
  echo 'Run as root (uses the local postgres OS account).' >&2
  exit 1
fi
version=${1:?Specify v40 or v41}
case "$version" in v40|v41) ;; *) echo 'Expected v40 or v41' >&2; exit 1 ;; esac
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_parent=/var/backups/mahima-migration
install -d -o root -g root -m 0755 "$backup_parent"
backup_dir=$(mktemp -d "$backup_parent/$version-$stamp-XXXXXX")
chown postgres:postgres "$backup_dir"
chmod 0700 "$backup_dir"
archive="$backup_dir/mahima_db_3_0.dump"
echo "Backing up $version database on $(hostname) to $archive"
sudo -u postgres pg_dump -d mahima_db_3_0 --format=custom --file="$archive"
sudo -u postgres pg_restore --list "$archive" > "$backup_dir/archive-contents.txt"
chmod 0600 "$archive" "$backup_dir/archive-contents.txt"
(cd "$backup_dir" && sha256sum mahima_db_3_0.dump > SHA256SUMS)
chmod 0600 "$backup_dir/SHA256SUMS"
echo 'Database dump and archive listing succeeded. A restore rehearsal is still required.'
echo 'This does not include ordinary filesystem uploads or PostgreSQL cluster roles.'
du -h "$archive"
echo "BACKUP_DIRECTORY=$backup_dir"
