#!/usr/bin/env bash
# Read-only: determine which downloads root V4.1 actually uses.
set -euo pipefail
echo "=== systemd service env for the API process (if any) ==="
systemctl show mahima-api -p Environment 2>/dev/null || echo "(no mahima-api systemd unit, or not permitted)"
for svc in $(systemctl list-units --type=service --all --no-legend 2>/dev/null | awk '{print $1}' | grep -i mahima); do
  echo "--- $svc ---"
  systemctl show "$svc" -p Environment -p EnvironmentFile 2>/dev/null
done
echo ""
echo "=== any env file referencing MAHIMA_DOWNLOADS_ROOT / ServerFiles ==="
grep -rl "MAHIMA_DOWNLOADS_ROOT\|ServerFiles" /etc/systemd/system/ 2>/dev/null || true
grep -r "MAHIMA_DOWNLOADS_ROOT\|ServerFiles" /opt/mahima-api/appsettings*.json /var/www/mahima-api/appsettings*.json 2>/dev/null || true
echo ""
echo "=== /var/www/mahima-downloads (code default) ==="
find /var/www/mahima-downloads -type f 2>/dev/null | wc -l
du -sh /var/www/mahima-downloads 2>/dev/null
echo ""
echo "=== /var/www/mahima/downloads (unexplained alternate) ==="
find /var/www/mahima/downloads -type f 2>/dev/null | wc -l
du -sh /var/www/mahima/downloads 2>/dev/null
find /var/www/mahima/downloads -maxdepth 1 2>/dev/null
