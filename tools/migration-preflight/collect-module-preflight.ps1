$ErrorActionPreference = 'Stop'
$outputDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\migration-output\preflight'))
function Assert-Exit([string]$Step) { if ($LASTEXITCODE -ne 0) { throw "$Step failed; stop and review the error." } }
$sourceServer = 'root@187.127.132.149'
$targetServer = 'root@187.127.157.35'
$remoteDir = '/var/backups/mahima-migration/rehearsal-input'
& scp (Join-Path $outputDir 'export-module-keys.sql') "${sourceServer}:/tmp/mahima-export-module-keys.sql"
Assert-Exit 'Source script upload'
& scp (Join-Path $outputDir 'check-module-keys.sql') "${targetServer}:/tmp/mahima-check-module-keys.sql"
Assert-Exit 'Destination script upload'
& ssh $sourceServer 'sudo -u postgres psql -X -d mahima_v40_rehearsal_20260922_072439_598910 -v ON_ERROR_STOP=1 -f /tmp/mahima-export-module-keys.sql'
Assert-Exit 'Snapshot key export'
& scp -3 "${sourceServer}:$remoteDir/module-keys.csv" "${targetServer}:$remoteDir/module-keys.csv"
Assert-Exit 'Key transfer'
& ssh $targetServer "chown postgres:postgres $remoteDir/module-keys.csv && chmod 0600 $remoteDir/module-keys.csv && sudo -u postgres psql -X -d mahima_v41_rehearsal_20260922_072500_351048 -v ON_ERROR_STOP=1 -f /tmp/mahima-check-module-keys.sql"
Assert-Exit 'Snapshot comparison'
& scp "${targetServer}:$remoteDir/module-key-report.csv" (Join-Path $outputDir 'module-key-report.csv')
Assert-Exit 'Report download'
Write-Host '55-table comparison downloaded. No application tables were modified.'
