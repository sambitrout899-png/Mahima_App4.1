using Mahima.Api.v3.clean.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.Data;
using System.Data.Common;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Services
{
    // Polls NotificationQueue (see NotificationQueue.cs) and delivers each row
    // via INotificationDelivery. Same claim-and-lock mechanism as
    // TaskAutomationQueueService: a CTE + FOR UPDATE SKIP LOCKED claim, plus
    // Status/AttemptCount/LastError lifecycle with a 5-attempt retry cap.
    public sealed class NotificationDispatchWorker : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly IConfiguration _config;
        private readonly ILogger<NotificationDispatchWorker> _logger;

        public NotificationDispatchWorker(
            IServiceScopeFactory scopeFactory,
            IConfiguration config,
            ILogger<NotificationDispatchWorker> logger)
        {
            _scopeFactory = scopeFactory;
            _config = config;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            var pollSeconds = Math.Clamp(GetInt("Notifications:PollSeconds", 60), 15, 3600);
            _logger.LogInformation("Notification dispatch worker started. PollSeconds={PollSeconds}", pollSeconds);

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await ProcessDueAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Notification dispatch worker failed.");
                }

                await Task.Delay(TimeSpan.FromSeconds(pollSeconds), stoppingToken);
            }
        }

        private int GetInt(string key, int fallback) => int.TryParse(_config[key], out var value) ? value : fallback;

        private async Task ProcessDueAsync(CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<MahimaDbContext>();
            var delivery = scope.ServiceProvider.GetRequiredService<INotificationDelivery>();

            var conn = db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open)
                await conn.OpenAsync(ct);

            await NotificationQueueSchema.EnsureAsync(conn, ct);

            var rows = await ClaimDueRowsAsync(conn, ct);
            foreach (var row in rows)
            {
                try
                {
                    await ProcessOneAsync(db, delivery, row, ct);
                    await MarkSentAsync(conn, row.Id, ct);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Notification queue item {Id} failed.", row.Id);
                    await MarkFailedAsync(conn, row.Id, ex.Message, ct);
                }
            }
        }

        private static async Task<IReadOnlyList<QueueRow>> ClaimDueRowsAsync(DbConnection conn, CancellationToken ct)
        {
            var rows = new List<QueueRow>();
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
WITH due AS (
    SELECT ""Id""
    FROM public.""NotificationQueue""
    WHERE ""Status"" = 'pending'
      AND ""ScheduledAtUtc"" <= now()
    ORDER BY ""ScheduledAtUtc"", ""Id""
    LIMIT 25
    FOR UPDATE SKIP LOCKED
)
UPDATE public.""NotificationQueue"" q
SET ""Status"" = 'processing',
    ""AttemptCount"" = ""AttemptCount"" + 1,
    ""UpdatedAtUtc"" = now()
FROM due
WHERE q.""Id"" = due.""Id""
RETURNING q.""Id"", q.""TenantId"", q.""Kind"", q.""Subject"", q.""Message"", q.""TargetUserId"", q.""TargetGroup"";";
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                rows.Add(new QueueRow(
                    reader.GetInt64(0),
                    reader.GetGuid(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetString(4),
                    reader.IsDBNull(5) ? null : reader.GetGuid(5),
                    reader.IsDBNull(6) ? null : reader.GetString(6)));
            }
            return rows;
        }

        private static async Task ProcessOneAsync(MahimaDbContext db, INotificationDelivery delivery, QueueRow row, CancellationToken ct)
        {
            var recipientIds = new List<Guid>();
            if (row.TargetUserId.HasValue) recipientIds.Add(row.TargetUserId.Value);
            if (!string.IsNullOrWhiteSpace(row.TargetGroup))
                recipientIds.AddRange(await delivery.ResolveGroupUserIdsAsync(row.TenantId, row.TargetGroup, ct));

            recipientIds = recipientIds.Distinct().ToList();
            if (recipientIds.Count == 0) return;

            var emails = await db.Users.AsNoTracking()
                .Where(u => recipientIds.Contains(u.Id) && u.Email != null)
                .Select(u => u.Email!)
                .ToListAsync(ct);

            await delivery.SendBulkEmailAsync(emails, row.Subject, row.Message, ct);

            foreach (var userId in recipientIds)
                await delivery.SendJaiMasihDirectAsync(row.TenantId, userId, row.Message, row.Kind, ct);
        }

        private static async Task MarkSentAsync(DbConnection conn, long queueId, CancellationToken ct)
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
UPDATE public.""NotificationQueue""
SET ""Status"" = 'sent',
    ""SentAtUtc"" = now(),
    ""LastError"" = NULL,
    ""UpdatedAtUtc"" = now()
WHERE ""Id"" = @id;";
            var p = cmd.CreateParameter(); p.ParameterName = "id"; p.Value = queueId; cmd.Parameters.Add(p);
            await cmd.ExecuteNonQueryAsync(ct);
        }

        private static async Task MarkFailedAsync(DbConnection conn, long queueId, string error, CancellationToken ct)
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
UPDATE public.""NotificationQueue""
SET ""Status"" = CASE WHEN ""AttemptCount"" >= 5 THEN 'failed' ELSE 'pending' END,
    ""LastError"" = @error,
    ""UpdatedAtUtc"" = now()
WHERE ""Id"" = @id;";
            var p1 = cmd.CreateParameter(); p1.ParameterName = "id"; p1.Value = queueId; cmd.Parameters.Add(p1);
            var p2 = cmd.CreateParameter(); p2.ParameterName = "error"; p2.Value = error.Length > 1000 ? error.Substring(0, 1000) : error; cmd.Parameters.Add(p2);
            await cmd.ExecuteNonQueryAsync(ct);
        }

        private sealed record QueueRow(
            long Id, Guid TenantId, string Kind, string Subject, string Message,
            Guid? TargetUserId, string? TargetGroup);
    }
}
