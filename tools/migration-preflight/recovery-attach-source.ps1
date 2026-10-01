$ErrorActionPreference = 'Stop'
$remote = 'root@187.127.157.35'
$db = 'mahima_v41_rehearsal_20260922_173119_361898'
& scp (Join-Path $PSScriptRoot 'recovery-attach-source.sql') "${remote}:/tmp/mahima-recovery-attach-source.sql"
if ($LASTEXITCODE -ne 0) { throw 'Source bridge script upload failed' }
& ssh $remote "sudo -u postgres psql -X -d $db -v ON_ERROR_STOP=1 -f /tmp/mahima-recovery-attach-source.sql"
if ($LASTEXITCODE -ne 0) { throw 'Source bridge failed. Share output before rerunning.' }
Write-Host 'Existing source copy attached to fresh rehearsal. No application rows imported.'
