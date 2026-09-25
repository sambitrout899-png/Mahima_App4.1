using Mahima.Api.v3.clean.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Mahima.Api.v3.clean;
using Mahima.Api.v3.clean.Hubs;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Models.Dtos;
using Mahima.Api.v3.clean.Services;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    // Support both /api/PrayerRequests and /prayerrequests
    [Route("api/[controller]")]
    [Route("prayerrequests")]
    public class PrayerRequestsController : ControllerBase
    {
        private readonly MahimaDbContext _db;
        private readonly IHubContext<ChatHub> _hub;
        private readonly ILogger<PrayerRequestsController> _logger;
        private readonly IPastorBotService _pastorBot;

        private static readonly Guid SuperUserGuid = Guid.Parse("ae9dfc94-07d8-469a-a8f6-a4c5aedcf3a9");
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");

        public PrayerRequestsController(
            MahimaDbContext db,
            IHubContext<ChatHub> hub,
            ILogger<PrayerRequestsController> logger,
            IPastorBotService pastorBot)
        {
            _db = db;
            _hub = hub;
            _logger = logger;
            _pastorBot = pastorBot;
        }

        private Guid GetCurrentTenantId() =>
            Guid.TryParse(User.FindFirstValue("tenant_id"), out var id)
                ? id
                : RootTenantId;

        // ---------- CREATE NEW PRAYER REQUEST ----------
        [HttpPost]
        [Authorize]
        public async Task<IActionResult> CreatePrayerRequest([FromBody] CreatePrayerRequestDto dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.Message))
                return BadRequest("Message is required.");

            var userId = GetCurrentUserGuid();
            var userName = GetCurrentUserName() ?? (dto.Anonymous ? "Anonymous" : "Unknown");

            var request = new PrayerRequest
            {
                TenantId = GetCurrentTenantId(),
                Title = string.IsNullOrWhiteSpace(dto.Title) ? null : dto.Title.Trim(),
                Message = dto.Message.Trim(),
                UserId = userId,
                CreatedBy = dto.Anonymous ? "Anonymous" : userName,
                CreatedAt = DateTime.UtcNow,
                Status = string.IsNullOrWhiteSpace(dto.Status) ? "new" : dto.Status,
                Anonymous = dto.Anonymous,
                AssignedTo = dto.AssignedTo
            };

            _db.PrayerRequests.Add(request);
            try
            {
                await _db.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error saving PrayerRequest");
                return StatusCode(500, "Error saving prayer request");
            }

            var result = new
            {
                id = request.Id,
                userId = request.UserId,
                createdBy = request.CreatedBy,
                title = request.Title,
                message = request.Message,
                anonymous = request.Anonymous,
                status = request.Status,
                assignedTo = request.AssignedTo,
                createdAt = request.CreatedAt,
                closeComment = GetCloseCommentValue(request),
                responses = Array.Empty<object>()
            };

            return Ok(result);
        }

        // ---------- PATCH / PUT STATUS + CLOSE COMMENT ----------
        [HttpPatch("{id:long}")]
        [Authorize]
        public async Task<IActionResult> PatchStatus(long id, [FromBody] UpdatePrayerRequestStatusDto dto)
            => await UpdateStatusInternal(id, dto);

        [HttpPut("{id:long}")]
        [Authorize]
        public async Task<IActionResult> PutStatus(long id, [FromBody] UpdatePrayerRequestStatusDto dto)
            => await UpdateStatusInternal(id, dto);

        private async Task<IActionResult> UpdateStatusInternal(long id, UpdatePrayerRequestStatusDto dto)
        {
            // we allow updating either Status, or CloseComment, or both
            bool hasStatus = dto != null && !string.IsNullOrWhiteSpace(dto.Status);
            bool hasCloseComment = dto != null && dto.CloseComment != null;
            bool hasTitle = dto != null && dto.Title != null;
            bool hasMessage = dto != null && dto.Message != null;
            bool hasAnonymous = dto != null && dto.Anonymous.HasValue;

            if (!hasStatus && !hasCloseComment && !hasTitle && !hasMessage && !hasAnonymous)
                return BadRequest("At least one prayer request value is required.");

            var tenantId = GetCurrentTenantId();
            var req = await _db.PrayerRequests.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
            if (req == null)
                return NotFound();

            var currentUserId = GetCurrentUserGuid();
            var roles = GetCurrentUserRoles().ToList();
            bool isPrivileged = IsPrivilegedUser(roles);
            if (currentUserId != null && currentUserId == SuperUserGuid) isPrivileged = true;

            if (!isPrivileged && currentUserId != null)
            {
                try
                {
                    var user = await _db.Users.AsNoTracking()
                        .Where(u => u.Id == currentUserId)
                        .Select(u => new { u.Role })
                        .FirstOrDefaultAsync();

                    if (user != null && !string.IsNullOrWhiteSpace(user.Role))
                    {
                        var parsed = ParseRolesFromString(user.Role);
                        if (IsPrivilegedUser(parsed)) isPrivileged = true;
                    }
                }
                catch
                {
                    // ignore lookup failures
                }
            }

            if (!isPrivileged && currentUserId.HasValue)
            {
                isPrivileged = await HasPrayerDeskAccessAsync(currentUserId.Value);
            }

            if (!isPrivileged)
                return Forbid("Only administrators and call center managers can update prayer requests.");

            // ---- apply updates ----
            if (hasStatus)
            {
                req.Status = dto!.Status!.Trim();
            }

            if (hasCloseComment)
            {
                // Use reflection to avoid hard dependency on CloseComment property.
                var closeCommentProp = req.GetType().GetProperty("CloseComment");
                if (closeCommentProp != null && closeCommentProp.CanWrite)
                {
                    closeCommentProp.SetValue(req, dto!.CloseComment);
                }
            }

            if (hasTitle)
            {
                req.Title = string.IsNullOrWhiteSpace(dto!.Title) ? null : dto.Title.Trim();
            }

            if (hasMessage)
            {
                if (string.IsNullOrWhiteSpace(dto!.Message))
                    return BadRequest("Prayer request message is required.");
                req.Message = dto.Message.Trim();
            }

            if (hasAnonymous)
            {
                req.Anonymous = dto!.Anonymous!.Value;
                if (req.Anonymous)
                {
                    req.CreatedBy = "Anonymous";
                }
            }

            // optional UpdatedAt support
            var updatedAtProp = req.GetType().GetProperty("UpdatedAt");
            if (updatedAtProp != null && updatedAtProp.CanWrite)
            {
                updatedAtProp.SetValue(req, DateTime.UtcNow);
            }

            await _db.SaveChangesAsync();

            if (hasStatus && string.Equals(req.Status, "closed", StringComparison.OrdinalIgnoreCase))
            {
                await EnsureTestimonyForAnsweredPrayerAsync(req);
            }

            return Ok(new
            {
                id = req.Id,
                title = req.Title,
                message = req.Message,
                anonymous = req.Anonymous,
                createdBy = req.CreatedBy,
                status = req.Status,
                closeComment = GetCloseCommentValue(req)
            });
        }

        // ---------- GET ALL REQUESTS ----------
        [HttpGet]
        [Authorize]
        public async Task<IActionResult> GetAll([FromQuery] bool includeResponses = false)
        {
            var currentUserId = GetCurrentUserGuid();
            var roles = GetCurrentUserRoles().ToList();
            bool isPrivileged = IsPrivilegedUser(roles);
            if (currentUserId != null && currentUserId == SuperUserGuid) isPrivileged = true;
            var canManagePrayerDesk = isPrivileged || (currentUserId.HasValue && await HasPrayerDeskAccessAsync(currentUserId.Value));

            var tenantId = GetCurrentTenantId();
            IQueryable<PrayerRequest> query = _db.PrayerRequests.AsNoTracking()
                .Where(p => p.TenantId == tenantId);
            if (!isPrivileged)
            {
                if (currentUserId == null)
                    return Forbid();
                query = query.Where(p => p.UserId == currentUserId);
            }

            var list = await query.OrderByDescending(p => p.CreatedAt).ToListAsync();
            var responsesMap = new Dictionary<long, List<object>>();
            var responseCounts = new Dictionary<long, int>();
            var reminderCounts = canManagePrayerDesk && list.Any()
                ? await LoadReminderCountsByPrayerAsync(list.Select(p => p.Id).ToList())
                : new Dictionary<long, PrayerReminderCount>();

            if (includeResponses && list.Any())
            {
                var reqIds = list.Select(p => p.Id).ToList();
                responsesMap = await LoadResponsesByRawSqlAsync(reqIds);
                responseCounts = responsesMap.ToDictionary(kvp => kvp.Key, kvp => kvp.Value.Count);
            }
            else if (canManagePrayerDesk && list.Any())
            {
                responseCounts = await LoadResponseCountsByPrayerAsync(list.Select(p => p.Id).ToList());
            }

            var dto = list.Select(p =>
            {
                var closeComment = GetCloseCommentValue(p);
                reminderCounts.TryGetValue(p.Id, out var reminders);
                responsesMap.TryGetValue(p.Id, out var found);
                var responseCount = responseCounts.TryGetValue(p.Id, out var countedResponses) ? countedResponses : 0;
                var rag = canManagePrayerDesk
                    ? BuildPrayerRagStatus(p, reminders, responseCount)
                    : PrayerRagStatus.Empty;

                return new
                {
                    id = p.Id,
                    userId = p.UserId,
                    createdBy = p.CreatedBy,
                    title = p.Title,
                    message = p.Message,
                    anonymous = p.Anonymous,
                    status = p.Status,
                    assignedTo = p.AssignedTo,
                    createdAt = p.CreatedAt,
                    closeComment = closeComment,
                    reminderCount = reminders?.Total ?? 0,
                    reminderTodayCount = reminders?.Today ?? 0,
                    lastReminderAtUtc = reminders?.LastSentAtUtc,
                    ragStatus = rag.Status,
                    ragLabel = rag.Label,
                    ragReason = rag.Reason,
                    ragAgeHours = rag.AgeHours,
                    responses = found != null
                        ? found.ToArray()
                        : Array.Empty<object>()
                };
            });

            return Ok(dto);
        }

        // helper to safely read CloseComment via reflection (or null)
        private static string? GetCloseCommentValue(object obj)
        {
            if (obj == null) return null;
            var prop = obj.GetType().GetProperty("CloseComment");
            if (prop == null) return null;
            var val = prop.GetValue(obj);
            return val?.ToString();
        }

        private sealed class PrayerReminderCount
        {
            public int Total { get; set; }
            public int Today { get; set; }
            public DateTime? LastSentAtUtc { get; set; }
        }

        private sealed class PrayerRagStatus
        {
            public static readonly PrayerRagStatus Empty = new() { Status = null, Label = null, Reason = null, AgeHours = null };
            public string? Status { get; set; }
            public string? Label { get; set; }
            public string? Reason { get; set; }
            public int? AgeHours { get; set; }
        }

        private static PrayerRagStatus BuildPrayerRagStatus(PrayerRequest prayer, PrayerReminderCount? reminders, int responseCount)
        {
            var status = (prayer.Status ?? "new").Trim().ToLowerInvariant();
            var isAnswered = status is "closed" or "answered" or "completed" or "done" or "resolved";
            var ageHours = Math.Max(0, (int)Math.Floor((DateTime.UtcNow - prayer.CreatedAt).TotalHours));
            var reminderCount = reminders?.Total ?? 0;

            if (isAnswered)
            {
                return new PrayerRagStatus
                {
                    Status = "green",
                    Label = "Green",
                    Reason = "Prayer request has been answered or closed.",
                    AgeHours = ageHours
                };
            }

            if (responseCount > 0 || status is "prayed" or "open")
            {
                return new PrayerRagStatus
                {
                    Status = "green",
                    Label = "Green",
                    Reason = responseCount > 0 ? "A prayer response has been logged." : "Prayer is being actively followed.",
                    AgeHours = ageHours
                };
            }

            if (ageHours >= 48 || reminderCount >= 2)
            {
                return new PrayerRagStatus
                {
                    Status = "red",
                    Label = "Red",
                    Reason = reminderCount >= 2
                        ? "Multiple reminders have been sent and no response is logged."
                        : "No response has been logged for more than 48 hours.",
                    AgeHours = ageHours
                };
            }

            if (ageHours >= 24 || reminderCount >= 1)
            {
                return new PrayerRagStatus
                {
                    Status = "amber",
                    Label = "Amber",
                    Reason = reminderCount >= 1
                        ? "A reminder has been sent and response is still pending."
                        : "No response has been logged for more than 24 hours.",
                    AgeHours = ageHours
                };
            }

            return new PrayerRagStatus
            {
                Status = "green",
                Label = "Green",
                Reason = "New request is still within the normal response window.",
                AgeHours = ageHours
            };
        }

        private static string NormalizeAccessName(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return "";
            return new string(value
                .ToLowerInvariant()
                .Where(char.IsLetterOrDigit)
                .ToArray());
        }

        private static bool IsPrayerDeskManagerName(string? value)
        {
            var name = NormalizeAccessName(value);
            return name == "callcentermanager"
                || name == "callcentremanager"
                || name == "callcenter"
                || name == "callcentre"
                || name == "prayerdeskmanager"
                || name == "prayercallcentermanager";
        }

        private async Task<bool> HasPrayerDeskAccessAsync(Guid userId)
        {
            try
            {
                var conn = _db.Database.GetDbConnection();
                if (conn.State != ConnectionState.Open)
                    await conn.OpenAsync();

                await Mahima.Api.v3.clean.Controllers.PositionsController.EnsurePositionTablesAsync((Npgsql.NpgsqlConnection)conn);
                using (var roleTableCmd = conn.CreateCommand())
                {
                    roleTableCmd.CommandText = @"
CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role_id integer NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    assigned_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);";
                    await roleTableCmd.ExecuteNonQueryAsync();
                }

                using var cmd = conn.CreateCommand();
                cmd.CommandText = @"
SELECT EXISTS (
    SELECT 1
    FROM public.user_positions up
    JOIN public.positions p ON p.id = up.position_id AND p.is_active = true
    WHERE up.user_id = @user_id
      AND lower(regexp_replace(p.name, '[^a-z0-9]+', '', 'g')) IN ('callcentermanager', 'callcentremanager', 'callcenter', 'callcentre', 'prayerdeskmanager', 'prayercallcentermanager')
) OR EXISTS (
    SELECT 1
    FROM public.users u
    LEFT JOIN public.roles primary_role ON primary_role.id::text = u.role::text
    WHERE u.id = @user_id
      AND lower(regexp_replace(COALESCE(primary_role.name, u.role::text), '[^a-z0-9]+', '', 'g')) IN ('callcentermanager', 'callcentremanager', 'callcenter', 'callcentre', 'prayerdeskmanager', 'prayercallcentermanager')
) OR EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
    WHERE ur.user_id = @user_id
      AND lower(regexp_replace(r.name, '[^a-z0-9]+', '', 'g')) IN ('callcentermanager', 'callcentremanager', 'callcenter', 'callcentre', 'prayerdeskmanager', 'prayercallcentermanager')
);";
                AddParam(cmd, "user_id", userId);
                return Convert.ToBoolean(await cmd.ExecuteScalarAsync());
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not determine prayer desk access for user {UserId}.", userId);
                return false;
            }
        }

        private async Task EnsurePrayerReminderSchemaAsync()
        {
            var conn = _db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open)
                await conn.OpenAsync();

            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
CREATE TABLE IF NOT EXISTS public.prayer_monitor_reminders (
    id bigserial PRIMARY KEY,
    prayerrequestid bigint NOT NULL REFERENCES public.prayerrequests(id) ON DELETE CASCADE,
    recipientuserid uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    chatmessageid uuid NULL,
    sentatutc timestamp without time zone NOT NULL DEFAULT now(),
    reminderlocaldate date NOT NULL DEFAULT CURRENT_DATE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_prayer_monitor_daily
ON public.prayer_monitor_reminders (prayerrequestid, recipientuserid, reminderlocaldate);

CREATE INDEX IF NOT EXISTS ix_prayer_monitor_prayer_sent
ON public.prayer_monitor_reminders (prayerrequestid, sentatutc DESC);";
            await cmd.ExecuteNonQueryAsync();
        }

        private async Task<Dictionary<long, PrayerReminderCount>> LoadReminderCountsByPrayerAsync(List<long> requestIds)
        {
            var map = new Dictionary<long, PrayerReminderCount>();
            if (requestIds == null || requestIds.Count == 0) return map;

            try
            {
                await EnsurePrayerReminderSchemaAsync();
                var conn = _db.Database.GetDbConnection();
                if (conn.State != ConnectionState.Open)
                    await conn.OpenAsync();

                using var cmd = conn.CreateCommand();
                var paramNames = new List<string>();
                for (int i = 0; i < requestIds.Count; i++)
                {
                    var p = cmd.CreateParameter();
                    p.ParameterName = $"@rid{i}";
                    p.Value = requestIds[i];
                    cmd.Parameters.Add(p);
                    paramNames.Add(p.ParameterName);
                }

                cmd.CommandText = $@"
SELECT prayerrequestid,
       COUNT(*)::int AS total_count,
       COUNT(*) FILTER (WHERE reminderlocaldate = CURRENT_DATE)::int AS today_count,
       MAX(sentatutc) AS last_sent_at_utc
FROM public.prayer_monitor_reminders
WHERE prayerrequestid IN ({string.Join(",", paramNames)})
GROUP BY prayerrequestid;";

                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    var prayerId = reader.GetInt64(0);
                    map[prayerId] = new PrayerReminderCount
                    {
                        Total = reader.IsDBNull(1) ? 0 : reader.GetInt32(1),
                        Today = reader.IsDBNull(2) ? 0 : reader.GetInt32(2),
                        LastSentAtUtc = reader.IsDBNull(3) ? null : reader.GetDateTime(3)
                    };
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not load prayer reminder counters.");
            }

            return map;
        }

        private async Task<Dictionary<long, int>> LoadResponseCountsByPrayerAsync(List<long> requestIds)
        {
            if (requestIds == null || requestIds.Count == 0) return new Dictionary<long, int>();

            try
            {
                return await _db.PrayerResponses
                    .AsNoTracking()
                    .Where(r => requestIds.Contains(r.PrayerRequestId))
                    .GroupBy(r => r.PrayerRequestId)
                    .Select(g => new { PrayerRequestId = g.Key, Count = g.Count() })
                    .ToDictionaryAsync(x => x.PrayerRequestId, x => x.Count);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not load prayer response counters for RAG status.");
                return new Dictionary<long, int>();
            }
        }

        // ---------- RAW SQL FALLBACK WITH AUTO COLUMN DETECTION ----------
        private async Task<Dictionary<long, List<object>>> LoadResponsesByRawSqlAsync(List<long> requestIds)
        {
            var map = new Dictionary<long, List<object>>();
            if (requestIds == null || !requestIds.Any()) return map;

            var conn = _db.Database.GetDbConnection();
            try
            {
                if (conn.State != ConnectionState.Open)
                    await conn.OpenAsync();

                var existingCols = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                using (var colCmd = conn.CreateCommand())
                {
                    colCmd.CommandText = @"SELECT column_name FROM information_schema.columns WHERE table_name = 'prayerresponses';";
                    using var rdr = await colCmd.ExecuteReaderAsync();
                    while (await rdr.ReadAsync())
                        existingCols.Add(rdr.GetString(0));
                }

                string msgCol = existingCols.Contains("message") ? "message" :
                                existingCols.Contains("response_text") ? "response_text" :
                                existingCols.Contains("ResponseText") ? "\"ResponseText\"" :
                                existingCols.Contains("responsetext") ? "responsetext" : "''";

                string authCol = existingCols.Contains("author") ? "author" :
                                 existingCols.Contains("respondedby") ? "respondedby" :
                                 existingCols.Contains("responded_by") ? "responded_by" :
                                 existingCols.Contains("RespondedBy") ? "\"RespondedBy\"" : "''";

                string createdCol = existingCols.Contains("createdat") ? "createdat" :
                                    existingCols.Contains("respondedat") ? "respondedat" :
                                    existingCols.Contains("responded_at") ? "responded_at" :
                                    existingCols.Contains("RespondedAt") ? "\"RespondedAt\"" : "NOW()";

                string isDeletedCol = existingCols.Contains("isdeleted") ? "isdeleted" :
                                      existingCols.Contains("IsDeleted") ? "\"IsDeleted\"" : "false";

                using var cmd = conn.CreateCommand();
                var paramNames = new List<string>();
                for (int i = 0; i < requestIds.Count; i++)
                {
                    var p = cmd.CreateParameter();
                    p.ParameterName = $"@p{i}";
                    p.Value = requestIds[i];
                    cmd.Parameters.Add(p);
                    paramNames.Add(p.ParameterName);
                }

                cmd.CommandText = $@"
                    SELECT id,
                           prayerrequestid,
                           COALESCE({msgCol}, '') AS message,
                           COALESCE({authCol}, '') AS author,
                           COALESCE({createdCol}, NOW()) AS createdat,
                           COALESCE({isDeletedCol}, false) AS isdeleted
                    FROM prayerresponses
                    WHERE prayerrequestid IN ({string.Join(",", paramNames)})
                      AND COALESCE({isDeletedCol}, false) = false
                    ORDER BY createdat ASC;
                ";

                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    var id = reader.IsDBNull(0) ? 0L : reader.GetInt64(0);
                    var pid = reader.IsDBNull(1) ? 0L : reader.GetInt64(1);
                    var msg = reader.IsDBNull(2) ? "" : reader.GetString(2);
                    var auth = reader.IsDBNull(3) ? "" : reader.GetString(3);
                    var created = reader.IsDBNull(4) ? DateTime.UtcNow : reader.GetDateTime(4);

                    if (!map.TryGetValue(pid, out var list))
                        map[pid] = list = new List<object>();

                    list.Add(new { id = id, author = auth, message = msg, createdAt = created });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Dynamic column detection or response load failed.");
            }
            finally
            {
                try { conn.Close(); } catch { }
            }

            return map;
        }

        // ---------- GET RESPONSES ----------
        [HttpGet("{id:long}/responses")]
        [AllowAnonymous]
        public async Task<IActionResult> GetResponses(long id)
        {
            var tenantId = GetCurrentTenantId();
            var exists = await _db.PrayerRequests.AnyAsync(p => p.Id == id && p.TenantId == tenantId);
            if (!exists) return NotFound();

            var dict = await LoadResponsesByRawSqlAsync(new List<long> { id });
            if (dict.TryGetValue(id, out var list))
                return Ok(list);

            return Ok(Array.Empty<object>());
        }

        // ---------- ADD RESPONSE ----------
        [HttpPost("{id:long}/responses")]
        [Authorize]
        public async Task<IActionResult> AddResponse(long id, [FromBody] PrayerResponseDto dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.ResponseText))
                return BadRequest("ResponseText is required.");

            var tenantId = GetCurrentTenantId();
            var request = await _db.PrayerRequests.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
            if (request == null)
                return NotFound();

            var respondedBy = GetCurrentUserName() ?? dto.RespondedBy ?? "Mahima Ministry";

            var response = new PrayerResponse
            {
                PrayerRequestId = id,
                ResponseText = dto.ResponseText.Trim(),
                RespondedBy = respondedBy,
                RespondedAt = DateTime.UtcNow,
                IsDeleted = false
            };

            _db.PrayerResponses.Add(response);
            await _db.SaveChangesAsync();

            try
            {
                await _hub.Clients.Group(ChatHub.TenantGroupName(tenantId)).SendAsync("PrayerResponseCreated", new
                {
                    id = response.Id,
                    prayerRequestId = response.PrayerRequestId,
                    responseText = response.ResponseText,
                    respondedBy = response.RespondedBy,
                    respondedAt = response.RespondedAt
                });
            }
            catch
            {
                // ignore hub failures
            }

            return Ok(new
            {
                id = response.Id,
                prayerRequestId = response.PrayerRequestId,
                responseText = response.ResponseText,
                respondedBy = response.RespondedBy,
                respondedAt = response.RespondedAt
            });
        }

        // ---------- DELETE RESPONSE ----------
        [HttpDelete("{id:long}/responses/{responseId:long}")]
        [Authorize]
        public async Task<IActionResult> DeleteResponse(long id, long responseId)
        {
            var currentUserId = GetCurrentUserGuid();
            var roles = GetCurrentUserRoles().ToList();
            bool isPrivileged = IsPrivilegedUser(roles);
            if (currentUserId != null && currentUserId == SuperUserGuid) isPrivileged = true;

            if (!isPrivileged)
                return Forbid("Only administrators can delete responses.");

            var tenantId = GetCurrentTenantId();
            var resp = await _db.PrayerResponses
                .Where(r => r.Id == responseId && r.PrayerRequestId == id)
                .Where(r => _db.PrayerRequests.Any(p => p.Id == r.PrayerRequestId && p.TenantId == tenantId))
                .FirstOrDefaultAsync();
            if (resp == null) return NotFound();

            resp.IsDeleted = true;
            await _db.SaveChangesAsync();

            try
            {
                await _hub.Clients.Group(ChatHub.TenantGroupName(tenantId)).SendAsync("PrayerResponseDeleted", new { id = resp.Id, prayerRequestId = id });
            }
            catch
            {
                // ignore hub failures
            }

            _logger.LogInformation("PrayerResponse {ResponseId} soft-deleted by {User}", responseId, currentUserId?.ToString() ?? "(null)");
            return NoContent();
        }

        // ---------- DELETE PRAYER REQUEST (and its responses) ----------
        [HttpDelete("{id:long}")]
        [Authorize]
        public async Task<IActionResult> DeletePrayerRequest(long id)
        {
            var currentUserId = GetCurrentUserGuid();
            var roles = GetCurrentUserRoles().ToList();
            bool isPrivileged = IsPrivilegedUser(roles);
            if (currentUserId == SuperUserGuid) isPrivileged = true;
            if (!isPrivileged && currentUserId.HasValue)
                isPrivileged = await HasPrayerDeskAccessAsync(currentUserId.Value);

            var tenantId = GetCurrentTenantId();
            var request = await _db.PrayerRequests.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
            if (request == null) return NotFound();

            if (!isPrivileged && request.UserId != currentUserId)
                return Forbid("You are not allowed to delete this prayer request.");

            var strategy = _db.Database.CreateExecutionStrategy();

            try
            {
                await strategy.ExecuteAsync(async () =>
                {
                    using var tx = await _db.Database.BeginTransactionAsync();

                    var responses = await _db.PrayerResponses
                        .Where(r => r.PrayerRequestId == id)
                        .ToListAsync();

                    var respHasIsDeleted = responses.FirstOrDefault()?.GetType().GetProperty("IsDeleted") != null;
                    if (respHasIsDeleted)
                    {
                        foreach (var resp in responses)
                        {
                            var prop = resp.GetType().GetProperty("IsDeleted");
                            if (prop != null) prop.SetValue(resp, true);
                        }
                        await _db.SaveChangesAsync();
                    }
                    else if (responses.Any())
                    {
                        _db.PrayerResponses.RemoveRange(responses);
                        await _db.SaveChangesAsync();
                    }

                    var reqIsDeletedProp = request.GetType().GetProperty("IsDeleted");
                    if (reqIsDeletedProp != null)
                    {
                        reqIsDeletedProp.SetValue(request, true);
                        _db.PrayerRequests.Update(request);
                    }
                    else
                    {
                        _db.PrayerRequests.Remove(request);
                    }

                    await _db.SaveChangesAsync();
                    await tx.CommitAsync();

                    try
                    {
                        await _hub.Clients.Group(ChatHub.TenantGroupName(tenantId)).SendAsync("PrayerRequestDeleted", new { id });
                        foreach (var resp in responses)
                        {
                            var idProp = resp.GetType().GetProperty("Id");
                            long respId = 0;
                            if (idProp != null)
                            {
                                var val = idProp.GetValue(resp);
                                if (val != null) respId = Convert.ToInt64(val);
                            }
                            await _hub.Clients.Group(ChatHub.TenantGroupName(tenantId)).SendAsync("PrayerResponseDeleted", new { id = respId, prayerRequestId = id });
                        }
                    }
                    catch
                    {
                        // ignore hub failures
                    }
                });

                _logger.LogInformation("PrayerRequest {Id} deleted by user {UserId}", id, currentUserId?.ToString() ?? "(null)");
                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting PrayerRequest {Id}", id);
                return StatusCode(500, "Error deleting prayer request: " + ex.Message);
            }
        }

        [HttpGet("testimonies")]
        [Authorize]
        public async Task<IActionResult> GetTestimonies()
        {
            await EnsureTestimonySchemaAsync();
            var currentUserId = GetCurrentUserGuid();
            var roles = GetCurrentUserRoles().ToList();
            var isPrivileged = IsPrivilegedUser(roles) || currentUserId == SuperUserGuid;
            var tenantId = GetCurrentTenantId();

            var conn = _db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync();

            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                SELECT t.id, t.prayerrequestid, t.userid, t.title, t.testimonytext, t.testimonytexthindi, t.imageurl, t.voiceurl,
                       t.createdat, t.updatedat, p.createdby, p.message AS prayermessage, p.closecomment
                FROM public.prayertestimonies t
                JOIN public.prayerrequests p ON p.id = t.prayerrequestid
                WHERE p.tenant_id = @tenantId
                  AND (@isAdmin = true OR t.userid = @userId)
                ORDER BY COALESCE(t.updatedat, t.createdat) DESC;";
            AddParam(cmd, "tenantId", tenantId);
            AddParam(cmd, "isAdmin", isPrivileged);
            AddParam(cmd, "userId", currentUserId ?? Guid.Empty);

            var rows = new List<object>();
            using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                rows.Add(MapTestimony(reader));
            }
            return Ok(rows);
        }

        [HttpPut("testimonies/{id:long}")]
        [Authorize]
        public async Task<IActionResult> UpdateTestimony(long id, [FromBody] PrayerTestimonyDto dto)
        {
            await EnsureTestimonySchemaAsync();
            var currentUserId = GetCurrentUserGuid();
            if (currentUserId == null) return Unauthorized();

            var roles = GetCurrentUserRoles().ToList();
            var isPrivileged = IsPrivilegedUser(roles) || currentUserId == SuperUserGuid;
            var tenantId = GetCurrentTenantId();

            var conn = _db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync();

            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                UPDATE public.prayertestimonies t
                SET title = @title,
                    testimonytext = @text,
                    testimonytexthindi = COALESCE(NULLIF(@textHindi, ''), t.testimonytexthindi),
                    imageurl = @image,
                    voiceurl = @voice,
                    updatedat = now()
                FROM public.prayerrequests p
                WHERE t.id = @id
                  AND p.id = t.prayerrequestid
                  AND p.tenant_id = @tenantId
                  AND (@isAdmin = true OR t.userid = @userId)
                RETURNING t.id, t.prayerrequestid, t.userid, t.title, t.testimonytext, t.testimonytexthindi, t.imageurl, t.voiceurl, t.createdat, t.updatedat,
                          p.createdby, p.message AS prayermessage, p.closecomment;";
            AddParam(cmd, "id", id);
            AddParam(cmd, "tenantId", tenantId);
            AddParam(cmd, "isAdmin", isPrivileged);
            AddParam(cmd, "userId", currentUserId.Value);
            AddParam(cmd, "title", (object?)dto?.Title?.Trim() ?? DBNull.Value);
            AddParam(cmd, "text", (object?)dto?.TestimonyText?.Trim() ?? DBNull.Value);
            AddParam(cmd, "textHindi", (object?)dto?.TestimonyTextHindi?.Trim() ?? DBNull.Value);
            AddParam(cmd, "image", (object?)dto?.ImageUrl?.Trim() ?? DBNull.Value);
            AddParam(cmd, "voice", (object?)dto?.VoiceUrl?.Trim() ?? DBNull.Value);

            using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync()) return NotFound();
            return Ok(MapTestimony(reader));
        }

        [HttpPost("testimonies/backfill-hindi")]
        [Authorize]
        public async Task<IActionResult> BackfillHindiTestimonies()
        {
            await EnsureTestimonySchemaAsync();
            var currentUserId = GetCurrentUserGuid();
            var isPrivileged = IsPrivilegedUser(GetCurrentUserRoles()) || currentUserId == SuperUserGuid;
            if (!isPrivileged) return Forbid("Only administrators can backfill testimony translations.");

            var tenantId = GetCurrentTenantId();
            var conn = _db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync();

            var candidates = new List<(long Id, string English)>();
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = @"
                    SELECT pt.id, pt.testimonytext
                    FROM public.prayertestimonies pt
                    JOIN public.prayerrequests pr ON pr.id = pt.prayerrequestid
                    WHERE pr.tenant_id = @tenantId
                      AND NULLIF(trim(COALESCE(pt.testimonytext, '')), '') IS NOT NULL
                      AND NULLIF(trim(COALESCE(pt.testimonytexthindi, '')), '') IS NULL
                    ORDER BY pt.id;";
                AddParam(cmd, "tenantId", tenantId);

                using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    var text = reader["testimonytext"] == DBNull.Value ? null : reader["testimonytext"]?.ToString();
                    if (!string.IsNullOrWhiteSpace(text))
                        candidates.Add((Convert.ToInt64(reader["id"]), text.Trim()));
                }
            }

            var updated = 0;
            var skipped = 0;
            var failed = 0;

            foreach (var item in candidates)
            {
                string? hindi;
                try
                {
                    hindi = await GenerateHindiTestimonyAsync(item.English);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Could not translate testimony {TestimonyId} to Hindi", item.Id);
                    failed++;
                    continue;
                }

                if (string.IsNullOrWhiteSpace(hindi))
                {
                    skipped++;
                    continue;
                }

                using var update = conn.CreateCommand();
                update.CommandText = @"
                    UPDATE public.prayertestimonies
                    SET testimonytexthindi = @hindi,
                        updatedat = now()
                    WHERE id = @id
                      AND NULLIF(trim(COALESCE(testimonytexthindi, '')), '') IS NULL;";
                AddParam(update, "id", item.Id);
                AddParam(update, "hindi", hindi.Trim());
                updated += await update.ExecuteNonQueryAsync();
            }

            return Ok(new
            {
                total = candidates.Count,
                updated,
                skipped,
                failed
            });
        }

        // ---------- HELPERS ----------
        private async Task EnsureTestimonySchemaAsync()
        {
            var conn = _db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync();

            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                ALTER TABLE public.prayerrequests
                    ADD COLUMN IF NOT EXISTS closecomment text NULL;

                CREATE TABLE IF NOT EXISTS public.prayertestimonies (
                    id bigserial PRIMARY KEY,
                    prayerrequestid bigint NOT NULL REFERENCES public.prayerrequests(id) ON DELETE CASCADE,
                    userid uuid NULL,
                    title text NULL,
                    testimonytext text NULL,
                    testimonytexthindi text NULL,
                    imageurl text NULL,
                    voiceurl text NULL,
                    createdat timestamp without time zone NOT NULL DEFAULT now(),
                    updatedat timestamp without time zone NULL
                );
                ALTER TABLE public.prayertestimonies
                    ADD COLUMN IF NOT EXISTS testimonytexthindi text NULL,
                    ADD COLUMN IF NOT EXISTS imageurl text NULL,
                    ADD COLUMN IF NOT EXISTS voiceurl text NULL,
                    ADD COLUMN IF NOT EXISTS updatedat timestamp without time zone NULL;
                CREATE INDEX IF NOT EXISTS ix_prayertestimonies_prayerrequestid ON public.prayertestimonies(prayerrequestid);
                CREATE INDEX IF NOT EXISTS ix_prayertestimonies_userid ON public.prayertestimonies(userid);";
            await cmd.ExecuteNonQueryAsync();
        }

        private static void AddParam(System.Data.Common.DbCommand cmd, string name, object? value)
        {
            var p = cmd.CreateParameter();
            p.ParameterName = name;
            p.Value = value ?? DBNull.Value;
            cmd.Parameters.Add(p);
        }

        private static object MapTestimony(System.Data.Common.DbDataReader reader) => new
        {
            id = reader.GetInt64(0),
            prayerRequestId = reader.GetInt64(1),
            userId = reader.IsDBNull(2) ? null : reader.GetValue(2)?.ToString(),
            title = reader.IsDBNull(3) ? "" : reader.GetString(3),
            testimonyText = reader.IsDBNull(4) ? "" : reader.GetString(4),
            testimonyTextHindi = reader.IsDBNull(5) ? "" : reader.GetString(5),
            imageUrl = reader.IsDBNull(6) ? "" : reader.GetString(6),
            voiceUrl = reader.IsDBNull(7) ? "" : reader.GetString(7),
            createdAt = reader.IsDBNull(8) ? (DateTime?)null : reader.GetDateTime(8),
            updatedAt = reader.IsDBNull(9) ? (DateTime?)null : reader.GetDateTime(9),
            createdBy = reader.IsDBNull(10) ? "" : reader.GetString(10),
            prayerMessage = reader.IsDBNull(11) ? "" : reader.GetString(11),
            closeComment = reader.IsDBNull(12) ? "" : reader.GetString(12)
        };

        private Guid? GetCurrentUserGuid()
        {
            var idClaim = User?.FindFirst(ClaimTypes.NameIdentifier)?.Value
                          ?? User?.FindFirst("sub")?.Value
                          ?? User?.FindFirst("userid")?.Value;

            return Guid.TryParse(idClaim, out var g) ? g : (Guid?)null;
        }

        private string? GetCurrentUserName()
        {
            return User?.FindFirst(ClaimTypes.Name)?.Value
                ?? User?.FindFirst("preferred_username")?.Value
                ?? User?.FindFirst("username")?.Value;
        }

        private async Task EnsureTestimonyForAnsweredPrayerAsync(PrayerRequest request)
        {
            try
            {
                await EnsureTestimonySchemaAsync();
                var conn = _db.Database.GetDbConnection();
                if (conn.State != ConnectionState.Open) await conn.OpenAsync();

                using (var existsCmd = conn.CreateCommand())
                {
                    existsCmd.CommandText = "SELECT EXISTS (SELECT 1 FROM prayertestimonies WHERE prayerrequestid = @id);";
                    AddParam(existsCmd, "id", request.Id);
                    if ((bool)(await existsCmd.ExecuteScalarAsync() ?? false)) return;
                }

                var prompt =
                    "Create a short, warm Christian testimony draft from this answered prayer. " +
                    "Use first-person language if appropriate, keep it humble, thankful, and suitable for church members. " +
                    "Do not invent details beyond the prayer and answer. " +
                    $"Prayer title: {request.Title ?? "Prayer request"}\n" +
                    $"Prayer request: {request.Message}\n" +
                    $"How it was answered: {request.CloseComment ?? "God answered this prayer."}";

                var botUserId = await _pastorBot.EnsurePastorBotUserAsync();
                var ai = await _pastorBot.AskAsync(botUserId, prompt, sendToJaiMasih: false, persona: "pastor");
                var draft = string.IsNullOrWhiteSpace(ai.Answer)
                    ? $"Praise God. This prayer has been answered.\n\n{request.CloseComment}".Trim()
                    : ai.Answer.Trim();
                var draftHindi = await GenerateHindiTestimonyAsync(draft);

                using var insertCmd = conn.CreateCommand();
                insertCmd.CommandText = @"
                    INSERT INTO prayertestimonies (prayerrequestid, userid, title, testimonytext, testimonytexthindi, createdat)
                    VALUES (@prayerId, @userId, @title, @text, @textHindi, now())
                    ON CONFLICT (prayerrequestid) DO NOTHING;";
                AddParam(insertCmd, "prayerId", request.Id);
                AddParam(insertCmd, "userId", (object?)request.UserId ?? DBNull.Value);
                AddParam(insertCmd, "title", string.IsNullOrWhiteSpace(request.Title) ? "Answered Prayer Testimony" : request.Title);
                AddParam(insertCmd, "text", draft);
                AddParam(insertCmd, "textHindi", (object?)draftHindi ?? DBNull.Value);
                await insertCmd.ExecuteNonQueryAsync();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not create AI testimony for prayer request {PrayerRequestId}", request.Id);
            }
        }

        private async Task<string?> GenerateHindiTestimonyAsync(string? englishText)
        {
            if (string.IsNullOrWhiteSpace(englishText)) return null;

            var prompt =
                "Translate this Christian answered-prayer testimony into natural, respectful Hindi. " +
                "Preserve names, dates, and meaning. Do not add new details. Return only the Hindi translation.\n\n" +
                englishText.Trim();

            var botUserId = await _pastorBot.EnsurePastorBotUserAsync();
            var ai = await _pastorBot.AskAsync(botUserId, prompt, sendToJaiMasih: false, language: "hi", persona: "pastor");
            if (!string.Equals(ai.Source, "ai", StringComparison.OrdinalIgnoreCase))
                return null;

            var answer = ai.Answer?.Trim();
            return string.IsNullOrWhiteSpace(answer) ? null : answer;
        }

        private IEnumerable<string> GetCurrentUserRoles()
        {
            var roles = new List<string>();
            if (User == null) return roles;

            roles.AddRange(User.Claims.Where(c => c.Type == ClaimTypes.Role).Select(c => c.Value ?? ""));
            roles.AddRange(User.Claims.Where(c => string.Equals(c.Type, "role", StringComparison.OrdinalIgnoreCase)).Select(c => c.Value ?? ""));
            return roles.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.OrdinalIgnoreCase);
        }

        private static List<string> ParseRolesFromString(string? roleValue)
        {
            var results = new List<string>();
            if (string.IsNullOrWhiteSpace(roleValue)) return results;
            if (roleValue.Contains(','))
                results.AddRange(roleValue.Split(',').Select(x => x.Trim()));
            else
                results.Add(roleValue.Trim());
            return results.Where(x => !string.IsNullOrWhiteSpace(x)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        }

        private static bool IsPrivilegedUser(IEnumerable<string>? roles)
        {
            if (roles == null) return false;
            foreach (var r in roles)
            {
                if (string.IsNullOrWhiteSpace(r)) continue;
                var low = r.Trim().ToLowerInvariant();
                var normalized = NormalizeAccessName(r);
                if (low == "admin" || low == "administrator" || low == "staff" || low == "superuser" || low == "manager")
                    return true;
                if (normalized == "superadmin" || normalized == "superadministrator" || IsPrayerDeskManagerName(r))
                    return true;
                if (low.Contains("admin") || low.Contains("staff"))
                    return true;
            }
            return false;
        }
    }

    // DTOs
    public class CreatePrayerRequestDto
    {
        public string? Title { get; set; }
        public string Message { get; set; } = "";
        public bool Anonymous { get; set; } = false;
        public string? Status { get; set; } = "new";
        public Guid? AssignedTo { get; set; }
    }

    public class PrayerResponseDto
    {
        public string? ResponseText { get; set; }
        public string? RespondedBy { get; set; }
    }

    public class PrayerTestimonyDto
    {
        public string? Title { get; set; }
        public string? TestimonyText { get; set; }
        public string? TestimonyTextHindi { get; set; }
        public string? ImageUrl { get; set; }
        public string? VoiceUrl { get; set; }
    }

    public class UpdatePrayerRequestStatusDto
    {
        public string? Title { get; set; }
        public string? Message { get; set; }
        public bool? Anonymous { get; set; }
        public string? Status { get; set; }

        // NEW: closing / admin comment; may be null to clear
        public string? CloseComment { get; set; }
    }

}

