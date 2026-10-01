using Npgsql;

namespace Mahima.Api.v3.clean.Services;

public sealed class TenantStorageMiddleware(RequestDelegate next, ILogger<TenantStorageMiddleware> logger)
{
    public async Task InvokeAsync(HttpContext context, ITenantContextService tenants, TenantStorageService storage)
    {
        try
        {
            var mutation = HttpMethods.IsPost(context.Request.Method) || HttpMethods.IsPut(context.Request.Method)
                || HttpMethods.IsPatch(context.Request.Method) || HttpMethods.IsDelete(context.Request.Method);
            var files = context.Request.Path.StartsWithSegments("/api/server-files")
                || context.Request.Path.StartsWithSegments("/api/uploads")
                || context.Request.Path.StartsWithSegments("/api/pastorbot/voice-sample")
                || (context.Request.ContentType?.StartsWith("multipart/form-data", StringComparison.OrdinalIgnoreCase) == true
                    && !context.Request.Path.StartsWithSegments("/api/google-drive")
                    && !context.Request.Path.StartsWithSegments("/api/email"));
            if (!mutation || !files || context.User.Identity?.IsAuthenticated != true)
            { await next(context); return; }
            var tenant = await tenants.GetCurrentTenantAsync(context.RequestAborted);
            if (tenant is null) { context.Response.StatusCode = 403; return; }
            await using var lease = await storage.LockFilesAsync(tenant.Id, context.RequestAborted);
            await storage.ReconcileFilesAsync(tenant, context.RequestAborted);
            if (context.Request.ContentType?.StartsWith("multipart/form-data", StringComparison.OrdinalIgnoreCase) == true)
            {
                // Reserve the whole wire size conservatively without buffering multi-GB uploads.
                if (context.Request.ContentLength is not long size)
                { context.Response.StatusCode = 411; await context.Response.WriteAsJsonAsync(new { message = "Content-Length is required for uploads." }); return; }
                await storage.ReserveFilesAsync(tenant.Id, size, context.RequestAborted);
            }
            try { await next(context); }
            finally
            {
                // Also counts partial files after a failed/cancelled write. Crash reservations
                // are repaired by the next scan; do not release space we have not measured.
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                try { await storage.ReconcileFilesAsync(tenant, timeout.Token); }
                catch (Exception ex) { logger.LogError(ex, "Storage reconciliation failed for {TenantId}", tenant.Id); }
            }
        }
        catch (Exception ex) when (!context.Response.HasStarted && IsQuotaError(ex))
        {
            context.Response.StatusCode = 413;
            await context.Response.WriteAsJsonAsync(new { code = "tenant_storage_limit", message = "Tenant storage allowance exceeded. Delete unused data or upgrade your package." });
        }
        catch (PostgresException ex) when (!context.Response.HasStarted && ex.SqlState is "42P01" or "42883")
        {
            logger.LogError(ex, "Storage schema is unavailable");
            context.Response.StatusCode = 503;
            await context.Response.WriteAsJsonAsync(new { code = "storage_unavailable", message = "Storage checks are unavailable. Contact your administrator." });
        }
    }

    private static bool IsQuotaError(Exception? ex) => ex is TenantStorageLimitException
        || ex is PostgresException { SqlState: "P5401" }
        || ex?.InnerException is not null && IsQuotaError(ex.InnerException);
}
