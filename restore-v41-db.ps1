<#
.SYNOPSIS
  Restores a V4.1 database from a backup made by backup-v41-db.ps1. This is the "undo button"
  if the migration run needs to be rolled back.

.DESCRIPTION
  Restores into a database named by -Database. That database must already exist and be empty
  (or not exist yet, in which case pass -CreateDatabase to create it first) - this script will
  NOT drop an existing populated database for you; that's a deliberate safety choice given how
  destructive it would be to get the target wrong.

.PARAMETER ArchivePath
  Path to the .dump file produced by backup-v41-db.ps1 (custom format).
.PARAMETER CreateDatabase
  If set, creates -Database first (via "createdb") before restoring into it.

.EXAMPLE
  # Restore into a fresh database to verify the backup is good, without touching the real one:
  .\restore-v41-db.ps1 -PgHost v41server -Database mahima_v41_restore_check -Username postgres -Password "..." -ArchivePath ".\migration-output\backups\mahima_v41-20260921-101500.dump" -CreateDatabase
#>
param(
    [Parameter(Mandatory = $true)][string]$PgHost,
    [int]$Port = 5432,
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(Mandatory = $true)][string]$Username,
    [Parameter(Mandatory = $true)][string]$Password,
    [Parameter(Mandatory = $true)][string]$ArchivePath,
    [switch]$CreateDatabase,
    [string]$PgBinPath
)

$pgRestore = "pg_restore"
$createDb = "createdb"
if ($PgBinPath) {
    $pgRestore = Join-Path $PgBinPath "pg_restore.exe"
    $createDb = Join-Path $PgBinPath "createdb.exe"
}
if (-not (Get-Command $pgRestore -ErrorAction SilentlyContinue)) {
    throw "pg_restore not found ($pgRestore). Install the PostgreSQL client tools, or pass -PgBinPath."
}
if (-not (Test-Path $ArchivePath)) { throw "Archive not found: $ArchivePath" }

$env:PGPASSWORD = $Password
try {
    if ($CreateDatabase) {
        Write-Output "Creating database $Database ..."
        & $createDb --host=$PgHost --port=$Port --username=$Username $Database
        if ($LASTEXITCODE -ne 0) { throw "createdb failed with exit code $LASTEXITCODE (does the database already exist?)" }
    }

    Write-Output "Restoring $ArchivePath into $Database@$PgHost`:$Port ..."
    & $pgRestore --host=$PgHost --port=$Port --username=$Username --dbname=$Database `
        --no-owner --no-privileges --jobs=4 $ArchivePath
    # pg_restore commonly exits non-zero on harmless notices (e.g. "role does not exist" for
    # ownership it skips via --no-owner) - check the output above for real errors rather than
    # treating any non-zero exit as fatal.
    Write-Output "pg_restore exit code: $LASTEXITCODE (review output above for actual errors - some warnings are expected with --no-owner)"
}
finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
