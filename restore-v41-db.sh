#!/usr/bin/env bash
# Restores a V4.1 database from a backup made by backup-v41-db.sh. The "undo button" if the
# migration run needs to be rolled back.
#
# Restores into <database>, which must already exist. This script does NOT create or drop
# databases for you - deliberately, so a typo in the database name can't wipe the wrong one.
# Create the target database yourself first (createdb ...) if it doesn't exist yet.
#
# Usage:
#   PGPASSWORD=... ./restore-v41-db.sh <host> <database> <username> <archive.dump> [port]
set -euo pipefail

PG_HOST="${1:?Usage: PGPASSWORD=... restore-v41-db.sh <host> <database> <username> <archive.dump> [port]}"
DATABASE="${2:?Usage: PGPASSWORD=... restore-v41-db.sh <host> <database> <username> <archive.dump> [port]}"
USERNAME="${3:?Usage: PGPASSWORD=... restore-v41-db.sh <host> <database> <username> <archive.dump> [port]}"
ARCHIVE="${4:?Usage: PGPASSWORD=... restore-v41-db.sh <host> <database> <username> <archive.dump> [port]}"
PORT="${5:-5432}"
: "${PGPASSWORD:?Set PGPASSWORD before running this script.}"

[ -f "$ARCHIVE" ] || { echo "Archive not found: $ARCHIVE" >&2; exit 1; }

echo "Restoring $ARCHIVE into $DATABASE@$PG_HOST:$PORT ..."
pg_restore --host="$PG_HOST" --port="$PORT" --username="$USERNAME" --dbname="$DATABASE" \
    --no-owner --no-privileges --jobs=4 "$ARCHIVE"

echo "pg_restore finished. Review output above - with --no-owner, harmless notices about skipped ownership/privileges are expected."
