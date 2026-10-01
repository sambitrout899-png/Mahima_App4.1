# Module consistency audit — 2026-09-14

Scope: Events, Volunteer Scheduling, Child Check-In, Worship/Service Planning,
account MFA Security, and administrative Security Monitoring.

## Production evidence

Unauthenticated read-only probes against `https://app.mahimaministries.in`:

| Endpoint | Result | Meaning |
| --- | --- | --- |
| `GET /api/events?includePast=false` | 200 | Events route deployed successfully |
| `GET /api/volunteer-shifts` | 404 | Protected route missing; an installed route would return 401 |
| `GET /api/checkin/active` | 401 | Child Check-In route is deployed and protected |
| `GET /api/service-plans` | 401 | Worship route is deployed and protected |
| `GET /api/auth/mfa/status` | 404 | MFA route missing from deployed API |
| `GET /api/admin/qa/security/status` | 401 | Security Monitoring route is deployed and protected |
| `GET /api/auth/me` | 401 | API and authentication middleware are reachable |

The latest checks were run after Events started working. The Caddy and Kestrel
response headers show that the remaining 404 responses reach the API process.
This is not a frontend URL, browser cache, CORS, or Caddy prefix problem. The
Volunteer and MFA implementations are still missing from the deployed assembly.

## Source audit and corrections

- Verified all 35 frontend-required HTTP method/route combinations through MVC
  action discovery against the compiled backend assembly.
- Normalized blank child dates to JSON `null`; an empty string cannot bind to the
  nullable .NET `DateTime` DTO property.
- Normalized volunteer times and display/edit values across HTML time inputs and
  .NET `TimeSpan` values.
- Added explicit PostgreSQL `date` and `time without time zone` mappings.
- Allowed staff who can create private events to see those private events.
- Removed the child pickup security code from application logs.
- Unified module API errors and suppressed duplicate global `404` notifications.
- Kept frontend role guards aligned with controller authorization policies.

## Verification

- Frontend module contract tests: 3 passed.
- Frontend production build and bundle verification: passed.
- Backend MVC audit: 436 total actions discovered; all 35 required module routes passed.
- Backend Release publish: passed. Existing nullable-reference warnings remain outside
  these modules; there were no build errors.
- Frontend lint could not run because the repository's lint script references ESLint,
  but ESLint is not installed or declared in the current frontend development dependencies.

## Deployment order

1. Back up the production database and current API/frontend releases.
2. Apply the five idempotent SQL files in the release `sql` folder.
3. Stop `mahima-api`, copy the release `api` output while preserving the production
   configuration, data-protection keys, and uploads, then start the service.
4. Deploy the release `frontend` output to the Caddy document root and reload Caddy.
5. Verify the six endpoints above. Protected routes should return 401 without a token;
   authenticated module checks should return 200 or a request-specific validation result.
6. Run authenticated create/read/update/delete smoke tests for each module using disposable
   test records, then remove those records.

The API must be deployed before testing Events again. A frontend-only deployment cannot
resolve the current POST and GET 404 responses.
