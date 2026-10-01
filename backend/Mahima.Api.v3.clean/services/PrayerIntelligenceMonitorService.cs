using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace Mahima.Api.v3.clean.Services
{
    public class PrayerIntelligenceMonitorService : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly IHubContext<ChatHub> _hub;
        private readonly IConfiguration _config;
        private readonly ILogger<PrayerIntelligenceMonitorService> _logger;

        public PrayerIntelligenceMonitorService(
            IServiceScopeFactory scopeFactory,
            IHubContext<ChatHub> hub,
            IConfiguration config,
            ILogger<PrayerIntelligenceMonitorService> logger)
        {
            _scopeFactory = scopeFactory;
            _hub = hub;
            _config = config;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            var pollMinutes = Math.Clamp(GetInt("PollMinutes", 60), 5, 1440);
            _logger.LogInformation("Prayer intelligence monitor started. PollMinutes={PollMinutes}", pollMinutes);

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await ProcessUnrespondedPrayersAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Prayer intelligence monitor failed.");
                }

                await Task.Delay(TimeSpan.FromMinutes(pollMinutes), stoppingToken);
            }
        }

        private async Task ProcessUnrespondedPrayersAsync(CancellationToken ct)
        {
            if (!GetBool("Enabled", true)) return;

            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<MahimaDbContext>();
            var chat = scope.ServiceProvider.GetRequiredService<IChatService>();
            var pastorBot = scope.ServiceProvider.GetRequiredService<IPastorBotService>();
            var mobilePush = scope.ServiceProvider.GetServices<IMobilePushNotificationService>().FirstOrDefault();

            await EnsureMonitorSchemaAsync(db, ct);

            var managersByTenant = await LoadCallCenterManagerIdsByTenantAsync(db, ct);
            if (managersByTenant.Count == 0)
            {
                _logger.LogInformation("Prayer intelligence monitor found no users assigned to Call Center Manager position.");
                return;
            }

            var staleAfterHours = Math.Clamp(GetInt("UnrespondedAfterHours", 24), 1, 720);
            var maxPerRun = Math.Clamp(GetInt("MaxPrayersPerRun", 25), 1, 200);
            var cutoffUtc = DateTime.UtcNow.AddHours(-staleAfterHours);

            var duePrayers = await db.PrayerRequests
                .AsNoTracking()
                .Where(p => p.CreatedAt <= cutoffUtc)
                .Where(p => p.Status == null
                    || !new[] { "closed", "answered", "completed", "done", "resolved" }.Contains(p.Status.ToLower()))
                .Where(p => !db.PrayerResponses.Any(r => r.PrayerRequestId == p.Id))
                .OrderBy(p => p.CreatedAt)
                .Take(maxPerRun)
                .Select(p => new PrayerAlertCandidate
                {
                    Id = p.Id,
                    TenantId = p.TenantId,
                    Title = p.Title,
                    Message = p.Message,
                    CreatedBy = p.CreatedBy,
                    CreatedAt = p.CreatedAt
                })
                .ToListAsync(ct);

            if (duePrayers.Count == 0) return;

            var botUserId = await pastorBot.EnsurePastorBotUserAsync(ct);
            foreach (var prayer in duePrayers)
            {
                if (!managersByTenant.TryGetValue(prayer.TenantId, out var managerIds) || managerIds.Count == 0)
                    continue;

                foreach (var managerId in managerIds)
                {
                    if (await AlreadyRemindedTodayAsync(db, prayer.Id, managerId, ct)) continue;

                    var directChat = await chat.CreateOrGetDirectChatAsync(botUserId, managerId);
                    var message = await chat.AddMessageAsync(directChat.Id, botUserId, BuildReminder(prayer, staleAfterHours), "text");
                    await RecordReminderAsync(db, prayer.Id, managerId, message.Id, ct);
                    await _hub.Clients.User(managerId.ToString()).SendAsync("ReceiveMessage", message, ct);
                    if (mobilePush != null)
                    {
                        try
                        {
                            await mobilePush.NotifyChatMessageAsync(directChat.Id, botUserId, new[] { managerId }, message);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Mobile push failed for prayer reminder {PrayerRequestId} to {ManagerId}.", prayer.Id, managerId);
                        }
                    }
                }
            }
        }

        private async Task EnsureMonitorSchemaAsync(MahimaDbContext db, CancellationToken ct)
        {
            const string sql = @"
CREATE TABLE IF NOT EXISTS public.prayer_monitor_reminders (
    id bigserial PRIMARY KEY,
    prayerrequestid bigint NOT NULL REFERENCES public.prayerrequests(id) ON DELETE CASCADE,
    recipientuserid uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    chatmessageid uuid NULL,
    sentatutc timestamp without time zone NOT NULL DEFAULT now(),
    reminderlocaldate date NOT NULL DEFAULT CURRENT_DATE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_prayer_monitor_daily
ON public.prayer_monitor_reminders (prayerrequestid, recipientuserid, reminderlocaldate);

CREATE INDEX IF NOT EXISTS ix_prayer_monitor_prayer_sent
ON public.prayer_monitor_reminders (prayerrequestid, sentatutc DESC);";

            await db.Database.ExecuteSqlRawAsync(sql, ct);
        }

        private async Task<Dictionary<Guid, List<Guid>>> LoadCallCenterManagerIdsByTenantAsync(MahimaDbContext db, CancellationToken ct)
        {
            var conn = db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);
            await Mahima.Api.v3.clean.Controllers.PositionsController.EnsurePositionTablesAsync((NpgsqlConnection)conn);

            // Scope managers to the tenant that owns their position assignment (not the user's own
            // tenant_id directly) so a manager only ever alerts on their own church's prayer wall.
            await using var cmd = new NpgsqlCommand(@"
SELECT DISTINCT p.tenant_id, up.user_id
FROM public.user_positions up
JOIN public.positions p ON p.id = up.position_id AND p.is_active = true
JOIN public.users u ON u.id = up.user_id AND u.tenant_id = p.tenant_id
WHERE lower(regexp_replace(p.name, '[^a-z0-9]+', '', 'g')) IN (
    'callcentermanager',
    'callcentremanager'
);", (NpgsqlConnection)conn);

            var byTenant = new Dictionary<Guid, List<Guid>>();
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync())
            {
                var tenantId = rdr.GetGuid(0);
                var userId = rdr.GetGuid(1);
                if (!byTenant.TryGetValue(tenantId, out var list))
                {
                    list = new List<Guid>();
                    byTenant[tenantId] = list;
                }
                list.Add(userId);
            }
            return byTenant;
        }

        private async Task<bool> AlreadyRemindedTodayAsync(MahimaDbContext db, long prayerRequestId, Guid managerId, CancellationToken ct)
        {
            var conn = db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);

            await using var cmd = new NpgsqlCommand(@"
SELECT EXISTS (
    SELECT 1
    FROM public.prayer_monitor_reminders
    WHERE prayerrequestid = @prayer_id
      AND recipientuserid = @recipient_id
      AND reminderlocaldate = CURRENT_DATE
);", (NpgsqlConnection)conn);
            cmd.Parameters.AddWithValue("prayer_id", NpgsqlDbType.Bigint, prayerRequestId);
            cmd.Parameters.AddWithValue("recipient_id", NpgsqlDbType.Uuid, managerId);
            return Convert.ToBoolean(await cmd.ExecuteScalarAsync(ct));
        }

        private async Task RecordReminderAsync(MahimaDbContext db, long prayerRequestId, Guid managerId, Guid messageId, CancellationToken ct)
        {
            var conn = db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);

            await using var cmd = new NpgsqlCommand(@"
INSERT INTO public.prayer_monitor_reminders
    (prayerrequestid, recipientuserid, chatmessageid, sentatutc, reminderlocaldate)
VALUES
    (@prayer_id, @recipient_id, @message_id, now(), CURRENT_DATE)
ON CONFLICT (prayerrequestid, recipientuserid, reminderlocaldate) DO NOTHING;", (NpgsqlConnection)conn);
            cmd.Parameters.AddWithValue("prayer_id", NpgsqlDbType.Bigint, prayerRequestId);
            cmd.Parameters.AddWithValue("recipient_id", NpgsqlDbType.Uuid, managerId);
            cmd.Parameters.AddWithValue("message_id", NpgsqlDbType.Uuid, messageId);
            await cmd.ExecuteNonQueryAsync(ct);
        }

        private static string BuildReminder(PrayerAlertCandidate prayer, int staleAfterHours)
        {
            var title = string.IsNullOrWhiteSpace(prayer.Title) ? "Untitled prayer request" : prayer.Title.Trim();
            var by = string.IsNullOrWhiteSpace(prayer.CreatedBy) ? "a member" : prayer.CreatedBy.Trim();
            var message = (prayer.Message ?? string.Empty).Trim();
            if (message.Length > 240) message = message.Substring(0, 240).TrimEnd() + "...";

            return
                "Jai Masih Di. Prayer follow-up needed.\n\n" +
                $"Prayer #{prayer.Id}: {title}\n" +
                $"Shared by: {by}\n" +
                $"Waiting since: {prayer.CreatedAt:dd-MMM-yyyy HH:mm} UTC\n" +
                $"No response has been logged for more than {staleAfterHours} hours.\n\n" +
                $"Prayer note: {message}\n\n" +
                "Please respond, assign a follow-up, or close it as answered from the Prayer Wall.";
        }

        private int GetInt(string key, int fallback)
        {
            var raw = _config[$"PrayerIntelligence:{key}"];
            return int.TryParse(raw, out var parsed) ? parsed : fallback;
        }

        private bool GetBool(string key, bool fallback)
        {
            var raw = _config[$"PrayerIntelligence:{key}"];
            return string.IsNullOrWhiteSpace(raw) ? fallback : bool.TryParse(raw, out var parsed) ? parsed : fallback;
        }

        private sealed class PrayerAlertCandidate
        {
            public long Id { get; set; }
            public Guid TenantId { get; set; }
            public string? Title { get; set; }
            public string? Message { get; set; }
            public string? CreatedBy { get; set; }
            public DateTime CreatedAt { get; set; }
        }
    }
}
