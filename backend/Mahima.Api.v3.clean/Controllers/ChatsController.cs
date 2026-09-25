using System;
using System.Data;
using System.Linq;
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using Mahima.Api.v3.clean.Dtos;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Extensions;
using Mahima.Api.v3.clean.Services;
using Mahima.Api.v3.clean.Hubs;
using Mahima.Api.v3.clean.Models;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class ChatsController : ControllerBase
    {
        private readonly IChatService _chatService;
        private readonly MahimaDbContext _db;
        private readonly IHubContext<ChatHub> _hub;
        private readonly IMobilePushNotificationService? _mobilePush;
        private readonly IPastorBotService _pastorBot;
        private readonly ILogger<ChatsController> _logger;
        private readonly ITenantContextService _tenantContext;
        private readonly ILicensingService _licensing;

        public ChatsController(IChatService chatService, MahimaDbContext db, IHubContext<ChatHub> hub, IEnumerable<IMobilePushNotificationService> mobilePushServices, IPastorBotService pastorBot, ILogger<ChatsController> logger, ITenantContextService tenantContext, ILicensingService licensing)
        {
            _chatService = chatService ?? throw new ArgumentNullException(nameof(chatService));
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _hub = hub ?? throw new ArgumentNullException(nameof(hub));
            _mobilePush = mobilePushServices?.FirstOrDefault();
            _pastorBot = pastorBot ?? throw new ArgumentNullException(nameof(pastorBot));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
            _tenantContext = tenantContext ?? throw new ArgumentNullException(nameof(tenantContext));
            _licensing = licensing ?? throw new ArgumentNullException(nameof(licensing));
        }

        private async Task<IActionResult?> RequireChatModuleAsync()
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync();
            if (tenant == null) return NotFound("Tenant not found.");
            if (await _licensing.HasModuleAsync(tenant.Id, LicensingService.ChatModule)) return null;
            return StatusCode(402, new
            {
                message = "The Jai Masih Chat module is not active for this church.",
                moduleCode = LicensingService.ChatModule,
                tenantId = tenant.Id,
                action = "Create a UPI payment intent and mark it paid to activate chat."
            });
        }

        private async Task<List<Guid>?> GetAuthorizedMemberIdsAsync(Guid chatId, Guid currentUserId)
        {
            if (chatId == Guid.Empty || currentUserId == Guid.Empty) return null;

            var memberIds = (await _chatService.GetChatMemberIdsAsync(chatId)).Distinct().ToList();
            return memberIds.Contains(currentUserId) ? memberIds : null;
        }

        private async Task<Guid> GetCurrentTenantIdAsync()
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync();
            return tenant?.Id ?? Guid.Parse("00000000-0000-0000-0000-000000000001");
        }

        private Task NotifyChatMembersAsync(IEnumerable<Guid> memberIds, string eventName, object payload)
        {
            var userIds = memberIds.Select(id => id.ToString()).Distinct().ToList();
            return userIds.Count == 0
                ? Task.CompletedTask
                : _hub.Clients.Users(userIds).SendAsync(eventName, payload);
        }

        private async Task<ChatSummaryDto?> GetChatSummaryForUserAsync(Guid userId, Guid chatId)
        {
            var chats = await _chatService.GetUserChatsAsync(userId);
            return chats.FirstOrDefault(c => c.Id == chatId);
        }

        private async Task EnsureGroupPhotoColumnAsync()
        {
            await _db.Database.ExecuteSqlRawAsync(@"
ALTER TABLE public.chats
ADD COLUMN IF NOT EXISTS group_photo_url text;");
        }

        [HttpPatch("{chatId:guid}/soft-delete")]
        public async Task<IActionResult> SoftDeleteChat(Guid chatId)
        {
            var licenseError = await RequireChatModuleAsync();
            if (licenseError != null) return licenseError;

            var currentUserId = User.GetUserIdGuid();
            if (currentUserId == Guid.Empty) return Unauthorized();

            await _chatService.SoftDeleteChatAsync(chatId, currentUserId);

            try
            {
                var memberIds = await _chatService.GetChatMemberIdsAsync(chatId);
                await NotifyChatMembersAsync(memberIds, "ChatSoftDeleted", new { ChatId = chatId });
            }
            catch { }

            return NoContent();
        }

        [HttpPost("send-bulk")]
        public async Task<IActionResult> SendBulk([FromBody] SendBulkMessageDto dto)
        {
            var licenseError = await RequireChatModuleAsync();
            if (licenseError != null) return licenseError;

            if (!ModelState.IsValid) return BadRequest(ModelState);

            var fromUserId = User.GetUserIdGuid();
            if (fromUserId == Guid.Empty) return Unauthorized();

            var recipientIds = dto.RecipientIds?.Where(id => id != Guid.Empty).Distinct().ToList() ?? new List<Guid>();
            if (!recipientIds.Any()) return BadRequest("recipientIds required.");

            var results = new List<object>();

            foreach (var recipientId in recipientIds)
            {
                if (recipientId == fromUserId)
                {
                    results.Add(new { recipient = recipientId, status = "skipped", reason = "cannot message self" });
                    continue;
                }

                try
                {
                    var chat = await _chatService.CreateOrGetDirectChatAsync(fromUserId, recipientId);
                    if (chat == null)
                    {
                        results.Add(new { recipient = recipientId, status = "failed", reason = "could not create/find chat" });
                        continue;
                    }

                    var chatId = chat.Id;

                    var createdMsg = await _chatService.AddMessageAsync(
                        chatId, fromUserId, dto.Message, dto.ContentType ?? "text", dto.AttachmentUrl);

                    try
                    {
                var memberIds = await _chatService.GetChatMemberIdsAsync(chatId);
                await NotifyChatMembersAsync(memberIds, "ReceiveMessage", createdMsg);
                if (_mobilePush != null)
                    await _mobilePush.NotifyChatMessageAsync(chatId, fromUserId, memberIds, createdMsg);
            }
            catch (Exception notifyEx)
            {
                        _logger.LogWarning(notifyEx, "Notify failed recipient {Recipient} chat {ChatId}", recipientId, chatId);
                    }

                    results.Add(new { recipient = recipientId, status = "ok", chatId, messageId = createdMsg.Id });
                }
                catch (Exception innerEx)
                {
                    _logger.LogWarning(innerEx, "Bulk send failed to {Recipient} from {User}", recipientId, fromUserId);
                    results.Add(new { recipient = recipientId, status = "failed", reason = innerEx.Message });
                }
            }

            var sent = results.Count(r =>
            {
                var statusProp = r.GetType().GetProperty("status");
                var val = statusProp?.GetValue(r) as string;
                return string.Equals(val, "ok", StringComparison.Ordinal);
            });

            return Ok(new { sent, results });
        }

        [HttpDelete("{chatId:guid}")]
        public async Task<IActionResult> DeleteChat(Guid chatId)
        {
            var licenseError = await RequireChatModuleAsync();
            if (licenseError != null) return licenseError;

            var currentUserId = User.GetUserIdGuid();
            if (currentUserId == Guid.Empty) return Unauthorized();

            await _chatService.DeleteChatAsync(chatId, currentUserId);

            try
            {
                var memberIds = await _chatService.GetChatMemberIdsAsync(chatId);
                await NotifyChatMembersAsync(memberIds, "ChatDeleted", new { ChatId = chatId });
            }
            catch { }

            return NoContent();
        }

        [HttpGet]
        public async Task<IActionResult> GetChats()
        {
            var licenseError = await RequireChatModuleAsync();
            if (licenseError != null) return licenseError;

            var userId = User.GetUserIdGuid();
            if (userId == Guid.Empty) return Unauthorized();

            var chats = await _chatService.GetUserChatsAsync(userId);
            return Ok(chats);
        }

        [HttpGet("contacts")]
        public async Task<IActionResult> GetChatContacts([FromQuery] string? search = null, [FromQuery] int page = 1, [FromQuery] int limit = 500)
        {
            var licenseError = await RequireChatModuleAsync();
            if (licenseError != null) return licenseError;

            var currentUserId = User.GetUserIdGuid();
            if (currentUserId == Guid.Empty) return Unauthorized();

            page = Math.Max(1, page);
            limit = Math.Clamp(limit, 1, 1000);
            var offset = (page - 1) * limit;

            var query = _db.Users
                .AsNoTracking()
                .Where(u => u.Id != currentUserId);

            var tenantId = await GetCurrentTenantIdAsync();
            query = query.Where(u => u.TenantId == tenantId);

            var term = search?.Trim();

            try
            {
                var conn = _db.Database.GetDbConnection();
                if (conn.State != ConnectionState.Open) await conn.OpenAsync();
                var columns = await GetUsersColumnsAsync(conn);

                string Expr(params string[] names)
                {
                    var column = names.FirstOrDefault(columns.Contains);
                    return column == null ? "NULL" : $@"u.""{column}""";
                }

                var idExpr = Expr("id");
                var usernameExpr = Expr("username");
                var emailExpr = Expr("email");
                var displayNameExpr = Expr("displayname");
                var phoneExpr = Expr("phone");
                var roleExpr = Expr("role");
                var photoExpr = Expr("profilephotourl", "ProfilePhotoUrl");
                var isDeletedExpr = Expr("isdeleted", "IsDeleted");

                var conditions = new List<string> { $"({idExpr}) <> @currentUserId" };
                if (isDeletedExpr != "NULL")
                    conditions.Add($"COALESCE(({isDeletedExpr})::boolean, false) = false");
                else
                    conditions.Add($"COALESCE(({usernameExpr})::text, '') NOT ILIKE 'deleted_%'");

                conditions.Add($"COALESCE(({displayNameExpr})::text, '') NOT ILIKE 'Deleted duplicate user%'");

                if (!string.IsNullOrWhiteSpace(term))
                {
                    conditions.Add(@"(
                            COALESCE((" + displayNameExpr + @")::text, '') ILIKE @search
                         OR COALESCE((" + usernameExpr + @")::text, '') ILIKE @search
                         OR COALESCE((" + emailExpr + @")::text, '') ILIKE @search
                         OR COALESCE((" + phoneExpr + @")::text, '') ILIKE @search
                         OR COALESCE((" + roleExpr + @")::text, '') ILIKE @search)");
                }

                var sql = $@"
SELECT COUNT(*) OVER() AS total,
       ({idExpr})::text AS id,
       ({usernameExpr})::text AS username,
       ({emailExpr})::text AS email,
       ({displayNameExpr})::text AS displayname,
       ({photoExpr})::text AS profilephotourl,
       ({phoneExpr})::text AS phone,
       ({roleExpr})::text AS role
FROM public.users u
WHERE {string.Join(" AND ", conditions)}
ORDER BY COALESCE(({displayNameExpr})::text, ({usernameExpr})::text, ({emailExpr})::text, ({phoneExpr})::text, '') ASC,
         ({idExpr}) ASC
LIMIT @limit OFFSET @offset;";

                using var cmd = conn.CreateCommand();
                cmd.CommandText = sql;
                AddParam(cmd, "currentUserId", currentUserId);
                AddParam(cmd, "limit", limit);
                AddParam(cmd, "offset", offset);
                if (!string.IsNullOrWhiteSpace(term)) AddParam(cmd, "search", $"%{term}%");

                var items = new List<object>();
                var total = 0;
                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    if (total == 0 && reader["total"] != DBNull.Value)
                        total = Convert.ToInt32(reader["total"]);

                    string? S(string name) => reader[name] == DBNull.Value ? null : reader[name]?.ToString();
                    var displayName = S("displayname");
                    var username = S("username");
                    var email = S("email");
                    var phone = S("phone");
                    items.Add(new
                    {
                        id = S("id"),
                        username,
                        email,
                        displayName,
                        name = displayName ?? username ?? email ?? phone,
                        profilePhotoUrl = S("profilephotourl"),
                        phone,
                        role = S("role")
                    });
                }

                return Ok(new { items, total, page, limit });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving chat contacts.");
                return StatusCode(500, "Error retrieving chat contacts.");
            }
        }

        [HttpPost]
        public async Task<IActionResult> CreateChat([FromBody] JsonElement body)
        {
            var licenseError = await RequireChatModuleAsync();
            if (licenseError != null) return licenseError;

            string? identifier = null;
            string? groupName = null;
            var isGroup = false;
            var groupMemberIds = new List<Guid>();
            Guid targetUserId = Guid.Empty;

            try
            {
                foreach (var key in new[] { "userId", "UserId", "id", "Id", "targetUserId", "TargetUserId" })
                {
                    if (body.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String)
                    {
                        var raw = v.GetString()?.Trim();
                        if (Guid.TryParse(raw, out targetUserId)) break;
                    }
                }

                foreach (var key in new[] { "usernameOrEmail", "UsernameOrEmail", "username", "email" })
                {
                    if (body.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String)
                    {
                        identifier = v.GetString()?.Trim();
                        break;
                    }
                }

                foreach (var key in new[] { "isGroup", "IsGroup", "group", "Group" })
                {
                    if (body.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.True)
                    {
                        isGroup = true;
                        break;
                    }
                }

                foreach (var key in new[] { "name", "Name", "groupName", "GroupName", "title", "Title" })
                {
                    if (body.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String)
                    {
                        groupName = v.GetString()?.Trim();
                        break;
                    }
                }

                foreach (var key in new[] { "memberIds", "MemberIds", "members", "Members", "userIds", "UserIds", "participantIds", "ParticipantIds" })
                {
                    if (!body.TryGetProperty(key, out var members) || members.ValueKind != JsonValueKind.Array)
                        continue;

                    foreach (var item in members.EnumerateArray())
                    {
                        Guid parsed;
                        if (item.ValueKind == JsonValueKind.String && Guid.TryParse(item.GetString(), out parsed))
                        {
                            groupMemberIds.Add(parsed);
                            continue;
                        }

                        if (item.ValueKind != JsonValueKind.Object)
                            continue;

                        foreach (var idKey in new[] { "id", "Id", "userId", "UserId" })
                        {
                            if (item.TryGetProperty(idKey, out var idValue)
                                && idValue.ValueKind == JsonValueKind.String
                                && Guid.TryParse(idValue.GetString(), out parsed))
                            {
                                groupMemberIds.Add(parsed);
                                break;
                            }
                        }
                    }

                    if (groupMemberIds.Count > 0) break;
                }

                if (!isGroup && !string.IsNullOrWhiteSpace(groupName) && groupMemberIds.Count > 0)
                    isGroup = true;
            }
            catch { }

            var currentUserId = User.GetUserIdGuid();
            if (currentUserId == Guid.Empty) return Unauthorized();
            var tenantId = await GetCurrentTenantIdAsync();

            if (isGroup)
            {
                groupName = groupName?.Trim();
                if (string.IsNullOrWhiteSpace(groupName))
                    return BadRequest("Group name is required.");

                var distinctMemberIds = groupMemberIds
                    .Where(id => id != Guid.Empty && id != currentUserId)
                    .Distinct()
                    .ToArray();

                if (distinctMemberIds.Length == 0)
                    return BadRequest("At least one group member is required.");

                Chat createdGroupChat;
                try
                {
                    createdGroupChat = await _chatService.CreateGroupChatAsync(currentUserId, groupName, distinctMemberIds);
                }
                catch (ArgumentException ex)
                {
                    return BadRequest(ex.Message);
                }
                catch (InvalidOperationException ex)
                {
                    return BadRequest(ex.Message);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to create group chat for {UserId} with {MemberCount} members", currentUserId, distinctMemberIds.Length);
                    return StatusCode(500, "Failed to create group chat.");
                }

                var groupSummary = await GetChatSummaryForUserAsync(currentUserId, createdGroupChat.Id)
                    ?? new ChatSummaryDto(createdGroupChat.Id, createdGroupChat.Name, createdGroupChat.IsGroup, null, 0);

                try
                {
                    var memberIds = await _chatService.GetChatMemberIdsAsync(createdGroupChat.Id);
                    await NotifyChatMembersAsync(memberIds.Where(id => id != currentUserId), "ChatCreated", groupSummary);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "ChatCreated notification failed for group chat {ChatId}", createdGroupChat.Id);
                }

                return Ok(groupSummary);
            }

            if (targetUserId == Guid.Empty && !string.IsNullOrWhiteSpace(identifier) && Guid.TryParse(identifier, out var parsedIdentifierId))
                targetUserId = parsedIdentifierId;

            if (targetUserId == Guid.Empty && string.IsNullOrWhiteSpace(identifier))
                return BadRequest("userId or usernameOrEmail is required.");

            if (targetUserId != Guid.Empty)
            {
                var targetInTenant = await _db.Users.AsNoTracking().AnyAsync(u => u.Id == targetUserId && u.TenantId == tenantId);
                if (!targetInTenant) return NotFound("target user not found in this church.");
            }
            else if (!string.IsNullOrWhiteSpace(identifier))
            {
                var normalized = identifier.Trim().ToLowerInvariant();
                var targetInTenant = await _db.Users.AsNoTracking().AnyAsync(u =>
                    u.TenantId == tenantId &&
                    ((u.Username != null && u.Username.ToLower() == normalized) ||
                     (u.Email != null && u.Email.ToLower() == normalized) ||
                     (u.Phone != null && u.Phone == identifier)));
                if (!targetInTenant) return NotFound("target user not found in this church.");
            }

            Chat createdChat;
            try
            {
                createdChat = targetUserId != Guid.Empty
                    ? await _chatService.CreateOrGetDirectChatAsync(currentUserId, targetUserId)
                    : await _chatService.CreateOrGetDirectChatAsync(currentUserId, identifier!);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to create direct chat for {UserId} target {TargetUserId} identifier {Identifier}", currentUserId, targetUserId, identifier);
                return StatusCode(500, "Failed to create/find chat.");
            }

            var summary = await GetChatSummaryForUserAsync(currentUserId, createdChat.Id)
                ?? new ChatSummaryDto(createdChat.Id, createdChat.Name, createdChat.IsGroup, null, 0);

            try
            {
                var memberIds = await _chatService.GetChatMemberIdsAsync(createdChat.Id);
                await NotifyChatMembersAsync(memberIds.Where(id => id != currentUserId), "ChatCreated", summary);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "ChatCreated notification failed for chat {ChatId}", createdChat.Id);
            }

            return Ok(summary);
        }

        [HttpGet("{chatId}/messages")]
        public async Task<IActionResult> GetMessages(Guid chatId, int page = 1, int size = 50, int? take = null)
        {
            var licenseError = await RequireChatModuleAsync();
            if (licenseError != null) return licenseError;

            var userId = User.GetUserIdGuid();
            if (userId == Guid.Empty) return Unauthorized();

            var memberIds = await GetAuthorizedMemberIdsAsync(chatId, userId);
            if (memberIds == null) return Forbid();

            if (take.HasValue && take.Value > 0) size = take.Value;
            size = Math.Clamp(size, 1, 100);
            page = Math.Max(page, 1);

            var messages = await _chatService.GetMessagesAsync(chatId, page, size);
            var items = messages.Items.ToList();
            var outgoingIds = items
                .Where(m => m.SenderId == userId)
                .Select(m => m.Id)
                .ToList();

            if (outgoingIds.Count > 0)
            {
                var requiredReaders = Math.Max(0, memberIds.Count - 1);
                var readRows = await _db.MessageReads
                    .AsNoTracking()
                    .Where(r => outgoingIds.Contains(r.MessageId) && r.UserId != userId)
                    .Select(r => new { r.MessageId, r.UserId })
                    .ToListAsync();
                var readCounts = readRows
                    .GroupBy(r => r.MessageId)
                    .ToDictionary(g => g.Key, g => g.Select(r => r.UserId).Distinct().Count());

                foreach (var message in items.Where(m => m.SenderId == userId))
                {
                    var count = readCounts.TryGetValue(message.Id, out var c) ? c : 0;
                    message.Status = requiredReaders > 0 && count >= requiredReaders ? "read" : "delivered";
                }
            }

            return Ok(messages);
        }

        [HttpGet("{chatId:guid}/members")]
        public async Task<IActionResult> GetChatMembers(Guid chatId)
        {
            var licenseError = await RequireChatModuleAsync();
            if (licenseError != null) return licenseError;

            var userId = User.GetUserIdGuid();
            if (userId == Guid.Empty) return Unauthorized();

            await EnsureGroupPhotoColumnAsync();
            var tenantId = await GetCurrentTenantIdAsync();
            var authorizedMemberIds = await GetAuthorizedMemberIdsAsync(chatId, userId);
            if (authorizedMemberIds == null) return Forbid();

            var chat = await _db.Chats
                .AsNoTracking()
                .Where(c => c.Id == chatId && c.TenantId == tenantId)
                .Select(c => new
                {
                    c.Id,
                    c.Name,
                    c.IsGroup,
                    c.CreatedBy,
                    c.CreatedAt,
                    c.GroupPhotoUrl
                })
                .FirstOrDefaultAsync();

            if (chat == null) return NotFound();

            var members = await _db.ChatMembers
                .AsNoTracking()
                .Where(cm => cm.ChatId == chatId && cm.Chat.TenantId == tenantId && cm.User.TenantId == tenantId)
                .OrderByDescending(cm => cm.UserId == chat.CreatedBy || (cm.Role != null && cm.Role.ToLower() == "admin"))
                .ThenBy(cm => cm.User != null ? cm.User.DisplayName ?? cm.User.Username ?? cm.User.Email : null)
                .Select(cm => new
                {
                    userId = cm.UserId,
                    displayName = cm.User != null ? cm.User.DisplayName : null,
                    username = cm.User != null ? cm.User.Username : null,
                    email = cm.User != null ? cm.User.Email : null,
                    profilePhotoUrl = cm.User != null ? cm.User.ProfilePhotoUrl : null,
                    role = cm.Role,
                    isAdmin = cm.UserId == chat.CreatedBy || (cm.Role != null && cm.Role.ToLower() == "admin"),
                    joinedAt = cm.JoinedAt
                })
                .ToListAsync();

            return Ok(new
            {
                chatId = chat.Id,
                name = chat.Name,
                isGroup = chat.IsGroup,
                groupPhotoUrl = chat.GroupPhotoUrl,
                adminUserId = chat.CreatedBy,
                createdAt = chat.CreatedAt,
                memberCount = members.Count,
                members
            });
        }

        public class UpdateGroupPhotoDto
        {
            public string? PhotoUrl { get; set; }
            public string? GroupPhotoUrl { get; set; }
            public string? Url { get; set; }
        }

        [HttpPut("{chatId:guid}/photo")]
        public async Task<IActionResult> UpdateGroupPhoto(Guid chatId, [FromBody] UpdateGroupPhotoDto dto)
        {
            var licenseError = await RequireChatModuleAsync();
            if (licenseError != null) return licenseError;

            var userId = User.GetUserIdGuid();
            if (userId == Guid.Empty) return Unauthorized();

            await EnsureGroupPhotoColumnAsync();
            var tenantId = await GetCurrentTenantIdAsync();
            var chat = await _db.Chats.FirstOrDefaultAsync(c => c.Id == chatId && c.TenantId == tenantId);
            if (chat == null) return NotFound();
            if (!chat.IsGroup) return BadRequest("Only group chats can have a group display photo.");

            var membership = await _db.ChatMembers
                .AsNoTracking()
                .FirstOrDefaultAsync(cm => cm.ChatId == chatId && cm.UserId == userId && cm.Chat.TenantId == tenantId && cm.User.TenantId == tenantId);
            if (membership == null) return Forbid();

            var canUpdate = chat.CreatedBy == userId
                || string.Equals(membership.Role, "admin", StringComparison.OrdinalIgnoreCase);
            if (!canUpdate) return Forbid();

            var photoUrl = (dto.GroupPhotoUrl ?? dto.PhotoUrl ?? dto.Url ?? "").Trim();
            if (photoUrl.Length > 2048) return BadRequest("Photo URL is too long.");

            chat.GroupPhotoUrl = string.IsNullOrWhiteSpace(photoUrl) ? null : photoUrl;
            await _db.SaveChangesAsync();

            var memberIds = await _chatService.GetChatMemberIdsAsync(chatId);
            foreach (var memberId in memberIds.Distinct())
            {
                var summary = await GetChatSummaryForUserAsync(memberId, chatId)
                    ?? new ChatSummaryDto(chat.Id, chat.Name, chat.IsGroup, null, 0, GroupPhotoUrl: chat.GroupPhotoUrl);
                await NotifyChatMembersAsync(new[] { memberId }, "ChatUpdated", summary);
            }

            var currentSummary = await GetChatSummaryForUserAsync(userId, chatId)
                ?? new ChatSummaryDto(chat.Id, chat.Name, chat.IsGroup, null, 0, GroupPhotoUrl: chat.GroupPhotoUrl);
            return Ok(currentSummary);
        }

        [HttpPost("{chatId}/messages")]
        public async Task<IActionResult> PostMessage(Guid chatId, [FromBody] CreateMessageDto dto)
        {
            var licenseError = await RequireChatModuleAsync();
            if (licenseError != null) return licenseError;

            if (!ModelState.IsValid) return BadRequest(ModelState);

            var userId = User.GetUserIdGuid();
            if (userId == Guid.Empty) return Unauthorized();

            var memberIds = await GetAuthorizedMemberIdsAsync(chatId, userId);
            if (memberIds == null) return Forbid();

            MessageDto created;
            try
            {
                created = await _chatService.AddMessageAsync(
                    chatId, userId, dto.Content, dto.ContentType ?? "text", dto.AttachmentUrl, dto.Attachments);
            }
            catch (UnauthorizedAccessException ex)
            {
                return StatusCode(403, ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                return StatusCode(403, ex.Message);
            }

        try
        {
            await NotifyChatMembersAsync(memberIds, "ReceiveMessage", created);
            if (_mobilePush != null)
                await _mobilePush.NotifyChatMessageAsync(chatId, userId, memberIds, created);

            var pastorMessages = await _pastorBot.TryReplyInChatAsync(chatId, userId, dto.Content, HttpContext.RequestAborted);
            foreach (var pastorMessage in pastorMessages)
            {
                var updatedMemberIds = (await _chatService.GetChatMemberIdsAsync(pastorMessage.ChatId)).Distinct().ToList();
                await NotifyChatMembersAsync(updatedMemberIds, "ReceiveMessage", pastorMessage);
                if (_mobilePush != null)
                    await _mobilePush.NotifyChatMessageAsync(pastorMessage.ChatId, pastorMessage.SenderId, updatedMemberIds, pastorMessage);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Chat notification or AI Pastor reply failed for chat {ChatId}", chatId);
        }

            return Ok(created);
        }

        [HttpGet("{chatId:guid}/block-status")]
        public async Task<IActionResult> GetBlockStatus(Guid chatId)
        {
            var licenseError = await RequireChatModuleAsync();
            if (licenseError != null) return licenseError;

            var userId = User.GetUserIdGuid();
            if (userId == Guid.Empty) return Unauthorized();

            try
            {
                var status = await _chatService.GetBlockStatusAsync(chatId, userId);
                return Ok(status);
            }
            catch (UnauthorizedAccessException)
            {
                return Forbid();
            }
            catch (ArgumentException ex)
            {
                return NotFound(ex.Message);
            }
        }

        [HttpPost("{chatId:guid}/block")]
        public async Task<IActionResult> BlockChatUser(Guid chatId)
        {
            var licenseError = await RequireChatModuleAsync();
            if (licenseError != null) return licenseError;

            var userId = User.GetUserIdGuid();
            if (userId == Guid.Empty) return Unauthorized();

            try
            {
                var before = await _chatService.GetBlockStatusAsync(chatId, userId);
                var status = await _chatService.BlockChatUserAsync(chatId, userId);

                if (before.OtherUserId.HasValue)
                {
                    await NotifyChatMembersAsync(new[] { userId, before.OtherUserId.Value }, "ChatBlockChanged", new
                    {
                        chatId,
                        blockerId = userId,
                        blockedId = before.OtherUserId.Value,
                        isBlocked = true,
                        at = DateTime.UtcNow
                    });
                }

                return Ok(status);
            }
            catch (UnauthorizedAccessException)
            {
                return Forbid();
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (ArgumentException ex)
            {
                return NotFound(ex.Message);
            }
        }

        [HttpDelete("{chatId:guid}/block")]
        public async Task<IActionResult> UnblockChatUser(Guid chatId)
        {
            var licenseError = await RequireChatModuleAsync();
            if (licenseError != null) return licenseError;

            var userId = User.GetUserIdGuid();
            if (userId == Guid.Empty) return Unauthorized();

            try
            {
                var before = await _chatService.GetBlockStatusAsync(chatId, userId);
                var status = await _chatService.UnblockChatUserAsync(chatId, userId);

                if (before.OtherUserId.HasValue)
                {
                    await NotifyChatMembersAsync(new[] { userId, before.OtherUserId.Value }, "ChatBlockChanged", new
                    {
                        chatId,
                        blockerId = userId,
                        blockedId = before.OtherUserId.Value,
                        isBlocked = false,
                        at = DateTime.UtcNow
                    });
                }

                return Ok(status);
            }
            catch (UnauthorizedAccessException)
            {
                return Forbid();
            }
            catch (InvalidOperationException ex)
            {
                return BadRequest(ex.Message);
            }
            catch (ArgumentException ex)
            {
                return NotFound(ex.Message);
            }
        }

        [HttpDelete("{chatId:guid}/messages/{messageId:guid}/everyone")]
        public async Task<IActionResult> DeleteMessageForEveryone(Guid chatId, Guid messageId)
        {
            var licenseError = await RequireChatModuleAsync();
            if (licenseError != null) return licenseError;

            var userId = User.GetUserIdGuid();
            if (userId == Guid.Empty) return Unauthorized();

            var memberIds = await GetAuthorizedMemberIdsAsync(chatId, userId);
            if (memberIds == null) return Forbid();

            await _chatService.DeleteMessageForEveryoneAsync(chatId, messageId, userId);

            try
            {
                await NotifyChatMembersAsync(memberIds, "MessageDeleted", new
                {
                    chatId,
                    messageId,
                    deletedBy = userId,
                    scope = "everyone",
                    at = DateTime.UtcNow
                });
            }
            catch { }

            return NoContent();
        }

       [HttpPost("{chatId}/read")]
public async Task<IActionResult> MarkRead(Guid chatId, [FromBody] MarkReadDto dto)
{
    var licenseError = await RequireChatModuleAsync();
    if (licenseError != null) return licenseError;

    if (!ModelState.IsValid) return BadRequest(ModelState);

    var userId = User.GetUserIdGuid();
    if (userId == Guid.Empty) return Unauthorized();

    var memberIds = await GetAuthorizedMemberIdsAsync(chatId, userId);
    if (memberIds == null) return Forbid();

    Guid lastMessageId = dto?.LastMessageId ?? Guid.Empty;

    // If client didn't send messageId → fallback to *latest* message in chat
    if (lastMessageId == Guid.Empty)
    {
        var page = await _chatService.GetMessagesAsync(chatId, page: 1, size: 1);
        var latest = page?.Items?.LastOrDefault();
        if (latest != null)
            lastMessageId = latest.Id; // Guid ✅
    }

    if (lastMessageId == Guid.Empty)
        return Ok(new { marked = 0 });

    await _chatService.MarkReadAsync(chatId, userId, lastMessageId);

    try
    {
        await NotifyChatMembersAsync(memberIds.Where(id => id != userId), "ReadReceipt", new
        {
            chatId,
            userId,
            lastMessageId,
            at = DateTime.UtcNow
        });
    }
    catch { }

    return Ok(new { marked = 1, lastMessageId });
}

        private static void AddParam(System.Data.Common.DbCommand cmd, string name, object? value)
        {
            var p = cmd.CreateParameter();
            p.ParameterName = name.StartsWith("@") ? name : "@" + name;
            p.Value = value ?? DBNull.Value;
            cmd.Parameters.Add(p);
        }

        private static async Task<HashSet<string>> GetUsersColumnsAsync(System.Data.Common.DbConnection conn)
        {
            var columns = new HashSet<string>(StringComparer.Ordinal);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users';";

            using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                if (!reader.IsDBNull(0)) columns.Add(reader.GetString(0));
            }

            return columns;
        }

    }
}

