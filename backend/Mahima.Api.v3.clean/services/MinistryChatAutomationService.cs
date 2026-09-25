using System;
using System.Collections.Generic;
using System.Data;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Dtos;
using Mahima.Api.v3.clean.Hubs;
using Mahima.Api.v3.clean.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Mahima.Api.v3.clean.Services
{
    public class MinistryChatAutomationService : BackgroundService
    {
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly IHubContext<ChatHub> _hub;
        private readonly IConfiguration _config;
        private readonly ILogger<MinistryChatAutomationService> _logger;

        public MinistryChatAutomationService(
            IServiceScopeFactory scopeFactory,
            IHubContext<ChatHub> hub,
            IConfiguration config,
            ILogger<MinistryChatAutomationService> logger)
        {
            _scopeFactory = scopeFactory;
            _hub = hub;
            _config = config;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            var pollSeconds = Math.Clamp(GetInt("PollSeconds", 60), 15, 3600);
            _logger.LogInformation("Ministry chat automation started. PollSeconds={PollSeconds}", pollSeconds);

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await ProcessDueMessagesAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Ministry chat automation failed.");
                }

                await Task.Delay(TimeSpan.FromSeconds(pollSeconds), stoppingToken);
            }
        }

        private async Task ProcessDueMessagesAsync(CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<MahimaDbContext>();
            var tenantSettings = await ReadSettingsByTenantAsync(db, ct);

            foreach (var tenantEntry in tenantSettings)
            {
                await ProcessDueMessagesForTenantAsync(scope.ServiceProvider, db, tenantEntry.Key, tenantEntry.Value, ct);
            }
        }

        private async Task ProcessDueMessagesForTenantAsync(
            IServiceProvider serviceProvider,
            MahimaDbContext db,
            Guid tenantId,
            IReadOnlyDictionary<string, string> settings,
            CancellationToken ct)
        {
            if (!GetBool(settings, "Enabled", true)) return;
            var nowLocal = GetLocalNow(settings);
            var pastorBot = serviceProvider.GetRequiredService<IPastorBotService>();
            var mobilePush = serviceProvider.GetServices<IMobilePushNotificationService>().FirstOrDefault();
            var delivery = serviceProvider.GetRequiredService<INotificationDelivery>();
            var languages = await db.AppLanguages.AsNoTracking()
                .Where(l => l.Enabled)
                .OrderByDescending(l => l.IsDefault)
                .ThenBy(l => l.DisplayOrder)
                .Select(l => new ValueTuple<string, string>(l.Code, l.Name))
                .ToListAsync(ct);
            if (languages.Count == 0)
            {
                _logger.LogWarning("Scheduled messages skipped because no application language is enabled.");
                return;
            }

            await ProcessBirthdayGreetingsAsync(db, pastorBot, mobilePush, delivery, tenantId, settings, nowLocal, ct);

            var candidates = BuildSchedules(nowLocal, settings, languages)
                .Where(s => IsDue(nowLocal, s, settings))
                .ToList();
            if (candidates.Count == 0) return;

            foreach (var schedule in candidates)
            {
                if (await AlreadySentAsync(db, tenantId, schedule.Key, nowLocal.Date, ct)) continue;

                var content = schedule.BuildMessage(nowLocal);
                MessageDto sent = await pastorBot.SendJaiMasihMessageAsync(content, tenantId, ct);
                await RecordSentAsync(db, tenantId, schedule.Key, nowLocal.Date, ct);
                await NotifyChatAsync(db, sent, mobilePush, delivery, ScheduleSubject(schedule.Key), ct);

                _logger.LogInformation("Sent scheduled Jai Masih message {MessageKey} for tenant {TenantId} on {LocalDate}", schedule.Key, tenantId, nowLocal.Date);
            }
        }

        private async Task ProcessBirthdayGreetingsAsync(
            MahimaDbContext db,
            IPastorBotService pastorBot,
            IMobilePushNotificationService? mobilePush,
            INotificationDelivery delivery,
            Guid tenantId,
            IReadOnlyDictionary<string, string> settings,
            DateTime nowLocal,
            CancellationToken ct)
        {
            if (!GetBool(settings, "BirthdayGreetingEnabled", true))
                return;

            var birthdayUsers = new List<(Guid Id, string? DisplayName, string? Username)>();
            var conn = db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open)
                await conn.OpenAsync(ct);

            await using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = @"
SELECT id, displayname, username, ""Birthday""
FROM public.users
WHERE tenant_id = @tenantId AND ""Birthday"" IS NOT NULL";
                var tenantParam = cmd.CreateParameter();
                tenantParam.ParameterName = "tenantId";
                tenantParam.Value = tenantId;
                cmd.Parameters.Add(tenantParam);
                await using var reader = await cmd.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                {
                    if (reader.IsDBNull(0) || reader.IsDBNull(3)) continue;
                    var birthday = reader.GetDateTime(3);
                    if (birthday.Month == nowLocal.Month && birthday.Day == nowLocal.Day)
                    {
                        birthdayUsers.Add((
                            reader.GetGuid(0),
                            reader.IsDBNull(1) ? null : reader.GetString(1),
                            reader.IsDBNull(2) ? null : reader.GetString(2)));
                    }
                }
            }

            foreach (var user in birthdayUsers)
            {
                var key = $"birthday-greeting:{user.Id}";
                if (await AlreadySentAsync(db, tenantId, key, nowLocal.Date, ct)) continue;

                var name = string.IsNullOrWhiteSpace(user.DisplayName) ? user.Username : user.DisplayName;
                var content =
                    $"Birthday Blessings - {name}\n\n" +
                    $"Jai Masih Di, {name}. The Mahima family thanks God for your life today. " +
                    "May the Lord bless you, keep you, strengthen your faith, and fill this new year with wisdom, peace, and fruitfulness.\n\n" +
                    "Scripture: \"The Lord bless you and keep you; the Lord make his face shine on you and be gracious to you.\" - Numbers 6:24-25\n\n" +
                    "With love and prayers,\nAI Counseller";

                MessageDto sent = await pastorBot.SendJaiMasihMessageAsync(content, tenantId, ct);
                await RecordSentAsync(db, tenantId, key, nowLocal.Date, ct);
                await NotifyChatAsync(db, sent, mobilePush, delivery, $"Happy Birthday, {name}!", ct);

                _logger.LogInformation("Sent birthday Jai Masih greeting for {UserId} on {LocalDate}", user.Id, nowLocal.Date);
            }
        }

        private async Task NotifyChatAsync(
            MahimaDbContext db, MessageDto message, IMobilePushNotificationService? mobilePush,
            INotificationDelivery delivery, string subject, CancellationToken ct)
        {
            var memberIds = await db.ChatMembers
                .AsNoTracking()
                .Where(cm => cm.ChatId == message.ChatId)
                .Select(cm => cm.UserId)
                .Distinct()
                .ToListAsync(ct);

            if (memberIds.Count == 0) return;

            await _hub.Clients.Users(memberIds.Select(id => id.ToString()).ToList())
                .SendAsync("ReceiveMessage", message, ct);

            if (mobilePush != null)
            {
                try
                {
                    await mobilePush.NotifyChatMessageAsync(message.ChatId, message.SenderId, memberIds, message);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Mobile push failed for ministry broadcast in chat {ChatId}", message.ChatId);
                }
            }

            var emails = await db.Users.AsNoTracking()
                .Where(u => memberIds.Contains(u.Id) && u.Email != null)
                .Select(u => u.Email!)
                .ToListAsync(ct);

            await delivery.SendBulkEmailAsync(emails, subject, message.Content ?? "", ct);
        }

        private static string ScheduleSubject(string key) => key switch
        {
            "daily-word" => "Today's Word",
            "welcome" => "Welcome",
            "night-prayer" => "Night Prayer",
            "saturday-church-reminder" => "Saturday Reminder",
            _ => "Mahima Ministry Update"
        };

        private async Task<bool> AlreadySentAsync(MahimaDbContext db, Guid tenantId, string key, DateTime localDate, CancellationToken ct)
        {
            return await db.MinistryScheduledMessageRuns
                .AsNoTracking()
                .AnyAsync(r => r.TenantId == tenantId && r.MessageKey == key && r.ScheduledLocalDate == localDate, ct);
        }

        private static async Task RecordSentAsync(MahimaDbContext db, Guid tenantId, string key, DateTime localDate, CancellationToken ct)
        {
            db.MinistryScheduledMessageRuns.Add(new MinistryScheduledMessageRun
            {
                TenantId = tenantId,
                MessageKey = key,
                ScheduledLocalDate = localDate,
                SentAtUtc = DateTime.UtcNow
            });
            await db.SaveChangesAsync(ct);
        }

        private IReadOnlyList<ScheduledMessage> BuildSchedules(DateTime nowLocal, IReadOnlyDictionary<string, string> settings, IReadOnlyList<(string Code, string Name)> languages)
        {
            var list = new List<ScheduledMessage>();

            if (GetBool(settings, "DailyWordEnabled", true))
                list.Add(new ScheduledMessage("daily-word", GetTime(settings, "DailyWordTime", "06:30"), _ => BuildDefaultMultilingualMessage("daily-word", nowLocal, languages)));

            if (GetBool(settings, "WelcomeEnabled", true))
                list.Add(new ScheduledMessage("welcome", GetTime(settings, "WelcomeTime", "07:00"), _ => BuildDefaultMultilingualMessage("welcome", nowLocal, languages)));

            if (GetBool(settings, "NightPrayerEnabled", true))
            {
                list.Add(new ScheduledMessage("night-prayer", GetNightPrayerTime(settings), _ => BuildDefaultMultilingualMessage("night-prayer", nowLocal, languages))
                {
                    DaysOfWeek = new HashSet<DayOfWeek> { DayOfWeek.Tuesday, DayOfWeek.Friday }
                });
            }

            if (GetBool(settings, "SaturdayReminderEnabled", true))
            {
                list.Add(new ScheduledMessage("saturday-church-reminder", GetTime(settings, "SaturdayReminderTime", "18:00"), _ => BuildDefaultMultilingualMessage("saturday-church-reminder", nowLocal, languages))
                {
                    DaysOfWeek = new HashSet<DayOfWeek> { DayOfWeek.Saturday }
                });
            }

            return list;
        }

        private static string BuildDefaultMultilingualMessage(string messageType, DateTime nowLocal, IReadOnlyList<(string Code, string Name)> languages)
        {
            return string.Join("\n\n", languages.Select(language =>
                $"{language.Name} ({language.Code.ToUpperInvariant()}):\n{MinistryMessageFactory.Build(messageType, nowLocal, language.Code)}"));
        }

        private bool IsDue(DateTime nowLocal, ScheduledMessage schedule, IReadOnlyDictionary<string, string> settings)
        {
            if (schedule.DaysOfWeek != null && !schedule.DaysOfWeek.Contains(nowLocal.DayOfWeek))
                return false;

            var deliveryWindowMinutes = Math.Clamp(GetInt(settings, "DeliveryWindowMinutes", 90), 1, 720);
            var scheduledAt = nowLocal.Date.Add(schedule.LocalTime);
            if (nowLocal < scheduledAt) return false;
            if (string.Equals(schedule.Key, "daily-word", StringComparison.OrdinalIgnoreCase))
                return nowLocal.Date == scheduledAt.Date;
            return nowLocal <= scheduledAt.AddMinutes(deliveryWindowMinutes);
        }

        private DateTime GetLocalNow(IReadOnlyDictionary<string, string> settings)
        {
            var tzId = Text(settings, "TimeZone", _config["MinistryAutomation:TimeZone"] ?? "Asia/Kolkata");
            try
            {
                var tz = TimeZoneInfo.FindSystemTimeZoneById(tzId);
                return TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz);
            }
            catch
            {
                try
                {
                    var tz = TimeZoneInfo.FindSystemTimeZoneById("India Standard Time");
                    return TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz);
                }
                catch
                {
                    return DateTime.UtcNow.AddHours(5.5);
                }
            }
        }

        private TimeSpan GetTime(IReadOnlyDictionary<string, string> settings, string key, string fallback)
        {
            var value = Text(settings, key, _config[$"MinistryAutomation:{key}"] ?? fallback);
            return TimeSpan.TryParseExact(value, @"hh\:mm", CultureInfo.InvariantCulture, out var time)
                ? time
                : TimeSpan.ParseExact(fallback, @"hh\:mm", CultureInfo.InvariantCulture);
        }

        private TimeSpan GetNightPrayerTime(IReadOnlyDictionary<string, string> settings)
        {
            var value = Text(settings, "NightPrayerTime", _config["MinistryAutomation:NightPrayerTime"] ?? "18:30");
            if (value == "21:30") value = "18:30";
            return TimeSpan.TryParseExact(value, @"hh\:mm", CultureInfo.InvariantCulture, out var time)
                ? time
                : TimeSpan.ParseExact("18:30", @"hh\:mm", CultureInfo.InvariantCulture);
        }

        private bool GetBool(IReadOnlyDictionary<string, string> settings, string key, bool fallback)
        {
            if (settings.TryGetValue(key, out var settingValue) && bool.TryParse(settingValue, out var parsed))
                return parsed;
            return bool.TryParse(_config[$"MinistryAutomation:{key}"], out var value) ? value : fallback;
        }

        private int GetInt(IReadOnlyDictionary<string, string> settings, string key, int fallback)
        {
            if (settings.TryGetValue(key, out var settingValue) && int.TryParse(settingValue, out var parsed))
                return parsed;
            return int.TryParse(_config[$"MinistryAutomation:{key}"], out var value) ? value : fallback;
        }

        private int GetInt(string key, int fallback)
        {
            return int.TryParse(_config[$"MinistryAutomation:{key}"], out var value) ? value : fallback;
        }

        private static string Text(IReadOnlyDictionary<string, string> settings, string key, string fallback)
        {
            return settings.TryGetValue(key, out var raw) && !string.IsNullOrWhiteSpace(raw) ? raw : fallback;
        }

        private static async Task<IReadOnlyDictionary<Guid, IReadOnlyDictionary<string, string>>> ReadSettingsByTenantAsync(MahimaDbContext db, CancellationToken ct)
        {
            var rows = await db.MinistryAutomationSettings
                .AsNoTracking()
                .ToListAsync(ct);

            return rows
                .GroupBy(s => s.TenantId)
                .ToDictionary(
                    g => g.Key,
                    g => (IReadOnlyDictionary<string, string>)g
                        .GroupBy(s => s.Key)
                        .ToDictionary(x => x.Key, x => x.OrderByDescending(s => s.UpdatedAtUtc).First().Value));
        }

        private sealed class ScheduledMessage
        {
            public ScheduledMessage(string key, TimeSpan localTime, Func<DateTime, string> buildMessage)
            {
                Key = key;
                LocalTime = localTime;
                BuildMessage = buildMessage;
            }

            public string Key { get; }
            public TimeSpan LocalTime { get; }
            public Func<DateTime, string> BuildMessage { get; }
            public HashSet<DayOfWeek>? DaysOfWeek { get; set; }
        }
    }

}
