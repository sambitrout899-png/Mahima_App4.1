using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Identity;
using Google.Apis.Auth;
using Npgsql;
using System;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Net;
using Mahima.Api.v3.clean.Helpers;
using Mahima.Api.v3.clean.Hubs;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.SignalR;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly string _connStr;
    private readonly ILogger<AuthController> _logger;
    private readonly JwtTokenService _jwtService;
    private readonly IEmailService _emailService;
    private readonly IConfiguration _config;
    private readonly IPastorBotService _pastorBot;
    private readonly IHubContext<ChatHub> _chatHub;
    private readonly ITenantContextService _tenantContext;
        //private readonly PasswordHasher<object> _pwHasher = new PasswordHasher<object>();
		//private readonly PasswordHasher<string> _pwHasher = new PasswordHasher<string>();
		private readonly PasswordHasher<object> _pwHasher = new PasswordHasher<object>();
    public AuthController(
        IConfiguration config,
        ILogger<AuthController> logger,
        JwtTokenService jwtService,
        IEmailService emailService,
        IPastorBotService pastorBot,
        IHubContext<ChatHub> chatHub,
        ITenantContextService tenantContext)
    {
        _logger = logger;
        _jwtService = jwtService;
        _emailService = emailService;
        _config = config;
        _pastorBot = pastorBot;
        _chatHub = chatHub;
        _tenantContext = tenantContext;
        _connStr = config.GetConnectionString("DefaultConnection")
                   ?? throw new InvalidOperationException("Connection string missing");
    }

    private async Task SendNewUserWelcomeAsync(Guid userId, string? displayName)
    {
        try
        {
            var sent = await _pastorBot.SendJaiMasihMessageAsync(
                MinistryMessageFactory.BuildNewUserWelcome(displayName),
                HttpContext.RequestAborted);

            await _chatHub.Clients.All.SendAsync("ReceiveMessage", sent, HttpContext.RequestAborted);
            _logger.LogInformation("AI Counseller welcome sent for registered user {UserId}", userId);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "AI Counseller welcome could not be sent for registered user {UserId}", userId);
        }
    }

    public class LoginDto
    {
        public string? UsernameOrEmail { get; set; }
        public string? Password { get; set; }
    }

    public class RegisterDto
    {
        public string? Username { get; set; }
        public string? Email { get; set; }
        public string? Password { get; set; }
        public string? DisplayName { get; set; }
        public string? Phone { get; set; }
    }

    public class GoogleLoginDto
    {
        public string? IdToken { get; set; }
    }

    private static string QuoteIdentifier(string identifier) =>
        "\"" + identifier.Replace("\"", "\"\"") + "\"";

    private string[] GetGoogleAuthClientIds()
    {
        var configured = new List<string>();

        var namedClientIds = new[]
        {
            _config["GoogleAuth:ClientId"],
            _config["GoogleAuth:WebClientId"],
            _config["GoogleAuth:AndroidClientId"],
            _config["GoogleAuth:IosClientId"],
            Environment.GetEnvironmentVariable("GOOGLE_AUTH_CLIENT_ID"),
            Environment.GetEnvironmentVariable("GOOGLE_AUTH_WEB_CLIENT_ID"),
            Environment.GetEnvironmentVariable("GOOGLE_AUTH_ANDROID_CLIENT_ID"),
            Environment.GetEnvironmentVariable("GOOGLE_AUTH_IOS_CLIENT_ID"),
        };

        configured.AddRange(namedClientIds.Where(id => !string.IsNullOrWhiteSpace(id))!);

        var clientIds = _config.GetSection("GoogleAuth:ClientIds").Get<string[]>();
        if (clientIds != null)
            configured.AddRange(clientIds.Where(id => !string.IsNullOrWhiteSpace(id)));

        var envClientIds = Environment.GetEnvironmentVariable("GOOGLE_AUTH_CLIENT_IDS");
        if (!string.IsNullOrWhiteSpace(envClientIds))
        {
            configured.AddRange(envClientIds
                .Split(new[] { ',', ';', ' ' }, StringSplitOptions.RemoveEmptyEntries)
                .Where(id => !string.IsNullOrWhiteSpace(id)));
        }

        return configured
            .Select(id => id.Trim())
            .Where(id => id.EndsWith(".apps.googleusercontent.com", StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static string NormalizePhoneForDuplicateCheck(string? value)
    {
        var digits = new string((value ?? string.Empty).Where(char.IsDigit).ToArray());
        if (digits.Length > 10 && digits.StartsWith("91", StringComparison.Ordinal))
            digits = digits.Substring(digits.Length - 10);

        return digits;
    }

    private static async Task<(Guid Id, string? DisplayName, string? Username, string? Phone)?> FindUserByPhoneAsync(
        NpgsqlConnection conn,
        string? phone)
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
LIMIT 1;", conn);
        cmd.Parameters.AddWithValue("phone", NpgsqlTypes.NpgsqlDbType.Text, normalizedPhone);

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

    private static async Task<string?> GetUserColumnAsync(NpgsqlConnection conn, params string[] candidates)
    {
        foreach (var candidate in candidates)
        {
            await using var cmd = new NpgsqlCommand(@"
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users'
  AND LOWER(column_name) = LOWER(@column)
LIMIT 1;", conn);
            cmd.Parameters.AddWithValue("column", NpgsqlTypes.NpgsqlDbType.Text, candidate);
            var value = await cmd.ExecuteScalarAsync();
            if (value != null && value != DBNull.Value)
                return value.ToString();
        }

        return null;
    }

    private static string NormalizeUserCodePrefix(string? value)
    {
        var cleaned = new string((value ?? "MHN").ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
        if (cleaned.Length < 2) cleaned = "MHN";
        return cleaned.Length > 12 ? cleaned[..12] : cleaned;
    }

    private static bool LooksLikeEmail(string? value)
    {
        var text = value?.Trim();
        if (string.IsNullOrWhiteSpace(text)) return true;
        return text.Length <= 254 &&
               text.Contains('@') &&
               text.IndexOf('@') > 0 &&
               text.LastIndexOf('@') < text.Length - 1 &&
               text.Contains('.');
    }

    private static bool LooksLikeUsername(string? value)
    {
        var text = value?.Trim();
        if (string.IsNullOrWhiteSpace(text)) return false;
        return text.Length is >= 3 and <= 50 &&
               text.All(ch => char.IsLetterOrDigit(ch) || ch == '.' || ch == '_' || ch == '-');
    }

    private static string? ValidateRegistrationMobile(string? phone)
    {
        var digits = DigitsOnly(phone);
        if (digits.Length == 10) return null;
        if (digits.Length == 12 && digits.StartsWith("91")) return null;
        return "Enter a valid 10-digit Indian mobile number.";
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
WHERE id = @tenant_id
LIMIT 1;", conn);
        cmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
        var value = await cmd.ExecuteScalarAsync();
        return NormalizeUserCodePrefix(value?.ToString());
    }

    private static async Task<string> GenerateUserCodeAsync(NpgsqlConnection conn, string userCodeColumn, string? prefix)
    {
        var cleanPrefix = NormalizeUserCodePrefix(prefix);
        for (var attempt = 0; attempt < 50; attempt++)
        {
            var code = $"{cleanPrefix}{RandomNumberGenerator.GetInt32(1, 999999):D6}";
            await using var cmd = new NpgsqlCommand(
                $"SELECT COUNT(*) FROM public.users WHERE {QuoteIdentifier(userCodeColumn)} = @code;",
                conn);
            cmd.Parameters.AddWithValue("code", NpgsqlTypes.NpgsqlDbType.Text, code);
            var exists = Convert.ToInt32(await cmd.ExecuteScalarAsync()) > 0;
            if (!exists) return code;
        }

        return $"{cleanPrefix}{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() % 100000000:D8}";
    }

    private static string SanitizeGoogleUsername(string raw)
    {
        var normalized = new string((raw ?? "googleuser")
            .ToLowerInvariant()
            .Select(ch => char.IsLetterOrDigit(ch) || ch == '_' || ch == '.' ? ch : '_')
            .ToArray())
            .Trim('_', '.');

        if (string.IsNullOrWhiteSpace(normalized))
            normalized = "googleuser";

        if (normalized.Length > 40)
            normalized = normalized.Substring(0, 40).Trim('_', '.');

        return string.IsNullOrWhiteSpace(normalized) ? "googleuser" : normalized;
    }

    private static async Task<string> GenerateUniqueGoogleUsernameAsync(NpgsqlConnection conn, string baseUsername)
    {
        var cleanBase = SanitizeGoogleUsername(baseUsername);
        var candidate = cleanBase;

        for (var attempt = 0; attempt < 50; attempt++)
        {
            await using var cmd = new NpgsqlCommand(@"
SELECT COUNT(*)
FROM public.users
WHERE LOWER(TRIM(username)) = @username;", conn);
            cmd.Parameters.AddWithValue("username", NpgsqlTypes.NpgsqlDbType.Text, candidate.ToLowerInvariant());
            var exists = Convert.ToInt32(await cmd.ExecuteScalarAsync()) > 0;
            if (!exists) return candidate;

            candidate = $"{cleanBase}{RandomNumberGenerator.GetInt32(1000, 999999)}";
        }

        return $"{cleanBase}{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}";
    }

    private static async Task EnsureAuthSecurityTablesAsync(NpgsqlConnection conn)
    {
        await using var cmd = new NpgsqlCommand(@"
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

ALTER TABLE public.security_events
    ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

ALTER TABLE public.user_access_blocks
    ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001';

CREATE INDEX IF NOT EXISTS ix_user_access_blocks_tenant_active
    ON public.user_access_blocks(tenant_id, is_active);", conn);
        await cmd.ExecuteNonQueryAsync();
    }

    private async Task RecordSecurityEventAsync(
        NpgsqlConnection conn,
        string eventType,
        string severity,
        string? username,
        Guid? userId,
        string details)
    {
        try
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
            var tenantId = tenant?.Id ?? Guid.Parse("00000000-0000-0000-0000-000000000001");
            await using var cmd = new NpgsqlCommand(@"
INSERT INTO public.security_events
    (tenant_id, event_type, severity, username, user_id, path, ip_address, user_agent, details)
VALUES
    (@tenant_id, @event_type, @severity, @username, @user_id, @path, @ip_address, @user_agent, @details);", conn);
            cmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
            cmd.Parameters.AddWithValue("event_type", NpgsqlTypes.NpgsqlDbType.Text, eventType);
            cmd.Parameters.AddWithValue("severity", NpgsqlTypes.NpgsqlDbType.Text, severity);
            cmd.Parameters.AddWithValue("username", NpgsqlTypes.NpgsqlDbType.Text, (object?)username ?? DBNull.Value);
            cmd.Parameters.AddWithValue("user_id", NpgsqlTypes.NpgsqlDbType.Uuid, userId.HasValue ? (object)userId.Value : DBNull.Value);
            cmd.Parameters.AddWithValue("path", NpgsqlTypes.NpgsqlDbType.Text, HttpContext?.Request?.Path.ToString() ?? "/api/auth/login");
            cmd.Parameters.AddWithValue("ip_address", NpgsqlTypes.NpgsqlDbType.Text, HttpContext?.Connection?.RemoteIpAddress?.ToString() ?? (object)DBNull.Value);
            cmd.Parameters.AddWithValue("user_agent", NpgsqlTypes.NpgsqlDbType.Text, HttpContext?.Request?.Headers.UserAgent.ToString() ?? (object)DBNull.Value);
            cmd.Parameters.AddWithValue("details", NpgsqlTypes.NpgsqlDbType.Text, details);
            await cmd.ExecuteNonQueryAsync();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Security event logging failed for {EventType}", eventType);
        }
    }

    private static async Task<string?> GetActiveUserBlockReasonAsync(NpgsqlConnection conn, Guid userId)
    {
        await using var cmd = new NpgsqlCommand(@"
SELECT reason
FROM public.user_access_blocks
WHERE user_id = @user_id AND is_active = true
LIMIT 1;", conn);
        cmd.Parameters.AddWithValue("user_id", NpgsqlTypes.NpgsqlDbType.Uuid, userId);
        var value = await cmd.ExecuteScalarAsync();
        return value == null || value == DBNull.Value ? null : value.ToString();
    }

    // ============================
    // ?? GET CURRENT USER (FIXED)
    // ============================
    [Authorize]
    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        try
        {
            var userIdText =
                User.FindFirstValue(ClaimTypes.NameIdentifier) ??
                User.FindFirstValue("sub") ??
                User.FindFirstValue("nameid");

            if (!Guid.TryParse(userIdText, out var userId))
                return Unauthorized(new { message = "Invalid login session." });

            using var conn = new NpgsqlConnection(_connStr);
            await conn.OpenAsync();
            await EnsureAuthSecurityTablesAsync(conn);

            var blockReason = await GetActiveUserBlockReasonAsync(conn, userId);
            if (!string.IsNullOrWhiteSpace(blockReason))
            {
                await RecordSecurityEventAsync(conn, "BlockedSession", "high", null, userId, blockReason);
                return StatusCode(423, new { message = "Your access is blocked. Please contact Mahima Ministry admin.", reason = blockReason });
            }

            var sql = @"
SELECT
  u.id,
  u.username,
  u.displayname,
  u.email,
  u.phone,
  u.tenant_id,
  r.name as role
FROM users u
JOIN roles r ON r.id = u.role::int
WHERE u.id = @id
LIMIT 1;";

            await using var cmd = new NpgsqlCommand(sql, conn);
            cmd.Parameters.Add("id", NpgsqlTypes.NpgsqlDbType.Uuid).Value = userId;

            await using var rdr = await cmd.ExecuteReaderAsync();
            if (!await rdr.ReadAsync())
                return Unauthorized(new { message = "User not found." });

            var id = rdr["id"];
            var uname = rdr["username"]?.ToString();
            var display = rdr["displayname"]?.ToString();
            var email = rdr["email"]?.ToString();
            var phone = rdr["phone"]?.ToString();
            var tenantId = rdr["tenant_id"] == DBNull.Value ? null : rdr["tenant_id"]?.ToString();
            var tenantGuid = Guid.TryParse(tenantId, out var parsedTenantId)
                ? parsedTenantId
                : Guid.Parse("00000000-0000-0000-0000-000000000001");
            var role = rdr["role"]?.ToString();

            await rdr.CloseAsync();

            await using var tenantCountryCmd = new NpgsqlCommand("SELECT country_code FROM public.tenants WHERE id = @tenant_id LIMIT 1", conn);
            tenantCountryCmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantGuid);
            var tenantCountryCode = (await tenantCountryCmd.ExecuteScalarAsync())?.ToString() ?? "IN";

            var roles = await LoadEffectiveRoles(conn, userId, role);
            var pages = await LoadPermissions(conn, roles, tenantGuid);
            await Mahima.Api.v3.clean.Controllers.PositionsController.EnsureDefaultMemberPositionForUserAsync(conn, userId);
            var positions = await Mahima.Api.v3.clean.Controllers.PositionsController.LoadUserPositionsAsync(conn, userId);

            return Ok(new
            {
                id,
                username = uname,
                display,
                displayName = display,
                email,
                phone,
                tenantId,
                tenantCountryCode,
                role,
                roles,
                pages,
                positions,
                primaryPosition = positions.FirstOrDefault()
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error in /me");
            return StatusCode(500, new { message = "Could not load current user.", detail = ex.Message });
        }
    }

    // ================= REGISTER =================
    [AllowAnonymous]
    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterDto dto)
    {
        var username = dto?.Username?.Trim();
        var email = dto?.Email?.Trim();
        var phone = dto?.Phone?.Trim();
        var display = (dto?.DisplayName ?? username)?.Trim();
        var password = dto?.Password;

        if (string.IsNullOrWhiteSpace(username))
            return BadRequest(new { message = "Username is required" });
        if (!LooksLikeUsername(username))
            return BadRequest(new { message = "Username must be 3-50 characters and can use letters, numbers, dot, underscore, or hyphen only." });
        if (!LooksLikeEmail(email))
            return BadRequest(new { message = "Enter a valid email address." });
        var phoneError = ValidateRegistrationMobile(phone);
        if (phoneError != null)
            return BadRequest(new { message = phoneError });
        if (string.IsNullOrWhiteSpace(password))
            return BadRequest(new { message = "Password is required" });
        if (password.Length < 6)
            return BadRequest(new { message = "Password must be at least 6 characters" });

        try
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
            var tenantId = tenant?.Id ?? Guid.Parse("00000000-0000-0000-0000-000000000001");

            await using var conn = new NpgsqlConnection(_connStr);
            await conn.OpenAsync();

            var phoneDigits = DigitsOnly(phone);
            await using (var dupCmd = new NpgsqlCommand(@"
SELECT
  COUNT(*) FILTER (WHERE LOWER(TRIM(username)) = @username) AS username_count,
  COUNT(*) FILTER (WHERE @email <> '' AND LOWER(TRIM(COALESCE(email, ''))) = @email) AS email_count,
  COUNT(*) FILTER (WHERE regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = @phone_digits) AS phone_count
FROM public.users
WHERE tenant_id = @tenant_id;", conn))
            {
                dupCmd.Parameters.AddWithValue("username", NpgsqlTypes.NpgsqlDbType.Text, username.ToLowerInvariant());
                dupCmd.Parameters.AddWithValue("email", NpgsqlTypes.NpgsqlDbType.Text, (email ?? "").ToLowerInvariant());
                dupCmd.Parameters.AddWithValue("phone_digits", NpgsqlTypes.NpgsqlDbType.Text, phoneDigits);
                dupCmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                await using var dupRdr = await dupCmd.ExecuteReaderAsync();
                if (await dupRdr.ReadAsync())
                {
                    if (Convert.ToInt32(dupRdr["username_count"]) > 0)
                        return Conflict(new { message = "This username is already used in this church. Please choose another username." });
                    if (Convert.ToInt32(dupRdr["email_count"]) > 0)
                        return Conflict(new { message = "This email address is already registered in this church. Please sign in or reset your password." });
                    if (Convert.ToInt32(dupRdr["phone_count"]) > 0)
                        return Conflict(new { message = "This mobile number is already registered in this church. Please sign in or reset your password." });
                }
            }

            var existingUserWithPhone = await FindUserByPhoneAsync(conn, phone);
            if (existingUserWithPhone.HasValue)
                return DuplicatePhoneConflict(existingUserWithPhone.Value);

            var memberRoleId = 2;
            var memberRoleName = "Member";
            await using (var roleCmd = new NpgsqlCommand(@"
SELECT id, name
FROM roles
WHERE LOWER(name) = 'member'
LIMIT 1;", conn))
            await using (var roleRdr = await roleCmd.ExecuteReaderAsync())
            {
                if (await roleRdr.ReadAsync())
                {
                    memberRoleId = Convert.ToInt32(roleRdr["id"]);
                    memberRoleName = roleRdr["name"]?.ToString() ?? "Member";
                }
            }

            var passwordHash = _pwHasher.HashPassword(null, password);

            var insertColumns = new List<string>
            {
                QuoteIdentifier("username"),
                QuoteIdentifier("tenant_id"),
                QuoteIdentifier("email"),
                QuoteIdentifier("passwordhash"),
                QuoteIdentifier("role"),
                QuoteIdentifier("joindate"),
                QuoteIdentifier("phone"),
                QuoteIdentifier("displayname"),
            };
            var insertValues = new List<string>
            {
                "@username",
                "@tenant_id",
                "@email",
                "@passwordhash",
                "@role",
                "NOW()",
                "@phone",
                "@displayname",
            };

            var userCodeColumn = await GetUserColumnAsync(conn, "UserCode", "usercode");
            var profilePhotoColumn = await GetUserColumnAsync(conn, "profilephotourl", "ProfilePhotoUrl");

            if (!string.IsNullOrWhiteSpace(userCodeColumn))
            {
                insertColumns.Insert(0, QuoteIdentifier(userCodeColumn));
                insertValues.Insert(0, "@usercode");
            }

            if (!string.IsNullOrWhiteSpace(profilePhotoColumn))
            {
                insertColumns.Add(QuoteIdentifier(profilePhotoColumn));
                insertValues.Add("NULL");
            }

            var insertSql = $@"
INSERT INTO public.users ({string.Join(", ", insertColumns)})
VALUES ({string.Join(", ", insertValues)})
RETURNING id;";

            await using var insertCmd = new NpgsqlCommand(insertSql, conn);
            if (!string.IsNullOrWhiteSpace(userCodeColumn))
            {
                var prefix = await ReadTenantUserCodePrefixAsync(conn, tenantId);
                var generatedCode = await GenerateUserCodeAsync(conn, userCodeColumn, prefix);
                insertCmd.Parameters.AddWithValue("usercode", NpgsqlTypes.NpgsqlDbType.Text, generatedCode);
            }
            insertCmd.Parameters.AddWithValue("username", NpgsqlTypes.NpgsqlDbType.Text, username);
            insertCmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
            insertCmd.Parameters.AddWithValue("email", NpgsqlTypes.NpgsqlDbType.Text, (object?)email ?? DBNull.Value);
            insertCmd.Parameters.AddWithValue("passwordhash", NpgsqlTypes.NpgsqlDbType.Text, passwordHash);
            insertCmd.Parameters.AddWithValue("role", NpgsqlTypes.NpgsqlDbType.Text, memberRoleId.ToString());
            insertCmd.Parameters.AddWithValue("phone", NpgsqlTypes.NpgsqlDbType.Text, (object?)phone ?? DBNull.Value);
            insertCmd.Parameters.AddWithValue("displayname", NpgsqlTypes.NpgsqlDbType.Text, string.IsNullOrWhiteSpace(display) ? username : display);

            var id = await insertCmd.ExecuteScalarAsync();
            var userId = Guid.Parse(id?.ToString() ?? Guid.Empty.ToString());
            var roles = new List<string> { memberRoleName };
            var pages = await LoadPermissions(conn, roles, tenantId);
            await Mahima.Api.v3.clean.Controllers.PositionsController.EnsureDefaultMemberPositionForUserAsync(conn, userId);
            var positions = await Mahima.Api.v3.clean.Controllers.PositionsController.LoadUserPositionsAsync(conn, userId);
            var token = _jwtService.GenerateToken(userId, username, string.IsNullOrWhiteSpace(display) ? username : display, memberRoleName, tenantId);
            await SendNewUserWelcomeAsync(userId, string.IsNullOrWhiteSpace(display) ? username : display);

            return Ok(new
            {
                token,
                user = new
                {
                    id,
                    username,
                    display = string.IsNullOrWhiteSpace(display) ? username : display,
                    email,
                    phone,
                    tenantId,
                    role = memberRoleName,
                    roles,
                    pages,
                    positions,
                    primaryPosition = positions.FirstOrDefault()
                }
            });
        }
        catch (PostgresException pgEx) when (pgEx.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            _logger.LogWarning(pgEx, "Registration duplicate constraint for {User}", username);
            var constraint = pgEx.ConstraintName?.ToLowerInvariant() ?? "";
            var detail = pgEx.Detail?.ToLowerInvariant() ?? "";
            if (constraint.Contains("phone") || detail.Contains("phone"))
                return Conflict(new { message = "This mobile number is already registered in this church. Please sign in or reset your password." });
            if (constraint.Contains("email") || detail.Contains("email"))
                return Conflict(new { message = "This email address is already registered in this church. Please sign in or reset your password." });
            if (constraint.Contains("usercode") || constraint.Contains("user_code"))
                return Conflict(new { message = "A system-generated user ID already exists. Please try creating the account again." });

            return Conflict(new { message = "This user ID is already registered in this church. Please choose another user ID." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Registration failed for {User}", username);
            return StatusCode(500, new { message = "Registration failed", detail = ex.Message });
        }
    }

    // ================= LOGIN =================
[AllowAnonymous]
[HttpPost("google")]
public async Task<IActionResult> GoogleLogin([FromBody] GoogleLoginDto dto)
{
    if (dto == null || string.IsNullOrWhiteSpace(dto.IdToken))
        return BadRequest(new { message = "Google token is required" });

    var googleClientIds = GetGoogleAuthClientIds();

    if (googleClientIds.Length == 0)
        return StatusCode(500, new { message = "Google authentication is not configured." });

    GoogleJsonWebSignature.Payload payload;
    try
    {
        payload = await GoogleJsonWebSignature.ValidateAsync(
            dto.IdToken,
            new GoogleJsonWebSignature.ValidationSettings
            {
                Audience = googleClientIds
            });
    }
    catch (Exception ex)
    {
        _logger.LogWarning(ex, "Google token validation failed");
        return Unauthorized(new { message = "Google sign-in could not be verified." });
    }

    if (payload == null || !payload.EmailVerified)
        return Unauthorized(new { message = "Google email is not verified." });

    var email = payload.Email?.Trim().ToLowerInvariant();
    if (string.IsNullOrWhiteSpace(email))
        return Unauthorized(new { message = "Google account did not provide an email address." });

    var display = !string.IsNullOrWhiteSpace(payload.Name)
        ? payload.Name.Trim()
        : email.Split('@')[0];

    try
    {
        await using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync();
        await EnsureAuthSecurityTablesAsync(conn);
        var tenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
        var tenantId = tenant?.Id ?? Guid.Parse("00000000-0000-0000-0000-000000000001");
        var configuredRootUsername = _config["RootAdmin:Username"]?.Trim();
        var configuredRootGoogleEmail = _config["RootAdmin:GoogleEmail"]?.Trim().ToLowerInvariant();
        var useConfiguredRoot =
            tenant?.IsRootTenant == true &&
            !string.IsNullOrWhiteSpace(configuredRootUsername) &&
            !string.IsNullOrWhiteSpace(configuredRootGoogleEmail) &&
            string.Equals(email, configuredRootGoogleEmail, StringComparison.OrdinalIgnoreCase);

        Guid userGuid = Guid.Empty;
        string username = "";
        string? phone = null;
        string role = "";
        object id = Guid.Empty;

        await using (var findCmd = new NpgsqlCommand(@"
SELECT
  u.id,
  u.username,
  u.displayname,
  u.email,
  u.phone,
  r.name as role
FROM users u
JOIN roles r ON r.id = u.role::int
WHERE (
    (@use_configured_root = TRUE AND LOWER(TRIM(u.username)) = @root_username)
 OR (@use_configured_root = FALSE AND LOWER(TRIM(u.email)) = @email)
)
  AND u.tenant_id = @tenant_id
LIMIT 1;", conn))
        {
            findCmd.Parameters.AddWithValue("email", NpgsqlTypes.NpgsqlDbType.Text, email);
            findCmd.Parameters.AddWithValue("use_configured_root", NpgsqlTypes.NpgsqlDbType.Boolean, useConfiguredRoot);
            findCmd.Parameters.AddWithValue("root_username", NpgsqlTypes.NpgsqlDbType.Text, (configuredRootUsername ?? "").ToLowerInvariant());
            findCmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
            await using var rdr = await findCmd.ExecuteReaderAsync();
            if (await rdr.ReadAsync())
            {
                id = rdr["id"];
                userGuid = Guid.Parse(id.ToString() ?? Guid.Empty.ToString());
                username = rdr["username"]?.ToString() ?? email;
                display = rdr["displayname"]?.ToString() ?? display;
                phone = rdr["phone"]?.ToString();
                role = rdr["role"]?.ToString() ?? "Member";
                await rdr.CloseAsync();

                if (useConfiguredRoot)
                {
                    await using var linkCmd = new NpgsqlCommand(@"
UPDATE users
SET email = NULL
WHERE id <> @id
  AND tenant_id = @tenant_id
  AND LOWER(TRIM(COALESCE(email, ''))) = @email;

UPDATE users
SET email = @email
WHERE id = @id AND tenant_id = @tenant_id;", conn);
                    linkCmd.Parameters.AddWithValue("email", NpgsqlTypes.NpgsqlDbType.Text, email);
                    linkCmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Uuid, userGuid);
                    linkCmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                    await linkCmd.ExecuteNonQueryAsync();
                    _logger.LogInformation("Linked configured Google identity to root account {Username}.", username);
                }

                var blockReason = await GetActiveUserBlockReasonAsync(conn, userGuid);
                if (!string.IsNullOrWhiteSpace(blockReason))
                {
                    await RecordSecurityEventAsync(conn, "BlockedGoogleLogin", "high", username, userGuid, blockReason);
                    return StatusCode(423, new { message = "Your access is blocked. Please contact Mahima Ministry admin.", reason = blockReason });
                }
            }
            else
            {
                await rdr.CloseAsync();

                var linkedConfiguredRoot = false;

                if (tenant?.IsRootTenant == true &&
                    !string.IsNullOrWhiteSpace(configuredRootUsername) &&
                    !string.IsNullOrWhiteSpace(configuredRootGoogleEmail) &&
                    string.Equals(email, configuredRootGoogleEmail, StringComparison.OrdinalIgnoreCase))
                {
                    await using var rootCmd = new NpgsqlCommand(@"
SELECT
  u.id,
  u.username,
  u.displayname,
  u.phone,
  r.name AS role
FROM users u
JOIN roles r ON r.id = u.role::int
WHERE LOWER(TRIM(u.username)) = @username
  AND u.tenant_id = @tenant_id
LIMIT 1;", conn);
                    rootCmd.Parameters.AddWithValue("username", NpgsqlTypes.NpgsqlDbType.Text, configuredRootUsername.ToLowerInvariant());
                    rootCmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);

                    await using var rootRdr = await rootCmd.ExecuteReaderAsync();
                    if (await rootRdr.ReadAsync())
                    {
                        id = rootRdr["id"];
                        userGuid = Guid.Parse(id.ToString() ?? Guid.Empty.ToString());
                        username = rootRdr["username"]?.ToString() ?? configuredRootUsername;
                        display = rootRdr["displayname"]?.ToString() ?? display;
                        phone = rootRdr["phone"]?.ToString();
                        role = rootRdr["role"]?.ToString() ?? "Admin";
                        linkedConfiguredRoot = true;
                    }
                    await rootRdr.CloseAsync();

                    if (linkedConfiguredRoot)
                    {
                        var profilePhotoColumn = await GetUserColumnAsync(conn, "profilephotourl", "ProfilePhotoUrl");
                        var profileUpdate = string.IsNullOrWhiteSpace(profilePhotoColumn)
                            ? ""
                            : $", {QuoteIdentifier(profilePhotoColumn)} = COALESCE(NULLIF({QuoteIdentifier(profilePhotoColumn)}, ''), @profilephotourl)";
                        await using var linkCmd = new NpgsqlCommand($@"
UPDATE users
SET email = @email{profileUpdate}
WHERE id = @id AND tenant_id = @tenant_id;", conn);
                        linkCmd.Parameters.AddWithValue("email", NpgsqlTypes.NpgsqlDbType.Text, email);
                        linkCmd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Uuid, userGuid);
                        linkCmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                        if (!string.IsNullOrWhiteSpace(profilePhotoColumn))
                            linkCmd.Parameters.AddWithValue("profilephotourl", NpgsqlTypes.NpgsqlDbType.Text, (object?)payload.Picture ?? DBNull.Value);
                        await linkCmd.ExecuteNonQueryAsync();
                        _logger.LogInformation("Linked configured Google identity to root account {Username}.", username);
                    }
                }

                if (!linkedConfiguredRoot)
                {
                    var memberRoleId = 2;
                    var memberRoleName = "Member";
                    await using (var roleCmd = new NpgsqlCommand(@"
SELECT id, name
FROM roles
WHERE LOWER(name) = 'member'
LIMIT 1;", conn))
                    await using (var roleRdr = await roleCmd.ExecuteReaderAsync())
                    {
                        if (await roleRdr.ReadAsync())
                        {
                            memberRoleId = Convert.ToInt32(roleRdr["id"]);
                            memberRoleName = roleRdr["name"]?.ToString() ?? "Member";
                        }
                    }

                    var baseUsername = SanitizeGoogleUsername(email.Split('@')[0]);
                    username = await GenerateUniqueGoogleUsernameAsync(conn, baseUsername);
                    phone = null;
                    role = memberRoleName;

                    var passwordHash = _pwHasher.HashPassword(null, $"GOOGLE:{payload.Subject}:{Guid.NewGuid():N}");
                    var insertColumns = new List<string>
                    {
                        QuoteIdentifier("username"),
                        QuoteIdentifier("email"),
                        QuoteIdentifier("passwordhash"),
                        QuoteIdentifier("role"),
                        QuoteIdentifier("tenant_id"),
                        QuoteIdentifier("joindate"),
                        QuoteIdentifier("phone"),
                        QuoteIdentifier("displayname"),
                    };
                    var insertValues = new List<string>
                    {
                        "@username",
                        "@email",
                        "@passwordhash",
                        "@role",
                        "@tenant_id",
                        "NOW()",
                        "NULL",
                        "@displayname",
                    };

                    var userCodeColumn = await GetUserColumnAsync(conn, "UserCode", "usercode");
                    var profilePhotoColumn = await GetUserColumnAsync(conn, "profilephotourl", "ProfilePhotoUrl");

                    if (!string.IsNullOrWhiteSpace(userCodeColumn))
                    {
                        insertColumns.Insert(0, QuoteIdentifier(userCodeColumn));
                        insertValues.Insert(0, "@usercode");
                    }

                    if (!string.IsNullOrWhiteSpace(profilePhotoColumn))
                    {
                        insertColumns.Add(QuoteIdentifier(profilePhotoColumn));
                        insertValues.Add("@profilephotourl");
                    }

                    var insertSql = $@"
INSERT INTO public.users ({string.Join(", ", insertColumns)})
VALUES ({string.Join(", ", insertValues)})
RETURNING id;";

                    await using var insertCmd = new NpgsqlCommand(insertSql, conn);
                    if (!string.IsNullOrWhiteSpace(userCodeColumn))
                    {
                        var prefix = await ReadTenantUserCodePrefixAsync(conn, tenantId);
                        var generatedCode = await GenerateUserCodeAsync(conn, userCodeColumn, prefix);
                        insertCmd.Parameters.AddWithValue("usercode", NpgsqlTypes.NpgsqlDbType.Text, generatedCode);
                    }
                    insertCmd.Parameters.AddWithValue("username", NpgsqlTypes.NpgsqlDbType.Text, username);
                    insertCmd.Parameters.AddWithValue("email", NpgsqlTypes.NpgsqlDbType.Text, email);
                    insertCmd.Parameters.AddWithValue("passwordhash", NpgsqlTypes.NpgsqlDbType.Text, passwordHash);
                    insertCmd.Parameters.AddWithValue("role", NpgsqlTypes.NpgsqlDbType.Text, memberRoleId.ToString());
                    insertCmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);
                    insertCmd.Parameters.AddWithValue("displayname", NpgsqlTypes.NpgsqlDbType.Text, display);
                    if (!string.IsNullOrWhiteSpace(profilePhotoColumn))
                        insertCmd.Parameters.AddWithValue("profilephotourl", NpgsqlTypes.NpgsqlDbType.Text, (object?)payload.Picture ?? DBNull.Value);

                    id = await insertCmd.ExecuteScalarAsync() ?? Guid.Empty;
                    userGuid = Guid.Parse(id.ToString() ?? Guid.Empty.ToString());
                    await SendNewUserWelcomeAsync(userGuid, display);
                }
            }
        }

        var roles = await LoadEffectiveRoles(conn, userGuid, role);
        var pages = await LoadPermissions(conn, roles, tenantId);
        await Mahima.Api.v3.clean.Controllers.PositionsController.EnsureDefaultMemberPositionForUserAsync(conn, userGuid);
        var positions = await Mahima.Api.v3.clean.Controllers.PositionsController.LoadUserPositionsAsync(conn, userGuid);
        var token = _jwtService.GenerateToken(userGuid, username, display, role, tenantId);

        await RecordSecurityEventAsync(conn, "GoogleLogin", "low", username, userGuid, email);

        return Ok(new
        {
            token,
            user = new
            {
                id = userGuid,
                username,
                display,
                displayName = display,
                email,
                phone,
                role,
                roles,
                pages,
                positions,
                primaryPosition = positions.FirstOrDefault()
            }
        });
    }
    catch (Exception ex)
    {
        _logger.LogError(ex, "Google login failed for {Email}", email);
        return StatusCode(500, new { message = "Google login failed", detail = ex.Message });
    }
}

[AllowAnonymous]
[HttpPost("login")]
public async Task<IActionResult> Login([FromBody] LoginDto dto)
{
    if (dto == null || string.IsNullOrWhiteSpace(dto.UsernameOrEmail))
        return BadRequest(new { message = "Username/email required" });

    try
    {
        var currentTenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
        var currentTenantId = currentTenant?.Id ?? Guid.Parse("00000000-0000-0000-0000-000000000001");
        if (currentTenant?.IsRootTenant != true &&
            !string.Equals(currentTenant?.Status, "active", StringComparison.OrdinalIgnoreCase))
        {
            return StatusCode(423, new
            {
                message = "This tenant is not active. Please contact Mahima Ministry admin.",
                status = currentTenant?.Status ?? "inactive"
            });
        }
        using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync();
        await EnsureAuthSecurityTablesAsync(conn);

       var sql = @"
SELECT
  u.id,
  u.username,
  u.displayname,
  u.email,
  u.phone,
  u.tenant_id,
  r.name as role,
  u.passwordhash,
  u.mfa_enabled,
  u.mfa_secret
FROM users u
JOIN roles r ON r.id = u.role::int
WHERE (LOWER(TRIM(u.username)) = @u
   OR LOWER(TRIM(COALESCE(u.email, ''))) = @u)
  AND u.tenant_id = @tenant_id
LIMIT 1;
";

        await using var cmd = new NpgsqlCommand(sql, conn);
        //cmd.Parameters.AddWithValue("u", dto.UsernameOrEmail);
		//var input = dto.UsernameOrEmail?.Trim();
		var input = dto.UsernameOrEmail?.Trim().ToLower();
        //cmd.Parameters.AddWithValue("u", input);
        cmd.Parameters.AddWithValue("u", NpgsqlTypes.NpgsqlDbType.Text, input.ToLower());
        cmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, currentTenantId);
		await using var rdr = await cmd.ExecuteReaderAsync();
        if (!await rdr.ReadAsync())
        {
            _logger.LogWarning("Login failed: user not found {User}", dto.UsernameOrEmail);
            await rdr.CloseAsync();
            await RecordSecurityEventAsync(conn, "LoginFailed", "medium", dto.UsernameOrEmail, null, "User not found.");
            return Unauthorized(new { message = "Invalid credentials" });
        }

        var id = rdr["id"];
        var username = rdr["username"]?.ToString();
        var display = rdr["displayname"]?.ToString();
        var email = rdr["email"]?.ToString();
        var phone = rdr["phone"]?.ToString();
        var tenantId = rdr["tenant_id"] == DBNull.Value ? (Guid?)null : Guid.Parse(rdr["tenant_id"].ToString()!);
        var role = rdr["role"]?.ToString() ?? "";
        var storedHash = rdr["passwordhash"]?.ToString();
        var mfaEnabled = rdr["mfa_enabled"] != DBNull.Value && (bool)rdr["mfa_enabled"];
        var mfaSecret = rdr["mfa_secret"] as string;

        if (string.IsNullOrWhiteSpace(dto.Password))
            return Unauthorized(new { message = "Password required" });

        if (string.IsNullOrWhiteSpace(storedHash))
        {
            _logger.LogWarning("Login failed: password hash missing for {User}", dto.UsernameOrEmail);
            return Unauthorized(new { message = "Invalid credentials" });
        }

		var result = _pwHasher.VerifyHashedPassword(null, storedHash, dto.Password);

        if (result != PasswordVerificationResult.Success && result != PasswordVerificationResult.SuccessRehashNeeded)
		{
            _logger.LogWarning("Login failed: invalid password for {User}", dto.UsernameOrEmail);
            await rdr.CloseAsync();
            Guid? failedUserId = Guid.TryParse(id?.ToString(), out var parsedFailedUserId) ? parsedFailedUserId : null;
            await RecordSecurityEventAsync(conn, "LoginFailed", "medium", dto.UsernameOrEmail, failedUserId, "Invalid password.");
            return Unauthorized(new { message = "Invalid credentials" });
        }

        await rdr.CloseAsync(); // safe now

       // var token = _jwtService.GenerateToken(Guid.NewGuid(), username, display, role);
        var userGuid = Guid.Parse(id.ToString());
        var blockReason = await GetActiveUserBlockReasonAsync(conn, userGuid);
        if (!string.IsNullOrWhiteSpace(blockReason))
        {
            await RecordSecurityEventAsync(conn, "BlockedLogin", "high", username, userGuid, blockReason);
            return StatusCode(423, new { message = "Your access is blocked. Please contact Mahima Ministry admin.", reason = blockReason });
        }

        if (mfaEnabled && !string.IsNullOrWhiteSpace(mfaSecret))
        {
            var challengeId = MfaChallengeStore.Create(userGuid);
            return Ok(new
            {
                mfaRequired = true,
                challengeId,
                message = "Enter the 6-digit code from your authenticator app to finish signing in."
            });
        }

	var token = _jwtService.GenerateToken(userGuid, username, display, role, tenantId);
        var roles = await LoadEffectiveRoles(conn, userGuid, role);
        var pages = await LoadPermissions(conn, roles, tenantId ?? Guid.Parse("00000000-0000-0000-0000-000000000001"));
        await Mahima.Api.v3.clean.Controllers.PositionsController.EnsureDefaultMemberPositionForUserAsync(conn, userGuid);
        var positions = await Mahima.Api.v3.clean.Controllers.PositionsController.LoadUserPositionsAsync(conn, userGuid);

        return Ok(new
        {
            token,
            user = new
            {
                id,
                username,
                display,
                email,
                phone,
                tenantId,
                role,
                roles,
                pages,
                positions,
                primaryPosition = positions.FirstOrDefault()
            }
        });
    }
    catch (Exception ex)
    {
        _logger.LogError(ex, "Login failed");

        return StatusCode(500, new
        {
            message = "Database error",
            detail = ex.Message
        });
    }
}

    // ============================
    // MULTI-FACTOR AUTHENTICATION (TOTP)
    // ============================

    /// <summary>In-memory store for short-lived post-password MFA challenges issued by Login().</summary>
    private static class MfaChallengeStore
    {
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<Guid, (Guid UserId, DateTime ExpiresAtUtc)> _challenges = new();
        private static readonly TimeSpan Ttl = TimeSpan.FromMinutes(5);

        public static Guid Create(Guid userId)
        {
            Cleanup();
            var challengeId = Guid.NewGuid();
            _challenges[challengeId] = (userId, DateTime.UtcNow.Add(Ttl));
            return challengeId;
        }

        public static bool TryConsume(Guid challengeId, out Guid userId)
        {
            userId = Guid.Empty;
            if (!_challenges.TryRemove(challengeId, out var entry)) return false;
            if (entry.ExpiresAtUtc < DateTime.UtcNow) return false;
            userId = entry.UserId;
            return true;
        }

        private static void Cleanup()
        {
            var now = DateTime.UtcNow;
            foreach (var kvp in _challenges)
                if (kvp.Value.ExpiresAtUtc < now) _challenges.TryRemove(kvp.Key, out _);
        }
    }

    public class MfaLoginVerifyDto
    {
        public Guid ChallengeId { get; set; }
        public string Code { get; set; } = "";
    }

    public class MfaVerifySetupDto
    {
        public string Code { get; set; } = "";
    }

    public class MfaDisableDto
    {
        public string Password { get; set; } = "";
    }

    // Second step of login when the account has MFA enabled: exchange the challenge + a
    // 6-digit authenticator code (or a one-time recovery code) for the real session token.
    [HttpPost("mfa/login-verify")]
    public async Task<IActionResult> MfaLoginVerify([FromBody] MfaLoginVerifyDto dto)
    {
        if (dto == null || dto.ChallengeId == Guid.Empty || string.IsNullOrWhiteSpace(dto.Code))
            return BadRequest(new { message = "Challenge id and code are required." });

        if (!MfaChallengeStore.TryConsume(dto.ChallengeId, out var userGuid))
            return Unauthorized(new { message = "This sign-in attempt has expired. Please log in again." });

        using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync();

        var sql = @"
SELECT u.id, u.username, u.displayname, u.email, u.phone, u.tenant_id, r.name as role,
       u.mfa_secret, u.mfa_recovery_codes
FROM users u
JOIN roles r ON r.id = u.role::int
WHERE u.id = @id
LIMIT 1;";
        await using var cmd = new NpgsqlCommand(sql, conn);
        cmd.Parameters.Add("id", NpgsqlTypes.NpgsqlDbType.Uuid).Value = userGuid;
        await using var rdr = await cmd.ExecuteReaderAsync();
        if (!await rdr.ReadAsync()) return Unauthorized(new { message = "User not found." });

        var id = rdr["id"];
        var username = rdr["username"]?.ToString();
        var display = rdr["displayname"]?.ToString();
        var email = rdr["email"]?.ToString();
        var phone = rdr["phone"]?.ToString();
        var tenantId = rdr["tenant_id"] == DBNull.Value ? (Guid?)null : Guid.Parse(rdr["tenant_id"].ToString()!);
        var role = rdr["role"]?.ToString() ?? "";
        var mfaSecret = rdr["mfa_secret"] as string;
        var recoveryCodesRaw = rdr["mfa_recovery_codes"] as string;
        await rdr.CloseAsync();

        var code = dto.Code.Trim();
        var validTotp = TotpHelper.VerifyCode(mfaSecret ?? "", code);
        var recoveryCodes = (recoveryCodesRaw ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).ToList();
        var usedRecoveryCode = recoveryCodes.FirstOrDefault(c => string.Equals(c, code, StringComparison.OrdinalIgnoreCase));

        if (!validTotp && usedRecoveryCode == null)
        {
            await RecordSecurityEventAsync(conn, "MfaFailed", "high", username, userGuid, "Invalid authenticator code.");
            return Unauthorized(new { message = "Invalid or expired code." });
        }

        if (usedRecoveryCode != null)
        {
            recoveryCodes.Remove(usedRecoveryCode);
            await using var updateCmd = new NpgsqlCommand("UPDATE users SET mfa_recovery_codes = @codes WHERE id = @id", conn);
            updateCmd.Parameters.AddWithValue("codes", NpgsqlTypes.NpgsqlDbType.Text, string.Join(",", recoveryCodes));
            updateCmd.Parameters.Add("id", NpgsqlTypes.NpgsqlDbType.Uuid).Value = userGuid;
            await updateCmd.ExecuteNonQueryAsync();
        }

        var token = _jwtService.GenerateToken(userGuid, username, display, role, tenantId);
        var roles = await LoadEffectiveRoles(conn, userGuid, role);
        var pages = await LoadPermissions(conn, roles, tenantId ?? Guid.Parse("00000000-0000-0000-0000-000000000001"));
        await Mahima.Api.v3.clean.Controllers.PositionsController.EnsureDefaultMemberPositionForUserAsync(conn, userGuid);
        var positions = await Mahima.Api.v3.clean.Controllers.PositionsController.LoadUserPositionsAsync(conn, userGuid);

        return Ok(new
        {
            token,
            user = new
            {
                id, username, display, email, phone, tenantId, role, roles, pages, positions,
                primaryPosition = positions.FirstOrDefault()
            }
        });
    }

    [Authorize]
    [HttpGet("mfa/status")]
    public async Task<IActionResult> MfaStatus()
    {
        var userId = CurrentAuthUserId();
        if (userId == null) return Unauthorized();

        using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync();
        await using var cmd = new NpgsqlCommand("SELECT mfa_enabled FROM users WHERE id = @id", conn);
        cmd.Parameters.Add("id", NpgsqlTypes.NpgsqlDbType.Uuid).Value = userId.Value;
        var enabled = (bool?)(await cmd.ExecuteScalarAsync()) ?? false;
        return Ok(new { enabled });
    }

    // Step 1 of enabling MFA: generate a pending secret and return the otpauth:// URI for the
    // user's authenticator app. Nothing is enforced until verify-setup succeeds.
    [Authorize]
    [HttpPost("mfa/setup")]
    public async Task<IActionResult> MfaSetup()
    {
        var userId = CurrentAuthUserId();
        if (userId == null) return Unauthorized();

        using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync();

        await using var userCmd = new NpgsqlCommand("SELECT username, email FROM users WHERE id = @id", conn);
        userCmd.Parameters.Add("id", NpgsqlTypes.NpgsqlDbType.Uuid).Value = userId.Value;
        await using var rdr = await userCmd.ExecuteReaderAsync();
        if (!await rdr.ReadAsync()) return Unauthorized();
        var accountLabel = (rdr["email"] as string) ?? (rdr["username"] as string) ?? "user";
        await rdr.CloseAsync();

        var secret = TotpHelper.GenerateSecret();
        await using var updateCmd = new NpgsqlCommand("UPDATE users SET mfa_pending_secret = @secret WHERE id = @id", conn);
        updateCmd.Parameters.AddWithValue("secret", NpgsqlTypes.NpgsqlDbType.Text, secret);
        updateCmd.Parameters.Add("id", NpgsqlTypes.NpgsqlDbType.Uuid).Value = userId.Value;
        await updateCmd.ExecuteNonQueryAsync();

        var otpauthUri = TotpHelper.BuildOtpAuthUri(secret, accountLabel, "Mahima");
        return Ok(new { secret, otpauthUri });
    }

    // Step 2: confirm the user's authenticator app produces valid codes, then turn MFA on
    // and hand back one-time recovery codes (shown to the user exactly once).
    [Authorize]
    [HttpPost("mfa/verify-setup")]
    public async Task<IActionResult> MfaVerifySetup([FromBody] MfaVerifySetupDto dto)
    {
        var userId = CurrentAuthUserId();
        if (userId == null) return Unauthorized();
        if (dto == null || string.IsNullOrWhiteSpace(dto.Code)) return BadRequest(new { message = "Code is required." });

        using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync();

        await using var cmd = new NpgsqlCommand("SELECT mfa_pending_secret FROM users WHERE id = @id", conn);
        cmd.Parameters.Add("id", NpgsqlTypes.NpgsqlDbType.Uuid).Value = userId.Value;
        var pendingSecret = (await cmd.ExecuteScalarAsync()) as string;
        if (string.IsNullOrWhiteSpace(pendingSecret))
            return BadRequest(new { message = "Start MFA setup first." });

        if (!TotpHelper.VerifyCode(pendingSecret, dto.Code.Trim()))
            return BadRequest(new { message = "That code did not match. Check the time on your device and try again." });

        var recoveryCodes = Enumerable.Range(0, 8).Select(_ => TotpHelper.GenerateRecoveryCode()).ToList();

        await using var updateCmd = new NpgsqlCommand(@"
UPDATE users SET
  mfa_enabled = true,
  mfa_secret = @secret,
  mfa_pending_secret = NULL,
  mfa_recovery_codes = @codes,
  mfa_enabled_at_utc = now()
WHERE id = @id", conn);
        updateCmd.Parameters.AddWithValue("secret", NpgsqlTypes.NpgsqlDbType.Text, pendingSecret);
        updateCmd.Parameters.AddWithValue("codes", NpgsqlTypes.NpgsqlDbType.Text, string.Join(",", recoveryCodes));
        updateCmd.Parameters.Add("id", NpgsqlTypes.NpgsqlDbType.Uuid).Value = userId.Value;
        await updateCmd.ExecuteNonQueryAsync();

        return Ok(new { enabled = true, recoveryCodes });
    }

    [Authorize]
    [HttpPost("mfa/disable")]
    public async Task<IActionResult> MfaDisable([FromBody] MfaDisableDto dto)
    {
        var userId = CurrentAuthUserId();
        if (userId == null) return Unauthorized();
        if (dto == null || string.IsNullOrWhiteSpace(dto.Password))
            return BadRequest(new { message = "Confirm your password to disable MFA." });

        using var conn = new NpgsqlConnection(_connStr);
        await conn.OpenAsync();

        await using var cmd = new NpgsqlCommand("SELECT passwordhash FROM users WHERE id = @id", conn);
        cmd.Parameters.Add("id", NpgsqlTypes.NpgsqlDbType.Uuid).Value = userId.Value;
        var storedHash = (await cmd.ExecuteScalarAsync()) as string;
        if (string.IsNullOrWhiteSpace(storedHash)) return Unauthorized();

        var result = _pwHasher.VerifyHashedPassword(null, storedHash, dto.Password);
        if (result != PasswordVerificationResult.Success && result != PasswordVerificationResult.SuccessRehashNeeded)
            return Unauthorized(new { message = "Incorrect password." });

        await using var updateCmd = new NpgsqlCommand(@"
UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_pending_secret = NULL, mfa_recovery_codes = NULL
WHERE id = @id", conn);
        updateCmd.Parameters.Add("id", NpgsqlTypes.NpgsqlDbType.Uuid).Value = userId.Value;
        await updateCmd.ExecuteNonQueryAsync();

        return Ok(new { enabled = false });
    }

    private Guid? CurrentAuthUserId()
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub") ?? User.FindFirstValue("nameid");
        return Guid.TryParse(raw, out var id) ? id : null;
    }

    // ============================
    // ?? PERMISSION LOADER
    // ============================
    private async Task<List<string>> LoadEffectiveRoles(NpgsqlConnection conn, Guid userId, string? fallbackRole)
    {
        var roles = new List<string>();
        await EnsureUserRoleAssignmentsTableAsync(conn);
        await using (var cmd = new NpgsqlCommand(@"
SELECT DISTINCT r.name
FROM public.user_roles ur
JOIN public.roles r ON r.id = ur.role_id
WHERE ur.user_id = @user_id
ORDER BY r.name;", conn))
        {
            cmd.Parameters.AddWithValue("user_id", NpgsqlTypes.NpgsqlDbType.Uuid, userId);
            await using var rdr = await cmd.ExecuteReaderAsync();
            while (await rdr.ReadAsync())
            {
                var value = rdr.IsDBNull(0) ? "" : rdr.GetString(0);
                if (!string.IsNullOrWhiteSpace(value)) roles.Add(value);
            }
        }

        if (!roles.Any() && !string.IsNullOrWhiteSpace(fallbackRole)) roles.Add(fallbackRole);
        return roles.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static async Task EnsureUserRoleAssignmentsTableAsync(NpgsqlConnection conn)
    {
        await using var cmd = new NpgsqlCommand(@"
CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role_id integer NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    is_primary boolean NOT NULL DEFAULT false,
    assigned_at_utc timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS ix_user_roles_user ON public.user_roles(user_id);", conn);
        await cmd.ExecuteNonQueryAsync();
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
        ["TENANT_DASHBOARD"] = "admin_tools",
        ["SAAS_BILLING"] = "admin_tools",
        ["LANGUAGES"] = "admin_tools",
        ["APP_DOWNLOADS"] = "base",
        ["MESSAGE_CENTER"] = "communications",
        ["EMAIL_CLIENT"] = "communications",
        ["GOOGLE_DRIVE"] = "communications",
        ["SERVER_FILES"] = "communications"
    };

    private static readonly string[] BasePageKeys =
    {
        "DASHBOARD", "SUBSCRIPTIONS", "LANDING_PAGE", "USERS", "PRAYER_REQUESTS", "SERMONS", "TEAMS", "ROLES", "PAGES", "APP_DOWNLOADS", "SECURITY"
    };

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
JOIN public.subscription_plan_publications publication
  ON publication.plan_id = subscription.plan_id
 AND publication.version = subscription.applied_plan_version
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
        return keys;
    }

    private async Task<List<string>> LoadPermissions(NpgsqlConnection conn, string? role, Guid tenantId)
    {
        return await LoadPermissions(conn, new[] { role }, tenantId);
    }

    private async Task<List<string>> LoadPermissions(NpgsqlConnection conn, IEnumerable<string?> roles, Guid tenantId)
    {
        await EnsureTenantRolePermissionsTableAsync(conn);
        var licensedKeys = await LoadLicensedPageKeysAsync(conn, tenantId);
        var roleList = roles.Select(r => (r ?? "").Trim()).Where(r => r.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var isAdmin = roleList.Any(r => string.Equals(r, "admin", StringComparison.OrdinalIgnoreCase));
        if (isAdmin)
            return licensedKeys.OrderBy(k => k).ToList();

        var pages = new List<string>();
        if (roleList.Length == 0) return pages;

        var permSql = @"
WITH selected_roles AS (
    SELECT id FROM roles WHERE LOWER(name) = ANY(@roles)
),
tenant_perms AS (
    SELECT trp.page_key
    FROM tenant_role_permissions trp
    JOIN selected_roles sr ON sr.id = trp.role_id
    WHERE trp.tenant_id = @tenant_id
),
global_perms AS (
    SELECT rp.page_key
    FROM role_permissions rp
    JOIN selected_roles sr ON sr.id = rp.role_id
    WHERE NOT EXISTS (SELECT 1 FROM tenant_perms)
)
SELECT page_key FROM tenant_perms
UNION
SELECT page_key FROM global_perms;";

        await using var permCmd = new NpgsqlCommand(permSql, conn);
        permCmd.Parameters.AddWithValue("roles", NpgsqlTypes.NpgsqlDbType.Array | NpgsqlTypes.NpgsqlDbType.Text, roleList.Select(r => r.ToLowerInvariant()).ToArray());
        permCmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, tenantId);

        await using var permRdr = await permCmd.ExecuteReaderAsync();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        while (await permRdr.ReadAsync())
        {
            var pageKey = permRdr.GetString(0).Trim().ToUpperInvariant();
            if (pageKey.Length > 0 && licensedKeys.Contains(pageKey) && seen.Add(pageKey))
                pages.Add(pageKey);
        }

        pages.RemoveAll(page => string.Equals(page, "MULTITENANT", StringComparison.OrdinalIgnoreCase) || string.Equals(page, "SAAS_BILLING", StringComparison.OrdinalIgnoreCase));
        return pages;
    }

    // ====================================================================
    //  FORGOT PASSWORD
    // ====================================================================
    public class ForgotPasswordDto
    {
        public string? UsernameOrEmail { get; set; }
    }

    public class ResetPasswordDto
    {
        public string? Token { get; set; }
        public string? NewPassword { get; set; }
    }

    public class DirectResetPasswordDto
    {
        public string? UsernameOrEmail { get; set; }
        public string? Phone { get; set; }
        public string? NewPassword { get; set; }
    }

    /// <summary>
    /// Issues a single-use password reset token. To prevent account
    /// enumeration we always respond 200 OK with the same body regardless
    /// of whether the user was found.
    /// </summary>
    [AllowAnonymous]
    [HttpPost("forgot-password")]
    public async Task<IActionResult> ForgotPassword([FromBody] ForgotPasswordDto dto)
    {
        var generic = new {
            message = "If an account exists for that address, a password reset link has been sent."
        };

        if (dto == null || string.IsNullOrWhiteSpace(dto.UsernameOrEmail))
            return Ok(generic);

        var input = dto.UsernameOrEmail.Trim().ToLowerInvariant();

        try
        {
            var currentTenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
            var currentTenantId = currentTenant?.Id ?? Guid.Parse("00000000-0000-0000-0000-000000000001");
            var explicitTenantHint = HasExplicitTenantHint();

            await using var conn = new NpgsqlConnection(_connStr);
            await conn.OpenAsync();

            var configuredRootUsername = _config["RootAdmin:Username"]?.Trim().ToLowerInvariant();
            var configuredRootEmail = _config["RootAdmin:GoogleEmail"]?.Trim().ToLowerInvariant();
            if (currentTenant?.IsRootTenant == true &&
                !string.IsNullOrWhiteSpace(configuredRootUsername) &&
                !string.IsNullOrWhiteSpace(configuredRootEmail) &&
                string.Equals(input, configuredRootUsername, StringComparison.OrdinalIgnoreCase))
            {
                await using var bindRootEmail = new NpgsqlCommand(@"
WITH root_user AS (
    SELECT id
    FROM public.users
    WHERE tenant_id = @tenant_id
      AND LOWER(TRIM(username)) = @root_username
    LIMIT 1
)
UPDATE public.users
SET email = NULL
WHERE tenant_id = @tenant_id
  AND id <> COALESCE((SELECT id FROM root_user), '00000000-0000-0000-0000-000000000000'::uuid)
  AND LOWER(TRIM(COALESCE(email, ''))) = @root_email;

UPDATE public.users
SET email = @root_email
WHERE tenant_id = @tenant_id
  AND LOWER(TRIM(username)) = @root_username;", conn);
                bindRootEmail.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, currentTenantId);
                bindRootEmail.Parameters.AddWithValue("root_username", NpgsqlTypes.NpgsqlDbType.Text, configuredRootUsername);
                bindRootEmail.Parameters.AddWithValue("root_email", NpgsqlTypes.NpgsqlDbType.Text, configuredRootEmail);
                await bindRootEmail.ExecuteNonQueryAsync();
                _logger.LogInformation("Ensured configured recovery email is bound to root account {Username}.", configuredRootUsername);
            }

            // Find the user (username OR email, case-insensitive).
            var lookupSql = @"
SELECT u.id, u.email, u.username, u.displayname, u.tenant_id, t.slug
FROM public.users u
LEFT JOIN public.tenants t ON t.id = u.tenant_id
WHERE u.tenant_id = @tenant_id
  AND (LOWER(TRIM(u.username)) = @u OR LOWER(TRIM(u.email)) = @u)
LIMIT 1;";

            Guid userId = Guid.Empty;
            string? email = null, username = null, displayName = null;
            Guid matchedTenantId = currentTenantId;
            string? matchedTenantSlug = currentTenant?.Slug;

            await using (var cmd = new NpgsqlCommand(lookupSql, conn))
            {
                cmd.Parameters.AddWithValue("u", input);
                cmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, currentTenantId);
                await using var rdr = await cmd.ExecuteReaderAsync();
                if (await rdr.ReadAsync())
                {
                    userId      = rdr.GetGuid(0);
                    email       = rdr.IsDBNull(1) ? null : rdr.GetString(1);
                    username    = rdr.IsDBNull(2) ? null : rdr.GetString(2);
                    displayName = rdr.IsDBNull(3) ? null : rdr.GetString(3);
                    matchedTenantId = rdr.GetGuid(4);
                    matchedTenantSlug = rdr.IsDBNull(5) ? matchedTenantSlug : rdr.GetString(5);
                }
            }

            // No user, or user has no email on file — return the same response.
            if (userId == Guid.Empty && !explicitTenantHint)
            {
                var fallbackMatches = new List<(Guid UserId, string? Email, string? Username, string? DisplayName, Guid TenantId, string? TenantSlug)>();
                await using (var fallback = new NpgsqlCommand(@"
SELECT u.id, u.email, u.username, u.displayname, u.tenant_id, t.slug
FROM public.users u
LEFT JOIN public.tenants t ON t.id = u.tenant_id
WHERE (LOWER(TRIM(u.username)) = @u OR LOWER(TRIM(u.email)) = @u)
  AND COALESCE(t.status, 'active') = 'active'
LIMIT 2;", conn))
                {
                    fallback.Parameters.AddWithValue("u", input);
                    await using var rdr = await fallback.ExecuteReaderAsync();
                    while (await rdr.ReadAsync())
                    {
                        fallbackMatches.Add((
                            rdr.GetGuid(0),
                            rdr.IsDBNull(1) ? null : rdr.GetString(1),
                            rdr.IsDBNull(2) ? null : rdr.GetString(2),
                            rdr.IsDBNull(3) ? null : rdr.GetString(3),
                            rdr.GetGuid(4),
                            rdr.IsDBNull(5) ? null : rdr.GetString(5)));
                    }
                }

                if (fallbackMatches.Count == 1)
                {
                    var match = fallbackMatches[0];
                    userId = match.UserId;
                    email = match.Email;
                    username = match.Username;
                    displayName = match.DisplayName;
                    matchedTenantId = match.TenantId;
                    matchedTenantSlug = match.TenantSlug;
                    _logger.LogInformation("Password reset tenant fallback matched unique user {UserId} in tenant {TenantId} ({TenantSlug}).", userId, matchedTenantId, matchedTenantSlug);
                }
                else if (fallbackMatches.Count > 1)
                {
                    _logger.LogWarning("Password reset tenant fallback found multiple users for the supplied identifier; no email was sent.");
                }
            }

            if (userId == Guid.Empty || string.IsNullOrWhiteSpace(email))
            {
                _logger.LogInformation("Password reset request did not send email. TenantId={TenantId} TenantSlug={TenantSlug} ExplicitTenantHint={ExplicitTenantHint} UserFound={UserFound} HasEmail={HasEmail}",
                    currentTenantId,
                    currentTenant?.Slug,
                    explicitTenantHint,
                    userId != Guid.Empty,
                    !string.IsNullOrWhiteSpace(email));
                return Ok(generic);
            }

            // Generate a high-entropy token (32 bytes ˜ 256 bits) and store
            // only its SHA-256 hash. Link in the email carries the plaintext.
            var rawToken = GenerateUrlSafeToken(32);
            var tokenHash = Sha256Hex(rawToken);
            var expiresAt = DateTime.UtcNow.AddHours(1);

            // Invalidate any prior unused tokens for this user (best-effort).
            await using (var inv = new NpgsqlCommand(
                @"UPDATE public.password_reset_tokens
                     SET used_at = now()
                   WHERE user_id = @u AND used_at IS NULL;", conn))
            {
                inv.Parameters.Add("u", NpgsqlTypes.NpgsqlDbType.Uuid).Value = userId;
                await inv.ExecuteNonQueryAsync();
            }

            await using (var ins = new NpgsqlCommand(
                @"INSERT INTO public.password_reset_tokens (user_id, token_hash, expires_at, ip)
                  VALUES (@u, @h, @e, @ip);", conn))
            {
                ins.Parameters.Add("u",  NpgsqlTypes.NpgsqlDbType.Uuid).Value = userId;
                ins.Parameters.AddWithValue("h",  tokenHash);
                ins.Parameters.AddWithValue("e",  expiresAt);
                ins.Parameters.AddWithValue("ip", (object?)HttpContext.Connection.RemoteIpAddress?.ToString() ?? DBNull.Value);
                await ins.ExecuteNonQueryAsync();
            }

            // Build the email
            // The frontend uses HashRouter (URLs look like https://site/#/reset-password),
            // so we include the hash here. If you switch to BrowserRouter, change
            // App:ResetPath to "/reset-password" (no '#').
            var publicUrl  = ResolvePublicBaseUrl();
            var resetPath  = _config["App:ResetPath"] ?? "/#/reset-password";
            var tenantSlugParam = !string.IsNullOrWhiteSpace(matchedTenantSlug)
                ? $"&tenantSlug={WebUtility.UrlEncode(matchedTenantSlug)}"
                : "";
            var resetUrl   = $"{publicUrl}{resetPath}?token={WebUtility.UrlEncode(rawToken)}{tenantSlugParam}";
            var greeting  = !string.IsNullOrWhiteSpace(displayName) ? displayName! : (username ?? "there");

            var html = BuildResetEmailHtml(greeting, resetUrl);
            var text = BuildResetEmailText(greeting, resetUrl);

            try
            {
                await _emailService.SendAsync(email!, "Reset your Mahima Ministries password", html, text);
                _logger.LogInformation("Password reset email sent. TenantId={TenantId} TenantSlug={TenantSlug} UserId={UserId} To={Email}",
                    matchedTenantId,
                    matchedTenantSlug,
                    userId,
                    MaskEmail(email));
            }
            catch (Exception sendEx)
            {
                _logger.LogError(sendEx, "Password reset email failed to send. TenantId={TenantId} TenantSlug={TenantSlug} UserId={UserId} To={Email}",
                    matchedTenantId,
                    matchedTenantSlug,
                    userId,
                    MaskEmail(email));
                return StatusCode(503, new
                {
                    message = "The password reset email could not be delivered right now. Please contact the administrator or try again shortly."
                });
            }

            return Ok(generic);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "ForgotPassword error");
            return Ok(generic);
        }
    }

    /// <summary>
    /// Consumes a reset token and sets a new password. Token is single-use
    /// and verified against its SHA-256 hash. New password is hashed with
    /// the same PasswordHasher used at login time.
    /// </summary>
    [AllowAnonymous]
    [HttpPost("reset-password")]
    public async Task<IActionResult> ResetPasswordEndpoint([FromBody] ResetPasswordDto dto)
    {
        if (dto == null || string.IsNullOrWhiteSpace(dto.Token))
            return BadRequest(new { message = "Reset token is required." });

        if (string.IsNullOrWhiteSpace(dto.NewPassword) || dto.NewPassword.Length < 6)
            return BadRequest(new { message = "New password must be at least 6 characters." });

        var tokenHash = Sha256Hex(dto.Token);

        try
        {
            var currentTenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
            var currentTenantId = currentTenant?.Id ?? Guid.Parse("00000000-0000-0000-0000-000000000001");
            var explicitTenantHint = HasExplicitTenantHint();

            await using var conn = new NpgsqlConnection(_connStr);
            await conn.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            Guid userId = Guid.Empty;
            long tokenId = 0;

            await using (var look = new NpgsqlCommand(
                @"SELECT prt.id, prt.user_id
                    FROM public.password_reset_tokens prt
                    JOIN public.users u ON u.id = prt.user_id
                   WHERE prt.token_hash = @h
                     AND prt.used_at IS NULL
                     AND prt.expires_at > now()
                     AND u.tenant_id = @tenant_id
                   LIMIT 1;", conn, tx))
            {
                look.Parameters.AddWithValue("h", tokenHash);
                look.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, currentTenantId);
                await using var rdr = await look.ExecuteReaderAsync();
                if (await rdr.ReadAsync())
                {
                    tokenId = rdr.GetInt64(0);
                    userId  = rdr.GetGuid(1);
                }
            }

            if (userId == Guid.Empty && !explicitTenantHint)
            {
                await using var fallback = new NpgsqlCommand(
                    @"SELECT prt.id, prt.user_id, u.tenant_id
                        FROM public.password_reset_tokens prt
                        JOIN public.users u ON u.id = prt.user_id
                       WHERE prt.token_hash = @h
                         AND prt.used_at IS NULL
                         AND prt.expires_at > now()
                       LIMIT 1;", conn, tx);
                fallback.Parameters.AddWithValue("h", tokenHash);
                await using var rdr = await fallback.ExecuteReaderAsync();
                if (await rdr.ReadAsync())
                {
                    tokenId = rdr.GetInt64(0);
                    userId = rdr.GetGuid(1);
                    currentTenantId = rdr.GetGuid(2);
                    _logger.LogInformation("Password reset token fallback matched user {UserId} in tenant {TenantId}.", userId, currentTenantId);
                }
            }

            if (userId == Guid.Empty)
                return BadRequest(new { message = "This reset link is invalid or has expired." });

            // Hash the new password with the same hasher used in Login.
            var newHash = _pwHasher.HashPassword(null!, dto.NewPassword!);

            int updatedRows;
            await using (var upd = new NpgsqlCommand(
                @"UPDATE users SET passwordhash = @h WHERE id = @id AND tenant_id = @tenant_id;", conn, tx))
            {
                upd.Parameters.AddWithValue("h", newHash);
                upd.Parameters.Add("id", NpgsqlTypes.NpgsqlDbType.Uuid).Value = userId;
                upd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, currentTenantId);
                updatedRows = await upd.ExecuteNonQueryAsync();
            }

            if (updatedRows != 1)
            {
                await tx.RollbackAsync();
                _logger.LogError("Password reset matched token but updated {UpdatedRows} users. UserId={UserId} TenantId={TenantId}",
                    updatedRows, userId, currentTenantId);
                return StatusCode(500, new { message = "The password could not be saved. Please request a new reset link." });
            }

            await using (var verify = new NpgsqlCommand(
                @"SELECT passwordhash FROM users WHERE id = @id AND tenant_id = @tenant_id LIMIT 1;", conn, tx))
            {
                verify.Parameters.Add("id", NpgsqlTypes.NpgsqlDbType.Uuid).Value = userId;
                verify.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, currentTenantId);
                var savedHash = (await verify.ExecuteScalarAsync())?.ToString();
                var verification = string.IsNullOrWhiteSpace(savedHash)
                    ? PasswordVerificationResult.Failed
                    : _pwHasher.VerifyHashedPassword(null!, savedHash, dto.NewPassword!);
                if (verification == PasswordVerificationResult.Failed)
                {
                    await tx.RollbackAsync();
                    _logger.LogError("Password reset hash verification failed after update. UserId={UserId} TenantId={TenantId}",
                        userId, currentTenantId);
                    return StatusCode(500, new { message = "The password could not be verified after saving. Please request a new reset link." });
                }
            }

            await using (var consume = new NpgsqlCommand(
                @"UPDATE public.password_reset_tokens SET used_at = now() WHERE id = @id;", conn, tx))
            {
                consume.Parameters.AddWithValue("id", tokenId);
                await consume.ExecuteNonQueryAsync();
            }

            await tx.CommitAsync();

            return Ok(new { message = "Your password has been updated. You can now sign in." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "ResetPassword error");
            return StatusCode(500, new { message = "Something went wrong. Please request a new reset link." });
        }
    }

    [AllowAnonymous]
    [HttpPost("reset-password-direct")]
    public async Task<IActionResult> ResetPasswordDirect([FromBody] DirectResetPasswordDto dto)
    {
        if (dto == null || string.IsNullOrWhiteSpace(dto.UsernameOrEmail))
            return BadRequest(new { message = "Username or email is required." });

        if (string.IsNullOrWhiteSpace(dto.Phone))
            return BadRequest(new { message = "Registered mobile number is required." });

        if (string.IsNullOrWhiteSpace(dto.NewPassword) || dto.NewPassword.Length < 6)
            return BadRequest(new { message = "New password must be at least 6 characters." });

        var input = dto.UsernameOrEmail.Trim().ToLowerInvariant();
        var phoneDigits = DigitsOnly(dto.Phone);

        try
        {
            var currentTenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
            var currentTenantId = currentTenant?.Id ?? Guid.Parse("00000000-0000-0000-0000-000000000001");
            var explicitTenantHint = HasExplicitTenantHint();

            await using var conn = new NpgsqlConnection(_connStr);
            await conn.OpenAsync();

            var matches = new List<(Guid UserId, Guid TenantId, string? Phone)>();
            var sql = explicitTenantHint
                ? @"
SELECT u.id, u.tenant_id, u.phone
FROM public.users u
WHERE u.tenant_id = @tenant_id
  AND (LOWER(TRIM(u.username)) = @u OR LOWER(TRIM(COALESCE(u.email, ''))) = @u)
LIMIT 2;"
                : @"
SELECT u.id, u.tenant_id, u.phone
FROM public.users u
LEFT JOIN public.tenants t ON t.id = u.tenant_id
WHERE (LOWER(TRIM(u.username)) = @u OR LOWER(TRIM(COALESCE(u.email, ''))) = @u)
  AND COALESCE(t.status, 'active') = 'active'
LIMIT 2;";

            await using (var cmd = new NpgsqlCommand(sql, conn))
            {
                cmd.Parameters.AddWithValue("u", input);
                if (explicitTenantHint)
                    cmd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, currentTenantId);

                await using var rdr = await cmd.ExecuteReaderAsync();
                while (await rdr.ReadAsync())
                {
                    matches.Add((
                        rdr.GetGuid(0),
                        rdr.GetGuid(1),
                        rdr.IsDBNull(2) ? null : rdr.GetString(2)));
                }
            }

            if (matches.Count != 1)
            {
                _logger.LogWarning("Direct password reset blocked. TenantId={TenantId} ExplicitTenantHint={ExplicitTenantHint} MatchCount={MatchCount}",
                    currentTenantId,
                    explicitTenantHint,
                    matches.Count);
                return BadRequest(new { message = "We could not verify this account. Please check the username/email and registered mobile number." });
            }

            var match = matches[0];
            if (string.IsNullOrWhiteSpace(match.Phone) || DigitsOnly(match.Phone) != phoneDigits)
            {
                _logger.LogWarning("Direct password reset blocked due to mobile mismatch. TenantId={TenantId} UserId={UserId}",
                    match.TenantId,
                    match.UserId);
                return BadRequest(new { message = "We could not verify this account. Please check the username/email and registered mobile number." });
            }

            var newHash = _pwHasher.HashPassword(null!, dto.NewPassword!);
            await using (var upd = new NpgsqlCommand(
                @"UPDATE public.users
                     SET passwordhash = @h
                   WHERE id = @id AND tenant_id = @tenant_id;", conn))
            {
                upd.Parameters.AddWithValue("h", newHash);
                upd.Parameters.AddWithValue("id", NpgsqlTypes.NpgsqlDbType.Uuid, match.UserId);
                upd.Parameters.AddWithValue("tenant_id", NpgsqlTypes.NpgsqlDbType.Uuid, match.TenantId);
                await upd.ExecuteNonQueryAsync();
            }

            _logger.LogInformation("Direct password reset completed. TenantId={TenantId} UserId={UserId}",
                match.TenantId,
                match.UserId);

            return Ok(new { message = "Your password has been reset. You can sign in now." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Direct password reset failed");
            return StatusCode(500, new { message = "Something went wrong. Please try again." });
        }
    }

    // -------- helpers --------
    private static string GenerateUrlSafeToken(int byteLength)
    {
        var bytes = new byte[byteLength];
        using var rng = RandomNumberGenerator.Create();
        rng.GetBytes(bytes);
        return Convert.ToBase64String(bytes)
            .Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }

    private static string Sha256Hex(string input)
    {
        using var sha = SHA256.Create();
        var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(input));
        var sb = new StringBuilder(bytes.Length * 2);
        foreach (var b in bytes) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }

    private static string DigitsOnly(string? value)
    {
        return new string((value ?? "").Where(char.IsDigit).ToArray());
    }

    private string ResolvePublicBaseUrl()
    {
        var configuredPublicUrl = _config["App:PublicUrl"]?.Trim();
        if (!string.IsNullOrWhiteSpace(configuredPublicUrl))
            return configuredPublicUrl.TrimEnd('/');

        var forwardedProto = Request.Headers["X-Forwarded-Proto"].FirstOrDefault();
        var forwardedHost = Request.Headers["X-Forwarded-Host"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(forwardedHost))
        {
            var proto = string.IsNullOrWhiteSpace(forwardedProto) ? "https" : forwardedProto.Trim();
            return $"{proto}://{forwardedHost.Trim()}".TrimEnd('/');
        }

        if (Request.Host.HasValue)
        {
            var scheme = string.IsNullOrWhiteSpace(forwardedProto) ? Request.Scheme : forwardedProto.Trim();
            if (string.Equals(scheme, "http", StringComparison.OrdinalIgnoreCase) &&
                !Request.Host.Host.Contains("localhost", StringComparison.OrdinalIgnoreCase))
                scheme = "https";
            return $"{scheme}://{Request.Host.Value}".TrimEnd('/');
        }

        return (_config["Saas:PublicBaseUrl"] ?? _config["App:PublicUrl"] ?? "https://beta.mahimaministries.in").TrimEnd('/');
    }

    private bool HasExplicitTenantHint()
    {
        return !string.IsNullOrWhiteSpace(Request.Headers["X-Tenant-Id"].FirstOrDefault())
            || !string.IsNullOrWhiteSpace(Request.Headers["X-Tenant-Slug"].FirstOrDefault())
            || !string.IsNullOrWhiteSpace(Request.Query["tenant"].FirstOrDefault())
            || !string.IsNullOrWhiteSpace(Request.Query["tenantSlug"].FirstOrDefault());
    }

    private static string MaskEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email))
            return "";

        var at = email.IndexOf('@');
        if (at <= 1)
            return "***";

        var name = email[..at];
        var domain = email[(at + 1)..];
        var visible = name.Length <= 2 ? name[..1] : name[..Math.Min(2, name.Length)];
        return $"{visible}***@{domain}";
    }

    private static string BuildResetEmailHtml(string greeting, string resetUrl)
    {
        return $@"<!DOCTYPE html>
<html lang=""en"">
<head>
  <meta charset=""utf-8"" />
  <meta name=""viewport"" content=""width=device-width, initial-scale=1"" />
  <title>Reset your password</title>
</head>
<body style=""margin:0;padding:0;background:#f5f7fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1e293b;"">
  <table role=""presentation"" width=""100%"" cellpadding=""0"" cellspacing=""0"" style=""background:#f5f7fb;padding:32px 12px;"">
    <tr>
      <td align=""center"">
        <table role=""presentation"" width=""560"" cellpadding=""0"" cellspacing=""0"" style=""max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(15,23,42,0.06);"">
          <!-- header -->
          <tr>
            <td style=""padding:28px 28px 0;text-align:center;"">
              <div style=""display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6,#d946ef);color:#fff;padding:10px 14px;border-radius:14px;font-weight:700;letter-spacing:0.5px;font-size:14px;"">
                MAHIMA MINISTRIES
              </div>
            </td>
          </tr>
          <tr>
            <td style=""padding:24px 32px 8px;"">
              <h1 style=""margin:0 0 6px;font-size:22px;line-height:1.3;color:#0f172a;font-weight:700;"">Reset your password</h1>
              <p style=""margin:0;color:#475569;font-size:14px;line-height:1.55;"">Hi {WebUtility.HtmlEncode(greeting)},</p>
            </td>
          </tr>
          <tr>
            <td style=""padding:8px 32px 0;"">
              <p style=""margin:0 0 14px;color:#475569;font-size:14px;line-height:1.55;"">
                We received a request to reset the password for your Mahima Ministries account.
                Click the button below to choose a new password. This link will expire in 1 hour.
              </p>
            </td>
          </tr>
          <tr>
            <td align=""center"" style=""padding:18px 32px 6px;"">
              <a href=""{resetUrl}"" style=""display:inline-block;background:linear-gradient(135deg,#6366f1,#8b5cf6,#d946ef);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 28px;border-radius:999px;box-shadow:0 6px 18px rgba(99,102,241,0.35);"">
                Reset password
              </a>
            </td>
          </tr>
          <tr>
            <td style=""padding:16px 32px 0;"">
              <p style=""margin:0 0 6px;color:#64748b;font-size:12px;line-height:1.55;"">
                Or copy and paste this link into your browser:
              </p>
              <p style=""margin:0 0 18px;color:#1e293b;font-size:12px;line-height:1.55;word-break:break-all;"">
                <a href=""{resetUrl}"" style=""color:#6366f1;text-decoration:none;"">{resetUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style=""padding:0 32px;"">
              <div style=""border-top:1px solid #e2e8f0;margin:8px 0 16px;""></div>
              <p style=""margin:0;color:#94a3b8;font-size:12px;line-height:1.55;"">
                Didn't request this? You can safely ignore this email — your password will stay the same.
                For security, this link can only be used once.
              </p>
            </td>
          </tr>
          <tr>
            <td style=""padding:18px 32px 28px;text-align:center;color:#94a3b8;font-size:11px;"">
              © {DateTime.UtcNow.Year} Mahima Ministries · This is an automated message, please do not reply.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>";
    }

    private static string BuildResetEmailText(string greeting, string resetUrl)
    {
        return
$@"Hi {greeting},

We received a request to reset the password for your Mahima Ministries account.
Use the link below to choose a new password (valid for 1 hour, single-use):

{resetUrl}

If you didn't request this, you can safely ignore this email.

— Mahima Ministries";
    }
}

