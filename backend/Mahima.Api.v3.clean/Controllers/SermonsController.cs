using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;
using System;
using System.Collections.Generic;
using System.Data;
using System.Globalization;
using System.Security.Claims;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class SermonsController : ControllerBase
    {
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");
        private readonly string _connectionString;
        private readonly ILogger<SermonsController> _logger;
        private readonly IWebHostEnvironment _env;

        public SermonsController(IConfiguration config, ILogger<SermonsController> logger, IWebHostEnvironment env)
        {
            _logger = logger;
            _env = env;
            _connectionString = config.GetConnectionString("DefaultConnection") ?? config["DefaultConnection"];
        }

        private Guid GetCurrentTenantId()
        {
            var value = User.FindFirstValue("tenant_id")
                ?? User.FindFirstValue("tenantId")
                ?? User.FindFirstValue("TenantId");

            return Guid.TryParse(value, out var tenantId) ? tenantId : RootTenantId;
        }

        private static async Task EnsureTenantColumnAsync(NpgsqlConnection conn)
        {
            await using var cmd = new NpgsqlCommand(@"
ALTER TABLE ""Sermons""
    ADD COLUMN IF NOT EXISTS ""TenantId"" uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';
CREATE INDEX IF NOT EXISTS ""IX_Sermons_TenantId"" ON ""Sermons"" (""TenantId"");", conn);
            await cmd.ExecuteNonQueryAsync();
        }

        // GET api/sermons
        [HttpGet]
        public async Task<IActionResult> GetAll()
        {
            if (string.IsNullOrWhiteSpace(_connectionString))
            {
                _logger.LogError("Missing connection string 'DefaultConnection'.");
                return StatusCode(500, "Missing connection string 'DefaultConnection'.");
            }

            try
            {
                var list = new List<object>();
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureTenantColumnAsync(conn);
                var tenantId = GetCurrentTenantId();

                // include YoutubeUrl in selection
                const string sql = @"SELECT ""Id"", ""Title"", ""Description"", ""S3Key"", ""DurationSeconds"", ""Speaker"", ""PublishedAt"", ""YoutubeUrl""
                                     FROM ""Sermons""
                                     WHERE ""TenantId"" = @tenantId
                                     ORDER BY ""PublishedAt"" DESC NULLS LAST, ""Id"" DESC;";

                await using var cmd = new NpgsqlCommand(sql, conn) { CommandType = CommandType.Text };
                cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenantId);

                await using var reader = await cmd.ExecuteReaderAsync();
                while (await reader.ReadAsync())
                {
                    var id = reader["Id"];
                    var title = reader["Title"] as string;
                    var description = reader["Description"] as string;
                    var s3Key = reader["S3Key"] as string;
                    var duration = reader["DurationSeconds"] != DBNull.Value ? (int?)reader.GetInt32(reader.GetOrdinal("DurationSeconds")) : null;
                    var speaker = reader["Speaker"] as string;
                    DateTime? publishedAt = null;
                    if (reader["PublishedAt"] != DBNull.Value)
                    {
                        publishedAt = reader.GetFieldValue<DateTime>(reader.GetOrdinal("PublishedAt"));
                    }
                    var youtubeUrl = reader["YoutubeUrl"] != DBNull.Value ? reader["YoutubeUrl"] as string : null;

                    list.Add(new
                    {
                        id,
                        title,
                        description,
                        s3Key,
                        durationSeconds = duration,
                        speaker,
                        publishedAt = publishedAt?.ToString("o"), // ISO string
                        youtubeUrl
                    });
                }

                return Ok(list);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching sermons");
                if (_env.IsDevelopment())
                    return StatusCode(500, $"Error fetching sermons: {ex.GetType().Name} - {ex.Message}");
                return StatusCode(500, "Error fetching sermons.");
            }
        }

        // GET api/sermons/{id}
        [HttpGet("{id:int}")]
        public async Task<IActionResult> Get(int id)
        {
            if (string.IsNullOrWhiteSpace(_connectionString))
            {
                _logger.LogError("Missing connection string 'DefaultConnection'.");
                return StatusCode(500, "Missing connection string 'DefaultConnection'.");
            }

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureTenantColumnAsync(conn);
                var tenantId = GetCurrentTenantId();

                const string sql = @"SELECT ""Id"", ""Title"", ""Description"", ""S3Key"", ""DurationSeconds"", ""Speaker"", ""PublishedAt"", ""YoutubeUrl""
                                     FROM ""Sermons""
                                     WHERE ""Id"" = @id AND ""TenantId"" = @tenantId
                                     LIMIT 1;";

                await using var cmd = new NpgsqlCommand(sql, conn) { CommandType = CommandType.Text };
                cmd.Parameters.AddWithValue("id", NpgsqlDbType.Integer, id);
                cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenantId);

                await using var reader = await cmd.ExecuteReaderAsync();
                if (!await reader.ReadAsync()) return NotFound();

                var title = reader["Title"] as string;
                var description = reader["Description"] as string;
                var s3Key = reader["S3Key"] as string;
                var duration = reader["DurationSeconds"] != DBNull.Value ? (int?)reader.GetInt32(reader.GetOrdinal("DurationSeconds")) : null;
                var speaker = reader["Speaker"] as string;
                DateTime? publishedAt = null;
                if (reader["PublishedAt"] != DBNull.Value)
                    publishedAt = reader.GetFieldValue<DateTime>(reader.GetOrdinal("PublishedAt"));
                var youtubeUrl = reader["YoutubeUrl"] != DBNull.Value ? reader["YoutubeUrl"] as string : null;

                var sermon = new
                {
                    id,
                    title,
                    description,
                    s3Key,
                    durationSeconds = duration,
                    speaker,
                    publishedAt = publishedAt?.ToString("o"),
                    youtubeUrl
                };

                return Ok(sermon);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching sermon {Id}", id);
                if (_env.IsDevelopment())
                    return StatusCode(500, $"Error fetching sermon: {ex.GetType().Name} - {ex.Message}");
                return StatusCode(500, "Error fetching sermon.");
            }
        }

        // POST api/sermons
        [HttpPost]
        public async Task<IActionResult> Create([FromBody] SermonDto dto)
        {
            if (string.IsNullOrWhiteSpace(_connectionString))
            {
                _logger.LogError("Missing connection string 'DefaultConnection'.");
                return StatusCode(500, "Missing connection string 'DefaultConnection'.");
            }

            if (dto == null) return BadRequest("Empty payload.");
            if (string.IsNullOrWhiteSpace(dto.Title)) return BadRequest("Title is required.");

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureTenantColumnAsync(conn);
                var tenantId = GetCurrentTenantId();

                // include YoutubeUrl in INSERT, ensure S3Key is non-null (use empty string fallback)
                const string sql = @"INSERT INTO ""Sermons"" (""TenantId"", ""Title"", ""Description"", ""S3Key"", ""DurationSeconds"", ""Speaker"", ""PublishedAt"", ""YoutubeUrl"")
                                     VALUES (@tenantId, @title, @desc, @s3key, @duration, @speaker, @publishedAt, @youtube)
                                     RETURNING ""Id"";";

                await using var cmd = new NpgsqlCommand(sql, conn) { CommandType = CommandType.Text };
                cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenantId);
                cmd.Parameters.AddWithValue("title", NpgsqlDbType.Text, dto.Title);
                cmd.Parameters.AddWithValue("desc", NpgsqlDbType.Text, (object?)dto.Content ?? DBNull.Value);

                // S3Key: ensure non-null string to satisfy NOT NULL constraint in DB
                var s3keyVal = dto.S3Key ?? string.Empty;
                cmd.Parameters.AddWithValue("s3key", NpgsqlDbType.Text, s3keyVal);

                if (dto.DurationSeconds.HasValue)
                    cmd.Parameters.AddWithValue("duration", NpgsqlDbType.Integer, dto.DurationSeconds.Value);
                else
                    cmd.Parameters.AddWithValue("duration", NpgsqlDbType.Integer, DBNull.Value);

                cmd.Parameters.AddWithValue("speaker", NpgsqlDbType.Text, (object?)dto.Preacher ?? DBNull.Value);

                if (!string.IsNullOrWhiteSpace(dto.Date) && DateTime.TryParse(dto.Date, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dt))
                {
                    // store as timestamp (UTC assumed by DateTimeKind handling)
                    cmd.Parameters.AddWithValue("publishedAt", NpgsqlDbType.Timestamp, dt);
                }
                else
                {
                    cmd.Parameters.AddWithValue("publishedAt", NpgsqlDbType.Timestamp, DBNull.Value);
                }

                // YoutubeUrl: allow null
                if (!string.IsNullOrWhiteSpace(dto.YoutubeUrl))
                    cmd.Parameters.AddWithValue("youtube", NpgsqlDbType.Text, dto.YoutubeUrl);
                else
                    cmd.Parameters.AddWithValue("youtube", NpgsqlDbType.Text, DBNull.Value);

                var newIdObj = await cmd.ExecuteScalarAsync();
                if (newIdObj == null) return StatusCode(500, "Insert failed.");

                var newId = Convert.ToInt32(newIdObj);

                var created = new
                {
                    id = newId,
                    title = dto.Title,
                    preacher = dto.Preacher,
                    date = dto.Date,
                    youtubeUrl = string.IsNullOrWhiteSpace(dto.YoutubeUrl) ? null : dto.YoutubeUrl,
                    content = dto.Content,
                    s3Key = s3keyVal,
                    durationSeconds = dto.DurationSeconds
                };

                return CreatedAtAction(nameof(Get), new { id = newId }, created);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating sermon");
                if (_env.IsDevelopment())
                    return StatusCode(500, $"Error creating sermon: {ex.GetType().Name} - {ex.Message}");
                return StatusCode(500, "Error creating sermon.");
            }
        }

        // PUT api/sermons/{id}
        [HttpPut("{id:int}")]
        public async Task<IActionResult> Update(int id, [FromBody] SermonDto dto)
        {
            if (string.IsNullOrWhiteSpace(_connectionString))
            {
                _logger.LogError("Missing connection string 'DefaultConnection'.");
                return StatusCode(500, "Missing connection string 'DefaultConnection'.");
            }

            if (dto == null) return BadRequest("Empty payload.");

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureTenantColumnAsync(conn);
                var tenantId = GetCurrentTenantId();

                // include YoutubeUrl and ensure S3Key not null (fallback to empty string if client omitted)
                const string sql = @"UPDATE ""Sermons"" SET
                                        ""Title"" = @title,
                                        ""Description"" = @desc,
                                        ""S3Key"" = @s3key,
                                        ""DurationSeconds"" = @duration,
                                        ""Speaker"" = @speaker,
                                        ""PublishedAt"" = @publishedAt,
                                        ""YoutubeUrl"" = @youtube
                                     WHERE ""Id"" = @id AND ""TenantId"" = @tenantId
                                     RETURNING ""Id"", ""Title"", ""Description"", ""S3Key"", ""DurationSeconds"", ""Speaker"", ""PublishedAt"", ""YoutubeUrl"";";

                await using var cmd = new NpgsqlCommand(sql, conn) { CommandType = CommandType.Text };
                cmd.Parameters.AddWithValue("id", NpgsqlDbType.Integer, id);
                cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenantId);
                cmd.Parameters.AddWithValue("title", NpgsqlDbType.Text, dto.Title ?? (object)DBNull.Value);
                cmd.Parameters.AddWithValue("desc", NpgsqlDbType.Text, (object?)dto.Content ?? DBNull.Value);

                var s3keyVal = dto.S3Key ?? string.Empty;
                cmd.Parameters.AddWithValue("s3key", NpgsqlDbType.Text, s3keyVal);

                if (dto.DurationSeconds.HasValue)
                    cmd.Parameters.AddWithValue("duration", NpgsqlDbType.Integer, dto.DurationSeconds.Value);
                else
                    cmd.Parameters.AddWithValue("duration", NpgsqlDbType.Integer, DBNull.Value);

                cmd.Parameters.AddWithValue("speaker", NpgsqlDbType.Text, (object?)dto.Preacher ?? DBNull.Value);

                if (!string.IsNullOrWhiteSpace(dto.Date) && DateTime.TryParse(dto.Date, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dt))
                    cmd.Parameters.AddWithValue("publishedAt", NpgsqlDbType.Timestamp, dt);
                else
                    cmd.Parameters.AddWithValue("publishedAt", NpgsqlDbType.Timestamp, DBNull.Value);

                if (!string.IsNullOrWhiteSpace(dto.YoutubeUrl))
                    cmd.Parameters.AddWithValue("youtube", NpgsqlDbType.Text, dto.YoutubeUrl);
                else
                    cmd.Parameters.AddWithValue("youtube", NpgsqlDbType.Text, DBNull.Value);

                await using var reader = await cmd.ExecuteReaderAsync();
                if (!await reader.ReadAsync()) return NotFound();

                DateTime? publishedAt = null;
                if (reader["PublishedAt"] != DBNull.Value)
                    publishedAt = reader.GetFieldValue<DateTime>(reader.GetOrdinal("PublishedAt"));

                var updated = new
                {
                    id = reader["Id"],
                    title = reader["Title"] as string,
                    description = reader["Description"] as string,
                    s3Key = reader["S3Key"] as string,
                    durationSeconds = reader["DurationSeconds"] != DBNull.Value ? (int?)reader.GetInt32(reader.GetOrdinal("DurationSeconds")) : null,
                    speaker = reader["Speaker"] as string,
                    publishedAt = publishedAt?.ToString("o"),
                    youtubeUrl = reader["YoutubeUrl"] != DBNull.Value ? reader["YoutubeUrl"] as string : null
                };

                return Ok(updated);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating sermon {Id}", id);
                if (_env.IsDevelopment())
                    return StatusCode(500, $"Error updating sermon: {ex.GetType().Name} - {ex.Message}");
                return StatusCode(500, "Error updating sermon.");
            }
        }

        // DELETE api/sermons/{id}
        [HttpDelete("{id:int}")]
        public async Task<IActionResult> Delete(int id)
        {
            if (string.IsNullOrWhiteSpace(_connectionString))
            {
                _logger.LogError("Missing connection string 'DefaultConnection'.");
                return StatusCode(500, "Missing connection string 'DefaultConnection'.");
            }

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureTenantColumnAsync(conn);
                var tenantId = GetCurrentTenantId();

                const string sql = @"DELETE FROM ""Sermons"" WHERE ""Id"" = @id AND ""TenantId"" = @tenantId;";
                await using var cmd = new NpgsqlCommand(sql, conn) { CommandType = CommandType.Text };
                cmd.Parameters.AddWithValue("id", NpgsqlDbType.Integer, id);
                cmd.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenantId);

                var affected = await cmd.ExecuteNonQueryAsync();
                if (affected == 0) return NotFound();
                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting sermon {Id}", id);
                if (_env.IsDevelopment())
                    return StatusCode(500, $"Error deleting sermon: {ex.GetType().Name} - {ex.Message}");
                return StatusCode(500, "Error deleting sermon.");
            }
        }

        public class SermonDto
        {
            public string? Title { get; set; }
            public string? Preacher { get; set; }
            public string? Date { get; set; } // accept date as string
            public string? YoutubeUrl { get; set; }
            public string? Content { get; set; }
            public string? S3Key { get; set; }
            public int? DurationSeconds { get; set; }
        }
    }
}
