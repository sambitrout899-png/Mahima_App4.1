#!/usr/bin/env bash
# Runs on V4.1 (187.127.157.35). Extracts the 3 verified archives into their real production
# destinations. Purely additive: --keep-old-files means any pre-existing file with the same
# relative path is left untouched rather than overwritten (matching the "purely additive"
# framing this extraction was approved under). V4.1 already has some live content under these
# tenant paths (real usage since go-live), so this merges into it rather than requiring empty
# destinations.
set -euo pipefail

STAGE_DIR="/var/backups/mahima-migration/file-stage-incoming"
ROOT_TENANT_N="00000000000000000000000000000001"
UPLOADS_DEST="/var/www/mahima-uploads/tenants/$ROOT_TENANT_N"
DOWNLOADS_DEST="/var/www/mahima-downloads/tenants/$ROOT_TENANT_N"
WWWROOT_DEST="/var/www/mahima-api/wwwroot"

echo "=== Pre-flight: reporting existing content (extraction below is additive - --keep-old-files - so any of this is preserved, not overwritten) ==="
for d in "$UPLOADS_DEST" "$DOWNLOADS_DEST"; do
  if [ -e "$d" ]; then
    echo "$d already has content (will be merged into, not replaced):"
    find "$d" -type f | wc -l
  else
    echo "$d does not exist yet - will be created fresh."
  fi
done
echo "Existing wwwroot/uploads and wwwroot/certificates file counts (extraction will skip any name collision, not overwrite):"
find /var/www/mahima-api/wwwroot/uploads -type f 2>/dev/null | wc -l
find /var/www/mahima-api/wwwroot/certificates -type f 2>/dev/null | wc -l

mkdir -p "$UPLOADS_DEST" "$DOWNLOADS_DEST"

echo ""
echo "=== Extracting uploads.tar.gz -> $UPLOADS_DEST (additive merge) ==="
(tar -k -xzf "$STAGE_DIR/uploads.tar.gz" -C "$UPLOADS_DEST" 2>&1 | grep -v "Cannot open: File exists") || true
find "$UPLOADS_DEST" -type f | wc -l

echo ""
echo "=== Extracting downloads.tar.gz -> $DOWNLOADS_DEST (additive merge) ==="
(tar -k -xzf "$STAGE_DIR/downloads.tar.gz" -C "$DOWNLOADS_DEST" 2>&1 | grep -v "Cannot open: File exists") || true
find "$DOWNLOADS_DEST" -type f | wc -l

echo ""
echo "=== Extracting wwwroot-flat.tar.gz -> $WWWROOT_DEST (additive merge) ==="
(tar -k -xzf "$STAGE_DIR/wwwroot-flat.tar.gz" -C "$WWWROOT_DEST" 2>&1 | grep -v "Cannot open: File exists") || true
find "$WWWROOT_DEST/uploads" -type f | wc -l
find "$WWWROOT_DEST/certificates" -type f | wc -l

echo ""
echo "=== Final counts (V4.0 originals: 214 uploads / 77568 downloads / 13 wwwroot-flat - these totals now include any pre-existing V4.1 content too, since this was a merge) ==="
echo "uploads tenant folder total: $(find "$UPLOADS_DEST" -type f | wc -l)"
echo "downloads tenant folder total: $(find "$DOWNLOADS_DEST" -type f | wc -l)"
echo "wwwroot uploads+certificates total: $(($(find "$WWWROOT_DEST/uploads" -type f | wc -l) + $(find "$WWWROOT_DEST/certificates" -type f | wc -l)))"
