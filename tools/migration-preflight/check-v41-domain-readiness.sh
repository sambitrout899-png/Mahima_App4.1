#!/usr/bin/env bash
# Read-only: check whether V4.1's nginx/TLS setup already handles the real production domain.
set -euo pipefail
echo "=== nginx server blocks mentioning mahimaministries.in ==="
grep -rl "mahimaministries.in" /etc/nginx/ 2>/dev/null || echo "(none found)"
echo ""
echo "=== nginx server_name lines (all sites) ==="
grep -rh "server_name" /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null || echo "(none found in usual locations)"
echo ""
echo "=== TLS certificates on this server (certbot) ==="
certbot certificates 2>/dev/null || echo "(certbot not available or no certs)"
echo ""
echo "=== what IP does www.mahimaministries.in currently resolve to, from this server's perspective ==="
getent hosts www.mahimaministries.in || nslookup www.mahimaministries.in || echo "(lookup failed)"
echo ""
echo "=== this server's own public IP (for comparison) ==="
curl -s -4 ifconfig.me || echo "(could not determine)"
