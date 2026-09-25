using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Dtos;
using Mahima.Api.v3.clean.Hubs;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Services.Ai;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Mahima.Api.v3.clean.Services
{
    public class ChatSafetyMonitorService : BackgroundService
    {
        private const string ProtectedContentPrefix = "dp:v1:";
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<ChatSafetyMonitorService> _logger;
        private readonly IDataProtector _messageProtector;
        private readonly TimeSpan _interval;
        private readonly bool _enabled;
        private readonly bool _aiEnabled;
        private readonly bool _pastorFollowupEnabled;
        private readonly int _batchSize;

        public ChatSafetyMonitorService(
            IServiceScopeFactory scopeFactory,
            IDataProtectionProvider dataProtectionProvider,
            IConfiguration configuration,
            ILogger<ChatSafetyMonitorService> logger)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
            _messageProtector = dataProtectionProvider.CreateProtector("Mahima.Api.Chat.MessageContent.v1");
            _enabled = configuration.GetValue("ChatSafety:Enabled", true);
            _aiEnabled = configuration.GetValue("ChatSafety:AiEnabled", true);
            _pastorFollowupEnabled = configuration.GetValue("ChatSafety:PastorFollowupEnabled", true);
            _batchSize = Math.Clamp(configuration.GetValue("ChatSafety:BatchSize", 50), 5, 250);
            _interval = TimeSpan.FromSeconds(Math.Clamp(configuration.GetValue("ChatSafety:PollSeconds", 45), 10, 600));
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!_enabled)
            {
                _logger.LogInformation("Chat safety monitor is disabled.");
                return;
            }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await RunOnceAsync(stoppingToken);
                    if (_pastorFollowupEnabled)
                        await SendPendingPastorFollowupsAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Chat safety monitor failed.");
                }

                await Task.Delay(_interval, stoppingToken);
            }
        }

        public async Task<int> RunOnceAsync(CancellationToken ct)
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<MahimaDbContext>();
            var pastorBot = scope.ServiceProvider.GetRequiredService<IPastorBotService>();
            var chatService = scope.ServiceProvider.GetRequiredService<IChatService>();
            var hub = scope.ServiceProvider.GetRequiredService<IHubContext<ChatHub>>();
            var mobilePush = scope.ServiceProvider.GetServices<IMobilePushNotificationService>().FirstOrDefault();
            var notifications = scope.ServiceProvider.GetRequiredService<INotificationDispatcher>();
            var llm = scope.ServiceProvider.GetService<ILlmProvider>();

            await EnsureTablesAsync(db, ct);

            var pendingIds = await LoadPendingMessageIdsAsync(db, _batchSize, ct);
            if (pendingIds.Count == 0) return 0;
            var processed = 0;

            var messages = await db.Messages
                .AsNoTracking()
                .Include(m => m.Sender)
                .Include(m => m.Chat)
                .Where(m => pendingIds.Contains(m.Id))
                .OrderBy(m => m.CreatedAt)
                .ToListAsync(ct);

            foreach (var message in messages)
            {
                ct.ThrowIfCancellationRequested();

                var plainText = UnprotectMessageContent(message.Content);
                var context = await BuildConversationContextAsync(db, message.ChatId, message.CreatedAt, ct);
                var analysis = AnalyzeWithRules(plainText, message.ContentType, message.AttachmentUrl);

                if (_aiEnabled && llm?.IsConfigured == true && ShouldAskAi(analysis, plainText))
                {
                    analysis = await TryAnalyzeWithAiAsync(llm, plainText, context, message.ContentType, message.AttachmentUrl, analysis, ct);
                }

                if (analysis.ShouldAlert)
                {
                    var alert = new ChatSafetyAlert
                    {
                        MessageId = message.Id,
                        ChatId = message.ChatId,
                        SenderId = message.SenderId,
                        Category = analysis.Category,
                        Severity = analysis.Severity,
                        AlertLevel = analysis.AlertLevel,
                        Confidence = analysis.Confidence,
                        Summary = analysis.Summary,
                        EvidenceSnippet = BuildSnippet(plainText),
                        ConversationSnippet = BuildSnippet(context, 900),
                        CreatedAtUtc = DateTime.UtcNow
                    };

                    await InsertAlertAsync(db, alert, ct);

                    if (_pastorFollowupEnabled && ShouldSendPastorFollowup(alert))
                    {
                        alert.PastorFollowupSent = await TrySendPastorFollowupAsync(pastorBot, chatService, hub, mobilePush, message.SenderId, alert, ct);
                        if (alert.PastorFollowupSent)
                            await MarkPastorFollowupSentAsync(db, message.Id, ct);
                    }

                    await EscalateToAdminsAsync(notifications, message.Chat?.TenantId, alert, ct);
                }

                await InsertScanAsync(db, message.Id, _aiEnabled && llm?.IsConfigured == true ? "rules+ai" : "rules", ct);
                processed++;
            }

            return processed;
        }

        public async Task<int> RunFullScanAsync(int maxBatches = 40, CancellationToken ct = default)
        {
            var total = 0;
            for (var i = 0; i < Math.Clamp(maxBatches, 1, 200); i++)
            {
                var scanned = await RunOnceAsync(ct);
                total += scanned;
                if (scanned == 0) break;
            }
            return total;
        }

        public async Task<int> SendPendingPastorFollowupsAsync(CancellationToken ct = default)
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<MahimaDbContext>();
            var pastorBot = scope.ServiceProvider.GetRequiredService<IPastorBotService>();
            var chatService = scope.ServiceProvider.GetRequiredService<IChatService>();
            var hub = scope.ServiceProvider.GetRequiredService<IHubContext<ChatHub>>();
            var mobilePush = scope.ServiceProvider.GetServices<IMobilePushNotificationService>().FirstOrDefault();

            await EnsureTablesAsync(db, ct);
            var alerts = await LoadPendingFollowupAlertsAsync(db, 50, ct);
            var sent = 0;

            foreach (var alert in alerts)
            {
                if (await TrySendPastorFollowupAsync(pastorBot, chatService, hub, mobilePush, alert.SenderId, alert, ct))
                {
                    await MarkPastorFollowupSentAsync(db, alert.MessageId, ct);
                    sent++;
                }
            }

            return sent;
        }

        private static async Task<List<Guid>> LoadPendingMessageIdsAsync(MahimaDbContext db, int limit, CancellationToken ct)
        {
            var ids = new List<Guid>();
            var conn = db.Database.GetDbConnection();
            if (conn.State != System.Data.ConnectionState.Open)
                await conn.OpenAsync(ct);

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
SELECT m.id
FROM public.messages m
JOIN public.users u ON u.id = m.senderid
LEFT JOIN public.chat_safety_scans s ON s.message_id = m.id
WHERE s.message_id IS NULL
  AND NOT (
      lower(coalesce(u.username, '')) = 'pastor.bot'
      OR upper(coalesce(u.""UserCode"", '')) = 'BOTPASTOR'
      OR lower(coalesce(u.email, '')) = 'pastor.bot@mahimaministries.local'
      OR lower(coalesce(u.displayname, '')) IN ('ai counseller', 'ai pastor')
  )
ORDER BY m.createdat ASC
LIMIT @limit;";
            var limitParam = cmd.CreateParameter();
            limitParam.ParameterName = "limit";
            limitParam.Value = limit;
            cmd.Parameters.Add(limitParam);

            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                ids.Add(rdr.GetGuid(0));

            return ids;
        }

        private static Task InsertAlertAsync(MahimaDbContext db, ChatSafetyAlert alert, CancellationToken ct) =>
            db.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO public.chat_safety_alerts
    (message_id, chat_id, sender_id, category, severity, alert_level, security_escalation, confidence, summary, evidence_snippet, conversation_snippet, pastor_followup_sent, is_resolved, created_at_utc)
VALUES
    ({alert.MessageId}, {alert.ChatId}, {alert.SenderId}, {alert.Category}, {alert.Severity}, {alert.AlertLevel}, {IsSecurityEscalation(alert.Category, alert.Severity, alert.AlertLevel)}, {alert.Confidence}, {alert.Summary}, {alert.EvidenceSnippet}, {alert.ConversationSnippet}, {alert.PastorFollowupSent}, {alert.IsResolved}, {alert.CreatedAtUtc})
ON CONFLICT (message_id) DO NOTHING;", ct);

        private static Task MarkPastorFollowupSentAsync(MahimaDbContext db, Guid messageId, CancellationToken ct) =>
            db.Database.ExecuteSqlInterpolatedAsync($@"
UPDATE public.chat_safety_alerts
SET pastor_followup_sent = true
WHERE message_id = {messageId};", ct);

        private static Task InsertScanAsync(MahimaDbContext db, Guid messageId, string engine, CancellationToken ct) =>
            db.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO public.chat_safety_scans (message_id, scanned_at_utc, engine)
VALUES ({messageId}, {DateTime.UtcNow}, {engine})
ON CONFLICT (message_id) DO NOTHING;", ct);

        private static async Task<List<ChatSafetyAlert>> LoadPendingFollowupAlertsAsync(MahimaDbContext db, int limit, CancellationToken ct)
        {
            var alerts = new List<ChatSafetyAlert>();
            var conn = db.Database.GetDbConnection();
            if (conn.State != System.Data.ConnectionState.Open)
                await conn.OpenAsync(ct);

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
SELECT id, message_id, chat_id, sender_id, category, severity, alert_level, security_escalation, confidence, summary
FROM public.chat_safety_alerts
WHERE is_resolved = false
  AND pastor_followup_sent = false
ORDER BY created_at_utc DESC
LIMIT @limit;";
            var limitParam = cmd.CreateParameter();
            limitParam.ParameterName = "limit";
            limitParam.Value = limit;
            cmd.Parameters.Add(limitParam);

            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                alerts.Add(new ChatSafetyAlert
                {
                    Id = Convert.ToInt64(rdr["id"]),
                    MessageId = (Guid)rdr["message_id"],
                    ChatId = (Guid)rdr["chat_id"],
                    SenderId = (Guid)rdr["sender_id"],
                    Category = rdr["category"]?.ToString() ?? "policy",
                    Severity = rdr["severity"]?.ToString() ?? "medium",
                    AlertLevel = rdr["alert_level"]?.ToString() ?? "admin",
                    Confidence = rdr["confidence"] == DBNull.Value ? 0 : Convert.ToDecimal(rdr["confidence"]),
                    Summary = rdr["summary"]?.ToString() ?? "Chat safety policy alert"
                });
            }

            return alerts;
        }

        public static Task EnsureTablesAsync(MahimaDbContext db, CancellationToken ct = default) =>
            db.Database.ExecuteSqlRawAsync(@"
CREATE TABLE IF NOT EXISTS public.chat_safety_alerts (
    id bigserial PRIMARY KEY,
    message_id uuid NOT NULL UNIQUE,
    chat_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    category text NOT NULL,
    severity text NOT NULL,
    alert_level text NOT NULL,
    security_escalation boolean NOT NULL DEFAULT false,
    confidence numeric(5,2) NOT NULL DEFAULT 0,
    summary text NOT NULL,
    evidence_snippet text NULL,
    conversation_snippet text NULL,
    pastor_followup_sent boolean NOT NULL DEFAULT false,
    is_resolved boolean NOT NULL DEFAULT false,
    created_at_utc timestamp with time zone NOT NULL DEFAULT now(),
    resolved_at_utc timestamp with time zone NULL
);

CREATE TABLE IF NOT EXISTS public.chat_safety_scans (
    message_id uuid PRIMARY KEY,
    scanned_at_utc timestamp with time zone NOT NULL DEFAULT now(),
    engine text NOT NULL DEFAULT 'rules'
);

ALTER TABLE public.chat_safety_alerts
    ADD COLUMN IF NOT EXISTS conversation_snippet text NULL,
    ADD COLUMN IF NOT EXISTS security_escalation boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS ix_chat_safety_alerts_open_level_created
    ON public.chat_safety_alerts(is_resolved, alert_level, created_at_utc DESC);
CREATE INDEX IF NOT EXISTS ix_chat_safety_alerts_sender_created
    ON public.chat_safety_alerts(sender_id, created_at_utc DESC);

INSERT INTO public.chat_safety_scans (message_id, scanned_at_utc, engine)
SELECT m.id, now(), 'system-excluded'
FROM public.messages m
JOIN public.users u ON u.id = m.senderid
WHERE (
    lower(coalesce(u.username, '')) = 'pastor.bot'
    OR upper(coalesce(u.""UserCode"", '')) = 'BOTPASTOR'
    OR lower(coalesce(u.email, '')) = 'pastor.bot@mahimaministries.local'
    OR lower(coalesce(u.displayname, '')) IN ('ai counseller', 'ai pastor')
)
ON CONFLICT (message_id) DO NOTHING;

UPDATE public.chat_safety_alerts a
SET is_resolved = true,
    resolved_at_utc = COALESCE(a.resolved_at_utc, now()),
    summary = CASE
        WHEN a.summary ILIKE '%Auto-resolved: AI Pastor/system message excluded from safety scan.%' THEN a.summary
        ELSE a.summary || ' (Auto-resolved: AI Pastor/system message excluded from safety scan.)'
    END
FROM public.users u
WHERE a.sender_id = u.id
  AND a.is_resolved = false
  AND (
      lower(coalesce(u.username, '')) = 'pastor.bot'
      OR upper(coalesce(u.""UserCode"", '')) = 'BOTPASTOR'
      OR lower(coalesce(u.email, '')) = 'pastor.bot@mahimaministries.local'
      OR lower(coalesce(u.displayname, '')) IN ('ai counseller', 'ai pastor')
  );", cancellationToken: ct);

        private string? UnprotectMessageContent(string? content)
        {
            if (string.IsNullOrEmpty(content)) return content;
            if (!content.StartsWith(ProtectedContentPrefix, StringComparison.Ordinal)) return content;

            try
            {
                return _messageProtector.Unprotect(content.Substring(ProtectedContentPrefix.Length));
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not decrypt message for chat safety scan.");
                return null;
            }
        }

        private async Task<string> BuildConversationContextAsync(MahimaDbContext db, Guid chatId, DateTime createdAt, CancellationToken ct)
        {
            var systemSenderIds = await db.Users
                .AsNoTracking()
                .Where(u =>
                    u.Username == PastorBotService.BotUsername ||
                    u.UserCode == PastorBotService.BotUserCode ||
                    u.Email == "pastor.bot@mahimaministries.local" ||
                    u.DisplayName == "AI Counseller" ||
                    u.DisplayName == "AI Pastor")
                .Select(u => u.Id)
                .ToListAsync(ct);

            var messages = await db.Messages
                .AsNoTracking()
                .Where(m => m.ChatId == chatId && m.CreatedAt <= createdAt && !systemSenderIds.Contains(m.SenderId))
                .OrderByDescending(m => m.CreatedAt)
                .Take(8)
                .OrderBy(m => m.CreatedAt)
                .ToListAsync(ct);

            return string.Join("\n", messages.Select(m =>
            {
                var text = BuildSnippet(UnprotectMessageContent(m.Content)) ?? "";
                var senderKey = m.SenderId.ToString();
                if (senderKey.Length > 8) senderKey = senderKey.Substring(0, 8);
                return $"{m.CreatedAt:HH:mm} user:{senderKey} {text}";
            }));
        }

        private static ChatSafetyAnalysis AnalyzeWithRules(string? text, string? contentType, string? attachmentUrl)
        {
            var body = (text ?? string.Empty).ToLowerInvariant();
            var hasMedia = IsMedia(contentType, attachmentUrl);
            var hits = new List<(string Category, string Severity, string AlertLevel, decimal Confidence, string Summary)>();

            AddIf(hits, body, "self_harm", "critical", "special_user", 0.92m,
                "Possible self-harm or severe depression language.",
                "suicide", "kill myself", "end my life", "want to die", "can't live", "no reason to live", "self harm", "cut myself",
                "hang myself", "poison myself", "jump off", "mar jaunga", "mar jaungi", "marna chahta", "marna chahti", "jaan de dunga",
                "khud ko maar", "aatmahatya", "atmahatya", "suicide kar", "फांसी", "आत्महत्या", "मर जाऊंगा", "मर जाऊंगी", "ਜ਼ਹਿਰ", "ਖੁਦਕੁਸ਼ੀ", "ਆਤਮਹੱਤਿਆ");

            AddIf(hits, body, "depression", "high", "admin", 0.78m,
                "Possible depression, hopelessness, or emotional crisis language.",
                "depressed", "hopeless", "worthless", "empty inside", "panic", "anxiety", "can't sleep", "crying every day",
                "akela", "akeli", "tanha", "dukhi", "nirash", "pareshan", "zindagi khatam", "jeena nahi", "जीना नहीं", "निराश", "अकेला", "दुखी", "ਤਨਹਾ", "ਨਿਰਾਸ਼");

            AddIf(hits, body, "terrorism_or_national_security", "critical", "special_user", 0.93m,
                "Possible terrorism, weapon planning, or national-security risk language.",
                "terrorist", "terrorism", "bomb", "explosive", "attack plan", "plant a bomb", "join jihad", "isis", "al qaeda", "kill citizens", "destroy the country",
                "grenade", "rDX", "ak47", "rifle", "pistol", "gun", "shooting", "blast", "hamla", "dhamaka", "desh tod", "desh ke khilaf",
                "aatank", "aatankwadi", "jihad", "border attack", "army camp", "आतंक", "आतंकवादी", "बम", "धमाका", "देश के खिलाफ", "ਹਮਲਾ", "ਬੰਬ", "ਅੱਤਵਾਦੀ");

            AddIf(hits, body, "violence", "critical", "special_user", 0.90m,
                "Possible threat or planned act of violence.",
                "i will kill", "going to kill", "shoot them", "stab", "burn the church", "attack christians", "beat him", "beat her", "murder",
                "kill", "killing", "murder", "maar dunga", "maar dungi", "kaat dunga", "goli maar", "chaku", "jala dunga", "khoon kar", "pitai",
                "हत्या", "मार दूंगा", "मार दूंगी", "खून", "गोली", "चाकू", "जला दूंगा", "ਕਤਲ", "ਗੋਲੀ", "ਚਾਕੂ", "ਮਾਰ ਦਿਆਂਗਾ", "ਮਾਰ ਦਿਆਂਗੀ");

            AddIf(hits, body, "abuse_or_harassment", "high", "admin", 0.82m,
                "Possible abuse, bullying, coercion, or harassment.",
                "abuse", "blackmail", "threaten", "harass", "slap", "hit you", "force you", "shut up or else",
                "gaali", "gali", "behenchod", "bhenchod", "madarchod", "mc", "bc", "chutiya", "harami", "kutta", "kamina", "kutti", "randi",
                "blackmail kar", "dhamki", "dowry", "dahej", "dahej lao", "दहेज", "धमकी", "गाली", "हरामी", "कमीना", "कुत्ता", "ਕੁੱਤਾ", "ਧਮਕੀ", "ਦਾਜ");

            AddIf(hits, body, "sexual_content_or_dating", "medium", "admin", 0.72m,
                "Possible sexual, dating, or immoral relationship discussion requiring pastoral review.",
                "sex", "dating", "affair", "lust", "hookup", "nude", "send pic", "porn", "pornography", "xxx",
                "sexy", "nangi photo", "nanga", "ashleel", "blue film", "adult video", "rape", "molest", "छेड़छाड़", "बलात्कार", "अश्लील", "ਨੰਗੀ", "ਅਸ਼ਲੀਲ");

            AddIf(hits, body, "anti_christian_hate", "high", "admin", 0.80m,
                "Possible targeted hate, threat, or harassment against Christians or church members.",
                "kill christians", "attack church", "burn bible", "destroy church", "hate christians", "church jala", "masihi ko maar", "christian ko maar",
                "चर्च जल", "मसीही को मार", "ईसाई को मार", "ਕਲੀਸਿਆ ਸਾੜ", "ਮਸੀਹੀ ਨੂੰ ਮਾਰ");

            AddIf(hits, body, "anti_social_or_crime", "high", "admin", 0.80m,
                "Possible anti-social, criminal, coercive, or exploitation language.",
                "kidnap", "kidnapping", "loot", "robbery", "steal", "theft", "drug", "drugs", "ganja", "charas", "smack", "bribe", "ransom",
                "kidnap kar", "loot lo", "chori", "rishwat", "nasha", "nashe", "अपहरण", "लूट", "चोरी", "नशा", "रिश्वत", "ਅਗਵਾ", "ਲੁੱਟ", "ਚੋਰੀ", "ਨਸ਼ਾ", "ਰਿਸ਼ਵਤ");

            if (hasMedia && ContainsAny(body, "nude", "porn", "xxx", "sex video", "private photo"))
            {
                hits.Add(("sexual_media", "critical", "admin", 0.88m, "Possible pornographic or sexually explicit media upload."));
            }

            if (hits.Count == 0) return ChatSafetyAnalysis.NoAlert();

            var top = hits
                .OrderByDescending(h => SeverityRank(h.Severity))
                .ThenByDescending(h => h.Confidence)
                .First();

            return new ChatSafetyAnalysis(true, top.Category, top.Severity, top.AlertLevel, top.Confidence, top.Summary);
        }

        private static bool ShouldAskAi(ChatSafetyAnalysis analysis, string? text) =>
            analysis.ShouldAlert || !string.IsNullOrWhiteSpace(text) && text.Length >= 40;

        private static async Task<ChatSafetyAnalysis> TryAnalyzeWithAiAsync(
            ILlmProvider llm,
            string? text,
            string? conversationContext,
            string? contentType,
            string? attachmentUrl,
            ChatSafetyAnalysis fallback,
            CancellationToken ct)
        {
            var prompt = @$"
Classify this church community chat message for safety triage.
Return only compact JSON with:
shouldAlert boolean, category string, severity low|medium|high|critical,
alertLevel admin|special_user, confidence 0-1, summary string.

Flag self-harm, severe depression, abuse/harassment, sexual exploitation/content, pornographic media indicators,
credible violence, terrorism/national-security threats, or targeted anti-Christian hate.
Do not flag ordinary disagreement, normal criticism, political opinion, or theological questions unless it includes threats, hate, harassment, or incitement.

contentType: {contentType ?? "text"}
attachmentUrlPresent: {!string.IsNullOrWhiteSpace(attachmentUrl)}
recentConversation:
{conversationContext ?? string.Empty}

message: {text ?? string.Empty}";

            try
            {
                var result = await llm.CompleteAsync(new LlmRequest
                {
                    Temperature = 0.1,
                    MaxTokens = 180,
                    Messages =
                    {
                        LlmMessage.System("You are a cautious safety classifier. Prefer false negatives for vague criticism; prefer alerts for credible harm or exploitation."),
                        LlmMessage.User(prompt)
                    }
                }, ct);

                if (!result.Success || string.IsNullOrWhiteSpace(result.Text)) return fallback;

                var json = ExtractJson(result.Text);
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                var shouldAlert = root.TryGetProperty("shouldAlert", out var sa) && sa.GetBoolean();
                if (!shouldAlert) return ChatSafetyAnalysis.NoAlert();

                var category = ReadString(root, "category", fallback.Category);
                var severity = NormalizeSeverity(ReadString(root, "severity", fallback.Severity));
                var alertLevel = NormalizeAlertLevel(ReadString(root, "alertLevel", fallback.AlertLevel), severity, category);
                var confidence = root.TryGetProperty("confidence", out var c) && c.TryGetDecimal(out var dec)
                    ? Math.Clamp(dec <= 1 ? dec : dec / 100, 0, 1)
                    : fallback.Confidence;
                var summary = ReadString(root, "summary", fallback.Summary);

                return new ChatSafetyAnalysis(true, category, severity, alertLevel, confidence, summary);
            }
            catch
            {
                return fallback;
            }
        }

        private static async Task<bool> TrySendPastorFollowupAsync(
            IPastorBotService pastorBot,
            IChatService chatService,
            IHubContext<ChatHub> hub,
            IMobilePushNotificationService? mobilePush,
            Guid userId,
            ChatSafetyAlert alert,
            CancellationToken ct)
        {
            try
            {
                var botUserId = await pastorBot.EnsurePastorBotUserAsync(ct);
                var prompt =
                    "Create a short, private, non-judgmental pastoral care message for a user whose chat may indicate " +
                    $"{alert.Category}. Do not mention monitoring, accusation, punishment, or the exact flagged words. " +
                    "Encourage prayer, hope, speaking to a trusted pastor, and emergency help if there is immediate danger.";

                var reply = await pastorBot.AskAsync(userId, prompt, sendToJaiMasih: false, ct: ct);
                var directChat = await chatService.CreateOrGetDirectChatAsync(botUserId, userId);
                var message = await chatService.AddMessageAsync(directChat.Id, botUserId, reply.Answer, "text");
                await hub.Clients.User(userId.ToString()).SendAsync("ReceiveMessage", message, ct);
                await hub.Clients.User(botUserId.ToString()).SendAsync("ReceiveMessage", message, ct);

                if (mobilePush != null)
                    await mobilePush.NotifyChatMessageAsync(directChat.Id, botUserId, new[] { userId }, message);

                return true;
            }
            catch
            {
                return false;
            }
        }

        private static bool ShouldSendPastorFollowup(ChatSafetyAlert alert) => true;

        private async Task EscalateToAdminsAsync(INotificationDispatcher notifications, Guid? tenantId, ChatSafetyAlert alert, CancellationToken ct)
        {
            try
            {
                var effectiveTenantId = tenantId ?? RootTenantId;
                var message = $"A flagged chat message needs review: {alert.Summary} " +
                              $"(category: {alert.Category}, severity: {alert.Severity}).";

                await notifications.EnqueueAsync(new NotificationRequest(
                    TenantId: effectiveTenantId,
                    Kind: "chat-safety-alert",
                    Subject: "Mahima chat safety alert",
                    Message: message,
                    TargetGroup: "tenant-admins",
                    DedupeKey: $"chat-safety:{alert.MessageId}"), ct);

                if (IsSecurityEscalation(alert.Category, alert.Severity, alert.AlertLevel))
                {
                    await notifications.EnqueueAsync(new NotificationRequest(
                        TenantId: effectiveTenantId,
                        Kind: "chat-safety-alert-severe",
                        Subject: "Mahima chat safety alert (severe)",
                        Message: message,
                        TargetGroup: "root-admins",
                        DedupeKey: $"chat-safety-severe:{alert.MessageId}"), ct);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not escalate chat safety alert for message {MessageId}.", alert.MessageId);
            }
        }

        private static bool IsMedia(string? contentType, string? url)
        {
            var value = $"{contentType} {url}".ToLowerInvariant();
            return value.Contains("image/") || value.Contains("video/") || value.EndsWith(".jpg") || value.EndsWith(".jpeg")
                || value.EndsWith(".png") || value.EndsWith(".mp4") || value.EndsWith(".mov");
        }

        private static void AddIf(List<(string, string, string, decimal, string)> hits, string body, string category, string severity, string alertLevel, decimal confidence, string summary, params string[] terms)
        {
            if (ContainsAny(body, terms)) hits.Add((category, severity, alertLevel, confidence, summary));
        }

        private static bool ContainsAny(string body, params string[] terms) =>
            terms.Any(t => body.Contains(t, StringComparison.OrdinalIgnoreCase));

        private static int SeverityRank(string severity) => severity switch
        {
            "critical" => 4,
            "high" => 3,
            "medium" => 2,
            _ => 1
        };

        private static string NormalizeSeverity(string value) =>
            value?.ToLowerInvariant() switch
            {
                "critical" => "critical",
                "high" => "high",
                "medium" => "medium",
                _ => "low"
            };

        private static string NormalizeAlertLevel(string value, string severity, string category)
        {
            if (value?.Equals("special_user", StringComparison.OrdinalIgnoreCase) == true) return "special_user";
            if (severity == "critical" || category.Contains("terrorism", StringComparison.OrdinalIgnoreCase) || category.Contains("violence", StringComparison.OrdinalIgnoreCase))
                return "special_user";
            return "admin";
        }

        private static bool IsSecurityEscalation(string category, string severity, string alertLevel) =>
            alertLevel == "special_user"
            || severity == "critical"
            || category.Contains("terrorism", StringComparison.OrdinalIgnoreCase)
            || category.Contains("national_security", StringComparison.OrdinalIgnoreCase)
            || category.Contains("violence", StringComparison.OrdinalIgnoreCase);

        private static string ReadString(JsonElement root, string name, string fallback) =>
            root.TryGetProperty(name, out var prop) && prop.ValueKind == JsonValueKind.String
                ? prop.GetString() ?? fallback
                : fallback;

        private static string ExtractJson(string text)
        {
            var match = Regex.Match(text, "\\{[\\s\\S]*\\}");
            return match.Success ? match.Value : text;
        }

        private static string? BuildSnippet(string? text, int maxLength = 180)
        {
            if (string.IsNullOrWhiteSpace(text)) return null;
            var clean = Regex.Replace(text.Trim(), "\\s+", " ");
            if (clean.Length <= maxLength) return clean;
            return clean.Substring(0, Math.Max(0, maxLength - 3)) + "...";
        }

        private sealed record ChatSafetyAnalysis(
            bool ShouldAlert,
            string Category,
            string Severity,
            string AlertLevel,
            decimal Confidence,
            string Summary)
        {
            public static ChatSafetyAnalysis NoAlert() => new(false, "none", "low", "admin", 0, string.Empty);
        }
    }
}
