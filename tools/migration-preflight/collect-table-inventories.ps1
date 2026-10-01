# Run from Windows PowerShell. Prompts for SSH passwords as needed.
# Uploads count-only scripts, runs them, and downloads their CSV results.
$ErrorActionPreference = 'Stop'
$outputDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\migration-output\preflight'))
foreach ($endpoint in @(
    @{ Version = 'v40'; Address = '187.127.132.149' },
    @{ Version = 'v41'; Address = '187.127.157.35' }
)) {
    $version = $endpoint.Version
    $address = $endpoint.Address
    $localScript = Join-Path $outputDir "inventory-$version.sql"
    if (-not (Test-Path -LiteralPath $localScript)) { throw "Missing generated script: $localScript" }
    $remoteScript = "/tmp/mahima-inventory-$version.sql"
    Write-Host "Collecting $version counts from $address (no application writes)..."
    & scp $localScript "root@${address}:$remoteScript"
    if ($LASTEXITCODE -ne 0) { throw "$version script upload failed" }
    & ssh "root@$address" "sudo -u postgres psql -X -d mahima_db_3_0 -v ON_ERROR_STOP=1 -f $remoteScript"
    if ($LASTEXITCODE -ne 0) { throw "$version count query failed; do not use a partial CSV" }
    & scp "root@${address}:/tmp/mahima-$version-table-inventory.csv" (Join-Path $outputDir "$version-table-inventory.csv")
    if ($LASTEXITCODE -ne 0) { throw "$version CSV download failed" }
}
Write-Host "Both inventories saved to $outputDir"
