using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using ImageMagick;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class UploadsController : ControllerBase
    {
        private static readonly HashSet<string> AllowedContentTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp",
            "image/gif",
            "image/heic",
            "image/heif",
            "image/avif",
            "video/mp4",
            "video/webm",
            "video/quicktime",
            "video/3gpp",
            "video/x-m4v",
            "audio/mpeg",
            "audio/mp4",
            "audio/ogg",
            "audio/webm",
            "audio/wav",
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "text/plain",
            "text/csv",
            "application/zip"
        };

        private const long MaxBytes = 100L * 1024L * 1024L;
        private readonly IConfiguration _config;
        private readonly IWebHostEnvironment _env;
        private readonly ILogger<UploadsController> _logger;
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");

        public UploadsController(IConfiguration config, IWebHostEnvironment env, ILogger<UploadsController> logger)
        {
            _config = config ?? throw new ArgumentNullException(nameof(config));
            _env = env ?? throw new ArgumentNullException(nameof(env));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        private Guid GetCurrentTenantId() =>
            Guid.TryParse(User.FindFirstValue("tenant_id"), out var id)
                ? id
                : RootTenantId;

        [HttpPost]
        [RequestSizeLimit(MaxBytes)]
        [RequestFormLimits(MultipartBodyLengthLimit = MaxBytes)]
        public async Task<IActionResult> Upload([FromForm] IFormFile file, [FromForm] string? purpose = null)
        {
            if (file == null || file.Length == 0)
                return BadRequest("file is required.");

            if (file.Length > MaxBytes)
                return BadRequest("File too large. Maximum size is 100 MB.");

            var contentType = file.ContentType?.Trim() ?? "";
            if (!AllowedContentTypes.Contains(contentType))
                return BadRequest("Only image, video, audio, and document uploads are supported.");

            var extension = Path.GetExtension(file.FileName);
            if (string.IsNullOrWhiteSpace(extension))
                extension = contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ? ".jpg"
                    : contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase) ? ".mp4"
                    : contentType.StartsWith("audio/", StringComparison.OrdinalIgnoreCase) ? ".mp3"
                    : ".bin";

            extension = new string(extension.Where(ch => char.IsLetterOrDigit(ch) || ch == '.').ToArray());
            if (string.IsNullOrWhiteSpace(extension)) extension = ".bin";

            // HEIC/HEIF (the default photo format on iPhones, and some Android phones) can't be
            // displayed by an <img> tag in any mainstream browser or Android WebView. Convert to
            // JPEG on upload so attachments actually render for every viewer.
            var needsHeicConversion = contentType.Equals("image/heic", StringComparison.OrdinalIgnoreCase)
                || contentType.Equals("image/heif", StringComparison.OrdinalIgnoreCase);
            if (needsHeicConversion)
            {
                extension = ".jpg";
                contentType = "image/jpeg";
            }

            var uploadRoot = _config["Uploads:Root"]
                ?? Environment.GetEnvironmentVariable("MAHIMA_UPLOADS_ROOT");
            if (string.IsNullOrWhiteSpace(uploadRoot))
            {
                var linuxUploadRoot = "/var/www/mahima-uploads";
                if (OperatingSystem.IsLinux())
                {
                    uploadRoot = linuxUploadRoot;
                }
                else
                {
                    var webRoot = _env.WebRootPath;
                    if (string.IsNullOrWhiteSpace(webRoot))
                        webRoot = Path.Combine(_env.ContentRootPath, "wwwroot");
                    uploadRoot = Path.Combine(webRoot, "uploads");
                }
            }

            var allowedPurposes = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "chat", "branding", "events" };
            var folderSegment = allowedPurposes.Contains(purpose?.Trim() ?? "") ? purpose!.Trim().ToLowerInvariant() : "chat";
            var relativeFolder = Path.Combine("tenants", GetCurrentTenantId().ToString("N"), folderSegment, DateTime.UtcNow.ToString("yyyy"), DateTime.UtcNow.ToString("MM"));
            var targetFolder = Path.Combine(uploadRoot, relativeFolder);

            try
            {
                Directory.CreateDirectory(targetFolder);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Could not create chat upload folder {TargetFolder}", targetFolder);
                return StatusCode(
                    StatusCodes.Status500InternalServerError,
                    "Upload storage is not writable. Please check server folder permissions.");
            }

            var fileName = $"{Guid.NewGuid():N}{extension.ToLowerInvariant()}";
            var fullPath = Path.Combine(targetFolder, fileName);

            try
            {
                if (needsHeicConversion)
                {
                    using var source = new MemoryStream();
                    await file.CopyToAsync(source);
                    source.Position = 0;
                    using var image = new MagickImage(source);
                    image.Format = MagickFormat.Jpg;
                    image.Quality = 90;
                    image.Write(fullPath);
                }
                else
                {
                    await using var stream = System.IO.File.Create(fullPath);
                    await file.CopyToAsync(stream);
                }
            }
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogError(ex, "Upload folder is not writable: {TargetFolder}", targetFolder);
                return StatusCode(
                    StatusCodes.Status500InternalServerError,
                    "Upload folder is not writable. Please check server folder permissions.");
            }
            catch (MagickException ex)
            {
                _logger.LogError(ex, "HEIC/HEIF conversion failed for {FileName}", file.FileName);
                return BadRequest("Could not process this photo. Please try a different format (JPG/PNG).");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Chat upload failed for {FileName}", file.FileName);
                return StatusCode(StatusCodes.Status500InternalServerError, "Upload failed.");
            }

            var publicPath = "/api/uploads/" + Path.Combine(relativeFolder, fileName).Replace('\\', '/');
            var absoluteUrl = $"{Request.Scheme}://{Request.Host}{publicPath}";

            return Ok(new
            {
                url = publicPath,
                absoluteUrl,
                contentType,
                size = file.Length,
                fileName
            });
        }

        [AllowAnonymous]
        [HttpGet("{**path}")]
        public IActionResult GetUpload(string path)
        {
            var cleanPath = (path ?? string.Empty).Replace('\\', '/').TrimStart('/');
            if (string.IsNullOrWhiteSpace(cleanPath) ||
                cleanPath.Contains("..", StringComparison.Ordinal) ||
                cleanPath.StartsWith("/", StringComparison.Ordinal))
                return BadRequest("Invalid upload path.");

            var uploadRoot = _config["Uploads:Root"]
                ?? Environment.GetEnvironmentVariable("MAHIMA_UPLOADS_ROOT");
            if (string.IsNullOrWhiteSpace(uploadRoot))
            {
                uploadRoot = OperatingSystem.IsLinux()
                    ? "/var/www/mahima-uploads"
                    : Path.Combine(_env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot"), "uploads");
            }

            var fullPath = Path.GetFullPath(Path.Combine(uploadRoot, cleanPath));
            var rootPath = Path.GetFullPath(uploadRoot);
            if (!fullPath.StartsWith(rootPath, StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(fullPath))
                return NotFound();

            var ext = Path.GetExtension(fullPath).ToLowerInvariant();
            var contentType = ext switch
            {
                ".jpg" or ".jpeg" => "image/jpeg",
                ".png" => "image/png",
                ".webp" => "image/webp",
                ".gif" => "image/gif",
                ".mp4" => "video/mp4",
                ".webm" => "video/webm",
                ".mov" => "video/quicktime",
                ".mp3" => "audio/mpeg",
                ".m4a" => "audio/mp4",
                ".ogg" => "audio/ogg",
                ".wav" => "audio/wav",
                ".pdf" => "application/pdf",
                ".txt" => "text/plain",
                ".csv" => "text/csv",
                ".zip" => "application/zip",
                _ => "application/octet-stream"
            };

            return PhysicalFile(fullPath, contentType);
        }
    }
}
