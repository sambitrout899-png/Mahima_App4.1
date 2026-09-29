﻿using Microsoft.AspNetCore.Mvc;
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
using System.Text.Json;
using Mahima.Api.v3.clean.Dtos;
using Mahima.Api.v3.clean.Hubs;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/[controller]")]
    public class UsersController : ControllerBase
    {
        private readonly string? _connectionString;
        private readonly IConfiguration _configuration;
        private readonly ILogger<UsersController> _logger;
        private readonly IHostEnvironment _env;
        private readonly IPastorBotService _pastorBot;
        private readonly IHubContext<ChatHub> _chatHub;
        private readonly IAppointmentLetterService _appointmentLetters;

        public UsersController(
            IConfiguration configuration,
            ILogger<UsersController> logger,
            IHostEnvironment env,
            IPastorBotService pastorBot,
            IHubContext<ChatHub> chatHub,
            IAppointmentLetterService appointmentLetters)
        {
            _connectionString = configuration.GetConnectionString("DefaultConnection");
            _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
            _env = env ?? throw new ArgumentNullException(nameof(env));
            _pastorBot = pastorBot ?? throw new ArgumentNullException(nameof(pastorBot));
            _chatHub = chatHub ?? throw new ArgumentNullException(nameof(chatHub));
            _appointmentLetters = appointmentLetters ?? throw new ArgumentNullException(nameof(appointmentLetters));
        }

        private async Task SendNewUserWelcomeAsync(Guid userId, string? displayName)
        {
            try
            {
                var sent = await _pastorBot.SendJaiMasihMessageAsync(
                    MinistryMessageFactory.BuildNewUserWelcome(displayName),
                    HttpContext.RequestAborted);

                await _chatHub.Clients.All.SendAsync("ReceiveMessage", sent, HttpContext.RequestAborted);
                _logger.LogInformation("AI Counseller welcome sent for new user {UserId}", userId);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "AI Counseller welcome could not be sent for new user {UserId}", userId);
            }
        }

        private Guid GetCurrentUserId() =>
            Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"), out var id)
                ? id
                : Guid.Empty;

        private Guid GetCurrentTenantId() =>
            Guid.TryParse(User.FindFirstValue("tenant_id"), out var id)
                ? id
                : Guid.Parse("00000000-0000-0000-0000-000000000001");

        private static DateTime? ParsePayloadDate(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            if (DateTimeOffset.TryParse(value, out var dto)) return dto.UtcDateTime;
            if (DateTime.TryParse(value, out var dt)) return EnsureUtc(dt);
            return null;
        }

        private static DateTime EnsureUtc(DateTime value)
        {
            if (value.Kind == DateTimeKind.Utc) return value;
            if (value.Kind == DateTimeKind.Local) return value.ToUniversalTime();
            return DateTime.SpecifyKind(value, DateTimeKind.Utc);
        }

        private static object DbTimestamp(DateTime? value) =>
            value.HasValue ? EnsureUtc(value.Value) : DBNull.Value;

        private static string NormalizePhoneForDuplicateCheck(string? value)
        {
            var digits = new string((value ?? string.Empty).Where(char.IsDigit).ToArray());
            if (digits.Length > 10 && digits.StartsWith("91", StringComparison.Ordinal))
                digits = digits.Substring(digits.Length - 10);

            return digits;
        }

        private static async Task<(Guid Id, string? DisplayName, string? Username, string? Phone)?> FindUserByPhoneAsync(
            NpgsqlConnection conn,
            string? phone,
            Guid? excludeUserId = null)
        {
            var normalizedPhone = NormalizePhoneForDuplicateCheck(phone);
            if (string.IsNullOrWhiteSpace(normalizedPhone))
                return null;

            await using var cmd = new NpgsqlCommand(@"
WITH normalized_users AS (
    SELECT
        id,
        displayname,
        username,
        phone,
        CASE
            WHEN length(raw_phone) > 10 AND raw_phone LIKE '91%' THEN right(raw_phone, 10)
            ELSE raw_phone
        END AS normalized_phone
    FROM (
        SELECT
            id,
            displayname,
            username,
            phone,
            regexp_replace(coalesce(phone, ''), '\D', '', 'g') AS raw_phone
        FROM public.users
    ) u
)
SELECT id, displayname, username, phone
FROM normalized_users
WHERE normalized_phone = @phone
  AND (@excludeUserId IS NULL OR id <> @excludeUserId)
LIMIT 1;", conn);
            cmd.Parameters.AddWithValue("phone", NpgsqlTypes.NpgsqlDbType.Text, normalizedPhone);
            cmd.Parameters.AddWithValue("excludeUserId", NpgsqlTypes.NpgsqlDbType.Uuid, excludeUserId.HasValue ? (object)excludeUserId.Value : DBNull.Value);

            await using var rdr = await cmd.ExecuteReaderAsync();
            if (!await rdr.ReadAsync())
                return null;

            return (
                rdr.GetGuid(rdr.GetOrdinal("id")),
                rdr["displayname"]?.ToString(),
                rdr["username"]?.ToString(),
                rdr["phone"]?.ToString()
            );
        }

        private static ConflictObjectResult DuplicatePhoneConflict((Guid Id, string? DisplayName, string? Username, string? Phone) existing) =>
            new(new
            {
                message = "Mobile number already exists for another user. Please use a unique mobile number.",
                existingUser = new
                {
                    id = existing.Id,
                    name = string.IsNullOrWhiteSpace(existing.DisplayName) ? existing.Username : existing.DisplayName,
                    username = existing.Username,
                    phone = existing.Phone
                }
            });

        private static async Task EnsureUserProfilesTableAsync(NpgsqlConnection conn)
        {
            await using var cmd = new NpgsqlCommand(@"
CREATE TABLE IF NOT EXISTS public.user_profiles (
    user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    status text NULL,
    updated_at_utc timestamp with time zone NOT NULL DEFAULT now()
);", conn);
            await cmd.ExecuteNonQueryAsync();
        }

        private static async Task EnsurePayrollEnabledColumnAsync(NpgsqlConnection conn)
        {
            await using var cmd = new NpgsqlCommand(@"
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS payrollenabled boolean NOT NULL DEFAULT false;", conn);
            await cmd.ExecuteNonQueryAsync();
        }

        private static async Task EnsureUserAccessBlocksAsync(NpgsqlConnection conn)
        {
            await using var cmd = new NpgsqlCommand(@"
CREATE TABLE IF NOT EXISTS public.user_access_blocks (
    user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    reason text NULL,
    blocked_by uuid NULL,
    blocked_at_utc timestamp with time zone NOT NULL DEFAULT now(),
    is_active boolean NOT NULL DEFAULT true
);", conn);
            await cmd.ExecuteNonQueryAsync();
        }

        // DTO used for admin reset via POST /api/users/{id}/reset-password
        public class ResetPasswordDto
        {
            public string? NewPassword { get; set; }
        }

        // DTO for enrichment fields (Birthday -> IsPastor)
        public class EnrichUserDto
        {
            public DateTime? Birthday { get; set; }
            public string? MaritalStatus { get; set; }
            public string? Sex { get; set; }
            public bool? IsBaptized { get; set; }
            public string? BaptismPlace { get; set; }
            public DateTime? BaptismDate { get; set; }
            public bool? IsBornAgain { get; set; }
            public bool? IsBeliever { get; set; }
            public int? Age { get; set; }
            public string? AadharNumber { get; set; }
            public string? HomeAddress { get; set; }
            public string? CurrentAddress { get; set; }
            public string? EmergencyContactPhone { get; set; }
            public bool? IsPastor { get; set; }
        }

        public class UserProfileUpdateDto
        {
            public string? DisplayName { get; set; }
            public string? ProfilePhotoUrl { get; set; }
            public string? Status { get; set; }
        }

        private sealed class UserListItemDto
        {
            public string Id { get; set; } = string.Empty;
            public string? Username { get; set; }
            public string? UserCode { get; set; }
            public string? Email { get; set; }
            public string? DisplayName { get; set; }
            public string? ProfilePhotoUrl { get; set; }
            public string? Status { get; set; }
            public string? Role { get; set; }
            public string? Phone { get; set; }
            public string? JoinDate { get; set; }
            public string? LastLogin { get; set; }
            public string? Birthday { get; set; }
            public string? MaritalStatus { get; set; }
            public string? Sex { get; set; }
            public bool? IsBaptized { get; set; }
            public string? BaptismPlace { get; set; }
            public string? BaptismDate { get; set; }
            public bool? IsBornAgain { get; set; }
            public bool? IsBeliever { get; set; }
            public int? Age { get; set; }
            public string? AadharNumber { get; set; }
            public string? HomeAddress { get; set; }
            public string? CurrentAddress { get; set; }
            public string? EmergencyContactPhone { get; set; }
            public bool? IsPastor { get; set; }
            public bool? PayrollEnabled { get; set; }
            public bool IsBlocked { get; set; }
            public string? BlockReason { get; set; }
            public string? BlockedAtUtc { get; set; }
        }

        // GET api/users?search=&page=1&limit=50
        [HttpGet]
        public async Task<IActionResult> GetAll([FromQuery] string? search, [FromQuery] int page = 1, [FromQuery] int limit = 50, [FromQuery] bool? payrollEnabled = null)
        {
            if (string.IsNullOrWhiteSpace(_connectionString))
            {
                _logger.LogError("Missing connection string 'DefaultConnection'.");
                return StatusCode(500, "Missing connection string 'DefaultConnection'.");
            }

            page = Math.Max(1, page);
            limit = Math.Clamp(limit, 1, 5000);
            var offset = (page - 1) * limit;
            var hasSearch = !string.IsNullOrWhiteSpace(search);

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureUserProfilesTableAsync(conn);
                await EnsurePayrollEnabledColumnAsync(conn);
                await EnsureUserAccessBlocksAsync(conn);
                var columns = await GetUsersColumnsAsync(conn);

                string Expr(params string[] names)
                {
                    var column = names.FirstOrDefault(columns.Contains);
                    return column == null ? "NULL" : $@"u.""{column}""";
                }

                string SelectExpr(string alias, params string[] names) =>
                    $@"{Expr(names)} AS ""{alias}""";

                var idExpr = Expr("id");
                var usernameExpr = Expr("username");
                var emailExpr = Expr("email");
                var displayNameExpr = Expr("displayname");
                var phoneExpr = Expr("phone");
                var roleExpr = Expr("role");
                var joinDateExpr = Expr("joindate");
                var userCodeExpr = Expr("UserCode", "usercode");
                var isDeletedExpr = Expr("isdeleted", "IsDeleted");
                var payrollEnabledExpr = Expr("payrollenabled", "PayrollEnabled", "payroll_enabled");
                var tenantIdExpr = Expr("tenant_id");

                var conditions = new List<string>();
                if (tenantIdExpr != "NULL")
                {
                    conditions.Add($"({tenantIdExpr}) = @tenantId");
                }

                if (isDeletedExpr != "NULL")
                {
                    conditions.Add($"COALESCE(({isDeletedExpr})::boolean, false) = false");
                }
                else
                {
                    conditions.Add($"COALESCE(({usernameExpr})::text, '') NOT ILIKE 'deleted_%'");
                }

                if (hasSearch)
                {
                    conditions.Add(@"(
                            COALESCE((" + usernameExpr + @")::text, '') ILIKE @p ESCAPE '\'
                         OR COALESCE((" + emailExpr + @")::text, '') ILIKE @p ESCAPE '\'
                         OR COALESCE((" + displayNameExpr + @")::text, '') ILIKE @p ESCAPE '\'
                         OR COALESCE((" + phoneExpr + @")::text, '') ILIKE @p ESCAPE '\'
                         OR COALESCE((" + roleExpr + @")::text, '') ILIKE @p ESCAPE '\'
                         OR COALESCE((" + userCodeExpr + @")::text, '') ILIKE @p ESCAPE '\'
                         OR COALESCE((" + idExpr + @")::text, '') ILIKE @p ESCAPE '\')");
                }

                if (payrollEnabled.HasValue)
                {
                    conditions.Add(payrollEnabledExpr == "NULL"
                        ? "false"
                        : $"COALESCE(({payrollEnabledExpr})::boolean, false) = @payrollEnabled");
                }

                var where = conditions.Count > 0 ? "WHERE " + string.Join(" AND ", conditions) : string.Empty;

                var sql = $@"
SELECT COUNT(*) OVER() AS total,
       {SelectExpr("Id", "id")},
       {SelectExpr("Username", "username")},
       {SelectExpr("UserCode", "UserCode", "usercode")},
       {SelectExpr("Email", "email")},
       {SelectExpr("DisplayName", "displayname")},
       {SelectExpr("ProfilePhotoUrl", "profilephotourl", "ProfilePhotoUrl")},
       p.status AS ""Status"",
       {SelectExpr("Role", "role")},
       {SelectExpr("Phone", "phone")},
       {SelectExpr("JoinDate", "joindate")},
       {SelectExpr("LastLogin", "lastlogin")},
       {SelectExpr("Birthday", "Birthday", "birthday")},
       {SelectExpr("MaritalStatus", "MaritalStatus", "maritalstatus")},
       {SelectExpr("Sex", "Sex", "sex")},
       {SelectExpr("IsBaptized", "IsBaptized", "isbaptized")},
       {SelectExpr("BaptismPlace", "BaptismPlace", "baptismplace")},
       {SelectExpr("BaptismDate", "BaptismDate", "baptismdate")},
       {SelectExpr("IsBornAgain", "IsBornAgain", "isbornagain")},
       {SelectExpr("IsBeliever", "IsBeliever", "isbeliever")},
       {SelectExpr("Age", "Age", "age")},
       {SelectExpr("AadharNumber", "AadharNumber", "aadharnumber")},
       {SelectExpr("HomeAddress", "HomeAddress", "homeaddress")},
       {SelectExpr("CurrentAddress", "CurrentAddress", "currentaddress")},
       {SelectExpr("EmergencyContactPhone", "EmergencyContactPhone", "emergencycontactphone")},
       {SelectExpr("IsPastor", "IsPastor", "ispastor")},
       {SelectExpr("PayrollEnabled", "payrollenabled", "PayrollEnabled", "payroll_enabled")},
       COALESCE(b.is_active, false) AS ""IsBlocked"",
       b.reason AS ""BlockReason"",
       b.blocked_at_utc AS ""BlockedAtUtc""
FROM users u
LEFT JOIN public.user_profiles p ON p.user_id = u.id
LEFT JOIN public.user_access_blocks b ON b.user_id = u.id AND b.is_active = true
{where}
ORDER BY ({joinDateExpr}) DESC NULLS LAST, COALESCE(({displayNameExpr})::text, ({usernameExpr})::text, ({emailExpr})::text, '') ASC, ({idExpr}) ASC
LIMIT @limit OFFSET @offset;";

                await using var cmd = new NpgsqlCommand(sql, conn);
                cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, GetCurrentTenantId());
                cmd.Parameters.AddWithValue("limit", NpgsqlTypes.NpgsqlDbType.Integer, limit);
                cmd.Parameters.AddWithValue("offset", NpgsqlTypes.NpgsqlDbType.Integer, offset);
                if (hasSearch)
                {
                    var escaped = search!.Trim().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");
                    cmd.Parameters.AddWithValue("p", NpgsqlTypes.NpgsqlDbType.Text, "%" + escaped + "%");
                }
                if (payrollEnabled.HasValue)
                {
                    cmd.Parameters.AddWithValue("payrollEnabled", NpgsqlTypes.NpgsqlDbType.Boolean, payrollEnabled.Value);
                }

                var items = new List<UserListItemDto>();
                int total = 0;
                await using (var rdr = await cmd.ExecuteReaderAsync())
                {
                    while (await rdr.ReadAsync())
                    {
                        if (total == 0)
                        {
                            var totalValue = rdr["total"];
                            total = totalValue is DBNull ? 0 : Convert.ToInt32(totalValue);
                        }

                        items.Add(ToUserListItem(rdr));
                    }
                }

                if (total == 0 && offset == 0 && items.Count == 0)
                {
                    total = 0;
                }

                return Ok(new { items, total, page, limit });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving users.");
                if (_env.IsDevelopment())
                    return StatusCode(500, $"Error retrieving users: {ex.GetType().Name} - {ex.Message}");
                return StatusCode(500, "Error retrieving users.");
            }
        }

        private static async Task<HashSet<string>> GetUsersColumnsAsync(NpgsqlConnection conn)
        {
            var columns = new HashSet<string>(StringComparer.Ordinal);
            await using var cmd = new NpgsqlCommand(@"
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users';", conn);

            await using var rdr = await cmd.ExecuteReaderAsync();
            while (await rdr.ReadAsync())
            {
                columns.Add(rdr.GetString(0));
            }

            return columns;
        }

        private static async Task<(int Id, string Name)> ResolveRoleAsync(NpgsqlConnection conn, string? requestedRole)
        {
            static async Task<(int Id, string Name)?> ReadRoleAsync(NpgsqlCommand cmd)
            {
                await using var rdr = await cmd.ExecuteReaderAsync();
                if (!await rdr.ReadAsync()) return null;
                return (Convert.ToInt32(rdr["id"]), rdr["name"]?.ToString() ?? "Member");
            }

            if (!string.IsNullOrWhiteSpace(requestedRole))
            {
                if (int.TryParse(requestedRole.Trim(), out var requestedRoleId))
                {
                    await using var cmd = new NpgsqlCommand("SELECT id, name FROM roles WHERE id = @id LIMIT 1;", conn);
                    cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Integer, requestedRoleId);
                    var role = await ReadRoleAsync(cmd);
                    if (role.HasValue) return role.Value;
                }
                else
                {
                    await using var cmd = new NpgsqlCommand("SELECT id, name FROM roles WHERE LOWER(name) = @name LIMIT 1;", conn);
                    cmd.Parameters.AddWithValue("name", NpgsqlTypes.NpgsqlDbType.Text, requestedRole.Trim().ToLowerInvariant());
                    var role = await ReadRoleAsync(cmd);
                    if (role.HasValue) return role.Value;
                }
            }

            await using var memberCmd = new NpgsqlCommand("SELECT id, name FROM roles WHERE LOWER(name) = 'member' LIMIT 1;", conn);
            var member = await ReadRoleAsync(memberCmd);
            return member ?? (2, "Member");
        }

        private static string NormalizeUserCodePrefix(string? value)
        {
            var cleaned = new string((value ?? "MHN").ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
            if (cleaned.Length < 2) cleaned = "MHN";
            return cleaned.Length > 12 ? cleaned[..12] : cleaned;
        }

        private static async Task<string> ReadTenantUserCodePrefixAsync(NpgsqlConnection conn, Guid tenantId)
        {
            await using var columnCmd = new NpgsqlCommand(@"
SELECT 1
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tenants'
  AND column_name = 'user_code_prefix'
LIMIT 1;", conn);
            var hasColumn = await columnCmd.ExecuteScalarAsync() != null;
            if (!hasColumn) return "MHN";

            await using var cmd = new NpgsqlCommand(@"
SELECT user_code_prefix
FROM public.tenants
WHERE id = @tenantId
LIMIT 1;", conn);
            cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
            var value = await cmd.ExecuteScalarAsync();
            return NormalizeUserCodePrefix(value?.ToString());
        }

        private static async Task<string> GenerateTenantUserCodeAsync(NpgsqlConnection conn, Guid tenantId)
        {
            var prefix = await ReadTenantUserCodePrefixAsync(conn, tenantId);
            for (var attempt = 0; attempt < 50; attempt++)
            {
                var code = $"{prefix}{Random.Shared.Next(1, 999999):D6}";
                await using var cmd = new NpgsqlCommand(@"SELECT COUNT(*) FROM public.users WHERE ""UserCode"" = @code;", conn);
                cmd.Parameters.AddWithValue("code", NpgsqlTypes.NpgsqlDbType.Text, code);
                var exists = Convert.ToInt32(await cmd.ExecuteScalarAsync()) > 0;
                if (!exists) return code;
            }

            return $"{prefix}{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() % 100000000:D8}";
        }

        private static string? DbString(IDataRecord rdr, string name)
        {
            var value = rdr[name];
            return value is DBNull ? null : value?.ToString();
        }

        private static int? DbInt(IDataRecord rdr, string name)
        {
            var value = rdr[name];
            if (value is DBNull || value == null) return null;
            if (value is int i) return i;
            if (value is long l && l >= int.MinValue && l <= int.MaxValue) return (int)l;
            return int.TryParse(value.ToString(), out var parsed) ? parsed : null;
        }

        private static bool? DbBool(IDataRecord rdr, string name)
        {
            var value = rdr[name];
            if (value is DBNull || value == null) return null;
            if (value is bool b) return b;

            var text = value.ToString()?.Trim();
            if (string.IsNullOrWhiteSpace(text)) return null;
            if (bool.TryParse(text, out var parsed)) return parsed;
            if (text == "1") return true;
            if (text == "0") return false;
            if (string.Equals(text, "yes", StringComparison.OrdinalIgnoreCase)) return true;
            if (string.Equals(text, "no", StringComparison.OrdinalIgnoreCase)) return false;
            return null;
        }

        private static UserListItemDto ToUserListItem(IDataRecord rdr)
        {
            var idObj = rdr["Id"];
            var idString = idObj is Guid g ? g.ToString() : idObj?.ToString() ?? string.Empty;

            return new UserListItemDto
            {
                Id = idString,
                Username = DbString(rdr, "Username"),
                UserCode = DbString(rdr, "UserCode"),
                Email = DbString(rdr, "Email"),
                DisplayName = DbString(rdr, "DisplayName"),
                ProfilePhotoUrl = DbString(rdr, "ProfilePhotoUrl"),
                Status = DbString(rdr, "Status"),
                Role = DbString(rdr, "Role"),
                Phone = DbString(rdr, "Phone"),
                JoinDate = DbString(rdr, "JoinDate"),
                LastLogin = DbString(rdr, "LastLogin"),
                Birthday = DbString(rdr, "Birthday"),
                MaritalStatus = DbString(rdr, "MaritalStatus"),
                Sex = DbString(rdr, "Sex"),
                IsBaptized = DbBool(rdr, "IsBaptized"),
                BaptismPlace = DbString(rdr, "BaptismPlace"),
                BaptismDate = DbString(rdr, "BaptismDate"),
                IsBornAgain = DbBool(rdr, "IsBornAgain"),
                IsBeliever = DbBool(rdr, "IsBeliever"),
                Age = DbInt(rdr, "Age"),
                AadharNumber = DbString(rdr, "AadharNumber"),
                HomeAddress = DbString(rdr, "HomeAddress"),
                CurrentAddress = DbString(rdr, "CurrentAddress"),
                EmergencyContactPhone = DbString(rdr, "EmergencyContactPhone"),
                IsPastor = DbBool(rdr, "IsPastor"),
                PayrollEnabled = DbBool(rdr, "PayrollEnabled"),
                IsBlocked = DbBool(rdr, "IsBlocked") ?? false,
                BlockReason = DbString(rdr, "BlockReason"),
                BlockedAtUtc = DbString(rdr, "BlockedAtUtc")
            };
        }

        [Authorize]
        [HttpGet("me/profile")]
        public async Task<IActionResult> GetMyProfile()
        {
            var userId = GetCurrentUserId();
            if (userId == Guid.Empty) return Unauthorized();
            if (string.IsNullOrWhiteSpace(_connectionString))
                return StatusCode(500, "Missing connection string");

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureUserProfilesTableAsync(conn);

                await using var cmd = new NpgsqlCommand(@"
SELECT u.id, u.username, u.email, u.displayname, u.profilephotourl, p.status
FROM public.users u
LEFT JOIN public.user_profiles p ON p.user_id = u.id
WHERE u.id = @id
  AND u.tenant_id = @tenantId
LIMIT 1;", conn);
                cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Uuid, userId);
                cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, GetCurrentTenantId());

                await using var rdr = await cmd.ExecuteReaderAsync();
                if (!await rdr.ReadAsync()) return NotFound();

                return Ok(new
                {
                    id = rdr["id"]?.ToString(),
                    username = rdr["username"] is DBNull ? null : rdr["username"]?.ToString(),
                    email = rdr["email"] is DBNull ? null : rdr["email"]?.ToString(),
                    displayName = rdr["displayname"] is DBNull ? null : rdr["displayname"]?.ToString(),
                    profilePhotoUrl = rdr["profilephotourl"] is DBNull ? null : rdr["profilephotourl"]?.ToString(),
                    status = rdr["status"] is DBNull ? null : rdr["status"]?.ToString()
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error reading current user profile.");
                return StatusCode(500, "Error reading profile.");
            }
        }

        [Authorize]
        [HttpPut("me/profile")]
        public async Task<IActionResult> UpdateMyProfile([FromBody] UserProfileUpdateDto dto)
        {
            var userId = GetCurrentUserId();
            if (userId == Guid.Empty) return Unauthorized();
            if (dto == null) return BadRequest("Payload is required.");
            if (string.IsNullOrWhiteSpace(_connectionString))
                return StatusCode(500, "Missing connection string");

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await EnsureUserProfilesTableAsync(conn);

                await using var tx = await conn.BeginTransactionAsync();

                await using (var cmd = new NpgsqlCommand(@"
UPDATE public.users
SET displayname = COALESCE(NULLIF(@displayName, ''), displayname),
    profilephotourl = COALESCE(NULLIF(@photo, ''), profilephotourl)
WHERE id = @id AND tenant_id = @tenantId;", conn, tx))
                {
                    cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Uuid, userId);
                    cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, GetCurrentTenantId());
                    cmd.Parameters.AddWithValue("displayName", NpgsqlTypes.NpgsqlDbType.Text, (object?)dto.DisplayName?.Trim() ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("photo", NpgsqlTypes.NpgsqlDbType.Text, (object?)dto.ProfilePhotoUrl?.Trim() ?? DBNull.Value);
                    await cmd.ExecuteNonQueryAsync();
                }

                await using (var statusCmd = new NpgsqlCommand(@"
INSERT INTO public.user_profiles (user_id, status, updated_at_utc)
VALUES (@id, @status, now())
ON CONFLICT (user_id)
DO UPDATE SET status = EXCLUDED.status, updated_at_utc = now();", conn, tx))
                {
                    statusCmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Uuid, userId);
                    statusCmd.Parameters.AddWithValue("status", NpgsqlTypes.NpgsqlDbType.Text, (object?)(dto.Status ?? string.Empty).Trim() ?? DBNull.Value);
                    await statusCmd.ExecuteNonQueryAsync();
                }

                await tx.CommitAsync();
                return await GetMyProfile();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating current user profile.");
                return StatusCode(500, "Error updating profile.");
            }
        }

        // PUT api/users/{id}/enrich
        [HttpPut("{id:guid}/enrich")]
        [HttpPut("{id}/enrich")]
        //public async Task<IActionResult> EnrichUser(Guid id, [FromBody] EnrichUserDto dto)
        public async Task<IActionResult> EnrichUser(string id, [FromBody] EnrichUserDto dto)
        {
		Console.WriteLine("🔥 Enrich API HIT");
		Console.WriteLine($"ID FROM URL: {id}");
		Console.WriteLine($"DTO AGE: {dto.Age}");
		Console.WriteLine($"DTO Birthday: {dto.Birthday}");
            if (string.IsNullOrWhiteSpace(_connectionString))
            {
                _logger.LogError("Missing connection string 'DefaultConnection'.");
                return StatusCode(500, "Missing connection string 'DefaultConnection'.");
            }

            if (dto == null)
                return BadRequest("Payload is required.");

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

           var cmd = new NpgsqlCommand
{
    Connection = conn,
    CommandType = CommandType.Text,
    CommandText = @"
UPDATE users SET
    ""Birthday"" = @Birthday,
    ""MaritalStatus"" = @MaritalStatus,
    ""Sex"" = @Sex,
    ""IsBaptized"" = @IsBaptized,
    ""BaptismPlace"" = @BaptismPlace,
    ""BaptismDate"" = @BaptismDate,
    ""IsBornAgain"" = @IsBornAgain,
    ""IsBeliever"" = @IsBeliever,
    ""Age"" = @Age,
    ""AadharNumber"" = @AadharNumber,
    ""HomeAddress"" = @HomeAddress,
    ""CurrentAddress"" = @CurrentAddress,
    ""EmergencyContactPhone"" = @EmergencyContactPhone,
    ""IsPastor"" = @IsPastor
WHERE id = @Id AND tenant_id = @TenantId;
"
};             //cmd.Parameters.AddWithValue("Id", NpgsqlTypes.NpgsqlDbType.Uuid, id);
                var isGuid = Guid.TryParse(id, out var guidId);

        if (isGuid)
        cmd.Parameters.AddWithValue("Id", NpgsqlTypes.NpgsqlDbType.Uuid, guidId);
        else
        cmd.Parameters.AddWithValue("Id", NpgsqlTypes.NpgsqlDbType.Text, id);
                cmd.Parameters.AddWithValue("TenantId", NpgsqlTypes.NpgsqlDbType.Uuid, GetCurrentTenantId());
                object DbNullIfNull(object? v) => v ?? DBNull.Value;

                cmd.Parameters.AddWithValue("Birthday",
                    NpgsqlTypes.NpgsqlDbType.TimestampTz,
                    DbTimestamp(dto.Birthday));

                cmd.Parameters.AddWithValue("BaptismDate",
                    NpgsqlTypes.NpgsqlDbType.TimestampTz,
                    DbTimestamp(dto.BaptismDate));

                cmd.Parameters.AddWithValue("MaritalStatus", NpgsqlTypes.NpgsqlDbType.Text, DbNullIfNull(dto.MaritalStatus));
                cmd.Parameters.AddWithValue("Sex", NpgsqlTypes.NpgsqlDbType.Text, DbNullIfNull(dto.Sex));
                cmd.Parameters.AddWithValue("BaptismPlace", NpgsqlTypes.NpgsqlDbType.Text, DbNullIfNull(dto.BaptismPlace));
                cmd.Parameters.AddWithValue("AadharNumber", NpgsqlTypes.NpgsqlDbType.Text, DbNullIfNull(dto.AadharNumber));
                cmd.Parameters.AddWithValue("HomeAddress", NpgsqlTypes.NpgsqlDbType.Text, DbNullIfNull(dto.HomeAddress));
                cmd.Parameters.AddWithValue("CurrentAddress", NpgsqlTypes.NpgsqlDbType.Text, DbNullIfNull(dto.CurrentAddress));
                cmd.Parameters.AddWithValue("EmergencyContactPhone", NpgsqlTypes.NpgsqlDbType.Text, DbNullIfNull(dto.EmergencyContactPhone));

                if (dto.Age.HasValue)
                    cmd.Parameters.AddWithValue("Age", NpgsqlTypes.NpgsqlDbType.Integer, dto.Age.Value);
                else
                    cmd.Parameters.AddWithValue("Age", NpgsqlTypes.NpgsqlDbType.Integer, DBNull.Value);

                if (dto.IsBaptized.HasValue)
                    cmd.Parameters.AddWithValue("IsBaptized", NpgsqlTypes.NpgsqlDbType.Boolean, dto.IsBaptized.Value);
                else
                    cmd.Parameters.AddWithValue("IsBaptized", NpgsqlTypes.NpgsqlDbType.Boolean, DBNull.Value);

                if (dto.IsBornAgain.HasValue)
                    cmd.Parameters.AddWithValue("IsBornAgain", NpgsqlTypes.NpgsqlDbType.Boolean, dto.IsBornAgain.Value);
                else
                    cmd.Parameters.AddWithValue("IsBornAgain", NpgsqlTypes.NpgsqlDbType.Boolean, DBNull.Value);

                if (dto.IsBeliever.HasValue)
                    cmd.Parameters.AddWithValue("IsBeliever", NpgsqlTypes.NpgsqlDbType.Boolean, dto.IsBeliever.Value);
                else
                    cmd.Parameters.AddWithValue("IsBeliever", NpgsqlTypes.NpgsqlDbType.Boolean, DBNull.Value);

                if (dto.IsPastor.HasValue)
                    cmd.Parameters.AddWithValue("IsPastor", NpgsqlTypes.NpgsqlDbType.Boolean, dto.IsPastor.Value);
                else
                    cmd.Parameters.AddWithValue("IsPastor", NpgsqlTypes.NpgsqlDbType.Boolean, DBNull.Value);

                var rows = await cmd.ExecuteNonQueryAsync();
                if (rows == 0) return NotFound();

                return NoContent();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error enriching user {Id}", id);
                if (_env.IsDevelopment())
                    return StatusCode(500, $"Error enriching user: {ex.GetType().Name} - {ex.Message}");
                return StatusCode(500, "Error enriching user.");
            }
        }

        // GET api/users/{id}
        [HttpGet("{id}")]
        public async Task<IActionResult> GetById(string id)
        {
            if (string.IsNullOrWhiteSpace(_connectionString))
            {
                _logger.LogError("Missing connection string 'DefaultConnection'.");
                return StatusCode(500, "Missing connection string 'DefaultConnection'.");
            }

            object? user = null;

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var isGuid = Guid.TryParse(id, out var guidId);
                var isInt = int.TryParse(id, out var intId);
                var isLong = long.TryParse(id, out var longId);

                NpgsqlCommand cmd;
                if (isGuid)
                {
                    cmd = new NpgsqlCommand(@"SELECT
                                                  id          AS ""Id"",
                                                  username    AS ""Username"",
                                                  email       AS ""Email"",
                                                  displayname AS ""DisplayName"",
                            profilephotourl AS ""ProfilePhotoUrl"",
                                                  phone       AS ""Phone"",
                                                  role        AS ""Role"",
                                                  joindate    AS ""JoinDate""
                                              FROM users
                                              WHERE id = @id AND tenant_id = @tenantId", conn);
                    cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Uuid, guidId);
                    cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, GetCurrentTenantId());
                }
                else if (isInt)
                {
                    cmd = new NpgsqlCommand(@"SELECT
                                                  id          AS ""Id"",
                                                  username    AS ""Username"",
                                                  email       AS ""Email"",
                                                  displayname AS ""DisplayName"",
                            profilephotourl AS ""ProfilePhotoUrl"",
                                                  phone       AS ""Phone"",
                                                  role        AS ""Role"",
                                                  joindate    AS ""JoinDate""
                                              FROM users
                                              WHERE id = @id AND tenant_id = @tenantId", conn);
                    cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Integer, intId);
                    cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, GetCurrentTenantId());
                }
                else if (isLong)
                {
                    cmd = new NpgsqlCommand(@"SELECT
                                                  id          AS ""Id"",
                                                  username    AS ""Username"",
                                                  email       AS ""Email"",
                                                  displayname AS ""DisplayName"",
                            profilephotourl AS ""ProfilePhotoUrl"",
                                                  phone       AS ""Phone"",
                                                  role        AS ""Role"",
                                                  joindate    AS ""JoinDate""
                                              FROM users
                                              WHERE id = @id AND tenant_id = @tenantId", conn);
                    cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Bigint, longId);
                    cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, GetCurrentTenantId());
                }
                else
                {
                    cmd = new NpgsqlCommand(@"SELECT
                                                  id          AS ""Id"",
                                                  username    AS ""Username"",
                                                  email       AS ""Email"",
                                                  displayname AS ""DisplayName"",
                            profilephotourl AS ""ProfilePhotoUrl"",
                                                  phone       AS ""Phone"",
                                                  role        AS ""Role"",
                                                  joindate    AS ""JoinDate""
                                              FROM users
                                              WHERE cast(id as text) = @id AND tenant_id = @tenantId", conn);
                    cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Text, id);
                    cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, GetCurrentTenantId());
                }

                await using var rdr = await cmd.ExecuteReaderAsync();
                if (await rdr.ReadAsync())
                {
                    var idObj = rdr["Id"];
                    string idString = idObj is Guid g ? g.ToString() : idObj?.ToString() ?? string.Empty;
                    var username = rdr["Username"] is DBNull ? null : rdr["Username"]?.ToString();
                    var email = rdr["Email"] is DBNull ? null : rdr["Email"]?.ToString();
                    var displayName = rdr["DisplayName"] is DBNull ? null : rdr["DisplayName"]?.ToString();
                    var profilePhotoUrl = rdr["ProfilePhotoUrl"] is DBNull ? null : rdr["ProfilePhotoUrl"]?.ToString();
                    var phone = rdr["Phone"] is DBNull ? null : rdr["Phone"]?.ToString();
                    var role = rdr["Role"] is DBNull ? null : rdr["Role"]?.ToString();
                    var joinDate = rdr["JoinDate"] is DBNull ? null : rdr["JoinDate"]?.ToString();

                    user = new
                    {
                        id = idString,
                        username,
                        email,
                        displayName,
                        profilePhotoUrl,
                        phone,
                        role,
                        joinDate
                    };
                }

                if (user == null) return NotFound();
                return Ok(user);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving user by id {Id}.", id);
                if (_env.IsDevelopment())
                    return StatusCode(500, $"Error retrieving user: {ex.GetType().Name} - {ex.Message}");
                return StatusCode(500, "Error retrieving user.");
            }
        }

        // POST api/users
[HttpPost]
public async Task<IActionResult> Create([FromBody] JsonElement body)
{
    if (string.IsNullOrWhiteSpace(_connectionString))
        return StatusCode(500, "Missing connection string");

    try
    {
        string? Get(JsonElement root, params string[] names)
{
    foreach (var n in names)
    {
        foreach (var p in root.EnumerateObject())
        {
            if (string.Equals(p.Name, n, StringComparison.OrdinalIgnoreCase))
            {
                if (p.Value.ValueKind == JsonValueKind.Null)
                    continue;

                var val = p.Value.ToString();

                if (!string.IsNullOrWhiteSpace(val))
                    return val;
            }
        }
    }
    return null;
}
        bool? GetBool(JsonElement root, params string[] names)
        {
            var val = Get(root, names);
            return bool.TryParse(val, out var b) ? b : (bool?)null;
        }

        int? GetInt(JsonElement root, params string[] names)
        {
            var val = Get(root, names);
            return int.TryParse(val, out var i) ? i : (int?)null;
        }

        DateTime? GetDate(JsonElement root, params string[] names)
        {
            var val = Get(root, names);
            return ParsePayloadDate(val);
        }

        // 🔹 BASIC FIELDS
        var username = Get(body, "username");
        var email = Get(body, "email");
        var password = Get(body, "password");
        var phone = Get(body, "phone");
        var displayName = Get(body, "displayname", "displayName", "name");
        var profilePhotoUrl = Get(body, "ProfilePhotoUrl", "profilePhotoUrl", "AvatarUrl", "avatarUrl", "PhotoUrl", "photoUrl");
        var requestedRole = Get(body, "Role", "role", "RoleId", "roleId", "RoleName", "roleName");
        var joinDate = GetDate(body, "JoinDate", "joinDate") ?? DateTime.UtcNow;

        if (string.IsNullOrWhiteSpace(username))
            return BadRequest("username required");

        if (string.IsNullOrWhiteSpace(password))
            return BadRequest("password required");

        var tenantId = GetCurrentTenantId();
        if (tenantId == Guid.Empty)
            return BadRequest(new { message = "Tenant context is missing. Please login again for the correct church." });

        // 🔥 HASH PASSWORD
        var hasher = new Microsoft.AspNetCore.Identity.PasswordHasher<string>();
        var hash = hasher.HashPassword(username, password);

        // 🔹 ENRICH FIELDS
        var birthday = GetDate(body, "Birthday", "birthday");
        var maritalStatus = Get(body, "MaritalStatus", "maritalStatus");
        var sex = Get(body, "Sex", "sex");
        var isBaptized = GetBool(body, "IsBaptized", "isBaptized");
        var baptismPlace = Get(body, "BaptismPlace", "baptismPlace");
        var baptismDate = GetDate(body, "BaptismDate", "baptismDate");
        var isBornAgain = GetBool(body, "IsBornAgain", "isBornAgain");
        var isBeliever = GetBool(body, "IsBeliever", "isBeliever");
        var age = GetInt(body, "Age", "age");
        var aadhar = Get(body, "AadharNumber", "aadharNumber");
        var homeAddress = Get(body, "HomeAddress", "homeAddress");
        var currentAddress = Get(body, "CurrentAddress", "currentAddress");
        var emergencyPhone = Get(body, "EmergencyContactPhone", "emergencyContactPhone");
        var isPastor = GetBool(body, "IsPastor", "isPastor");
        var payrollEnabled = GetBool(body, "PayrollEnabled", "payrollEnabled", "IsPayrollEnabled", "isPayrollEnabled");

        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync();
        await EnsurePayrollEnabledColumnAsync(conn);
        var existingUserWithPhone = await FindUserByPhoneAsync(conn, phone);
        if (existingUserWithPhone.HasValue)
            return DuplicatePhoneConflict(existingUserWithPhone.Value);

        var (roleId, roleName) = await ResolveRoleAsync(conn, requestedRole);

        await using (var duplicateCmd = new NpgsqlCommand(@"
SELECT 1
FROM users
WHERE tenant_id = @tenantId
  AND (
    lower(username) = lower(@username)
    OR (@email IS NOT NULL AND email IS NOT NULL AND lower(email) = lower(@email))
  )
LIMIT 1;", conn))
        {
            duplicateCmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
            duplicateCmd.Parameters.AddWithValue("username", NpgsqlTypes.NpgsqlDbType.Text, username);
            duplicateCmd.Parameters.AddWithValue("email", NpgsqlTypes.NpgsqlDbType.Text, (object?)email ?? DBNull.Value);
            var exists = await duplicateCmd.ExecuteScalarAsync();
            if (exists != null)
                return Conflict(new { message = "A user with this username or email already exists in this church." });
        }

        var userCode = await GenerateTenantUserCodeAsync(conn, tenantId);

        const string sql = @"
INSERT INTO users (
    username, ""UserCode"", email, passwordhash, role, joindate, phone, displayname, profilephotourl, tenant_id,
    ""Birthday"", ""MaritalStatus"", ""Sex"", ""IsBaptized"", ""BaptismPlace"",
    ""BaptismDate"", ""IsBornAgain"", ""IsBeliever"", ""Age"",
    ""AadharNumber"", ""HomeAddress"", ""CurrentAddress"",
    ""EmergencyContactPhone"", ""IsPastor"", payrollenabled
)
VALUES (
    @username, @userCode, @email, @passwordhash, @role, @JoinDate, @phone, @displayname, @profilePhotoUrl, @tenantId,
    @Birthday, @MaritalStatus, @Sex, @IsBaptized, @BaptismPlace,
    @BaptismDate, @IsBornAgain, @IsBeliever, @Age,
    @AadharNumber, @HomeAddress, @CurrentAddress,
    @EmergencyContactPhone, @IsPastor, @PayrollEnabled
)
RETURNING id;
";

        await using var cmd = new NpgsqlCommand(sql, conn);

        // 🔹 BASIC PARAMS
        cmd.Parameters.AddWithValue("username", NpgsqlTypes.NpgsqlDbType.Text, username);
        cmd.Parameters.AddWithValue("userCode", NpgsqlTypes.NpgsqlDbType.Text, userCode);
        cmd.Parameters.AddWithValue("email", NpgsqlTypes.NpgsqlDbType.Text, (object?)email ?? DBNull.Value);
        cmd.Parameters.AddWithValue("passwordhash", NpgsqlTypes.NpgsqlDbType.Text, hash);
        cmd.Parameters.AddWithValue("role", NpgsqlTypes.NpgsqlDbType.Text, roleId.ToString());
        cmd.Parameters.AddWithValue("JoinDate", NpgsqlTypes.NpgsqlDbType.TimestampTz, DbTimestamp(joinDate));
        cmd.Parameters.AddWithValue("phone", NpgsqlTypes.NpgsqlDbType.Text, (object?)phone ?? DBNull.Value);
        cmd.Parameters.AddWithValue("displayname",
            NpgsqlTypes.NpgsqlDbType.Text,
            !string.IsNullOrWhiteSpace(displayName) ? displayName : username);
        cmd.Parameters.AddWithValue("profilePhotoUrl", NpgsqlTypes.NpgsqlDbType.Text, (object?)profilePhotoUrl ?? DBNull.Value);
        cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);

        // 🔹 ENRICH PARAMS
        cmd.Parameters.AddWithValue("Birthday", NpgsqlTypes.NpgsqlDbType.TimestampTz, DbTimestamp(birthday));
	cmd.Parameters.AddWithValue("MaritalStatus", NpgsqlTypes.NpgsqlDbType.Text, maritalStatus ?? (object)DBNull.Value);
	cmd.Parameters.AddWithValue("Sex", NpgsqlTypes.NpgsqlDbType.Text, sex ?? (object)DBNull.Value);
	cmd.Parameters.AddWithValue("IsBaptized", NpgsqlTypes.NpgsqlDbType.Boolean, isBaptized ?? (object)DBNull.Value);
	cmd.Parameters.AddWithValue("BaptismPlace", NpgsqlTypes.NpgsqlDbType.Text, baptismPlace ?? (object)DBNull.Value);
	cmd.Parameters.AddWithValue("BaptismDate", NpgsqlTypes.NpgsqlDbType.TimestampTz, DbTimestamp(baptismDate));
	cmd.Parameters.AddWithValue("IsBornAgain", NpgsqlTypes.NpgsqlDbType.Boolean, isBornAgain ?? (object)DBNull.Value);
	cmd.Parameters.AddWithValue("IsBeliever", NpgsqlTypes.NpgsqlDbType.Boolean, isBeliever ?? (object)DBNull.Value);
	cmd.Parameters.AddWithValue("AadharNumber", NpgsqlTypes.NpgsqlDbType.Text, aadhar ?? (object)DBNull.Value);
	cmd.Parameters.AddWithValue("HomeAddress", NpgsqlTypes.NpgsqlDbType.Text, homeAddress ?? (object)DBNull.Value);
	cmd.Parameters.AddWithValue("CurrentAddress", NpgsqlTypes.NpgsqlDbType.Text, currentAddress ?? (object)DBNull.Value);
	cmd.Parameters.AddWithValue("EmergencyContactPhone", NpgsqlTypes.NpgsqlDbType.Text, emergencyPhone ?? (object)DBNull.Value);
	cmd.Parameters.AddWithValue("IsPastor", NpgsqlTypes.NpgsqlDbType.Boolean, isPastor ?? (object)DBNull.Value);
	cmd.Parameters.AddWithValue("PayrollEnabled", NpgsqlTypes.NpgsqlDbType.Boolean, payrollEnabled ?? false);
        cmd.Parameters.AddWithValue("Age", NpgsqlTypes.NpgsqlDbType.Integer, age ?? (object)DBNull.Value);
        
	
        var id = await cmd.ExecuteScalarAsync();
        var createdUserId = Guid.TryParse(id?.ToString(), out var createdGuid) ? createdGuid : Guid.Empty;
        _logger.LogInformation("New user {UserId} queued for AI Counseller welcome dashboard approval.", createdUserId);

        return Ok(new
        {
            id,
            userCode,
            username,
            email,
            phone,
            displayName,
            profilePhotoUrl,
            role = roleName,
            birthday,
            maritalStatus,
            sex,
            age,
            payrollEnabled = payrollEnabled ?? false
        });
    }
    catch (Exception ex)
    {
        _logger.LogError(ex, "Create user failed");
        if (ex is PostgresException pg && pg.SqlState == PostgresErrorCodes.UniqueViolation)
            return Conflict(new { message = "A user with the same username, email, phone, or user code already exists." });

        return StatusCode(500, new { message = $"Create user failed: {ex.Message}" });
    }
}

        private static async Task<int> SoftDeleteUserAsync(
            NpgsqlConnection conn,
            string id,
            bool isGuid,
            Guid guidId,
            bool isInt,
            int intId,
            bool isLong,
            long longId,
            Guid tenantId)
        {
            var columns = await GetUsersColumnsAsync(conn);
            string? Column(params string[] names) => names.FirstOrDefault(columns.Contains);

            var sets = new List<string>();
            await using var cmd = new NpgsqlCommand { Connection = conn, CommandType = CommandType.Text };

            void SetText(string param, object? value, params string[] names)
            {
                var column = Column(names);
                if (column == null) return;
                sets.Add($@"""{column}"" = @{param}");
                cmd.Parameters.AddWithValue(param, NpgsqlTypes.NpgsqlDbType.Text, value ?? DBNull.Value);
            }

            void SetBool(string param, bool value, params string[] names)
            {
                var column = Column(names);
                if (column == null) return;
                sets.Add($@"""{column}"" = @{param}");
                cmd.Parameters.AddWithValue(param, NpgsqlTypes.NpgsqlDbType.Boolean, value);
            }

            var shortId = id.Length > 8 ? id.Substring(0, 8) : id;
            var disabledHash = new Microsoft.AspNetCore.Identity.PasswordHasher<object>()
                .HashPassword(null, Guid.NewGuid().ToString("N"));

            SetText("deletedUsername", $"deleted_{shortId}", "username");
            SetText("deletedEmail", null, "email");
            SetText("deletedPhone", null, "phone");
            SetText("deletedDisplay", "Deleted User", "displayname");
            SetText("deletedPhoto", null, "profilephotourl", "ProfilePhotoUrl");
            SetText("deletedHash", disabledHash, "passwordhash");
            SetBool("isDeleted", true, "isdeleted", "IsDeleted");

            var deletedAt = Column("deletedat", "DeletedAt");
            if (deletedAt != null) sets.Add($@"""{deletedAt}"" = NOW()");

            if (sets.Count == 0) return 0;

            if (isGuid)
            {
                cmd.CommandText = $@"UPDATE users SET {string.Join(", ", sets)} WHERE id = @id AND tenant_id = @tenantId";
                cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Uuid, guidId);
            }
            else if (isInt)
            {
                cmd.CommandText = $@"UPDATE users SET {string.Join(", ", sets)} WHERE id = @id AND tenant_id = @tenantId";
                cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Integer, intId);
            }
            else if (isLong)
            {
                cmd.CommandText = $@"UPDATE users SET {string.Join(", ", sets)} WHERE id = @id AND tenant_id = @tenantId";
                cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Bigint, longId);
            }
            else
            {
                cmd.CommandText = $@"UPDATE users SET {string.Join(", ", sets)} WHERE cast(id as text) = @id AND tenant_id = @tenantId";
                cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Text, id);
            }
            cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);

            return await cmd.ExecuteNonQueryAsync();
        }

        // DELETE api/users/{id}
        [HttpDelete("{id:guid}")]
        [HttpDelete("{id}")]
        public async Task<IActionResult> Delete(string id)
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

                var isGuid = Guid.TryParse(id, out var guidId);
                var isInt = int.TryParse(id, out var intId);
                var isLong = long.TryParse(id, out var longId);

                var fkSql = @"
                SELECT kcu.table_schema, kcu.table_name, kcu.column_name, tc.constraint_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage ccu
                  ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
                WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'users';
                ";
                var referencing = new List<(string Schema, string Table, string Column, string Constraint)>();
                await using (var fkCmd = new NpgsqlCommand(fkSql, conn))
                await using (var fkRdr = await fkCmd.ExecuteReaderAsync())
                {
                    while (await fkRdr.ReadAsync())
                    {
                        referencing.Add((
                            fkRdr.GetString(0),
                            fkRdr.GetString(1),
                            fkRdr.GetString(2),
                            fkRdr.GetString(3)
                        ));
                    }
                }

                var blockers = new List<object>();
                foreach (var r in referencing)
                {
                    var countSql = $@"SELECT COUNT(*) FROM ""{r.Schema}"".""{r.Table}"" WHERE ""{r.Column}"" = @id";
                    await using var countCmd = new NpgsqlCommand(countSql, conn);

                    if (isGuid) countCmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Uuid, guidId);
                    else if (isInt) countCmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Integer, intId);
                    else if (isLong) countCmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Bigint, longId);
                    else countCmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Text, id);

                    var cntObj = await countCmd.ExecuteScalarAsync();
                    var cnt = cntObj is DBNull ? 0 : Convert.ToInt32(cntObj);
                    if (cnt > 0)
                    {
                        blockers.Add(new { table = r.Table, schema = r.Schema, column = r.Column, constraint = r.Constraint, count = cnt });
                    }
                }

                if (blockers.Count > 0)
                {
                    var softRows = await SoftDeleteUserAsync(conn, id, isGuid, guidId, isInt, intId, isLong, longId, GetCurrentTenantId());
                    if (softRows == 0) return NotFound();

                    return Ok(new
                    {
                        message = "User deleted.",
                        softDeleted = true,
                        references = blockers
                    });
                }

                await using var delCmd = new NpgsqlCommand { Connection = conn, CommandType = CommandType.Text };
                if (isGuid)
                {
                    delCmd.CommandText = @"DELETE FROM users WHERE id = @id AND tenant_id = @tenantId";
                    delCmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Uuid, guidId);
                }
                else if (isInt)
                {
                    delCmd.CommandText = @"DELETE FROM users WHERE id = @id AND tenant_id = @tenantId";
                    delCmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Integer, intId);
                }
                else if (isLong)
                {
                    delCmd.CommandText = @"DELETE FROM users WHERE id = @id AND tenant_id = @tenantId";
                    delCmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Bigint, longId);
                }
                else
                {
                    delCmd.CommandText = @"DELETE FROM users WHERE cast(id as text) = @id AND tenant_id = @tenantId";
                    delCmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Text, id);
                }
                delCmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, GetCurrentTenantId());

                var rows = await delCmd.ExecuteNonQueryAsync();
                if (rows == 0) return NotFound();

                return Ok(new { message = "User deleted.", softDeleted = false });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting user {Id}", id);
                if (_env.IsDevelopment())
                    return StatusCode(500, $"Error deleting user: {ex.GetType().Name} - {ex.Message}");
                return StatusCode(500, "Error deleting user.");
            }
        }

        // Reset password (admin-style). Supports GUID and non-GUID ids.
        [HttpPost("{id:guid}/reset-password")]
        [HttpPost("{id}/reset-password")]
        public async Task<IActionResult> ResetPassword(string id, [FromBody] ResetPasswordDto dto)
        {
            if (string.IsNullOrWhiteSpace(_connectionString))
            {
                _logger.LogError("Missing connection string 'DefaultConnection'.");
                return StatusCode(500, "Missing connection string 'DefaultConnection'.");
            }

            if (dto == null || string.IsNullOrWhiteSpace(dto.NewPassword))
                return BadRequest("newPassword is required.");

            if (dto.NewPassword!.Length < 6)
                return BadRequest("Password must be at least 6 characters long.");

            try
            {
                //var pwHasher = new Microsoft.AspNetCore.Identity.PasswordHasher<object>();
                //var newHash = pwHasher.HashPassword(null, dto.NewPassword);
				
				var pwHasher = new Microsoft.AspNetCore.Identity.PasswordHasher<string>();
				var newHash = pwHasher.HashPassword("reset", dto.NewPassword);

                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();

                var isGuid = Guid.TryParse(id, out var guidId);
                var isInt = int.TryParse(id, out var intId);
                var isLong = long.TryParse(id, out var longId);

                await using var cmd = new NpgsqlCommand { Connection = conn, CommandType = CommandType.Text };

                if (isGuid)
                {
                    cmd.CommandText = @"UPDATE users SET passwordhash = @ph WHERE id = @id AND tenant_id = @tenantId";
                    cmd.Parameters.AddWithValue("ph", NpgsqlTypes.NpgsqlDbType.Text, newHash);
                    cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Uuid, guidId);
                }
                else if (isInt)
                {
                    cmd.CommandText = @"UPDATE users SET passwordhash = @ph WHERE id = @id AND tenant_id = @tenantId";
                    cmd.Parameters.AddWithValue("ph", NpgsqlTypes.NpgsqlDbType.Text, newHash);
                    cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Integer, intId);
                }
                else if (isLong)
                {
                    cmd.CommandText = @"UPDATE users SET passwordhash = @ph WHERE id = @id AND tenant_id = @tenantId";
                    cmd.Parameters.AddWithValue("ph", NpgsqlTypes.NpgsqlDbType.Text, newHash);
                    cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Bigint, longId);
                }
                else
                {
                    cmd.CommandText = @"UPDATE users SET passwordhash = @ph WHERE cast(id as text) = @id AND tenant_id = @tenantId";
                    cmd.Parameters.AddWithValue("ph", NpgsqlTypes.NpgsqlDbType.Text, newHash);
                    cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Text, id);
                }
                cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, GetCurrentTenantId());

                var rows = await cmd.ExecuteNonQueryAsync();
                if (rows == 0) return NotFound();

                return Ok(new { message = "Password reset successfully (admin reset)." });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error resetting password for user {Id}", id);
                if (_env.IsDevelopment())
                    return StatusCode(500, $"Error resetting password: {ex.GetType().Name} - {ex.Message}");
                return StatusCode(500, "Error resetting password.");
            }
        }

        // Update: accept PUT or PATCH to support different frontend clients
        [HttpPatch("{id:guid}")]
[HttpPut("{id}")]
public async Task<IActionResult> UpdateUser(string id, [FromBody] JsonElement body)
{
Console.WriteLine("🔥 UPDATE API HIT");
Console.WriteLine(body.ToString());

    if (string.IsNullOrWhiteSpace(_connectionString))
        return StatusCode(500, "Missing connection string");

    try
    {
        // 🔥 FIXED HELPERS (robust)
        string? Get(JsonElement root, params string[] names)
        {
            foreach (var prop in root.EnumerateObject())
            {
                foreach (var name in names)
                {
                    if (string.Equals(prop.Name, name, StringComparison.OrdinalIgnoreCase))
                    {
                        if (prop.Value.ValueKind == JsonValueKind.Null)
                            return null;

                        return prop.Value.ToString();
                    }
                }
            }
            return null;
        }

        int? GetInt(JsonElement root, params string[] names)
        {
            var val = Get(root, names);
            return int.TryParse(val, out var i) ? i : null;
        }

        bool? GetBool(JsonElement root, params string[] names)
        {
            var val = Get(root, names);
            return bool.TryParse(val, out var b) ? b : null;
        }

        DateTime? GetDate(JsonElement root, params string[] names)
        {
            var val = Get(root, names);
            return ParsePayloadDate(val);
        }

        // 🔹 BASIC
        var username = Get(body, "Username", "username");
        var displayName = Get(body, "DisplayName", "displayName");
        var profilePhotoUrl = Get(body, "ProfilePhotoUrl", "profilePhotoUrl", "AvatarUrl", "avatarUrl", "PhotoUrl", "photoUrl");
        var email = Get(body, "Email", "email");
        var phone = Get(body, "Phone", "phone");
        var role = Get(body, "Role", "role");
        var joinDate = GetDate(body, "JoinDate", "joinDate");

        // 🔹 ENRICH
        var birthday = GetDate(body, "Birthday", "birthday");
        var maritalStatus = Get(body, "MaritalStatus", "maritalStatus");
        var sex = Get(body, "Sex", "sex");
        var isBaptized = GetBool(body, "IsBaptized", "isBaptized");
        var baptismPlace = Get(body, "BaptismPlace", "baptismPlace");
        var baptismDate = GetDate(body, "BaptismDate", "baptismDate");
        var isBornAgain = GetBool(body, "IsBornAgain", "isBornAgain");
        var isBeliever = GetBool(body, "IsBeliever", "isBeliever");
        var age = GetInt(body, "Age", "age");
        var aadhar = Get(body, "AadharNumber", "aadharNumber");
        var homeAddress = Get(body, "HomeAddress", "homeAddress");
        var currentAddress = Get(body, "CurrentAddress", "currentAddress");
        var emergencyPhone = Get(body, "EmergencyContactPhone", "emergencyContactPhone");
        var isPastor = GetBool(body, "IsPastor", "isPastor");
        var payrollEnabled = GetBool(body, "PayrollEnabled", "payrollEnabled", "IsPayrollEnabled", "isPayrollEnabled");

        await using var conn = new NpgsqlConnection(_connectionString);
        await conn.OpenAsync();
        await EnsurePayrollEnabledColumnAsync(conn);
        var parsedUserId = Guid.Parse(id);
        var existingUserWithPhone = await FindUserByPhoneAsync(conn, phone, parsedUserId);
        if (existingUserWithPhone.HasValue)
            return DuplicatePhoneConflict(existingUserWithPhone.Value);

        var sql = @"
UPDATE users SET
    username = COALESCE(@Username, username),
    displayname = @DisplayName,
    profilephotourl = @ProfilePhotoUrl,
    email = @Email,
    phone = @Phone,
    role = @Role,
    joindate = COALESCE(@JoinDate, joindate),

    ""Birthday"" = @Birthday,
    ""MaritalStatus"" = @MaritalStatus,
    ""Sex"" = @Sex,
    ""IsBaptized"" = @IsBaptized,
    ""BaptismPlace"" = @BaptismPlace,
    ""BaptismDate"" = @BaptismDate,
    ""IsBornAgain"" = @IsBornAgain,
    ""IsBeliever"" = @IsBeliever,
    ""Age"" = @Age,
    ""AadharNumber"" = @AadharNumber,
    ""HomeAddress"" = @HomeAddress,
    ""CurrentAddress"" = @CurrentAddress,
    ""EmergencyContactPhone"" = @EmergencyContactPhone,
    ""IsPastor"" = @IsPastor,
    payrollenabled = COALESCE(@PayrollEnabled, payrollenabled)

WHERE id = @Id AND tenant_id = @TenantId;
";

        await using var cmd = new NpgsqlCommand(sql, conn);

        cmd.Parameters.AddWithValue("Username", NpgsqlTypes.NpgsqlDbType.Text, (object?)username ?? DBNull.Value);
        cmd.Parameters.AddWithValue("DisplayName", NpgsqlTypes.NpgsqlDbType.Text, (object?)displayName ?? DBNull.Value);
        cmd.Parameters.AddWithValue("ProfilePhotoUrl", NpgsqlTypes.NpgsqlDbType.Text, (object?)profilePhotoUrl ?? DBNull.Value);
        cmd.Parameters.AddWithValue("Email", NpgsqlTypes.NpgsqlDbType.Text, (object?)email ?? DBNull.Value);
        cmd.Parameters.AddWithValue("Phone", NpgsqlTypes.NpgsqlDbType.Text, (object?)phone ?? DBNull.Value);
        cmd.Parameters.AddWithValue("Role", NpgsqlTypes.NpgsqlDbType.Text, (object?)role ?? DBNull.Value);
        cmd.Parameters.AddWithValue("JoinDate", NpgsqlTypes.NpgsqlDbType.TimestampTz, DbTimestamp(joinDate));

        cmd.Parameters.AddWithValue("Birthday", NpgsqlTypes.NpgsqlDbType.TimestampTz, DbTimestamp(birthday));
        cmd.Parameters.AddWithValue("MaritalStatus", NpgsqlTypes.NpgsqlDbType.Text, maritalStatus ?? (object)DBNull.Value);
        cmd.Parameters.AddWithValue("Sex", NpgsqlTypes.NpgsqlDbType.Text, sex ?? (object)DBNull.Value);
        cmd.Parameters.AddWithValue("IsBaptized", NpgsqlTypes.NpgsqlDbType.Boolean, isBaptized ?? (object)DBNull.Value);
        cmd.Parameters.AddWithValue("BaptismPlace", NpgsqlTypes.NpgsqlDbType.Text, baptismPlace ?? (object)DBNull.Value);
        cmd.Parameters.AddWithValue("BaptismDate", NpgsqlTypes.NpgsqlDbType.TimestampTz, DbTimestamp(baptismDate));
        cmd.Parameters.AddWithValue("IsBornAgain", NpgsqlTypes.NpgsqlDbType.Boolean, isBornAgain ?? (object)DBNull.Value);
        cmd.Parameters.AddWithValue("IsBeliever", NpgsqlTypes.NpgsqlDbType.Boolean, isBeliever ?? (object)DBNull.Value);
        cmd.Parameters.AddWithValue("Age", NpgsqlTypes.NpgsqlDbType.Integer, age ?? (object)DBNull.Value);
        cmd.Parameters.AddWithValue("AadharNumber", NpgsqlTypes.NpgsqlDbType.Text, aadhar ?? (object)DBNull.Value);
        cmd.Parameters.AddWithValue("HomeAddress", NpgsqlTypes.NpgsqlDbType.Text, homeAddress ?? (object)DBNull.Value);
        cmd.Parameters.AddWithValue("CurrentAddress", NpgsqlTypes.NpgsqlDbType.Text, currentAddress ?? (object)DBNull.Value);
        cmd.Parameters.AddWithValue("EmergencyContactPhone", NpgsqlTypes.NpgsqlDbType.Text, emergencyPhone ?? (object)DBNull.Value);
        cmd.Parameters.AddWithValue("IsPastor", NpgsqlTypes.NpgsqlDbType.Boolean, isPastor ?? (object)DBNull.Value);
        cmd.Parameters.AddWithValue("PayrollEnabled", NpgsqlTypes.NpgsqlDbType.Boolean, payrollEnabled ?? (object)DBNull.Value);

        cmd.Parameters.AddWithValue("Id", Guid.Parse(id));
        cmd.Parameters.AddWithValue("TenantId", NpgsqlTypes.NpgsqlDbType.Uuid, GetCurrentTenantId());

        var rows = await cmd.ExecuteNonQueryAsync();

        return Ok(new { success = true, updated = rows });
    }
    catch (Exception ex)
    {
        _logger.LogError(ex, "Update failed");
        return StatusCode(500, ex.Message);
    }
}

        public class AppointmentLetterRequestDto
        {
            public string? Department { get; set; }
            public Guid? ReportingManagerUserId { get; set; }
            public DateTime? AppointmentDate { get; set; }
            public string? AdditionalTerms { get; set; }

            // "Daily", "Weekly" or "Monthly" - how the admin wants the compensation
            // section labeled on the letter. Defaults to "Monthly" if not sent.
            public string? SalaryType { get; set; }
        }

        // GET /api/users/{id}/reporting-candidates - who this user could report to, based on
        // the Positions module's hierarchy: holders of the parent of the user's primary
        // position. Returns an empty list with a "reason" when the user has no position
        // assigned, or their position is already top-level.
        [HttpGet("{id}/reporting-candidates")]
        [Authorize(Roles = "admin,staff")]
        public async Task<IActionResult> GetReportingCandidates(string id)
        {
            if (string.IsNullOrWhiteSpace(_connectionString))
                return StatusCode(500, "Missing connection string.");
            if (!Guid.TryParse(id, out var userId))
                return BadRequest("Invalid user id.");

            var tenantId = GetCurrentTenantId();

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await PositionsController.EnsurePositionTablesAsync(conn);

                bool hasPosition = false;
                long? parentPositionId = null;

                await using (var cmd = new NpgsqlCommand(
                    @"SELECT p.parent_position_id
                      FROM public.user_positions up
                      JOIN public.positions p ON p.id = up.position_id
                      WHERE up.user_id = @userId AND p.tenant_id = @tenantId
                      ORDER BY up.is_primary DESC LIMIT 1", conn))
                {
                    cmd.Parameters.AddWithValue("userId", NpgsqlTypes.NpgsqlDbType.Uuid, userId);
                    cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                    await using var rdr = await cmd.ExecuteReaderAsync();
                    if (await rdr.ReadAsync())
                    {
                        hasPosition = true;
                        parentPositionId = rdr.IsDBNull(0) ? (long?)null : rdr.GetInt64(0);
                    }
                }

                if (!hasPosition)
                    return Ok(new { items = Array.Empty<object>(), reason = "no_position" });
                if (parentPositionId == null)
                    return Ok(new { items = Array.Empty<object>(), reason = "top_level" });

                // Walk up the position hierarchy: if the immediate parent position has no one
                // assigned, keep climbing to the next ancestor until we find one that does (or
                // run out of hierarchy). This is what "who does this user report to" should mean
                // in an org chart where a level can be temporarily vacant.
                var candidates = new List<object>();
                var currentPositionId = parentPositionId;
                var visited = new HashSet<long>();

                while (currentPositionId.HasValue && visited.Add(currentPositionId.Value))
                {
                    await using (var cmd = new NpgsqlCommand(
                        @"SELECT u.id, COALESCE(u.displayname, u.username), p.name
                          FROM public.user_positions up
                          JOIN public.positions p ON p.id = up.position_id
                          JOIN public.users u ON u.id = up.user_id
                          WHERE up.position_id = @positionId AND p.tenant_id = @tenantId
                            AND u.tenant_id = @tenantId AND u.id <> @userId
                          ORDER BY up.is_primary DESC, COALESCE(u.displayname, u.username)", conn))
                    {
                        cmd.Parameters.AddWithValue("positionId", NpgsqlTypes.NpgsqlDbType.Bigint, currentPositionId.Value);
                        cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                        cmd.Parameters.AddWithValue("userId", NpgsqlTypes.NpgsqlDbType.Uuid, userId);
                        await using var rdr = await cmd.ExecuteReaderAsync();
                        while (await rdr.ReadAsync())
                        {
                            candidates.Add(new
                            {
                                userId = rdr.GetGuid(0),
                                displayName = rdr.GetString(1),
                                positionName = rdr.GetString(2)
                            });
                        }
                    }

                    if (candidates.Count > 0) break;

                    await using var parentCmd = new NpgsqlCommand(
                        "SELECT parent_position_id FROM public.positions WHERE id = @positionId AND tenant_id = @tenantId", conn);
                    parentCmd.Parameters.AddWithValue("positionId", NpgsqlTypes.NpgsqlDbType.Bigint, currentPositionId.Value);
                    parentCmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                    var next = await parentCmd.ExecuteScalarAsync();
                    currentPositionId = next is long l ? l : (long?)null;
                }

                return Ok(new { items = candidates, reason = candidates.Count == 0 ? "no_holder" : null });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to load reporting candidates for user {UserId}", userId);
                return StatusCode(500, "Could not load reporting candidates.");
            }
        }

        // POST /api/users/{id}/appointment-letter - generates a fresh appointment letter PDF
        // for a payroll-enabled user from their own record + this tenant's active payroll
        // settings for them, and attaches it (records the path + timestamp against the user).
        [HttpPost("{id}/appointment-letter")]
        [Authorize(Roles = "admin,staff")]
        public async Task<IActionResult> GenerateAppointmentLetter(string id, [FromBody] AppointmentLetterRequestDto? dto)
        {
            if (string.IsNullOrWhiteSpace(_connectionString))
                return StatusCode(500, "Missing connection string.");
            if (!Guid.TryParse(id, out var userId))
                return BadRequest("Invalid user id.");

            var tenantId = GetCurrentTenantId();

            try
            {
                await using var conn = new NpgsqlConnection(_connectionString);
                await conn.OpenAsync();
                await PositionsController.EnsurePositionTablesAsync(conn);

                string? fullName;
                string? userCode;
                DateTime joinDate;
                bool payrollEnabled;
                string? roleName;
                string? aadharNumber;
                string? homeAddress;
                string? currentAddress;

                await using (var cmd = new NpgsqlCommand(
                    @"SELECT u.displayname, u.""UserCode"", u.joindate, u.payrollenabled, r.name,
                             u.""AadharNumber"", u.""HomeAddress"", u.""CurrentAddress""
                      FROM public.users u
                      LEFT JOIN public.roles r ON r.id::text = u.role
                      WHERE u.id = @id AND u.tenant_id = @tenantId", conn))
                {
                    cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Uuid, userId);
                    cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                    await using var rdr = await cmd.ExecuteReaderAsync();
                    if (!await rdr.ReadAsync()) return NotFound("User not found.");
                    fullName = rdr["displayname"] as string;
                    userCode = rdr["UserCode"] as string;
                    joinDate = rdr["joindate"] is DateTime jd ? jd : DateTime.UtcNow;
                    payrollEnabled = rdr["payrollenabled"] is bool pe && pe;
                    roleName = rdr["name"] as string;
                    aadharNumber = rdr["AadharNumber"] as string;
                    homeAddress = rdr["HomeAddress"] as string;
                    currentAddress = rdr["CurrentAddress"] as string;
                }

                if (!payrollEnabled)
                    return BadRequest(new { message = "Appointment letters can only be generated for payroll-enabled users." });

                if (string.IsNullOrWhiteSpace(fullName))
                    return BadRequest(new { message = "This user has no display name set." });

                decimal? monthlyFixed = null;
                decimal? hourlyRate = null;
                decimal? deductions = null;
                int? weeklyOffDay = null;

                await using (var cmd = new NpgsqlCommand(
                    @"SELECT monthly_fixed_amount, hourly_rate, deductions, weekly_off_day
                      FROM public.staff_payroll_settings
                      WHERE user_id = @userId AND tenant_id = @tenantId AND is_active = true
                      ORDER BY id DESC LIMIT 1", conn))
                {
                    cmd.Parameters.AddWithValue("userId", userId.ToString());
                    cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                    await using var rdr = await cmd.ExecuteReaderAsync();
                    if (await rdr.ReadAsync())
                    {
                        monthlyFixed = rdr["monthly_fixed_amount"] as decimal?;
                        hourlyRate = rdr["hourly_rate"] as decimal?;
                        deductions = rdr["deductions"] as decimal?;
                        weeklyOffDay = rdr["weekly_off_day"] as int?;
                    }
                }

                string? reportingManagerName = null;
                if (dto?.ReportingManagerUserId is Guid managerId && managerId != Guid.Empty)
                {
                    await using var cmd = new NpgsqlCommand(
                        @"SELECT COALESCE(u.displayname, u.username), p.name
                          FROM public.users u
                          LEFT JOIN public.user_positions up ON up.user_id = u.id AND up.is_primary = true
                          LEFT JOIN public.positions p ON p.id = up.position_id
                          WHERE u.id = @managerId AND u.tenant_id = @tenantId", conn);
                    cmd.Parameters.AddWithValue("managerId", NpgsqlTypes.NpgsqlDbType.Uuid, managerId);
                    cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                    await using var rdr = await cmd.ExecuteReaderAsync();
                    if (await rdr.ReadAsync())
                    {
                        var managerName = rdr.GetString(0);
                        var managerPosition = rdr.IsDBNull(1) ? null : rdr.GetString(1);
                        reportingManagerName = managerPosition != null ? $"{managerName} ({managerPosition})" : managerName;
                    }
                }

                var relativePath = await _appointmentLetters.GenerateAsync(new AppointmentLetterRequest
                {
                    TenantId = tenantId,
                    UserId = userId,
                    FullName = fullName!,
                    UserCode = userCode,
                    JoinDate = joinDate,
                    RoleName = roleName,
                    AadharNumber = aadharNumber,
                    Address = !string.IsNullOrWhiteSpace(currentAddress) ? currentAddress : homeAddress,
                    Department = dto?.Department,
                    ReportingManager = reportingManagerName,
                    AppointmentDate = dto?.AppointmentDate ?? DateTime.UtcNow,
                    AdditionalTerms = dto?.AdditionalTerms,
                    MonthlyFixedAmount = monthlyFixed,
                    HourlyRate = hourlyRate,
                    Deductions = deductions,
                    WeeklyOffDay = weeklyOffDay,
                    SalaryType = dto?.SalaryType,
                });

                await using (var cmd = new NpgsqlCommand(
                    @"UPDATE public.users SET appointment_letter_url = @url, appointment_letter_generated_at_utc = now()
                      WHERE id = @id AND tenant_id = @tenantId", conn))
                {
                    cmd.Parameters.AddWithValue("url", relativePath);
                    cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Uuid, userId);
                    cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                    await cmd.ExecuteNonQueryAsync();
                }

                _logger.LogInformation("Appointment letter generated for user {UserId}", userId);
                return Ok(new { generated = true, downloadUrl = $"/api/users/{userId}/appointment-letter" });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Appointment letter generation failed for user {UserId}", userId);
                return StatusCode(500, "Could not generate the appointment letter.");
            }
        }

        // GET /api/users/{id}/appointment-letter - streams the most recently generated PDF.
        // Admin/staff only: this document may contain salary details.
        [HttpGet("{id}/appointment-letter")]
        [Authorize(Roles = "admin,staff")]
        public async Task<IActionResult> DownloadAppointmentLetter(string id)
        {
            if (string.IsNullOrWhiteSpace(_connectionString))
                return StatusCode(500, "Missing connection string.");
            if (!Guid.TryParse(id, out var userId))
                return BadRequest("Invalid user id.");

            var tenantId = GetCurrentTenantId();

            await using var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync();

            string? relativePath;
            await using (var cmd = new NpgsqlCommand(
                "SELECT appointment_letter_url FROM public.users WHERE id = @id AND tenant_id = @tenantId", conn))
            {
                cmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Uuid, userId);
                cmd.Parameters.AddWithValue("tenantId", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                relativePath = (await cmd.ExecuteScalarAsync()) as string;
            }

            if (string.IsNullOrWhiteSpace(relativePath))
                return NotFound("No appointment letter has been generated for this user yet.");

            var letterRoot = System.IO.Path.GetFullPath(
                _configuration["AppointmentLetters:GeneratedRoot"]
                ?? System.IO.Path.Combine(_env.ContentRootPath, "App_Data", "appointment-letters"));
            var fullPath = System.IO.Path.GetFullPath(System.IO.Path.Combine(letterRoot, relativePath));

            if (!fullPath.StartsWith(letterRoot, StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(fullPath))
                return NotFound("Appointment letter file could not be found on the server.");

            var bytes = await System.IO.File.ReadAllBytesAsync(fullPath);
            return File(bytes, "application/pdf", System.IO.Path.GetFileName(fullPath));
        }
    }
}
