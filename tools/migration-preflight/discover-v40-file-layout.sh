#!/usr/bin/env bash
# Read-only discovery of the V4.0 file layout - no files moved or changed.
set -euo pipefail
echo "=== /var/www/mahima-uploads: top-level entries with file counts ==="
for d in /var/www/mahima-uploads/*/; do
  name=$(basename "$d")
  count=$(find "$d" -type f | wc -l)
  size=$(du -sh "$d" 2>/dev/null | cut -f1)
  echo "$name : $count files, $size"
done
echo ""
echo "=== /var/www/mahima-uploads: files directly in root (not in a subfolder) ==="
find /var/www/mahima-uploads -maxdepth 1 -type f | wc -l
echo ""
echo "=== /var/www/mahima-downloads: top-level entries with file counts ==="
for d in /var/www/mahima-downloads/*/; do
  name=$(basename "$d")
  count=$(find "$d" -type f | wc -l)
  size=$(du -sh "$d" 2>/dev/null | cut -f1)
  echo "$name : $count files, $size"
done
find /var/www/mahima-downloads -maxdepth 1 -type f | wc -l
echo ""
echo "=== /var/www/mahima-api/wwwroot: top-level entries with file counts ==="
for d in /var/www/mahima-api/wwwroot/*/; do
  name=$(basename "$d")
  count=$(find "$d" -type f | wc -l)
  size=$(du -sh "$d" 2>/dev/null | cut -f1)
  echo "$name : $count files, $size"
done
find /var/www/mahima-api/wwwroot -maxdepth 1 -type f 2>/dev/null | wc -l
echo ""
echo "=== looking specifically for pastor-voice / demo-captures / tenant-logos anywhere under these roots ==="
find /var/www/mahima-uploads /var/www/mahima-downloads /var/www/mahima-api/wwwroot \
  \( -iname "*pastor-voice*" -o -iname "*demo-captures*" -o -iname "*tenant-logos*" \) 2>/dev/null | head -50
