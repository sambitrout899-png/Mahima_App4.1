using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System;
using System.IO;
using System.Linq;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Route("api/app-releases")]
    public class AppReleasesController : ControllerBase
    {
        private const long MaxApkBytes = 2L * 1024L * 1024L * 1024L;

        private readonly IConfiguration _config;
        private readonly MahimaDbContext _db;
        private readonly ITenantContextService _tenantContext;
        private readonly AppReleasePublishingService _publisher;
        private readonly ILogger<AppReleasesController> _logger;

        public AppReleasesController(
            IConfiguration config,
            MahimaDbContext db,
            ITenantContextService tenantContext,
            AppReleasePublishingService publisher,
            ILogger<AppReleasesController> logger)
        {
            _config = config;
            _db = db;
            _tenantContext = tenantContext;
            _publisher = publisher;
            _logger = logger;
        }

        private static string? NormalizeTenantSlug(string? slug) => AppReleasePublishingService.NormalizeTenantSlug(slug);

        private async Task<bool> CanManageTenantReleaseAsync(string tenantSlug, CancellationToken ct)
        {
            var currentTenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (currentTenant?.IsRootTenant == true) return true;

            var target = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Slug == tenantSlug, ct);
            return target != null && currentTenant?.Id == target.Id;
        }

        [AllowAnonymous]
        [HttpGet("latest")]
        public IActionResult Latest() => LatestInternal(null);

        [AllowAnonymous]
        [HttpGet("{tenantSlug}/latest")]
        public IActionResult LatestForTenant(string tenantSlug)
        {
            var normalized = NormalizeTenantSlug(tenantSlug);
            if (normalized == null) return NotFound("Unknown tenant.");
            return LatestInternal(normalized);
        }

        private IActionResult LatestInternal(string? tenantSlug)
        {
            try
            {
                // A public GET must not attempt to create release directories.
                var writableManifestPath = _publisher.GetWritableVersionManifestReadPath(tenantSlug);
                if (System.IO.File.Exists(writableManifestPath))
                    return ReadManifestForCurrentHost(writableManifestPath, tenantSlug);

                var publicManifestPath = _publisher.GetPublicVersionManifestReadPath(tenantSlug);
                if (System.IO.File.Exists(publicManifestPath))
                    return ReadManifestForCurrentHost(publicManifestPath, tenantSlug);

                if (tenantSlug != null)
                    return LatestInternal(null);
            }
            catch (Exception ex)
            {
                // Release discovery is public and non-critical. Never turn a
                // filesystem mount, permission, or malformed-path problem into
                // a broken downloads page.
                _logger.LogWarning(ex, "Could not probe app release metadata for tenant {TenantSlug}; returning configured defaults.", tenantSlug ?? "global");
            }

            return DefaultReleaseInfo();
        }

        private IActionResult DefaultReleaseInfo()
        {
            string baseUrl;
            try { baseUrl = _publisher.PublicBaseUrl(); }
            catch { baseUrl = _config["AppReleases:PublicBaseUrl"] ?? "https://app.mahimaministries.in"; }
            var version = _config["AppReleases:DefaultVersion"] ?? "0.1.0";
            return Ok(new
            {
                latestVersion = version,
                minSupportedVersion = _config["AppReleases:MinSupportedVersion"] ?? "0.1.0",
                message = "New version of the Mahima App is available - Please upgrade now",
                downloadPageUrl = $"{baseUrl}/#/app-downloads",
                android = new
                {
                    latestVersion = version,
                    minSupportedVersion = _config["AppReleases:MinSupportedVersion"] ?? "0.1.0",
                    build = "Latest APK",
                    apkUrl = $"{baseUrl}/downloads/mahima-app.apk",
                    downloadUrl = $"{baseUrl}/api/app-releases/android/download",
                    releaseDate = "Current"
                }
            });
        }

        private IActionResult ReadManifestForCurrentHost(string manifestPath, string? tenantSlug = null)
        {
            try
            {
                var manifest = JsonNode.Parse(System.IO.File.ReadAllText(manifestPath))?.AsObject();
                if (manifest == null)
                    throw new JsonException("The app release manifest is empty.");

                var baseUrl = _publisher.PublicBaseUrl();
                var downloadPageSegment = tenantSlug != null ? $"t/{tenantSlug}/app-downloads" : "app-downloads";
                var downloadRouteSegment = tenantSlug != null ? $"{tenantSlug}/android/download" : "android/download";
                var downloadsFolder = tenantSlug != null ? $"downloads/{tenantSlug}" : "downloads";
                manifest["downloadPageUrl"] = $"{baseUrl}/#/{downloadPageSegment}";

                if (manifest["android"] is JsonObject android)
                {
                    var versionedFileName = android["versionedFileName"]?.GetValue<string>();
                    android["apkUrl"] = $"{baseUrl}/{downloadsFolder}/mahima-app.apk";
                    android["downloadUrl"] = $"{baseUrl}/api/app-releases/{downloadRouteSegment}";
                    if (!string.IsNullOrWhiteSpace(versionedFileName))
                        android["versionedApkUrl"] = $"{baseUrl}/{downloadsFolder}/{Uri.EscapeDataString(versionedFileName)}";
                }

                if (manifest["ios"] is JsonObject ios)
                    ios["url"] = $"{baseUrl}/#/{downloadPageSegment}";

                return Content(manifest.ToJsonString(new JsonSerializerOptions { WriteIndented = true }), "application/json");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Could not read app release manifest {ManifestPath}", manifestPath);
                return DefaultReleaseInfo();
            }
        }


        [AllowAnonymous]
        [HttpGet("android/download")]
        public IActionResult DownloadAndroid() => DownloadAndroidInternal(null);

        [AllowAnonymous]
        [HttpGet("{tenantSlug}/android/download")]
        public IActionResult DownloadAndroidForTenant(string tenantSlug)
        {
            var normalized = NormalizeTenantSlug(tenantSlug);
            if (normalized == null) return NotFound("Unknown tenant.");
            return DownloadAndroidInternal(normalized);
        }

        private IActionResult DownloadAndroidInternal(string? tenantSlug)
        {
            try
            {
                var latestPath = _publisher.FindLatestApkPath(tenantSlug) ?? (tenantSlug != null ? _publisher.FindLatestApkPath(null) : null);
                if (string.IsNullOrWhiteSpace(latestPath) || !System.IO.File.Exists(latestPath))
                    return NotFound("The Mahima Android APK has not been published yet.");

                Response.Headers["Cache-Control"] = "no-store, no-cache, must-revalidate";
                Response.Headers["Pragma"] = "no-cache";
                Response.Headers["X-Content-Type-Options"] = "nosniff";
                return PhysicalFile(
                    latestPath,
                    "application/vnd.android.package-archive",
                    tenantSlug != null ? $"mahima-app-{tenantSlug}.apk" : "mahima-app.apk",
                    enableRangeProcessing: true);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Could not resolve the published Android APK for download.");
                return Problem(statusCode: StatusCodes.Status500InternalServerError,
                    title: "APK download failed",
                    detail: "The published APK could not be opened. Verify the app-release directory permissions.");
            }
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("android")]
        [RequestSizeLimit(MaxApkBytes)]
        [RequestFormLimits(MultipartBodyLengthLimit = MaxApkBytes)]
        public Task<IActionResult> UploadAndroid(
            [FromForm] IFormFile file,
            [FromForm] string version,
            [FromForm] string? build,
            [FromForm] string? minSupportedVersion,
            [FromForm] string? releaseNotes,
            [FromForm] bool forceUpgrade = false)
            => UploadAndroidInternal(null, file, version, build, minSupportedVersion, releaseNotes, forceUpgrade);

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("{tenantSlug}/android")]
        [RequestSizeLimit(MaxApkBytes)]
        [RequestFormLimits(MultipartBodyLengthLimit = MaxApkBytes)]
        public async Task<IActionResult> UploadAndroidForTenant(
            string tenantSlug,
            [FromForm] IFormFile file,
            [FromForm] string version,
            [FromForm] string? build,
            [FromForm] string? minSupportedVersion,
            [FromForm] string? releaseNotes,
            [FromForm] bool forceUpgrade = false)
        {
            var normalized = NormalizeTenantSlug(tenantSlug);
            if (normalized == null) return BadRequest("Invalid tenant.");

            if (!await CanManageTenantReleaseAsync(normalized, HttpContext.RequestAborted))
                return Forbid();

            return await UploadAndroidInternal(normalized, file, version, build, minSupportedVersion, releaseNotes, forceUpgrade);
        }

        private async Task<IActionResult> UploadAndroidInternal(
            string? tenantSlug,
            IFormFile file,
            string version,
            string? build,
            string? minSupportedVersion,
            string? releaseNotes,
            bool forceUpgrade)
        {
            if (file == null || file.Length == 0)
                return BadRequest("APK file is required.");

            if (file.Length > MaxApkBytes)
                return BadRequest("APK is too large. Maximum size is 2 GB.");

            if (string.IsNullOrWhiteSpace(version))
                return BadRequest("Version is required.");

            var extension = Path.GetExtension(file.FileName);
            if (!extension.Equals(".apk", StringComparison.OrdinalIgnoreCase))
                return BadRequest("Only Android .apk files are allowed.");

            var downloadsRoot = _publisher.GetWritableDownloadsRoot(tenantSlug);
            var tempPath = Path.Combine(downloadsRoot, $".{Guid.NewGuid():N}.upload");

            try
            {
                await using (var stream = System.IO.File.Create(tempPath))
                {
                    await file.CopyToAsync(stream, HttpContext.RequestAborted);
                }

                var manifest = await _publisher.PublishAsync(
                    tenantSlug, tempPath, version, build, minSupportedVersion, releaseNotes, forceUpgrade,
                    CurrentUserId(), HttpContext.RequestAborted);

                return Ok(manifest);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to upload Android APK {FileName}", file.FileName);
                return StatusCode(500, "Could not upload Android APK.");
            }
            finally
            {
                try
                {
                    if (System.IO.File.Exists(tempPath)) System.IO.File.Delete(tempPath);
                }
                catch {}
            }
        }

        private Guid? CurrentUserId()
        {
            var raw =
                User.FindFirstValue(ClaimTypes.NameIdentifier) ??
                User.FindFirstValue("sub") ??
                User.FindFirstValue("nameid");
            return Guid.TryParse(raw, out var id) ? id : null;
        }

    }
}
