using Mahima.Api.v3.clean.Data;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Mahima.Api.v3.clean;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Mahima.Api.v3.clean.Controllers
{
    public class BaptismRequestCreateDto
    {
        public string FullName { get; set; } = string.Empty;
        public string? FatherName { get; set; }
        public string? MotherName { get; set; }
        public DateTime? DateOfBirth { get; set; }
        public string? ContactNumber { get; set; }
        public string? Email { get; set; }
        public string? Address { get; set; }
        public DateTime? PreferredDate { get; set; }
        public string? PreferredService { get; set; }
    }

    public class BaptismRequestListItemDto
    {
        public int Id { get; set; }
        public string? Token { get; set; }
        public string FullName { get; set; } = string.Empty;
        public string? FatherName { get; set; }
        public string? MotherName { get; set; }
        public DateTime? DateOfBirth { get; set; }
        public string? ContactNumber { get; set; }
        public string? Email { get; set; }
        public string? Address { get; set; }
        public DateTime? PreferredDate { get; set; }
        public string? PreferredService { get; set; }
        public string Status { get; set; } = string.Empty;
        public bool ChurchVerified { get; set; }
        public bool ConsentSigned { get; set; }
        public string? CertificatePdfUrl { get; set; }
        public DateTime? BaptismDate { get; set; }
        public string? BaptismPlace { get; set; }
        public DateTime? CreatedAt { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public List<BaptismCertificateAttachmentDto> SignedCertificates { get; set; } = new();
    }

    public record BaptismCertificateAttachmentDto(long Id, string Filename, long? SizeBytes, DateTime UploadedAt);

    public class BaptismRequestDetailDto : BaptismRequestListItemDto
    {
        public DateTime? ChurchVerifiedAt { get; set; }
        public DateTime? ConsentSignedAt { get; set; }
    }

    // (Currently unused, but kept for future if you want to set date/place on complete)
    public class BaptismCompleteDto
    {
        public DateTime? BaptismDate { get; set; }
        public string? BaptismPlace { get; set; }
    }

    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class BaptismsController : ControllerBase
    {
        private readonly MahimaDbContext _db;
        private readonly IBaptismCertificateService _certificateService;
        private readonly ITenantPrintTemplateService _printTemplates;
        private readonly ILogger<BaptismsController> _logger;
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");
        private const string SignedCertificateOwner = "baptism-signed-certificate";
        private const long MaxCertificateBytes = 10 * 1024 * 1024;
        private readonly string _signedCertificateRoot;
        private readonly string _generatedCertificateRoot;

        public BaptismsController(
            MahimaDbContext db,
            IBaptismCertificateService certificateService,
            ITenantPrintTemplateService printTemplates,
            IWebHostEnvironment environment,
            IConfiguration configuration,
            ILogger<BaptismsController> logger)
        {
            _db = db;
            _certificateService = certificateService;
            _printTemplates = printTemplates;
            _logger = logger;
            // Private, non-web-exposed roots, tenant-scoped subfolders created on demand.
            // Must match BaptismCertificateService's own resolution of the generated root.
            _signedCertificateRoot = Path.GetFullPath(configuration["BaptismCertificates:SignedRoot"]
                ?? Path.Combine(environment.ContentRootPath, "App_Data", "baptism-certificates", "signed"));
            _generatedCertificateRoot = Path.GetFullPath(configuration["BaptismCertificates:GeneratedRoot"]
                ?? Path.Combine(environment.ContentRootPath, "App_Data", "baptism-certificates", "generated"));
        }

        // ---------- helpers ----------

        private static DateTime ToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                DateTimeKind.Unspecified => DateTime.SpecifyKind(dt, DateTimeKind.Utc),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        private static DateTime? ToUtc(DateTime? dt)
        {
            return dt.HasValue ? ToUtc(dt.Value) : null;
        }

        private int? GetCurrentUserId()
        {
            var claim = User.Claims.FirstOrDefault(c => c.Type == "sub" || c.Type == "userId");
            if (claim == null) return null;
            return int.TryParse(claim.Value, out var id) ? id : (int?)null;
        }

        private Guid GetCurrentTenantId() =>
            Guid.TryParse(User.FindFirstValue("tenant_id"), out var id)
                ? id
                : RootTenantId;

        // Strictly tenant-scoped, no cross-tenant fallback -- a baptism certificate must
        // never be resolvable outside the tenant that owns it, root tenant included.
        private Task<BaptismRequest?> FindBaptismRequestAsync(int id)
        {
            var tenantId = GetCurrentTenantId();
            return _db.BaptismRequests.FirstOrDefaultAsync(b => b.Id == id && b.TenantId == tenantId);
        }

        private static BaptismCertificateAttachmentDto ToAttachmentDto(Attachment a) =>
            new(a.Id, a.Filename ?? "Signed certificate", a.SizeBytes, a.UploadedAt);

        internal static string? SignedCertificateContentType(string filename, byte[] bytes) =>
            Path.GetExtension(filename).ToLowerInvariant() switch
            {
                ".pdf" when bytes.AsSpan().StartsWith("%PDF-"u8) => "application/pdf",
                ".png" when bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) => "image/png",
                ".jpg" or ".jpeg" when bytes.AsSpan().StartsWith(new byte[] { 255, 216, 255 }) => "image/jpeg",
                _ => null
            };

        private static BaptismRequestListItemDto ToListItem(BaptismRequest e) =>
            new()
            {
                Id = e.Id,
                Token = e.Token,
                FullName = e.FullName,
                FatherName = e.FatherName,
                MotherName = e.MotherName,
                DateOfBirth = e.DateOfBirth,
                ContactNumber = e.ContactNumber,
                Email = e.Email,
                Address = e.Address,
                PreferredDate = e.PreferredDate,
                PreferredService = e.PreferredService,
                Status = e.Status,
                ChurchVerified = e.ChurchVerified,
                ConsentSigned = e.ConsentSigned,
                CertificatePdfUrl = e.CertificatePdfUrl,
                BaptismDate = e.BaptismDate,
                BaptismPlace = e.BaptismPlace,
                CreatedAt = e.CreatedAt,
                UpdatedAt = e.UpdatedAt
            };

        private static BaptismRequestDetailDto ToDetail(BaptismRequest e) =>
            new()
            {
                Id = e.Id,
                Token = e.Token,
                FullName = e.FullName,
                ContactNumber = e.ContactNumber,
                Status = e.Status,
                ChurchVerified = e.ChurchVerified,
                ConsentSigned = e.ConsentSigned,
                CertificatePdfUrl = e.CertificatePdfUrl,
                FatherName = e.FatherName,
                MotherName = e.MotherName,
                DateOfBirth = e.DateOfBirth,
                Email = e.Email,
                Address = e.Address,
                PreferredDate = e.PreferredDate,
                PreferredService = e.PreferredService,
                BaptismDate = e.BaptismDate,
                BaptismPlace = e.BaptismPlace,
                ChurchVerifiedAt = e.ChurchVerifiedAt,
                ConsentSignedAt = e.ConsentSignedAt
            };

        private static IReadOnlyList<string> NormalizeStatusAliases(string? status)
        {
            if (string.IsNullOrWhiteSpace(status)) return Array.Empty<string>();

            var key = status.Trim().Replace(" ", "", StringComparison.Ordinal).Replace("-", "", StringComparison.Ordinal).ToLowerInvariant();
            return key switch
            {
                "all" or "any" => Array.Empty<string>(),
                "pending" or "new" => new[] { "Pending", "New" },
                "churchverified" or "verified" => new[] { "ChurchVerified", "Verified" },
                "awaitingverification" or "awaitingchurchverification" => new[] { "AwaitingChurchVerification", "AwaitingVerification" },
                "readyfortoken" => new[] { "ReadyForToken" },
                "tokengenerated" or "tokenissued" => new[] { "TokenGenerated", "TokenIssued" },
                "completed" or "complete" => new[] { "Completed", "Closed" },
                _ => new[] { status.Trim() }
            };
        }

        // ---------- endpoints ----------

        // GET /api/baptisms?status=Pending
        [HttpGet]
        public async Task<ActionResult> GetList([FromQuery] string? status = null)
        {
            var tenantId = GetCurrentTenantId();
            var query = _db.BaptismRequests.AsNoTracking().Where(b => b.TenantId == tenantId);
            var statusAliases = NormalizeStatusAliases(status);

            if (statusAliases.Count > 0)
                query = query.Where(b => statusAliases.Contains(b.Status));

            var list = await query
                .OrderByDescending(b => b.CreatedAt)
                .Select(b => ToListItem(b))
                .ToListAsync();

            var ids = list.Select(b => (long)b.Id).ToList();
            var attachmentsByOwner = (await _db.Attachments.AsNoTracking()
                    .Where(a => a.TenantId == tenantId && a.OwnerType == SignedCertificateOwner && ids.Contains(a.OwnerId))
                    .OrderByDescending(a => a.UploadedAt)
                    .ToListAsync())
                .GroupBy(a => a.OwnerId)
                .ToDictionary(g => g.Key, g => g.Select(ToAttachmentDto).ToList());

            foreach (var item in list)
                item.SignedCertificates = attachmentsByOwner.TryGetValue(item.Id, out var atts) ? atts : new();

            return Ok(list);
        }

        // GET /api/baptisms/{id}
        [HttpGet("{id:int}")]
        public async Task<ActionResult> GetById(int id)
        {
            var tenantId = GetCurrentTenantId();
            var entity = await _db.BaptismRequests.FirstOrDefaultAsync(b => b.Id == id && b.TenantId == tenantId);
            if (entity == null) return NotFound();

            var detail = ToDetail(entity);
            detail.SignedCertificates = (await _db.Attachments.AsNoTracking()
                .Where(a => a.TenantId == tenantId && a.OwnerType == SignedCertificateOwner && a.OwnerId == id)
                .OrderByDescending(a => a.UploadedAt).ToListAsync()).Select(ToAttachmentDto).ToList();
            return Ok(detail);
        }

        // POST /api/baptisms
        [HttpPost]
        public async Task<ActionResult> Create([FromBody] BaptismRequestCreateDto dto)
        {
            if (!ModelState.IsValid)
                return BadRequest(ModelState);

            var nowUtc = DateTime.UtcNow;

            var entity = new BaptismRequest
            {
                TenantId = GetCurrentTenantId(),
                FullName = dto.FullName,
                FatherName = dto.FatherName,
                MotherName = dto.MotherName,
                DateOfBirth = ToUtc(dto.DateOfBirth),
                ContactNumber = dto.ContactNumber,
                Email = dto.Email,
                Address = dto.Address,
                PreferredDate = ToUtc(dto.PreferredDate),
                PreferredService = dto.PreferredService,
                Status = "Pending",
                ChurchVerified = false,
                ConsentSigned = false,
                CreatedAt = nowUtc,
                UpdatedAt = nowUtc
            };

            _db.BaptismRequests.Add(entity);
            await _db.SaveChangesAsync();

            return CreatedAtAction(nameof(GetById), new { id = entity.Id }, ToDetail(entity));
        }

        // POST /api/baptisms/{id}/verify-church
        [HttpPost("{id:int}/verify-church")]
        public async Task<ActionResult> VerifyChurch(int id)
        {
            var tenantId = GetCurrentTenantId();
            var entity = await _db.BaptismRequests.FirstOrDefaultAsync(b => b.Id == id && b.TenantId == tenantId);
            if (entity == null) return NotFound();

            var nowUtc = DateTime.UtcNow;
            var userId = GetCurrentUserId();

            entity.ChurchVerified = true;
            entity.ChurchVerifiedAt = nowUtc;
            entity.ChurchVerifiedBy = userId;
            entity.UpdatedAt = nowUtc;

            entity.Status = entity.ConsentSigned ? "ReadyForToken" : "ChurchVerified";

            await _db.SaveChangesAsync();
            return NoContent();
        }

        // POST /api/baptisms/{id}/sign-consent
        [HttpPost("{id:int}/sign-consent")]
        [AllowAnonymous]
        public async Task<ActionResult> SignConsent(int id)
        {
            var tenantId = GetCurrentTenantId();
            var entity = await _db.BaptismRequests.FirstOrDefaultAsync(b => b.Id == id && b.TenantId == tenantId);
            if (entity == null) return NotFound();

            var nowUtc = DateTime.UtcNow;

            entity.ConsentSigned = true;
            entity.ConsentSignedAt = nowUtc;
            entity.UpdatedAt = nowUtc;

            entity.Status = entity.ChurchVerified ? "ReadyForToken" : "AwaitingChurchVerification";

            await _db.SaveChangesAsync();
            return NoContent();
        }

        // POST /api/baptisms/{id}/generate-token
        [HttpPost("{id:int}/generate-token")]
        public async Task<ActionResult> GenerateToken(int id)
        {
            var tenantId = GetCurrentTenantId();
            var entity = await _db.BaptismRequests.FirstOrDefaultAsync(b => b.Id == id && b.TenantId == tenantId);
            if (entity == null) return NotFound();

            if (!entity.ChurchVerified || !entity.ConsentSigned)
                return BadRequest("Church verification and consent must be completed before token generation.");

            if (string.IsNullOrWhiteSpace(entity.Token))
            {
                entity.Token = await GenerateBaptismTokenAsync();
            }

            // Normalize any dates we touch to UTC
            entity.PreferredDate = ToUtc(entity.PreferredDate);

            if (!entity.BaptismDate.HasValue)
            {
                var effectiveDate = entity.PreferredDate ?? DateTime.UtcNow;
                entity.BaptismDate = ToUtc(effectiveDate);
            }
            else
            {
                entity.BaptismDate = ToUtc(entity.BaptismDate);
            }

            if (string.IsNullOrWhiteSpace(entity.BaptismPlace))
            {
                var printTemplate = await _printTemplates.GetAsync(tenantId, HttpContext.RequestAborted);
                entity.BaptismPlace = !string.IsNullOrWhiteSpace(printTemplate.Address)
                    ? printTemplate.Address
                    : printTemplate.OrganizationName;
            }

            // Generate and store certificate (a private relative path, not a public URL --
            // see IBaptismCertificateService)
            var pdfUrl = await _certificateService.GenerateCertificateAsync(entity);
            entity.CertificatePdfUrl = pdfUrl;

            entity.Status = "TokenGenerated";
            entity.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync();

            return Ok(ToDetail(entity));
        }

        // PUT /api/baptisms/{id}/complete   (close the workflow)
        [HttpPut("{id:int}/complete")]
        public async Task<ActionResult> MarkCompleted(int id)
        {
            var tenantId = GetCurrentTenantId();
            var entity = await _db.BaptismRequests.FirstOrDefaultAsync(b => b.Id == id && b.TenantId == tenantId);
            if (entity == null) return NotFound();

            // optional guard: only allow if token already generated
            if (entity.Status != "TokenGenerated" && entity.Status != "Completed")
            {
                return BadRequest("Only baptisms with generated tokens can be completed.");
            }

            entity.Status = "Completed";
            entity.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync();
            return NoContent();
        }

        // POST /api/baptisms/{id}/signed-certificates  (upload a scanned/signed consent document)
        [HttpPost("{id:int}/signed-certificates")]
        [RequestSizeLimit(MaxCertificateBytes + 1024 * 1024)]
        [RequestFormLimits(MultipartBodyLengthLimit = MaxCertificateBytes + 1024 * 1024)]
        public async Task<IActionResult> UploadSignedCertificate(int id, [FromForm] IFormFile? file)
        {
            if (file == null || file.Length == 0 || file.Length > MaxCertificateBytes)
                return BadRequest("Choose a non-empty PDF, JPG, or PNG file up to 10 MB.");

            var tenantId = GetCurrentTenantId();
            var entity = await _db.BaptismRequests.FirstOrDefaultAsync(b => b.Id == id && b.TenantId == tenantId);
            if (entity == null) return NotFound("Baptism record not found.");

            using var memory = new MemoryStream();
            await file.CopyToAsync(memory);
            var bytes = memory.ToArray();
            var filename = Path.GetFileName(file.FileName.Replace('\\', '/'));
            var contentType = SignedCertificateContentType(filename, bytes);
            if (contentType == null)
                return BadRequest("The file must be a PDF, JPG, or PNG matching its file extension.");

            var key = $"{Guid.NewGuid():N}{Path.GetExtension(filename).ToLowerInvariant()}";
            var tenantDir = Path.Combine(_signedCertificateRoot, tenantId.ToString("N"));
            Directory.CreateDirectory(tenantDir);
            var path = Path.Combine(tenantDir, key);
            try
            {
                await System.IO.File.WriteAllBytesAsync(path, bytes);
                var attachment = new Attachment
                {
                    TenantId = tenantId,
                    OwnerType = SignedCertificateOwner,
                    OwnerId = id,
                    S3Key = key,
                    Filename = filename,
                    ContentType = contentType,
                    SizeBytes = bytes.LongLength,
                    UploadedBy = Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var uid) ? uid : null,
                    UploadedAt = DateTime.UtcNow
                };
                _db.Attachments.Add(attachment);
                entity.UpdatedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync();
                return Ok(ToAttachmentDto(attachment));
            }
            catch
            {
                if (System.IO.File.Exists(path)) System.IO.File.Delete(path);
                throw;
            }
        }

        // GET /api/baptisms/{id}/signed-certificates/{attachmentId}
        [HttpGet("{id:int}/signed-certificates/{attachmentId:long}")]
        public async Task<IActionResult> DownloadSignedCertificate(int id, long attachmentId)
        {
            var tenantId = GetCurrentTenantId();
            if (!await _db.BaptismRequests.AnyAsync(b => b.Id == id && b.TenantId == tenantId)) return NotFound();

            var attachment = await _db.Attachments.AsNoTracking().FirstOrDefaultAsync(a =>
                a.Id == attachmentId && a.OwnerId == id && a.OwnerType == SignedCertificateOwner && a.TenantId == tenantId);
            if (attachment == null) return NotFound();

            var path = Path.Combine(_signedCertificateRoot, tenantId.ToString("N"), Path.GetFileName(attachment.S3Key));
            if (!System.IO.File.Exists(path)) return NotFound("Signed certificate file not found.");
            return PhysicalFile(path, attachment.ContentType ?? "application/octet-stream", attachment.Filename);
        }

        // DELETE /api/baptisms/{id} (admin only)
        [HttpDelete("{id:int}")]
        [Authorize(Roles = "ADMIN,Admin,admin")]
        public async Task<IActionResult> Delete(int id)
        {
            var tenantId = GetCurrentTenantId();
            var entity = await _db.BaptismRequests.FirstOrDefaultAsync(b => b.Id == id && b.TenantId == tenantId);
            if (entity == null) return NotFound();

            var attachments = await _db.Attachments
                .Where(a => a.TenantId == tenantId && a.OwnerType == SignedCertificateOwner && a.OwnerId == id)
                .ToListAsync();
            _db.Attachments.RemoveRange(attachments);
            _db.BaptismRequests.Remove(entity);
            await _db.SaveChangesAsync();

            var tenantSignedDir = Path.Combine(_signedCertificateRoot, tenantId.ToString("N"));
            foreach (var attachment in attachments)
            {
                try
                {
                    System.IO.File.Delete(Path.Combine(tenantSignedDir, Path.GetFileName(attachment.S3Key)));
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    _logger.LogWarning(ex, "Could not remove signed certificate attachment {AttachmentId}", attachment.Id);
                }
            }

            return NoContent();
        }

        // GET /api/baptisms/{id}/certificate  (serve PDF by streaming the file)
        // Authenticated + strictly tenant-scoped (via FindBaptismRequestAsync) -- the PDF lives
        // in a private, non-web-exposed, tenant-scoped directory, never under wwwroot.
        [HttpGet("{id:int}/certificate")]
        public async Task<IActionResult> DownloadCertificate(int id)
        {
            var entity = await FindBaptismRequestAsync(id);
            if (entity == null)
                return NotFound("Baptism request not found.");

            var certDir = Path.Combine(_generatedCertificateRoot, entity.TenantId.ToString("N"));
            Directory.CreateDirectory(certDir);

            string? physicalPath = null;

            // 1) Try to use the path stored in the DB (CertificatePdfUrl -- a relative path
            // like "{tenantId}/BaptismCertificate_2_....pdf", never a rooted/public URL now)
            if (!string.IsNullOrWhiteSpace(entity.CertificatePdfUrl))
            {
                var fileName = Path.GetFileName(entity.CertificatePdfUrl.Trim());
                physicalPath = Path.Combine(certDir, fileName);
            }

            // 2) If that file doesn't exist, fall back to pattern search within this tenant's folder
            if (string.IsNullOrEmpty(physicalPath) || !System.IO.File.Exists(physicalPath))
            {
                var pattern = $"BaptismCertificate_{id}_*.pdf";
                var matches = Directory.GetFiles(certDir, pattern, SearchOption.TopDirectoryOnly);

                if (matches.Length == 0)
                {
                    entity.CertificatePdfUrl = await _certificateService.GenerateCertificateAsync(entity);
                    entity.UpdatedAt = DateTime.UtcNow;
                    await _db.SaveChangesAsync();

                    var regeneratedName = Path.GetFileName(entity.CertificatePdfUrl);
                    physicalPath = Path.Combine(certDir, regeneratedName);

                    if (!System.IO.File.Exists(physicalPath))
                        return Content("Certificate PDF file could not be found on the server.");
                }
                else
                {
                    physicalPath = matches[0];
                }
            }

            // 3) Stream the PDF back
            var bytes = await System.IO.File.ReadAllBytesAsync(physicalPath);
            var downloadName = Path.GetFileName(physicalPath);
            return File(bytes, "application/pdf", downloadName);
        }

        private async Task<string> GenerateBaptismTokenAsync()
        {
            var year = DateTime.UtcNow.Year;
            var prefix = $"BAP-{year}-";
            var tenantId = GetCurrentTenantId();

            var countThisYear = await _db.BaptismRequests
                .Where(b => b.TenantId == tenantId && b.Token != null && b.Token.StartsWith(prefix))
                .CountAsync();

            var next = countThisYear + 1;
            var seq = next.ToString("D4");

            return $"{prefix}{seq}";
        }
    }
}
