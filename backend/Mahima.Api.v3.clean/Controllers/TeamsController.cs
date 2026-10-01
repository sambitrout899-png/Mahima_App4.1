using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;
using System;
using System.Data;
using System.Security.Claims;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Services;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Microsoft.AspNetCore.Authorization.Authorize]
    public class TeamsController : ControllerBase
    {
        private readonly string _connectionString;
        private readonly ILogger<TeamsController> _logger;
        private readonly IChatService _chatService;

        public TeamsController(IConfiguration configuration, ILogger<TeamsController> logger, IChatService chatService)
        {
            _connectionString = configuration.GetConnectionString("DefaultConnection") ?? throw new ArgumentNullException(nameof(configuration));
            _logger = logger;
            _chatService = chatService;
        }

        public class TeamCreateDto
        {
            public string? Name { get; set; }
            public string? Description { get; set; }
        }

        public class TeamDto
        {
            public object? Id { get; set; }   // could be int, long, guid depending on your schema
            public string? Name { get; set; }
            public string? Description { get; set; }
        }

        // POST /api/teams
        [HttpPost]
        [Microsoft.AspNetCore.Authorization.Authorize(Roles = "admin,Admin,ADMIN")]
        public async Task<IActionResult> Create([FromBody] TeamCreateDto dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.Name))
                return BadRequest(new { error = "Missing name" });

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                // Postgres: RETURNING Id, Name, Description
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = @"
                INSERT INTO ""Teams"" (""Name"", ""Description"", ""CreatedAt"", ""TenantId"")
                VALUES (@name, @desc, now(), @tenantId)
                RETURNING ""Id"", ""Name"", ""Description"";";
            cmd.Parameters.AddWithValue("name", dto.Name.Trim());
            cmd.Parameters.AddWithValue("desc", (object?)dto.Description ?? DBNull.Value);
            cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, GetCurrentTenantId());

                await using var rdr = await cmd.ExecuteReaderAsync();
                if (await rdr.ReadAsync())
                {
                    var created = new TeamDto
                    {
                        Id = rdr["Id"],
                        Name = rdr["Name"] is DBNull ? null : rdr["Name"]?.ToString(),
                        Description = rdr["Description"] is DBNull ? null : rdr["Description"]?.ToString()
                    };

                    await CreateTeamChatIfPossibleAsync(created.Name);

                    // Return 201 Created + Location header for REST clients
                    return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
                }

                // Insert succeeded but returning failed
                return StatusCode(500, "Failed to return created team.");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating team");
                return StatusCode(500, "Error creating team.");
            }
        }


        private Guid GetCurrentUserId() =>
            Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"), out var id) ? id : Guid.Empty;

        private Guid GetCurrentTenantId() =>
            Guid.TryParse(User.FindFirstValue("tenant_id"), out var id)
                ? id
                : Guid.Parse("00000000-0000-0000-0000-000000000001");

        private async Task CreateTeamChatIfPossibleAsync(string? teamName)
        {
            var creatorId = GetCurrentUserId();
            if (creatorId == Guid.Empty || string.IsNullOrWhiteSpace(teamName)) return;

            try
            {
                await _chatService.CreateGroupChatAsync(creatorId, teamName.Trim(), Array.Empty<Guid>());
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Team was created but chat group creation failed for {TeamName}", teamName);
            }
        }

        // GET /api/teams
        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                await using var cmd = conn.CreateCommand();
                cmd.CommandText = @"SELECT ""Id"", ""Name"", ""Description"" FROM ""Teams"" WHERE ""TenantId"" = @tenantId ORDER BY ""Id"" DESC;";
                cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, GetCurrentTenantId());
                await using var rdr = await cmd.ExecuteReaderAsync();

                var list = new System.Collections.Generic.List<TeamDto>();
                while (await rdr.ReadAsync())
                {
                    list.Add(new TeamDto
                    {
                        Id = rdr["Id"],
                        Name = rdr["Name"] is DBNull ? null : rdr["Name"]?.ToString(),
                        Description = rdr["Description"] is DBNull ? null : rdr["Description"]?.ToString()
                    });
                }

                return Ok(list);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error reading teams");
                return StatusCode(500, "Error reading teams.");
            }
        }

        // GET /api/teams/{id}
        [HttpGet("{id}")]
        public async Task<IActionResult> GetById(string id)
        {
            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                await using var cmd = conn.CreateCommand();
                cmd.CommandText = @"SELECT ""Id"", ""Name"", ""Description"" FROM ""Teams"" WHERE CAST(""Id"" AS text) = @id AND ""TenantId"" = @tenantId LIMIT 1;";
                cmd.Parameters.AddWithValue("id", id);
                cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, GetCurrentTenantId());

                await using var rdr = await cmd.ExecuteReaderAsync();
                if (await rdr.ReadAsync())
                {
                    var team = new TeamDto
                    {
                        Id = rdr["Id"],
                        Name = rdr["Name"] is DBNull ? null : rdr["Name"]?.ToString(),
                        Description = rdr["Description"] is DBNull ? null : rdr["Description"]?.ToString()
                    };
                    return Ok(team);
                }
                return NotFound();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error reading team {Id}", id);
                return StatusCode(500, "Error reading team.");
            }
        }

        // PUT /api/teams/{id}
        [HttpPut("{id}")]
        [Microsoft.AspNetCore.Authorization.Authorize(Roles = "admin,Admin,ADMIN")]
        public async Task<IActionResult> Update(string id, [FromBody] TeamCreateDto dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.Name))
                return BadRequest(new { error = "Missing name" });

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                await using var cmd = conn.CreateCommand();
                cmd.CommandText = @"
                    UPDATE ""Teams""
                    SET ""Name"" = @name, ""Description"" = @desc, ""UpdatedAt"" = now()
                WHERE CAST(""Id"" AS text) = @id AND ""TenantId"" = @tenantId
                RETURNING ""Id"", ""Name"", ""Description"";";
            cmd.Parameters.AddWithValue("name", dto.Name.Trim());
            cmd.Parameters.AddWithValue("desc", (object?)dto.Description ?? DBNull.Value);
            cmd.Parameters.AddWithValue("id", id);
            cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, GetCurrentTenantId());

                await using var rdr = await cmd.ExecuteReaderAsync();
                if (await rdr.ReadAsync())
                {
                    var updated = new TeamDto
                    {
                        Id = rdr["Id"],
                        Name = rdr["Name"] is DBNull ? null : rdr["Name"]?.ToString(),
                        Description = rdr["Description"] is DBNull ? null : rdr["Description"]?.ToString()
                    };
                    return Ok(updated);
                }

                return NotFound();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating team {Id}", id);
                return StatusCode(500, "Error updating team.");
            }
        }

        // DELETE /api/teams/{id}
        [HttpDelete("{id}")]
        [Microsoft.AspNetCore.Authorization.Authorize(Roles = "admin,Admin,ADMIN")]
        public async Task<IActionResult> Delete(string id)
        {
            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                await using var cmd = conn.CreateCommand();
                cmd.CommandText = @"DELETE FROM ""Teams"" WHERE CAST(""Id"" AS text) = @id AND ""TenantId"" = @tenantId RETURNING ""Id"";";
                cmd.Parameters.AddWithValue("id", id);
                cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, GetCurrentTenantId());

                await using var rdr = await cmd.ExecuteReaderAsync();
                if (await rdr.ReadAsync())
                {
                    return NoContent(); // deleted
                }

                return NotFound();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting team {Id}", id);
                return StatusCode(500, "Error deleting team.");
            }
        }
    }
}
