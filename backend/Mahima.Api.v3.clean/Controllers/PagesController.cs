using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;
using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Microsoft.AspNetCore.Authorization.Authorize]
    public class PagesController : ControllerBase
    {
        private readonly string? _connectionString;
        private readonly ILogger<PagesController> _logger;
        private readonly IHostEnvironment _env;

        public PagesController(IConfiguration configuration, ILogger<PagesController> logger, IHostEnvironment env)
        {
            _connectionString = configuration.GetConnectionString("DefaultConnection");
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
            _env = env ?? throw new ArgumentNullException(nameof(env));
        }

        private static readonly Dictionary<string, string> PageModules = new(StringComparer.OrdinalIgnoreCase)
        {
            ["CHAT"] = "chat",
            ["TASKS"] = "operations",
            ["ATTENDANCE"] = "operations",
            ["PAYROLL"] = "operations",
            ["COSTS"] = "operations",
            ["REPORTS"] = "operations",
            ["AUDIT_TRAIL"] = "operations",
            ["VOLUNTEERS"] = "operations",
            ["PASTOR"] = "care_ministry",
            ["README"] = "care_ministry",
            ["MARRIAGE"] = "care_ministry",
            ["BAPTISM"] = "care_ministry",
            ["COUNSELLING"] = "care_ministry",
            ["EVENTS"] = "care_ministry",
            ["CHECKIN"] = "care_ministry",
            ["SERVICE_PLANS"] = "care_ministry",
            ["ADMIN_DASHBOARD"] = "admin_tools",
            ["LIVE_USERS"] = "admin_tools",
            ["MULTITENANT"] = "admin_tools",
            ["LANGUAGES"] = "admin_tools",
            ["QA_AUTOMATION"] = "admin_tools",
            ["APP_DOWNLOADS"] = "base",
            ["MESSAGE_CENTER"] = "communications",
            ["EMAIL_CLIENT"] = "communications",
            ["GOOGLE_DRIVE"] = "communications",
            ["SERVER_FILES"] = "communications"
        };

        private static readonly string[] BasePageKeys =
        {
            "DASHBOARD", "LANDING_PAGE", "USERS", "PRAYER_REQUESTS", "SERMONS", "TEAMS", "ROLES", "PAGES", "APP_DOWNLOADS", "SECURITY"
        };

        private Guid GetCurrentTenantId() =>
            Guid.TryParse(User.FindFirstValue("tenant_id"), out var id)
                ? id
                : Guid.Parse("00000000-0000-0000-0000-000000000001");

        private static async Task<HashSet<string>> LoadLicensedPageKeysAsync(NpgsqlConnection conn, Guid tenantId)
        {
            var keys = new HashSet<string>(BasePageKeys, StringComparer.OrdinalIgnoreCase);
            if (tenantId == Guid.Parse("00000000-0000-0000-0000-000000000001"))
            {
                foreach (var key in PageModules.Keys) keys.Add(key);
                keys.Add("MULTITENANT");
                keys.Add("QA_AUTOMATION");
                return keys;
            }

            await using var cmd = new NpgsqlCommand(@"
SELECT m.code
FROM public.module_catalog m
WHERE m.enabled = true
  AND (
      m.is_base_module = true
      OR EXISTS (
          SELECT 1
          FROM public.tenant_module_licenses l
          WHERE l.tenant_id = @tenant_id
            AND (
                l.source NOT LIKE 'plan:%'
                OR NOT EXISTS (
                    SELECT 1
                    FROM public.tenant_subscriptions subscription
                    JOIN public.subscription_plan_publications publication
                      ON publication.plan_id = subscription.plan_id
                     AND publication.version = subscription.applied_plan_version
                    WHERE subscription.tenant_id = @tenant_id
                      AND publication.definition_json ? 'pages'
                      AND jsonb_array_length(publication.definition_json->'pages') > 0
                )
            )
            AND l.module_code = m.code
            AND l.status = 'active'
            AND (l.source NOT LIKE 'plan:%' OR EXISTS (
                SELECT 1 FROM public.subscription_plans p WHERE p.enabled AND p.lifecycle_status='published'
                AND l.source='plan:'||left(replace(p.id::text,'-',''),27)))
            AND l.starts_at_utc <= now()
            AND (l.ends_at_utc IS NULL OR l.ends_at_utc > now())
      )
  );", conn);
            cmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);

            await using var rdr = await cmd.ExecuteReaderAsync();
            var modules = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            while (await rdr.ReadAsync())
            {
                var code = rdr["code"]?.ToString();
                if (!string.IsNullOrWhiteSpace(code)) modules.Add(code);
            }
            await rdr.DisposeAsync();

            foreach (var pair in PageModules)
            {
                if (modules.Contains(pair.Value)) keys.Add(pair.Key);
            }

            await using var packagePages = new NpgsqlCommand(@"
SELECT DISTINCT page.value
FROM public.tenant_subscriptions subscription
JOIN public.subscription_plans plan ON plan.id=subscription.plan_id AND plan.enabled AND plan.lifecycle_status='published'
JOIN public.subscription_plan_publications publication
  ON publication.plan_id = subscription.plan_id
 AND publication.version = subscription.applied_plan_version
 AND publication.expired_at_utc IS NULL
CROSS JOIN LATERAL jsonb_array_elements_text(
  COALESCE(publication.definition_json->'pages', '[]'::jsonb)
) page(value)
WHERE subscription.tenant_id = @tenant_id
  AND subscription.status = 'active'
  AND subscription.starts_at_utc <= now()
  AND (subscription.ends_at_utc IS NULL OR subscription.ends_at_utc > now());", conn);
            packagePages.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
            await using var pageReader = await packagePages.ExecuteReaderAsync();
            while (await pageReader.ReadAsync())
            {
                var key = pageReader.GetString(0);
                if (!string.IsNullOrWhiteSpace(key)) keys.Add(key);
            }

            keys.Remove("MULTITENANT");
            keys.Remove("QA_AUTOMATION");
            keys.Remove("DIGITAL_MARKETING");
            return keys;
        }

        // GET api/pages
        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            if (string.IsNullOrWhiteSpace(_connectionString))
                return StatusCode(500, "Missing connection string 'DefaultConnection'.");

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureBuiltInPagesAsync(conn);
                var licensedKeys = await LoadLicensedPageKeysAsync(conn, GetCurrentTenantId());

                // Select by key (string), not numeric id — compatible with role_permissions.page_key
                var cmd = new NpgsqlCommand(@"SELECT key, title, description, created_at, updated_at FROM pages ORDER BY key;", conn);
                var items = new List<object>();
                await using var rdr = await cmd.ExecuteReaderAsync();
                while (await rdr.ReadAsync())
                {
                    var key = rdr["key"] is DBNull ? null : rdr["key"].ToString();
                    if (string.IsNullOrWhiteSpace(key) || !licensedKeys.Contains(key)) continue;

                    items.Add(new
                    {
                        key,
                        title = rdr["title"] is DBNull ? null : rdr["title"].ToString(),
                        description = rdr["description"] is DBNull ? null : rdr["description"].ToString(),
                        createdAt = rdr["created_at"] is DBNull ? null : rdr["created_at"].ToString(),
                        updatedAt = rdr["updated_at"] is DBNull ? null : rdr["updated_at"].ToString()
                    });
                }

                return Ok(new { items, total = items.Count });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving pages.");
                return _env.IsDevelopment() ? StatusCode(500, ex.ToString()) : StatusCode(500, "Error retrieving pages.");
            }
        }

        // GET api/pages/{key}
        [HttpGet("{key}")]
        public async Task<IActionResult> GetByKey(string key)
        {
            if (string.IsNullOrWhiteSpace(_connectionString))
                return StatusCode(500, "Missing connection string 'DefaultConnection'.");

            if (string.IsNullOrWhiteSpace(key)) return BadRequest("key is required.");

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureBuiltInPagesAsync(conn);

                var cmd = new NpgsqlCommand(@"SELECT key, title, description, created_at, updated_at FROM pages WHERE key = @key;", conn);
                cmd.Parameters.AddWithValue("key", NpgsqlTypes.NpgsqlDbType.Text, key);

                await using var rdr = await cmd.ExecuteReaderAsync();
                if (await rdr.ReadAsync())
                {
                    return Ok(new
                    {
                        key = rdr["key"] is DBNull ? null : rdr["key"].ToString(),
                        title = rdr["title"] is DBNull ? null : rdr["title"].ToString(),
                        description = rdr["description"] is DBNull ? null : rdr["description"].ToString(),
                        createdAt = rdr["created_at"] is DBNull ? null : rdr["created_at"].ToString(),
                        updatedAt = rdr["updated_at"] is DBNull ? null : rdr["updated_at"].ToString()
                    });
                }

                return NotFound();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving page {Key}", key);
                return _env.IsDevelopment() ? StatusCode(500, ex.ToString()) : StatusCode(500, "Error retrieving page.");
            }
        }

        // POST api/pages
        [HttpPost]
        [Microsoft.AspNetCore.Authorization.Authorize(Roles = "admin,Admin,ADMIN")]
        public async Task<IActionResult> Create([FromBody] PageCreateDto dto)
        {
            if (string.IsNullOrWhiteSpace(_connectionString))
                return StatusCode(500, "Missing connection string 'DefaultConnection'.");

            if (dto == null || string.IsNullOrWhiteSpace(dto.Key) || string.IsNullOrWhiteSpace(dto.Title))
                return BadRequest("Key and Title are required.");

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var cmd = new NpgsqlCommand(@"INSERT INTO pages (key, title, description, created_at, updated_at) 
                                             VALUES (@key, @title, @description, now(), now())
                                             ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, updated_at = now()
                                             RETURNING key;", conn);
                cmd.Parameters.AddWithValue("key", NpgsqlTypes.NpgsqlDbType.Text, dto.Key);
                cmd.Parameters.AddWithValue("title", NpgsqlTypes.NpgsqlDbType.Text, dto.Title);
                cmd.Parameters.AddWithValue("description", string.IsNullOrWhiteSpace(dto.Description) ? (object)DBNull.Value : dto.Description);

                var res = await cmd.ExecuteScalarAsync();
                var newKey = res?.ToString() ?? dto.Key;
                return CreatedAtAction(nameof(GetByKey), new { key = newKey }, new { key = newKey, dto.Title });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating page.");
                return _env.IsDevelopment() ? StatusCode(500, ex.ToString()) : StatusCode(500, "Error creating page.");
            }
        }

        // PUT api/pages/{key}
        [AcceptVerbs("PUT", "PATCH", "POST")]
        [Route("{key}")]
        [Microsoft.AspNetCore.Authorization.Authorize(Roles = "admin,Admin,ADMIN")]
        public async Task<IActionResult> Update(string key, [FromBody] PageCreateDto dto)
        {
            if (string.IsNullOrWhiteSpace(_connectionString))
                return StatusCode(500, "Missing connection string 'DefaultConnection'.");

            if (string.IsNullOrWhiteSpace(key)) return BadRequest("key is required.");
            if (dto == null) return BadRequest("payload required.");

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var setParts = new List<string>();
                var cmd = new NpgsqlCommand { Connection = conn, CommandType = CommandType.Text };

                if (!string.IsNullOrWhiteSpace(dto.Title))
                {
                    setParts.Add(@"""title"" = @title");
                    cmd.Parameters.AddWithValue("title", NpgsqlTypes.NpgsqlDbType.Text, dto.Title);
                }
                if (dto.Description != null)
                {
                    setParts.Add(@"""description"" = @description");
                    cmd.Parameters.AddWithValue("description", string.IsNullOrWhiteSpace(dto.Description) ? (object)DBNull.Value : dto.Description);
                }

                if (setParts.Count == 0) return BadRequest("Nothing to update.");

                cmd.CommandText = $"UPDATE pages SET {string.Join(", ", setParts)}, updated_at = now() WHERE key = @key";
                cmd.Parameters.AddWithValue("key", NpgsqlTypes.NpgsqlDbType.Text, key);

                var rows = await cmd.ExecuteNonQueryAsync();
                if (rows == 0) return NotFound();
                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating page {Key}", key);
                return _env.IsDevelopment() ? StatusCode(500, ex.ToString()) : StatusCode(500, "Error updating page.");
            }
        }

        // DELETE api/pages/{key}
        [AcceptVerbs("DELETE", "POST")]
        [Route("{key}")]
        [Microsoft.AspNetCore.Authorization.Authorize(Roles = "admin,Admin,ADMIN")]
        public async Task<IActionResult> Delete(string key)
        {
            if (string.IsNullOrWhiteSpace(_connectionString))
                return StatusCode(500, "Missing connection string 'DefaultConnection'.");

            if (string.IsNullOrWhiteSpace(key)) return BadRequest("key is required.");

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var cmd = new NpgsqlCommand("DELETE FROM pages WHERE key = @key", conn);
                cmd.Parameters.AddWithValue("key", NpgsqlTypes.NpgsqlDbType.Text, key);
                var rows = await cmd.ExecuteNonQueryAsync();
                if (rows == 0) return NotFound();
                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting page {Key}", key);
                return _env.IsDevelopment() ? StatusCode(500, ex.ToString()) : StatusCode(500, "Error deleting page.");
            }
        }

        public class PageCreateDto
        {
            public string Key { get; set; } = "";
            public string Title { get; set; } = "";
            public string? Description { get; set; }
        }

        private static async Task EnsureBuiltInPagesAsync(NpgsqlConnection conn)
        {
            await using var cmd = new NpgsqlCommand(@"
                INSERT INTO pages (key, title, description, created_at, updated_at)
                VALUES
                    ('DASHBOARD', 'Home', 'Main home dashboard and quick links.', now(), now()),
                    ('CHAT', 'Jai Masih Chat', 'Direct and group chat, voice notes, calls, notifications, and chat safety.', now(), now()),
                    ('PASTOR', 'AI Counseller', 'Pastoral AI assistant for prayer, Scripture, and daily guidance.', now(), now()),
                    ('APP_DOWNLOADS', 'App Downloads', 'Android and iOS app download and upgrade page.', now(), now()),
                    ('SERMONS', 'Sermons', 'Sermon library and media management.', now(), now()),
                    ('PRAYER_REQUESTS', 'Prayer Requests', 'Prayer request intake, tracking, and updates.', now(), now()),
                    ('EVENTS', 'Events', 'Tenant church events with visibility, RSVP, and capacity controls.', now(), now()),
                    ('VOLUNTEERS', 'Volunteer Scheduling', 'Tenant volunteer shifts, staffing, and self-signup.', now(), now()),
                    ('CHECKIN', 'Child Check-In', 'Tenant child check-in and guardian-matched checkout.', now(), now()),
                    ('SECURITY', 'Security', 'Account multi-factor authentication and recovery settings.', now(), now()),
                    ('SERVICE_PLANS', 'Service Planning', 'Tenant worship run-sheets and ordered service items.', now(), now()),
                    ('TASKS', 'Tasks', 'Team task management and follow-up tracking.', now(), now()),
                    ('USERS', 'Users', 'User account and staff profile management.', now(), now()),
                    ('TEAMS', 'Teams', 'Team setup, membership, and ministry group management.', now(), now()),
                    ('ROLES', 'Roles', 'Role setup and page permission assignment.', now(), now()),
                    ('PAGES', 'Pages', 'Application page registry used by role permissions.', now(), now()),
                    ('ATTENDANCE', 'Attendance', 'Timesheets, attendance, and staff tracking.', now(), now()),
                    ('PAYROLL', 'Payroll', 'Payroll runs, payslips, payments, and arrears.', now(), now()),
                    ('COSTS', 'Costs', 'Cost and expense tracking.', now(), now()),
                    ('MARRIAGE', 'Marriage', 'Marriage ministry records and workflow.', now(), now()),
                    ('BAPTISM', 'Baptism', 'Baptism ministry records and workflow.', now(), now()),
                    ('COUNSELLING', 'Counselling', 'Counselling ministry records and workflow.', now(), now()),
                    ('ADMIN_DASHBOARD', 'Admin Dashboard', 'Administrative dashboard and system overview.', now(), now()),
                    ('LIVE_USERS', 'Live Users', 'Live user activity and login monitoring.', now(), now()),
                    ('MESSAGE_CENTER', 'Message Center', 'Ministry automation and scheduled message controls.', now(), now()),
                    ('LANGUAGES', 'Languages', 'Application language and translation management.', now(), now()),
                    ('QA_AUTOMATION', 'Test Automation', 'Root-admin production readiness testing and remediation reports.', now(), now()),
                    ('EMAIL_CLIENT', 'Email Client', 'Mailbox, SMTP compose, folders, and email connection controls.', now(), now()),
                    ('GOOGLE_DRIVE', 'Google Drive', 'Google Drive integration and ministry cloud file access.', now(), now()),
                    ('SERVER_FILES', 'Server Files', 'Admin-only upload and download manager for the backend download folder.', now(), now()),
                    ('REPORTS', 'Reports', 'Administrative reports and analytics.', now(), now())
                ON CONFLICT (key) DO UPDATE
                SET title = EXCLUDED.title,
                    description = EXCLUDED.description,
                    updated_at = now();", conn);

            await cmd.ExecuteNonQueryAsync();
        }
    }
}
