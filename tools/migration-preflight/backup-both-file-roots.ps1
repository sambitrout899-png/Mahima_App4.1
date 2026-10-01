$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'backup-files.py'
$outputDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\migration-output\preflight'))
foreach ($endpoint in @(
    @{ Version = 'v40'; Address = '187.127.132.149' },
    @{ Version = 'v41'; Address = '187.127.157.35' }
)) {
    $version = $endpoint.Version
    $address = $endpoint.Address
    & scp $scriptPath "root@${address}:/tmp/mahima-backup-files.py"
    if ($LASTEXITCODE -ne 0) { throw "$version script upload failed" }
    & ssh "root@$address" "python3 /tmp/mahima-backup-files.py $version"
    if ($LASTEXITCODE -ne 0) { throw "$version file backup failed. Review output; do not treat a partial archive as complete." }
    & scp "root@${address}:/tmp/mahima-$version-file-backup-summary.json" (Join-Path $outputDir "$version-file-backup-summary.json")
    if ($LASTEXITCODE -ne 0) { throw "$version backup summary download failed" }
}
Write-Host 'Both file archives created on their servers; summaries downloaded. Archives still need independent copies and restore verification.'
