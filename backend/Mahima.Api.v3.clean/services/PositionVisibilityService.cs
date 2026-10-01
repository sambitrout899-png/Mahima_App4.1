using Microsoft.AspNetCore.Http;
using Npgsql;
using NpgsqlTypes;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Services
{
    public sealed class PositionVisibilityContext
    {
        public Guid UserId { get; set; }
        public long? PositionId { get; set; }
        public string PositionName { get; set; } = "Member";
        public string VisibilityScope { get; set; } = "My";
        public IReadOnlyList<long> PositionTreeIds { get; set; } = Array.Empty<long>();
        public bool IsChurchLevel => VisibilityScope.Equals("ChurchLevel", StringComparison.OrdinalIgnoreCase);
        public bool IsMyTeams => VisibilityScope.Equals("MyTeams", StringComparison.OrdinalIgnoreCase);
        public bool IsMy => !IsChurchLevel && !IsMyTeams;
        public bool IsMemberPosition => PositionName.Equals("Member", StringComparison.OrdinalIgnoreCase);
    }

    public static class PositionVisibilityService
    {
        public const string HeaderName = "X-Mahima-Position-Id";

        public static async Task<PositionVisibilityContext> ResolveAsync(HttpContext httpContext, NpgsqlConnection conn)
        {
            var userId = Guid.TryParse(httpContext.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? httpContext.User.FindFirstValue("sub"), out var parsed)
                ? parsed
                : Guid.Empty;
            var requested = httpContext.Request.Headers.TryGetValue(HeaderName, out var header) && long.TryParse(header.FirstOrDefault(), out var hid)
                ? hid
                : (long?)null;
            var tenantId = Guid.TryParse(httpContext.User.FindFirstValue("tenant_id"), out var parsedTenantId)
                ? parsedTenantId
                : Guid.Empty;

            await Mahima.Api.v3.clean.Controllers.PositionsController.EnsurePositionTablesAsync(conn);
            var rows = new List<(long Id, string Name, string Scope, bool Primary)>();
            await using (var cmd = new NpgsqlCommand(@"
SELECT p.id, p.name, p.visibility_scope, up.is_primary
FROM public.user_positions up
JOIN public.positions p ON p.id = up.position_id AND p.is_active = true
WHERE up.user_id = @user_id AND p.tenant_id = @tenant_id
ORDER BY up.is_primary DESC, p.name;", conn))
            {
                cmd.Parameters.AddWithValue("user_id", NpgsqlDbType.Uuid, userId);
                cmd.Parameters.AddWithValue("tenant_id", NpgsqlDbType.Uuid, tenantId);
                await using var rdr = await cmd.ExecuteReaderAsync();
                while (await rdr.ReadAsync())
                    rows.Add((rdr.GetInt64(0), rdr.GetString(1), rdr.GetString(2), rdr.GetBoolean(3)));
            }

            var selected = rows.FirstOrDefault(r => requested.HasValue && r.Id == requested.Value);
            if (selected.Id == 0) selected = rows.FirstOrDefault(r => r.Primary);
            if (selected.Id == 0) selected = rows.FirstOrDefault();

            if (selected.Id == 0)
            {
                return new PositionVisibilityContext
                {
                    UserId = userId,
                    PositionId = null,
                    PositionName = "Member",
                    VisibilityScope = "My",
                    PositionTreeIds = Array.Empty<long>()
                };
            }

            return new PositionVisibilityContext
            {
                UserId = userId,
                PositionId = selected.Id,
                PositionName = selected.Name,
                VisibilityScope = selected.Scope,
                PositionTreeIds = await LoadPositionTreeIdsAsync(conn, tenantId, selected.Id)
            };
        }

        private static async Task<IReadOnlyList<long>> LoadPositionTreeIdsAsync(NpgsqlConnection conn, Guid tenantId, long positionId)
        {
            var ids = new List<long>();
            await using var cmd = new NpgsqlCommand(@"
WITH RECURSIVE position_tree AS (
    SELECT id FROM public.positions WHERE id = @id AND tenant_id = @tenant_id
    UNION ALL
    SELECT p.id FROM public.positions p
    JOIN position_tree pt ON p.parent_position_id = pt.id
    WHERE p.tenant_id = @tenant_id
)
SELECT id FROM position_tree;", conn);
            cmd.Parameters.AddWithValue("id", NpgsqlDbType.Bigint, positionId);
            cmd.Parameters.AddWithValue("tenant_id", NpgsqlDbType.Uuid, tenantId);
            await using var rdr = await cmd.ExecuteReaderAsync();
            while (await rdr.ReadAsync()) ids.Add(rdr.GetInt64(0));
            return ids;
        }
    }
}

