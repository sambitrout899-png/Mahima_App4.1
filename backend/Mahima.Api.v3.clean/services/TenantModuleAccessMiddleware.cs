using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;

namespace Mahima.Api.v3.clean.Services
{
    public class TenantModuleAccessMiddleware
    {
        private static readonly string[] FreeApiPrefixes =
        {
            "/api/auth",
            "/api/public",
            "/api/tenants/current/entitlements",
            "/api/tenants/current/storage",
            "/api/tenant-admin/landing",
            "/api/users",
            "/api/roles",
            "/api/uploads",
            "/api/prayerrequests",
            "/api/prayer-requests",
            "/api/sermons",
            "/api/teams"
        };

        private static readonly IReadOnlyList<(string Prefix, string ModuleCode)> PaidApiPrefixes =
            new List<(string Prefix, string ModuleCode)>
            {
                ("/api/chats", LicensingService.ChatModule),
                ("/api/messages", LicensingService.ChatModule),
                ("/api/hubs/chat", LicensingService.ChatModule),
                ("/api/chat-safety", LicensingService.ChatModule),

                ("/api/tasks", LicensingService.OperationsModule),
                ("/api/attendance", LicensingService.OperationsModule),
                ("/api/timesheets", LicensingService.OperationsModule),
                ("/api/payroll", LicensingService.OperationsModule),
                ("/api/costs", LicensingService.OperationsModule),
                ("/api/expenses", LicensingService.OperationsModule),
                ("/api/accounting", LicensingService.OperationsModule),
                ("/api/reports", LicensingService.OperationsModule),
                ("/api/audit", LicensingService.OperationsModule),
                ("/api/volunteer-shifts", LicensingService.OperationsModule),

                ("/api/pastor", LicensingService.CareMinistryModule),
                ("/api/pastorbot", LicensingService.CareMinistryModule),
                ("/api/marriage", LicensingService.CareMinistryModule),
                ("/api/applications", LicensingService.CareMinistryModule),
                ("/api/baptism", LicensingService.CareMinistryModule),
                ("/api/baptisms", LicensingService.CareMinistryModule),
                ("/api/counselling", LicensingService.CareMinistryModule),
                ("/api/events", LicensingService.CareMinistryModule),
                ("/api/checkin", LicensingService.CareMinistryModule),
                ("/api/service-plans", LicensingService.CareMinistryModule),

                ("/api/roles", LicensingService.AdminToolsModule),
                ("/api/pages", LicensingService.AdminToolsModule),
                ("/api/admin", LicensingService.AdminToolsModule),
                ("/api/platform", LicensingService.AdminToolsModule),
                ("/api/languages", LicensingService.AdminToolsModule),

                ("/api/app-releases", LicensingService.CommunicationsModule),
                ("/api/email", LicensingService.CommunicationsModule),
                ("/api/google-drive", LicensingService.CommunicationsModule),
                ("/api/server-files", LicensingService.CommunicationsModule),
                ("/api/device-tokens", LicensingService.CommunicationsModule)
            };

        private readonly RequestDelegate _next;

        public TenantModuleAccessMiddleware(RequestDelegate next)
        {
            _next = next;
        }

        public async Task InvokeAsync(
            HttpContext context,
            ITenantContextService tenantContext,
            ILicensingService licensing)
        {
            var path = context.Request.Path.Value?.TrimEnd('/').ToLowerInvariant() ?? string.Empty;

            if (!path.StartsWith("/api", StringComparison.Ordinal))
            {
                await _next(context);
                return;
            }

            // Public/free endpoints must bypass tenant resolution as well as
            // module checks. Anonymous app-release clients do not have tenant
            // claims, and resolving a tenant before reaching [AllowAnonymous]
            // can fail before the controller action runs.
            if (IsFreeApiPath(context.Request.Method, path))
            {
                await _next(context);
                return;
            }

            if (!path.StartsWith("/api/auth", StringComparison.Ordinal) &&
                !path.StartsWith("/api/public", StringComparison.Ordinal))
            {
                var statusTenant = await tenantContext.GetCurrentTenantAsync(context.RequestAborted);
                if (statusTenant?.IsRootTenant != true &&
                    !string.Equals(statusTenant?.Status, "active", StringComparison.OrdinalIgnoreCase))
                {
                    context.Response.StatusCode = StatusCodes.Status423Locked;
                    context.Response.ContentType = "application/json";
                    await context.Response.WriteAsync(JsonSerializer.Serialize(new
                    {
                        message = "This tenant is not active. Please contact Mahima Ministry admin.",
                        status = statusTenant?.Status ?? "inactive"
                    }));
                    return;
                }
            }

            var moduleCode = FindModuleCode(path);
            if (moduleCode == null)
            {
                await _next(context);
                return;
            }

            var tenant = await tenantContext.GetCurrentTenantAsync(context.RequestAborted);
            if (tenant?.IsRootTenant == true)
            {
                await _next(context);
                return;
            }

            if (tenant != null && await licensing.HasModuleAsync(tenant.Id, moduleCode, context.RequestAborted))
            {
                await _next(context);
                return;
            }

            context.Response.StatusCode = StatusCodes.Status402PaymentRequired;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync(JsonSerializer.Serialize(new
            {
                message = "This page requires an active paid package for this tenant.",
                moduleCode
            }));
        }

        private static bool IsFreeApiPath(string method, string path)
        {
            if (HttpMethods.IsGet(method) &&
                path.StartsWith("/api/app-releases", StringComparison.Ordinal) &&
                (path.EndsWith("/latest", StringComparison.Ordinal) ||
                 path.EndsWith("/android/download", StringComparison.Ordinal)))
                return true;

            if (HttpMethods.IsGet(method) &&
                (path.Equals("/api/pages", StringComparison.Ordinal) ||
                 path.StartsWith("/api/pages/", StringComparison.Ordinal)))
                return true;

            return FreeApiPrefixes.Any(prefix =>
                path.Equals(prefix, StringComparison.Ordinal) ||
                path.StartsWith(prefix + "/", StringComparison.Ordinal));
        }

        private static string? FindModuleCode(string path)
        {
            foreach (var entry in PaidApiPrefixes.OrderByDescending(entry => entry.Prefix.Length))
            {
                var prefix = entry.Prefix.ToLowerInvariant();
                if (path.Equals(prefix, StringComparison.Ordinal) ||
                    path.StartsWith(prefix + "/", StringComparison.Ordinal))
                    return entry.ModuleCode;
            }

            return null;
        }
    }
}
