#!/usr/bin/env bash
# Read-only: identify the V4.0 API service so we know exactly what to freeze, without stopping anything yet.
set -euo pipefail
echo "=== systemd services matching mahima ==="
systemctl list-units --type=service --all --no-legend 2>/dev/null | grep -i mahima || echo "(none found by name match)"
echo ""
echo "=== process listening on common API ports ==="
ss -ltnp 2>/dev/null | grep -E ':(5000|5001|80|443)\s' || true
echo ""
echo "=== dotnet processes ==="
ps aux | grep -i '[d]otnet\|[M]ahima.Api'
