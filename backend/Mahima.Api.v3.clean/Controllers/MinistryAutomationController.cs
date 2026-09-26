using System;
using System.Collections.Generic;
using System.Data;
using System.Globalization;
using System.Linq;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Dtos;
using Mahima.Api.v3.clean.Hubs;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Authorize(Roles = "admin,ADMIN")]
    [Route("api/ministry-automation")]
    public class MinistryAutomationController : ControllerBase
    {
        private readonly MahimaDbContext _db;
        private readonly IPastorBotService _pastorBot;
        private readonly IHubContext<ChatHub> _hub;
        private readonly ITenantContextService _tenantContext;
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");
        private const string WelcomeSentUserIdsKey = "NewUserWelcomeSentUserIds";
        private const string WelcomeLastApprovedAtKey = "NewUserWelcomeLastApprovedAtUtc";
        private const string WelcomeLastApprovedCountKey = "NewUserWelcomeLastApprovedCount";
        private const string WelcomeLastApprovedMessageKey = "NewUserWelcomeLastApprovedMessage";

        public MinistryAutomationController(MahimaDbContext db, IPastorBotService pastorBot, IHubContext<ChatHub> hub, ITenantContextService tenantContext)
        {
            _db = db;
            _pastorBot = pastorBot;
            _hub = hub;
            _tenantContext = tenantContext;
        }

        public class NewUserWelcomeDraftRequest
        {
            public DateTime? From { get; set; }
            public DateTime? To { get; set; }
            public List<string>? Languages { get; set; }
            public List<Guid>? UserIds { get; set; }
        }

        public class NewUserWelcomeSendRequest : NewUserWelcomeDraftRequest
        {
            public string? Message { get; set; }
        }

        [HttpGet("settings")]
        public async Task<IActionResult> GetSettings()
        {
            var values = await ReadSettingsAsync();
            return Ok(ToDto(values));
        }

        [HttpPut("settings")]
        public async Task<IActionResult> SaveSettings([FromBody] MinistryAutomationSettingsDto dto)
        {
            var validation = Validate(dto);
            if (!string.IsNullOrWhiteSpace(validation)) return BadRequest(validation);

            var values = new Dictionary<string, string>
            {
                ["Enabled"] = dto.Enabled.ToString(),
                ["TimeZone"] = string.IsNullOrWhiteSpace(dto.TimeZone) ? "Asia/Kolkata" : dto.TimeZone.Trim(),
                ["DailyWordTime"] = dto.DailyWordTime,
                ["WelcomeTime"] = dto.WelcomeTime,
                ["NightPrayerTime"] = dto.NightPrayerTime,
                ["SundayServiceReminderTime"] = dto.SundayServiceReminderTime,
                ["DeliveryWindowMinutes"] = Math.Clamp(dto.DeliveryWindowMinutes, 1, 720).ToString(CultureInfo.InvariantCulture),
                ["DailyWordEnabled"] = dto.DailyWordEnabled.ToString(),
                ["WelcomeEnabled"] = dto.WelcomeEnabled.ToString(),
                ["NightPrayerEnabled"] = dto.NightPrayerEnabled.ToString(),
                ["SundayServiceReminderEnabled"] = dto.SundayServiceReminderEnabled.ToString()
            };

            var tenantId = await GetCurrentTenantIdAsync();
            foreach (var pair in values)
            {
                var setting = await _db.MinistryAutomationSettings.FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Key == pair.Key);
                if (setting == null)
                {
                    _db.MinistryAutomationSettings.Add(new MinistryAutomationSetting
                    {
                        TenantId = tenantId,
                        Key = pair.Key,
                        Value = pair.Value,
                        UpdatedAtUtc = DateTime.UtcNow
                    });
                }
                else
                {
                    setting.Value = pair.Value;
                    setting.UpdatedAtUtc = DateTime.UtcNow;
                }
            }

            await _db.SaveChangesAsync();
            return Ok(ToDto(values));
        }

        [HttpPost("trigger")]
        public async Task<IActionResult> Trigger([FromBody] TriggerMinistryMessageDto dto)
        {
            var messageType = (dto?.MessageType ?? "daily-word").Trim().ToLowerInvariant();
            var nowLocal = DateTime.UtcNow.AddHours(5.5);
            var languages = await ResolveLanguagesAsync(dto?.Languages);
            if (languages.Count == 0) return BadRequest("No requested language is currently enabled.");
            var message = BuildMultilingualMessage(languages, code => MinistryMessageFactory.Build(messageType, nowLocal, code));
            if (string.IsNullOrWhiteSpace(message))
                return BadRequest("Unknown message type.");

            var sent = await _pastorBot.SendJaiMasihMessageAsync(message, HttpContext.RequestAborted);
            await NotifyJaiMasihMembersAsync(sent);
            return Ok(new { sent.ChatId, sent.Id, type = messageType, languages = languages.Select(l => l.Code).ToList() });
        }

        [HttpPost("custom-message")]
        public async Task<IActionResult> SendCustomMessage([FromBody] CustomMinistryMessageDto dto)
        {
            var requestedLanguages = dto?.Languages;
            if ((requestedLanguages == null || requestedLanguages.Count == 0) && !string.IsNullOrWhiteSpace(dto?.Language))
                requestedLanguages = new List<string> { dto!.Language! };

            var languages = await ResolveLanguagesAsync(requestedLanguages);
            if (languages.Count == 0) return BadRequest("No requested language is currently enabled.");
            var fallbackMessage = (dto?.Message ?? string.Empty).Trim();
            var messageMap = new Dictionary<string, string>(dto?.Messages ?? new Dictionary<string, string>(), StringComparer.OrdinalIgnoreCase);
            var message = BuildMultilingualMessage(languages, code =>
            {
                if (messageMap.TryGetValue(code, out var localized) && !string.IsNullOrWhiteSpace(localized))
                    return localized.Trim();

                return fallbackMessage;
            });

            if (string.IsNullOrWhiteSpace(message))
                return BadRequest("Message is required.");
            if (message.Length > 12000)
                return BadRequest("Message is too long. Please keep it below 12000 characters.");

            var sent = await _pastorBot.SendJaiMasihMessageAsync(message, HttpContext.RequestAborted);
            await NotifyJaiMasihMembersAsync(sent);
            return Ok(new { sent.ChatId, sent.Id, type = "custom", languages = languages.Select(l => l.Code).ToList() });
        }

        [HttpGet("runs")]
        public async Task<IActionResult> Runs()
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var runs = await _db.MinistryScheduledMessageRuns
                .AsNoTracking()
                .Where(r => r.TenantId == tenantId)
                .OrderByDescending(r => r.SentAtUtc)
                .Take(50)
                .Select(r => new { r.MessageKey, r.ScheduledLocalDate, r.SentAtUtc })
                .ToListAsync();

            return Ok(runs);
        }

        [HttpGet("new-user-welcome/analytics")]
        public async Task<IActionResult> NewUserWelcomeAnalytics([FromQuery] DateTime? from = null, [FromQuery] DateTime? to = null)
        {
            var (rangeFrom, rangeTo) = NormalizeWelcomeRange(from, to);
            var sentIds = await ReadWelcomeSentUserIdsAsync();
            var allUsers = await QueryWelcomeCandidatesAsync(null, HttpContext.RequestAborted);
            var selected = allUsers
                .Where(u => u.JoinDate >= rangeFrom && u.JoinDate <= rangeTo)
                .OrderByDescending(u => u.JoinDate)
                .ToList();
            var pending = selected.Where(u => !sentIds.Contains(u.Id)).ToList();

            var today = DateTime.UtcNow.Date;
            var weekStart = today.AddDays(-(((int)today.DayOfWeek + 6) % 7));
            var monthStart = new DateTime(today.Year, today.Month, 1, 0, 0, 0, DateTimeKind.Utc);
            var yearStart = new DateTime(today.Year, 1, 1, 0, 0, 0, DateTimeKind.Utc);

            return Ok(new
            {
                range = new
                {
                    from = rangeFrom.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    to = rangeTo.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                },
                totals = new
                {
                    selected = selected.Count,
                    pending = pending.Count,
                    alreadySent = selected.Count - pending.Count,
                    thisWeek = allUsers.Count(u => u.JoinDate >= weekStart),
                    thisMonth = allUsers.Count(u => u.JoinDate >= monthStart),
                    thisYear = allUsers.Count(u => u.JoinDate >= yearStart),
                    allTime = allUsers.Count
                },
                byDay = GroupByDay(selected),
                byWeek = GroupByWeek(selected),
                byMonth = GroupByMonth(allUsers),
                byYear = GroupByYear(allUsers),
                pendingUsers = pending.Select(u => ToWelcomeUserDto(u, false)).ToList(),
                recentSentUsers = allUsers
                    .Where(u => sentIds.Contains(u.Id))
                    .OrderByDescending(u => u.JoinDate)
                    .Take(20)
                    .Select(u => ToWelcomeUserDto(u, true))
                    .ToList()
            });
        }

        [HttpPost("new-user-welcome/draft")]
        public async Task<IActionResult> DraftNewUserWelcome([FromBody] NewUserWelcomeDraftRequest dto)
        {
            var users = await ResolveWelcomeUsersAsync(dto, pendingOnly: true);
            var languages = await ResolveLanguagesAsync(dto?.Languages);
            if (languages.Count == 0) return BadRequest("No requested language is currently enabled.");

            if (users.Count == 0)
            {
                return Ok(new
                {
                    message = string.Empty,
                    count = 0,
                    users = Array.Empty<object>(),
                    languages = languages.Select(l => l.Code).ToList()
                });
            }

            var message = await GenerateWelcomeDraftAsync(users, languages);
            return Ok(new
            {
                message,
                count = users.Count,
                users = users.Select(u => ToWelcomeUserDto(u, false)).ToList(),
                languages = languages.Select(l => l.Code).ToList()
            });
        }

        [HttpPost("new-user-welcome/send")]
        public async Task<IActionResult> SendNewUserWelcome([FromBody] NewUserWelcomeSendRequest dto)
        {
            var message = (dto?.Message ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(message))
                return BadRequest("Approved welcome message is required.");
            if (message.Length > 12000)
                return BadRequest("Approved welcome message is too long. Please keep it below 12000 characters.");

            var hasExplicitUsers = dto?.UserIds != null && dto.UserIds.Count > 0;
            var users = await ResolveWelcomeUsersAsync(dto, pendingOnly: !hasExplicitUsers);
            if (users.Count == 0)
                return BadRequest("No new users were selected for welcome approval.");

            var sent = await _pastorBot.SendJaiMasihMessageAsync(message, HttpContext.RequestAborted);
            await NotifyJaiMasihMembersAsync(sent);

            var sentIds = await ReadWelcomeSentUserIdsAsync();
            foreach (var user in users)
                sentIds.Add(user.Id);

            await UpsertSettingAsync(WelcomeSentUserIdsKey, JsonSerializer.Serialize(sentIds.OrderBy(id => id).ToList()));
            await UpsertSettingAsync(WelcomeLastApprovedAtKey, DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture));
            await UpsertSettingAsync(WelcomeLastApprovedCountKey, users.Count.ToString(CultureInfo.InvariantCulture));
            await UpsertSettingAsync(WelcomeLastApprovedMessageKey, message);
            await _db.SaveChangesAsync(HttpContext.RequestAborted);

            return Ok(new
            {
                sent.ChatId,
                sent.Id,
                count = users.Count,
                userIds = users.Select(u => u.Id).ToList()
            });
        }

        private async Task<Dictionary<string, string>> ReadSettingsAsync()
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var values = await _db.MinistryAutomationSettings
                .AsNoTracking()
                .Where(s => s.TenantId == tenantId)
                .ToDictionaryAsync(s => s.Key, s => s.Value);

            foreach (var pair in Defaults)
                if (!values.ContainsKey(pair.Key)) values[pair.Key] = pair.Value;

            return values;
        }

        private static MinistryAutomationSettingsDto ToDto(IReadOnlyDictionary<string, string> values) =>
            new MinistryAutomationSettingsDto
            {
                Enabled = Bool(values, "Enabled", true),
                TimeZone = Text(values, "TimeZone", "Asia/Kolkata"),
                DailyWordTime = Text(values, "DailyWordTime", "06:30"),
                WelcomeTime = Text(values, "WelcomeTime", "07:00"),
                NightPrayerTime = NormalizeNightPrayerTime(Text(values, "NightPrayerTime", "18:30")),
                SundayServiceReminderTime = Text(values, "SundayServiceReminderTime", "08:00"),
                DeliveryWindowMinutes = Int(values, "DeliveryWindowMinutes", 90),
                DailyWordEnabled = Bool(values, "DailyWordEnabled", true),
                WelcomeEnabled = Bool(values, "WelcomeEnabled", true),
                NightPrayerEnabled = Bool(values, "NightPrayerEnabled", true),
                SundayServiceReminderEnabled = Bool(values, "SundayServiceReminderEnabled", true)
            };

        private static string Validate(MinistryAutomationSettingsDto dto)
        {
            foreach (var value in new[] { dto.DailyWordTime, dto.WelcomeTime, dto.NightPrayerTime, dto.SundayServiceReminderTime })
            {
                if (!TimeSpan.TryParseExact(value, @"hh\:mm", CultureInfo.InvariantCulture, out _))
                    return "Times must be in HH:mm format.";
            }

            return string.Empty;
        }

        private static bool Bool(IReadOnlyDictionary<string, string> values, string key, bool fallback) =>
            values.TryGetValue(key, out var raw) && bool.TryParse(raw, out var parsed) ? parsed : fallback;

        private static int Int(IReadOnlyDictionary<string, string> values, string key, int fallback) =>
            values.TryGetValue(key, out var raw) && int.TryParse(raw, out var parsed) ? parsed : fallback;

        private static string Text(IReadOnlyDictionary<string, string> values, string key, string fallback) =>
            values.TryGetValue(key, out var raw) && !string.IsNullOrWhiteSpace(raw) ? raw : fallback;

        private static string NormalizeNightPrayerTime(string value) =>
            value == "21:30" ? "18:30" : value;

        private static readonly Dictionary<string, string> Defaults = new Dictionary<string, string>
        {
            ["Enabled"] = "true",
            ["TimeZone"] = "Asia/Kolkata",
            ["DailyWordTime"] = "06:30",
            ["WelcomeTime"] = "07:00",
            ["NightPrayerTime"] = "18:30",
            ["SundayServiceReminderTime"] = "08:00",
            ["DeliveryWindowMinutes"] = "90",
            ["DailyWordEnabled"] = "true",
            ["WelcomeEnabled"] = "true",
            ["NightPrayerEnabled"] = "true",
            ["SundayServiceReminderEnabled"] = "true"
        };

        private sealed record LanguageChoice(string Code, string Name);

        private async Task<List<LanguageChoice>> ResolveLanguagesAsync(IEnumerable<string>? requestedCodes)
        {
            var requested = (requestedCodes ?? Array.Empty<string>())
                .Select(code => (code ?? string.Empty).Trim().ToLowerInvariant())
                .Where(code => !string.IsNullOrWhiteSpace(code))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            var enabled = await _db.AppLanguages
                .AsNoTracking()
                .Where(l => l.Enabled)
                .OrderBy(l => l.DisplayOrder)
                .ThenBy(l => l.Name)
                .ToListAsync();

            if (requested.Count == 0)
            {
                var configuredDefault = enabled.FirstOrDefault(l => l.IsDefault) ?? enabled.FirstOrDefault();
                if (configuredDefault != null) requested.Add(configuredDefault.Code);
            }

            var byCode = enabled.ToDictionary(l => l.Code.ToLowerInvariant(), l => l, StringComparer.OrdinalIgnoreCase);
            var result = new List<LanguageChoice>();

            foreach (var code in requested)
            {
                if (byCode.TryGetValue(code, out var language))
                    result.Add(new LanguageChoice(language.Code, string.IsNullOrWhiteSpace(language.Name) ? LanguageName(code) : language.Name));
            }

            return result;
        }

        private static string LanguageName(string code)
        {
            return (code ?? string.Empty).Trim().ToLowerInvariant() switch
            {
                "hi" => "Hindi",
                "pa" => "Punjabi",
                "en" => "English",
                var value when !string.IsNullOrWhiteSpace(value) => value.ToUpperInvariant(),
                _ => "English"
            };
        }

        private static string BuildMultilingualMessage(IEnumerable<LanguageChoice> languages, Func<string, string> build)
        {
            var parts = languages
                .Select(language => new
                {
                    language.Code,
                    language.Name,
                    Message = (build(language.Code) ?? string.Empty).Trim()
                })
                .Where(part => !string.IsNullOrWhiteSpace(part.Message))
                .ToList();

            if (parts.Count == 0) return string.Empty;
            if (parts.Count == 1) return parts[0].Message;

            return string.Join("\n\n", parts.Select(part =>
                $"{part.Name} ({part.Code.ToUpperInvariant()}):\n{part.Message}"));
        }

        private async Task NotifyJaiMasihMembersAsync(MessageDto sent)
        {
            var userIds = await _db.ChatMembers
                .AsNoTracking()
                .Where(cm => cm.ChatId == sent.ChatId)
                .Select(cm => cm.UserId.ToString())
                .Distinct()
                .ToListAsync();

            await _hub.Clients.Users(userIds).SendAsync("ReceiveMessage", sent);
        }

        private Guid GetCurrentUserId() =>
            Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"), out var id)
                ? id
                : Guid.Empty;

        private sealed class WelcomeCandidate
        {
            public Guid Id { get; set; }
            public string Name { get; set; } = string.Empty;
            public string? Username { get; set; }
            public string? Email { get; set; }
            public string? Role { get; set; }
            public DateTime JoinDate { get; set; }
        }

        private async Task<List<WelcomeCandidate>> QueryWelcomeCandidatesAsync(IEnumerable<Guid>? ids, System.Threading.CancellationToken ct)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var idList = (ids ?? Array.Empty<Guid>()).Distinct().ToList();
            var query = _db.Users
                .AsNoTracking()
                .Where(u => u.TenantId == tenantId)
                .Where(u => u.Username != PastorBotService.BotUsername && u.UserCode != PastorBotService.BotUserCode);

            if (idList.Count > 0)
            {
                query = query.Where(u => idList.Contains(u.Id));
            }

            return await query
                .OrderByDescending(u => u.JoinDate)
                .Take(500)
                .Select(u => new WelcomeCandidate
                {
                    Id = u.Id,
                    Name = !string.IsNullOrWhiteSpace(u.DisplayName)
                        ? u.DisplayName!
                        : (!string.IsNullOrWhiteSpace(u.Username)
                            ? u.Username!
                            : (!string.IsNullOrWhiteSpace(u.Email) ? u.Email! : "New member")),
                    Username = u.Username,
                    Email = u.Email,
                    Role = u.Role,
                    JoinDate = u.JoinDate
                })
                .ToListAsync(ct);
        }

        private async Task<List<WelcomeCandidate>> ResolveWelcomeUsersAsync(NewUserWelcomeDraftRequest? dto, bool pendingOnly)
        {
            var explicitIds = (dto?.UserIds ?? new List<Guid>())
                .Where(id => id != Guid.Empty)
                .Distinct()
                .ToList();
            var users = await QueryWelcomeCandidatesAsync(explicitIds.Count > 0 ? explicitIds : null, HttpContext.RequestAborted);

            if (explicitIds.Count == 0)
            {
                var (rangeFrom, rangeTo) = NormalizeWelcomeRange(dto?.From, dto?.To);
                users = users.Where(u => u.JoinDate >= rangeFrom && u.JoinDate <= rangeTo).ToList();
            }

            if (pendingOnly)
            {
                var sentIds = await ReadWelcomeSentUserIdsAsync();
                users = users.Where(u => !sentIds.Contains(u.Id)).ToList();
            }

            return users
                .OrderByDescending(u => u.JoinDate)
                .ThenBy(u => u.Name)
                .ToList();
        }

        private async Task<HashSet<Guid>> ReadWelcomeSentUserIdsAsync()
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var raw = await _db.MinistryAutomationSettings
                .AsNoTracking()
                .Where(s => s.TenantId == tenantId && s.Key == WelcomeSentUserIdsKey)
                .Select(s => s.Value)
                .FirstOrDefaultAsync(HttpContext.RequestAborted);

            if (string.IsNullOrWhiteSpace(raw))
                return new HashSet<Guid>();

            try
            {
                var parsed = JsonSerializer.Deserialize<List<Guid>>(raw);
                return parsed == null ? new HashSet<Guid>() : parsed.ToHashSet();
            }
            catch
            {
                return raw
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Select(value => Guid.TryParse(value, out var id) ? id : Guid.Empty)
                    .Where(id => id != Guid.Empty)
                    .ToHashSet();
            }
        }

        private async Task UpsertSettingAsync(string key, string value)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var setting = await _db.MinistryAutomationSettings.FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Key == key, HttpContext.RequestAborted);
            if (setting == null)
            {
                _db.MinistryAutomationSettings.Add(new MinistryAutomationSetting
                {
                    TenantId = tenantId,
                    Key = key,
                    Value = value,
                    UpdatedAtUtc = DateTime.UtcNow
                });
            }
            else
            {
                setting.Value = value;
                setting.UpdatedAtUtc = DateTime.UtcNow;
            }
        }

        private async Task<Guid> GetCurrentTenantIdAsync()
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
            return tenant?.Id ?? RootTenantId;
        }

        private async Task<string> GenerateWelcomeDraftAsync(IReadOnlyList<WelcomeCandidate> users, IReadOnlyList<LanguageChoice> languages)
        {
            var names = string.Join(", ", users.Select(u => u.Name).Take(40));
            var languageList = string.Join(", ", languages.Select(l => $"{l.Name} ({l.Code})"));
            var prompt =
                $"Create a warm AI Pastor welcome message for the Jai Masih group chat. " +
                $"Welcome these new Mahima Ministry members by name: {names}. " +
                $"Use these languages: {languageList}. " +
                $"Keep it pastoral, joyful, concise, and ready for admin approval. " +
                $"Include one short scripture encouragement, one invitation to fellowship, and a short prayer. " +
                $"Return only the message text.";

            try
            {
                var reply = await _pastorBot.AskAsync(
                    GetCurrentUserId(),
                    prompt,
                    sendToJaiMasih: false,
                    language: "en",
                    persona: "english-teaching-guide",
                    conversation: null,
                    ct: HttpContext.RequestAborted);

                if (string.Equals(reply.Source, "ai", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(reply.Answer))
                    return reply.Answer.Trim();
            }
            catch
            {
                // Fall through to deterministic draft; the admin can still approve and send.
            }

            return BuildFallbackWelcomeDraft(users, languages);
        }

        private static string BuildFallbackWelcomeDraft(IReadOnlyList<WelcomeCandidate> users, IReadOnlyList<LanguageChoice> languages)
        {
            var names = string.Join(", ", users.Select(u => u.Name));
            if (languages.Count == 1 && string.Equals(languages[0].Code, "en", StringComparison.OrdinalIgnoreCase))
            {
                return
                    $"AI Pastor Welcome\n\n" +
                    $"Jai Masih, {names}. Welcome to the Mahima Ministry family. We thank God for bringing you into this fellowship.\n\n" +
                    $"Scripture: \"The Lord bless you and keep you.\" - Numbers 6:24\n\n" +
                    $"May your faith grow stronger, your home be filled with peace, and your walk with Christ be full of grace. We invite you to join us in prayer, worship, service, and loving fellowship.\n\n" +
                    $"Prayer: Lord Jesus, bless every new member, guide their steps, protect their families, and help them feel at home in Your church. Amen.";
            }

            return MinistryMessageFactory.BuildNewUserWelcome(names);
        }

        private static (DateTime FromUtc, DateTime ToUtc) NormalizeWelcomeRange(DateTime? from, DateTime? to)
        {
            var today = DateTime.UtcNow.Date;
            var fromDate = (from?.Date ?? today.AddDays(-30));
            var toDate = (to?.Date ?? today);

            if (toDate < fromDate)
                (fromDate, toDate) = (toDate, fromDate);

            return (
                DateTime.SpecifyKind(fromDate, DateTimeKind.Utc),
                DateTime.SpecifyKind(toDate.AddDays(1).AddTicks(-1), DateTimeKind.Utc)
            );
        }

        private static object ToWelcomeUserDto(WelcomeCandidate user, bool alreadySent) =>
            new
            {
                user.Id,
                displayName = user.Name,
                user.Username,
                user.Email,
                user.Role,
                joinDate = user.JoinDate,
                alreadySent
            };

        private static IEnumerable<object> GroupByDay(IEnumerable<WelcomeCandidate> users) =>
            users
                .GroupBy(u => u.JoinDate.Date)
                .OrderBy(g => g.Key)
                .Select(g => new
                {
                    label = g.Key.ToString("dd MMM", CultureInfo.InvariantCulture),
                    date = g.Key.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    count = g.Count()
                });

        private static IEnumerable<object> GroupByWeek(IEnumerable<WelcomeCandidate> users) =>
            users
                .GroupBy(u => u.JoinDate.Date.AddDays(-(((int)u.JoinDate.DayOfWeek + 6) % 7)))
                .OrderBy(g => g.Key)
                .Select(g => new
                {
                    label = $"{g.Key:dd MMM} - {g.Key.AddDays(6):dd MMM yyyy}",
                    startDate = g.Key.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    count = g.Count()
                });

        private static IEnumerable<object> GroupByMonth(IEnumerable<WelcomeCandidate> users) =>
            users
                .GroupBy(u => new DateTime(u.JoinDate.Year, u.JoinDate.Month, 1))
                .OrderBy(g => g.Key)
                .Select(g => new
                {
                    label = g.Key.ToString("MMM yyyy", CultureInfo.InvariantCulture),
                    month = g.Key.ToString("yyyy-MM", CultureInfo.InvariantCulture),
                    count = g.Count()
                });

        private static IEnumerable<object> GroupByYear(IEnumerable<WelcomeCandidate> users) =>
            users
                .GroupBy(u => u.JoinDate.Year)
                .OrderBy(g => g.Key)
                .Select(g => new
                {
                    label = g.Key.ToString(CultureInfo.InvariantCulture),
                    year = g.Key,
                    count = g.Count()
                });
    }
}
