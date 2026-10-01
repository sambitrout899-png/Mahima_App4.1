using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Security.Claims;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Extensions;
using Mahima.Api.v3.clean.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Mahima.Api.v3.clean.Services
{
    public static class AuditTrail
    {
        private static readonly HashSet<string> SensitiveNames = new(StringComparer.OrdinalIgnoreCase)
        {
            "password", "passwordhash", "token", "refreshtoken", "accesstoken", "authorization",
            "secret", "apikey", "api_key", "otp", "pin", "aadharnumber", "aadhar", "content"
        };

        public static bool IsSensitive(string? name)
        {
            if (string.IsNullOrWhiteSpace(name)) return false;
            return SensitiveNames.Any(s => name.IndexOf(s, StringComparison.OrdinalIgnoreCase) >= 0);
        }

        public static object? SafeValue(string propertyName, object? value)
        {
            if (value == null) return null;
            if (IsSensitive(propertyName)) return "[redacted]";
            if (value is string s && s.Length > 300) return s[..300] + "...";
            return value;
        }

        public static string ToJson(object value)
        {
            return JsonSerializer.Serialize(value, new JsonSerializerOptions
            {
                WriteIndented = false,
                DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
            });
        }

        public static Guid? CurrentActorId(IHttpContextAccessor accessor)
        {
            var user = accessor.HttpContext?.User;
            if (user == null) return null;
            var id = user.GetUserIdGuid();
            return id == Guid.Empty ? null : id;
        }

        public static string? CurrentActorName(IHttpContextAccessor accessor)
        {
            var user = accessor.HttpContext?.User;
            return user?.Identity?.Name
                ?? user?.FindFirstValue(ClaimTypes.Name)
                ?? user?.FindFirstValue("username")
                ?? user?.FindFirstValue("email");
        }
    }

    public sealed class AuditSaveChangesInterceptor : SaveChangesInterceptor
    {
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly ILogger<AuditSaveChangesInterceptor> _logger;

        public AuditSaveChangesInterceptor(IHttpContextAccessor httpContextAccessor, ILogger<AuditSaveChangesInterceptor> logger)
        {
            _httpContextAccessor = httpContextAccessor;
            _logger = logger;
        }

        public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
        {
            AddEntityAuditLogs(eventData.Context);
            return base.SavingChanges(eventData, result);
        }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            AddEntityAuditLogs(eventData.Context);
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }

        private void AddEntityAuditLogs(DbContext? db)
        {
            if (db == null) return;

            try
            {
                var entries = db.ChangeTracker.Entries()
                    .Where(e => e.Entity is not AuditLog)
                    .Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted)
                    .Where(e => e.Entity.GetType().Name != "AuditLog")
                    .ToList();

                if (entries.Count == 0) return;

                var actorId = AuditTrail.CurrentActorId(_httpContextAccessor);
                var http = _httpContextAccessor.HttpContext;

                foreach (var entry in entries)
                {
                    var entityName = entry.Metadata.ClrType.Name;
                    var action = entry.State.ToString();
                    var entityId = GetEntityId(entry);
                    var changes = BuildChanges(entry);

                    db.Set<AuditLog>().Add(new AuditLog
                    {
                        ActorId = actorId,
                        Action = $"Entity{action}",
                        EntityType = entityName,
                        EntityId = entityId,
                        Details = AuditTrail.ToJson(new
                        {
                            action,
                            entity = entityName,
                            entityId,
                            path = http?.Request?.Path.Value,
                            method = http?.Request?.Method,
                            actor = AuditTrail.CurrentActorName(_httpContextAccessor),
                            changes
                        }),
                        CreatedAt = DateTime.UtcNow
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to create entity audit records.");
            }
        }

        private static string? GetEntityId(EntityEntry entry)
        {
            var keys = entry.Metadata.FindPrimaryKey()?.Properties;
            if (keys == null || keys.Count == 0) return null;

            var values = keys
                .Select(p => entry.Property(p.Name).CurrentValue ?? entry.Property(p.Name).OriginalValue)
                .Where(v => v != null)
                .Select(v => Convert.ToString(v))
                .Where(v => !string.IsNullOrWhiteSpace(v))
                .ToArray();

            return values.Length == 0 ? null : string.Join(",", values);
        }

        private static object BuildChanges(EntityEntry entry)
        {
            if (entry.State == EntityState.Added)
            {
                return entry.Properties.ToDictionary(
                    p => p.Metadata.Name,
                    p => AuditTrail.SafeValue(p.Metadata.Name, p.CurrentValue));
            }

            if (entry.State == EntityState.Deleted)
            {
                return entry.Properties.ToDictionary(
                    p => p.Metadata.Name,
                    p => AuditTrail.SafeValue(p.Metadata.Name, p.OriginalValue));
            }

            return entry.Properties
                .Where(p => p.IsModified)
                .ToDictionary(
                    p => p.Metadata.Name,
                    p => new
                    {
                        oldValue = AuditTrail.SafeValue(p.Metadata.Name, p.OriginalValue),
                        newValue = AuditTrail.SafeValue(p.Metadata.Name, p.CurrentValue)
                    });
        }
    }

    public sealed class AuditTrailMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly ILogger<AuditTrailMiddleware> _logger;
        private readonly IServiceScopeFactory _scopeFactory;

        public AuditTrailMiddleware(
            RequestDelegate next,
            ILogger<AuditTrailMiddleware> logger,
            IServiceScopeFactory scopeFactory)
        {
            _next = next;
            _logger = logger;
            _scopeFactory = scopeFactory;
        }

        public async Task InvokeAsync(HttpContext context)
        {
            var sw = Stopwatch.StartNew();
            Exception? failure = null;

            try
            {
                await _next(context);
            }
            catch (Exception ex)
            {
                failure = ex;
                throw;
            }
            finally
            {
                sw.Stop();
                await WriteRequestAuditAsync(context, sw.ElapsedMilliseconds, failure);
            }
        }

        private async Task WriteRequestAuditAsync(HttpContext context, long elapsedMs, Exception? failure)
        {
            try
            {
                if (!ShouldAudit(context)) return;

                // Never reuse the request DbContext here. A failed endpoint can leave
                // stale Modified/Deleted entries tracked, causing an audit save to
                // replay the endpoint's failed database operations.
                using var scope = _scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<MahimaDbContext>();
                var method = context.Request.Method;
                var path = context.Request.Path.Value ?? "";
                var actorId = context.User?.GetUserIdGuid();
                if (actorId == Guid.Empty) actorId = null;

                db.AuditLogs.Add(new AuditLog
                {
                    ActorId = actorId,
                    Action = $"Http{method}",
                    EntityType = "HttpRequest",
                    EntityId = null,
                    Details = AuditTrail.ToJson(new
                    {
                        method,
                        path,
                        query = RedactQuery(context.Request.QueryString.Value),
                        statusCode = context.Response?.StatusCode,
                        elapsedMs,
                        ip = context.Connection.RemoteIpAddress?.ToString(),
                        userAgent = context.Request.Headers.UserAgent.ToString(),
                        actor = context.User?.Identity?.Name,
                        failed = failure != null,
                        error = failure == null ? null : failure.GetType().Name
                    }),
                    CreatedAt = DateTime.UtcNow
                });

                await db.SaveChangesAsync(CancellationToken.None);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to write HTTP audit record.");
            }
        }

        private static bool ShouldAudit(HttpContext context)
        {
            var path = context.Request.Path.Value ?? "";
            if (!path.StartsWith("/api", StringComparison.OrdinalIgnoreCase)) return false;
            if (path.StartsWith("/api/hubs", StringComparison.OrdinalIgnoreCase)) return false;
            if (path.StartsWith("/api/audit-trail", StringComparison.OrdinalIgnoreCase)) return false;

            var method = context.Request.Method;
            return HttpMethods.IsPost(method)
                || HttpMethods.IsPut(method)
                || HttpMethods.IsPatch(method)
                || HttpMethods.IsDelete(method);
        }

        private static string? RedactQuery(string? query)
        {
            if (string.IsNullOrWhiteSpace(query)) return null;
            if (AuditTrail.IsSensitive(query)) return "[redacted]";
            return query.Length > 500 ? query[..500] + "..." : query;
        }
    }
}
