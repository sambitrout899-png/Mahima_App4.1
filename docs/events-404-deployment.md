# Events endpoint deployment

The reported request is `GET /api/events?includePast=false`. The frontend path
matches `Controllers/EventsController.cs` and `Program.cs` maps controllers.
The list action returns 200 (including an empty array) or 500 on an exception;
it does not return 404. The screenshot therefore suggests an older deployed API
or proxy routing to a different API instance. Live server access is needed to
distinguish these cases.

The Events controller is currently untracked in this checkout. Ensure it and
its dependencies are included in the release, rather than deploying only the
frontend or copying tracked files alone:

- `backend/Mahima.Api.v3.clean/Controllers/EventsController.cs`
- Event/RSVP model files and their mappings in `Data/MahimaDbContext.cs`
- `backend/Mahima.Api.v3.clean/Sql/20260911_events_module.sql`

Release steps:

1. Apply the Events SQL script to the intended application database using the
   normal database release process. A missing table would produce 500, not fix
   the current 404 by itself.
2. Publish the API from the complete source checkout:
   `dotnet publish backend/Mahima.Api.v3.clean/Mahima.Api.v3.clean.csproj -c Release -o artifacts/events-api-publish`
3. Deploy the published API through the normal server release process, preserve
   server configuration and uploads, and restart the API service.
4. Verify `/api/events?includePast=false` against both the API upstream and the
   public hostname, using the affected user's authorized session. Expect 200
   with a JSON array. If only the public hostname returns 404, inspect Caddy's
   upstream/path mapping. Other working `/api` routes suggest a general prefix
   rewrite should not be changed without confirming the upstream behavior.
5. Deploy the frontend build containing the Events loading-error/retry fix.

Local verification: .NET 8 build succeeded. No production deployment or database
change was performed. A live HTTPS probe could not connect from this environment.
