using Mahima.Api.v3.clean.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System;
using System.Collections.Generic;
using System.Data;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    [Microsoft.AspNetCore.Authorization.Authorize(Roles = "admin,Admin,ADMIN")]
    public class RolePermissionsController : ControllerBase
    {
        private readonly MahimaDbContext _db;
        public RolePermissionsController(MahimaDbContext db) { _db = db; }

        private Guid GetCurrentTenantId() =>
            Guid.TryParse(User.FindFirstValue("tenant_id"), out var tenantId)
                ? tenantId
                : Guid.Parse("00000000-0000-0000-0000-000000000001");

        private async Task<List<(int RoleId, string PageKey)>> GetEffectivePermissionsAsync(int? roleId = null)
        {
            var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
            var closeWhenDone = connection.State != ConnectionState.Open;
            if (closeWhenDone) await connection.OpenAsync();

            try
            {
                await using (var ensure = new NpgsqlCommand(@"
CREATE TABLE IF NOT EXISTS public.tenant_role_permissions (
    tenant_id uuid NOT NULL,
    role_id integer NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    page_key text NOT NULL,
    created_at_utc timestamp with time zone NOT NULL DEFAULT now(),
    updated_at_utc timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, role_id, page_key)
);", connection))
                {
                    await ensure.ExecuteNonQueryAsync();
                }

                await using var command = new NpgsqlCommand(@"
WITH tenant_roles AS (
    SELECT DISTINCT role_id
    FROM public.tenant_role_permissions
    WHERE tenant_id = @tenant_id
)
SELECT permission.role_id, upper(permission.page_key)
FROM public.tenant_role_permissions permission
WHERE permission.tenant_id = @tenant_id
  AND (@role_id IS NULL OR permission.role_id = @role_id)
UNION
SELECT permission.role_id, upper(permission.page_key)
FROM public.role_permissions permission
WHERE NOT EXISTS (
    SELECT 1 FROM tenant_roles tenant_role WHERE tenant_role.role_id = permission.role_id
)
  AND (@role_id IS NULL OR permission.role_id = @role_id)
ORDER BY 1, 2;", connection);
                command.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, GetCurrentTenantId());
                command.Parameters.AddWithValue("role_id", NpgsqlTypes.NpgsqlDbType.Integer, roleId.HasValue ? roleId.Value : DBNull.Value);

                var rows = new List<(int RoleId, string PageKey)>();
                await using var reader = await command.ExecuteReaderAsync();
                while (await reader.ReadAsync()) rows.Add((reader.GetInt32(0), reader.GetString(1)));
                return rows;
            }
            finally
            {
                if (closeWhenDone) await connection.CloseAsync();
            }
        }

        // GET /api/role-permissions  -> returns array of { roleId, page_key }
        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            var rows = await GetEffectivePermissionsAsync();
            return Ok(rows.Select(row => new { roleId = row.RoleId, page_key = row.PageKey }));
        }

        // GET /api/role-permissions/roles -> returns aggregated roles with pages
        [HttpGet("roles")]
        public async Task<IActionResult> GetRolesWithPages()
        {
            var roles = await _db.Roles.AsNoTracking().OrderBy(role => role.Id).ToListAsync();
            var permissions = await GetEffectivePermissionsAsync();
            return Ok(roles.Select(role => new {
                id = role.Id,
                name = role.Name,
                pages = permissions.Where(permission => permission.RoleId == role.Id)
                    .Select(permission => permission.PageKey).ToArray()
            }));
        }

        // GET /api/roles/{id}/pages  -> returns array of page keys (if frontend tries it)
        [HttpGet("/api/roles/{id}/pages")]
        public async Task<IActionResult> GetPagesForRole(int id)
        {
            var permissions = await GetEffectivePermissionsAsync(id);
            return Ok(permissions.Select(permission => permission.PageKey));
        }
    }
}
