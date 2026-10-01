#!/usr/bin/env bash
# Runs on V4.1 (187.127.157.35). Extracts the incremental uploads tar additively into the same
# tenant-scoped destination used for the original Stage D extraction.
set -euo pipefail
ARCHIVE="${1:?Usage: extract-incremental.sh <path-to-uploads-incremental.tar.gz>}"
DEST="/var/www/mahima-uploads/tenants/00000000000000000000000000000001"
echo "Extracting $ARCHIVE -> $DEST (additive, --keep-old-files)"
(tar -k -xzf "$ARCHIVE" -C "$DEST" 2>&1 | grep -v "Cannot open: File exists") || true
echo "Done. Current file count: $(find "$DEST" -type f | wc -l)"
