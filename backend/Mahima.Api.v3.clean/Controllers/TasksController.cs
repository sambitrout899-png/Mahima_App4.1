using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Helpers; // SmsHelper
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/tasks")]
    public class TasksController : ControllerBase
    {
        private readonly string _connStr;
        private readonly ILogger<TasksController> _logger;
        private readonly ITenantContextService _tenantContext;

        public TasksController(
            IConfiguration config,
            ILogger<TasksController> logger,
            ITenantContextService tenantContext)
        {
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
            _tenantContext = tenantContext ?? throw new ArgumentNullException(nameof(tenantContext));
            if (config == null) throw new ArgumentNullException(nameof(config));

            _connStr = config.GetConnectionString("DefaultConnection")
                       ?? config["ConnectionStrings:DefaultConnection"]
                       ?? throw new InvalidOperationException("Connection string 'DefaultConnection' not found.");

            SmsHelper.Initialize(config, logger);
        }

        // DTO
        public class TaskDto
        {
            public long? Id { get; set; }                   // bigint -> long
            public string? Title { get; set; }
            public string? Description { get; set; }

            // Accept multiple assignees
            public List<string>? AssigneeIds { get; set; }
            // legacy single-assignee support
            public string? AssigneeId { get; set; }

            // read-only results
            public List<string>? AssignedToNames { get; set; }
            public List<string>? AssignedPhones { get; set; }

            public long? TeamId { get; set; }
            public bool? Completed { get; set; }
            public int? Status { get; set; }               // integer -> int
            public int? Priority { get; set; }
            public DateTime? DueDate { get; set; }
            public DateTime? CreatedAt { get; set; }
            public DateTime? UpdatedAt { get; set; }
            public long? ParentTaskId { get; set; }
            public string? TaskType { get; set; }
            public string? ProcessStage { get; set; }
            public DateTime? FollowUpDate { get; set; }
            public string? FollowUpNotes { get; set; }
            public string? Recurring { get; set; }
            public string? EventRef { get; set; }
            public bool? IsAutoGen { get; set; }
            public List<TaskAssigneeDto>? Assignees { get; set; }
            public Guid? CreatedById { get; set; }
            public long? OwnerPositionId { get; set; }
            public long? ParentViewerPositionId { get; set; }
            public bool CanUpdate { get; set; }
            public bool CanReassign { get; set; }
            public bool CanDelete { get; set; }
            public bool ReadOnly { get; set; }
            public string? VisibilityReason { get; set; }
        }

        public class TaskAssigneeDto
        {
            public string? Id { get; set; }
            public string? Type { get; set; }
            public string? Name { get; set; }
            public string? Email { get; set; }
            public int? MemberCount { get; set; }
        }

        private const string EnsureTaskSchemaSql = @"
ALTER TABLE public.""Tasks""
    ADD COLUMN IF NOT EXISTS ""ParentTaskId"" bigint NULL,
    ADD COLUMN IF NOT EXISTS ""TaskType"" text NOT NULL DEFAULT 'general',
    ADD COLUMN IF NOT EXISTS ""ProcessStage"" text NOT NULL DEFAULT 'intake',
    ADD COLUMN IF NOT EXISTS ""FollowUpDate"" timestamp with time zone NULL,
    ADD COLUMN IF NOT EXISTS ""FollowUpNotes"" text NULL,
    ADD COLUMN IF NOT EXISTS ""Recurring"" text NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS ""EventRef"" text NULL,
    ADD COLUMN IF NOT EXISTS ""IsAutoGen"" boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS ""CreatedById"" uuid NULL,
    ADD COLUMN IF NOT EXISTS ""OwnerPositionId"" bigint NULL,
    ADD COLUMN IF NOT EXISTS ""ParentViewerPositionId"" bigint NULL;

CREATE TABLE IF NOT EXISTS public.""TaskAssignmentsV2"" (
    ""TaskId"" bigint NOT NULL REFERENCES public.""Tasks""(""Id"") ON DELETE CASCADE,
    ""AssigneeType"" text NOT NULL,
    ""AssigneeId"" text NOT NULL,
    ""CreatedAt"" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT ""PK_TaskAssignmentsV2"" PRIMARY KEY (""TaskId"", ""AssigneeType"", ""AssigneeId"")
);
CREATE INDEX IF NOT EXISTS ""IX_TaskAssignmentsV2_Assignee""
    ON public.""TaskAssignmentsV2"" (""AssigneeType"", ""AssigneeId"");

CREATE TABLE IF NOT EXISTS public.""TaskAutomationQueue"" (
    ""Id"" bigserial PRIMARY KEY,
    ""TaskId"" bigint NOT NULL REFERENCES public.""Tasks""(""Id"") ON DELETE CASCADE,
    ""AutomationKey"" text NOT NULL,
    ""ScheduledAtUtc"" timestamp with time zone NOT NULL,
    ""Message"" text NOT NULL,
    ""Status"" text NOT NULL DEFAULT 'pending',
    ""SentAtUtc"" timestamp with time zone NULL,
    ""AttemptCount"" integer NOT NULL DEFAULT 0,
    ""LastError"" text NULL,
    ""CreatedAtUtc"" timestamp with time zone NOT NULL DEFAULT now(),
    ""UpdatedAtUtc"" timestamp with time zone NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_task_automation_queue_task_key
    ON public.""TaskAutomationQueue"" (""TaskId"", ""AutomationKey"");

INSERT INTO public.""TaskAssignmentsV2"" (""TaskId"", ""AssigneeType"", ""AssigneeId"")
SELECT ""Id"", 'user', ""AssigneeId""::text
FROM public.""Tasks""
WHERE ""AssigneeId"" IS NOT NULL
ON CONFLICT DO NOTHING;";

        private static async Task EnsureTaskSchemaAsync(NpgsqlConnection conn, NpgsqlTransaction? tx = null)
        {
            await using var schema = new NpgsqlCommand(EnsureTaskSchemaSql, conn, tx);
            await schema.ExecuteNonQueryAsync();
        }

        // GET /api/tasks  (returns assignee arrays)
        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
            if (tenant == null) return BadRequest("Tenant context could not be resolved.");

            var sql = @"
SELECT 
    t.""Id"", t.""Title"", t.""Description"", t.""TeamId"", t.""Status"", t.""Priority"",
    t.""DueDate"", t.""CreatedAt"", t.""UpdatedAt"",
    t.""AssigneeId"", u.displayname, u.phone,
    t.""ParentTaskId"", t.""TaskType"", t.""ProcessStage"", t.""FollowUpDate"",
    t.""FollowUpNotes"", t.""Recurring"", t.""EventRef"", t.""IsAutoGen"",
    t.""CreatedById"", t.""OwnerPositionId"", t.""ParentViewerPositionId""
FROM public.""Tasks"" t
LEFT JOIN public.users u ON u.id = t.""AssigneeId"" AND u.tenant_id = @tenantId
WHERE t.""TenantId"" = @tenantId
ORDER BY t.""Id"" DESC;
";

            var list = new List<TaskDto>();
            try
            {
                using var conn = new NpgsqlConnection(_connStr);
                conn.Open();
                await EnsureTaskSchemaAsync(conn);
                var visibility = await PositionVisibilityService.ResolveAsync(HttpContext, conn);
                var isAdmin = IsAdminUser();
                using var cmd = new NpgsqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenant.Id);
                using var rdr = cmd.ExecuteReader();
                while (rdr.Read())
                {
                    var dto = new TaskDto
                    {
                        Id = rdr.IsDBNull(0) ? null : (long?)rdr.GetInt64(0),
                        Title = rdr.IsDBNull(1) ? null : rdr.GetString(1),
                        Description = rdr.IsDBNull(2) ? null : rdr.GetString(2),
                        TeamId = rdr.IsDBNull(3) ? null : (long?)rdr.GetInt64(3),
                        Status = rdr.IsDBNull(4) ? null : (int?)rdr.GetInt32(4),
                        Priority = rdr.IsDBNull(5) ? null : (int?)rdr.GetInt32(5),
                        DueDate = rdr.IsDBNull(6) ? null : (DateTime?)rdr.GetDateTime(6),
                        CreatedAt = rdr.IsDBNull(7) ? null : (DateTime?)rdr.GetDateTime(7),
                        UpdatedAt = rdr.IsDBNull(8) ? null : (DateTime?)rdr.GetDateTime(8),
                        AssigneeId = rdr.IsDBNull(9) ? null : rdr.GetGuid(9).ToString(),
                        AssigneeIds = rdr.IsDBNull(9) ? new List<string>() : new List<string> { rdr.GetGuid(9).ToString() },
                        AssignedToNames = rdr.IsDBNull(10) ? new List<string>() : new List<string> { rdr.GetString(10) },
                        AssignedPhones = rdr.IsDBNull(11) ? new List<string>() : new List<string> { rdr.GetString(11) },
                        ParentTaskId = rdr.IsDBNull(12) ? null : rdr.GetInt64(12),
                        TaskType = rdr.IsDBNull(13) ? "general" : rdr.GetString(13),
                        ProcessStage = rdr.IsDBNull(14) ? "intake" : rdr.GetString(14),
                        FollowUpDate = rdr.IsDBNull(15) ? null : rdr.GetDateTime(15),
                        FollowUpNotes = rdr.IsDBNull(16) ? null : rdr.GetString(16),
                        Recurring = rdr.IsDBNull(17) ? "none" : rdr.GetString(17),
                        EventRef = rdr.IsDBNull(18) ? null : rdr.GetString(18),
                        IsAutoGen = !rdr.IsDBNull(19) && rdr.GetBoolean(19),
                        CreatedById = rdr.IsDBNull(20) ? null : rdr.GetGuid(20),
                        OwnerPositionId = rdr.IsDBNull(21) ? null : rdr.GetInt64(21),
                        ParentViewerPositionId = rdr.IsDBNull(22) ? null : rdr.GetInt64(22),
                        Assignees = new List<TaskAssigneeDto>()
                    };
                    list.Add(dto);
                }
                rdr.Close();

                const string assignmentsSql = @"
SELECT a.""TaskId"", a.""AssigneeType"", a.""AssigneeId"",
       COALESCE(u.displayname, tm.""Name"", a.""AssigneeId"") AS name,
       u.email,
       CASE WHEN a.""AssigneeType"" = 'team' THEN
           (SELECT count(*)::int FROM public.teammembers member WHERE member.teamid = tm.""Id"")
       ELSE NULL END AS member_count
FROM public.""TaskAssignmentsV2"" a
JOIN public.""Tasks"" task ON task.""Id"" = a.""TaskId"" AND task.""TenantId"" = @tenantId
LEFT JOIN public.users u ON a.""AssigneeType"" = 'user' AND u.id::text = a.""AssigneeId"" AND u.tenant_id = @tenantId
LEFT JOIN public.""Teams"" tm ON a.""AssigneeType"" = 'team' AND tm.""Id""::text = a.""AssigneeId"" AND tm.""TenantId"" = @tenantId
ORDER BY a.""TaskId"", a.""AssigneeType"", name;";
                using var assignmentCmd = new NpgsqlCommand(assignmentsSql, conn);
                assignmentCmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenant.Id);
                using var assignmentReader = assignmentCmd.ExecuteReader();
                var byId = list.Where(task => task.Id.HasValue).ToDictionary(task => task.Id!.Value);
                while (assignmentReader.Read())
                {
                    if (!byId.TryGetValue(assignmentReader.GetInt64(0), out var task)) continue;
                    var assignment = new TaskAssigneeDto
                    {
                        Type = assignmentReader.GetString(1),
                        Id = assignmentReader.GetString(2),
                        Name = assignmentReader.IsDBNull(3) ? assignmentReader.GetString(2) : assignmentReader.GetString(3),
                        Email = assignmentReader.IsDBNull(4) ? null : assignmentReader.GetString(4),
                        MemberCount = assignmentReader.IsDBNull(5) ? null : assignmentReader.GetInt32(5)
                    };
                    task.Assignees!.Add(assignment);
                    task.AssigneeIds!.Add(assignment.Id!);
                    task.AssignedToNames!.Add(assignment.Name ?? assignment.Id!);
                }
                assignmentReader.Close();

                var currentUserTeamIds = await LoadUserTeamIdsAsync(conn, visibility.UserId);
                foreach (var task in list)
                {
                    var assigned = task.Assignees!.Any(item =>
                        (item.Type == "user" && item.Id == visibility.UserId.ToString())
                        || (item.Type == "team" && currentUserTeamIds.Contains(item.Id ?? string.Empty)));
                    var creator = task.CreatedById.HasValue && task.CreatedById.Value == visibility.UserId;
                    var parentViewer = visibility.PositionId.HasValue && task.ParentViewerPositionId == visibility.PositionId;
                    task.CanUpdate = isAdmin || assigned || creator;
                    task.CanReassign = isAdmin || assigned || creator;
                    task.CanDelete = isAdmin || creator;
                    task.ReadOnly = !task.CanUpdate;
                    task.VisibilityReason = creator ? "creator" : parentViewer ? "parent-position-readonly" : assigned ? "assigned" : isAdmin ? "admin" : "not-visible";
                }
                list = list.Where(task => isAdmin || task.CanUpdate || task.CanReassign
                    || task.VisibilityReason == "parent-position-readonly").ToList();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error reading tasks");
                return StatusCode(500, "Database error");
            }

            return Ok(list);
        }

        // GET /api/tasks/{id}
        [HttpGet("{id:long}")]
        public async Task<IActionResult> GetById(long id)
        {
            var sql = @"
SELECT t.""Id"", t.""Title"", t.""Description"", t.""TeamId"", t.""Status"", t.""Priority"", t.""DueDate"", t.""CreatedAt"", t.""UpdatedAt"",
       t.""ParentTaskId"", t.""TaskType"", t.""ProcessStage"", t.""FollowUpDate"", t.""FollowUpNotes"", t.""Recurring"", t.""EventRef"", t.""IsAutoGen""
FROM public.""Tasks"" t
WHERE t.""Id"" = @id AND t.""TenantId"" = @tenantId;";

            var assigneesSql = @"
SELECT t.""AssigneeId""::text AS uid, u.displayname AS name, u.phone AS phone
FROM public.""Tasks"" t
LEFT JOIN public.users u ON u.id = t.""AssigneeId""
WHERE t.""Id"" = @id AND t.""AssigneeId"" IS NOT NULL;";

            try
            {
                var tenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
                if (tenant == null) return BadRequest("Tenant context could not be resolved.");
                await using var conn = new NpgsqlConnection(_connStr);
                await conn.OpenAsync();
                await EnsureTaskSchemaAsync(conn);

                await using var cmd = new NpgsqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("id", NpgsqlDbType.Bigint, id);
                cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenant.Id);
                await using var rdr = await cmd.ExecuteReaderAsync();
                if (!await rdr.ReadAsync()) return NotFound();

                var dto = new TaskDto
                {
                    Id = rdr.IsDBNull(0) ? null : (long?)rdr.GetInt64(0),
                    Title = rdr.IsDBNull(1) ? null : rdr.GetString(1),
                    Description = rdr.IsDBNull(2) ? null : rdr.GetString(2),
                    TeamId = rdr.IsDBNull(3) ? null : (long?)rdr.GetInt64(3),
                    Status = rdr.IsDBNull(4) ? null : (int?)rdr.GetInt32(4),
                    Priority = rdr.IsDBNull(5) ? null : (int?)rdr.GetInt32(5),
                    DueDate = rdr.IsDBNull(6) ? null : (DateTime?)rdr.GetDateTime(6),
                    CreatedAt = rdr.IsDBNull(7) ? null : (DateTime?)rdr.GetDateTime(7),
                    UpdatedAt = rdr.IsDBNull(8) ? null : (DateTime?)rdr.GetDateTime(8),
                    ParentTaskId = rdr.IsDBNull(9) ? null : rdr.GetInt64(9),
                    TaskType = rdr.IsDBNull(10) ? "general" : rdr.GetString(10),
                    ProcessStage = rdr.IsDBNull(11) ? "intake" : rdr.GetString(11),
                    FollowUpDate = rdr.IsDBNull(12) ? null : rdr.GetDateTime(12),
                    FollowUpNotes = rdr.IsDBNull(13) ? null : rdr.GetString(13),
                    Recurring = rdr.IsDBNull(14) ? "none" : rdr.GetString(14),
                    EventRef = rdr.IsDBNull(15) ? null : rdr.GetString(15),
                    IsAutoGen = !rdr.IsDBNull(16) && rdr.GetBoolean(16),
                    Assignees = new List<TaskAssigneeDto>()
                };

                await rdr.CloseAsync();

                // load assignees
                await using var aCmd = new NpgsqlCommand(assigneesSql, conn);
                aCmd.Parameters.AddWithValue("id", NpgsqlDbType.Bigint, id);
                await using var aRdr = await aCmd.ExecuteReaderAsync();
                var ids = new List<string>();
                var names = new List<string>();
                var phones = new List<string>();
                while (await aRdr.ReadAsync())
                {
                    ids.Add(aRdr["uid"]?.ToString() ?? string.Empty);
                    names.Add(aRdr["name"]?.ToString() ?? string.Empty);
                    phones.Add(aRdr["phone"]?.ToString() ?? string.Empty);
                }
                dto.AssigneeIds = ids;
                dto.AssignedToNames = names;
                dto.AssignedPhones = phones;

                await aRdr.CloseAsync();
                const string v2Sql = @"
SELECT ""AssigneeType"", ""AssigneeId""
FROM public.""TaskAssignmentsV2""
WHERE ""TaskId"" = @id
ORDER BY ""AssigneeType"", ""AssigneeId"";";
                await using var v2Cmd = new NpgsqlCommand(v2Sql, conn);
                v2Cmd.Parameters.AddWithValue("id", NpgsqlDbType.Bigint, id);
                await using var v2Reader = await v2Cmd.ExecuteReaderAsync();
                while (await v2Reader.ReadAsync())
                    dto.Assignees.Add(new TaskAssigneeDto { Type = v2Reader.GetString(0), Id = v2Reader.GetString(1) });

                return Ok(dto);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error reading task {TaskId}", id);
                return StatusCode(500, "Database error");
            }
        }

        // GET /api/tasks/eligible-assignees
        // Staff may only assign manual tasks to users in their active position.
        [HttpGet("eligible-assignees")]
        public async Task<IActionResult> GetEligibleAssignees()
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
            if (tenant == null) return BadRequest("Tenant context could not be resolved.");

            await using var conn = new NpgsqlConnection(_connStr);
            await conn.OpenAsync();
            var visibility = await PositionVisibilityService.ResolveAsync(HttpContext, conn);
            if (!visibility.PositionId.HasValue) return Ok(Array.Empty<object>());

            const string sql = @"
SELECT DISTINCT u.id,
       COALESCE(NULLIF(u.displayname, ''), NULLIF(u.username, ''), NULLIF(u.email, ''), u.id::text) AS display_name,
       u.email
FROM public.user_positions up
JOIN public.users u ON u.id = up.user_id
WHERE up.position_id = @positionId AND u.tenant_id = @tenantId
  AND (NOT @membersOnly OR lower(coalesce(u.role::text, '')) IN ('2', 'member'))
ORDER BY display_name;";
            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("positionId", NpgsqlDbType.Bigint, visibility.PositionId.Value);
            cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenant.Id);
            cmd.Parameters.AddWithValue("membersOnly", NpgsqlDbType.Boolean, IsMemberUser());
            await using var reader = await cmd.ExecuteReaderAsync();
            var users = new List<object>();
            while (await reader.ReadAsync())
            {
                users.Add(new
                {
                    id = reader.GetGuid(0),
                    displayName = reader.GetString(1),
                    email = reader.IsDBNull(2) ? null : reader.GetString(2),
                    type = "user"
                });
            }
            return Ok(users);
        }

        // POST /api/tasks (create). Staff can create manual tasks only; task
        // automation and templates remain restricted to Root/Tenant Admins.
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] TaskDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            if (dto == null) return BadRequest("Empty payload");
            var tenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
            if (tenant == null) return BadRequest("Tenant context could not be resolved.");
            var canManageAutomation = IsAdminUser();
            var isStaff = IsStaffUser();
            if (!canManageAutomation && !isStaff)
                return StatusCode(403, new { message = "Members cannot create tasks. Tasks must be assigned by Staff, a Tenant Admin, or a Root Admin." });

            var insertSql = @"
INSERT INTO public.""Tasks"" 
    (""TenantId"", ""Title"", ""Description"", ""AssigneeId"", ""TeamId"", ""Status"", ""Priority"", ""DueDate"",
     ""ParentTaskId"", ""TaskType"", ""ProcessStage"", ""FollowUpDate"", ""FollowUpNotes"", ""Recurring"", ""EventRef"", ""IsAutoGen"",
     ""CreatedById"", ""OwnerPositionId"", ""ParentViewerPositionId"",
     ""CreatedAt"", ""UpdatedAt"")
VALUES (@tenantId, @title, @desc, @assignee, @team, @status, @priority, @duedate,
        @parentTaskId, @taskType, @processStage, @followUpDate, @followUpNotes, @recurring, @eventRef, @isAutoGen,
        @createdById, @ownerPositionId, @parentViewerPositionId,
        now(), now())
RETURNING ""Id"";";

            try
            {
                await using var conn = new NpgsqlConnection(_connStr);
                await conn.OpenAsync();
                await EnsureTaskSchemaAsync(conn);
                var visibility = await PositionVisibilityService.ResolveAsync(HttpContext, conn);

                if (!canManageAutomation)
                {
                    if (visibility.UserId == Guid.Empty || !visibility.PositionId.HasValue)
                        return BadRequest(new { message = "Select an active position before creating a task." });

                    if (dto.IsAutoGen == true || !string.IsNullOrWhiteSpace(dto.EventRef)
                        || (!string.IsNullOrWhiteSpace(dto.Recurring)
                            && !string.Equals(dto.Recurring, "none", StringComparison.OrdinalIgnoreCase)))
                        return BadRequest(new { message = "Staff can create simple tasks only. Automation, templates, and recurrence require a Tenant Admin or Root Admin." });

                    dto.Recurring = "none";
                    dto.EventRef = null;
                    dto.IsAutoGen = false;
                    dto.TeamId = null;
                }

                // Every manually created task starts with its creator as owner
                // and sole assignee. Reassignment is a separate, auditable step.
                // Admin-generated automation retains its designed assignments.
                if (dto.IsAutoGen != true)
                {
                    if (visibility.UserId == Guid.Empty)
                        return BadRequest(new { message = "The signed-in user could not be resolved." });
                    dto.TeamId = null;
                    dto.Assignees = new List<TaskAssigneeDto>
                    {
                        new TaskAssigneeDto { Type = "user", Id = visibility.UserId.ToString() }
                    };
                }
                else if (dto.Assignees?.Count > 0
                    && !await AllTargetsBelongToTenantAsync(conn, null, dto.Assignees, tenant.Id))
                {
                    return BadRequest(new { message = "Administrators may assign tasks only to users or teams within this tenant." });
                }

                var assigneeId = ResolvePrimaryAssignee(dto);
                var parentPositionId = await LoadParentPositionIdAsync(conn, null, visibility.PositionId);
                await using var tx = await conn.BeginTransactionAsync();

                // create task
                await using var cmd = new NpgsqlCommand(insertSql, conn, tx);
                cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenant.Id);
                cmd.Parameters.AddWithValue("title", (object?)dto.Title ?? DBNull.Value);
                cmd.Parameters.AddWithValue("desc", (object?)dto.Description ?? DBNull.Value);
                cmd.Parameters.AddWithValue("assignee", assigneeId.HasValue ? assigneeId.Value : DBNull.Value);
                cmd.Parameters.AddWithValue("team", dto.TeamId.HasValue ? (object)dto.TeamId.Value : DBNull.Value);
                cmd.Parameters.AddWithValue("status", dto.Status.HasValue ? (object)dto.Status.Value : DBNull.Value);
                cmd.Parameters.AddWithValue("priority", dto.Priority.HasValue ? (object)dto.Priority.Value : DBNull.Value);
                cmd.Parameters.AddWithValue("duedate", dto.DueDate.HasValue ? (object)dto.DueDate.Value : DBNull.Value);
                AddWorkflowParameters(cmd, dto);
                cmd.Parameters.AddWithValue("createdById", NpgsqlDbType.Uuid, visibility.UserId == Guid.Empty ? DBNull.Value : visibility.UserId);
                cmd.Parameters.AddWithValue("ownerPositionId", NpgsqlDbType.Bigint, visibility.PositionId.HasValue ? visibility.PositionId.Value : DBNull.Value);
                cmd.Parameters.AddWithValue("parentViewerPositionId", NpgsqlDbType.Bigint, parentPositionId.HasValue ? parentPositionId.Value : DBNull.Value);

                var newIdObj = await cmd.ExecuteScalarAsync();
                if (newIdObj == null) { await tx.RollbackAsync(); return StatusCode(500, "Failed to create task"); }
                var newId = Convert.ToInt64(newIdObj);
                await ReplaceAssignmentsAsync(conn, tx, newId, dto.Assignees);
                await ScheduleTaskNotificationsAsync(conn, tx, newId, dto.Title, dto.DueDate, true);

                await tx.CommitAsync();
                return CreatedAtAction(nameof(GetById), new { id = newId }, new { Id = newId });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating task");
                return StatusCode(500, "Database error");
            }
        }

        // PUT /api/tasks/{id} (update) — supports replacing assignees
        [HttpPut("{id:long}")]
        public async Task<IActionResult> Update(long id, [FromBody] TaskDto dto)
        {
            if (!ModelState.IsValid) return BadRequest(ModelState);
            if (dto == null) return BadRequest("Empty payload");
            var tenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
            if (tenant == null) return BadRequest("Tenant context could not be resolved.");
            var assigneeId = ResolvePrimaryAssignee(dto);

            var updateSql = @"
UPDATE public.""Tasks"" SET
    ""Title"" = CASE WHEN @canManageAutomation OR NOT ""IsAutoGen"" THEN @title ELSE ""Title"" END,
    ""Description"" = CASE WHEN @canManageAutomation OR NOT ""IsAutoGen"" THEN @desc ELSE ""Description"" END,
    ""AssigneeId"" = @assignee,
    ""TeamId"" = @team,
    ""Status"" = @status,
    ""Priority"" = CASE WHEN @canManageAutomation OR NOT ""IsAutoGen"" THEN @priority ELSE ""Priority"" END,
    ""DueDate"" = CASE WHEN @canManageAutomation OR NOT ""IsAutoGen"" THEN @duedate ELSE ""DueDate"" END,
    ""ParentTaskId"" = CASE WHEN @canManageAutomation OR NOT ""IsAutoGen"" THEN @parentTaskId ELSE ""ParentTaskId"" END,
    ""TaskType"" = CASE WHEN @canManageAutomation OR NOT ""IsAutoGen"" THEN @taskType ELSE ""TaskType"" END,
    ""ProcessStage"" = @processStage,
    ""FollowUpDate"" = CASE WHEN @canManageAutomation OR NOT ""IsAutoGen"" THEN @followUpDate ELSE ""FollowUpDate"" END,
    ""FollowUpNotes"" = CASE WHEN @canManageAutomation OR NOT ""IsAutoGen"" THEN @followUpNotes ELSE ""FollowUpNotes"" END,
    ""Recurring"" = CASE WHEN @canManageAutomation THEN @recurring ELSE ""Recurring"" END,
    ""EventRef"" = CASE WHEN @canManageAutomation THEN @eventRef ELSE ""EventRef"" END,
    ""IsAutoGen"" = CASE WHEN @canManageAutomation THEN @isAutoGen ELSE ""IsAutoGen"" END,
    ""UpdatedAt"" = now()
WHERE ""Id"" = @id AND ""TenantId"" = @tenantId;";

            try
            {
                await using var conn = new NpgsqlConnection(_connStr);
                await conn.OpenAsync();
                await EnsureTaskSchemaAsync(conn);
                var visibility = await PositionVisibilityService.ResolveAsync(HttpContext, conn);
                var canManageAutomation = IsAdminUser();
                var ownership = await LoadTaskOwnershipAsync(conn, null, id, tenant.Id, visibility.UserId);
                if (!ownership.Exists) return NotFound();
                var assigned = await IsAssignedUserAsync(conn, null, id, tenant.Id, visibility.UserId);
                if (!canManageAutomation && !assigned && !ownership.IsCreator)
                    return Forbid();
                var assignmentsChanged = await AssignmentsChangedAsync(conn, null, id, dto.Assignees);
                if (!canManageAutomation && assignmentsChanged)
                {
                    if (!assigned && !ownership.IsCreator) return StatusCode(403, new { message = "Only an assignee, the task creator, or a Tenant/Root Admin can reassign this task." });
                    if (!visibility.PositionId.HasValue)
                        return BadRequest(new { message = "Select an active position before reassigning this task." });
                    if (!await AllTargetsBelongToPositionAsync(conn, null, dto.Assignees, visibility.PositionId))
                        return BadRequest(new { message = "Staff and Members may reassign tasks only to users in their active position." });
                }
                else if (canManageAutomation && assignmentsChanged
                    && !await AllTargetsBelongToTenantAsync(conn, null, dto.Assignees, tenant.Id))
                    return BadRequest(new { message = "Administrators may assign tasks only to users or teams within this tenant." });
                await using var tx = await conn.BeginTransactionAsync();

                await using var cmd = new NpgsqlCommand(updateSql, conn, tx);
                cmd.Parameters.AddWithValue("title", (object?)dto.Title ?? DBNull.Value);
                cmd.Parameters.AddWithValue("desc", (object?)dto.Description ?? DBNull.Value);
                cmd.Parameters.AddWithValue("assignee", assigneeId.HasValue ? assigneeId.Value : DBNull.Value);
                cmd.Parameters.AddWithValue("team", dto.TeamId.HasValue ? (object)dto.TeamId.Value : DBNull.Value);
                cmd.Parameters.AddWithValue("status", dto.Status.HasValue ? (object)dto.Status.Value : DBNull.Value);
                cmd.Parameters.AddWithValue("priority", dto.Priority.HasValue ? (object)dto.Priority.Value : DBNull.Value);
                cmd.Parameters.AddWithValue("duedate", dto.DueDate.HasValue ? (object)dto.DueDate.Value : DBNull.Value);
                cmd.Parameters.AddWithValue("id", NpgsqlDbType.Bigint, id);
                cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenant.Id);
                cmd.Parameters.AddWithValue("canManageAutomation", NpgsqlDbType.Boolean, canManageAutomation);
                AddWorkflowParameters(cmd, dto);

                var rows = await cmd.ExecuteNonQueryAsync();
                if (rows == 0) { await tx.RollbackAsync(); return NotFound(); }
                await ReplaceAssignmentsAsync(conn, tx, id, dto.Assignees);
                await ScheduleTaskNotificationsAsync(conn, tx, id,
                    canManageAutomation ? dto.Title : null,
                    canManageAutomation ? dto.DueDate : null,
                    assignmentsChanged);

                await tx.CommitAsync();
                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating task {TaskId}", id);
                return StatusCode(500, "Database error");
            }
        }

        // POST /api/tasks/{id}/reassign
        // Assigned Staff/Members and creators may reassign within their active position.
        // Root/Tenant Admins may reassign across all positions in their tenant.
        [HttpPost("{id:long}/reassign")]
        public async Task<IActionResult> Reassign(long id, [FromBody] List<TaskAssigneeDto> assignees)
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
            if (tenant == null) return BadRequest("Tenant context could not be resolved.");
            await using var conn = new NpgsqlConnection(_connStr);
            await conn.OpenAsync();
            await EnsureTaskSchemaAsync(conn);
            var visibility = await PositionVisibilityService.ResolveAsync(HttpContext, conn);
            var isAdmin = IsAdminUser();
            var ownership = await LoadTaskOwnershipAsync(conn, null, id, tenant.Id, visibility.UserId);
            if (!ownership.Exists) return NotFound();
            var assigned = await IsAssignedUserAsync(conn, null, id, tenant.Id, visibility.UserId);
            if (!isAdmin && !assigned && !ownership.IsCreator) return StatusCode(403, new { message = "Only an assignee, the task creator, or a Tenant/Root Admin can reassign this task." });
            if (!isAdmin && !visibility.PositionId.HasValue)
                return BadRequest(new { message = "Select an active position before reassigning this task." });
            if (!isAdmin && !await AllTargetsBelongToPositionAsync(conn, null, assignees, visibility.PositionId))
                return BadRequest(new { message = "Staff and Members may reassign tasks only to users in their active position." });
            if (isAdmin && !await AllTargetsBelongToTenantAsync(conn, null, assignees, tenant.Id))
                return BadRequest(new { message = "Administrators may assign tasks only to users or teams within this tenant." });

            await using var tx = await conn.BeginTransactionAsync();
            await ReplaceAssignmentsAsync(conn, tx, id, assignees);
            var primary = ResolvePrimaryAssignee(new TaskDto { Assignees = assignees });
            await using (var update = new NpgsqlCommand(@"
UPDATE public.""Tasks"" SET ""AssigneeId"" = @assignee, ""UpdatedAt"" = now()
WHERE ""Id"" = @id AND ""TenantId"" = @tenantId;", conn, tx))
            {
                update.Parameters.AddWithValue("assignee", NpgsqlDbType.Uuid, primary.HasValue ? primary.Value : DBNull.Value);
                update.Parameters.AddWithValue("id", NpgsqlDbType.Bigint, id);
                update.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenant.Id);
                if (await update.ExecuteNonQueryAsync() == 0) { await tx.RollbackAsync(); return NotFound(); }
            }
            await ScheduleTaskNotificationsAsync(conn, tx, id, null, null, true);
            await tx.CommitAsync();
            return Ok(new { message = "Task reassigned. The new assignee will be notified." });
        }

        // DELETE /api/tasks/flush?range=1d|7d|30d|all
        [HttpDelete("flush")]
        public async Task<IActionResult> FlushTasks([FromQuery] string range = "1d")
        {
            if (!IsAdminUser())
                return StatusCode(403, new { message = "Admin access is required to flush tasks." });

            var tenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
            if (tenant == null) return BadRequest("Tenant context could not be resolved.");

            var normalizedRange = (range ?? string.Empty).ToLowerInvariant();
            if (normalizedRange is not ("1d" or "7d" or "30d" or "all"))
                return BadRequest(new { message = "Range must be 1d, 7d, 30d, or all." });

            DateTime? cutoff = normalizedRange switch
            {
                "1d" => DateTime.UtcNow.AddDays(-1),
                "7d" => DateTime.UtcNow.AddDays(-7),
                "30d" => DateTime.UtcNow.AddDays(-30),
                _ => null
            };

            try
            {
                await using var conn = new NpgsqlConnection(_connStr);
                await conn.OpenAsync(HttpContext.RequestAborted);

                const string sql = @"
WITH matched AS (
    SELECT ""Id""
    FROM public.""Tasks""
    WHERE ""TenantId"" = @tenantId
      AND (@cutoff IS NULL OR ""CreatedAt"" >= @cutoff)
),
deleted AS (
    DELETE FROM public.""Tasks""
    WHERE ""Id"" IN (SELECT ""Id"" FROM matched)
    RETURNING ""Id""
)
SELECT count(*) FROM deleted;";
                await using var cmd = new NpgsqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenant.Id);
                cmd.Parameters.AddWithValue("cutoff", NpgsqlDbType.TimestampTz, cutoff.HasValue ? cutoff.Value : DBNull.Value);
                var deleted = Convert.ToInt32(await cmd.ExecuteScalarAsync(HttpContext.RequestAborted) ?? 0);
                return Ok(new { tasksDeleted = deleted, range });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to flush tasks for tenant {TenantId}", tenant.Id);
                return StatusCode(500, new { message = "Task flush failed.", detail = ex.Message });
            }
        }

        // DELETE /api/tasks/{id}
        [HttpDelete("{id:long}")]
        public async Task<IActionResult> DeleteTask(long id)
        {
            try
            {
                var tenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
                if (tenant == null) return BadRequest("Tenant context could not be resolved.");
                await using var conn = new NpgsqlConnection(_connStr);
                await conn.OpenAsync();
                await EnsureTaskSchemaAsync(conn);
                var visibility = await PositionVisibilityService.ResolveAsync(HttpContext, conn);
                var ownership = await LoadTaskOwnershipAsync(conn, null, id, tenant.Id, visibility.UserId);
                if (!ownership.Exists) return NotFound(new { message = $"Task with id {id} not found" });
                if (!IsAdminUser() && !ownership.IsCreator)
                    return StatusCode(403, new { message = "Only the task creator or a Tenant/Root Admin can delete this task." });

                var sql = @"DELETE FROM public.""Tasks"" WHERE ""Id"" = @id AND ""TenantId"" = @tenantId;";
                await using var cmd = new NpgsqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("id", NpgsqlDbType.Bigint, id);
                cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenant.Id);

                var rows = await cmd.ExecuteNonQueryAsync();
                if (rows == 0)
                    return NotFound(new { message = $"Task with id {id} not found" });

                return Ok(new { message = "Task deleted successfully" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to delete task {TaskId}", id);
                return StatusCode(500, "Error deleting task");
            }
        }

        // POST /api/tasks/{id}/send  — send notifications to all assignees
        [HttpPost("{id:long}/send")]
        public async Task<IActionResult> SendTask(long id)
        {
            try
            {
                await using var conn = new NpgsqlConnection(_connStr);
                await conn.OpenAsync();

                // load task title/description and recipients
                var sql = @"
SELECT t.""Title"", t.""Description"", u.email AS ""Email"", u.phone AS ""Phone"", u.displayname AS ""DisplayName""
FROM public.""Tasks"" t
JOIN public.users u ON u.id = t.""AssigneeId""
WHERE t.""Id"" = @id;";

                var recipients = new List<(string Phone, string Email, string Name)>();
                string? title = null;
                string? desc = null;
                await using (var cmd = new NpgsqlCommand(sql, conn))
                {
                    cmd.Parameters.AddWithValue("id", NpgsqlDbType.Bigint, id);
                    await using var rdr = await cmd.ExecuteReaderAsync();
                    while (await rdr.ReadAsync())
                    {
                        if (title == null) title = rdr["Title"]?.ToString();
                        if (desc == null) desc = rdr["Description"]?.ToString();

                        var email = rdr["Email"]?.ToString();
                        var phone = rdr["Phone"]?.ToString();
                        var name = rdr["DisplayName"]?.ToString();
                        recipients.Add((phone ?? "", email ?? "", name ?? ""));
                    }

                    if (recipients.Count == 0)
                        return BadRequest("No assignees found for this task.");
                }

                // build message body once
                var bodyBase = $"{title ?? ""}\n{desc ?? ""}";

                // Send notifications to each recipient (sequential here; you can parallelize if desired)
                var sendErrors = new List<string>();
                foreach (var r in recipients)
                {
                    try
                    {
                        var personalized = $"Task assigned: {r.Name}\n{bodyBase}";
                        if (!string.IsNullOrWhiteSpace(r.Phone))
                        {
                            await SmsHelper.SendSmsAsync(r.Phone, personalized, _logger);
                            await SmsHelper.SendWhatsappAsync(r.Phone, personalized, _logger);
                        }
                        if (!string.IsNullOrWhiteSpace(r.Email))
                        {
                            _logger.LogInformation("Would send EMAIL to {Email} for task {TaskId}", r.Email, id);
                            // integrate real email provider here if available
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Failed to send to recipient {Phone}/{Email}", r.Phone, r.Email);
                        sendErrors.Add($"Failed to notify {r.Phone ?? r.Email}: {ex.Message}");
                    }
                }

                // Update task status to In-Progress (best-effort)
                var updateSql = @"UPDATE public.""Tasks"" SET ""Status"" = 1, ""UpdatedAt"" = now() WHERE ""Id"" = @id;";
                await using (var ucmd = new NpgsqlCommand(updateSql, conn)) { ucmd.Parameters.AddWithValue("id", NpgsqlDbType.Bigint, id); await ucmd.ExecuteNonQueryAsync(); }

                if (sendErrors.Any())
                    return StatusCode(207, new { message = "Some notifications failed", errors = sendErrors });

                return Ok(new { message = "Notification(s) sent", status = "In-Progress", recipients = recipients.Count });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send notifications for task {TaskId}", id);
                return StatusCode(500, "Error sending notification");
            }
        }

        // helper to fetch title + description succinctly (for message)
        private static async Task<string> GetTaskTitleDescription(NpgsqlConnection conn, long id)
        {
            var sql = @"SELECT coalesce(""Title"",'') || ' - ' || coalesce(""Description"",'') FROM public.""Tasks"" WHERE ""Id"" = @id;";
            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("id", NpgsqlDbType.Bigint, id);
            var obj = await cmd.ExecuteScalarAsync();
            return obj?.ToString() ?? "";
        }

        private static Guid? ResolvePrimaryAssignee(TaskDto dto)
        {
            var value = dto.Assignees?
                            .FirstOrDefault(item => string.Equals(item.Type, "user", StringComparison.OrdinalIgnoreCase))?.Id
                        ?? dto.AssigneeIds?.FirstOrDefault(id => !string.IsNullOrWhiteSpace(id))
                        ?? dto.AssigneeId;
            return Guid.TryParse(value, out var id) ? id : null;
        }

        private static void AddWorkflowParameters(NpgsqlCommand cmd, TaskDto dto)
        {
            cmd.Parameters.AddWithValue("parentTaskId", dto.ParentTaskId.HasValue ? dto.ParentTaskId.Value : DBNull.Value);
            cmd.Parameters.AddWithValue("taskType", NpgsqlDbType.Text, string.IsNullOrWhiteSpace(dto.TaskType) ? "general" : dto.TaskType.Trim().ToLowerInvariant());
            cmd.Parameters.AddWithValue("processStage", NpgsqlDbType.Text, string.IsNullOrWhiteSpace(dto.ProcessStage) ? "intake" : dto.ProcessStage.Trim().ToLowerInvariant());
            cmd.Parameters.AddWithValue("followUpDate", dto.FollowUpDate.HasValue ? dto.FollowUpDate.Value : DBNull.Value);
            cmd.Parameters.AddWithValue("followUpNotes", string.IsNullOrWhiteSpace(dto.FollowUpNotes) ? DBNull.Value : dto.FollowUpNotes.Trim());
            cmd.Parameters.AddWithValue("recurring", NpgsqlDbType.Text, string.IsNullOrWhiteSpace(dto.Recurring) ? "none" : dto.Recurring.Trim().ToLowerInvariant());
            cmd.Parameters.AddWithValue("eventRef", string.IsNullOrWhiteSpace(dto.EventRef) ? DBNull.Value : dto.EventRef.Trim());
            cmd.Parameters.AddWithValue("isAutoGen", NpgsqlDbType.Boolean, dto.IsAutoGen ?? false);
        }

        private static async Task ReplaceAssignmentsAsync(
            NpgsqlConnection conn,
            NpgsqlTransaction tx,
            long taskId,
            IEnumerable<TaskAssigneeDto>? assignments)
        {
            await using (var delete = new NpgsqlCommand(
                             @"DELETE FROM public.""TaskAssignmentsV2"" WHERE ""TaskId"" = @taskId;", conn, tx))
            {
                delete.Parameters.AddWithValue("taskId", NpgsqlDbType.Bigint, taskId);
                await delete.ExecuteNonQueryAsync();
            }

            var normalized = (assignments ?? Array.Empty<TaskAssigneeDto>())
                .Select(item => new
                {
                    Type = (item.Type ?? string.Empty).Trim().ToLowerInvariant(),
                    Id = (item.Id ?? string.Empty).Trim()
                })
                .Where(item => (item.Type is "user" or "team") && !string.IsNullOrWhiteSpace(item.Id))
                .Distinct()
                .ToList();

            foreach (var assignment in normalized)
            {
                await using var insert = new NpgsqlCommand(@"
INSERT INTO public.""TaskAssignmentsV2"" (""TaskId"", ""AssigneeType"", ""AssigneeId"")
VALUES (@taskId, @type, @id)
ON CONFLICT DO NOTHING;", conn, tx);
                insert.Parameters.AddWithValue("taskId", NpgsqlDbType.Bigint, taskId);
                insert.Parameters.AddWithValue("type", NpgsqlDbType.Text, assignment.Type);
                insert.Parameters.AddWithValue("id", NpgsqlDbType.Text, assignment.Id);
                await insert.ExecuteNonQueryAsync();
            }
        }

        private bool IsAdminUser()
        {
            var values = User.FindAll(ClaimTypes.Role).Select(claim => claim.Value)
                .Concat(User.FindAll("role").Select(claim => claim.Value));
            var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "admin", "administrator", "rootadmin", "root_admin",
                "tenantadmin", "tenant_admin", "superadmin", "super_admin",
                "platformadmin", "platform_admin"
            };
            return values.Any(value => allowed.Contains(value.Trim()));
        }

        private bool IsStaffUser()
        {
            var values = User.FindAll(ClaimTypes.Role).Select(claim => claim.Value)
                .Concat(User.FindAll("role").Select(claim => claim.Value));
            return values.Any(value => string.Equals(value.Trim(), "staff", StringComparison.OrdinalIgnoreCase));
        }

        private bool IsMemberUser()
        {
            var values = User.FindAll(ClaimTypes.Role).Select(claim => claim.Value)
                .Concat(User.FindAll("role").Select(claim => claim.Value));
            return values.Any(value => string.Equals(value.Trim(), "member", StringComparison.OrdinalIgnoreCase));
        }

        private static async Task<long?> LoadParentPositionIdAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, long? positionId)
        {
            if (!positionId.HasValue) return null;
            await using var cmd = new NpgsqlCommand("SELECT parent_position_id FROM public.positions WHERE id = @id;", conn, tx);
            cmd.Parameters.AddWithValue("id", NpgsqlDbType.Bigint, positionId.Value);
            var value = await cmd.ExecuteScalarAsync();
            return value == null || value == DBNull.Value ? null : Convert.ToInt64(value);
        }

        private static async Task<HashSet<string>> LoadUserTeamIdsAsync(NpgsqlConnection conn, Guid userId)
        {
            var result = new HashSet<string>();
            if (userId == Guid.Empty) return result;
            await using var cmd = new NpgsqlCommand("SELECT teamid::text FROM public.teammembers WHERE userid = @userId;", conn);
            cmd.Parameters.AddWithValue("userId", NpgsqlDbType.Uuid, userId);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync()) result.Add(reader.GetString(0));
            return result;
        }

        private static async Task<bool> IsAssignedUserAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, long taskId, Guid tenantId, Guid userId)
        {
            if (userId == Guid.Empty) return false;
            await using var cmd = new NpgsqlCommand(@"
SELECT EXISTS (
    SELECT 1 FROM public.""TaskAssignmentsV2"" a
    JOIN public.""Tasks"" t ON t.""Id"" = a.""TaskId""
    WHERE a.""TaskId"" = @taskId AND t.""TenantId"" = @tenantId
      AND a.""AssigneeType"" = 'user' AND a.""AssigneeId"" = @userId
    UNION ALL
    SELECT 1 FROM public.""TaskAssignmentsV2"" a
    JOIN public.""Tasks"" t ON t.""Id"" = a.""TaskId""
    JOIN public.teammembers tm ON a.""AssigneeType"" = 'team' AND tm.teamid::text = a.""AssigneeId""
    WHERE a.""TaskId"" = @taskId AND t.""TenantId"" = @tenantId AND tm.userid = @userUuid
);", conn, tx);
            cmd.Parameters.AddWithValue("taskId", NpgsqlDbType.Bigint, taskId);
            cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenantId);
            cmd.Parameters.AddWithValue("userId", NpgsqlDbType.Text, userId.ToString());
            cmd.Parameters.AddWithValue("userUuid", NpgsqlDbType.Uuid, userId);
            return Convert.ToBoolean(await cmd.ExecuteScalarAsync());
        }

        private static async Task<(bool Exists, bool IsCreator, long? OwnerPositionId)> LoadTaskOwnershipAsync(
            NpgsqlConnection conn, NpgsqlTransaction? tx, long taskId, Guid tenantId, Guid userId)
        {
            await using var cmd = new NpgsqlCommand(@"
SELECT ""CreatedById"", ""OwnerPositionId""
FROM public.""Tasks""
WHERE ""Id"" = @taskId AND ""TenantId"" = @tenantId;", conn, tx);
            cmd.Parameters.AddWithValue("taskId", NpgsqlDbType.Bigint, taskId);
            cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenantId);
            await using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync()) return (false, false, null);
            var createdBy = reader.IsDBNull(0) ? (Guid?)null : reader.GetGuid(0);
            var ownerPositionId = reader.IsDBNull(1) ? (long?)null : reader.GetInt64(1);
            return (true, createdBy.HasValue && createdBy.Value == userId, ownerPositionId);
        }

        private static async Task<bool> IsParentPositionViewerAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, long taskId, Guid tenantId, long? positionId)
        {
            if (!positionId.HasValue) return false;
            await using var cmd = new NpgsqlCommand(@"
SELECT EXISTS (
    SELECT 1 FROM public.""Tasks""
    WHERE ""Id"" = @taskId AND ""TenantId"" = @tenantId AND ""ParentViewerPositionId"" = @positionId
);", conn, tx);
            cmd.Parameters.AddWithValue("taskId", NpgsqlDbType.Bigint, taskId);
            cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenantId);
            cmd.Parameters.AddWithValue("positionId", NpgsqlDbType.Bigint, positionId.Value);
            return Convert.ToBoolean(await cmd.ExecuteScalarAsync());
        }

        private static async Task<bool> AllTargetsBelongToPositionAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, IEnumerable<TaskAssigneeDto>? assignees, long? positionId)
        {
            if (!positionId.HasValue) return false;
            var targets = (assignees ?? Array.Empty<TaskAssigneeDto>()).ToList();
            if (targets.Count == 0 || targets.Any(item => !string.Equals(item.Type, "user", StringComparison.OrdinalIgnoreCase))) return false;
            var ids = targets.Select(item => Guid.TryParse(item.Id, out var id) ? id : Guid.Empty).Where(id => id != Guid.Empty).Distinct().ToArray();
            if (ids.Length != targets.Count) return false;
            await using var cmd = new NpgsqlCommand(@"
SELECT count(DISTINCT user_id)
FROM public.user_positions
WHERE position_id = @positionId AND user_id = ANY(@ids);", conn, tx);
            cmd.Parameters.AddWithValue("positionId", NpgsqlDbType.Bigint, positionId.Value);
            cmd.Parameters.AddWithValue("ids", NpgsqlDbType.Array | NpgsqlDbType.Uuid, ids);
            return Convert.ToInt32(await cmd.ExecuteScalarAsync()) == ids.Length;
        }

        private static async Task<bool> AllTargetsBelongToTenantAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, IEnumerable<TaskAssigneeDto>? assignees, Guid tenantId)
        {
            var targets = (assignees ?? Array.Empty<TaskAssigneeDto>())
                .Select(item => new { Type = item.Type?.Trim().ToLowerInvariant(), Id = item.Id?.Trim() })
                .Where(item => !string.IsNullOrWhiteSpace(item.Type) && !string.IsNullOrWhiteSpace(item.Id))
                .Distinct()
                .ToList();
            if (targets.Count == 0) return false;

            foreach (var target in targets)
            {
                if (target.Type == "user" && Guid.TryParse(target.Id, out var userId))
                {
                    await using var user = new NpgsqlCommand("SELECT EXISTS (SELECT 1 FROM public.users WHERE id = @id AND tenant_id = @tenantId);", conn, tx);
                    user.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, userId);
                    user.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenantId);
                    if (!Convert.ToBoolean(await user.ExecuteScalarAsync())) return false;
                }
                else if (target.Type == "team" && long.TryParse(target.Id, out var teamId))
                {
                    await using var team = new NpgsqlCommand(@"SELECT EXISTS (SELECT 1 FROM public.""Teams"" WHERE ""Id"" = @id AND ""TenantId"" = @tenantId);", conn, tx);
                    team.Parameters.AddWithValue("id", NpgsqlDbType.Bigint, teamId);
                    team.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenantId);
                    if (!Convert.ToBoolean(await team.ExecuteScalarAsync())) return false;
                }
                else return false;
            }
            return true;
        }

        private static async Task<bool> AssignmentsChangedAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, long taskId, IEnumerable<TaskAssigneeDto>? assignees)
        {
            var requested = (assignees ?? Array.Empty<TaskAssigneeDto>())
                .Select(item => $"{item.Type?.Trim().ToLowerInvariant()}:{item.Id?.Trim()}")
                .Where(value => !value.EndsWith(":"))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var current = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            await using var cmd = new NpgsqlCommand(@"SELECT ""AssigneeType"", ""AssigneeId"" FROM public.""TaskAssignmentsV2"" WHERE ""TaskId"" = @id;", conn, tx);
            cmd.Parameters.AddWithValue("id", NpgsqlDbType.Bigint, taskId);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync()) current.Add($"{reader.GetString(0)}:{reader.GetString(1)}");
            return !current.SetEquals(requested);
        }

        private static async Task ScheduleTaskNotificationsAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long taskId, string? title, DateTime? dueDate, bool assignmentChanged)
        {
            if (string.IsNullOrWhiteSpace(title) || !dueDate.HasValue)
            {
                await using var load = new NpgsqlCommand(@"SELECT ""Title"", ""DueDate"" FROM public.""Tasks"" WHERE ""Id"" = @id;", conn, tx);
                load.Parameters.AddWithValue("id", NpgsqlDbType.Bigint, taskId);
                await using var reader = await load.ExecuteReaderAsync();
                if (await reader.ReadAsync())
                {
                    title = reader.IsDBNull(0) ? "Task" : reader.GetString(0);
                    dueDate = reader.IsDBNull(1) ? null : reader.GetDateTime(1);
                }
            }

            await using (var clear = new NpgsqlCommand(@"
DELETE FROM public.""TaskAutomationQueue""
WHERE ""TaskId"" = @taskId AND ""Status"" = 'pending' AND ""AutomationKey"" LIKE 'due-reminder:%';", conn, tx))
            {
                clear.Parameters.AddWithValue("taskId", NpgsqlDbType.Bigint, taskId);
                await clear.ExecuteNonQueryAsync();
            }

            if (assignmentChanged)
                await InsertQueueAsync(conn, tx, taskId, $"assignment:{DateTime.UtcNow.Ticks}", DateTime.UtcNow,
                    $"You have been assigned a task: {title ?? "Task"}.");

            if (!dueDate.HasValue) return;
            var dueUtc = dueDate.Value.Kind == DateTimeKind.Utc ? dueDate.Value : dueDate.Value.ToUniversalTime();
            foreach (var days in new[] { 3, 2, 1 })
            {
                var scheduled = dueUtc.AddDays(-days);
                if (scheduled <= DateTime.UtcNow) continue;
                await InsertQueueAsync(conn, tx, taskId, $"due-reminder:{days}", scheduled,
                    $"Task reminder: {title ?? "Task"} is due in {days} day{(days == 1 ? "" : "s")}.");
            }
        }

        private static async Task InsertQueueAsync(NpgsqlConnection conn, NpgsqlTransaction tx, long taskId, string key, DateTime scheduledAt, string message)
        {
            await using var cmd = new NpgsqlCommand(@"
INSERT INTO public.""TaskAutomationQueue"" (""TaskId"", ""AutomationKey"", ""ScheduledAtUtc"", ""Message"")
VALUES (@taskId, @key, @scheduledAt, @message)
ON CONFLICT (""TaskId"", ""AutomationKey"") DO UPDATE
SET ""ScheduledAtUtc"" = EXCLUDED.""ScheduledAtUtc"", ""Message"" = EXCLUDED.""Message"",
    ""Status"" = 'pending', ""AttemptCount"" = 0, ""LastError"" = NULL, ""UpdatedAtUtc"" = now();", conn, tx);
            cmd.Parameters.AddWithValue("taskId", NpgsqlDbType.Bigint, taskId);
            cmd.Parameters.AddWithValue("key", NpgsqlDbType.Text, key);
            cmd.Parameters.AddWithValue("scheduledAt", NpgsqlDbType.TimestampTz, scheduledAt);
            cmd.Parameters.AddWithValue("message", NpgsqlDbType.Text, message);
            await cmd.ExecuteNonQueryAsync();
        }
    }
}
