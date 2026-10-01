using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Helpers;
using Mahima.Api.v3.clean.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Npgsql;
using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Services
{
    // The one place every notification - old and new - sends through: email and
    // "Jai Masih" chat + Firebase push, each independently try/caught so a
    // failure in one channel never blocks or rolls back the other.
    public interface INotificationDelivery
    {
        Task SendEmailAsync(string toEmail, string subject, string message, CancellationToken ct = default);
        Task SendBulkEmailAsync(IEnumerable<string> emails, string subject, string message, CancellationToken ct = default);
        Task SendJaiMasihDirectAsync(Guid tenantId, Guid recipientUserId, string message, string contentType = "notification", CancellationToken ct = default);
        Task SendJaiMasihBroadcastAsync(Guid tenantId, string message, CancellationToken ct = default);
        Task<List<Guid>> ResolveGroupUserIdsAsync(Guid tenantId, string targetGroup, CancellationToken ct = default);
    }

    public class NotificationDelivery : INotificationDelivery
    {
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");
        private const int EmailBatchSize = 15;
        private static readonly TimeSpan EmailBatchDelay = TimeSpan.FromSeconds(2);

        private readonly MahimaDbContext _db;
        private readonly IEmailService _email;
        private readonly IChatService _chat;
        private readonly IPastorBotService _pastorBot;
        private readonly IHubContext<ChatHub> _hub;
        private readonly IMobilePushNotificationService? _mobilePush;
        private readonly ILogger<NotificationDelivery> _logger;

        public NotificationDelivery(
            MahimaDbContext db,
            IEmailService email,
            IChatService chat,
            IPastorBotService pastorBot,
            IHubContext<ChatHub> hub,
            IEnumerable<IMobilePushNotificationService> mobilePushServices,
            ILogger<NotificationDelivery> logger)
        {
            _db = db;
            _email = email;
            _chat = chat;
            _pastorBot = pastorBot;
            _hub = hub;
            _mobilePush = mobilePushServices?.FirstOrDefault();
            _logger = logger;
        }

        public async Task SendEmailAsync(string toEmail, string subject, string message, CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(toEmail)) return;
            try
            {
                var html = $"<p>{System.Net.WebUtility.HtmlEncode(message).Replace("\n", "<br>")}</p>";
                await _email.SendAsync(toEmail, subject, html, message);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Notification email failed for {Email}", toEmail);
            }
        }

        public async Task SendBulkEmailAsync(IEnumerable<string> emails, string subject, string message, CancellationToken ct = default)
        {
            var list = emails.Where(e => !string.IsNullOrWhiteSpace(e)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            for (var i = 0; i < list.Count; i += EmailBatchSize)
            {
                foreach (var email in list.Skip(i).Take(EmailBatchSize))
                    await SendEmailAsync(email, subject, message, ct);

                if (i + EmailBatchSize < list.Count)
                    await Task.Delay(EmailBatchDelay, ct);
            }
        }

        public async Task SendJaiMasihDirectAsync(Guid tenantId, Guid recipientUserId, string message, string contentType = "notification", CancellationToken ct = default)
        {
            if (recipientUserId == Guid.Empty) return;

            try
            {
                var botUserId = await _pastorBot.EnsurePastorBotUserAsync(tenantId, ct);
                if (recipientUserId == botUserId) return;

                var chat = await _chat.CreateOrGetDirectChatAsync(botUserId, recipientUserId);
                var sent = await _chat.AddMessageAsync(chat.Id, botUserId, message, contentType);

                try
                {
                    await _hub.Clients.Users(new[] { botUserId.ToString(), recipientUserId.ToString() })
                        .SendAsync("ReceiveMessage", sent, ct);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "SignalR broadcast failed for notification to {UserId}", recipientUserId);
                }

                if (_mobilePush != null)
                {
                    try
                    {
                        await _mobilePush.NotifyChatMessageAsync(chat.Id, botUserId, new[] { recipientUserId }, sent);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Mobile push failed for notification to {UserId}", recipientUserId);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Jai Masih direct notification failed for {UserId}", recipientUserId);
            }
        }

        public async Task SendJaiMasihBroadcastAsync(Guid tenantId, string message, CancellationToken ct = default)
        {
            try
            {
                var sent = await _pastorBot.SendJaiMasihMessageAsync(message, tenantId, ct);

                var memberIds = await _db.ChatMembers
                    .AsNoTracking()
                    .Where(cm => cm.ChatId == sent.ChatId)
                    .Select(cm => cm.UserId)
                    .Distinct()
                    .ToListAsync(ct);

                if (memberIds.Count == 0) return;

                try
                {
                    await _hub.Clients.Users(memberIds.Select(id => id.ToString()).ToList())
                        .SendAsync("ReceiveMessage", sent, ct);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "SignalR broadcast failed for tenant {TenantId}", tenantId);
                }

                if (_mobilePush != null)
                {
                    try
                    {
                        await _mobilePush.NotifyChatMessageAsync(sent.ChatId, sent.SenderId, memberIds, sent);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Mobile push failed for tenant broadcast {TenantId}", tenantId);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Jai Masih broadcast failed for tenant {TenantId}", tenantId);
            }
        }

        public async Task<List<Guid>> ResolveGroupUserIdsAsync(Guid tenantId, string targetGroup, CancellationToken ct = default)
        {
            var group = (targetGroup ?? "").Trim();

            if (string.Equals(group, "root-admins", StringComparison.OrdinalIgnoreCase))
                return await ResolveAdminsAsync(RootTenantId, ct);

            if (string.Equals(group, "tenant-admins", StringComparison.OrdinalIgnoreCase))
                return await ResolveAdminsAsync(tenantId, ct);

            if (string.Equals(group, "tenant-members", StringComparison.OrdinalIgnoreCase))
                return await _db.Users.AsNoTracking().Where(u => u.TenantId == tenantId).Select(u => u.Id).ToListAsync(ct);

            if (group.StartsWith("position:", StringComparison.OrdinalIgnoreCase))
                return await ResolvePositionAsync(tenantId, group.Substring("position:".Length), ct);

            if (group.StartsWith("team:", StringComparison.OrdinalIgnoreCase) &&
                long.TryParse(group.Substring("team:".Length), out var teamId))
                return await _db.TeamMembers.AsNoTracking().Where(tm => tm.TeamId == teamId).Select(tm => tm.UserId).ToListAsync(ct);

            return new List<Guid>();
        }

        private async Task<List<Guid>> ResolveAdminsAsync(Guid tenantId, CancellationToken ct)
        {
            return await _db.Users.AsNoTracking()
                .Where(u => u.TenantId == tenantId && u.Role != null &&
                    (u.Role.ToLower() == "admin" || u.Role.ToLower() == "administrator"))
                .Select(u => u.Id)
                .ToListAsync(ct);
        }

        private async Task<List<Guid>> ResolvePositionAsync(Guid tenantId, string positionName, CancellationToken ct)
        {
            var normalized = new string((positionName ?? "").ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
            if (string.IsNullOrWhiteSpace(normalized)) return new List<Guid>();

            var conn = _db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);
            await Mahima.Api.v3.clean.Controllers.PositionsController.EnsurePositionTablesAsync((NpgsqlConnection)conn);

            await using var cmd = new NpgsqlCommand(@"
SELECT DISTINCT up.user_id
FROM public.user_positions up
JOIN public.positions p ON p.id = up.position_id AND p.is_active = true AND p.tenant_id = @tenantId
WHERE lower(regexp_replace(p.name, '[^a-z0-9]+', '', 'g')) = @name;", (NpgsqlConnection)conn);
            cmd.Parameters.AddWithValue("tenantId", tenantId);
            cmd.Parameters.AddWithValue("name", normalized);

            var ids = new List<Guid>();
            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct)) ids.Add(rdr.GetGuid(0));
            return ids;
        }
    }
}
