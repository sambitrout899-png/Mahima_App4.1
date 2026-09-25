using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Npgsql;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/admin/daily-routines")]
    public class DailyRoutinesController : ControllerBase
    {
        private static readonly string[] UnsafeChatTerms =
        {
            "porn", "xxx", "nude", "abuse", "hate", "kill", "threat", "blackmail", "fraud", "scam"
        };

        private static readonly string[] SuspiciousFileTerms =
        {
            "porn", "xxx", "nude", "adult", "explicit", "malware", "virus", "payload", "shell", "backdoor"
        };

        private static readonly string[] AttackPathTerms =
        {
            "../", "..%2f", "wp-admin", ".env", "phpmyadmin", "select%20", "union%20", "<script", "%3cscript", "cmd=", "passwd"
        };

        private readonly MahimaDbContext _db;
        private readonly IConfiguration _configuration;
        private readonly ILogger<DailyRoutinesController> _logger;
        private readonly ITenantContextService _tenantContext;

        public DailyRoutinesController(
            MahimaDbContext db,
            IConfiguration configuration,
            ILogger<DailyRoutinesController> logger,
            ITenantContextService tenantContext)
        {
            _db = db;
            _configuration = configuration;
            _logger = logger;
            _tenantContext = tenantContext;
        }

        public class PageVisitDto
        {
            public string? Path { get; set; }
            public string? Title { get; set; }
            public string? Referrer { get; set; }
        }

        public class BlockUserDto
        {
            public string? Reason { get; set; }
        }

        private string ConnectionString =>
            _configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("Missing DefaultConnection.");

        private Guid CurrentUserId()
        {
            var raw =
                User.FindFirstValue(ClaimTypes.NameIdentifier) ??
                User.FindFirstValue("sub") ??
                User.FindFirstValue("nameid");
            return Guid.TryParse(raw, out var id) ? id : Guid.Empty;
        }

        private bool CurrentUserIsAdmin()
        {
            if (User.IsInRole("admin") || User.IsInRole("Admin") || User.IsInRole("ADMIN") || User.IsInRole("administrator") || User.IsInRole("Administrator")) return true;
            return User.Claims.Any(c =>
            {
                if (c.Type != ClaimTypes.Role && !c.Type.Equals("role", StringComparison.OrdinalIgnoreCase)) return false;
                var value = (c.Value ?? string.Empty).Trim();
                return value.Equals("admin", StringComparison.OrdinalIgnoreCase) ||
                       value.Equals("administrator", StringComparison.OrdinalIgnoreCase) ||
                       value.Equals("1", StringComparison.OrdinalIgnoreCase);
            });
        }

        private async Task<Guid> GetCurrentTenantIdAsync()
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
            return tenant?.Id ?? Guid.Parse("00000000-0000-0000-0000-000000000001");
        }

        private static async Task EnsureRoutineTablesAsync(NpgsqlConnection conn)
        {
            await using var cmd = new NpgsqlCommand(@"
CREATE TABLE IF NOT EXISTS public.daily_page_visits (
    id bigserial PRIMARY KEY,
    tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    user_id uuid NULL,
    path text NOT NULL,
    title text NULL,
    referrer text NULL,
    user_agent text NULL,
    ip_address text NULL,
    created_at_utc timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_daily_page_visits_created_at
    ON public.daily_page_visits(created_at_utc);

CREATE INDEX IF NOT EXISTS ix_daily_page_visits_tenant_created_at
    ON public.daily_page_visits(tenant_id, created_at_utc);

CREATE INDEX IF NOT EXISTS ix_daily_page_visits_user_created_at
    ON public.daily_page_visits(user_id, created_at_utc);

CREATE TABLE IF NOT EXISTS public.security_events (
    id bigserial PRIMARY KEY,
    tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    event_type text NOT NULL,
    severity text NOT NULL DEFAULT 'medium',
    username text NULL,
    user_id uuid NULL,
    path text NULL,
    ip_address text NULL,
    user_agent text NULL,
    details text NULL,
    created_at_utc timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_security_events_created_at
    ON public.security_events(created_at_utc);

CREATE INDEX IF NOT EXISTS ix_security_events_tenant_created_at
    ON public.security_events(tenant_id, created_at_utc);

CREATE TABLE IF NOT EXISTS public.user_access_blocks (
    user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001',
    reason text NULL,
    blocked_by uuid NULL,
    blocked_at_utc timestamp with time zone NOT NULL DEFAULT now(),
    is_active boolean NOT NULL DEFAULT true
);

ALTER TABLE public.daily_page_visits
    ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

ALTER TABLE public.security_events
    ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

ALTER TABLE public.user_access_blocks
    ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS ix_user_access_blocks_tenant_active
    ON public.user_access_blocks(tenant_id, is_active);", conn);
            await cmd.ExecuteNonQueryAsync();
        }

        private static bool ContainsAny(string? value, IEnumerable<string> terms)
        {
            if (string.IsNullOrWhiteSpace(value)) return false;
            var text = value.ToLowerInvariant();
            return terms.Any(term => text.Contains(term, StringComparison.OrdinalIgnoreCase));
        }

        private static string NormalizeRole(string? role, IReadOnlyDictionary<string, string> roleLookup)
        {
            var value = (role ?? "").Trim();
            if (int.TryParse(value, out var roleId) &&
                roleLookup.TryGetValue(roleId.ToString(), out var mapped) &&
                !string.IsNullOrWhiteSpace(mapped))
            {
                value = mapped;
            }

            return string.IsNullOrWhiteSpace(value) ? "Member" : value;
        }

        private static object UserLite(Guid id, string? name, string? username, string? role, string? detail = null) => new
        {
            userId = id,
            name = string.IsNullOrWhiteSpace(name) ? username : name,
            username,
            role,
            detail
        };

        [HttpPost("page-visit")]
        public async Task<IActionResult> TrackPageVisit([FromBody] PageVisitDto dto)
        {
            var path = (dto?.Path ?? "").Trim();
            if (string.IsNullOrWhiteSpace(path)) return Ok(new { tracked = false });
            if (path.Length > 1000) path = path[..1000];

            await using var conn = new NpgsqlConnection(ConnectionString);
            await conn.OpenAsync(HttpContext.RequestAborted);
            await EnsureRoutineTablesAsync(conn);

            var tenantId = await GetCurrentTenantIdAsync();
            var userId = CurrentUserId();
            var userAgent = Request.Headers.UserAgent.ToString();
            var ip = HttpContext.Connection.RemoteIpAddress?.ToString();

            await using (var cmd = new NpgsqlCommand(@"
INSERT INTO public.daily_page_visits
    (tenant_id, user_id, path, title, referrer, user_agent, ip_address)
VALUES
    (@tenant_id, @user_id, @path, @title, @referrer, @user_agent, @ip_address);", conn))
            {
                cmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                cmd.Parameters.AddWithValue("user_id", NpgsqlTypes.NpgsqlDbType.Uuid, userId == Guid.Empty ? DBNull.Value : (object)userId);
                cmd.Parameters.AddWithValue("path", NpgsqlTypes.NpgsqlDbType.Text, path);
                cmd.Parameters.AddWithValue("title", NpgsqlTypes.NpgsqlDbType.Text, (object?)dto?.Title ?? DBNull.Value);
                cmd.Parameters.AddWithValue("referrer", NpgsqlTypes.NpgsqlDbType.Text, (object?)dto?.Referrer ?? DBNull.Value);
                cmd.Parameters.AddWithValue("user_agent", NpgsqlTypes.NpgsqlDbType.Text, (object?)userAgent ?? DBNull.Value);
                cmd.Parameters.AddWithValue("ip_address", NpgsqlTypes.NpgsqlDbType.Text, (object?)ip ?? DBNull.Value);
                await cmd.ExecuteNonQueryAsync(HttpContext.RequestAborted);
            }

            if (ContainsAny(path, AttackPathTerms))
            {
                await using var eventCmd = new NpgsqlCommand(@"
INSERT INTO public.security_events
    (tenant_id, event_type, severity, user_id, path, ip_address, user_agent, details)
VALUES
    (@tenant_id, 'SuspiciousPath', 'high', @user_id, @path, @ip_address, @user_agent, 'Suspicious path pattern detected from app telemetry.');", conn);
                eventCmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                eventCmd.Parameters.AddWithValue("user_id", NpgsqlTypes.NpgsqlDbType.Uuid, userId == Guid.Empty ? DBNull.Value : (object)userId);
                eventCmd.Parameters.AddWithValue("path", NpgsqlTypes.NpgsqlDbType.Text, path);
                eventCmd.Parameters.AddWithValue("ip_address", NpgsqlTypes.NpgsqlDbType.Text, (object?)ip ?? DBNull.Value);
                eventCmd.Parameters.AddWithValue("user_agent", NpgsqlTypes.NpgsqlDbType.Text, (object?)userAgent ?? DBNull.Value);
                await eventCmd.ExecuteNonQueryAsync(HttpContext.RequestAborted);
            }

            return Ok(new { tracked = true });
        }

        [HttpGet]
        public async Task<IActionResult> GetDailyRoutineReport([FromQuery] DateTime? date = null)
        {
            if (!CurrentUserIsAdmin())
                return Forbid();

            var day = DateTime.SpecifyKind((date ?? DateTime.UtcNow).Date, DateTimeKind.Unspecified);
            var nextDay = day.AddDays(1);
            var dayUtc = DateTime.SpecifyKind(day, DateTimeKind.Utc);
            var nextDayUtc = dayUtc.AddDays(1);
            var now = DateTime.UtcNow;
            var tenantId = await GetCurrentTenantIdAsync();

            await using var conn = new NpgsqlConnection(ConnectionString);
            await conn.OpenAsync(HttpContext.RequestAborted);
            await EnsureRoutineTablesAsync(conn);

            var roleLookup = await _db.Roles
                .AsNoTracking()
                .Select(r => new { r.Id, r.Name })
                .ToDictionaryAsync(r => r.Id.ToString(), r => r.Name ?? "", HttpContext.RequestAborted);

            var users = await _db.Users
                .AsNoTracking()
                .Where(u => u.TenantId == tenantId)
                .Select(u => new
                {
                    u.Id,
                    u.UserCode,
                    u.Username,
                    u.DisplayName,
                    u.Email,
                    u.Role,
                    u.PayrollEnabled,
                    u.JoinDate,
                    u.LastLogin
                })
                .ToListAsync(HttpContext.RequestAborted);

            var normalizedUsers = users.Select(u => new
            {
                u.Id,
                u.UserCode,
                u.Username,
                u.DisplayName,
                u.Email,
                Role = NormalizeRole(u.Role, roleLookup),
                u.PayrollEnabled,
                u.JoinDate,
                u.LastLogin
            }).ToList();

            var attendancePopulation = normalizedUsers
                .Where(u =>
                    u.PayrollEnabled ||
                    u.Role.Equals("Staff", StringComparison.OrdinalIgnoreCase) ||
                    u.Role.Equals("Pastor", StringComparison.OrdinalIgnoreCase) ||
                    u.Role.Equals("Volunteer", StringComparison.OrdinalIgnoreCase))
                .ToList();

            if (attendancePopulation.Count == 0)
                attendancePopulation = normalizedUsers;

            var attendanceRows = await _db.AttendanceRecords
                .AsNoTracking()
                .Where(a => a.TenantId == tenantId && a.Date >= day && a.Date < nextDay)
                .ToListAsync(HttpContext.RequestAborted);

            var attendanceKeys = new HashSet<string>(
                attendanceRows
                    .Select(a => a.UserId)
                    .Where(v => !string.IsNullOrWhiteSpace(v))
                    .Select(v => v.Trim()),
                StringComparer.OrdinalIgnoreCase);

            var presentUsers = attendancePopulation
                .Where(u => attendanceKeys.Contains(u.Id.ToString()) ||
                            (!string.IsNullOrWhiteSpace(u.Username) && attendanceKeys.Contains(u.Username)) ||
                            (!string.IsNullOrWhiteSpace(u.UserCode) && attendanceKeys.Contains(u.UserCode)))
                .Select(u => UserLite(u.Id, u.DisplayName, u.Username, u.Role, u.Email))
                .ToList();

            var missingUsers = attendancePopulation
                .Where(u => !attendanceKeys.Contains(u.Id.ToString()) &&
                            (string.IsNullOrWhiteSpace(u.Username) || !attendanceKeys.Contains(u.Username)) &&
                            (string.IsNullOrWhiteSpace(u.UserCode) || !attendanceKeys.Contains(u.UserCode)))
                .Select(u => UserLite(u.Id, u.DisplayName, u.Username, u.Role, u.Email))
                .ToList();

            var loggedInToday = normalizedUsers
                .Where(u => u.LastLogin.HasValue && u.LastLogin.Value >= day && u.LastLogin.Value < nextDay)
                .Select(u => UserLite(u.Id, u.DisplayName, u.Username, u.Role, u.LastLogin?.ToString("u")))
                .ToList();

            var newUsers = normalizedUsers
                .Where(u => u.JoinDate >= day && u.JoinDate < nextDay)
                .OrderByDescending(u => u.JoinDate)
                .Select(u => UserLite(u.Id, u.DisplayName, u.Username, u.Role, u.JoinDate.ToString("u")))
                .ToList();

            var newTasks = await _db.Tasks
                .AsNoTracking()
                .Where(t => t.TenantId == tenantId && t.CreatedAt >= dayUtc && t.CreatedAt < nextDayUtc)
                .OrderByDescending(t => t.CreatedAt)
                .Select(t => new
                {
                    t.Id,
                    t.Title,
                    t.Description,
                    status = t.Status.ToString(),
                    t.Priority,
                    t.CreatedAt,
                    t.AssigneeId,
                    t.TeamId
                })
                .Take(50)
                .ToListAsync(HttpContext.RequestAborted);

            var newTeamMembers = await _db.TeamMembers
                .AsNoTracking()
                .Include(tm => tm.Team)
                .Include(tm => tm.User)
                .Where(tm => tm.Team.TenantId == tenantId && tm.JoinedAt >= dayUtc && tm.JoinedAt < nextDayUtc)
                .OrderByDescending(tm => tm.JoinedAt)
                .Select(tm => new
                {
                    teamId = tm.TeamId,
                    teamName = tm.Team.Name,
                    userId = tm.UserId,
                    userName = tm.User.DisplayName ?? tm.User.Username,
                    tm.RoleInTeam,
                    tm.JoinedAt
                })
                .Take(50)
                .ToListAsync(HttpContext.RequestAborted);

            var auditRows = await _db.AuditLogs
                .AsNoTracking()
                .Where(a => a.TenantId == tenantId && a.CreatedAt >= dayUtc && a.CreatedAt < nextDayUtc)
                .OrderByDescending(a => a.CreatedAt)
                .Take(1000)
                .ToListAsync(HttpContext.RequestAborted);

            var messages = await _db.Messages
                .AsNoTracking()
                .Include(m => m.Sender)
                .Include(m => m.Chat)
                .Where(m => m.Chat != null && m.Chat.TenantId == tenantId && m.CreatedAt >= dayUtc && m.CreatedAt < nextDayUtc)
                .OrderByDescending(m => m.CreatedAt)
                .Take(1000)
                .ToListAsync(HttpContext.RequestAborted);

            var flaggedMessages = messages
                .Where(m => ContainsAny(m.Content, UnsafeChatTerms))
                .Select(m => new
                {
                    messageId = m.Id,
                    chatId = m.ChatId,
                    userId = m.SenderId,
                    userName = m.Sender?.DisplayName ?? m.Sender?.Username,
                    reason = "Potential abusive or unsafe language",
                    preview = (m.Content ?? "").Length > 180 ? (m.Content ?? "")[..180] + "..." : m.Content,
                    m.CreatedAt
                })
                .Take(50)
                .ToList();

            var attachments = await _db.Attachments
                .AsNoTracking()
                .Where(a => a.TenantId == tenantId && a.UploadedAt >= dayUtc && a.UploadedAt < nextDayUtc)
                .OrderByDescending(a => a.UploadedAt)
                .Take(1000)
                .ToListAsync(HttpContext.RequestAborted);

            var flaggedUploads = attachments
                .Where(a => ContainsAny($"{a.Filename} {a.S3Key} {a.ContentType}", SuspiciousFileTerms))
                .Select(a => new
                {
                    attachmentId = a.Id,
                    userId = a.UploadedBy,
                    fileName = a.Filename,
                    a.ContentType,
                    a.SizeBytes,
                    reason = "Suspicious upload name or content type",
                    a.UploadedAt
                })
                .Take(50)
                .ToList();

            var dataManipulationFlags = auditRows
                .Where(a => ContainsAny($"{a.Action} {a.EntityType}", new[] { "update", "delete", "remove", "edit", "create" }))
                .GroupBy(a => a.ActorId)
                .Select(g => new
                {
                    userId = g.Key,
                    userName = g.Key.HasValue
                        ? normalizedUsers.FirstOrDefault(u => u.Id == g.Key.Value)?.DisplayName ?? normalizedUsers.FirstOrDefault(u => u.Id == g.Key.Value)?.Username
                        : "Unknown",
                    totalChanges = g.Count(),
                    deletes = g.Count(x => ContainsAny(x.Action, new[] { "delete", "remove" })),
                    creates = g.Count(x => ContainsAny(x.Action, new[] { "create", "add" })),
                    updates = g.Count(x => ContainsAny(x.Action, new[] { "update", "edit" })),
                    severity = g.Count() >= 50 || g.Count(x => ContainsAny(x.Action, new[] { "delete", "remove" })) >= 10 ? "high" : "watch"
                })
                .Where(x => x.totalChanges >= 25 || x.deletes >= 5)
                .OrderByDescending(x => x.totalChanges)
                .Take(20)
                .ToList();

            var pageVisits = await ReadPageVisitsAsync(conn, tenantId, dayUtc, nextDayUtc);
            var securityEvents = await ReadSecurityEventsAsync(conn, tenantId, dayUtc, nextDayUtc);
            var blockedUsers = await ReadBlockedUsersAsync(conn, tenantId);

            var topPages = pageVisits
                .GroupBy(v => v.Path)
                .Select(g => new { path = g.Key, views = g.Count(), users = g.Select(x => x.UserId).Where(x => x.HasValue).Distinct().Count() })
                .OrderByDescending(x => x.views)
                .Take(12)
                .ToList();

            var visitsByHour = pageVisits
                .GroupBy(v => v.CreatedAtUtc.Hour)
                .OrderBy(g => g.Key)
                .Select(g => new { hour = $"{g.Key:00}:00", visits = g.Count(), users = g.Select(x => x.UserId).Where(x => x.HasValue).Distinct().Count() })
                .ToList();

            var suspiciousVisits = pageVisits
                .Where(v => ContainsAny(v.Path, AttackPathTerms))
                .Select(v => new { v.Id, v.UserId, v.Path, v.IpAddress, v.CreatedAtUtc, reason = "Suspicious URL pattern" })
                .Take(50)
                .ToList();

            var cyberSignals = securityEvents
                .Concat(suspiciousVisits.Select(v => new SecurityEventRow(v.Id, "SuspiciousPath", "high", null, v.UserId, v.Path, v.IpAddress, null, v.reason, v.CreatedAtUtc)))
                .OrderByDescending(x => x.CreatedAtUtc)
                .Take(50)
                .Select(x => new
                {
                    x.Id,
                    eventType = x.EventType,
                    x.Severity,
                    x.Username,
                    x.UserId,
                    x.Path,
                    x.IpAddress,
                    x.Details,
                    x.CreatedAtUtc
                })
                .ToList();

            var weeklyNewUsers = normalizedUsers
                .Where(u => u.JoinDate >= day.AddDays(-6) && u.JoinDate < nextDay)
                .GroupBy(u => u.JoinDate.Date)
                .OrderBy(g => g.Key)
                .Select(g => new { date = g.Key.ToString("yyyy-MM-dd"), count = g.Count() })
                .ToList();

            var report = new
            {
                date = day.ToString("yyyy-MM-dd"),
                generatedAtUtc = now,
                attendance = new
                {
                    population = attendancePopulation.Count,
                    present = presentUsers.Count,
                    missing = missingUsers.Count,
                    presentUsers,
                    missingUsers
                },
                siteUsage = new
                {
                    loggedInUsers = loggedInToday.Count,
                    uniqueVisitors = pageVisits.Select(v => v.UserId).Where(v => v.HasValue).Distinct().Count(),
                    pageViews = pageVisits.Count,
                    topPages,
                    visitsByHour,
                    loggedInToday
                },
                security = new
                {
                    cyberSignals = cyberSignals.Count,
                    events = cyberSignals,
                    note = cyberSignals.Count == 0
                        ? "No security events were captured by application telemetry for this date."
                        : "Review high-severity events before blocking or disabling users."
                },
                newActivity = new
                {
                    newUsers,
                    newTasks,
                    newTeamMembers,
                    newTeamTrackingNote = "Team creation time is not stored on the current Team model. New team activity is reported through audit logs and new member joins.",
                    weeklyNewUsers
                },
                malpractice = new
                {
                    flaggedMessages,
                    flaggedUploads,
                    dataManipulationFlags,
                    totalFlags = flaggedMessages.Count + flaggedUploads.Count + dataManipulationFlags.Count,
                    moderationNote = "Private chat text is not exposed in this report. Upload moderation uses filename/content-type heuristics. Add an image moderation service for full visual pornography detection."
                },
                blockedUsers
            };

            return Ok(report);
        }

        [HttpPost("users/{userId:guid}/block")]
        public async Task<IActionResult> BlockUser(Guid userId, [FromBody] BlockUserDto dto)
        {
            if (!CurrentUserIsAdmin()) return Forbid();
            var adminId = CurrentUserId();
            var tenantId = await GetCurrentTenantIdAsync();

            await using var conn = new NpgsqlConnection(ConnectionString);
            await conn.OpenAsync(HttpContext.RequestAborted);
            await EnsureRoutineTablesAsync(conn);

            await using var cmd = new NpgsqlCommand(@"
INSERT INTO public.user_access_blocks (user_id, tenant_id, reason, blocked_by, blocked_at_utc, is_active)
VALUES (@user_id, @tenant_id, @reason, @blocked_by, now(), true)
ON CONFLICT (user_id)
DO UPDATE SET tenant_id = EXCLUDED.tenant_id,
              reason = EXCLUDED.reason,
              blocked_by = EXCLUDED.blocked_by,
              blocked_at_utc = now(),
              is_active = true;", conn);
            cmd.Parameters.AddWithValue("user_id", NpgsqlTypes.NpgsqlDbType.Uuid, userId);
            cmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
            cmd.Parameters.AddWithValue("reason", NpgsqlTypes.NpgsqlDbType.Text, (object?)dto?.Reason ?? "Blocked from Daily Routines dashboard");
            cmd.Parameters.AddWithValue("blocked_by", NpgsqlTypes.NpgsqlDbType.Uuid, adminId == Guid.Empty ? DBNull.Value : (object)adminId);
            await cmd.ExecuteNonQueryAsync(HttpContext.RequestAborted);

            _db.AuditLogs.Add(new Mahima.Api.v3.clean.Models.AuditLog
            {
                TenantId = tenantId,
                ActorId = adminId == Guid.Empty ? null : adminId,
                Action = "BlockUser",
                EntityType = "User",
                EntityId = userId.ToString(),
                Details = dto?.Reason,
                CreatedAt = DateTime.UtcNow
            });
            await _db.SaveChangesAsync(HttpContext.RequestAborted);

            return Ok(new { blocked = true, userId });
        }

        [HttpPost("users/{userId:guid}/unblock")]
        public async Task<IActionResult> UnblockUser(Guid userId)
        {
            if (!CurrentUserIsAdmin()) return Forbid();
            var adminId = CurrentUserId();
            var tenantId = await GetCurrentTenantIdAsync();

            await using var conn = new NpgsqlConnection(ConnectionString);
            await conn.OpenAsync(HttpContext.RequestAborted);
            await EnsureRoutineTablesAsync(conn);

            await using var cmd = new NpgsqlCommand(@"
UPDATE public.user_access_blocks
SET is_active = false
WHERE tenant_id = @tenant_id AND user_id = @user_id;", conn);
            cmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
            cmd.Parameters.AddWithValue("user_id", NpgsqlTypes.NpgsqlDbType.Uuid, userId);
            var rows = await cmd.ExecuteNonQueryAsync(HttpContext.RequestAborted);

            _db.AuditLogs.Add(new Mahima.Api.v3.clean.Models.AuditLog
            {
                TenantId = tenantId,
                ActorId = adminId == Guid.Empty ? null : adminId,
                Action = "UnblockUser",
                EntityType = "User",
                EntityId = userId.ToString(),
                CreatedAt = DateTime.UtcNow
            });
            await _db.SaveChangesAsync(HttpContext.RequestAborted);

            return Ok(new { unblocked = rows > 0, userId });
        }

        private async Task<List<PageVisitRow>> ReadPageVisitsAsync(NpgsqlConnection conn, Guid tenantId, DateTime day, DateTime nextDay)
        {
            var rows = new List<PageVisitRow>();
            await using var cmd = new NpgsqlCommand(@"
SELECT id, user_id, path, title, ip_address, created_at_utc
FROM public.daily_page_visits
WHERE tenant_id = @tenant_id
  AND created_at_utc >= @day AND created_at_utc < @next_day
ORDER BY created_at_utc DESC
LIMIT 5000;", conn);
            cmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
            cmd.Parameters.AddWithValue("day", NpgsqlTypes.NpgsqlDbType.TimestampTz, DateTime.SpecifyKind(day, DateTimeKind.Utc));
            cmd.Parameters.AddWithValue("next_day", NpgsqlTypes.NpgsqlDbType.TimestampTz, DateTime.SpecifyKind(nextDay, DateTimeKind.Utc));

            await using var rdr = await cmd.ExecuteReaderAsync(HttpContext.RequestAborted);
            while (await rdr.ReadAsync(HttpContext.RequestAborted))
            {
                rows.Add(new PageVisitRow(
                    rdr.GetInt64(0),
                    rdr.IsDBNull(1) ? null : rdr.GetGuid(1),
                    rdr.GetString(2),
                    rdr.IsDBNull(3) ? null : rdr.GetString(3),
                    rdr.IsDBNull(4) ? null : rdr.GetString(4),
                    rdr.GetDateTime(5)));
            }
            return rows;
        }

        private async Task<List<SecurityEventRow>> ReadSecurityEventsAsync(NpgsqlConnection conn, Guid tenantId, DateTime day, DateTime nextDay)
        {
            var rows = new List<SecurityEventRow>();
            await using var cmd = new NpgsqlCommand(@"
SELECT id, event_type, severity, username, user_id, path, ip_address, user_agent, details, created_at_utc
FROM public.security_events
WHERE tenant_id = @tenant_id
  AND created_at_utc >= @day AND created_at_utc < @next_day
ORDER BY created_at_utc DESC
LIMIT 500;", conn);
            cmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
            cmd.Parameters.AddWithValue("day", NpgsqlTypes.NpgsqlDbType.TimestampTz, DateTime.SpecifyKind(day, DateTimeKind.Utc));
            cmd.Parameters.AddWithValue("next_day", NpgsqlTypes.NpgsqlDbType.TimestampTz, DateTime.SpecifyKind(nextDay, DateTimeKind.Utc));

            await using var rdr = await cmd.ExecuteReaderAsync(HttpContext.RequestAborted);
            while (await rdr.ReadAsync(HttpContext.RequestAborted))
            {
                rows.Add(new SecurityEventRow(
                    rdr.GetInt64(0),
                    rdr.GetString(1),
                    rdr.GetString(2),
                    rdr.IsDBNull(3) ? null : rdr.GetString(3),
                    rdr.IsDBNull(4) ? null : rdr.GetGuid(4),
                    rdr.IsDBNull(5) ? null : rdr.GetString(5),
                    rdr.IsDBNull(6) ? null : rdr.GetString(6),
                    rdr.IsDBNull(7) ? null : rdr.GetString(7),
                    rdr.IsDBNull(8) ? null : rdr.GetString(8),
                    rdr.GetDateTime(9)));
            }
            return rows;
        }

        private async Task<List<object>> ReadBlockedUsersAsync(NpgsqlConnection conn, Guid tenantId)
        {
            var rows = new List<object>();
            await using var cmd = new NpgsqlCommand(@"
SELECT b.user_id,
       COALESCE(u.displayname, u.username) AS name,
       u.username,
       b.reason,
       b.blocked_at_utc
FROM public.user_access_blocks b
JOIN public.users u ON u.id = b.user_id
WHERE b.tenant_id = @tenant_id
  AND b.is_active = true
ORDER BY b.blocked_at_utc DESC
LIMIT 100;", conn);
            cmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);

            await using var rdr = await cmd.ExecuteReaderAsync(HttpContext.RequestAborted);
            while (await rdr.ReadAsync(HttpContext.RequestAborted))
            {
                rows.Add(new
                {
                    userId = rdr.GetGuid(0),
                    name = rdr.IsDBNull(1) ? null : rdr.GetString(1),
                    username = rdr.IsDBNull(2) ? null : rdr.GetString(2),
                    reason = rdr.IsDBNull(3) ? null : rdr.GetString(3),
                    blockedAtUtc = rdr.GetDateTime(4)
                });
            }
            return rows;
        }

        private sealed record PageVisitRow(long Id, Guid? UserId, string Path, string? Title, string? IpAddress, DateTime CreatedAtUtc);

        private sealed record SecurityEventRow(
            long Id,
            string EventType,
            string Severity,
            string? Username,
            Guid? UserId,
            string? Path,
            string? IpAddress,
            string? UserAgent,
            string? Details,
            DateTime CreatedAtUtc);
    }
}

