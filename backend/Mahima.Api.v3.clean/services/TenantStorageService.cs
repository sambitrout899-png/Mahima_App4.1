using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Models;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Mahima.Api.v3.clean.Services;

public record TenantStorageUsage(Guid TenantId, long DatabaseBytes, long FileBytes, long LimitBytes,
    DateTime? FilesMeasuredAt, bool Exempt)
{
    public long UsedBytes => DatabaseBytes + FileBytes;
    public decimal PercentUsed => Math.Round(100m * UsedBytes / LimitBytes, 2);
    public string Status => Exempt ? "exempt" : UsedBytes >= LimitBytes ? "limit_reached" : UsedBytes >= LimitBytes * 0.9m ? "critical" : UsedBytes >= LimitBytes * 0.8m ? "warning" : "healthy";
    public IReadOnlyList<StorageAlert> RecentAlerts { get; init; } = Array.Empty<StorageAlert>();
}
public record StorageAlert(string? Message, DateTime CreatedAt);

public sealed class TenantStorageService(IConfiguration config, IWebHostEnvironment env, MahimaDbContext db)
{
    public async Task<IAsyncDisposable> LockFilesAsync(Guid tenantId, CancellationToken ct)
    {
        var connection = new NpgsqlConnection(config.GetConnectionString("DefaultConnection"));
        try
        {
            await connection.OpenAsync(ct);
            await using var command = new NpgsqlCommand("SELECT pg_advisory_lock(hashtextextended(@id::text, 9182026))", connection);
            command.Parameters.AddWithValue("id", tenantId);
            await command.ExecuteNonQueryAsync(ct);
            return new FileLease(connection, tenantId);
        }
        catch { await connection.DisposeAsync(); throw; }
    }

    private sealed class FileLease(NpgsqlConnection connection, Guid tenantId) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            try
            {
                await using var command = new NpgsqlCommand("SELECT pg_advisory_unlock(hashtextextended(@id::text, 9182026))", connection);
                command.Parameters.AddWithValue("id", tenantId);
                await command.ExecuteNonQueryAsync();
            }
            finally { await connection.DisposeAsync(); }
        }
    }

    public async Task<TenantStorageUsage> GetAsync(Guid id, CancellationToken ct)
    {
        await using var connection = new NpgsqlConnection(config.GetConnectionString("DefaultConnection"));
        await connection.OpenAsync(ct);
        await using var command = new NpgsqlCommand("""
            INSERT INTO public.tenant_storage_usage(tenant_id) VALUES(@id) ON CONFLICT DO NOTHING;
            SELECT u.database_bytes,u.file_bytes,public.tenant_storage_limit(@id),u.files_measured_at,t.is_root_tenant
            FROM public.tenant_storage_usage u JOIN public.tenants t ON t.id=u.tenant_id WHERE u.tenant_id=@id
            """, connection);
        command.Parameters.AddWithValue("id", id);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) throw new InvalidOperationException("Tenant not found.");
        return new(id, reader.GetInt64(0), reader.GetInt64(1), reader.GetInt64(2), reader.IsDBNull(3) ? null : reader.GetDateTime(3), reader.GetBoolean(4))
        {
            RecentAlerts = await db.AdminNotifications.AsNoTracking().Where(n => n.TenantId == id && n.Type.StartsWith("StorageUsage:"))
                .OrderByDescending(n => n.CreatedAt).Take(5).Select(n => new StorageAlert(n.Message, n.CreatedAt)).ToListAsync(ct)
        };
    }

    // Atomic update serializes with database row triggers, across API instances.
    public async Task ReserveFilesAsync(Guid id, long bytes, CancellationToken ct)
    {
        if (bytes < 0) throw new ArgumentOutOfRangeException(nameof(bytes));
        await using var connection = new NpgsqlConnection(config.GetConnectionString("DefaultConnection"));
        await connection.OpenAsync(ct);
        await using var command = new NpgsqlCommand("""
            INSERT INTO public.tenant_storage_usage(tenant_id) VALUES(@id) ON CONFLICT DO NOTHING;
            UPDATE public.tenant_storage_usage u SET file_bytes=file_bytes+@bytes,
                limit_bytes=public.tenant_storage_limit(@id),updated_at=now()
            WHERE tenant_id=@id AND (EXISTS(SELECT 1 FROM public.tenants WHERE id=@id AND is_root_tenant)
                OR database_bytes+file_bytes+@bytes<=public.tenant_storage_limit(@id)) RETURNING tenant_id
            """, connection);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("bytes", bytes);
        if (await command.ExecuteScalarAsync(ct) is null)
            throw new TenantStorageLimitException();
    }

    public string[] FileRoots(Tenant tenant)
    {
        var web = env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot");
        var uploads = config["Uploads:Root"] ?? Environment.GetEnvironmentVariable("MAHIMA_UPLOADS_ROOT");
        if (string.IsNullOrWhiteSpace(uploads)) uploads = OperatingSystem.IsLinux() ? "/var/www/mahima-uploads" : Path.Combine(web, "uploads");
        var downloads = config["ServerFiles:Root"] ?? Environment.GetEnvironmentVariable("MAHIMA_DOWNLOADS_ROOT");
        if (string.IsNullOrWhiteSpace(downloads)) downloads = OperatingSystem.IsLinux() ? "/var/www/mahima-downloads" : Path.Combine(web, "downloads");
        return new[] { Path.Combine(uploads, "tenants", tenant.Id.ToString("N")),
            Path.Combine(uploads, "tenant-logos", tenant.Slug),
            Path.Combine(downloads, "tenants", tenant.Id.ToString("N")),
            Path.Combine(web, "uploads", "pastor-voice", tenant.Id.ToString("N")),
            Path.Combine(web, "demo-captures", tenant.Id.ToString("N")) };
    }

    public static long DirectoryBytes(string path)
    {
        if (File.Exists(path)) return new FileInfo(path).Length;
        if (!Directory.Exists(path)) return 0;
        return Directory.EnumerateFiles(path, "*", new EnumerationOptions {
            RecurseSubdirectories = true, IgnoreInaccessible = false, AttributesToSkip = FileAttributes.ReparsePoint
        }).Sum(file => new FileInfo(file).Length);
    }

    // Caller holds LockFilesAsync. Failed scans never replace the last known total.
    public async Task ReconcileFilesAsync(Tenant tenant, CancellationToken ct)
    {
        var roots = FileRoots(tenant).Select(Path.GetFullPath).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var bytes = roots.Where(root => !roots.Any(other => other != root && root.StartsWith(other.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)))
            .Sum(DirectoryBytes);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO public.tenant_storage_usage(tenant_id,file_bytes,files_measured_at)
            VALUES({tenant.Id},{bytes},now()) ON CONFLICT(tenant_id) DO UPDATE
            SET file_bytes=excluded.file_bytes,files_measured_at=now(),updated_at=now()
            """, ct);
    }
}

public sealed class TenantStorageLimitException : Exception
{
    public TenantStorageLimitException() : base("Tenant storage allowance exceeded. Delete files or upgrade your package.") { }
}

public sealed class TenantStorageMonitor(IServiceScopeFactory scopes, IConfiguration config, ILogger<TenantStorageMonitor> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<MahimaDbContext>();
                var storage = scope.ServiceProvider.GetRequiredService<TenantStorageService>();
                foreach (var tenant in await db.Tenants.AsNoTracking().ToListAsync(stoppingToken))
                {
                    try
                    {
                        await using var lease = await storage.LockFilesAsync(tenant.Id, stoppingToken);
                        await storage.ReconcileFilesAsync(tenant, stoppingToken);
                        var usage = await storage.GetAsync(tenant.Id, stoppingToken);
                        if (usage.Status is "exempt" or "healthy") continue;
                        var type = $"StorageUsage:{usage.Status}";
                        var since = DateTime.UtcNow.AddDays(-1);
                        if (await db.AdminNotifications.AnyAsync(n => n.TenantId == tenant.Id && n.Type == type && n.CreatedAt > since, stoppingToken)) continue;
                        db.AdminNotifications.Add(new AdminNotification { TenantId = tenant.Id, Type = type,
                            Message = $"Storage usage is {usage.PercentUsed:F1}% ({usage.UsedBytes / 1_000_000_000m:F2} of {usage.LimitBytes / 1_000_000_000m:F2} GB). Delete unused data or upgrade your package.",
                            Data = System.Text.Json.JsonSerializer.Serialize(usage) });
                        await db.SaveChangesAsync(stoppingToken);
                    }
                    catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { throw; }
                    catch (Exception ex) { logger.LogError(ex, "Tenant storage scan failed for {TenantId}", tenant.Id); db.ChangeTracker.Clear(); }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { logger.LogError(ex, "Tenant storage monitoring failed. Verify storage migration is installed."); }
            await Task.Delay(TimeSpan.FromMinutes(Math.Clamp(config.GetValue("TenantStorage:MonitorMinutes", 15), 1, 1440)), stoppingToken);
        }
    }
}
