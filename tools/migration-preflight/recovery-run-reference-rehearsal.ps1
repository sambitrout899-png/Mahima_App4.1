$ErrorActionPreference = 'Stop'
$remote = 'root@187.127.157.35'
# Each stage commits separately and has its own rerun guard. Stop on any error.
foreach ($stage in @('recovery-rehearse-accounts','recovery-rehearse-teams-positions')) {
    & scp (Join-Path $PSScriptRoot "$stage.sql") "${remote}:/tmp/mahima-$stage.sql"
    if ($LASTEXITCODE -ne 0) { throw "$stage upload failed" }
    & ssh $remote "sudo -u postgres psql -X -d mahima_v41_rehearsal_20260922_173119_361898 -v ON_ERROR_STOP=1 -f /tmp/mahima-$stage.sql"
    if ($LASTEXITCODE -ne 0) { throw "$stage failed. Earlier stages may already be committed; share output before rerunning." }
}
