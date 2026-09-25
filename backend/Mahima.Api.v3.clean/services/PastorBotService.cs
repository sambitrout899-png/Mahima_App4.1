using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Dtos;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Services.Ai;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Mahima.Api.v3.clean.Services
{
    public class PastorBotService : IPastorBotService
    {
        public const string BotUsername = "pastor.bot";
        public const string BotUserCode = "BOTPASTOR";
        public const string JaiMasihChatName = "Jai Masih";
        public const string InternationalChatName = "Praise The Lord";
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");

        private readonly MahimaDbContext _db;
        private readonly IChatService _chatService;
        private readonly ITenantContextService _tenantContext;
        private readonly ILlmProvider _llmProvider;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _config;
        private readonly ILogger<PastorBotService> _logger;

        public PastorBotService(
            MahimaDbContext db,
            IChatService chatService,
            ITenantContextService tenantContext,
            ILlmProvider llmProvider,
            IHttpClientFactory httpClientFactory,
            IConfiguration config,
            ILogger<PastorBotService> logger)
        {
            _db = db;
            _chatService = chatService;
            _tenantContext = tenantContext;
            _llmProvider = llmProvider;
            _httpClientFactory = httpClientFactory;
            _config = config;
            _logger = logger;
        }

        public async Task<Guid> EnsurePastorBotUserAsync(CancellationToken ct = default)
        {
            var tenantId = await GetCurrentTenantIdAsync(ct);
            return await EnsurePastorBotUserAsync(tenantId, ct);
        }

        public async Task<Guid> EnsurePastorBotUserAsync(Guid tenantId, CancellationToken ct = default)
        {
            var username = tenantId == RootTenantId ? BotUsername : $"pastor.bot.{tenantId:N}";
            var userCode = tenantId == RootTenantId ? BotUserCode : $"BOT{tenantId:N}";
            var email = tenantId == RootTenantId
                ? "pastor.bot@mahimaministries.local"
                : $"pastor.bot+{tenantId:N}@mahimaministries.local";

            var bot = await _db.Users.FirstOrDefaultAsync(u =>
                u.TenantId == tenantId &&
                (u.Username == username || u.UserCode == userCode), ct);

            if (bot == null)
            {
                bot = new User
                {
                    Id = Guid.NewGuid(),
                    TenantId = tenantId,
                    Username = username,
                    UserCode = userCode,
                    DisplayName = "AI Pastor",
                    Email = email,
                    Role = "admin",
                    JoinDate = DateTime.UtcNow
                };
                _db.Users.Add(bot);
            }
            else
            {
                bot.Username = string.IsNullOrWhiteSpace(bot.Username) ? username : bot.Username;
                bot.UserCode = string.IsNullOrWhiteSpace(bot.UserCode) ? userCode : bot.UserCode;
                bot.DisplayName = string.IsNullOrWhiteSpace(bot.DisplayName) ? "AI Pastor" : bot.DisplayName;
                bot.Email = string.IsNullOrWhiteSpace(bot.Email) ? email : bot.Email;
                bot.Role = string.IsNullOrWhiteSpace(bot.Role) ? "admin" : bot.Role;
            }

            await _db.SaveChangesAsync(ct);

            return bot.Id;
        }
        public async Task<Chat> EnsureJaiMasihChatAsync(CancellationToken ct = default)
        {
            var tenantId = await GetCurrentTenantIdAsync(ct);
            return await EnsureJaiMasihChatAsync(tenantId, ct);
        }

        public async Task<Chat> EnsureJaiMasihChatAsync(Guid tenantId, CancellationToken ct = default)
        {
            var botUserId = await EnsurePastorBotUserAsync(tenantId, ct);
            var countryCode = await _db.Tenants.AsNoTracking().Where(t => t.Id == tenantId).Select(t => t.CountryCode).FirstOrDefaultAsync(ct) ?? "IN";
            var desiredChatName = countryCode.Equals("IN", StringComparison.OrdinalIgnoreCase) ? JaiMasihChatName : InternationalChatName;

            var chat = await _db.Chats
                .FirstOrDefaultAsync(c =>
                    c.TenantId == tenantId &&
                    c.IsGroup &&
                    c.Name != null &&
                    (c.Name.ToLower() == JaiMasihChatName.ToLower() || c.Name.ToLower() == InternationalChatName.ToLower()), ct);

            if (chat == null)
            {
                chat = new Chat
                {
                    Name = desiredChatName,
                    IsGroup = true,
                    TenantId = tenantId,
                    CreatedBy = botUserId,
                    CreatedAt = DateTime.UtcNow
                };
                _db.Chats.Add(chat);
                await _db.SaveChangesAsync(ct);
            }
            else if (!string.Equals(chat.Name, desiredChatName, StringComparison.Ordinal))
            {
                chat.Name = desiredChatName;
                await _db.SaveChangesAsync(ct);
            }

            var allUserIds = await _db.Users
                .AsNoTracking()
                .Where(u => u.TenantId == tenantId)
                .Select(u => u.Id)
                .ToListAsync(ct);

            if (!allUserIds.Contains(botUserId))
                allUserIds.Add(botUserId);

            var existingMembers = await _db.ChatMembers
                .Where(cm => cm.ChatId == chat.Id)
                .Select(cm => cm.UserId)
                .ToListAsync(ct);

            var existing = existingMembers.ToHashSet();
            var missingMembers = allUserIds
                .Where(id => !existing.Contains(id))
                .Distinct()
                .Select(id => new ChatMember
                {
                    ChatId = chat.Id,
                    UserId = id,
                    Role = id == botUserId ? "admin" : "member",
                    JoinedAt = DateTime.UtcNow
                })
                .ToList();

            if (missingMembers.Count > 0)
            {
                _db.ChatMembers.AddRange(missingMembers);
                await _db.SaveChangesAsync(ct);
            }

            return chat;
        }

        public async Task<MessageDto> SendJaiMasihMessageAsync(string content, CancellationToken ct = default)
        {
            var tenantId = await GetCurrentTenantIdAsync(ct);
            return await SendJaiMasihMessageAsync(content, tenantId, ct);
        }

        public async Task<MessageDto> SendJaiMasihMessageAsync(string content, Guid tenantId, CancellationToken ct = default)
        {
            var chat = await EnsureJaiMasihChatAsync(tenantId, ct);
            var botUserId = await EnsurePastorBotUserAsync(tenantId, ct);

            var msg = new Message
            {
                ChatId = chat.Id,
                SenderId = botUserId,
                Content = content ?? string.Empty,
                ContentType = "text",
                CreatedAt = DateTime.UtcNow
            };

            _db.Messages.Add(msg);
            await _db.SaveChangesAsync(ct);

            return new MessageDto(
                msg.Id,
                msg.ChatId,
                msg.SenderId,
                msg.Content,
                msg.CreatedAt)
            {
                ContentType = msg.ContentType
            };
        }

        private async Task<Guid> GetCurrentTenantIdAsync(CancellationToken ct = default)
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            return tenant?.Id ?? RootTenantId;
        }

        public async Task<PastorBotReplyDto> AskAsync(Guid userId, string question, bool sendToJaiMasih = false, string? language = null, string? persona = null, IReadOnlyList<PastorBotMessageDto>? conversation = null, CancellationToken ct = default)
        {
            var trimmed = (question ?? string.Empty).Trim();
            var normalizedLanguage = NormalizeLanguage(language);
            var normalizedPersona = NormalizePersona(persona, normalizedLanguage);

            if (string.IsNullOrWhiteSpace(trimmed))
            {
                return new PastorBotReplyDto
                {
                    Answer = normalizedLanguage switch
                    {
                        "hi" => "कृपया बताइए कि आपको किस बात के लिए प्रार्थना या मार्गदर्शन चाहिए।",
                        "pa" => "ਕਿਰਪਾ ਕਰਕੇ ਦੱਸੋ ਕਿ ਤੁਹਾਨੂੰ ਕਿਸ ਗੱਲ ਲਈ ਪ੍ਰਾਰਥਨਾ ਜਾਂ ਮਾਰਗਦਰਸ਼ਨ ਚਾਹੀਦਾ ਹੈ।",
                        _ => "Please share what you would like prayer or guidance for."
                    },
                    Language = normalizedLanguage,
                    Persona = normalizedPersona
                };
            }

            var answer = await TryAskConfiguredAiAsync(userId, trimmed, normalizedLanguage, normalizedPersona, conversation, ct);
            var source = string.IsNullOrWhiteSpace(answer) ? "fallback" : "ai";
            answer ??= BuildFallbackPastoralAnswer(trimmed, normalizedLanguage);

            var reply = new PastorBotReplyDto
            {
                Answer = answer,
                Source = source,
                Language = normalizedLanguage,
                Persona = normalizedPersona
            };

            if (sendToJaiMasih)
            {
                var shared = await ShareConversationToJaiMasihAsync(userId, trimmed, answer, ct);
                reply.SharedMessages = shared.ToList();
                var last = shared.LastOrDefault();
                if (last != null)
                {
                    reply.ChatId = last.ChatId;
                    reply.MessageId = last.Id;
                }
            }

            return reply;
        }

        public async Task<PastorBotReplyDto> ReadMeAsync(Guid userId, string imageDataUrl, string? note = null, string? language = null, string? persona = null, CancellationToken ct = default)
        {
            var normalizedLanguage = NormalizeLanguage(language);
            var normalizedPersona = NormalizePersona(persona, normalizedLanguage);
            var userNote = (note ?? string.Empty).Trim();
            var image = (imageDataUrl ?? string.Empty).Trim();

            var answer = await TryAskConfiguredVisionAsync(userId, image, userNote, normalizedLanguage, normalizedPersona, ct);
            var source = string.IsNullOrWhiteSpace(answer) ? "fallback" : "ai";
            answer ??= BuildReadMeFallbackAnswer(userNote, normalizedLanguage);

            return new PastorBotReplyDto
            {
                Answer = answer,
                Source = source,
                Language = normalizedLanguage,
                Persona = normalizedPersona
            };
        }

        public async Task<PastorBotReplyDto> ReadArtifactAsync(Guid userId, string artifactName, string artifactText, string? note = null, string? language = null, string? persona = null, CancellationToken ct = default)
        {
            var normalizedLanguage = NormalizeLanguage(language);
            var normalizedPersona = NormalizePersona(persona, normalizedLanguage);
            var safeName = string.IsNullOrWhiteSpace(artifactName) ? "uploaded artifact" : artifactName.Trim();
            var text = (artifactText ?? string.Empty).Trim();
            var userNote = (note ?? string.Empty).Trim();
            var languageInstruction = normalizedLanguage == "hi" ? "Reply completely in natural Hindi."
                : normalizedLanguage == "pa" ? "Reply completely in natural Punjabi."
                : "Reply completely in clear English.";
            var prompt = $@"Explain the user-uploaded artifact named '{safeName}'. Summarize its purpose and important content, explain difficult terms in plain language, identify key dates, amounts, decisions, risks, or action items when present, and answer the user's note. Do not invent content that is not in the artifact. Distinguish facts in the artifact from your interpretation. If the material is incomplete or unreadable, say so. {languageInstruction}

User note: {(string.IsNullOrWhiteSpace(userNote) ? "Please explain this artifact clearly." : userNote)}

Extracted artifact content:
{text[..Math.Min(text.Length, 50000)]}";

            var answer = await TryAskConfiguredAiAsync(userId, prompt, normalizedLanguage, normalizedPersona, null, ct);
            answer ??= normalizedLanguage == "hi" ? $"मैं अभी AI से इस फ़ाइल का विश्लेषण नहीं कर पाया। फ़ाइल: {safeName}. कृपया बाद में पुनः प्रयास करें।"
                : normalizedLanguage == "pa" ? $"ਮੈਂ ਇਸ ਵੇਲੇ AI ਨਾਲ ਇਸ ਫਾਈਲ ਦਾ ਵਿਸ਼ਲੇਸ਼ਣ ਨਹੀਂ ਕਰ ਸਕਿਆ। ਫਾਈਲ: {safeName}. ਕਿਰਪਾ ਕਰਕੇ ਦੁਬਾਰਾ ਕੋਸ਼ਿਸ਼ ਕਰੋ।"
                : $"I could not analyze {safeName} with AI right now. Please try again shortly.";

            return new PastorBotReplyDto { Answer = answer, Source = _llmProvider.IsConfigured ? "ai" : "fallback", Language = normalizedLanguage, Persona = normalizedPersona };
        }

        public async Task<IReadOnlyList<MessageDto>> TryReplyInChatAsync(Guid chatId, Guid userId, string? userMessage, CancellationToken ct = default)
        {
            _logger.LogInformation("AI Pastor chat reply requested. ChatId={ChatId} UserId={UserId} HasMessage={HasMessage}",
                chatId, userId, !string.IsNullOrWhiteSpace(userMessage));
            var canonicalBotUserId = await EnsurePastorBotUserAsync(ct);
            var botUserId = await ResolvePastorBotUserForChatAsync(chatId, userId, canonicalBotUserId, ct);
            if (userId == botUserId) return Array.Empty<MessageDto>();

            var text = CleanChatText(userMessage);
            if (string.IsNullOrWhiteSpace(text))
            {
                _logger.LogInformation("AI Pastor chat reply skipped because message was empty after cleanup. ChatId={ChatId}", chatId);
                return Array.Empty<MessageDto>();
            }

            var shouldReply = await ShouldPastorReplyAsync(chatId, text, botUserId, ct);
            if (!shouldReply)
            {
                _logger.LogInformation("AI Pastor chat reply skipped because chat/message did not match pastor rules. ChatId={ChatId}", chatId);
                return Array.Empty<MessageDto>();
            }

            await EnsureBotIsChatMemberAsync(chatId, botUserId, ct);

            var prompt = text.StartsWith("@pastor", StringComparison.OrdinalIgnoreCase)
                ? text.Substring("@pastor".Length).Trim()
                : text.StartsWith("@ai pastor", StringComparison.OrdinalIgnoreCase)
                    ? text.Substring("@ai pastor".Length).Trim()
                    : text.StartsWith("/pastor", StringComparison.OrdinalIgnoreCase)
                        ? text.Substring("/pastor".Length).Trim()
                        : text.Trim();

            if (string.IsNullOrWhiteSpace(prompt))
                prompt = "Please give me today's spiritual guidance.";

            var history = await BuildChatConversationAsync(chatId, botUserId, ct);
            using var replyTimeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            replyTimeout.CancelAfter(TimeSpan.FromSeconds(60));

            string answer;
            try
            {
                var pastorReply = await AskAsync(userId, prompt, false, null, "pastor-chat", history, replyTimeout.Token);
                _logger.LogInformation("AI Pastor chat AskAsync completed. ChatId={ChatId} Source={Source} Persona={Persona}",
                    chatId, pastorReply.Source, pastorReply.Persona);

                if (!string.Equals(pastorReply.Source, "ai", StringComparison.OrdinalIgnoreCase))
                {
                    _logger.LogWarning("AI Pastor chat reply skipped because LLM returned fallback for chat {ChatId}.", chatId);
                    return Array.Empty<MessageDto>();
                }

                answer = pastorReply.Answer;
            }
            catch (OperationCanceledException)
            {
                _logger.LogWarning("AI Pastor chat reply timed out for chat {ChatId}.", chatId);
                return Array.Empty<MessageDto>();
            }

            var messagesToBroadcast = new List<MessageDto>();
            var reply = await _chatService.AddMessageAsync(chatId, botUserId, answer, "text");
            messagesToBroadcast.Add(reply);

            return messagesToBroadcast;
        }

        private async Task<bool> ShouldPastorReplyAsync(Guid chatId, string text, Guid botUserId, CancellationToken ct)
        {
            var isMention =
                text.StartsWith("@pastor", StringComparison.OrdinalIgnoreCase)
                || text.StartsWith("@ai pastor", StringComparison.OrdinalIgnoreCase)
                || text.StartsWith("/pastor", StringComparison.OrdinalIgnoreCase);

            var chat = await _db.Chats
                .AsNoTracking()
                .Where(c => c.Id == chatId)
                .Select(c => new { c.Name, c.IsGroup })
                .FirstOrDefaultAsync(ct);
            if (chat == null) return false;

            if (chat.IsGroup && isMention)
                return true;

            if (IsPastorChatName(chat.Name))
                return true;

            var members = await _db.ChatMembers
                .AsNoTracking()
                .Where(cm => cm.ChatId == chatId)
                .Select(cm => new
                {
                    cm.UserId,
                    Username = cm.User != null ? cm.User.Username : null,
                    UserCode = cm.User != null ? cm.User.UserCode : null,
                    DisplayName = cm.User != null ? cm.User.DisplayName : null,
                    Email = cm.User != null ? cm.User.Email : null
                })
                .ToListAsync(ct);

            return !chat.IsGroup && members.Any(m =>
                m.UserId == botUserId || IsPastorIdentity(m.Username, m.UserCode, m.DisplayName, m.Email));
        }

        private async Task<IReadOnlyList<MessageDto>> ShareConversationToJaiMasihAsync(Guid userId, string question, string answer, CancellationToken ct)
        {
            var botUserId = await EnsurePastorBotUserAsync(ct);
            var jaiMasih = await EnsureJaiMasihChatAsync(ct);
            var messages = new List<MessageDto>();

            var cleanQuestion = CleanChatText(question);
            if (!string.IsNullOrWhiteSpace(cleanQuestion))
                messages.Add(await _chatService.AddMessageAsync(jaiMasih.Id, userId, cleanQuestion, "text"));

            if (!string.IsNullOrWhiteSpace(answer))
                messages.Add(await _chatService.AddMessageAsync(jaiMasih.Id, botUserId, answer, "text"));

            return messages;
        }

        private async Task<bool> IsDirectPastorChatAsync(Guid chatId, Guid botUserId, CancellationToken ct)
        {
            var chat = await _db.Chats
                .AsNoTracking()
                .Where(c => c.Id == chatId)
                .Select(c => new { c.IsGroup, c.Name })
                .FirstOrDefaultAsync(ct);
            if (chat == null || chat.IsGroup) return false;

            return await _db.ChatMembers
                .AsNoTracking()
                .AnyAsync(cm => cm.ChatId == chatId && cm.UserId == botUserId, ct);
        }

        private async Task<Guid> ResolvePastorBotUserForChatAsync(Guid chatId, Guid senderId, Guid canonicalBotUserId, CancellationToken ct)
        {
            var chat = await _db.Chats
                .AsNoTracking()
                .Where(c => c.Id == chatId)
                .Select(c => new { c.IsGroup, c.Name })
                .FirstOrDefaultAsync(ct);
            if (chat == null || chat.IsGroup) return canonicalBotUserId;

            var members = await _db.ChatMembers
                .AsNoTracking()
                .Where(cm => cm.ChatId == chatId)
                .Select(cm => new
                {
                    cm.UserId,
                    Username = cm.User != null ? cm.User.Username : null,
                    UserCode = cm.User != null ? cm.User.UserCode : null,
                    DisplayName = cm.User != null ? cm.User.DisplayName : null,
                    Email = cm.User != null ? cm.User.Email : null
                })
                .ToListAsync(ct);

            if (members.Any(m => m.UserId == canonicalBotUserId)) return canonicalBotUserId;

            var pastorMember = members.FirstOrDefault(m =>
                m.UserId != senderId &&
                IsPastorIdentity(m.Username, m.UserCode, m.DisplayName, m.Email));
            if (pastorMember != null) return pastorMember.UserId;

            if (IsPastorChatName(chat.Name))
            {
                var otherMember = members.FirstOrDefault(m => m.UserId != senderId);
                if (otherMember != null) return otherMember.UserId;
            }

            return canonicalBotUserId;
        }

        private static bool IsPastorIdentity(string? username, string? userCode, string? displayName, string? email)
        {
            var combined = $"{username} {userCode} {displayName} {email}".ToLowerInvariant();
            var normalized = new string(combined.Where(char.IsLetterOrDigit).ToArray());
            return normalized.Contains("pastorbot")
                || normalized.Contains("botpastor")
                || normalized.Contains("aipastor")
                || normalized.Contains("aicounseller")
                || normalized.Contains("aicounselor")
                || normalized.Contains("pastorbotmahimaministrieslocal");
        }

        private async Task<IReadOnlyList<PastorBotMessageDto>> BuildChatConversationAsync(Guid chatId, Guid botUserId, CancellationToken ct)
        {
            var recent = await _chatService.GetMessagesAsync(chatId, page: 1, size: 14);

            return recent.Items
                .Select(m => new PastorBotMessageDto
                {
                    Role = m.SenderId == botUserId ? "assistant" : "user",
                    Text = CleanChatText(m.Content)
                })
                .Where(m => !string.IsNullOrWhiteSpace(m.Text))
                .ToList();
        }

        private static string CleanChatText(string? text)
        {
            var value = (text ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(value)) return string.Empty;

            value = Regex.Replace(value, @"\s*\[jm-attachment:[A-Za-z0-9+/=]+\]", string.Empty, RegexOptions.IgnoreCase);
            value = Regex.Replace(value, @"\s*\[jm-message-meta:[A-Za-z0-9+/=]+\]", string.Empty, RegexOptions.IgnoreCase);
            return value.Trim();
        }

        private static bool IsPastorChatName(string? name)
        {
            var normalized = new string((name ?? string.Empty)
                .ToLowerInvariant()
                .Where(char.IsLetterOrDigit)
                .ToArray());

            return normalized == "jaimasih"
                || normalized == "aipastor"
                || normalized == "pastorbot"
                || normalized.Contains("jaimasih")
                || normalized.Contains("aipastor");
        }

        private async Task EnsureBotIsChatMemberAsync(Guid chatId, Guid botUserId, CancellationToken ct)
        {
            var exists = await _db.ChatMembers.AnyAsync(cm => cm.ChatId == chatId && cm.UserId == botUserId, ct);
            if (exists) return;

            var chat = await _db.Chats
                .AsNoTracking()
                .Where(c => c.Id == chatId)
                .Select(c => new { c.IsGroup })
                .FirstOrDefaultAsync(ct);
            if (chat == null || !chat.IsGroup) return;

            _db.ChatMembers.Add(new ChatMember
            {
                ChatId = chatId,
                UserId = botUserId,
                Role = "pastor-bot",
                JoinedAt = DateTime.UtcNow
            });
            await _db.SaveChangesAsync(ct);
        }

        private static string NormalizeLanguage(string? language)
        {
            var value = (language ?? "en").Trim().ToLowerInvariant();
            if (value.StartsWith("hi") || value.Contains("hindi")) return "hi";
            if (value.StartsWith("pa") || value.StartsWith("pun") || value.Contains("punjabi")) return "pa";
            return "en";
        }

        private static string NormalizePersona(string? persona, string language)
        {
            var value = (persona ?? string.Empty).Trim().ToLowerInvariant();
            if (language == "hi") return "hindi-pastoral-guide";
            if (language == "pa") return "punjabi-pastoral-guide";
            if (value.Contains("pastor-chat")) return "pastor-chat";
            return value.Contains("teaching") ? "english-teaching-guide" : "english-evangelist";
        }

        private static string BuildSystemPrompt(string language, string persona)
        {
            var basePrompt = @"You are Mahima Ministry's AI Counseller assistant. Give warm, biblical, practical, non-judgmental guidance. Encourage prayer, church community, and contacting a real pastor for crisis, abuse, self-harm, legal, medical, or emergency issues. Do not claim to replace a human pastor. Never claim to be, imitate, or speak as a real public figure.";

            if (language == "hi")
            {
                return basePrompt + " Reply in natural Hindi. Use simple pastoral Hindi, short paragraphs, and include one Bible-based encouragement, one practical next step, and a short prayer. Do not imitate any specific pastor or celebrity.";
            }

            if (language == "pa")
            {
                return basePrompt + " Reply in natural Punjabi. Use simple pastoral Punjabi, short paragraphs, and include one Bible-based encouragement, one practical next step, and a short prayer. Do not imitate any specific pastor or celebrity.";
            }

            if (persona == "english-teaching-guide")
            {
                return basePrompt + " Reply in English like a thoughtful pastoral teacher: clear, structured, conversational, and practical. Include a Bible verse, reflection, next step, and short prayer.";
            }

            if (persona == "pastor-chat")
            {
                return basePrompt + " Reply like a one-to-one chat conversation, not a sermon or announcement. Be natural, specific to the user's latest message, and keep most replies to 3-6 short sentences. Use the recent conversation context, ask at most one gentle follow-up question when helpful, and do not always include a full prayer or Bible verse unless the user asks or the moment clearly needs it.";
            }

            return basePrompt + " Reply in English with a warm classic evangelistic tone: compassionate, hopeful, direct, and reverent, without imitating any specific preacher. Include a Bible verse, practical encouragement, and a short prayer.";
        }

        private static string BuildReadMeSystemPrompt(string language, string persona)
        {
            var basePrompt = BuildSystemPrompt(language, persona) + @"

You are handling a consent-based ReadMe image session. The image may be a camera frame or another user-uploaded visual artifact. Use it only as user-shared context. Explain visible artifact content clearly. If a person is visible, mention only simple, non-sensitive observations and frame them gently as possibilities. Do not identify a person or infer sensitive traits. Do not judge appearance or provide medical, legal, or crisis diagnosis. If the note suggests self-harm, abuse, or emergency danger, encourage immediate help from local emergency services and a trusted human pastor/counsellor.

Respond as a pastoral counsellor using this shape:
1. A warm greeting.
2. One or two careful observations from the image and note, framed with humility.
3. Biblical encouragement with 2-3 verse references.
4. Practical next steps for the next hour or day.
5. A short prayer.";

            if (language == "hi")
                return basePrompt + " Reply completely in natural Hindi.";

            if (language == "pa")
                return basePrompt + " Reply completely in natural Punjabi.";

            return basePrompt + " Reply completely in English.";
        }

        private static string BuildReadMeVisionPrompt(string note, string language)
        {
            var safeNote = string.IsNullOrWhiteSpace(note)
                ? "The user did not type a specific concern. Please offer gentle pastoral guidance from the camera context only."
                : note;

            return language switch
            {
                "hi" => $"Read and explain this user-shared image with care and consent. User note: {safeNote}. Respond in Hindi only.",
                "pa" => $"Read and explain this user-shared image with care and consent. User note: {safeNote}. Respond in Punjabi only.",
                _ => $"Read and explain this user-shared image with care and consent. User note: {safeNote}. Respond in English only."
            };
        }

        /// <summary>
        /// Builds the Scripture-grounding block appended to the system prompt.
        /// The model is told to cite ONLY these retrieved verses, which keeps the
        /// autonomous pastor from inventing chapter/verse numbers.
        /// </summary>
        private static string BuildScriptureGrounding(IReadOnlyList<ScriptureVerse> verses)
        {
            if (verses == null || verses.Count == 0) return string.Empty;

            var sb = new StringBuilder();
            sb.AppendLine("SCRIPTURE GROUNDING — the verses below have been retrieved as relevant to this conversation.");
            sb.AppendLine("When you cite Scripture, quote ONLY from these verses and use their exact references.");
            sb.AppendLine("Do not invent chapter or verse numbers. If none fit, speak biblically without a citation rather than guessing.");
            foreach (var v in verses)
                sb.AppendLine($"- {v.Reference}: \"{v.Text}\"");
            return sb.ToString().Trim();
        }

        private static List<LlmMessage> BuildLlmMessages(string system, string question, IReadOnlyList<PastorBotMessageDto>? conversation)
        {
            var messages = new List<LlmMessage> { LlmMessage.System(system) };
            foreach (var message in (conversation ?? Array.Empty<PastorBotMessageDto>()).TakeLast(12))
            {
                var text = (message.Text ?? string.Empty).Trim();
                if (string.IsNullOrWhiteSpace(text)) continue;

                var role = string.Equals(message.Role, "pastor", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(message.Role, "assistant", StringComparison.OrdinalIgnoreCase)
                    ? "assistant"
                    : "user";

                messages.Add(new LlmMessage(role, text));
            }

            messages.Add(LlmMessage.User(question));
            return messages;
        }

        private async Task<string?> TryAskConfiguredAiAsync(Guid userId, string question, string language, string persona, IReadOnlyList<PastorBotMessageDto>? conversation, CancellationToken ct)
        {
            if (!_llmProvider.IsConfigured) return null;

            var system = BuildSystemPrompt(language, persona);
            var result = await _llmProvider.CompleteAsync(new LlmRequest
            {
                Messages = BuildLlmMessages(system, question, conversation),
                Temperature = 0.6,
                MaxTokens = 700
            }, ct);

            if (result.Success && !string.IsNullOrWhiteSpace(result.Text))
                return result.Text;

            _logger.LogWarning("PastorBot LLM provider {Provider} failed: {Error}", result.Provider, result.Error);
            return null;
        }

        private async Task<string?> TryAskConfiguredVisionAsync(Guid userId, string imageDataUrl, string note, string language, string persona, CancellationToken ct)
        {
            if (!_llmProvider.IsConfigured || !IsSupportedImageDataUrl(imageDataUrl))
                return null;

            var result = await _llmProvider.CompleteVisionAsync(new LlmVisionRequest
            {
                SystemPrompt = BuildReadMeSystemPrompt(language, persona),
                UserText = BuildReadMeVisionPrompt(note, language),
                ImageUrl = imageDataUrl,
                Temperature = 0.55,
                MaxTokens = 850
            }, ct);

            if (result.Success && !string.IsNullOrWhiteSpace(result.Text))
                return result.Text;

            if (result.Error != "capability-unavailable")
                _logger.LogWarning("PastorBot vision provider {Provider} failed: {Error}", result.Provider, result.Error);

            return null;
        }

        private static bool IsSupportedImageDataUrl(string value) =>
            !string.IsNullOrWhiteSpace(value) &&
            (value.StartsWith("data:image/jpeg;base64,", StringComparison.OrdinalIgnoreCase) ||
             value.StartsWith("data:image/png;base64,", StringComparison.OrdinalIgnoreCase) ||
             value.StartsWith("data:image/webp;base64,", StringComparison.OrdinalIgnoreCase));

        private static string BuildReadMeFallbackAnswer(string note, string language)
        {
            if (language == "hi")
            {
                return "Jai Masih. ReadMe abhi AI vision se connect nahi ho paya, lekin Prabhu aapko dekhta aur sambhalta hai. Bhajan 139:23-24 me Daud prarthana karta hai: Hey Parmeshwar, mujhe jaanch aur mere man ko jaan. Aaj ek shaant pal lijiye, apni baat Yeshu ko seedhe kahiye, aur ek vishwasi pastor ya leader ke saath baat share kijiye. Prarthana: Prabhu Yeshu, apni shanti, buddhi aur sahas is vyakti ko dijiye. Amen.";
            }

            if (language == "pa")
            {
                return "Jai Masih. ReadMe is vele AI vision naal connect nahi ho paya, par Prabhu tuhanu vekhda ate sambhalda hai. Zaboor 139:23-24 vich prarthana hai: Hey Parmeshwar, mainu jaanch ate mere dil nu jaan. Aaj ik shaant pal lao, apni gal Yeshu nu daso, ate kise bharosemand pastor ja leader naal gal karo. Prarthana: Prabhu Yeshu, apni shanti, buddhi ate himmat is vyakti nu deo. Amen.";
            }

            return "Jai Masih. ReadMe could not connect to AI vision right now, but the Lord still sees you with love and care. Psalm 139:23-24 invites us to pray, 'Search me, God, and know my heart.' Take one quiet minute, tell Jesus honestly what is on your heart, and share the burden with a trusted pastor or leader. Prayer: Lord Jesus, give this person peace, wisdom, courage, and the next faithful step. Amen.";
        }

        private static string BuildFallbackPastoralAnswer(string question, string language)
        {
            var lower = question.ToLowerInvariant();

            if (language == "hi")
            {
                if (lower.Contains("fear") || lower.Contains("worry") || lower.Contains("anxiety") || lower.Contains("dar") || lower.Contains("chinta"))
                {
                    return "Jai Masih. फिलिप्पियों 4:6-7 हमें याद दिलाता है कि हम अपनी चिंता प्रभु को प्रार्थना में दें। अभी एक शांत पल लीजिए और कहिए: प्रभु यीशु, मैं अपना डर आपको देता हूं, मुझे अपनी शांति दीजिए। अगर बात बहुत भारी या असुरक्षित लग रही है, तो कृपया आज ही किसी पास्टर या भरोसेमंद अगुवे से बात करें।";
                }

                if (lower.Contains("prayer") || lower.Contains("pray") || lower.Contains("prarthana"))
                {
                    return "Jai Masih. आइए प्रार्थना करें: प्रभु यीशु, अपने इस बच्चे को बुद्धि, सुरक्षा, शांति और विश्वास दीजिए। सही दरवाजे खोलिए और हर बोझ में अपनी उपस्थिति महसूस कराइए। आमीन।";
                }

                return "Jai Masih. आज का मार्गदर्शन: यीशु के पास बने रहिए, प्रेम से अगला सही कदम उठाइए, और अपने शब्दों में अनुग्रह रखिए। भजन संहिता 119:105 कहता है कि परमेश्वर का वचन हमारे पांव के लिए दीपक है। आज एक बोझ प्रभु को प्रार्थना में दीजिए और एक व्यक्ति को आशीष दीजिए।";
            }

            if (language == "pa")
            {
                if (lower.Contains("fear") || lower.Contains("worry") || lower.Contains("anxiety") || lower.Contains("dar") || lower.Contains("chinta"))
                {
                    return "Jai Masih. ਫਿਲਿੱਪੀਆਂ 4:6-7 ਸਾਨੂੰ ਯਾਦ ਦਿਵਾਉਂਦਾ ਹੈ ਕਿ ਅਸੀਂ ਆਪਣੀ ਚਿੰਤਾ ਪ੍ਰਭੂ ਨੂੰ ਪ੍ਰਾਰਥਨਾ ਵਿੱਚ ਦੇਈਏ। ਹੁਣ ਇੱਕ ਸ਼ਾਂਤ ਪਲ ਲਓ ਅਤੇ ਕਹੋ: ਪ੍ਰਭੂ ਯਿਸੂ, ਮੈਂ ਆਪਣਾ ਡਰ ਤੁਹਾਨੂੰ ਦੇਂਦਾ ਹਾਂ, ਮੈਨੂੰ ਆਪਣੀ ਸ਼ਾਂਤੀ ਦਿਓ। ਜੇ ਗੱਲ ਬਹੁਤ ਭਾਰੀ ਜਾਂ ਅਸੁਰੱਖਿਅਤ ਲੱਗ ਰਹੀ ਹੈ, ਤਾਂ ਕਿਰਪਾ ਕਰਕੇ ਅੱਜ ਹੀ ਕਿਸੇ ਪਾਸਟਰ ਜਾਂ ਭਰੋਸੇਯੋਗ ਅਗੂ ਨਾਲ ਗੱਲ ਕਰੋ।";
                }

                if (lower.Contains("prayer") || lower.Contains("pray") || lower.Contains("prarthana"))
                {
                    return "Jai Masih. ਆਓ ਪ੍ਰਾਰਥਨਾ ਕਰੀਏ: ਪ੍ਰਭੂ ਯਿਸੂ, ਆਪਣੇ ਇਸ ਬੱਚੇ ਨੂੰ ਬੁੱਧੀ, ਸੁਰੱਖਿਆ, ਸ਼ਾਂਤੀ ਅਤੇ ਵਿਸ਼ਵਾਸ ਦਿਓ। ਸਹੀ ਦਰਵਾਜ਼ੇ ਖੋਲ੍ਹੋ ਅਤੇ ਹਰ ਬੋਝ ਵਿੱਚ ਆਪਣੀ ਹਾਜ਼ਰੀ ਮਹਿਸੂਸ ਕਰਾਓ। ਆਮੀਨ।";
                }

                return "Jai Masih. ਅੱਜ ਦਾ ਮਾਰਗਦਰਸ਼ਨ: ਯਿਸੂ ਦੇ ਨੇੜੇ ਰਹੋ, ਪਿਆਰ ਨਾਲ ਅਗਲਾ ਸਹੀ ਕਦਮ ਚੁੱਕੋ, ਅਤੇ ਆਪਣੇ ਸ਼ਬਦਾਂ ਵਿੱਚ ਕਿਰਪਾ ਰੱਖੋ। ਜ਼ਬੂਰ 119:105 ਕਹਿੰਦਾ ਹੈ ਕਿ ਪਰਮੇਸ਼ੁਰ ਦਾ ਵਚਨ ਸਾਡੇ ਪੈਰਾਂ ਲਈ ਦੀਵਾ ਹੈ। ਅੱਜ ਇੱਕ ਬੋਝ ਪ੍ਰਭੂ ਨੂੰ ਪ੍ਰਾਰਥਨਾ ਵਿੱਚ ਦਿਓ ਅਤੇ ਇੱਕ ਵਿਅਕਤੀ ਨੂੰ ਆਸੀਸ ਦਿਓ।";
            }

            if (lower.Contains("fear") || lower.Contains("worry") || lower.Contains("anxiety"))
            {
                return "Jai Masih. Remember Philippians 4:6-7: bring every worry to God in prayer. Take one quiet minute now, breathe slowly, and say: Lord Jesus, I give You this fear and receive Your peace. If this feels heavy or unsafe, please speak with a pastor or trusted leader today.";
            }

            if (lower.Contains("forgive") || lower.Contains("anger") || lower.Contains("hurt"))
            {
                return "Jai Masih. Forgiveness is a journey, not a switch. Ask Jesus for grace for the next faithful step: pray honestly, release revenge, and seek wise counsel if the hurt is deep. Colossians 3:13 reminds us to forgive as the Lord forgave us.";
            }

            if (lower.Contains("prayer") || lower.Contains("pray"))
            {
                return "Jai Masih. Let us pray: Lord Jesus, guide this child of God today. Give wisdom, protection, peace, and a heart that hears Your voice. Open the right doors and strengthen faith. Amen.";
            }

            return "Jai Masih. Today's guidance: stay close to Jesus, do the next right thing with love, and let your words carry grace. Psalm 119:105 says God's word is a lamp to our feet and a light to our path. Share one burden with God in prayer, and bless one person practically today.";
        }
    }
}
