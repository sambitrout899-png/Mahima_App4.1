$ErrorActionPreference = 'Stop'
$remote = 'root@187.127.157.35'
& scp (Join-Path $PSScriptRoot 'restore-rehearsal.sh') "${remote}:/tmp/mahima-restore-fresh-rehearsal.sh"
if ($LASTEXITCODE -ne 0) { throw 'Restore script upload failed' }
& ssh $remote 'bash /tmp/mahima-restore-fresh-rehearsal.sh v41 /var/backups/mahima-migration/v41-20260922T071618Z-Y2i0E9'
if ($LASTEXITCODE -ne 0) { throw 'Fresh restore failed. Keep output; do not replay imports.' }
Write-Host 'Save the new REHEARSAL_DATABASE name. Existing import wrappers still target the old rehearsal; do not run them.'
