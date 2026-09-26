using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Google.Apis.Auth.OAuth2;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Dtos;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Mahima.Api.v3.clean.Services
{
    public interface IMobilePushNotificationService
    {
        Task NotifyChatMessageAsync(Guid chatId, Guid senderId, IEnumerable<Guid> memberIds, MessageDto message);
        Task NotifyIncomingCallAsync(Guid chatId, Guid callerId, IEnumerable<Guid> memberIds, string callType);
        Task<bool> SendTestPushAsync(Guid tenantId, Guid userId, string message);
    }

    /// <summary>
    /// Sends native Android push notifications via Firebase Cloud Messaging V1 API.
    ///
    /// Configuration (appsettings.json or environment variables):
    ///   MobilePush:FirebaseProjectId   — Firebase project ID  (e.g. "mahima-ministry-abc12")
    ///   MobilePush:ServiceAccountJson  — Full path to the downloaded service-account JSON file
    ///                                    OR the raw JSON content as a single-line string
    ///
    /// Environment variable equivalents:
    ///   MAHIMA_FIREBASE_PROJECT_ID
    ///   MAHIMA_FIREBASE_SERVICE_ACCOUNT_JSON   (path or raw JSON)
    /// </summary>
    public class MobilePushNotificationService : IMobilePushNotificationService
    {
        private const string DeviceTokenPrefix = "DeviceToken:";
        private const string FcmScope = "https://www.googleapis.com/auth/firebase.messaging";

        private readonly MahimaDbContext _db;
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _configuration;
        private readonly ILogger<MobilePushNotificationService> _logger;

        // Cache the credential so we don't re-parse the JSON on every send.
        private GoogleCredential? _cachedCredential;
        private readonly SemaphoreSlim _credLock = new(1, 1);

        public MobilePushNotificationService(
            MahimaDbContext db,
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration,
            ILogger<MobilePushNotificationService> logger)
        {
            _db = db;
            _httpClientFactory = httpClientFactory;
            _configuration = configuration;
            _logger = logger;
        }

        // ── public entry point ───────────────────────────────────────────────

        public async Task NotifyChatMessageAsync(
            Guid chatId, Guid senderId, IEnumerable<Guid> memberIds, MessageDto message)
        {
            var projectId = ResolveFirebaseProjectId();

            if (string.IsNullOrWhiteSpace(projectId))
            {
                _logger.LogWarning(
                    "Skipping mobile push: Firebase project id is not configured. Set MobilePush:FirebaseProjectId, MAHIMA_FIREBASE_PROJECT_ID, or FIREBASE_PROJECT_ID.");
                return;
            }

            var recipientIds = memberIds
                .Where(id => id != Guid.Empty && id != senderId)
                .Distinct()
                .ToList();
            if (recipientIds.Count == 0) return;

            var tokens = await ReadTokensAsync(chatId, recipientIds);
            if (tokens.Count == 0) return;

            var senderName = await _db.Users
                .AsNoTracking()
                .Where(u => u.Id == senderId)
                .Select(u => !string.IsNullOrWhiteSpace(u.DisplayName) ? u.DisplayName : u.Username)
                .FirstOrDefaultAsync() ?? "Jai Masih";

            var preview = BuildPreview(message);

            string? accessToken;
            try
            {
                accessToken = await GetAccessTokenAsync();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "FCM V1: could not obtain access token — push skipped.");
                return;
            }

            _logger.LogInformation(
                "Sending mobile push for chat {ChatId} to {TokenCount} token(s), recipients={RecipientCount}.",
                chatId, tokens.Count, recipientIds.Count);

            // FCM V1 requires one request per token (no batch registration_ids).
            var tasks = tokens.Select(token =>
                SendFcmV1Async(projectId, accessToken, token, senderName, preview, chatId, message));

            await Task.WhenAll(tasks);
        }

        // ── FCM V1 send ──────────────────────────────────────────────────────

        public async Task NotifyIncomingCallAsync(
            Guid chatId, Guid callerId, IEnumerable<Guid> memberIds, string callType)
        {
            var projectId = ResolveFirebaseProjectId();
            if (string.IsNullOrWhiteSpace(projectId))
            {
                _logger.LogWarning("Skipping incoming call push: Firebase project id is not configured.");
                return;
            }

            var recipientIds = memberIds
                .Where(id => id != Guid.Empty && id != callerId)
                .Distinct()
                .ToList();
            if (recipientIds.Count == 0) return;

            var tokens = await ReadTokensAsync(chatId, recipientIds);
            if (tokens.Count == 0)
            {
                _logger.LogWarning("Skipping incoming call push: no registered device tokens for {RecipientCount} recipient(s).", recipientIds.Count);
                return;
            }

            var callerName = await _db.Users
                .AsNoTracking()
                .Where(u => u.Id == callerId)
                .Select(u => !string.IsNullOrWhiteSpace(u.DisplayName) ? u.DisplayName : u.Username)
                .FirstOrDefaultAsync() ?? "Jai Masih";

            string? accessToken;
            try
            {
                accessToken = await GetAccessTokenAsync();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "FCM V1: could not obtain access token for incoming call push.");
                return;
            }

            var normalizedType = string.Equals(callType, "video", StringComparison.OrdinalIgnoreCase) ? "video" : "audio";
            var tasks = tokens.Select(token =>
                SendIncomingCallFcmV1Async(projectId, accessToken, token, callerName, chatId, callerId, normalizedType));

            await Task.WhenAll(tasks);
        }

        private async Task SendFcmV1Async(
            string projectId, string accessToken, string deviceToken,
            string senderName, string preview, Guid chatId, MessageDto message)
        {
            var url = $"https://fcm.googleapis.com/v1/projects/{projectId}/messages:send";

            var payload = new
            {
                message = new
                {
                    token = deviceToken,

                    // Notification block — shown by OS when app is in background/killed.
                    notification = new
                    {
                        title = "Jai Masih Di",
                        body = $"{senderName}: {preview}"
                    },

                    // Android-specific overrides.
                    android = new
                    {
                        priority = "HIGH",
                        notification = new
                        {
                            channel_id = "jai-masih",   // must match channel created in initNativeApp.js
                            sound = "default",
                            icon = "ic_stat_jai_masih",
                            color = "#047857",
                            tag = chatId.ToString()
                        }
                    },

                    // Data payload — available to the app in pushNotificationActionPerformed.
                    data = new Dictionary<string, string>
                    {
                        ["kind"]      = "message",
                        ["chatId"]    = chatId.ToString(),
                        ["messageId"] = message.Id.ToString(),
                        ["senderId"]  = message.SenderId.ToString(),
                        ["senderName"] = senderName,
                        ["preview"]   = preview
                    }
                }
            };

            var client = _httpClientFactory.CreateClient();
            using var request = new HttpRequestMessage(HttpMethod.Post, url);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            request.Content = new StringContent(
                JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");

            try
            {
                using var response = await client.SendAsync(request);
                if (!response.IsSuccessStatusCode)
                {
                    var body = await response.Content.ReadAsStringAsync();
                    _logger.LogWarning("FCM V1 push failed for token …{Suffix}: {Status} {Body}",
                        deviceToken.Length > 8 ? deviceToken[^8..] : deviceToken,
                        response.StatusCode, body);
                }
                else
                {
                    _logger.LogInformation("FCM V1 push sent to token ...{Suffix}",
                        deviceToken.Length > 8 ? deviceToken[^8..] : deviceToken);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "FCM V1 HTTP request failed.");
            }
        }

        private async Task<List<string>> ReadTokensAsync(Guid chatId, IEnumerable<Guid> userIds)
        {
            var tenantId = await _db.Chats
                .AsNoTracking()
                .Where(c => c.Id == chatId)
                .Select(c => c.TenantId)
                .FirstOrDefaultAsync();

            return await ReadTokensForTenantAsync(tenantId, userIds);
        }

        private async Task<List<string>> ReadTokensForTenantAsync(Guid tenantId, IEnumerable<Guid> userIds)
        {
            if (tenantId == Guid.Empty)
                return new List<string>();

            var prefixes = userIds.Select(id => $"{DeviceTokenPrefix}{id}:").ToList();
            var rows = await _db.MinistryAutomationSettings
                .AsNoTracking()
                .Where(s => s.TenantId == tenantId && s.Key.StartsWith(DeviceTokenPrefix))
                .ToListAsync();

            return rows
                .Where(row => prefixes.Any(prefix => row.Key.StartsWith(prefix)))
                .Select(row => ReadString(row.Value, "token"))
                .Where(token => !string.IsNullOrWhiteSpace(token))
                .Distinct()
                .ToList();
        }

        public async Task<bool> SendTestPushAsync(Guid tenantId, Guid userId, string message)
        {
            var projectId = ResolveFirebaseProjectId();
            if (string.IsNullOrWhiteSpace(projectId))
            {
                _logger.LogWarning("Test push: Firebase project id is not configured.");
                return false;
            }

            var tokens = await ReadTokensForTenantAsync(tenantId, new[] { userId });
            if (tokens.Count == 0)
            {
                _logger.LogWarning("Test push: no registered device tokens for user {UserId} in tenant {TenantId}.", userId, tenantId);
                return false;
            }

            string accessToken;
            try
            {
                accessToken = await GetAccessTokenAsync();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Test push: could not obtain access token — push skipped.");
                return false;
            }

            var preview = string.IsNullOrWhiteSpace(message) ? "Test notification" : message.Trim();
            var testMessage = new MessageDto
            {
                Id = Guid.NewGuid(),
                ChatId = Guid.Empty,
                SenderId = Guid.Empty,
                Content = preview,
                ContentType = "text",
                CreatedAt = DateTime.UtcNow
            };

            _logger.LogInformation("Sending test push to {TokenCount} token(s) for user {UserId}.", tokens.Count, userId);

            var tasks = tokens.Select(token =>
                SendFcmV1Async(projectId, accessToken, token, "Mahima Ministry", preview, Guid.Empty, testMessage));
            await Task.WhenAll(tasks);
            return true;
        }

        private string? ResolveFirebaseProjectId()
        {
            return FirstNonEmpty(
                _configuration["MobilePush:FirebaseProjectId"],
                _configuration["Firebase:ProjectId"],
                Environment.GetEnvironmentVariable("MAHIMA_FIREBASE_PROJECT_ID"),
                Environment.GetEnvironmentVariable("FIREBASE_PROJECT_ID"));
        }

        private async Task<string> GetAccessTokenAsync()
        {
            await _credLock.WaitAsync();
            try
            {
                if (_cachedCredential == null)
                {
                    var source = FirstNonEmpty(
                        _configuration["MobilePush:ServiceAccountJson"],
                        _configuration["Firebase:ServiceAccountJson"],
                        Environment.GetEnvironmentVariable("MAHIMA_FIREBASE_SERVICE_ACCOUNT_JSON"),
                        Environment.GetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON"),
                        Environment.GetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS"));

                    if (string.IsNullOrWhiteSpace(source))
                        throw new InvalidOperationException("Firebase service account is not configured.");

                    var trimmed = source.Trim();
                    _cachedCredential = trimmed.StartsWith("{", StringComparison.Ordinal)
                        ? GoogleCredential.FromJson(trimmed)
                        : GoogleCredential.FromFile(trimmed);

                    _cachedCredential = _cachedCredential.CreateScoped(FcmScope);
                }
            }
            finally
            {
                _credLock.Release();
            }

            return await _cachedCredential.UnderlyingCredential.GetAccessTokenForRequestAsync();
        }

        private async Task SendIncomingCallFcmV1Async(
            string projectId,
            string accessToken,
            string deviceToken,
            string callerName,
            Guid chatId,
            Guid callerId,
            string callType)
        {
            var url = $"https://fcm.googleapis.com/v1/projects/{projectId}/messages:send";
            var payload = new
            {
                message = new
                {
                    token = deviceToken,
                    notification = new
                    {
                        title = callType == "video" ? "Incoming video call" : "Incoming audio call",
                        body = $"{callerName} is calling you"
                    },
                    android = new
                    {
                        priority = "HIGH",
                        notification = new
                        {
                            channel_id = "jai-masih-calls",   // must match channel created in initNativeApp.js
                            sound = "default",
                            icon = "ic_stat_jai_masih",
                            color = "#047857",
                            tag = chatId.ToString()
                        }
                    },
                    data = new Dictionary<string, string>
                    {
                        ["kind"] = "call",
                        ["chatId"] = chatId.ToString(),
                        ["callerId"] = callerId.ToString(),
                        ["callerName"] = callerName,
                        ["callType"] = callType
                    }
                }
            };

            var client = _httpClientFactory.CreateClient();
            using var request = new HttpRequestMessage(HttpMethod.Post, url);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
            request.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
            using var response = await client.SendAsync(request);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                _logger.LogWarning("FCM V1 incoming call push failed for token ...{Suffix}: {Status} {Body}",
                    deviceToken.Length > 8 ? deviceToken[^8..] : deviceToken,
                    response.StatusCode,
                    body);
            }
        }

        private static string? FirstNonEmpty(params string?[] values)
        {
            return values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v))?.Trim();
        }

        private static string BuildPreview(MessageDto message)
        {
            if (!string.IsNullOrWhiteSpace(message.Content))
                return message.Content.Length > 120
                    ? message.Content[..120]
                    : message.Content;

            if ((message.Attachments != null && message.Attachments.Any())
                || !string.IsNullOrWhiteSpace(message.AttachmentUrl))
                return "Attachment";

            return "New message";
        }

        private static string ReadString(string json, string property)
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                return doc.RootElement.TryGetProperty(property, out var prop) ? prop.ToString() : "";
            }
            catch { return ""; }
        }
    }
}
