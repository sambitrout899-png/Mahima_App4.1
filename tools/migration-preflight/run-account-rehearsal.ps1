$ErrorActionPreference = 'Stop'
$remote = 'root@187.127.157.35'
& scp (Join-Path $PSScriptRoot 'rehearse-accounts.sql') "${remote}:/tmp/mahima-rehearse-accounts.sql"
if ($LASTEXITCODE -ne 0) { throw 'Account SQL upload failed' }
& ssh $remote 'sudo -u postgres psql -X -d mahima_v41_rehearsal_20260922_072500_351048 -v ON_ERROR_STOP=1 -f /tmp/mahima-rehearse-accounts.sql'
if ($LASTEXITCODE -ne 0) { throw 'Account rehearsal failed. Inspect the error before rerunning.' }
