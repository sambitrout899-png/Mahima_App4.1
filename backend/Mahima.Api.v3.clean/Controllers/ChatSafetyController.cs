using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Route("api/admin/chat-safety")]
    [Authorize]
    public class ChatSafetyController : ControllerBase
    {
        private readonly MahimaDbContext _db;
        private readonly IServiceProvider _services;

        public ChatSafetyController(MahimaDbContext db, IServiceProvider services)
        {
            _db = db;
            _services = services;
        }

        [HttpGet("summary")]
        public async Task<IActionResult> Summary(CancellationToken ct)
        {
            await ChatSafetyMonitorService.EnsureTablesAsync(_db, ct);
            var since = DateTime.UtcNow.AddDays(-30);

            var open = await CountAsync("WHERE is_resolved = false", null, ct);
            var special = await CountAsync("WHERE is_resolved = false AND alert_level = @level", new Dictionary<string, object?> { ["level"] = "special_user" }, ct);
            var critical = await CountAsync("WHERE is_resolved = false AND severity = @severity", new Dictionary<string, object?> { ["severity"] = "critical" }, ct);
            var recent30 = await CountAsync("WHERE created_at_utc >= @since", new Dictionary<string, object?> { ["since"] = since }, ct);
            var byCategory = await LoadCategoryCountsAsync(ct);

            return Ok(new { open, special, critical, recent30, byCategory });
        }

        [HttpGet("alerts")]
        public async Task<IActionResult> Alerts([FromQuery] bool includeResolved = false, [FromQuery] int limit = 25, CancellationToken ct = default)
        {
            await ChatSafetyMonitorService.EnsureTablesAsync(_db, ct);
            await EnsureUserAccessBlocksAsync(ct);
            limit = Math.Clamp(limit, 1, 100);

            return Ok(await LoadAlertsAsync(includeResolved, limit, ct));
        }

        [HttpPost("alerts/{id:long}/resolve")]
        public async Task<IActionResult> Resolve(long id, CancellationToken ct)
        {
            await ChatSafetyMonitorService.EnsureTablesAsync(_db, ct);
            var rows = await _db.Database.ExecuteSqlInterpolatedAsync($@"
UPDATE public.chat_safety_alerts
SET is_resolved = true,
    resolved_at_utc = now()
WHERE id = {id};", ct);
            if (rows == 0) return NotFound();
            return Ok(new { success = true });
        }

        [HttpPost("scan-now")]
        public async Task<IActionResult> ScanNow(CancellationToken ct)
        {
            var monitor = _services.GetService<ChatSafetyMonitorService>();
            if (monitor == null)
            {
                return StatusCode(503, new
                {
                    success = false,
                    message = "Chat safety monitor service is not registered. Deploy the updated Program.cs registration or restart the API after deployment."
                });
            }

            var scanned = await monitor.RunFullScanAsync(ct: ct);
            var pastorFollowupsSent = await monitor.SendPendingPastorFollowupsAsync(ct);
            return Ok(new { success = true, scanned, pastorFollowupsSent });
        }

        [HttpPost("users/{userId:guid}/block")]
        public async Task<IActionResult> BlockUser(Guid userId, [FromBody] BlockChatSafetyUserDto? dto, CancellationToken ct)
        {
            await EnsureUserAccessBlocksAsync(ct);
            var reason = string.IsNullOrWhiteSpace(dto?.Reason)
                ? "Blocked from Chat Safety Intelligence alert."
                : dto!.Reason!.Trim();

            var rows = await _db.Database.ExecuteSqlInterpolatedAsync($@"
INSERT INTO public.user_access_blocks (user_id, reason, blocked_by, blocked_at_utc, is_active)
VALUES ({userId}, {reason}, NULL, now(), true)
ON CONFLICT (user_id) DO UPDATE
SET reason = EXCLUDED.reason,
    blocked_at_utc = now(),
    is_active = true;", ct);

            return Ok(new { success = rows >= 0, userId, blocked = true });
        }

        [HttpPost("users/{userId:guid}/unblock")]
        public async Task<IActionResult> UnblockUser(Guid userId, CancellationToken ct)
        {
            await EnsureUserAccessBlocksAsync(ct);
            await _db.Database.ExecuteSqlInterpolatedAsync($@"
UPDATE public.user_access_blocks
SET is_active = false
WHERE user_id = {userId};", ct);

            return Ok(new { success = true, userId, blocked = false });
        }

        private async Task<int> CountAsync(string whereClause, Dictionary<string, object?>? parameters, CancellationToken ct)
        {
            var conn = _db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT COUNT(*) FROM public.chat_safety_alerts {whereClause};";
            AddParameters(cmd, parameters);
            var value = await cmd.ExecuteScalarAsync(ct);
            return Convert.ToInt32(value);
        }

        private async Task<List<object>> LoadCategoryCountsAsync(CancellationToken ct)
        {
            var rows = new List<object>();
            var conn = _db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
SELECT category, COUNT(*)::int AS count
FROM public.chat_safety_alerts
WHERE is_resolved = false
GROUP BY category
ORDER BY count DESC;";

            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
                rows.Add(new { category = rdr["category"]?.ToString(), count = Convert.ToInt32(rdr["count"]) });

            return rows;
        }

        private async Task<List<object>> LoadAlertsAsync(bool includeResolved, int limit, CancellationToken ct)
        {
            await _db.Database.ExecuteSqlRawAsync(@"
ALTER TABLE public.chat_safety_alerts
    ADD COLUMN IF NOT EXISTS conversation_snippet text NULL,
    ADD COLUMN IF NOT EXISTS security_escalation boolean NOT NULL DEFAULT false;", ct);

            var rows = new List<object>();
            var conn = _db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);

            await using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
SELECT
    a.id,
    a.message_id,
    a.chat_id,
    a.sender_id,
    COALESCE(u.displayname, u.username, 'Unknown user') AS sender_name,
    u.username AS sender_username,
    a.category,
    a.severity,
    a.alert_level,
    a.security_escalation,
    a.confidence,
    a.summary,
    a.evidence_snippet,
    a.conversation_snippet,
    a.pastor_followup_sent,
    a.is_resolved,
    a.created_at_utc,
    a.resolved_at_utc,
    COALESCE(b.is_active, false) AS is_blocked,
    b.reason AS block_reason,
    b.blocked_at_utc
FROM public.chat_safety_alerts a
LEFT JOIN public.users u ON u.id = a.sender_id
LEFT JOIN public.user_access_blocks b ON b.user_id = a.sender_id AND b.is_active = true
WHERE (@includeResolved = true OR a.is_resolved = false)
ORDER BY
    (a.alert_level = 'special_user') DESC,
    (a.severity = 'critical') DESC,
    a.created_at_utc DESC
LIMIT @limit;";
            AddParameters(cmd, new Dictionary<string, object?>
            {
                ["includeResolved"] = includeResolved,
                ["limit"] = limit
            });

            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                rows.Add(new
                {
                    id = rdr["id"],
                    messageId = rdr["message_id"],
                    chatId = rdr["chat_id"],
                    senderId = rdr["sender_id"],
                    senderName = rdr["sender_name"]?.ToString(),
                    senderUsername = rdr["sender_username"]?.ToString(),
                    category = rdr["category"]?.ToString(),
                    severity = rdr["severity"]?.ToString(),
                    alertLevel = rdr["alert_level"]?.ToString(),
                    securityEscalation = rdr["security_escalation"],
                    confidence = rdr["confidence"],
                    summary = rdr["summary"]?.ToString(),
                    evidenceSnippet = rdr["evidence_snippet"]?.ToString(),
                    conversationSnippet = rdr["conversation_snippet"]?.ToString(),
                    pastorFollowupSent = rdr["pastor_followup_sent"],
                    isResolved = rdr["is_resolved"],
                    createdAtUtc = rdr["created_at_utc"],
                    resolvedAtUtc = rdr["resolved_at_utc"] == DBNull.Value ? null : rdr["resolved_at_utc"],
                    isBlocked = rdr["is_blocked"],
                    blockReason = rdr["block_reason"] == DBNull.Value ? null : rdr["block_reason"]?.ToString(),
                    blockedAtUtc = rdr["blocked_at_utc"] == DBNull.Value ? null : rdr["blocked_at_utc"]
                });
            }

            return rows;
        }

        private Task EnsureUserAccessBlocksAsync(CancellationToken ct) =>
            _db.Database.ExecuteSqlRawAsync(@"
CREATE TABLE IF NOT EXISTS public.user_access_blocks (
    user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    reason text NULL,
    blocked_by uuid NULL,
    blocked_at_utc timestamp with time zone NOT NULL DEFAULT now(),
    is_active boolean NOT NULL DEFAULT true
);", ct);

        private static void AddParameters(System.Data.Common.DbCommand cmd, Dictionary<string, object?>? parameters)
        {
            if (parameters == null) return;
            foreach (var (name, value) in parameters)
            {
                var p = cmd.CreateParameter();
                p.ParameterName = name;
                p.Value = value ?? DBNull.Value;
                cmd.Parameters.Add(p);
            }
        }

        public class BlockChatSafetyUserDto
        {
            public string? Reason { get; set; }
        }
    }
}
