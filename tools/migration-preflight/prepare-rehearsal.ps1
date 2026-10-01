# Download/verify off-server backup copies, then restore NEW databases remotely.
# Does not change live database connections, start apps, drop databases or import data into production.
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'restore-rehearsal.sh'
$localRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\migration-output\preflight\database-backups'))
if (-not (Test-Path -LiteralPath $scriptPath)) { throw "Missing $scriptPath" }
$endpoints = @(
    @{ Version = 'v40'; Address = '187.127.132.149'; Backup = '/var/backups/mahima-migration/v40-20260922T071525Z-iW73wJ' },
    @{ Version = 'v41'; Address = '187.127.157.35'; Backup = '/var/backups/mahima-migration/v41-20260922T071618Z-Y2i0E9' }
)
# Finish verification of BOTH local archives before creating any rehearsal DB.
foreach ($endpoint in $endpoints) {
    $address = $endpoint.Address
    $remoteDir = $endpoint.Backup
    $version = $endpoint.Version
    $localDir = Join-Path $localRoot (Split-Path $remoteDir -Leaf)
    New-Item -ItemType Directory -Path $localDir -Force | Out-Null
    & scp "root@${address}:$remoteDir/mahima_db_3_0.dump" "root@${address}:$remoteDir/SHA256SUMS" $localDir
    if ($LASTEXITCODE -ne 0) { throw "$version backup download failed" }
    $manifest = Get-Content -LiteralPath (Join-Path $localDir 'SHA256SUMS') -Raw
    $match = [regex]::Match($manifest, '(?m)^([0-9a-fA-F]{64})\s+\*?mahima_db_3_0\.dump\s*$')
    if (-not $match.Success) { throw "$version checksum manifest not recognized" }
    $actual = (Get-FileHash -LiteralPath (Join-Path $localDir 'mahima_db_3_0.dump') -Algorithm SHA256).Hash
    if ($actual -ine $match.Groups[1].Value) { throw "$version backup checksum mismatch" }
    Write-Host "$version local backup checksum verified: $localDir"
}
foreach ($endpoint in $endpoints) {
    $address = $endpoint.Address
    $remoteDir = $endpoint.Backup
    $version = $endpoint.Version
    & scp $scriptPath "root@${address}:/tmp/mahima-restore-rehearsal.sh"
    if ($LASTEXITCODE -ne 0) { throw "$version rehearsal script upload failed" }
    & ssh "root@$address" "bash /tmp/mahima-restore-rehearsal.sh $version $remoteDir"
    if ($LASTEXITCODE -ne 0) { throw "$version restore failed. Keep the output/database for diagnosis; do not proceed with migration." }
}
Write-Host 'Both archives downloaded and verified; both rehearsal restores completed. Save the two REHEARSAL_DATABASE names.'
