$ErrorActionPreference = 'Stop'
$backupDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\migration-output\preflight\database-backups\v40-20260922T071525Z-iW73wJ'))
$dump = Join-Path $backupDir 'mahima_db_3_0.dump'
$checksum = Join-Path $backupDir 'SHA256SUMS'
if (-not (Test-Path -LiteralPath $dump) -or -not (Test-Path -LiteralPath $checksum)) { throw 'Verified local V4.0 backup not found' }
$match = [regex]::Match((Get-Content -LiteralPath $checksum -Raw), '(?m)^([0-9a-fA-F]{64})\s+\*?mahima_db_3_0\.dump\s*$')
if (-not $match.Success -or (Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash -ine $match.Groups[1].Value) { throw 'Source archive checksum mismatch' }
function Assert-Exit([string]$Step) { if ($LASTEXITCODE -ne 0) { throw "$Step failed. Do not blindly rerun; retain output for diagnosis." } }
$remote = 'root@187.127.157.35'
$remoteDir = '/var/backups/mahima-migration/rehearsal-sourcecopy'
& ssh $remote "install -d -o postgres -g postgres -m 0700 $remoteDir"
Assert-Exit 'Protected source-copy directory'
& scp $dump $checksum "${remote}:$remoteDir/"
Assert-Exit 'Source archive upload'
& scp (Join-Path $PSScriptRoot 'prepare-module-workspace.sh') "${remote}:/tmp/mahima-prepare-module-workspace.sh"
Assert-Exit 'Workspace helper upload'
& scp (Join-Path $PSScriptRoot 'attach-rehearsal-source.sql') "${remote}:/tmp/mahima-attach-rehearsal-source.sql"
Assert-Exit 'Source bridge SQL upload'
& ssh $remote "chown postgres:postgres $remoteDir/mahima_db_3_0.dump $remoteDir/SHA256SUMS && chmod 0600 $remoteDir/mahima_db_3_0.dump $remoteDir/SHA256SUMS && bash /tmp/mahima-prepare-module-workspace.sh"
Assert-Exit 'Module workspace preparation'
