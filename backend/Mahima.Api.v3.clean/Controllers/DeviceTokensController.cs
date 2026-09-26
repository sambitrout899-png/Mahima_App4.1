using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Dtos;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/device-tokens")]
    public class DeviceTokensController : ControllerBase
    {
        private const string KeyPrefix = "DeviceToken:";
        private readonly MahimaDbContext _db;
        private readonly ITenantContextService _tenantContext;
        private readonly IConfiguration _configuration;
        private readonly IMobilePushNotificationService? _mobilePush;
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");

        public DeviceTokensController(MahimaDbContext db, ITenantContextService tenantContext, IConfiguration configuration, IEnumerable<IMobilePushNotificationService> mobilePushServices)
        {
            _db = db;
            _tenantContext = tenantContext;
            _configuration = configuration;
            _mobilePush = mobilePushServices?.FirstOrDefault();
        }

        public class RegisterDeviceTokenDto
        {
            public string Token { get; set; } = string.Empty;
            public string? Platform { get; set; }
            public string? AppVersion { get; set; }
        }

        [HttpPost]
        public async Task<IActionResult> Register([FromBody] RegisterDeviceTokenDto dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.Token))
                return BadRequest("Device token is required.");

            var userId = CurrentUserId();
            if (userId == Guid.Empty)
                return Unauthorized();

            var tenantId = await GetCurrentTenantIdAsync();
            var tokenHash = Hash(dto.Token);
            var key = $"{KeyPrefix}{userId}:{tokenHash}";

            var staleRows = await _db.MinistryAutomationSettings
                .Where(s => s.Key.StartsWith(KeyPrefix) && s.Key.EndsWith($":{tokenHash}") && s.Key != key)
                .ToListAsync();
            if (staleRows.Count > 0)
            {
                _db.MinistryAutomationSettings.RemoveRange(staleRows);
            }

            var value = JsonSerializer.Serialize(new
            {
                userId,
                token = dto.Token.Trim(),
                platform = string.IsNullOrWhiteSpace(dto.Platform) ? "mobile" : dto.Platform.Trim(),
                appVersion = string.IsNullOrWhiteSpace(dto.AppVersion) ? "unknown" : dto.AppVersion.Trim(),
                updatedAtUtc = DateTime.UtcNow
            });

            var existing = await _db.MinistryAutomationSettings.FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Key == key);
            if (existing == null)
            {
                _db.MinistryAutomationSettings.Add(new MinistryAutomationSetting
                {
                    TenantId = tenantId,
                    Key = key,
                    Value = value,
                    UpdatedAtUtc = DateTime.UtcNow
                });
            }
            else
            {
                existing.Value = value;
                existing.UpdatedAtUtc = DateTime.UtcNow;
            }

            await _db.SaveChangesAsync();
            return Ok(new { saved = true });
        }

        [HttpGet]
        [Authorize(Roles = "admin,ADMIN")]
        public async Task<IActionResult> List()
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var rows = await _db.MinistryAutomationSettings
                .Where(s => s.TenantId == tenantId && s.Key.StartsWith(KeyPrefix))
                .OrderByDescending(s => s.UpdatedAtUtc)
                .ToListAsync();

            return Ok(rows.Select(s => new
            {
                id = s.Key,
                s.UpdatedAtUtc,
                token = MaskToken(ReadString(s.Value, "token")),
                platform = ReadString(s.Value, "platform"),
                appVersion = ReadString(s.Value, "appVersion"),
                userId = ReadString(s.Value, "userId")
            }));
        }

        [HttpGet("status")]
        public async Task<IActionResult> Status()
        {
            var userId = CurrentUserId();
            if (userId == Guid.Empty)
                return Unauthorized();

            var tokenPrefix = $"{KeyPrefix}{userId}:";
            var savedTokens = await _db.MinistryAutomationSettings
                .CountAsync(s => s.Key.StartsWith(tokenPrefix));

            var firebaseProjectId = FirstNonEmpty(
                _configuration["MobilePush:FirebaseProjectId"],
                _configuration["Firebase:ProjectId"],
                Environment.GetEnvironmentVariable("MAHIMA_FIREBASE_PROJECT_ID"),
                Environment.GetEnvironmentVariable("FIREBASE_PROJECT_ID"));
            var serviceAccount = FirstNonEmpty(
                _configuration["MobilePush:ServiceAccountJson"],
                _configuration["Firebase:ServiceAccountJson"],
                Environment.GetEnvironmentVariable("MAHIMA_FIREBASE_SERVICE_ACCOUNT_JSON"),
                Environment.GetEnvironmentVariable("FIREBASE_SERVICE_ACCOUNT_JSON"),
                Environment.GetEnvironmentVariable("GOOGLE_APPLICATION_CREDENTIALS"));
            var serviceAccountIsFile = !string.IsNullOrWhiteSpace(serviceAccount)
                && !serviceAccount.TrimStart().StartsWith("{", StringComparison.Ordinal)
                && System.IO.File.Exists(serviceAccount);

            return Ok(new
            {
                userId,
                mobilePushServiceRegistered = _mobilePush != null,
                savedTokens,
                firebaseProjectConfigured = !string.IsNullOrWhiteSpace(firebaseProjectId),
                serviceAccountConfigured = !string.IsNullOrWhiteSpace(serviceAccount),
                serviceAccountFileExists = serviceAccountIsFile
            });
        }

        public class TestPushDto
        {
            public string? Message { get; set; }
        }

        [HttpPost("test")]
        public async Task<IActionResult> SendTestPush([FromBody] TestPushDto? dto)
        {
            var userId = CurrentUserId();
            if (userId == Guid.Empty)
                return Unauthorized();

            if (_mobilePush == null)
                return StatusCode(503, new { message = "Mobile push service is not registered." });

            var tenantId = await GetCurrentTenantIdAsync();
            var message = string.IsNullOrWhiteSpace(dto?.Message)
                ? "Test notification from Mahima Ministry"
                : dto!.Message!.Trim();

            var sent = await _mobilePush.SendTestPushAsync(tenantId, userId, message);
            return Ok(new { sent });
        }

        private Guid CurrentUserId()
        {
            return Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var id) ? id : Guid.Empty;
        }

        private async Task<Guid> GetCurrentTenantIdAsync()
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
            return tenant?.Id ?? RootTenantId;
        }

        private static string Hash(string value)
        {
            using var sha = SHA256.Create();
            var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(value.Trim()));
            return Convert.ToHexString(bytes).ToLowerInvariant().Substring(0, 32);
        }

        private static string ReadString(string json, string property)
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                return doc.RootElement.TryGetProperty(property, out var prop) ? prop.ToString() : "";
            }
            catch
            {
                return "";
            }
        }

        private static string MaskToken(string token)
        {
            if (string.IsNullOrWhiteSpace(token)) return "";
            return token.Length <= 12 ? "********" : $"{token.Substring(0, 6)}...{token.Substring(token.Length - 6)}";
        }

        private static string? FirstNonEmpty(params string?[] values)
        {
            foreach (var value in values)
            {
                if (!string.IsNullOrWhiteSpace(value))
                    return value.Trim();
            }

            return null;
        }
    }
}
