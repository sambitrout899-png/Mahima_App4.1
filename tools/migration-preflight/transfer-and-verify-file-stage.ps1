<#
Transfers the 3 staged tar.gz archives from V4.0 to V4.1 via scp -3 (relayed through this
machine, no direct trust needed between the two Linux servers), then verifies each one's
sha256 on the V4.1 side against the checksum recorded when it was created on V4.0. Nothing
is extracted - this only moves the archives into a staging directory on V4.1.
#>
$ErrorActionPreference = 'Stop'
function Assert-Exit([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed. Stop and inspect output before rerunning." }
}

$source = 'root@187.127.132.149'
$target = 'root@187.127.157.35'
$sourceStageDir = '/var/backups/mahima-migration/file-stage-20260922200328'
$targetStageDir = '/var/backups/mahima-migration/file-stage-incoming'

$expected = @{
    'uploads.tar.gz'      = 'ad086649cdcd3bf50a10144ff53a065f3a5f76d7192d743e2be48401d92bc0a0'
    'downloads.tar.gz'    = 'e0830b12acd9d4757dc86cd5d4ffe6f8ad69a7df338a353f9eb6f8189e5f948b'
    'wwwroot-flat.tar.gz' = 'c4aadd8b5ee279cd97eaae6ed86b179c46d2f958a9010ab34ec7c54b15613f84'
}

& ssh $target "mkdir -p $targetStageDir"
Assert-Exit 'Target staging directory creation'

foreach ($file in $expected.Keys) {
    Write-Host "Transferring $file ..."
    & scp -3 "${source}:$sourceStageDir/$file" "${target}:$targetStageDir/$file"
    Assert-Exit "Transfer of $file"
}

Write-Host "Verifying checksums on V4.1..."
foreach ($file in $expected.Keys) {
    $actual = (& ssh $target "sha256sum $targetStageDir/$file") -split '\s+' | Select-Object -First 1
    Assert-Exit "sha256sum of $file"
    if ($actual -ne $expected[$file]) {
        throw "CHECKSUM MISMATCH for $file`: expected $($expected[$file]), got $actual. Do not extract - re-transfer this file."
    }
    Write-Host "  $file OK ($actual)"
}
Write-Host "All 3 archives transferred and verified. Nothing has been extracted yet."
