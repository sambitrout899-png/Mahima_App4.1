using System.Text.Json;

namespace Mahima.Api.v3.clean.Services;

public sealed class MobileAppAccessMiddleware
{
    private readonly RequestDelegate _next;

    private static readonly PathString[] WebOnlyPrefixes =
    {
        "/api/admin",
        "/api/platform",
        "/api/billing",
        "/api/tenant-admin",
        "/api/roles",
        "/api/rolepermissions",
        "/api/role-permissions",
        "/api/pages",
        "/api/positions",
        "/api/payroll",
        "/api/expenses",
        "/api/accounting",
        "/api/audit-trail",
        "/api/reports",
        "/api/email-client",
        "/api/google-drive",
        "/api/server-files",
        "/api/ministry-automation",
        "/api/projectmanagement",
    };

    public MobileAppAccessMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        var isMobile = string.Equals(context.Request.Headers["X-Mahima-Client"].FirstOrDefault(), "mobile", StringComparison.OrdinalIgnoreCase);
        if (isMobile && WebOnlyPrefixes.Any(prefix => context.Request.Path.StartsWithSegments(prefix)))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync(JsonSerializer.Serialize(new
            {
                message = "This administration function is available only in the Mahima web application.",
                code = "WEB_ONLY_PAGE"
            }));
            return;
        }

        await _next(context);
    }
}
