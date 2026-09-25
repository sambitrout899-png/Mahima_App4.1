using Mahima.Api.v3.clean.Data;
// Mahima.Api/Services/ChatService.Full.cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Logging;
using Mahima.Api.v3.clean.Dtos;
using Mahima.Api.v3.clean.Models;

namespace Mahima.Api.v3.clean.Services
{
    public class ChatService : IChatService
    {
        private readonly MahimaDbContext _db;
        private readonly ILogger<ChatService> _logger;
        private readonly ITenantContextService _tenantContext;
        private const string ProtectedContentPrefix = "protected:";

        public ChatService(MahimaDbContext db, ILogger<ChatService> logger, ITenantContextService tenantContext)
        {
            _db = db ?? throw new ArgumentNullException(nameof(db));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
            _tenantContext = tenantContext ?? throw new ArgumentNullException(nameof(tenantContext));
        }

        // ---------- helpers ----------
        private async Task<bool> IsUserParticipantAsync(Guid chatId, Guid userId)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            return await _db.ChatMembers
                .AsNoTracking()
                .AnyAsync(cm =>
                    cm.ChatId == chatId &&
                    cm.UserId == userId &&
                    cm.Chat.TenantId == tenantId &&
                    cm.User.TenantId == tenantId);
        }

        private async Task<Guid> GetCurrentTenantIdAsync()
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync();
            return tenant?.Id ?? Guid.Parse("00000000-0000-0000-0000-000000000001");
        }

        private Task<bool> IsUserAdminAsync(Guid userId)
        {
            // Implement your own admin check here if needed.
            return Task.FromResult(false);
        }

        private string ProtectMessageContent(string? content)
        {
            var plain = content ?? string.Empty;
            return plain;
        }

        private string? UnprotectMessageContent(string? content)
        {
            if (string.IsNullOrEmpty(content))
                return content;

            if (!content.StartsWith(ProtectedContentPrefix, StringComparison.Ordinal))
                return content;

            return content.Substring(ProtectedContentPrefix.Length);
        }

        private MessageDto ToMessageDto(Message m)
        {
            var contentType = string.IsNullOrWhiteSpace(m.ContentType)
                ? "text"
                : m.ContentType;

            var attachments = string.IsNullOrWhiteSpace(m.AttachmentUrl)
                ? null
                : new List<AttachmentDto>
                {
                    new AttachmentDto("", contentType, m.AttachmentUrl)
                };

            return new MessageDto(
                m.Id,
                m.ChatId,
                m.SenderId,
                UnprotectMessageContent(m.Content),
                m.CreatedAt,
                contentType,
                m.AttachmentUrl,
                attachments);
        }

        // ---------- IChatService implementation ----------

        public async Task<IEnumerable<ChatSummaryDto>> GetUserChatsAsync(Guid userId)
        {
            var tenantId = await GetCurrentTenantIdAsync();

            // get chat ids for the user (ChatId is Guid)
            var chatIds = await _db.ChatMembers
                .AsNoTracking()
                .Where(cm => cm.UserId == userId)
                .Select(cm => cm.ChatId)
                .ToListAsync();

            if (chatIds == null || chatIds.Count == 0)
                return Array.Empty<ChatSummaryDto>();

            var chats = await _db.Chats
                .AsNoTracking()
                .Where(c => chatIds.Contains(c.Id) && c.TenantId == tenantId)
                .OrderByDescending(c => c.CreatedAt)
                .ToListAsync();

            var result = new List<ChatSummaryDto>(chats.Count);
            foreach (var c in chats)
            {
                // last message (Message.Id is Guid)
                var lastMsgEntity = await _db.Messages
                    .AsNoTracking()
                    .Where(m => m.ChatId == c.Id)
                    .OrderByDescending(m => m.CreatedAt)
                    .FirstOrDefaultAsync();
                var lastMsg = lastMsgEntity == null ? null : ToMessageDto(lastMsgEntity);

                // unread count: compare MessageRead.MessageId (Guid) with Message.Id (Guid)
                var unreadCount = await _db.Messages
                    .AsNoTracking()
                    .Where(m => m.ChatId == c.Id)
                    .Where(m => !_db.MessageReads.Any(r => r.MessageId == m.Id && r.UserId == userId))
                    .CountAsync();

                Guid? otherId = null;
                string? otherName = null;
                string? otherUsername = null;
                string? otherProfilePhotoUrl = null;

                if (!c.IsGroup)
                {
                    otherId = await _db.ChatMembers
                        .AsNoTracking()
                        .Where(cm => cm.ChatId == c.Id && cm.UserId != userId)
                        .Select(cm => (Guid?)cm.UserId)
                        .FirstOrDefaultAsync();

                    if (otherId.HasValue)
                    {
                        var otherUser = await _db.Users
                            .AsNoTracking()
                            .Where(u => u.Id == otherId.Value)
                            .Select(u => new { u.DisplayName, u.Username, u.Email, u.ProfilePhotoUrl })
                            .FirstOrDefaultAsync();

                        if (otherUser != null)
                        {
                            otherUsername = otherUser.Username;
                            otherProfilePhotoUrl = otherUser.ProfilePhotoUrl;
                            otherName = !string.IsNullOrWhiteSpace(otherUser.DisplayName)
                                ? otherUser.DisplayName
                                : !string.IsNullOrWhiteSpace(otherUser.Username)
                                    ? otherUser.Username
                                    : otherUser.Email;
                        }
                    }
                }

                var displayName = c.IsGroup ? c.Name : (otherName ?? c.Name);
                result.Add(new ChatSummaryDto(c.Id, displayName, c.IsGroup, lastMsg, unreadCount, otherId, otherName, otherUsername, otherProfilePhotoUrl));
            }

            return result;
        }

        public async Task<PaginatedResult<MessageDto>> GetMessagesAsync(Guid chatId, int page = 1, int size = 50)
        {
            if (page < 1) page = 1;
            if (size < 1) size = 50;

            var tenantId = await GetCurrentTenantIdAsync();
            var chatExists = await _db.Chats
                .AsNoTracking()
                .AnyAsync(c => c.Id == chatId && c.TenantId == tenantId);
            if (!chatExists)
                return new PaginatedResult<MessageDto>(new List<MessageDto>(), 0, page, size);

            var baseQuery = _db.Messages
                .AsNoTracking()
                .Where(m => m.ChatId == chatId)
                .OrderByDescending(m => m.CreatedAt);

            var total = await baseQuery.CountAsync();

            var messageEntities = await baseQuery
                .Skip((page - 1) * size)
                .Take(size)
                .OrderBy(m => m.CreatedAt)
                .ToListAsync();

            var items = messageEntities.Select(ToMessageDto).ToList();

            return new PaginatedResult<MessageDto>(items, total, page, size);
        }

        public async Task<MessageDto> AddMessageAsync(
            Guid chatId,
            Guid senderId,
            string content,
            string contentType = "text",
            string? attachmentUrl = null,
            List<AttachmentDto>? attachments = null)
        {
            // Ensure the sender is a member of the chat
            var isMember = await _db.ChatMembers
                .AsNoTracking()
                .AnyAsync(cm => cm.ChatId == chatId && cm.UserId == senderId);

            if (!isMember)
                throw new UnauthorizedAccessException("User is not a member of the chat.");

            await EnsureCanSendDirectChatAsync(chatId, senderId);

            var primaryAttachment = attachments?.FirstOrDefault(a => !string.IsNullOrWhiteSpace(a?.Url));
            var resolvedAttachmentUrl = attachmentUrl ?? primaryAttachment?.Url;
            var resolvedContentType = !string.IsNullOrWhiteSpace(contentType)
                ? contentType
                : primaryAttachment?.Type ?? "text";

            var msg = new Message
            {
                ChatId = chatId,        // Guid
                SenderId = senderId,    // Guid
                Content = ProtectMessageContent(content),
                ContentType = resolvedContentType,
                AttachmentUrl = resolvedAttachmentUrl,
                CreatedAt = DateTime.UtcNow
            };

            _db.Messages.Add(msg);
            await _db.SaveChangesAsync(); // populates msg.Id (Guid)

            // Build DTO via object initializer to avoid ctor arity mismatches
            var dto = new MessageDto(
                msg.Id,
                msg.ChatId,
                msg.SenderId,
                UnprotectMessageContent(msg.Content),
                msg.CreatedAt)
            {
                ContentType = msg.ContentType ?? "text",
                AttachmentUrl = msg.AttachmentUrl,
                Attachments = attachments?.Any() == true
                    ? attachments
                    : string.IsNullOrWhiteSpace(msg.AttachmentUrl)
                        ? null
                        : new List<AttachmentDto>
                        {
                            new AttachmentDto("", msg.ContentType ?? "application/octet-stream", msg.AttachmentUrl)
                        }
            };

            return dto;
        }

        // Matches IChatService exactly (Guid, Guid, Guid)
        public async Task MarkReadAsync(Guid chatId, Guid userId, Guid lastMessageId)
        {
            var isMember = await IsUserParticipantAsync(chatId, userId);
            if (!isMember)
                throw new UnauthorizedAccessException("User is not a member of the chat.");

            // lastMessageId corresponds to Message.Id (Guid)
            var lastMessage = await _db.Messages
                .AsNoTracking()
                .FirstOrDefaultAsync(m => m.Id == lastMessageId && m.ChatId == chatId);

            if (lastMessage == null)
            {
                _logger.LogWarning("MarkRead called with unknown message id {LastMessageId} for chat {ChatId}", lastMessageId, chatId);
                return;
            }

            // collect message ids up to timestamp of lastMessage
            var messagesToMark = await _db.Messages
                .Where(m => m.ChatId == chatId && m.CreatedAt <= lastMessage.CreatedAt)
                .Select(m => m.Id) // Guid
                .ToListAsync();

            if (messagesToMark == null || messagesToMark.Count == 0)
                return;

            var now = DateTime.UtcNow;
            var toInsert = new List<MessageRead>();

            foreach (var messageId in messagesToMark)
            {
                var exists = await _db.MessageReads.AnyAsync(r => r.MessageId == messageId && r.UserId == userId);
                if (!exists)
                {
                    toInsert.Add(new MessageRead { MessageId = messageId, UserId = userId, ReadAt = now });
                }
            }

            if (toInsert.Count > 0)
            {
                _db.MessageReads.AddRange(toInsert);
                await _db.SaveChangesAsync();
            }
        }

        public async Task DeleteMessageForEveryoneAsync(Guid chatId, Guid messageId, Guid requestedBy)
        {
            var isParticipant = await IsUserParticipantAsync(chatId, requestedBy);
            if (!isParticipant)
                throw new UnauthorizedAccessException("User is not a member of the chat.");

            var message = await _db.Messages.FirstOrDefaultAsync(m => m.Id == messageId && m.ChatId == chatId);
            if (message == null)
                return;

            if (message.SenderId != requestedBy)
                throw new UnauthorizedAccessException("Only the sender can delete this message for everyone.");

            var reads = _db.MessageReads.Where(r => r.MessageId == messageId);
            _db.MessageReads.RemoveRange(reads);
            _db.Messages.Remove(message);
            await _db.SaveChangesAsync();
        }

        public async Task<Chat> CreateOrGetDirectChatAsync(Guid userId, string usernameOrEmail)
        {
            if (string.IsNullOrWhiteSpace(usernameOrEmail))
                throw new ArgumentException("usernameOrEmail is required", nameof(usernameOrEmail));

            var tenantId = await GetCurrentTenantIdAsync();
            var normalized = usernameOrEmail.Trim().ToLowerInvariant();
            if (Guid.TryParse(normalized, out var parsedUserId))
                return await CreateOrGetDirectChatAsync(userId, parsedUserId);

            var other = await _db.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u =>
                    u.TenantId == tenantId &&
                    ((u.Username != null && u.Username.ToLower() == normalized) ||
                     (u.Email != null && u.Email.ToLower() == normalized) ||
                     (u.Phone != null && u.Phone.ToLower() == normalized) ||
                     (u.DisplayName != null && u.DisplayName.ToLower() == normalized)));

            if (other == null)
                throw new ArgumentException($"User not found: {usernameOrEmail}");

            if (other.Id == userId)
                throw new ArgumentException("Cannot create a chat with yourself.");

            var existingChat = await _db.Chats
                .Include(c => c.Members)
                .Where(c => c.TenantId == tenantId && !c.IsGroup)
                .Where(c => c.Members.Any(cm => cm.UserId == userId))
                .Where(c => c.Members.Any(cm => cm.UserId == other.Id))
                .FirstOrDefaultAsync();

            if (existingChat != null)
            {
                if (string.IsNullOrWhiteSpace(existingChat.Name))
                {
                    existingChat.Name = $"{other.Username ?? other.Email} - {existingChat.CreatedAt:yyyy-MM-dd HH:mm}";
                    try
                    {
                        _db.Chats.Update(existingChat);
                        await _db.SaveChangesAsync();
                    }
                    catch (Exception saveEx)
                    {
                        _logger.LogWarning(saveEx, "Failed to persist generated name for existing chat {ChatId}", existingChat.Id);
                    }
                }
                return existingChat;
            }

            var chat = new Chat
            {
                Name = $"{other.Username ?? other.Email}",
                IsGroup = false,
                TenantId = tenantId,
                CreatedBy = userId,
                CreatedAt = DateTime.UtcNow
            };

            _db.Chats.Add(chat);
            await _db.SaveChangesAsync(); // chat.Id (Guid) populated

            var members = new[]
            {
                new ChatMember { ChatId = chat.Id, UserId = userId, Role = "member", JoinedAt = DateTime.UtcNow },
                new ChatMember { ChatId = chat.Id, UserId = other.Id, Role = "member", JoinedAt = DateTime.UtcNow }
            };

            _db.ChatMembers.AddRange(members);
            await _db.SaveChangesAsync();
            return chat;
        }

        public async Task<Chat> CreateOrGetDirectChatAsync(Guid userA, Guid userB)
        {
            if (userA == Guid.Empty || userB == Guid.Empty)
                throw new ArgumentException("User ids are required");

            if (userA == userB)
                throw new ArgumentException("Cannot create a chat with yourself.");

            var tenantId = await GetCurrentTenantIdAsync();
            var otherUser = await _db.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userB && u.TenantId == tenantId);
            if (otherUser == null)
                throw new ArgumentException("User not found.");

            var smaller = userA.CompareTo(userB) <= 0 ? userA : userB;
            var larger  = userA.CompareTo(userB) <= 0 ? userB : userA;

            var existing = await _db.Chats
                .Include(c => c.Members)
                .Where(c => c.TenantId == tenantId && !c.IsGroup)
                .Where(c => c.Members.Any(m => m.UserId == smaller))
                .Where(c => c.Members.Any(m => m.UserId == larger))
                .FirstOrDefaultAsync();

            if (existing != null)
            {
                if (string.IsNullOrWhiteSpace(existing.Name))
                {
                    try
                    {
                        var otherMember = existing.Members.FirstOrDefault(m => m.UserId != userA);
                        if (otherMember != null)
                        {
                            var existingOtherUser = await _db.Users.AsNoTracking()
                                .Where(u => u.Id == otherMember.UserId)
                                .Select(u => new
                                {
                                    u.DisplayName,
                                    u.Username,
                                    u.Email
                                })
                                .FirstOrDefaultAsync();

                            // Avoid ternary parsing edge cases
                            var generatedName = existingOtherUser?.DisplayName ?? existingOtherUser?.Username ?? existingOtherUser?.Email
                                ?? $"Direct:{existing.CreatedAt:yyyy-MM-dd}";
                            existing.Name = generatedName;
                            _db.Chats.Update(existing);
                            await _db.SaveChangesAsync();
                        }
                    }
                    catch { /* non-fatal */ }
                }

                return existing;
            }

            var strategy = _db.Database.CreateExecutionStrategy();
            return await strategy.ExecuteAsync(async () =>
            {
                await using var tx = await _db.Database.BeginTransactionAsync();
                try
                {
                    var chat = new Chat
                    {
                        Name = otherUser.DisplayName ?? otherUser.Username ?? otherUser.Email,
                        IsGroup = false,
                        TenantId = tenantId,
                        CreatedBy = userA,
                        CreatedAt = DateTime.UtcNow
                    };

                    _db.Chats.Add(chat);
                    await _db.SaveChangesAsync(); // chat.Id populated

                    var members = new[]
                    {
                        new ChatMember { ChatId = chat.Id, UserId = userA, Role = "member", JoinedAt = DateTime.UtcNow },
                        new ChatMember { ChatId = chat.Id, UserId = userB, Role = "member", JoinedAt = DateTime.UtcNow }
                    };

                    _db.ChatMembers.AddRange(members);
                    await _db.SaveChangesAsync();

                    await tx.CommitAsync();

                    return chat;
                }
                catch
                {
                    try { await tx.RollbackAsync(); } catch { }
                    throw;
                }
            });
        }

        public async Task<IEnumerable<Guid>> GetChatMemberIdsAsync(Guid chatId)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var list = await _db.ChatMembers
                .AsNoTracking()
                .Where(cm => cm.ChatId == chatId && cm.Chat.TenantId == tenantId && cm.User.TenantId == tenantId)
                .Select(cm => cm.UserId)
                .ToListAsync();

            return list;
        }

        public async Task<ChatBlockStatusDto> GetBlockStatusAsync(Guid chatId, Guid userId)
        {
            if (chatId == Guid.Empty || userId == Guid.Empty)
                throw new UnauthorizedAccessException("Unauthorized");

            var tenantId = await GetCurrentTenantIdAsync();
            var chat = await _db.Chats.AsNoTracking().FirstOrDefaultAsync(c => c.Id == chatId && c.TenantId == tenantId);
            if (chat == null)
                throw new ArgumentException("Chat not found", nameof(chatId));

            var memberIds = await _db.ChatMembers
                .AsNoTracking()
                .Where(cm => cm.ChatId == chatId && cm.Chat.TenantId == tenantId && cm.User.TenantId == tenantId)
                .Select(cm => cm.UserId)
                .ToListAsync();

            if (!memberIds.Contains(userId))
                throw new UnauthorizedAccessException("User is not a member of the chat.");

            if (chat.IsGroup)
                return new ChatBlockStatusDto(chatId, false, null, false, false);

            var otherUserId = memberIds.FirstOrDefault(id => id != userId);
            if (otherUserId == Guid.Empty)
                return new ChatBlockStatusDto(chatId, true, null, false, false);

            var iBlockedThem = await _db.UserBlocks
                .AsNoTracking()
                .AnyAsync(b => b.BlockerId == userId && b.BlockedId == otherUserId);

            var theyBlockedMe = await _db.UserBlocks
                .AsNoTracking()
                .AnyAsync(b => b.BlockerId == otherUserId && b.BlockedId == userId);

            return new ChatBlockStatusDto(chatId, true, otherUserId, iBlockedThem, theyBlockedMe);
        }

        public async Task<ChatBlockStatusDto> BlockChatUserAsync(Guid chatId, Guid blockerId)
        {
            var status = await GetBlockStatusAsync(chatId, blockerId);
            if (!status.IsDirect || !status.OtherUserId.HasValue)
                throw new InvalidOperationException("Only direct chats can be blocked.");

            if (!status.IBlockedThem)
            {
                _db.UserBlocks.Add(new UserBlock
                {
                    BlockerId = blockerId,
                    BlockedId = status.OtherUserId.Value,
                    CreatedAt = DateTime.UtcNow
                });
                await _db.SaveChangesAsync();
            }

            return await GetBlockStatusAsync(chatId, blockerId);
        }

        public async Task<ChatBlockStatusDto> UnblockChatUserAsync(Guid chatId, Guid blockerId)
        {
            var status = await GetBlockStatusAsync(chatId, blockerId);
            if (!status.IsDirect || !status.OtherUserId.HasValue)
                throw new InvalidOperationException("Only direct chats can be unblocked.");

            var block = await _db.UserBlocks
                .FirstOrDefaultAsync(b => b.BlockerId == blockerId && b.BlockedId == status.OtherUserId.Value);
            if (block != null)
            {
                _db.UserBlocks.Remove(block);
                await _db.SaveChangesAsync();
            }

            return await GetBlockStatusAsync(chatId, blockerId);
        }

        public async Task EnsureCanSendDirectChatAsync(Guid chatId, Guid senderId)
        {
            var status = await GetBlockStatusAsync(chatId, senderId);
            if (!status.IsDirect || !status.IsBlocked) return;

            if (status.IBlockedThem)
                throw new InvalidOperationException("You blocked this user. Unblock to send messages.");

            throw new UnauthorizedAccessException("This user has blocked you.");
        }

        public async Task<Chat> CreateGroupChatAsync(Guid userId, string name, Guid[] memberIds)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var requestedIds = new HashSet<Guid>(memberIds ?? Array.Empty<Guid>());
            requestedIds.Add(userId);

            var validMemberIds = await _db.Users
                .AsNoTracking()
                .Where(u => u.TenantId == tenantId && requestedIds.Contains(u.Id))
                .Select(u => u.Id)
                .ToListAsync();

            if (!validMemberIds.Contains(userId))
                throw new UnauthorizedAccessException("Current user is not valid for this church.");

            var chat = new Chat
            {
                Name = name,
                IsGroup = true,
                TenantId = tenantId,
                CreatedBy = userId,
                CreatedAt = DateTime.UtcNow
            };

            _db.Chats.Add(chat);
            await _db.SaveChangesAsync();

            // Replace collection-initializer (can cause parse errors in some contexts)
            var members = validMemberIds.Distinct().Select(id => new ChatMember
            {
                ChatId = chat.Id,
                UserId = id,
                Role = id == userId ? "admin" : "member",
                JoinedAt = DateTime.UtcNow
            }).ToList();

            _db.ChatMembers.AddRange(members);
            await _db.SaveChangesAsync();

            return chat;
        }

        public async Task DeleteChatAsync(Guid chatId, Guid requestedBy)
        {
            var isParticipant = await IsUserParticipantAsync(chatId, requestedBy);
            var isAdmin = await IsUserAdminAsync(requestedBy);

            var chat = await _db.Chats.FirstOrDefaultAsync(c => c.Id == chatId);
            if (chat == null)
                throw new ArgumentException("Chat not found", nameof(chatId));

            if (!isParticipant && !isAdmin && chat.CreatedBy != requestedBy)
                throw new UnauthorizedAccessException("User is not allowed to delete this chat.");

            var strategy = _db.Database.CreateExecutionStrategy();
            await strategy.ExecuteAsync(async () =>
            {
                await using var tx = await _db.Database.BeginTransactionAsync();
                try
                {
                    // 1) fetch message ids for the chat (Guid)
                    var messageIds = await _db.Messages
                        .Where(m => m.ChatId == chatId)
                        .Select(m => m.Id)
                        .ToListAsync();

                    if (messageIds != null && messageIds.Count > 0)
                    {
                        var reads = _db.MessageReads.Where(r => messageIds.Contains(r.MessageId));
                        _db.MessageReads.RemoveRange(reads);
                    }

                    // 2) Delete messages
                    var messages = _db.Messages.Where(m => m.ChatId == chatId);
                    _db.Messages.RemoveRange(messages);

                    // 3) Delete chat members
                    var members = _db.ChatMembers.Where(cm => cm.ChatId == chatId);
                    _db.ChatMembers.RemoveRange(members);

                    // 4) Finally delete the chat
                    _db.Chats.Remove(chat);

                    await _db.SaveChangesAsync();
                    await tx.CommitAsync();
                }
                catch
                {
                    await tx.RollbackAsync();
                    throw;
                }
            });
        }

        public async Task SoftDeleteChatAsync(Guid chatId, Guid requestedBy)
        {
            var isParticipant = await IsUserParticipantAsync(chatId, requestedBy);
            var isAdmin = await IsUserAdminAsync(requestedBy);

            var chat = await _db.Chats.FirstOrDefaultAsync(c => c.Id == chatId);
            if (chat == null)
                throw new ArgumentException("Chat not found", nameof(chatId));

            if (!isParticipant && !isAdmin && chat.CreatedBy != requestedBy)
                throw new UnauthorizedAccessException("User is not allowed to delete this chat.");

            var chatType = typeof(Chat);
            var deletedAtProp = chatType.GetProperty("DeletedAt");
            var deletedByProp = chatType.GetProperty("DeletedBy");

            if (deletedAtProp == null || deletedByProp == null)
            {
                await DeleteChatAsync(chatId, requestedBy);
                return;
            }

            deletedAtProp.SetValue(chat, DateTime.UtcNow);
            deletedByProp.SetValue(chat, requestedBy);
            _db.Chats.Update(chat);
            await _db.SaveChangesAsync();
        }
    }
}

