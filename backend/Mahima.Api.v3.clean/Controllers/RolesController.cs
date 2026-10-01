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
    public class RolesController : ControllerBase
    {
        private readonly string? _connectionString;
        private readonly ILogger<RolesController> _logger;
        private readonly IHostEnvironment _env;

        public RolesController(IConfiguration configuration, ILogger<RolesController> logger, IHostEnvironment env)
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

        private static async Task EnsureTenantRolePermissionsTableAsync(NpgsqlConnection conn)
        {
            await using var cmd = new NpgsqlCommand(@"
CREATE TABLE IF NOT EXISTS public.tenant_role_permissions (
    tenant_id uuid NOT NULL,
    role_id integer NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    page_key text NOT NULL,
    created_at_utc timestamp with time zone NOT NULL DEFAULT now(),
    updated_at_utc timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, role_id, page_key)
);

CREATE INDEX IF NOT EXISTS ix_tenant_role_permissions_role
    ON public.tenant_role_permissions(role_id, page_key);", conn);
            await cmd.ExecuteNonQueryAsync();
        }

        private static async Task<HashSet<string>> LoadLicensedPageKeysAsync(NpgsqlConnection conn, Guid tenantId)
        {
            var keys = new HashSet<string>(BasePageKeys, StringComparer.OrdinalIgnoreCase);
            if (tenantId == Guid.Parse("00000000-0000-0000-0000-000000000001"))
            {
                foreach (var key in PageModules.Keys) keys.Add(key);
                keys.Add("MULTITENANT");
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

        private static async Task<List<object>> ReadRolesAsync(NpgsqlConnection conn, Guid tenantId, HashSet<string> licensedKeys, int? roleId = null)
        {
            await EnsureTenantRolePermissionsTableAsync(conn);
            var sql = @"
WITH tenant_roles AS (
    SELECT role_id, page_key
    FROM public.tenant_role_permissions
    WHERE tenant_id = @tenant_id
),
role_rows AS (
    SELECT r.id, r.name, r.description,
           CASE
             WHEN EXISTS (SELECT 1 FROM tenant_roles tr WHERE tr.role_id = r.id)
             THEN COALESCE(ARRAY_AGG(DISTINCT UPPER(tr.page_key)) FILTER (WHERE tr.page_key IS NOT NULL), ARRAY[]::text[])
             ELSE COALESCE(ARRAY_AGG(DISTINCT UPPER(rp.page_key)) FILTER (WHERE rp.page_key IS NOT NULL), ARRAY[]::text[])
           END AS pages
    FROM roles r
    LEFT JOIN tenant_roles tr ON tr.role_id = r.id
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    WHERE (@role_id IS NULL OR r.id = @role_id)
    GROUP BY r.id, r.name, r.description
)
SELECT id, name, description, pages
FROM role_rows
ORDER BY id;";
            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
            cmd.Parameters.AddWithValue("role_id", NpgsqlTypes.NpgsqlDbType.Integer, roleId.HasValue ? (object)roleId.Value : DBNull.Value);

            var items = new List<object>();
            await using var rdr = await cmd.ExecuteReaderAsync();
            while (await rdr.ReadAsync())
            {
                var pages = rdr["pages"] is DBNull
                    ? Array.Empty<string>()
                    : ((string[])rdr["pages"]).Where(licensedKeys.Contains).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
                items.Add(new
                {
                    id = Convert.ToInt32(rdr["id"]),
                    name = rdr["name"] is DBNull ? null : rdr["name"].ToString(),
                    description = rdr["description"] is DBNull ? null : rdr["description"].ToString(),
                    pages
                });
            }

            return items;
        }

        // GET api/roles
        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            if (string.IsNullOrWhiteSpace(_connectionString)) return StatusCode(500, "Missing connection string 'DefaultConnection'.");

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                var tenantId = GetCurrentTenantId();
                var licensedKeys = await LoadLicensedPageKeysAsync(conn, tenantId);
                var items = await ReadRolesAsync(conn, tenantId, licensedKeys);

                return Ok(new { items, total = items.Count });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving roles.");
                return _env.IsDevelopment() ? StatusCode(500, ex.ToString()) : StatusCode(500, "Error retrieving roles.");
            }
        }

        // GET api/roles/{id}
        [HttpGet("{id}")]
        public async Task<IActionResult> GetById(int id)
        {
            if (string.IsNullOrWhiteSpace(_connectionString)) return StatusCode(500, "Missing connection string 'DefaultConnection'.");

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                var tenantId = GetCurrentTenantId();
                var licensedKeys = await LoadLicensedPageKeysAsync(conn, tenantId);
                var items = await ReadRolesAsync(conn, tenantId, licensedKeys, id);
                return items.Count == 0 ? NotFound() : Ok(items[0]);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving role {Id}", id);
                return _env.IsDevelopment() ? StatusCode(500, ex.ToString()) : StatusCode(500, "Error retrieving role.");
            }
        }

        // POST api/roles
        [HttpPost]
        [Microsoft.AspNetCore.Authorization.Authorize(Roles = "admin,Admin,ADMIN")]
        public async Task<IActionResult> Create([FromBody] RoleCreateDto dto)
        {
            if (string.IsNullOrWhiteSpace(_connectionString)) return StatusCode(500, "Missing connection string 'DefaultConnection'.");
            if (string.IsNullOrWhiteSpace(dto?.Name)) return BadRequest("Name is required.");

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureTenantRolePermissionsTableAsync(conn);
                var tenantId = GetCurrentTenantId();
                var licensedKeys = await LoadLicensedPageKeysAsync(conn, tenantId);
                await using var tx = await conn.BeginTransactionAsync();

                var insertSql = @"INSERT INTO roles (name, description) VALUES (@name, @description) RETURNING id;";
                await using (var cmd = new NpgsqlCommand(insertSql, conn) { Transaction = tx })
                {
                    cmd.Parameters.AddWithValue("name", NpgsqlTypes.NpgsqlDbType.Text, dto.Name);
                    cmd.Parameters.AddWithValue("description", string.IsNullOrWhiteSpace(dto.Description) ? (object)DBNull.Value : dto.Description);
                    var idObj = await cmd.ExecuteScalarAsync();
                    var roleId = Convert.ToInt32(idObj);

                    // assign pages (page keys)
                    if (dto.Pages != null && dto.Pages.Length > 0)
                    {
                        foreach (var pk in NormalizePageKeys(dto.Pages).Where(licensedKeys.Contains))
                        {
                            await using var rel = new NpgsqlCommand(@"INSERT INTO tenant_role_permissions(tenant_id, role_id, page_key) VALUES (@tenant_id, @r, @pk) ON CONFLICT (tenant_id, role_id, page_key) DO NOTHING;", conn) { Transaction = tx };
                            rel.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                            rel.Parameters.AddWithValue("r", NpgsqlTypes.NpgsqlDbType.Integer, roleId);
                            rel.Parameters.AddWithValue("pk", NpgsqlTypes.NpgsqlDbType.Text, pk);
                            await rel.ExecuteNonQueryAsync();
                        }
                    }

                    await tx.CommitAsync();
                    return CreatedAtAction(nameof(GetById), new { id = roleId }, new { id = roleId, dto.Name });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating role.");
                return _env.IsDevelopment() ? StatusCode(500, ex.ToString()) : StatusCode(500, "Error creating role.");
            }
        }

        // PUT api/roles/{id}
        [AcceptVerbs("PUT", "PATCH", "POST")]
        [Route("{id}")]
        [Microsoft.AspNetCore.Authorization.Authorize(Roles = "admin,Admin,ADMIN")]
        public async Task<IActionResult> Update(int id, [FromBody] RoleUpdateDto dto)
        {
            if (string.IsNullOrWhiteSpace(_connectionString)) return StatusCode(500, "Missing connection string 'DefaultConnection'.");

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureTenantRolePermissionsTableAsync(conn);
                var tenantId = GetCurrentTenantId();
                var licensedKeys = await LoadLicensedPageKeysAsync(conn, tenantId);
                await using var tx = await conn.BeginTransactionAsync();

                // update name/description if provided
                var setParts = new List<string>();
                var cmd = new NpgsqlCommand { Connection = conn, Transaction = tx, CommandType = CommandType.Text };
                if (!string.IsNullOrWhiteSpace(dto.Name))
                {
                    setParts.Add(@"""name"" = @name");
                    cmd.Parameters.AddWithValue("name", NpgsqlTypes.NpgsqlDbType.Text, dto.Name);
                }
                if (dto.Description != null)
                {
                    setParts.Add(@"""description"" = @description");
                    cmd.Parameters.AddWithValue("description", string.IsNullOrWhiteSpace(dto.Description) ? (object)DBNull.Value : dto.Description);
                }

                if (setParts.Count > 0)
                {
                    cmd.CommandText = $"UPDATE roles SET {string.Join(", ", setParts)} WHERE id = @id";
                    cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Integer, id);
                    var rows = await cmd.ExecuteNonQueryAsync();
                    if (rows == 0) { await tx.RollbackAsync(); return NotFound(); }
                }

                // replace pages mapping if provided
                if (dto.Pages != null)
                {
                    // delete existing mappings
                    await using var del = new NpgsqlCommand("DELETE FROM tenant_role_permissions WHERE tenant_id = @tenant_id AND role_id = @r", conn) { Transaction = tx };
                    del.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                    del.Parameters.AddWithValue("r", NpgsqlTypes.NpgsqlDbType.Integer, id);
                    await del.ExecuteNonQueryAsync();

                    // insert new mappings
                    foreach (var pk in NormalizePageKeys(dto.Pages).Where(licensedKeys.Contains))
                    {
                        await using var rel = new NpgsqlCommand(@"INSERT INTO tenant_role_permissions(tenant_id, role_id, page_key) VALUES (@tenant_id, @r, @pk) ON CONFLICT (tenant_id, role_id, page_key) DO NOTHING;", conn) { Transaction = tx };
                        rel.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                        rel.Parameters.AddWithValue("r", NpgsqlTypes.NpgsqlDbType.Integer, id);
                        rel.Parameters.AddWithValue("pk", NpgsqlTypes.NpgsqlDbType.Text, pk);
                        await rel.ExecuteNonQueryAsync();
                    }
                }

                await tx.CommitAsync();
                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating role {Id}", id);
                return _env.IsDevelopment() ? StatusCode(500, ex.ToString()) : StatusCode(500, "Error updating role.");
            }
        }

        // DELETE api/roles/{id}
        [AcceptVerbs("DELETE", "POST")]
        [Route("{id}")]
        [Microsoft.AspNetCore.Authorization.Authorize(Roles = "admin,Admin,ADMIN")]
        public async Task<IActionResult> Delete(int id)
        {
            if (string.IsNullOrWhiteSpace(_connectionString)) return StatusCode(500, "Missing connection string 'DefaultConnection'.");

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                var cmd = new NpgsqlCommand("DELETE FROM roles WHERE id = @id", conn);
                cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Integer, id);
                var rows = await cmd.ExecuteNonQueryAsync();
                if (rows == 0) return NotFound();
                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting role {Id}", id);
                return _env.IsDevelopment() ? StatusCode(500, ex.ToString()) : StatusCode(500, "Error deleting role.");
            }
        }

        // DTOs
        public class RoleCreateDto
        {
            public string Name { get; set; } = "";
            public string? Description { get; set; }
            public string[]? Pages { get; set; } // page keys
        }

        public class RoleUpdateDto
        {
            public string? Name { get; set; }
            public string? Description { get; set; }
            public string[]? Pages { get; set; } // page keys
        }

        private static IEnumerable<string> NormalizePageKeys(IEnumerable<string> pageKeys)
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var pageKey in pageKeys)
            {
                var normalized = (pageKey ?? "").Trim().ToUpperInvariant();
                if (normalized.Length == 0 || !seen.Add(normalized)) continue;
                yield return normalized;
            }
        }
    }
}
