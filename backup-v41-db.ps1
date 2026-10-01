<#
.SYNOPSIS
  Takes a full backup of the V4.1 target database before the migration tool writes to it.

.DESCRIPTION
  Produces two files:
    - a pg_dump custom-format (-Fc) archive: the one to actually restore from. Compressed,
      supports parallel restore and selective table restore via pg_restore.
    - a plain .sql file: human-readable/grep-able, useful for a quick "did table X have this
      row before" check without needing pg_restore.

  Requires the PostgreSQL client tools (pg_dump) to be installed and reachable, and requires
  this machine to have network access to the V4.1 Postgres server - run it from wherever the
  migration tool itself will run, not necessarily from this dev checkout's machine.

.PARAMETER PgHost
  V4.1 Postgres host/IP.
.PARAMETER Port
  V4.1 Postgres port (default 5432).
.PARAMETER Database
  V4.1 database name.
.PARAMETER Username
  V4.1 Postgres username with read access to the whole database.
.PARAMETER Password
  V4.1 Postgres password. Passed via PGPASSWORD env var for this process only, never on the
  command line, so it won't show up in process listings or shell history.
.PARAMETER OutputDir
  Where the backup files are written. Defaults to migration-output/backups next to this script.
.PARAMETER PgBinPath
  Optional folder containing pg_dump.exe, if it's not already on PATH
  (e.g. "C:\Program Files\PostgreSQL\16\bin").

.EXAMPLE
  .\backup-v41-db.ps1 -PgHost v41server.example.com -Database mahima_v41 -Username postgres -Password "..."
#>
param(
    [Parameter(Mandatory = $true)][string]$PgHost,
    [int]$Port = 5432,
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(Mandatory = $true)][string]$Username,
    [Parameter(Mandatory = $true)][string]$Password,
    [string]$OutputDir = "$PSScriptRoot\..\migration-output\backups",
    [string]$PgBinPath
)

$pgDump = "pg_dump"
if ($PgBinPath) { $pgDump = Join-Path $PgBinPath "pg_dump.exe" }
if (-not (Get-Command $pgDump -ErrorAction SilentlyContinue)) {
    throw "pg_dump not found ($pgDump). Install the PostgreSQL client tools on this machine, or pass -PgBinPath to the folder containing pg_dump.exe."
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$customArchive = Join-Path $OutputDir "$Database-$stamp.dump"
$plainSql = Join-Path $OutputDir "$Database-$stamp.sql"

$env:PGPASSWORD = $Password
try {
    Write-Output "Backing up $Database@$PgHost`:$Port ..."

    Write-Output "  -> $customArchive (custom format, use this one to restore)"
    & $pgDump --host=$PgHost --port=$Port --username=$Username --dbname=$Database `
        --format=custom --compress=9 --file=$customArchive
    if ($LASTEXITCODE -ne 0) { throw "pg_dump (custom format) failed with exit code $LASTEXITCODE" }

    Write-Output "  -> $plainSql (plain SQL, for reference/inspection)"
    & $pgDump --host=$PgHost --port=$Port --username=$Username --dbname=$Database `
        --format=plain --file=$plainSql
    if ($LASTEXITCODE -ne 0) { throw "pg_dump (plain format) failed with exit code $LASTEXITCODE" }
}
finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}

$customSize = [math]::Round((Get-Item $customArchive).Length / 1MB, 2)
Write-Output ""
Write-Output "Done. Custom archive: $customArchive ($customSize MB)"
Write-Output "To restore: .\restore-v41-db.ps1 -PgHost $PgHost -Database <target-db> -Username $Username -Password <pw> -ArchivePath `"$customArchive`""
