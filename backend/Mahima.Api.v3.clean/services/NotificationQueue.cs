using Mahima.Api.v3.clean.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using System;
using System.Data;
using System.Data.Common;
using System.Threading;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Services
{
    // A notification to deliver via every channel INotificationDelivery knows
    // about (email + Jai Masih chat/push), to either one user (TargetUserId) or
    // a resolvable group (TargetGroup - "tenant-admins" | "root-admins" |
    // "tenant-members" | "position:{name}" | "team:{id}"). DedupeKey is optional
    // and, when set, prevents the same (TenantId, Kind, DedupeKey) from being
    // enqueued twice - the mechanism that keeps a recurring poller (subscription
    // renewal, security posture) from re-notifying every cycle.
    public record NotificationRequest(
        Guid TenantId,
        string Kind,
        string Subject,
        string Message,
        Guid? TargetUserId = null,
        string? TargetGroup = null,
        string? DedupeKey = null,
        DateTime? ScheduledAtUtc = null);

    public interface INotificationDispatcher
    {
        Task EnqueueAsync(NotificationRequest request, CancellationToken ct = default);
    }

    internal static class NotificationQueueSchema
    {
        public static async Task EnsureAsync(DbConnection conn, CancellationToken ct)
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
CREATE TABLE IF NOT EXISTS public.""NotificationQueue"" (
    ""Id"" bigserial PRIMARY KEY,
    ""TenantId"" uuid NOT NULL,
    ""Kind"" text NOT NULL,
    ""Subject"" text NOT NULL,
    ""Message"" text NOT NULL,
    ""TargetUserId"" uuid NULL,
    ""TargetGroup"" text NULL,
    ""DedupeKey"" text NULL,
    ""Status"" text NOT NULL DEFAULT 'pending',
    ""AttemptCount"" integer NOT NULL DEFAULT 0,
    ""LastError"" text NULL,
    ""ScheduledAtUtc"" timestamp with time zone NOT NULL DEFAULT now(),
    ""SentAtUtc"" timestamp with time zone NULL,
    ""CreatedAtUtc"" timestamp with time zone NOT NULL DEFAULT now(),
    ""UpdatedAtUtc"" timestamp with time zone NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_notification_queue_dedupe
    ON public.""NotificationQueue"" (""TenantId"", ""Kind"", ""DedupeKey"") WHERE ""DedupeKey"" IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_notification_queue_due
    ON public.""NotificationQueue"" (""Status"", ""ScheduledAtUtc"");";
            await cmd.ExecuteNonQueryAsync(ct);
        }
    }

    public class NotificationDispatcher : INotificationDispatcher
    {
        private readonly MahimaDbContext _db;
        private readonly ILogger<NotificationDispatcher> _logger;

        public NotificationDispatcher(MahimaDbContext db, ILogger<NotificationDispatcher> logger)
        {
            _db = db;
            _logger = logger;
        }

        public async Task EnqueueAsync(NotificationRequest request, CancellationToken ct = default)
        {
            if (request.TargetUserId == null && string.IsNullOrWhiteSpace(request.TargetGroup))
            {
                _logger.LogWarning("Dropping notification {Kind}: no TargetUserId or TargetGroup specified.", request.Kind);
                return;
            }

            var conn = _db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);
            await NotificationQueueSchema.EnsureAsync(conn, ct);

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
INSERT INTO public.""NotificationQueue""
(""TenantId"", ""Kind"", ""Subject"", ""Message"", ""TargetUserId"", ""TargetGroup"", ""DedupeKey"", ""ScheduledAtUtc"")
VALUES (@tenantId, @kind, @subject, @message, @targetUserId, @targetGroup, @dedupeKey, @scheduledAt)
ON CONFLICT (""TenantId"", ""Kind"", ""DedupeKey"") WHERE ""DedupeKey"" IS NOT NULL DO NOTHING;";

            void AddParam(string name, object? value)
            {
                var p = cmd.CreateParameter();
                p.ParameterName = name;
                p.Value = value ?? DBNull.Value;
                cmd.Parameters.Add(p);
            }

            AddParam("tenantId", request.TenantId);
            AddParam("kind", request.Kind);
            AddParam("subject", request.Subject);
            AddParam("message", request.Message);
            AddParam("targetUserId", request.TargetUserId);
            AddParam("targetGroup", request.TargetGroup);
            AddParam("dedupeKey", request.DedupeKey);
            AddParam("scheduledAt", request.ScheduledAtUtc ?? DateTime.UtcNow);

            await cmd.ExecuteNonQueryAsync(ct);
        }
    }
}
