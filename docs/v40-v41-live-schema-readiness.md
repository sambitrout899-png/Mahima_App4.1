# Migration readiness from live schema exports

Reviewed 2026-09-22. Source: `187.127.132.149`; destination: `187.127.157.35`; both databases: `mahima_db_3_0`. Exports were supplied by the user and inspected locally. No production import, application change or file migration has been executed.

## Recorded backup progress

### Accepted user merge policy and prepared rehearsal

### Remaining-module comparison received

**Reference plans collected:** 62 source references, 129 existing destination references, zero reported missing/ambiguous parent mappings or team-lead ownership issues. Accounts: 31 identical root matches and 17 new IDs. Teams: two identical root matches, two same-ID/root-name matches differing only in LeadUserId, one Finance Team needing a new ID, and two distinct source teams (IDs 11 and 12) both literally named `'` with no root name match and IDs occupied by other tenants. Preserve those last two as distinct rows with distinct new IDs; do not deduplicate by their label. Positions: five new IDs; Member maps 1->1 and Call Center Manager maps 63->2, with differing parent_position_id and timestamps.

**Additional policy explicitly accepted:** user selected “Use V4.0 leaders and hierarchy” for Night Prayer, Mahima staff team, Member and Call Center Manager. Preserve before-images and other tenants. No further permission is needed for those choices in rehearsal.

Prepared `run-reference-rehearsal.ps1`: first `rehearse-accounts.sql` inserts 17 accounts/reuses 31 identical root records; second `rehearse-teams-positions.sql` inserts three separate teams and five positions, applies accepted root leader/hierarchy values, and persists source-to-target maps in `migration_v40`. Each stage is guarded to the exact rehearsal database, has a one-time execution guard, preserves before-images and verifies unaffected rows. They commit separately; if the second fails, the first can already be committed, so do not rerun the whole wrapper without reviewing output. Sequence handling uses transactional ALTER SEQUENCE RESTART and does not move generators backwards. Expected account totals: 104 (48 root / 56 other); teams: 16 (7 root / 9 other); positions: 34 (12 root / 22 other). Memberships, user_positions, task assignments and journals are not part of this stage and must consume these mappings later.

Isolated PGlite tests passed account database/rerun guards, inserts/reuse, unchanged pre-existing accounts, monotonic identity restart, and rollback on unexpected root account differences; team/position tests passed distinct duplicate-label team preservation, other-row preservation, mapped position parents, leader updates, sequence reset, rerun rejection and full rollback on hierarchy cycles. Actual reference rehearsal execution remains pending.

**Source bridge successfully created:** user reported committed postgres_fdw setup inside `mahima_v41_rehearsal_20260922_072500_351048`, reading `mahima_v40_sourcecopy_20260922` through `migration_source`. Verification returned 162 rehearsed destination users and 120 backed-up source users. Source restore default transactions are read-only and the foreign server is non-updatable. No application module merge has occurred.

Prepared `collect-reference-plan.ps1` / `plan-reference-mappings.sql` for the 48 source accounts, 7 positions and 7 teams. This is a temporary-table-only planning pass: candidates are matched by case-insensitive name ONLY within root; multiple name matches are marked ambiguous, occupied IDs without a root name match get proposed IDs above the maximum source/target ID, identical root rows are distinguished from differing fields, and position parents are compared after proposed remapping. A name match alone is not approval to merge. It reports missing/ambiguous parent mappings, missing/non-root team leads and many-to-one mapping candidates. It does not insert/update application tables or reserve sequence values. Proposed IDs must be revalidated/locked during eventual writes. Isolated PGlite tests passed root-only matching, cross-tenant ID remapping, different-field reporting, parent remapping, ambiguous names, missing lead users and rollback/no application writes. Actual reference report collection is pending.

User completed the 55-table rehearsal comparison; downloaded `module-key-report.csv` has 55 result rows. It compares 210347 source rows with 98016 target rows in those shared tables. Source results: 116832 new keys, 1851 matching keys with equal shared-field fingerprints, 91664 matching keys with differing shared-field fingerprints. These counts do not prescribe inserts/updates: parent remapping, business keys, omitted columns and source/target type differences still matter.

Nine directly scoped tables have 439 source keys occupied by a non-root or unassigned destination record: AttendanceRecords 28, AuditLogs 70, Sermons 1, Teams 3, Timesheets 8, daily_page_visits 277, prayerrequests 2, security_events 49, staff_payroll_settings 1. The target inventory had no direct NULL tenant rows, so these are evidence of cross-tenant ID reuse in the collected snapshots. Never overwrite those records or merely change their tenant. Remap imported IDs and all dependent/embedded references. Another 495 matching keys have no direct tenant column and require parent/relationship ownership checks.

Examples: all seven source team IDs already exist (four root, three other tenants); 31 account IDs have matching shared fields in root and 17 source account IDs are new; all 71 source task IDs and all 80 source TaskAssignees composite keys are new. These facts are not sufficient to skip business-key and parent-mapping checks. AuditLogs has 85980 matching keys with different content; do not treat these as mutable records to overwrite just because many belong to root. Preserve distinct event history using a reviewed deduplication/remapping rule. Global pages/roles/permissions also differ and must not be blanket overwritten.

Prepared `prepare-module-workspace.ps1` to copy the already SHA-256-verified V4.0 database archive to the destination server, restore it into a NEW `mahima_v40_sourcecopy_20260922` database, set that database's default transactions to read-only, and expose its public tables via a non-updatable postgres_fdw server in restricted `migration_source` inside the exact V4.1 rehearsal database. The SQL guards the destination database and refuses to replace an existing bridge; createdb refuses to reuse an existing database. No live app database connection changes or module merges occur. This permits local SQL planning across source rows, destination rows and persistent ID mappings without more per-table transfers. The wrapper syntax was checked; actual PostgreSQL FDW setup is pending and requires the installed postgres_fdw extension and local postgres peer access. Failures should be diagnosed rather than blindly rerun. The source copy is privileged-account accessible, not an immutable/security-isolated snapshot.

**User rehearsal executed successfully:** user reported COMMIT in the guarded V4.1 rehearsal database, with 162 total users, 121 root users, 41 other-tenant users and 31 deleted root users. All SQL assertions passed before commit. Recorded code mapping: user `a714a3ed-124b-4c7a-b26c-eb997b66f828`, `MHN000112` -> `M40a714a3ed124b4`. Preserve this mapping for any downstream source references using codes. This is not a production migration or completed application validation. Do not rerun the one-time users transaction.

**Next prepared step:** `collect-module-preflight.ps1` compares key/content fingerprints for the remaining 55 shared tables against the named restored snapshots (users and migration history excluded). It includes global lookup tables for reconciliation but does not import them. It reports new keys, matching equal/differing shared fields, direct root/other ownership and matches with no direct tenant column. Parent-derived ownership still requires resolution; a matching unscoped ID is not automatically safe. Schema-only/missing fields and changed timestamp representations can affect interpretation; in particular Tasks.FollowUpDate still requires explicit timezone policy. Primary-key comparison handles the ministry_automation_settings change from `(key)` to `(tenant_id,key)` by projecting the chosen root tenant for source keys. The reports contain no raw row content. Fingerprints and keys remain restricted audit material. It changes only temporary tables and rolls back. Isolated synthetic tests passed all 55 generated queries, new/same/different keys, cross-tenant collisions, empty tables and the tenant-extended composite key. Actual collection remains pending.

User selected option **1**: all V4.0 imported users belong to Mahima Root, and V4.0 wins for matching shared fields including passwords and roles. Preserve destination-only fields (including MFA), the additional root user and other tenants, and preserve source deletion state/history. This resolves the previously pending user policy; it is not evidence that the all-module migration is complete.

Prepared `tools/migration-preflight/run-user-rehearsal.ps1`, exporting from the exact restored V4.0 snapshot and applying `rehearse-users.sql` only to the exact restored V4.1 database. Both SQL files independently guard the database name. The sensitive user CSV stays in protected server directories and is transferred directly via SSH; do not paste its contents. The merge is a single transaction with before-images in restricted `migration_v40`, staged source values, one deterministic 16-character `M40` code remap for the known conflict, and reconciliation checks before commit. It adds `isdeleted`, creates/activates access blocks for the 31 source-deleted users, clears phones only for the 80 participating existing root IDs before applying final incoming values, preserves target-only fields and all unaffected users, and rejects reruns. Expected rehearsal result: 162 total users, 121 root (31 source-deleted), 41 other-tenant users, one recorded code mapping. Source UserCode references outside users still require mapping review; the generic UserCode sequence and login/reset/session/application behavior still need later validation. This is only the users stage; source access blocks for non-deleted users and other modules are not yet migrated.

Isolated synthetic PGlite tests passed: database-name guard, 40 inserts/80 updates, known phone transitions, code remap, deletion blocks, target MFA preservation, other-tenant/additional-user preservation, rerun rejection, and full rollback of phone/schema/user changes on an unresolved cross-tenant unique-phone conflict. The tests do not establish production application correctness. Actual user rehearsal subsequently committed successfully, as recorded above. No production merge is performed by this wrapper.

User confirmed both preliminary database dumps and archive listings succeeded:

| Server | Backup directory | Reported archive size |
|---|---|---|
| V4.0 `187.127.132.149` | `/var/backups/mahima-migration/v40-20260922T071525Z-iW73wJ` | 6.7 MB (`du -h`) |
| V4.1 `187.127.157.35` | `/var/backups/mahima-migration/v41-20260922T071618Z-Y2i0E9` | 14 MB (`du -h`) |

Each contains `mahima_db_3_0.dump`, `archive-contents.txt` and `SHA256SUMS`. User subsequently confirmed local off-server copies, matching SHA-256 checksums and successful strict restores. No file backup has been reported.

| Restored database | Server | Verified users | Verified public tables |
|---|---|---:|---:|
| `mahima_v40_rehearsal_20260922_072439_598910` | `187.127.132.149` | 120 | 65 |
| `mahima_v41_rehearsal_20260922_072500_351048` | `187.127.157.35` | 122 | 105 |

Destination restored tenant-user counts match the reported baseline (81 root, 41 other). These are restored snapshots, not migrated databases. Never substitute `mahima_db_3_0` when configuring rehearsal. Importer repairs, source-only data mappings, merge policy, deployment compatibility and file discovery/backups remain outstanding. Prepared `collect-file-roots.ps1` for read-only allowlisted deployment-path discovery on both servers; it downloads path-only reports without full configuration/environment contents. Candidate roots must be verified before snapshot/copy; containers, command-line overrides and external storage may require additional discovery.

Executed by the user: `tools/migration-preflight/prepare-rehearsal.ps1`. It downloads both dump/checksum pairs to the Git-ignored `migration-output/preflight/database-backups/` directory, verifies local SHA-256 checksums, then invokes `restore-rehearsal.sh`. The remote helper verifies the archive checksum again, creates a uniquely named `mahima_v40_rehearsal_*` or `mahima_v41_rehearsal_*` database on its respective existing server, revokes PUBLIC connection permission, and restores with `--exit-on-error --single-transaction --no-owner --no-privileges`. It never drops/reuses a database and never restores into `mahima_db_3_0`. A failure may leave a separate rehearsal database for diagnosis; do not blindly rerun without recording it. The clones share server resources and remain accessible to privileged accounts; they are not separate-server sandboxes. No application/worker connection is switched or launched. Restore completion verifies archive restorability, not application correctness, production-role restoration, file completeness or migration success. Both archive restores succeeded as recorded above; the actual migration rehearsal has not begun.

## File-root discovery received

User collected both reports successfully. V4.0's identified API process runs from `/var/www/mahima-api`, with `MAHIMA_UPLOADS_ROOT=/var/www/mahima-uploads` and Production environment. V4.1's identified API process runs from `/opt/mahima-api` in Production, with no upload/download root override in the allowlisted environment/config fields. `/var/www/mahima-uploads` and `/var/www/mahima-downloads` exist on both. These align with local code defaults but do not independently prove the deployed binary's behavior or reverse-proxy routing.

Both deployed webroots contain legacy uploads: source `/var/www/mahima-api/wwwroot/uploads`, destination `/opt/mahima-api/wwwroot/uploads`. Destination also has `/var/www/mahima-api/wwwroot/uploads` and `/var/www/mahima/downloads`; retain them as candidate legacy roots until file references are reconciled. Do not confuse dated API backup directories with the running deployment; discovery also found those. No demo-captures directory was found in the checked deployed webroot locations.

Prepared `backup-both-file-roots.ps1` with fixed per-server paths: source external uploads/downloads plus the whole deployed webroot; destination external uploads/downloads, both current/candidate legacy webroots, and `/var/www/mahima/downloads`. Whole webroots preserve other static/generated assets beyond uploads. It checks conservative free-space requirements, creates protected tar archives without following symlinks, aborts on any tar error, reads every archived regular file to create a SHA-256 manifest, and emits summary counts and an archive checksum. It downloads summaries only; full archives initially remain on their respective servers. Missing roots and links require review; archives need independent copies and extraction verification. No file backup or migration has yet been reported. These live backups are not synchronized with earlier database snapshots; a final cutover still needs a coordinated writer freeze and fresh backups.

## Migration readiness

### File archives created; both summaries received

User reported successful archive creation and full archived-file hashing on both servers:

| Version | Archive directory | Regular files | Uncompressed bytes | Archive bytes |
|---|---|---:|---:|---:|
| V4.0 | `/var/backups/mahima-migration/v40-files-20260922T110926Z-hezwecke` | 78553 | 15187151597 | 10304996288 |
| V4.1 | `/var/backups/mahima-migration/v41-files-20260922T111755Z-q70akwfk` | 118 | 1435728542 | 1419916398 |

Both summaries report no missing selected roots and no symbolic or hard links. Each directory contains `media.tar.gz`, `manifest.jsonl`, `SHA256SUMS` and `summary.json`. The source summary downloaded successfully. SSH initially closed during the destination summary download AFTER successful archive creation; the user retried only that transfer and both local JSON reports have now been inspected. Both reported SHA-256 values have valid 64-character hexadecimal format; this is not an independent archive-content checksum verification. Combined archive size is 11724912686 bytes. No extraction rehearsal or independent off-server file-archive copy has been reported. These are live file snapshots taken later than the database snapshots, not a coordinated final cutover snapshot. Database merge policy remains unanswered and no import has run.

The existing migration tool is NOT ready for the requested complete data-and-files cutover. The blockers below are established by the live schemas and local implementation, not hypothetical differences. A database backup/restore alone cannot merge this source into the populated multitenant destination.

Both servers report PostgreSQL 16.15. There are 65 source tables, 105 target tables, 57 shared tables, 8 source-only tables and 48 target-only tables. With the example skip list plus `__EFMigrationsHistory`, the current tool would attempt 52 shared tables. All shared target tables have a declared primary key, but existing-row content and numeric-ID collisions are not checked by the importer.

The complete table/column comparison is in `migration-output/preflight/schema-comparison.md`; structured details are in `schema-comparison.json`. These are generated by `tools/migration-preflight/compare-schemas.py`. The parser is specific to ordinary pg_dump CREATE TABLE formatting and rejects unparsed table/column declarations; it is not a general SQL parser. The report's declaration changes do not include every constraint/default/sequence change: retain and review the raw exports too.

## Required schema and application decisions

### Eight source-only tables

| Table | Required treatment for a complete migration |
|---|---|
| `TaskActivityLog` | Preserve task history and resolve mapped task/user IDs. Local V4.1 MessagesController contains conditional creation/use, but the table is absent in the export. Do not mistake absence for proof that the application never uses it. |
| `accounting_data_snapshots` | Preserve complete snapshot contents and decide how users will access their history. JSON archival alone does not restore application functionality. |
| `chicken_sale_access` | Port or map access rules into a tenant-aware destination module. |
| `chicken_sale_audit` | Preserve audit history with its parent/actor relationships. |
| `chicken_sale_days` | Port or map business records into the corresponding module. |
| `sms_consent_events` | Preserve consent history and integrate it before enabling messaging; do not treat it as disposable telemetry. |
| `user_activity_history` | Preserve and map historical user references. |
| `user_activity_tracking` | Inventory rows and distinguish current tracking state from history; decide how it is restored or retained. |

The subsequent inventories confirm **452 rows** across seven of these tables: TaskActivityLog 86, accounting_data_snapshots 4, chicken_sale_access 1, chicken_sale_audit 14, chicken_sale_days 2, user_activity_history 344, user_activity_tracking 1. sms_consent_events has 0 rows in the collected snapshot. If the user requires all data usable in V4.1, archive-only treatment cannot be marked complete; module/schema work is required.

## Verified data inventory

Both downloaded inventories passed completeness checks (65 source / 105 destination table names, no duplicates) and all directly tenant-scoped destination totals reconcile to root + other + NULL counts. Every reported direct tenant NULL count is zero. This says nothing about ownership of tables scoped through parents. Counts are independent live snapshots and cannot be subtracted to determine the number of records to insert.

| Area | Source records | Destination records / root / other where directly scoped |
|---|---:|---|
| users | 120 | 122 / 81 / 41 |
| Tasks | 71 | 2 / 1 / 1 |
| TaskAssignees | 80 | 1; target TaskAssignmentsV2 also has 1 |
| Sermons | 23 | 10 / 9 / 1 |
| accounts | 48 | 87 / 31 / 56 |
| journal_entries | 341 | 35 / 23 / 12 |
| journal_lines | 698 | 70; ownership via parents |
| expenses | 80 | 0 |
| AttendanceRecords | 782 | 272 / 244 / 28 |
| Timesheets | 491 | 214 / 206 / 8 |
| chats | 166 | 128 / 97 / 31 |
| messages | 3368 | 895; ownership via parents |
| AuditLogs | 185154 | 86854 / 86784 / 70 |
| ProjectManagementProjects | 25 | 3; no direct tenant column in inspected schema |
| ProjectDemoRenderJobs | 21 | 83; no direct tenant column in inspected schema |

Destination-only data includes 186616 BibleVerses, 9 billing invoices (all other tenants), 42 payment events, 67 payment intents, marketing records and QA history. Preserve this data and verify isolation, rather than restoring the source over the destination. The full table counts are recorded in `migration-output/preflight/inventory-comparison.md`.

No further table-count collection is needed for this snapshot. Next: protected source and destination backups, importer/schema/application repairs and full rehearsal. `tools/migration-preflight/backup-both-databases.ps1` uploads and invokes `backup-database.sh` on each server. It creates a custom-format archive, archive listing and SHA-256 manifest in a protected unique directory under `/var/backups/mahima-migration/`. These are preliminary database-only snapshots with writers still running; they are not file backups, full restore verification or final frozen cutover backups. Store independent backup copies after confirming disk space and the transfer destination; server-local archives alone do not survive loss of that server. A role/ACL recovery plan is also needed before production rollback. Do not mark the migration ready merely because pg_restore can list the archive.

### Thirteen source-only columns in shared tables

- `users.isdeleted`: 31 users are source-deleted; 17 of those IDs already exist in V4.1 and 14 are absent. Preserve state and dependent history; test login, listing, search and API access. A database column alone is not proof of application enforcement.
- `Sermons`: `Currency`, `DigitalContentType`, `DigitalFileName`, `DigitalFilePath`, `DigitalSizeBytes`, `IsFree`, `PriceAmount`. Dropping these can lose file references and price/access semantics. Copying upload directories does not repair missing references. Add compatible support or map these to a reviewed destination representation.
- `TaskAssignees`: `AssignedByUserId`, `AssignedByPositionId`.
- `Tasks`: `AssignedByUserId`, `AssignedByPositionId`, `UpdatedById`.

Preserve task assignment attribution, not just its current assignee. Keep full backups/raw staging until all fields have an accepted destination.

### Task assignment transformation and timestamp conversion

V4.1 TasksController reads `TaskAssignmentsV2`, which exists only in the target and is untouched by this importer. Its startup/query helper seeds only `Tasks.AssigneeId` as a user assignment; it does not import the complete legacy `TaskAssignees` set. Map legacy `TaskId`, `AssigneeType`, `AssigneeId`, and `AssignedAt` into the new representation (including user/team ID mappings and CreatedAt), preserve attribution separately, and reconcile existing V4.1 assignments instead of blanket replacement. Inspect `TaskTeamAssignees` consumers before deciding whether it also needs a mapping.

`Tasks.FollowUpDate` changes from timestamp WITHOUT time zone to timestamp WITH time zone. Confirm the timezone represented by source values from deployment/application evidence. Use an explicit conversion such as `AT TIME ZONE` with the confirmed zone; the user's PC timezone is not evidence of the stored timestamp's meaning. Do not rely on the target session timezone during COPY.

### Destination schema versus checkout

The exported target has no `tenant_storage_usage` or tenant-storage functions/triggers, while the current checkout's storage service requires them. Confirm the deployed API version, then deploy a compatible schema/backend/frontend combination in rehearsal before cutover. Do not blindly apply every SQL file. The storage migration also changes child-table ownership, so any selected schema upgrade requires a fresh export/plan before migration.

## Confirmed importer defects

1. `SchemaModels.cs` defines `IsTenantColumn` using only `tenant_id` with case-insensitive comparison. That does NOT match `TenantId` (the underscore matters). Seven shared tables have target-only `TenantId`: Attachments, AttendanceRecords, Meetings, Sermons, Tasks, Teams, Timesheets. The importer defaults these instead of explicitly assigning the selected tenant. Tasks.TenantId is NOT NULL without a default in the export, so its insert will fail. Correct the matcher in both planning/import generation paths through the shared model, then verify every imported row's owner.
2. `SchemaReader` does not read identity metadata; `IsSerial` recognizes only a `nextval(...)` column default. The live target uses identity columns in 23 shared tables (21 after the example lookup exclusions). Explicit imported IDs do not automatically advance their generators. Support identity/serial discovery and advance generators to at least both their existing safe state and the maximum retained/imported ID. Correct schema-qualified, quoted table handling. Also check `user_code_seq`, which is used by a trigger rather than an ordinary serial column.
3. `ON CONFLICT (PK) DO NOTHING` skips changed rows, does not reconcile references, and does not resolve other unique-key conflicts. User conflicts are already confirmed. Numeric IDs in tasks, teams, accounts, journal entries and other shared tables need collision/content/owner checks and a persistent mapping where IDs differ. Child and polymorphic references, including assignee strings, must use that mapping.
4. Key-only verification can pass despite stale content or incorrect ownership. Add content, mapping, FK, module-total, tenant-isolation and file-reference verification.

## Required migration sequence

1. Finish discovery: exact table/tenant counts; ID and business-key collisions across populated tables; deployed versions; live file roots/URL mappings; source timestamp semantics. The user merge-policy choice remains pending. Schema inspection is complete, but data-wide collision analysis is not.
2. Back up both databases and all file roots; restore to isolated rehearsal databases. Keep outbound workers, reset flows, scheduled messages and integrations disabled in rehearsal.
3. Implement the mappings/schema/application compatibility above and correct importer defects in a controlled working copy. Do not copy migration-history entries or global permissions blindly. Preserve target-only modules and existing tenant data. Archive credential/session/reset records for history only where appropriate; do not automatically reactivate tokens or replay queued notifications.
4. Build a reviewed migration manifest from the rehearsal data. Each source table and each source-only field must have an explicit disposition. Preserve target pre-images and a persistent old-to-new ID/code/URL map. Resolve the known UserCode conflict by preserving the other tenant's code; review exact values before mapping the imported user's code.
5. Rehearse the full database merge with tenant-scoped writes and mapped references. For the two phone conflicts, validate final uniqueness and update the old owners to their intended source state before assigning their former values, within an appropriate atomic transaction. Preserve source-deleted history without enabling the users. Do not remove unique indexes to force success.
6. Stage and hash files. Map generic uploads, Server Files, sermon digital files, profile photos, logos, voice samples and demo captures; update database references only for mapped imported records. Keep source/destination pre-images and a ledger of changes. Do not assume all files live in one upload root.
7. Validate rehearsal: source disposition totals, shared-field equality under accepted rules, deleted-user behavior, roles/login/MFA, accounting totals, task assignments/history, source-only module history, file hashes/downloads, sequence inserts, and isolation of all other tenants.
8. Freeze production writers/uploads/jobs for the final consistent export, take fresh database/files backups, repeat the rehearsed procedure against verified endpoints, validate before reopening traffic, and retain rollback data. Restore plans must account for every other tenant; never roll back unrelated new writes by blindly restoring an old shared database.

## Next read-only collection

Generated `migration-output/preflight/inventory-v40.sql` and `inventory-v41.sql` each produce a CSV in `/tmp/mahima-v40-table-inventory.csv` or `/tmp/mahima-v41-table-inventory.csv`. They count every table from the inspected schema; where a tenant column exists they split root, other tenant and NULL ownership counts. Tables without a tenant column have NULL ownership counts, which is not an assertion that they are unowned. Counts use a repeatable-read, read-only transaction, a 5-second lock timeout and a 15-minute query timeout. Exact counts can impose read load; run during a suitable period. Failure requires reviewing the error, not consuming a partial CSV. The two server inventories are independent snapshots, not a coordinated cutover snapshot.

Validated the generated SELECT queries with isolated PGlite synthetic tables: all 65 source and 105 destination table queries passed, including empty tables, non-tenant users, root/other/NULL ownership and quoted `Tasks.TenantId`. This validates query syntax and counting behavior; it is not a production migration test or a restore rehearsal.
