$ErrorActionPreference = 'Stop'
function Assert-Exit([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed. Stop and inspect output before rerunning." }
}
$remote = 'root@187.127.157.35'
$db = 'mahima_v41_rehearsal_20260922_173119_361898'
$remoteDir = '/var/backups/mahima-migration/archive'

& scp (Join-Path $PSScriptRoot 'archive-stage-c-tables.sql') "${remote}:/tmp/mahima-archive-stage-c-tables.sql"
Assert-Exit 'Archive script upload'
& ssh $remote "install -d -o postgres -g postgres -m 0700 $remoteDir"
Assert-Exit 'Archive output directory creation'
& ssh $remote "sudo -u postgres psql -X -d $db -v ON_ERROR_STOP=1 -f /tmp/mahima-archive-stage-c-tables.sql"
Assert-Exit 'Stage C archive'

Write-Host "Archived. Downloading files to this machine..."
$localDir = Join-Path $PSScriptRoot '..\..\migration-output\preflight\archive'
New-Item -ItemType Directory -Force -Path $localDir | Out-Null
& scp "${remote}:$remoteDir/*.json.copy" $localDir
Assert-Exit 'Archive download'
Write-Host "Done. Files are in $localDir and also remain on the server at $remoteDir."
