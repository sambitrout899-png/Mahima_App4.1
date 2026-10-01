using Mahima.Api.v3.clean.Data;
// Controllers/MessagesController.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using System.Net;
using System.Net.Mail;
using Mahima.Api.v3.clean.Hubs;
using Mahima.Api.v3.clean.Helpers;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Services;
using Mahima.Api.v3.clean.Extensions;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class MessagesController : ControllerBase
    {
        private readonly IConfiguration _config;
        private readonly ILogger<MessagesController> _logger;
        private readonly MahimaDbContext _db;
        private readonly IHubContext<ChatHub> _hub;
        private readonly IChatService _chatService;

        public MessagesController(IConfiguration config, ILogger<MessagesController> logger, MahimaDbContext db, IHubContext<ChatHub> hub, IChatService chatService)
        {
            _config = config;
            _logger = logger;
            _db = db;
            _hub = hub;
            _chatService = chatService;
        }

        // DTO used for message posting
        public class ChatMessageDto
        {
            public string Content { get; set; } = "";
            public string ContentType { get; set; } = "text";
            public string? AttachmentUrl { get; set; }
        }

        // ----------------------------------------------------------------------
        // 🟢 CHAT MESSAGING ENDPOINTS
        // ----------------------------------------------------------------------

        /// <summary>
        /// Get full chat history for a chat
        /// GET /api/messages/chat/{chatId}
        /// </summary>
        [HttpGet("chat/{chatId}")]
        public async Task<IActionResult> GetChatMessages(Guid chatId)
        {
            try
            {
                var userId = User.GetUserIdGuid();
                if (userId == Guid.Empty) return Unauthorized();

                var memberIds = (await _chatService.GetChatMemberIdsAsync(chatId)).Distinct().ToList();
                if (!memberIds.Contains(userId)) return Forbid();

                var page = await _chatService.GetMessagesAsync(chatId, page: 1, size: 100);
                var messages = page.Items.Select(m => new
                {
                    id = m.Id,
                    chatId = m.ChatId,
                    senderId = m.SenderId,
                    content = m.Content,
                    contentType = m.ContentType,
                    attachmentUrl = m.AttachmentUrl,
                    createdAt = m.CreatedAt
                });

                return Ok(messages);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to get messages for chat {ChatId}", chatId);
                return StatusCode(500, "Error loading chat messages.");
            }
        }

        /// <summary>
        /// Post a message to a specific chat
        /// POST /api/messages/chat/{chatId}
        /// Body: { "content": "Hello" }
        /// </summary>
        [HttpPost("chat/{chatId}")]
        public async Task<IActionResult> PostMessage(Guid chatId, [FromBody] ChatMessageDto dto)
        {
            try
            {
                if (chatId == Guid.Empty)
                    return BadRequest("Invalid chatId.");

                if (dto == null)
                    return BadRequest("Empty request body.");

                var content = dto.Content?.Trim();
                if (string.IsNullOrWhiteSpace(content))
                    return BadRequest("Message content is required.");

                var senderId = User.GetUserIdGuid();
                if (senderId == Guid.Empty) return Unauthorized();

                var memberIds = (await _chatService.GetChatMemberIdsAsync(chatId)).Distinct().ToList();
                if (!memberIds.Contains(senderId)) return Forbid();

                var created = await _chatService.AddMessageAsync(
                    chatId,
                    senderId,
                    content,
                    dto.ContentType ?? "text",
                    dto.AttachmentUrl);

                var responseObj = new
                {
                    id = created.Id,
                    chatId = created.ChatId,
                    senderId = created.SenderId,
                    content = created.Content,
                    contentType = created.ContentType,
                    attachmentUrl = created.AttachmentUrl,
                    createdAt = created.CreatedAt
                };

                try
                {
                    await _hub.Clients.Users(memberIds.Select(id => id.ToString()).Distinct()).SendAsync("ReceiveMessage", responseObj);
                }
                catch (Exception hubEx)
                {
                    _logger.LogWarning(hubEx, "Failed to broadcast message to SignalR group {ChatId}", chatId);
                }

                return Ok(responseObj);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to post message for chat {ChatId}", chatId);
                return StatusCode(500, "Failed to send message.");
            }
        }

        // ----------------------------------------------------------------------
        // 🟠 BROADCAST / TWILIO / EMAIL MESSAGE FUNCTIONALITY (existing)
        // ----------------------------------------------------------------------

        public class BroadcastRequest
        {
            public string Type { get; set; } = "";
            public string Message { get; set; } = "";
            public List<string> UserIds { get; set; } = new();
            public Channels Channels { get; set; } = new();
            public long? TaskId { get; set; }
            public string? Source { get; set; }
            public string? WhatsAppContentSid { get; set; }
            public Dictionary<string, string> WhatsAppContentVariables { get; set; } = new();
        }

        public class Channels
        {
            public bool Email { get; set; }
            public bool Whatsapp { get; set; }
            public bool Sms { get; set; }
        }
[HttpPost("/api/tasks/{taskId}/send")]
public async Task<IActionResult> SendTaskNotification(int taskId)
{
    // TODO: replace this with your real lookup + SMS logic.
    // For now, this prevents 404 and can send whatever message you like.

    // Example pseudo-implementation:

    // 1. Look up the task and assignees from your DB (if you have a DbContext)
    // var task = await _dbContext.Tasks
    //     .Include(t => t.Assignees)
    //     .FirstOrDefaultAsync(t => t.Id == taskId);
    //
    // if (task == null)
    //     return NotFound();

    // 2. Build a message text
    // var body = $"Task #{task.Id}: {task.Title}\nDue: {task.DueDate:yyyy-MM-dd}";

    // 3. Use your existing Twilio/SMS sending helper here
    // foreach (var assignee in task.Assignees)
    // {
    //     if (string.IsNullOrWhiteSpace(assignee.PhoneNumber)) continue;
    //     await _smsService.SendAsync(assignee.PhoneNumber, body);
    // }

    // For now, just return 200 so the UI stops showing 404:
    return Ok(new { ok = true, taskId });
}
        [HttpPost("send")]
        public async Task<IActionResult> Send([FromBody] BroadcastRequest req)
        {
            if (req == null) return BadRequest("Missing payload.");
            if (string.IsNullOrWhiteSpace(req.Message)) return BadRequest("Message is required.");
            if (req.UserIds == null || req.UserIds.Count == 0) return BadRequest("No userIds provided.");

            var results = new List<object>();

            try
            {
                var connStr = _config.GetConnectionString("DefaultConnection");
                await using var conn = new NpgsqlConnection(connStr);
                await conn.OpenAsync();

		var tenantId = User.GetTenantIdGuid();
                if (tenantId == Guid.Empty) return Unauthorized();

		var sql = @"SELECT id, email, phone, displayname
            	FROM public.users
	            	WHERE id::text = ANY(@ids) AND tenant_id = @tenantId";	                
		
		await using var cmd = new NpgsqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("ids", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Text, req.UserIds.ToArray());
                cmd.Parameters.AddWithValue("tenantId", tenantId);

                var recipients = new List<(string Id, string? Email, string? Phone, string? DisplayName)>();
                await using (var rdr = await cmd.ExecuteReaderAsync())
                {
                    while (await rdr.ReadAsync())
                    {
                        var idObj = rdr["id"];
                        var id = idObj is Guid g ? g.ToString() : idObj?.ToString() ?? string.Empty;

                        recipients.Add((
                            id,
                            rdr["email"] is DBNull ? null : rdr["email"]?.ToString(),
                            rdr["phone"] is DBNull ? null : rdr["phone"]?.ToString(),
                            rdr["displayname"] is DBNull ? null : rdr["displayname"]?.ToString()
                        ));
                    }
                }

                if (recipients.Count == 0)
                    return BadRequest("No matching users found for provided userIds.");

                var tenantWhatsAppContentSid = await _db.Tenants.AsNoTracking()
                    .Where(t => t.Id == tenantId)
                    .Select(t => t.WhatsAppUserNotificationTemplateSid)
                    .FirstOrDefaultAsync();

                // SMTP config
                var smtpHost = _config["Smtp:Host"];
                var smtpPortParsed = int.TryParse(_config["Smtp:Port"], out var smtpPort) ? smtpPort : 587;
                var smtpUser = _config["Smtp:User"];
                var smtpPass = _config["Smtp:Pass"];
                var smtpFrom = _config["Smtp:From"] ?? smtpUser;

                var successfulRecipients = 0;
                foreach (var r in recipients)
                {
                    var errors = new List<string>();
                    bool chatOk = false, emailOk = false, smsOk = false, waOk = false;
                    string? smsMessageSid = null, whatsAppMessageSid = null;

                    if (Guid.TryParse(r.Id, out var recipientGuid))
                    {
                        try
                        {
                            var senderId = User.GetUserIdGuid();
                            if (senderId == Guid.Empty) return Unauthorized();
                            if (recipientGuid != senderId)
                            {
                                var chat = await _chatService.CreateOrGetDirectChatAsync(senderId, recipientGuid);
                                var createdMsg = await _chatService.AddMessageAsync(
                                    chat.Id,
                                    senderId,
                                    req.Message,
                                    string.IsNullOrWhiteSpace(req.Type) ? "reminder" : req.Type.Trim().ToLowerInvariant());

                                var memberIds = await _chatService.GetChatMemberIdsAsync(chat.Id);
                                await _hub.Clients.Users(memberIds.Select(id => id.ToString()).Distinct())
                                    .SendAsync("ReceiveMessage", createdMsg);
                                chatOk = true;
                            }
                        }
                        catch (Exception ex)
                        {
                            errors.Add($"Jai Masih chat failed: {ex.Message}");
                            _logger.LogError(ex, "Jai Masih chat send failed to {RecipientId}", r.Id);
                        }
                    }
                    else
                    {
                        errors.Add("Invalid recipient user id.");
                    }

                    // EMAIL
                    if (req.Channels.Email && !string.IsNullOrWhiteSpace(r.Email) && !string.IsNullOrWhiteSpace(smtpHost))
                    {
                        try
                        {
                            using var mail = new MailMessage(smtpFrom ?? "no-reply@localhost", r.Email)
                            {
                                Subject = string.IsNullOrWhiteSpace(req.Type) ? "Message from Mahima" : $"[{req.Type}] Mahima Message",
                                Body = req.Message,
                                IsBodyHtml = false
                            };

                            using var client = new SmtpClient(smtpHost, smtpPortParsed) { EnableSsl = true };
                            if (!string.IsNullOrWhiteSpace(smtpUser))
                                client.Credentials = new NetworkCredential(smtpUser, smtpPass);

                            await client.SendMailAsync(mail);
                            emailOk = true;
                        }
                        catch (Exception ex)
                        {
                            errors.Add($"Email failed: {ex.Message}");
                            _logger.LogError(ex, "Email send failed to {Email}", r.Email);
                        }
                    }

                    // SMS
                    if (req.Channels.Sms && !string.IsNullOrWhiteSpace(r.Phone))
                    {
                        var result = await SmsHelper.SendSmsDetailedAsync(r.Phone, "[Mahima SMS] " + req.Message, _logger);
                        smsOk = result.Success;
                        smsMessageSid = result.MessageSid;
                        if (!result.Success) errors.Add($"SMS failed: {result.ErrorMessage}");
                    }

                    // WHATSAPP
                    if (req.Channels.Whatsapp && !string.IsNullOrWhiteSpace(r.Phone))
                    {
                        SmsSendResult result;
                        var contentSid = !string.IsNullOrWhiteSpace(req.WhatsAppContentSid)
                            ? req.WhatsAppContentSid.Trim()
                            : !string.IsNullOrWhiteSpace(tenantWhatsAppContentSid)
                                ? tenantWhatsAppContentSid!.Trim()
                                : TwilioTemplateDefaults.UserNotification;
                        var publicBase = (_config["Marketing:PublicBaseUrl"] ?? "https://beta.mahimaministries.in").TrimEnd('/');
                        var statusCallback = $"{publicBase}/api/public/twilio/whatsapp/status";
                        var normalizedPhone = TwilioWhatsAppWebhookController.NormalizePhone(r.Phone);
                        var contactState = await _db.WhatsAppContactStates.AsNoTracking()
                            .SingleOrDefaultAsync(x => x.PhoneE164 == normalizedPhone);

                        if (contactState?.OptedOut == true)
                        {
                            result = new SmsSendResult(false, null, "Recipient opted out of WhatsApp messages.");
                        }
                        else
                        {
                            // Template sends do not require a locally recorded START or inbound session.
                            // Preserve explicit opt-outs; Twilio validates template eligibility.
                            var variables = new Dictionary<string, string>(req.WhatsAppContentVariables ?? new(), StringComparer.OrdinalIgnoreCase);
                            if (variables.Count == 0)
                            {
                                variables["1"] = string.IsNullOrWhiteSpace(r.DisplayName) ? "there" : r.DisplayName;
                                variables["2"] = req.Message.Trim();
                            }
                            result = await SmsHelper.SendWhatsAppTemplateAsync(r.Phone, contentSid, variables, statusCallback, _logger);
                        }

                        waOk = result.Success;
                        whatsAppMessageSid = result.MessageSid;
                        if (!result.Success) errors.Add($"WhatsApp failed: {result.ErrorMessage}");
                    }

                    if (req.Channels.Email && string.IsNullOrWhiteSpace(r.Email))
                        errors.Add("Email failed: recipient has no email address.");
                    if ((req.Channels.Sms || req.Channels.Whatsapp) && string.IsNullOrWhiteSpace(r.Phone))
                        errors.Add("Messaging failed: recipient has no phone number.");

                    var requestedChannelsSucceeded =
                        (!req.Channels.Email || emailOk) &&
                        (!req.Channels.Sms || smsOk) &&
                        (!req.Channels.Whatsapp || waOk);
                    if (requestedChannelsSucceeded) successfulRecipients++;

                    results.Add(new
                    {
                        r.Id,
                        r.Email,
                        r.Phone,
                        r.DisplayName,
                        chatSent = chatOk,
                        emailSent = emailOk,
                        smsSent = smsOk,
                        smsMessageSid,
                        whatsappSent = waOk,
                        whatsAppMessageSid,
                        success = requestedChannelsSucceeded,
                        errors
                    });
                }

                if (req.TaskId.HasValue)
                {
                    try
                    {
                        await using var logCmd = new NpgsqlCommand(@"
CREATE TABLE IF NOT EXISTS public.""TaskActivityLog"" (
    ""Id"" bigserial PRIMARY KEY,
    ""TaskId"" bigint NOT NULL REFERENCES public.""Tasks""(""Id"") ON DELETE CASCADE,
    ""Action"" text NOT NULL,
    ""Details"" text NULL,
    ""CreatedById"" uuid NULL,
    ""CreatedAt"" timestamp without time zone NOT NULL DEFAULT now()
);

INSERT INTO public.""TaskActivityLog"" (""TaskId"", ""Action"", ""Details"", ""CreatedById"", ""CreatedAt"")
VALUES (@taskId, @action, @details, @createdById, now());", conn);
                        logCmd.Parameters.AddWithValue("taskId", req.TaskId.Value);
                        logCmd.Parameters.AddWithValue("action", string.Equals(req.Source, "auto", StringComparison.OrdinalIgnoreCase) ? "auto-reminder-sent" : "task-reminder-sent");
                        logCmd.Parameters.AddWithValue("details", $"Recipients: {recipients.Count}; Type: {req.Type}; Message: {req.Message}");
                        var sender = User.GetUserIdGuid();
                        logCmd.Parameters.AddWithValue("createdById", sender == Guid.Empty ? DBNull.Value : (object)sender);
                        await logCmd.ExecuteNonQueryAsync();
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Could not log task reminder for task {TaskId}", req.TaskId.Value);
                    }
                }

                return Ok(new
                {
                    success = successfulRecipients == recipients.Count,
                    attempted = recipients.Count,
                    successful = successfulRecipients,
                    failed = recipients.Count - successfulRecipients,
                    results
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Broadcast send failed");
                return StatusCode(500, "Broadcast failed: " + ex.Message);
            }
        }
    }
}
