# Creates protected database archives on each server. No restore or data import.
$ErrorActionPreference = 'Stop'
$backupScript = Join-Path $PSScriptRoot 'backup-database.sh'
if (-not (Test-Path -LiteralPath $backupScript)) { throw "Missing $backupScript" }
foreach ($endpoint in @(
    @{ Version = 'v40'; Address = '187.127.132.149' },
    @{ Version = 'v41'; Address = '187.127.157.35' }
)) {
    $version = $endpoint.Version
    $address = $endpoint.Address
    & scp $backupScript "root@${address}:/tmp/mahima-backup-database.sh"
    if ($LASTEXITCODE -ne 0) { throw "$version backup script upload failed" }
    & ssh "root@$address" "bash /tmp/mahima-backup-database.sh $version"
    if ($LASTEXITCODE -ne 0) { throw "$version backup failed; review the error before proceeding" }
}
Write-Host 'Both database backups completed. Keep both BACKUP_DIRECTORY paths for restore rehearsal.'
