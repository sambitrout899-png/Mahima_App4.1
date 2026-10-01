\set ON_ERROR_STOP on
\pset pager off
-- Stage C: tables with no V4.1 destination table at all (confirmed via schema-comparison.md's
-- source-only-table list). Exported as JSON-lines for the historical record, nothing written to
-- any database table. Read-only against the migration_source FDW bridge; wrapped in a transaction
-- purely so \copy has a consistent snapshot to read from, not because anything is being changed.
-- Absolute paths under /var/backups/mahima-migration/archive - the wrapper creates that directory
-- as postgres:postgres before running this, since \copy TO writes as the postgres OS user, not
-- whatever directory the ssh session happened to start in.
BEGIN;
\copy (SELECT row_to_json(t) FROM migration_source.chicken_sale_access t) TO '/var/backups/mahima-migration/archive/chicken_sale_access.json.copy'
\copy (SELECT row_to_json(t) FROM migration_source.chicken_sale_days t) TO '/var/backups/mahima-migration/archive/chicken_sale_days.json.copy'
\copy (SELECT row_to_json(t) FROM migration_source.chicken_sale_audit t) TO '/var/backups/mahima-migration/archive/chicken_sale_audit.json.copy'
\copy (SELECT row_to_json(t) FROM migration_source."TaskActivityLog" t) TO '/var/backups/mahima-migration/archive/TaskActivityLog.json.copy'
\copy (SELECT row_to_json(t) FROM migration_source.accounting_data_snapshots t) TO '/var/backups/mahima-migration/archive/accounting_data_snapshots.json.copy'
\copy (SELECT row_to_json(t) FROM migration_source.sms_consent_events t) TO '/var/backups/mahima-migration/archive/sms_consent_events.json.copy'
\copy (SELECT row_to_json(t) FROM migration_source.user_activity_history t) TO '/var/backups/mahima-migration/archive/user_activity_history.json.copy'
\copy (SELECT row_to_json(t) FROM migration_source.user_activity_tracking t) TO '/var/backups/mahima-migration/archive/user_activity_tracking.json.copy'
ROLLBACK;
\echo 'Stage C archive complete: files are under /var/backups/mahima-migration/archive/ on 187.127.157.35. Nothing was written to any database table.'
