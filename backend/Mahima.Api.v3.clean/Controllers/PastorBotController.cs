using System;
using System.Collections.Generic;
using System.Data;
using System.IO;
using System.Linq;
using System.IO.Compression;
using System.Text;
using System.Xml.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Dtos;
using Mahima.Api.v3.clean.Extensions;
using Mahima.Api.v3.clean.Hubs;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using iText.Kernel.Pdf;
using iText.Kernel.Pdf.Canvas.Parser;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/pastorbot")]
    public class PastorBotController : ControllerBase
    {
        private readonly IPastorBotService _pastorBot;
        private readonly IHubContext<ChatHub> _hub;
        private readonly IWebHostEnvironment _env;
        private readonly MahimaDbContext _db;
        private readonly ILogger<PastorBotController> _logger;

        public PastorBotController(IPastorBotService pastorBot, IHubContext<ChatHub> hub, IWebHostEnvironment env, MahimaDbContext db, ILogger<PastorBotController> logger)
        {
            _pastorBot = pastorBot;
            _hub = hub;
            _env = env;
            _db = db;
            _logger = logger;
        }

        [HttpPost("ask")]
        public async Task<IActionResult> Ask([FromBody] PastorBotAskDto dto)
        {
            var userId = User.GetUserIdGuid();
            if (userId == Guid.Empty) return Unauthorized();
            _logger.LogInformation("PastorBot ask received. UserId={UserId} Persona={Persona} Language={Language} SendToJaiMasih={SendToJaiMasih} HasQuestion={HasQuestion}",
                userId, dto?.Persona, dto?.Language, dto?.SendToJaiMasih, !string.IsNullOrWhiteSpace(dto?.Question));
            if (!await CanUsePastorAsync())
            {
                _logger.LogWarning("PastorBot ask denied for user {UserId}.", userId);
                return Forbid();
            }

            var reply = await _pastorBot.AskAsync(userId, dto.Question, dto.SendToJaiMasih, dto.Language, dto.Persona, dto.Conversation, HttpContext.RequestAborted);
            _logger.LogInformation("PastorBot ask completed. UserId={UserId} Source={Source} Persona={Persona} HasSharedMessages={HasSharedMessages}",
                userId, reply.Source, reply.Persona, reply.SharedMessages != null && reply.SharedMessages.Count > 0);
            if (reply.ChatId.HasValue)
            {
                await _hub.Clients.All.SendAsync("ChatCreated", new { id = reply.ChatId.Value, name = PastorBotService.JaiMasihChatName, isGroup = true });
            }

            if (reply.SharedMessages != null && reply.SharedMessages.Count > 0)
            {
                foreach (var message in reply.SharedMessages)
                {
                    var memberIds = await _db.ChatMembers
                        .AsNoTracking()
                        .Where(cm => cm.ChatId == message.ChatId)
                        .Select(cm => cm.UserId.ToString())
                        .Distinct()
                        .ToListAsync(HttpContext.RequestAborted);

                    if (memberIds.Count > 0)
                        await _hub.Clients.Users(memberIds).SendAsync("ReceiveMessage", message);
                }
            }

            return Ok(reply);
        }

        [HttpPost("readme")]
        [RequestSizeLimit(10_000_000)]
        public async Task<IActionResult> ReadMe([FromBody] PastorBotReadMeDto dto)
        {
            var userId = User.GetUserIdGuid();
            if (userId == Guid.Empty) return Unauthorized();
            if (!await CanUsePastorAsync()) return Forbid();

            if (dto == null || !dto.ConsentAccepted)
                return BadRequest("Consent is required before using ReadMe.");

            var suppliedDataUrl = string.IsNullOrWhiteSpace(dto.ArtifactDataUrl) ? dto.ImageDataUrl : dto.ArtifactDataUrl;
            if (string.IsNullOrWhiteSpace(suppliedDataUrl))
                return BadRequest("Capture a camera frame or upload an artifact first.");

            var image = suppliedDataUrl.Trim();
            var supported =
                image.StartsWith("data:image/jpeg;base64,", StringComparison.OrdinalIgnoreCase) ||
                image.StartsWith("data:image/png;base64,", StringComparison.OrdinalIgnoreCase) ||
                image.StartsWith("data:image/webp;base64,", StringComparison.OrdinalIgnoreCase);

            if (!supported)
            {
                try
                {
                    var extracted = ExtractArtifactText(image, dto.ArtifactName);
                    if (string.IsNullOrWhiteSpace(extracted)) return BadRequest("No readable text was found in this artifact.");
                    return Ok(await _pastorBot.ReadArtifactAsync(userId, dto.ArtifactName ?? "artifact", extracted, dto.Note, dto.Language, dto.Persona, HttpContext.RequestAborted));
                }
                catch (InvalidDataException ex) { return BadRequest(ex.Message); }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "ReadMe could not extract artifact {ArtifactName}.", dto.ArtifactName);
                    return BadRequest("This artifact could not be read. It may be encrypted, damaged, or use an unsupported format.");
                }
            }

            var reply = await _pastorBot.ReadMeAsync(
                userId,
                image,
                dto.Note,
                dto.Language,
                dto.Persona,
                HttpContext.RequestAborted);

            return Ok(reply);
        }

        private static string ExtractArtifactText(string dataUrl, string? fileName)
        {
            var comma = dataUrl.IndexOf(',');
            if (comma < 0 || !dataUrl[..comma].Contains(";base64", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("The uploaded artifact data is invalid.");
            byte[] bytes;
            try { bytes = Convert.FromBase64String(dataUrl[(comma + 1)..]); }
            catch (FormatException) { throw new InvalidDataException("The uploaded artifact could not be decoded."); }
            if (bytes.Length > 6_000_000) throw new InvalidDataException("Artifacts must be 6 MB or smaller.");

            var ext = Path.GetExtension(fileName ?? string.Empty).ToLowerInvariant();
            if (new[] { ".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".log" }.Contains(ext))
                return Encoding.UTF8.GetString(bytes);
            if (ext == ".pdf")
            {
                using var input = new MemoryStream(bytes);
                using var pdf = new PdfDocument(new PdfReader(input));
                var text = new StringBuilder();
                for (var page = 1; page <= Math.Min(pdf.GetNumberOfPages(), 100); page++) text.AppendLine(PdfTextExtractor.GetTextFromPage(pdf.GetPage(page)));
                return text.ToString();
            }
            if (new[] { ".docx", ".pptx", ".xlsx" }.Contains(ext))
            {
                using var input = new MemoryStream(bytes);
                using var zip = new ZipArchive(input, ZipArchiveMode.Read);
                var text = new StringBuilder();
                foreach (var entry in zip.Entries.Where(e => e.FullName.EndsWith(".xml", StringComparison.OrdinalIgnoreCase)))
                {
                    using var stream = entry.Open();
                    var document = XDocument.Load(stream);
                    foreach (var node in document.Descendants().Where(x => x.Name.LocalName is "t" or "p"))
                        if (!string.IsNullOrWhiteSpace(node.Value)) text.AppendLine(node.Value.Trim());
                }
                return text.ToString();
            }
            throw new InvalidDataException("Supported artifacts: images, PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx), CSV, JSON, Markdown, HTML, XML, log, and text files.");
        }

        [HttpPost("ensure-jai-masih")]
        public async Task<IActionResult> EnsureJaiMasih()
        {
            if (!await CanUsePastorAsync()) return Forbid();

            var chat = await _pastorBot.EnsureJaiMasihChatAsync(HttpContext.RequestAborted);
            return Ok(new { chat.Id, chat.Name, chat.IsGroup });
        }

        [HttpPost("voice-sample")]
        [Authorize(Roles = "admin,ADMIN")]
        [RequestSizeLimit(25_000_000)]
        public async Task<IActionResult> UploadVoiceSample([FromForm] IFormFile file)
        {
            if (file == null || file.Length == 0)
                return BadRequest("Audio file is required.");

            var allowed = new[] { ".wav", ".mp3", ".m4a", ".webm", ".ogg" };
            var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
            if (!allowed.Contains(ext))
                return BadRequest("Upload a WAV, MP3, M4A, WEBM, or OGG voice sample.");

            var root = _env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot");
            if (!Guid.TryParse(User.FindFirstValue("tenant_id"), out var storageTenantId)) return Forbid();
            var dir = Path.Combine(root, "uploads", "pastor-voice", storageTenantId.ToString("N"));
            Directory.CreateDirectory(dir);

            var fileName = $"pastor_voice_sample{ext}";
            var fullPath = Path.Combine(dir, fileName);
            await using (var stream = System.IO.File.Create(fullPath))
            {
                await file.CopyToAsync(stream, HttpContext.RequestAborted);
            }

            return Ok(new
            {
                message = "Voice sample stored. Use it only with explicit consent and label generated audio as AI-created.",
                url = $"/uploads/pastor-voice/{storageTenantId:N}/{fileName}"
            });
        }

        [HttpGet("voice-sample")]
        [Authorize(Roles = "admin,ADMIN")]
        public IActionResult GetVoiceSample()
        {
            var root = _env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot");
            if (!Guid.TryParse(User.FindFirstValue("tenant_id"), out var storageTenantId)) return Forbid();
            var dir = Path.Combine(root, "uploads", "pastor-voice", storageTenantId.ToString("N"));
            if (!Directory.Exists(dir)) return NotFound();

            var file = Directory.GetFiles(dir, "pastor_voice_sample.*").FirstOrDefault();
            if (file == null) return NotFound();

            return Ok(new { url = $"/uploads/pastor-voice/{storageTenantId:N}/{Path.GetFileName(file)}" });
        }

        private async Task<bool> CanUsePastorAsync()
        {
            if (User.IsInRole("admin") || User.IsInRole("ADMIN")) return true;

            var roleNames = User.Claims
                .Where(c => c.Type == ClaimTypes.Role || string.Equals(c.Type, "role", StringComparison.OrdinalIgnoreCase))
                .Select(c => c.Value)
                .Where(v => !string.IsNullOrWhiteSpace(v))
                .SelectMany(v => v.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            bool IsAdminLike(string value)
            {
                var normalized = new string((value ?? string.Empty)
                    .ToLowerInvariant()
                    .Where(char.IsLetterOrDigit)
                    .ToArray());
                return normalized == "admin"
                    || normalized == "administrator"
                    || normalized == "superadmin"
                    || normalized == "superadministrator"
                    || normalized == "superuser"
                    || normalized.Contains("admin");
            }

            if (roleNames.Any(IsAdminLike)) return true;
            if (roleNames.Count == 0) return false;

            var normalizedRoles = roleNames.Select(r => r.Trim().ToLower()).ToList();
            var roleIds = await _db.Roles
                .AsNoTracking()
                .Where(r => normalizedRoles.Contains(r.Name.ToLower()))
                .Select(r => r.Id)
                .ToListAsync(HttpContext.RequestAborted);

            if (roleIds.Count == 0) return false;

            var tenantId = Guid.TryParse(User.FindFirstValue("tenant_id"), out var parsedTenantId)
                ? parsedTenantId
                : Guid.Parse("00000000-0000-0000-0000-000000000001");

            var tenantPermission = await HasTenantPastorPermissionAsync(tenantId, roleIds);
            if (tenantPermission.HasValue) return tenantPermission.Value;

            return await _db.RolePermissions
                .AsNoTracking()
                .AnyAsync(rp => roleIds.Contains(rp.RoleId) && rp.PageKey.ToUpper() == "PASTOR", HttpContext.RequestAborted);
        }

        private async Task<bool?> HasTenantPastorPermissionAsync(Guid tenantId, IReadOnlyCollection<int> roleIds)
        {
            if (roleIds.Count == 0) return false;

            var conn = _db.Database.GetDbConnection();
            var shouldClose = conn.State != ConnectionState.Open;
            if (shouldClose) await conn.OpenAsync(HttpContext.RequestAborted);

            try
            {
                await using var existsCmd = conn.CreateCommand();
                existsCmd.CommandText = "SELECT to_regclass('public.tenant_role_permissions') IS NOT NULL;";
                var tableExists = await existsCmd.ExecuteScalarAsync(HttpContext.RequestAborted) as bool?;
                if (tableExists != true) return null;

                await using var cmd = conn.CreateCommand();
                var rolePlaceholders = roleIds.Select((_, index) => $"@role_id_{index}").ToArray();
                cmd.CommandText = @"
SELECT EXISTS (
    SELECT 1
    FROM public.tenant_role_permissions
    WHERE tenant_id = @tenant_id
      AND role_id IN (" + string.Join(", ", rolePlaceholders) + @")
      AND UPPER(page_key) = 'PASTOR'
);";

                var tenantParam = cmd.CreateParameter();
                tenantParam.ParameterName = "tenant_id";
                tenantParam.Value = tenantId;
                cmd.Parameters.Add(tenantParam);

                var roleIndex = 0;
                foreach (var roleId in roleIds)
                {
                    var roleParam = cmd.CreateParameter();
                    roleParam.ParameterName = $"role_id_{roleIndex}";
                    roleParam.Value = roleId;
                    cmd.Parameters.Add(roleParam);
                    roleIndex++;
                }

                return await cmd.ExecuteScalarAsync(HttpContext.RequestAborted) as bool?;
            }
            finally
            {
                if (shouldClose) await conn.CloseAsync();
            }
        }
    }
}
