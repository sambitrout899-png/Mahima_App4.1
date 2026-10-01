$ErrorActionPreference = 'Stop'
$outputDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\migration-output\preflight'))
$remote = 'root@187.127.157.35'
function Assert-Exit([string]$Step) { if ($LASTEXITCODE -ne 0) { throw "$Step failed; stop and review the error." } }
& scp (Join-Path $PSScriptRoot 'plan-reference-mappings.sql') "${remote}:/tmp/mahima-plan-reference-mappings.sql"
Assert-Exit 'Reference plan upload'
& ssh $remote 'sudo -u postgres psql -X -d mahima_v41_rehearsal_20260922_072500_351048 -v ON_ERROR_STOP=1 -f /tmp/mahima-plan-reference-mappings.sql'
Assert-Exit 'Reference planning'
& scp "${remote}:/var/backups/mahima-migration/rehearsal-input/reference-plan.csv" "${remote}:/var/backups/mahima-migration/rehearsal-input/reference-issues.csv" $outputDir
Assert-Exit 'Reference report download'
Write-Host 'Reference mapping reports downloaded. No application records were changed.'
