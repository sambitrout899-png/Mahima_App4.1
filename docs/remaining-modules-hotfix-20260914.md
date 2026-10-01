# Remaining module hotfix — 2026-09-14

Production now exposes Events, Child Check-In, Worship/Service Planning, and
Security Monitoring. Only these routes remain missing:

- `GET/POST/PUT/DELETE /api/volunteer-shifts...`
- `GET/POST /api/auth/mfa/...`

The hotfix contains the verified application DLL and the two idempotent SQL scripts
needed by those modules. It intentionally omits `appsettings*.json`, data-protection
keys, uploads, and frontend files.

Deployment procedure:

1. Back up the production database and current `Mahima.Api.v3.clean.dll`.
2. Apply `sql/20260911_volunteer_scheduling_module.sql` and
   `sql/20260911_user_mfa.sql` to the database used by `mahima-api`.
3. Stop the `mahima-api` service.
4. Replace the production `Mahima.Api.v3.clean.dll` with the DLL in this hotfix.
   Copy the PDB only if production symbol files are normally deployed.
5. Start the service and check its startup logs.
6. Without authentication, both `/api/volunteer-shifts` and `/api/auth/mfa/status`
   must return `401`, not `404`. Then verify them through the signed-in UI.

The DLL was built from the current complete workspace and includes all 35 audited
routes for Events, Volunteers, Child Check-In, Worship, MFA, and Security Monitoring.
