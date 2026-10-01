# Community pages multi-tenant release — 2026-09-14

This release registers Events, Volunteer Scheduling, Child Check-In, Security,
and Service Planning in Pages, tenant role permissions, package configuration,
frontend licensing, API licensing middleware, navigation, and mobile access.

## Package ownership

- `SECURITY`: Free Essentials (`base`)
- `VOLUNTEERS`: Operations Suite (`operations`)
- `EVENTS`: Care Ministry Suite (`care_ministry`)
- `CHECKIN`: Care Ministry Suite (`care_ministry`)
- `SERVICE_PLANS`: Care Ministry Suite (`care_ministry`)

All module data remains tenant-scoped through the existing `tenant_id` filters.
Account MFA remains scoped to the authenticated user.

## Role behavior

The migration adds default global assignments for the standard admin, member,
staff, volunteer, and pastor roles. If a tenant already has customized rows in
`tenant_role_permissions`, those assignments remain unchanged; its administrator
can select the new licensed pages from the Roles screen.

Package drafts receive the new pages when they contain the corresponding module.
Published package snapshots are not rewritten. Publish a new package version when
an existing non-root tenant should receive one of the new pages through its package.

## Deployment

1. Back up the database and current API/frontend releases.
2. Apply `sql/20260914_community_pages_roles_multitenant.sql` to `mahima_db_3_0`.
3. Stop `mahima-api`, replace the API publish output while preserving production
   `appsettings*.json`, keys, and uploads, then start the service.
4. Deploy `frontend` to the Caddy application document root and reload Caddy.
5. Sign out and sign in so the user response contains refreshed page permissions.
6. In Pages, verify all five page keys. In Roles, assign licensed pages for each
   tenant-specific role as required.

## Verification

- Backend compilation and MVC discovery passed.
- 436 MVC actions discovered; all 35 affected module routes passed.
- Page-to-module mappings match across Pages, Roles, authentication, package
  configuration, API middleware, and frontend licensing.
- Frontend contract tests: 3 passed.
- Frontend production build and bundle verification passed.
