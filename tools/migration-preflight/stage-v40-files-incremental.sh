#!/usr/bin/env bash
# Runs on V4.0 (187.127.132.149). Finds only files added/modified after the original Stage D
# snapshot (2026-09-22 20:03:28, when stage-v40-files.sh ran) and tars just those, with the same
# internal path layout as the original tars so they extract the same way. Much faster than a full
# re-tar given the original transfer took ~1h07m for 9GB. Nothing existing is touched.
set -euo pipefail

REF_TIME="2026-09-22 20:03:28"
STAGE_DIR="/var/backups/mahima-migration/file-stage-incremental-$(date +%Y%m%d%H%M%S)"
mkdir -p "$STAGE_DIR"
touch -d "$REF_TIME" "$STAGE_DIR/.reference"
echo "Staging incremental files in $STAGE_DIR (anything newer than $REF_TIME)"

echo ""
echo "=== New/changed files under mahima-uploads/chat ==="
cd /var/www/mahima-uploads
NEW_UPLOADS=$(find chat -type f -newer "$STAGE_DIR/.reference")
echo "$NEW_UPLOADS" | grep -c . || echo 0
if [ -n "$NEW_UPLOADS" ]; then
  echo "$NEW_UPLOADS" | tar -czf "$STAGE_DIR/uploads-incremental.tar.gz" -T -
fi

echo ""
echo "=== New/changed files under mahima-downloads ==="
cd /var/www/mahima-downloads
NEW_DOWNLOADS=$(find . -type f -newer "$STAGE_DIR/.reference")
echo "$NEW_DOWNLOADS" | grep -c . || echo 0
if [ -n "$NEW_DOWNLOADS" ]; then
  echo "$NEW_DOWNLOADS" | tar -czf "$STAGE_DIR/downloads-incremental.tar.gz" -T -
fi

echo ""
echo "=== New/changed files under wwwroot/uploads and wwwroot/certificates ==="
cd /var/www/mahima-api/wwwroot
NEW_WWWROOT=$( { find uploads -type f -newer "$STAGE_DIR/.reference" 2>/dev/null; find certificates -type f -newer "$STAGE_DIR/.reference" 2>/dev/null; } )
echo "$NEW_WWWROOT" | grep -c . || echo 0
if [ -n "$NEW_WWWROOT" ]; then
  echo "$NEW_WWWROOT" | tar -czf "$STAGE_DIR/wwwroot-incremental.tar.gz" -T -
fi

echo ""
ls -la "$STAGE_DIR"
echo ""
echo "=== sha256 of any produced archives ==="
sha256sum "$STAGE_DIR"/*.tar.gz 2>/dev/null || echo "(no incremental archives - nothing new since the snapshot)"

echo ""
echo "STAGE_DIR=$STAGE_DIR"
