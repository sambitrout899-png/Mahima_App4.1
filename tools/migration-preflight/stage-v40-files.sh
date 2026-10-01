#!/usr/bin/env bash
# Runs on V4.0 (187.127.132.149). Builds 3 tar archives with internal paths already matching
# their eventual V4.1 destination structure, so extraction on the other end needs no reorganizing:
#   uploads.tar.gz    -C /var/www/mahima-uploads chat            -> under uploads/tenants/<id>/
#   downloads.tar.gz  -C /var/www/mahima-downloads .             -> under downloads/tenants/<id>/
#   wwwroot-flat.tar.gz -C /var/www/mahima-api/wwwroot uploads certificates -> flat, same relative path
# demo-videos is deliberately excluded (marketing content, not migrated per decision).
# Nothing outside this staging directory is touched; no existing V4.0 file is modified or moved.
set -euo pipefail

STAGE_DIR="/var/backups/mahima-migration/file-stage-$(date +%Y%m%d%H%M%S)"
mkdir -p "$STAGE_DIR"
echo "Staging in $STAGE_DIR"

echo "=== uploads.tar.gz (chat/ only) ==="
tar -C /var/www/mahima-uploads -czf "$STAGE_DIR/uploads.tar.gz" chat
tar -tzf "$STAGE_DIR/uploads.tar.gz" | grep -v '/$' | wc -l
du -h "$STAGE_DIR/uploads.tar.gz"

echo "=== downloads.tar.gz (everything under mahima-downloads, as agreed) ==="
tar -C /var/www/mahima-downloads -czf "$STAGE_DIR/downloads.tar.gz" .
tar -tzf "$STAGE_DIR/downloads.tar.gz" | grep -v '/$' | wc -l
du -h "$STAGE_DIR/downloads.tar.gz"

echo "=== wwwroot-flat.tar.gz (uploads + certificates only, demo-videos excluded) ==="
tar -C /var/www/mahima-api/wwwroot -czf "$STAGE_DIR/wwwroot-flat.tar.gz" uploads certificates
tar -tzf "$STAGE_DIR/wwwroot-flat.tar.gz" | grep -v '/$' | wc -l
du -h "$STAGE_DIR/wwwroot-flat.tar.gz"

echo ""
echo "=== sha256 of each archive (for transfer verification) ==="
sha256sum "$STAGE_DIR"/*.tar.gz

echo ""
echo "STAGE_DIR=$STAGE_DIR"
echo "Nothing has been sent anywhere yet and no live V4.0 files were touched."
