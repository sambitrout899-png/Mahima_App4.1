\set ON_ERROR_STOP on
\pset pager off
-- Stage C, real production run: tables with no V4.1 destination table at all. Exported as
-- JSON-lines for the historical record, nothing written to any database table. Read-only against
-- the migration_source FDW bridge (now pointed at the frozen production V4.0 backup, not the
-- rehearsal snapshot); wrapped in a transaction purely so \copy reads a consistent snapshot.
BEGIN;
\copy (SELECT row_to_json(t) FROM migration_source.chicken_sale_access t) TO '/var/backups/mahima-migration/archive-production/chicken_sale_access.json.copy'
\copy (SELECT row_to_json(t) FROM migration_source.chicken_sale_days t) TO '/var/backups/mahima-migration/archive-production/chicken_sale_days.json.copy'
\copy (SELECT row_to_json(t) FROM migration_source.chicken_sale_audit t) TO '/var/backups/mahima-migration/archive-production/chicken_sale_audit.json.copy'
\copy (SELECT row_to_json(t) FROM migration_source."TaskActivityLog" t) TO '/var/backups/mahima-migration/archive-production/TaskActivityLog.json.copy'
\copy (SELECT row_to_json(t) FROM migration_source.accounting_data_snapshots t) TO '/var/backups/mahima-migration/archive-production/accounting_data_snapshots.json.copy'
\copy (SELECT row_to_json(t) FROM migration_source.sms_consent_events t) TO '/var/backups/mahima-migration/archive-production/sms_consent_events.json.copy'
\copy (SELECT row_to_json(t) FROM migration_source.user_activity_history t) TO '/var/backups/mahima-migration/archive-production/user_activity_history.json.copy'
\copy (SELECT row_to_json(t) FROM migration_source.user_activity_tracking t) TO '/var/backups/mahima-migration/archive-production/user_activity_tracking.json.copy'
ROLLBACK;
\echo 'Stage C production archive complete: files are under /var/backups/mahima-migration/archive-production/ on 187.127.157.35. Nothing was written to any database table.'
