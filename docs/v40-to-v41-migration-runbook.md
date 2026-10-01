# V4.0 on-premises to V4.1 multitenant migration

Prepared from the local source code on 2026-09-22. This is an execution plan, not a record of a completed migration. No production connections, exports, imports or file copies were executed while preparing it.

**Live-schema review update:** the user subsequently supplied production schema exports. Read `docs/v40-v41-live-schema-readiness.md` before the execution sections below. The current importer is not ready for cutover: eight tables and 13 fields lack destinations, task assignments require transformation, `TenantId` detection is defective, identity sequences are not handled, and the target export lacks the current checkout's tenant-storage schema. The commands below remain conditional rehearsal/cutover steps, not approval to run the uncorrected importer.

## Confirmed and outstanding values

| Item | Value |
|---|---|
| V4.0 source SSH host | `187.127.132.149` (confirmed by user) |
| Source database | `mahima_db_3_0` (confirmed by user's live queries) |
| Source PostgreSQL through the open tunnel | `127.0.0.1:15432` on the PC running SSH |
| Migration project | `D:\Mahima Api\Mahima_App_V4.0\migration\MahimaDataMigrator` |
| Migration scripts | `D:\Mahima Api\Mahima_App_V4.0\migration\scripts` |
| V4.1 SSH server | `187.127.157.35` (confirmed by user) |
| V4.1 database | `mahima_db_3_0` exists on the destination, confirmed by the user's psql output; tenant/schema and deployed API connection still to verify |
| Destination tenant | `mahima-root` exists as active Mahima Ministry, UUID `00000000-0000-0000-0000-000000000001`, confirmed by user's live query; user must still confirm it is the intended owner of imported data |
| Existing destination tenants | User's live query returned 12 tenants: root plus 11 non-root (10 active, 1 expired). Preserve all existing tenant data. |
| Existing destination users | User's grouped query returned 122 users: 81 in Mahima Root and 41 across 9 other tenants. No NULL tenant group appeared. Two registered tenants had no users in this result. Actual application activity remains unverified. |
| Source users | User's source query returned 120 users. Supplied users schema has UUID `id` and no tenant column. |
| Verified user-ID overlap | User's temporary-table comparison returned 40 source IDs absent from V4.1, 80 matching Mahima Root IDs, and 0 matching other/unassigned tenant IDs. Given the earlier 81 root users, one destination root ID is absent from the source. Content differences and non-PK unique-key conflicts remain unverified. |
| Verified user fingerprint comparison | User's UTC/ISO comparison across source column names returned 80 matching root IDs, 0 identical records and 80 differing records. At least one source-field representation differs in every matching record. Field-level differences, type differences and which deployment owns each field still need review; this does not authorize overwriting those users. |
| Verified field comparison | Source export has 28 fields including `isdeleted`, absent from all 80 target representations. This missing field alone explains the all-80 fingerprint mismatch; the number of users with shared-field differences is not established. Shared differences include joindate 34, passwordhash 24, IsBeliever 23, IsBaptized/IsBornAgain 21 each, IsPastor 19, phone 18, displayname 15, username 13, email 11, role 7, profilephotourl 5, payrollenabled 1. ID, UserCode, cognitosub and lastlogin matched in all 80. |
| Source deletion counts | User's source query returned 89 `isdeleted=false` and 31 `isdeleted=true`, no NULL group. Overlap with destination IDs still to check. |
| Target user indexes | User's live output shows global unique `UserCode`, primary key `id`, and global unique normalized nonblank phone. Tenant/email and tenant/username indexes are NON-unique. Phone normalization strips nondigits, then takes the last 10 digits when length >10 and the digits start with `91`. |
| Verified deletion/ID breakdown | 89 non-deleted source users: 26 absent from destination, 63 matching root. 31 deleted source users: 14 absent, 17 matching root. None match another/unassigned tenant by ID. |
| Verified user-key preflight | Zero duplicate source UserCode or normalized-phone groups. One new, non-deleted source user's UserCode matches a DIFFERENT ID in another/unassigned tenant. Two non-deleted source users whose IDs already exist have normalized phones held by different root IDs. Conflict identities and final-state resolution remain pending. |
| Verified UserCode conflict identity | Source `a714a3ed-124b-4c7a-b26c-eb997b66f828` conflicts with destination `aa8a88ce-b161-4892-a57b-aa0793240f14` in tenant `02c9cecf-f13f-4e85-8a13-c18368a3108f` (Anjali Sidhu Ministries). Preserve the destination record/code. A new code for the imported user and any source code-based references requires a checked mapping. |
| Verified phone-owner transitions | Source user `4c3a4267-bb28-4122-b74f-0e96bbfea9cb` requests a phone currently held by root user `45a563b5-901c-49a2-8402-bff6dc4e06e6`; source user `88f2f629-3a9c-484e-a63b-cab36486152d` requests one held by root user `6d8b45e5-6f3e-4e64-ad75-25b135331602`. Both current owners exist in source, are source-deleted and have different source phone fingerprints. Reciprocal-swap results are NULL, not proven swaps. A source-authoritative update may resolve the current conflicts; exact values, final-state uniqueness, update order and application deletion handling must be validated first. |
| Live upload/download/webroot paths | Must be discovered on both deployments |

Deletion-state preservation is a concrete unresolved mapping, not just a hypothetical source-only field. Local UsersController code in both versions conditionally filters `isdeleted` when present, and supports setting it during soft deletion. V4.1's User model has no corresponding property. Check source deleted counts, target schema and every relevant authentication/read path before adopting a deletion mapping; merely adding a column does not prove login exclusion. Do not discard deleted users without reconciling their dependent history, or copy them as active users. Password and role differences require an explicit source-of-truth policy before updates. Preserve destination-only tenant/MFA fields unless a separately reviewed requirement changes them.

The 81 pre-existing root users make content-aware conflict review mandatory: do not assume these are disposable seed data or already-current copies of V4.0 users. Compare keys, values and relationships before deciding which records to insert, preserve or update. The existing importer cannot apply source updates to matching primary keys.

Prepared `tools/migration-preflight/export-user-keys.sql` and `check-user-keys.sql` to check deletion overlap, source duplicate UserCodes/normalized phones, and source keys occupied by other destination IDs. They use fingerprints rather than raw phone/UserCode values; fingerprints remain sensitive audit material. Target writes are temporary and rolled back. User executed sections A-E against the live databases and provided the results above. A fingerprint match is a candidate conflict to resolve with exact values securely before mutation, not authorization to change another tenant or remove an index. These checks cover user keys only, not all migration tables or application-level login ambiguity.

The current generic importer is blocked for a faithful full merge: at least one new user would violate global UserCode uniqueness, existing users would be skipped, and deletion flags would be dropped. Preserve the other tenant's code and plan a reviewed source-user code mapping after checking code-based references. Inspect phone-owner transitions before selecting an atomic update strategy; current conflicts may be a swap or another reassignment, and nondeferrable uniqueness can fail on intermediate updates even when a final state would be valid. Do not remove global indexes to force the migration through. Preserve historical relationships for all 31 soft-deleted users while ensuring the application enforces their intended deleted state.

The database tunnel carries PostgreSQL traffic only. File transfer needs SSH/SFTP/rsync or mounted shares separately. Commands below labelled PowerShell run on the PC with the tunnel. A remote SSH shell cannot use the PC's `localhost:15432`.

## What is ready, and what must be resolved

The C# .NET 8 tool has `plan`, `generate`, `archive`, `migrate` and `verify` modes. It reads public-table schemas, copies shared columns, fills target-only tenant columns, loads tables using FK dependencies and emits per-table reports. Backup/restore and file-copy scripts exist. The current PC has a .NET 8 SDK; `psql` was not found on PATH or under the usual PostgreSQL installation path. The migrator has not been built or exercised against the live databases in this review.

Do not interpret the existing README's 'safe to re-run' as proof of a complete merge:

1. A matching primary key is skipped without comparing content or tenant. Updated V4.0 records will not overwrite stale V4.1 copies. ID collisions with another tenant require explicit ID/FK remapping, which this tool does not implement.
2. Tenant IDs are filled only when the tenant column does not exist in the source. Existing source tenant values, including NULL, are copied unchanged. The settings loader does not check that the configured tenant exists or reject the all-zero GUID.
3. `verify` checks primary-key existence, not values, tenant ownership, relationships or files. It cannot prove a lossless migration.
4. Source-only tables are archived, not made usable in V4.1. The README identifies `accounting_data_snapshots` and `chicken_sale_*`; live `plan` must establish the actual list. Source-only columns of shared tables are dropped by the importer and are not preserved by the source-only-table archive mode. Keep a full source backup. If all old functionality/data must remain usable, implement mappings/modules for these before cutover.
5. `roles`, `pages`, `app_languages` and `role_permissions` are skipped by default. Compare IDs AND meaning. Removing a skip is not a substitute for mapping incompatible IDs or respecting V4.1 permissions.
6. Only the `public` schema is enumerated. Inventory other schemas, PostgreSQL large objects and external storage separately.
7. FK cycles are appended in name order, not solved; tables without a shared PK have no deduplication. Additional unique constraints, identity/generated columns and changed types require rehearsal. Serial sequence reset also needs checking, especially quoted mixed-case tables.
8. Each table commits independently and the direct migration loop continues after table failures. A failed overall run can leave earlier tables committed.
9. The restore helper prints a nonzero `pg_restore` status without failing. Treat any nonzero status as a failed restore until diagnosed; use the strict command below for rehearsal.
10. The file-copy README is outdated: current V4.1 uses tenant-specific upload and Server Files directories. The Windows script lacks `/XC`, so its 'never overwrite' claim must not be relied on for same-time/different-size files. Linux `--ignore-existing` also leaves differing destination files unresolved.

## 1. Establish clients and the two database connections

Keep the existing source tunnel open. Only if it is closed, start it in a separate PowerShell window (use the actual SSH username):

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:15432:127.0.0.1:5432 root@187.127.132.149
```

Install PostgreSQL client tools on the PC if absent, or run the workflow from a machine with the tools and access to both databases. Use a `pg_dump` version that supports both servers; an older major version cannot dump a newer server. Do not copy just `psql.exe` without its dependencies.

```powershell
Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue
$PgBin = Read-Host 'Full directory containing psql.exe, pg_dump.exe, pg_restore.exe and createdb.exe'
$Psql = Join-Path $PgBin 'psql.exe'
$PgDump = Join-Path $PgBin 'pg_dump.exe'
$PgRestore = Join-Path $PgBin 'pg_restore.exe'
$CreateDb = Join-Path $PgBin 'createdb.exe'
foreach ($tool in @($Psql, $PgDump, $PgRestore, $CreateDb)) {
    if (-not (Test-Path -LiteralPath $tool)) { throw "Missing tool: $tool" }
}
& $Psql -X -W -h 127.0.0.1 -p 15432 -U postgres -d mahima_db_3_0 -v ON_ERROR_STOP=1 -c 'SELECT current_database(), inet_server_addr(), inet_server_port(), version(); SELECT count(*) AS source_users FROM public.users;'
if ($LASTEXITCODE -ne 0) { throw 'Source connection/query failed' }
```

`-W` prompts for the PostgreSQL password. `inet_server_port()` will normally show 5432 behind the tunnel, not the PC's 15432.

Open the destination tunnel in a second PowerShell window. This assumes PostgreSQL is listening on the destination server's loopback port 5432; use the actual SSH username if it is not root:

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:25432:127.0.0.1:5432 root@187.127.157.35
```

In the working PowerShell window, list destination databases before selecting one:

```powershell
& $Psql -X -W -h 127.0.0.1 -p 25432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname;'
if ($LASTEXITCODE -ne 0) { throw 'Destination database discovery failed' }
```

If the Windows PostgreSQL clients are still unavailable, this read-only discovery can instead run through SSH, provided the destination uses a local `postgres` OS account and has psql installed:

```powershell
ssh root@187.127.157.35
```

Then in that remote Linux shell:

```bash
sudo -u postgres psql -X -d postgres -v ON_ERROR_STOP=1 -c 'SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname;'
```

Confirm which listed database the deployed V4.1 API actually uses; listing a name alone does not establish that.

```powershell
$TargetHost = Read-Host 'Confirmed V4.1 PostgreSQL endpoint reachable from this PC (127.0.0.1 if separately tunneled)'
$TargetPort = [int](Read-Host 'V4.1 connection port (25432 if using the separate example tunnel)')
$TargetDb = Read-Host 'Confirmed V4.1 database name'
$TargetUser = Read-Host 'V4.1 PostgreSQL migration username'
& $Psql -X -W -h $TargetHost -p $TargetPort -U $TargetUser -d $TargetDb -v ON_ERROR_STOP=1 -c "SELECT current_database(), inet_server_addr(), inet_server_port(), version(); SELECT id, name, slug, is_root_tenant FROM public.tenants WHERE slug = 'mahima-root';"
if ($LASTEXITCODE -ne 0) { throw 'Target identity/tenant check failed' }
```

Check exactly one intended tenant exists. Confirm source and target are different databases/deployments. Do not create a new root tenant or substitute a guessed UUID.

## 2. Back up both databases and all file roots

Before rehearsal, capture both database backups. Before the final cutover, pause V4.0 writes/uploads/jobs, pause affected destination writers and repeat backups with a new timestamp. Keep V4.0 frozen until the decision to cut over or roll back. Per-table reads are not a single consistent source snapshot while writers continue.

```powershell
$RunRoot = Join-Path 'D:\Mahima Api\Mahima_App_V4.1\migration-output' (Get-Date -Format 'yyyyMMdd-HHmmss')
New-Item -ItemType Directory -Path $RunRoot -Force | Out-Null
$SourceDump = Join-Path $RunRoot 'v40-source.dump'
$TargetDump = Join-Path $RunRoot 'v41-before.dump'
& $PgDump -W -h 127.0.0.1 -p 15432 -U postgres -d mahima_db_3_0 -Fc -f $SourceDump
if ($LASTEXITCODE -ne 0) { throw 'Source backup failed' }
& $PgDump -W -h $TargetHost -p $TargetPort -U $TargetUser -d $TargetDb -Fc -f $TargetDump
if ($LASTEXITCODE -ne 0) { throw 'Target backup failed' }
& $PgRestore --list $SourceDump | Out-File (Join-Path $RunRoot 'source-backup-contents.txt')
if ($LASTEXITCODE -ne 0) { throw 'Cannot read source archive' }
& $PgRestore --list $TargetDump | Out-File (Join-Path $RunRoot 'target-backup-contents.txt')
if ($LASTEXITCODE -ne 0) { throw 'Cannot read target archive' }
Get-FileHash $SourceDump, $TargetDump -Algorithm SHA256 | Export-Csv (Join-Path $RunRoot 'backup-hashes.csv') -NoTypeInformation
```

An archive listing is not a restore test. Restore each backup into a separate empty rehearsal database. Example for V4.1, on an approved rehearsal endpoint with sufficient disk space:

```powershell
$RehearsalHost = Read-Host 'Rehearsal PostgreSQL host reachable from this PC'
$RehearsalPort = [int](Read-Host 'Rehearsal PostgreSQL port')
$RehearsalUser = Read-Host 'Rehearsal PostgreSQL username'
$RehearsalDb = 'mahima_v41_rehearsal_' + (Get-Date -Format 'yyyyMMddHHmmss')
& $CreateDb -W -h $RehearsalHost -p $RehearsalPort -U $RehearsalUser $RehearsalDb
if ($LASTEXITCODE -ne 0) { throw 'Rehearsal database creation failed' }
& $PgRestore -W -h $RehearsalHost -p $RehearsalPort -U $RehearsalUser -d $RehearsalDb --no-owner --no-privileges --exit-on-error $TargetDump
if ($LASTEXITCODE -ne 0) { throw 'Rehearsal restore failed' }
```

Repeat with the source dump and a distinct V4.0 rehearsal name. Production ACLs/owners must be preserved or reapplied for a real rollback; the rehearsal flags deliberately omit them.

Also snapshot/back up source AND destination configured uploads, legacy webroot uploads, Server Files/downloads, voice samples, demo captures and any additional generated/external assets identified by inventory. Save relative-path, byte-size and SHA-256 manifests. A PostgreSQL dump does not contain ordinary filesystem uploads. Inventory service/environment overrides without exposing credentials in logs.

## 3. Build and prepare the migration plan against rehearsal databases

```powershell
Set-Location 'D:\Mahima Api\Mahima_App_V4.0\migration\MahimaDataMigrator'
dotnet build
if ($LASTEXITCODE -ne 0) { throw 'Migrator build failed' }
$SettingsPath = Join-Path $RunRoot 'migration.rehearsal.settings.json'
Copy-Item -LiteralPath '.\migration.settings.example.json' -Destination $SettingsPath
notepad $SettingsPath
```

In that JSON, set:

- `SourceConnectionString`: the restored V4.0 rehearsal database (for final cutover: `Host=127.0.0.1;Port=15432;Database=mahima_db_3_0;Username=postgres;Password=...`).
- `TargetConnectionString`: the restored V4.1 rehearsal database, never production for the first run.
- `RootTenantId`: the verified intended V4.1 tenant UUID.
- `ArchiveDirectory`, `ReportDirectory`, `GeneratedScriptsDirectory`: distinct absolute directories under this run's `$RunRoot`; forward slashes are easiest in JSON paths.
- `SkipTables`: start with the example, then resolve lookup mappings from actual data before changing it.

Use proper Npgsql connection-string quoting for passwords containing delimiters and JSON escaping for backslashes/quotes. Store this credential-bearing file securely; do not commit or share it. No passwords belong in plan/report messages.

```powershell
dotnet run --no-build -- plan --settings $SettingsPath
if ($LASTEXITCODE -ne 0) { throw 'Plan failed' }
dotnet run --no-build -- generate --settings $SettingsPath
if ($LASTEXITCODE -ne 0) { throw 'Script generation failed' }
```

These commands do not write production rows. Review every dropped column, archive-only table, tenant column, skipped lookup, defaulted required field, key collision and FK dependency. Check that the target schema matches its deployed API, including `20260918_tenant_storage.sql` when using the current storage-enabled API. Do not indiscriminately run every SQL file: the folder also contains operational/data-change scripts.

Before import, compare every overlapping key's content and tenant. If different rows share an ID, stop and implement a reviewed mapping or merge. Review usernames/emails and other unique keys too. A zero-error plan is schema inspection only; it does not perform these checks.

## 4. Rehearse the database transfer

The direct tool uses Npgsql and does not require local `psql` for transfer, but PostgreSQL clients are still needed for the backup/restore workflow above. This avoids the generated runbook's Bash-vs-PowerShell confusion.

```powershell
dotnet run --no-build -- archive --settings $SettingsPath
if ($LASTEXITCODE -ne 0) { throw 'Archive failed' }
dotnet run --no-build -- migrate --settings $SettingsPath
if ($LASTEXITCODE -ne 0) { throw 'Migration has failures; inspect the per-table report before proceeding' }
dotnet run --no-build -- verify --settings $SettingsPath
if ($LASTEXITCODE -ne 0) { throw 'Key-existence verification failed' }
```

Do not mix direct import with manual import as separate attempts to fix an unexplained discrepancy. For the manual route, use the generated filenames, work from the generated folder, copy each `export/*.copy` into `import/`, and invoke every psql script with `-X -v ON_ERROR_STOP=1`. Do not assume `users` will have sequence number 010.

Inspect reports even when the exit code is zero. Reconcile source/staged/inserted counts and explain every skipped duplicate. Compare copied field values by source key, tenant IDs, parent ownership, accounting totals, attachments and module totals. Verify sequences with a test insert in rehearsal. Test existing non-root tenants for unchanged data/access. Archive-only records are preserved evidence, not completed application migration.

## 5. Rehearse files with a path mapping

Discover live values from `Uploads:Root` / `MAHIMA_UPLOADS_ROOT`, `ServerFiles:Root` / `MAHIMA_DOWNLOADS_ROOT`, the deployed webroot, service environment and reverse-proxy mappings. `/var/www/mahima-uploads` and `/var/www/mahima-downloads` are code defaults, not confirmed production paths.

Let `TENANT_N` be the confirmed destination UUID with hyphens removed.

| V4.0 data | Current V4.1 destination behavior |
|---|---|
| Generic uploaded media | New uploads use `UPLOAD_ROOT/tenants/TENANT_N/...`. Existing relative `/api/uploads/...` URLs can be preserved by retaining their relative paths under the served upload root, but shared legacy paths are outside tenant file metering. For full tenant ownership, copy into the tenant path AND update each database URL/reference through a reviewed mapping. |
| Server Files | V4.0 serves the configured download root directly; V4.1 serves `DOWNLOAD_ROOT/tenants/TENANT_N/`. Copy the old tree's contents into that tenant subdirectory, not just into the download root. |
| Tenant logos | Current meter scans `UPLOAD_ROOT/tenant-logos/TENANT_SLUG`; map old branding and references explicitly. |
| Pastor voice | Assign ownership and copy/map into `WEBROOT/uploads/pastor-voice/TENANT_N/`; review references or re-upload. |
| Demo captures | Assign ownership and copy/map into `WEBROOT/demo-captures/TENANT_N/`; review references. |
| Other files/external storage | Inventory independently; upload sync does not cover every application artifact or external provider. |

Inventory absolute URLs pointing to the old domain/IP, relative paths and embedded JSON references. Copying bytes does not update these. Do not run a global text replacement against every database column.

Use a staged copy and a manifest first. Compare same-path files by SHA-256; resolve differing-content collisions before import/cutover. Preserve the resolved relative structure and ensure the API service account can read/write the destination. The supplied `sync-files.sh` is usable for an approved Linux root-to-root mapping after collision review; it does not implement URL rewriting or tenant mapping. The supplied Windows helper needs correction/review before treating it as no-overwrite. Confirm zero missing/hash-mismatched expected files and open representative photos, documents, chat attachments, certificates and Server Files in the rehearsal app.

## 6. Final cutover after rehearsal passes

1. Confirm the destination server, database, intended tenant, schema version and file path map; resolve every issue above. Confirm how source-only modules will be handled to satisfy the requested scope.
2. Freeze V4.0 writers, uploads, scheduled jobs and integrations. Pause destination writers as required for a consistent backup and merge. Take fresh database/file backups and manifests.
3. Create a separate final settings file pointing to the frozen source tunnel and the confirmed production destination. Review endpoint identity and tenant UUID again. Generate a fresh plan; stop if the schemas or decisions differ from rehearsal.
4. Archive and migrate using the rehearsed procedure. Any failure leaves traffic paused and triggers diagnosis/rollback, not automatic cutover.
5. Apply the rehearsed file copies and scoped URL mappings. Keep a ledger of newly created files and pre-images of any modified destination data/files.
6. Run key verification plus content, tenant, FK, module, financial and file-hash reconciliation. Start the API with public traffic still paused and confirm storage reconciliation completes (`tenant_storage_usage.files_measured_at`), then test login/roles, users, attendance, accounting, chats, attachments and affected modules. Check another tenant remains isolated.
7. Switch users/integrations to V4.1 only after these checks pass. Keep V4.0 read-only and retain source backups, archives, manifests, generated SQL and reports. Do not decommission it while any archive-only data still needs an application home.

## Rollback

Keep both sides paused while deciding. Before new V4.1 writes are admitted, rollback can use the consistent pre-migration destination database/file backup or a separately restored database and controlled connection switch. Do not restore a V4.0 dump over the populated shared V4.1 database. Do not rely on deleting rows by tenant: pre-existing tenant records and skipped conflicts make that unsafe.

A whole V4.1 database restore affects every tenant. If unrelated tenants continued writing after the backup, restoring it would lose their new data; that requires a separate reconciled recovery plan. After accepting new writes in V4.1, returning users to V4.0 also requires reconciling those writes. This tool has no reverse-sync function.
