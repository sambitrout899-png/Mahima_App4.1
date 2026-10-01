#!/usr/bin/env bash
# Takes a full backup of the V4.1 target database before the migration tool writes to it.
#
# Produces a pg_dump custom-format (-Fc) archive (the one to restore from - compressed,
# supports parallel/selective restore via pg_restore) and a plain .sql file for quick
# human inspection.
#
# Requires the PostgreSQL client tools (pg_dump) and network access to the V4.1 server -
# run this from wherever the migration tool itself will run.
#
# Usage:
#   PGPASSWORD=... ./backup-v41-db.sh <host> <database> <username> [port]
set -euo pipefail

PG_HOST="${1:?Usage: PGPASSWORD=... backup-v41-db.sh <host> <database> <username> [port]}"
DATABASE="${2:?Usage: PGPASSWORD=... backup-v41-db.sh <host> <database> <username> [port]}"
USERNAME="${3:?Usage: PGPASSWORD=... backup-v41-db.sh <host> <database> <username> [port]}"
PORT="${4:-5432}"
: "${PGPASSWORD:?Set PGPASSWORD before running this script (not passed as an argument, so it won't leak into shell history/process list).}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/../migration-output/backups"
mkdir -p "$OUTPUT_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
CUSTOM_ARCHIVE="$OUTPUT_DIR/$DATABASE-$STAMP.dump"
PLAIN_SQL="$OUTPUT_DIR/$DATABASE-$STAMP.sql"

echo "Backing up $DATABASE@$PG_HOST:$PORT ..."

echo "  -> $CUSTOM_ARCHIVE (custom format, use this one to restore)"
pg_dump --host="$PG_HOST" --port="$PORT" --username="$USERNAME" --dbname="$DATABASE" \
    --format=custom --compress=9 --file="$CUSTOM_ARCHIVE"

echo "  -> $PLAIN_SQL (plain SQL, for reference/inspection)"
pg_dump --host="$PG_HOST" --port="$PORT" --username="$USERNAME" --dbname="$DATABASE" \
    --format=plain --file="$PLAIN_SQL"

SIZE_MB=$(du -m "$CUSTOM_ARCHIVE" | cut -f1)
echo ""
echo "Done. Custom archive: $CUSTOM_ARCHIVE (${SIZE_MB} MB)"
echo "To restore: PGPASSWORD=... ./restore-v41-db.sh $PG_HOST <target-db> $USERNAME $CUSTOM_ARCHIVE $PORT"
