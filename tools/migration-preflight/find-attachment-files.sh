#!/usr/bin/env bash
# Read-only: locate the 3 files referenced by Attachments.S3Key, wherever they actually live.
set -euo pipefail
for f in 451356472b2b40808226e6999b4310bb.jpeg ebdcacb9161d44279e2344b61e9f7a7a.jpeg 28660f91127147f59d8ba126b3069836.jpeg; do
  echo "=== $f ==="
  find /var/www/mahima-uploads /var/www/mahima-downloads /var/www/mahima-api/wwwroot -iname "$f" 2>/dev/null
  echo ""
done
