# REHEARSAL ONLY: transfers sensitive user data directly between the two servers.
# The SQL independently refuses every database except the confirmed rehearsal DB.
$ErrorActionPreference = 'Stop'
function Assert-Exit([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed. Stop and inspect output before rerunning." }
}
$sourceServer = 'root@187.127.132.149'
$targetServer = 'root@187.127.157.35'
$remoteDir = '/var/backups/mahima-migration/rehearsal-input'
& scp (Join-Path $PSScriptRoot 'export-rehearsal-users.sql') "${sourceServer}:/tmp/mahima-export-rehearsal-users.sql"
Assert-Exit 'Export script upload'
& scp (Join-Path $PSScriptRoot 'recovery-rehearse-users.sql') "${targetServer}:/tmp/mahima-rehearse-users.sql"
Assert-Exit 'Rehearsal script upload'
& ssh $sourceServer "install -d -o postgres -g postgres -m 0700 $remoteDir"
Assert-Exit 'Source protected export directory'
& ssh $sourceServer 'sudo -u postgres psql -X -d mahima_v40_rehearsal_20260922_072439_598910 -v ON_ERROR_STOP=1 -f /tmp/mahima-export-rehearsal-users.sql'
Assert-Exit 'Source snapshot export'
& ssh $targetServer "install -d -o postgres -g postgres -m 0700 $remoteDir"
Assert-Exit 'Destination protected staging directory'
& scp -3 "${sourceServer}:$remoteDir/users.csv" "${targetServer}:$remoteDir/users.csv"
Assert-Exit 'Rehearsal data transfer'
& ssh $targetServer "chown postgres:postgres $remoteDir/users.csv && chmod 0600 $remoteDir/users.csv && sudo -u postgres psql -X -d mahima_v41_rehearsal_20260922_173119_361898 -v ON_ERROR_STOP=1 -f /tmp/mahima-rehearse-users.sql"
Assert-Exit 'User rehearsal transaction'
Write-Host 'User rehearsal finished. Production databases were not the import targets. Save the counts and code-map output.'
