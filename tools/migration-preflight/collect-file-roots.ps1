$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'discover-file-roots.py'
$outputDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\migration-output\preflight'))
foreach ($endpoint in @(
    @{ Version = 'v40'; Address = '187.127.132.149' },
    @{ Version = 'v41'; Address = '187.127.157.35' }
)) {
    $version = $endpoint.Version
    $address = $endpoint.Address
    & scp $scriptPath "root@${address}:/tmp/mahima-discover-file-roots.py"
    if ($LASTEXITCODE -ne 0) { throw "$version script upload failed" }
    & ssh "root@$address" "umask 077; python3 /tmp/mahima-discover-file-roots.py > /tmp/mahima-$version-file-roots.json"
    if ($LASTEXITCODE -ne 0) { throw "$version file-root discovery failed" }
    & scp "root@${address}:/tmp/mahima-$version-file-roots.json" (Join-Path $outputDir "$version-file-roots.json")
    if ($LASTEXITCODE -ne 0) { throw "$version report download failed" }
}
Write-Host 'Both file-root reports saved. No uploaded files have been copied or changed.'
