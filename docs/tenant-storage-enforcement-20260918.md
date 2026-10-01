# Tenant storage enforcement and monitoring

Implemented in source; deployment and the production database migration are separate steps.

## Policy

- One GB is 1,000,000,000 bytes. Allowance is the largest active subscription's accepted publication (`AppliedPlanVersion`), not the editable package draft. No active subscription falls back to 10 GB. Expired subscriptions are excluded. Allowances do not stack. Root tenants are measured but exempt.
- Database usage is the UTF-8 size of each row's JSON representation. It is a logical content measure, not physical PostgreSQL disk use. Indexes, WAL, vacuum bloat, backups and shared/platform tables are excluded.
- All public tables with a UUID `tenant_id` or `TenantId` receive transactional row meters. The migration also adds inherited ownership for messages, chat members/read receipts, team members, prayer responses, journal lines, counselling cases and sessions. Missing parent ownership or orphaned child records stops migration instead of silently ignoring data.
- Subscription/payment/billing records, audit records, notification queues and admin notifications are excluded so recovery and billing can continue at capacity. Tables without tenant ownership and shared generated artifacts (for example Bible audio and Demo Studio rendered videos) remain platform storage; these are not a filesystem-wide disk quota.
- Tenant uploads, tenant logos, Server Files, new tenant-scoped pastor voice samples and demo screenshots count toward file usage. External Google Drive/email storage does not count.
- Database growth exceeding the combined allowance is rejected transactionally with PostgreSQL SQLSTATE `P5401`; deletes and shrinking updates still work. Uncaught quota exceptions return HTTP 413 and code `tenant_storage_limit`. Existing controllers that catch database exceptions themselves may still return their generic error, but the database write is rolled back.
- Local uploads reserve the complete Content-Length before the controller runs, so multipart overhead is temporarily counted conservatively. Chunked multipart uploads without Content-Length return HTTP 411. Server Files copies reserve the source byte size. File mutations and reconciliation share a PostgreSQL advisory lock per tenant; counters use atomic SQL updates shared with the database meter.
- Failed uploads, partial files and crash reservations are reconciled from disk. File deletion releases capacity after its request finishes. A failed scan preserves the last counter and is logged. No automatic storage-overage charges are generated; the allowance is a hard limit.

## Monitoring and UI

The hosted monitor starts with the API and scans every 15 minutes, configurable through `TenantStorage:MonitorMinutes` (1–1440). It records admin alerts at 80%, 90% and 100%, with one alert per severity per tenant per 24 hours. The advisory lock prevents duplicate alerts across instances. Alerts are in-app records, not outbound emails.

The Subscriptions page shows current tenant storage and recent alerts. All Tenant Dashboards shows the selected tenant's usage. Refresh usage fetches the latest counters; the file measurement timestamp shows freshness. Initial file scans are explicitly marked pending.

Authenticated admin endpoints:

- `GET /api/tenants/current/storage`
- `GET /api/platform/tenants/{tenantId}/storage` (root tenant admin only)

## Deploy

1. Back up the database. Stop API/background writers and file uploads for the maintenance window. Ensure earlier multitenant/module migrations have already run.
2. Apply `backend/Mahima.Api.v3.clean/Sql/20260918_tenant_storage.sql` with a migration account permitted to create tables, functions and triggers. It backfills logical database usage and takes locks. Run it again after adding new tenant-owned tables; existing totals are rebuilt without double-counting. Run with a client that stops on SQL errors.
3. Deploy the backend and frontend together. Keep traffic paused until the initial monitor pass has completed. Check logs for failures and check that every tenant has a non-null `files_measured_at` in `public.tenant_storage_usage`.
4. For multiple API instances, all instances must see the same tenant file roots. Separate local disks are not supported by this aggregate counter.
5. Existing voice samples in the old shared `wwwroot/uploads/pastor-voice` folder and old shared demo captures cannot be safely assigned automatically. Review ownership and move them to the corresponding tenant-ID (`N` format) subfolder; voice samples may instead be uploaded again. Shared legacy files are not counted until assigned.
6. Validate an ordinary tenant's UI and a test tenant's upload rejection/deletion recovery before restoring traffic. Existing over-limit tenants retain read/delete access but cannot grow stored data.

Monitoring failure is visible in API logs and stale file timestamps. Applying only the API without the migration is unsupported: storage endpoints/uploads fail closed when the schema is unavailable, while database-only writes cannot be enforced until the triggers exist.

## Verification

- Backend build: `dotnet build backend/Mahima.Api.v3.clean/Mahima.Api.v3.clean.csproj --no-restore -p:IntermediateOutputPath=obj/storage-check/ -o tmp/storage-build`
- Frontend build from `frontend`: `node node_modules/vite/bin/vite.js build --outDir ../tmp/storage-frontend-build`
- Isolated PostgreSQL integration: install `@electric-sql/pglite@0.3.14` under `tmp/storage-sql-test`, then run `node tools/tenant-storage-check/check.mjs`. No application/production connection string is read. Tests cover backfill/rerun, UTF-8 measurement, accepted plan versions, expiry, rollback, deletion, combined usage, tenant isolation, inherited ownership and competing file reservations. PGlite serializes queries; this is not a multi-server load test.

Production migration execution and production-volume performance remain to be verified during deployment.
