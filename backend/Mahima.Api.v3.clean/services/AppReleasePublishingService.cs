using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Services
{
    // Shared by AppReleasesController's multipart-upload endpoint and
    // TenantAppBuildController's publish-from-staged-build endpoint - both
    // ultimately need the same "take an APK file, write it into the
    // writable/public release folders, write the manifest, log it" logic.
    public class AppReleasePublishingService
    {
        private readonly IConfiguration _config;
        private readonly IWebHostEnvironment _env;
        private readonly MahimaDbContext _db;
        private readonly IHttpContextAccessor _httpContextAccessor;
        private readonly ILogger<AppReleasePublishingService> _logger;

        public AppReleasePublishingService(
            IConfiguration config,
            IWebHostEnvironment env,
            MahimaDbContext db,
            IHttpContextAccessor httpContextAccessor,
            ILogger<AppReleasePublishingService> logger)
        {
            _config = config;
            _env = env;
            _db = db;
            _httpContextAccessor = httpContextAccessor;
            _logger = logger;
        }

        public static string? NormalizeTenantSlug(string? slug)
        {
            var trimmed = (slug ?? "").Trim().ToLowerInvariant();
            var clean = new string(trimmed.Where(c => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-').ToArray());
            return string.IsNullOrWhiteSpace(clean) ? null : clean;
        }

        // Copies sourceApkPath into the release folders, writes the manifest, and
        // logs the action. Does not delete/move sourceApkPath - callers own its lifecycle.
        public async Task<object> PublishAsync(
            string? tenantSlug,
            string sourceApkPath,
            string version,
            string? build,
            string? minSupportedVersion,
            string? releaseNotes,
            bool forceUpgrade,
            Guid? actorUserId,
            CancellationToken ct)
        {
            if (!File.Exists(sourceApkPath))
                throw new FileNotFoundException("Staged APK was not found.", sourceApkPath);

            var downloadsRoot = GetWritableDownloadsRoot(tenantSlug);
            var publicDownloadsRoot = GetPublicDownloadsRoot(tenantSlug);

            var fileStem = tenantSlug != null ? $"mahima-app-{tenantSlug}" : "mahima-app";
            var cleanVersion = CleanForFileName(version);
            var cleanBuild = CleanForFileName(string.IsNullOrWhiteSpace(build) ? DateTime.UtcNow.ToString("yyyyMMddHHmmss") : build);
            var versionedFileName = $"{fileStem}-{cleanVersion}-{cleanBuild}.apk";
            var versionedPath = Path.Combine(downloadsRoot, versionedFileName);
            var latestPath = Path.Combine(downloadsRoot, "mahima-app.apk");
            var publicVersionedPath = Path.Combine(publicDownloadsRoot, versionedFileName);
            var publicLatestPath = Path.Combine(publicDownloadsRoot, "mahima-app.apk");

            File.Copy(sourceApkPath, versionedPath, overwrite: true);
            File.Copy(versionedPath, latestPath, overwrite: true);
            TryMirrorFile(versionedPath, publicVersionedPath);
            TryMirrorFile(latestPath, publicLatestPath);

            var sizeBytes = new FileInfo(sourceApkPath).Length;
            var now = DateTime.UtcNow;
            var baseUrl = PublicBaseUrl();
            var downloadPageSegment = tenantSlug != null ? $"t/{tenantSlug}/app-downloads" : "app-downloads";
            var downloadRouteSegment = tenantSlug != null ? $"{tenantSlug}/android/download" : "android/download";
            var downloadsFolder = tenantSlug != null ? $"downloads/{tenantSlug}" : "downloads";
            var apkUrl = $"{baseUrl}/{downloadsFolder}/mahima-app.apk";
            var downloadUrl = $"{baseUrl}/api/app-releases/{downloadRouteSegment}";
            var versionedApkUrl = $"{baseUrl}/{downloadsFolder}/{Uri.EscapeDataString(versionedFileName)}";
            var normalizedMinVersion = string.IsNullOrWhiteSpace(minSupportedVersion) ? version : minSupportedVersion.Trim();
            var message = forceUpgrade
                ? "A required Mahima App update is available - Please upgrade now"
                : "New version of the Mahima App is available - Please upgrade now";

            var manifest = new
            {
                latestVersion = version.Trim(),
                minSupportedVersion = normalizedMinVersion,
                message,
                downloadPageUrl = $"{baseUrl}/#/{downloadPageSegment}",
                updatedAtUtc = now,
                android = new
                {
                    latestVersion = version.Trim(),
                    minSupportedVersion = normalizedMinVersion,
                    build = string.IsNullOrWhiteSpace(build) ? cleanBuild : build.Trim(),
                    releaseDate = now.ToString("yyyy-MM-dd"),
                    apkUrl,
                    downloadUrl,
                    versionedApkUrl,
                    fileName = "mahima-app.apk",
                    versionedFileName,
                    sizeBytes,
                    forceUpgrade,
                    releaseNotes = releaseNotes ?? ""
                },
                ios = new
                {
                    latestVersion = _config["AppReleases:IosVersion"] ?? version.Trim(),
                    minSupportedVersion = _config["AppReleases:IosMinSupportedVersion"] ?? normalizedMinVersion,
                    url = _config["AppReleases:IosUrl"] ?? $"{baseUrl}/#/{downloadPageSegment}"
                }
            };

            var jsonOptions = new JsonSerializerOptions { WriteIndented = true };
            var json = JsonSerializer.Serialize(manifest, jsonOptions);
            await File.WriteAllTextAsync(GetWritableVersionManifestPath(tenantSlug), json, ct);

            try
            {
                await File.WriteAllTextAsync(GetPublicVersionManifestPath(tenantSlug), json, ct);
                await File.WriteAllTextAsync(Path.Combine(publicDownloadsRoot, "app-release-manifest.json"), json, ct);
            }
            catch (Exception manifestEx)
            {
                _logger.LogWarning(manifestEx, "Could not mirror app release manifest to public web root. API manifest was saved.");
            }

            _db.AuditLogs.Add(new AuditLog
            {
                ActorId = actorUserId,
                Action = "UploadAndroidApk",
                EntityType = "AppRelease",
                EntityId = tenantSlug != null ? $"{tenantSlug}:{version.Trim()}" : version.Trim(),
                Details = $"Uploaded {versionedFileName}; durable latest updated and public /{downloadsFolder}/mahima-app.apk mirror refreshed",
                CreatedAt = now
            });
            await _db.SaveChangesAsync(ct);

            return manifest;
        }

        public string GetPublicRoot()
        {
            var configured = GetPublicRootPath();
            Directory.CreateDirectory(configured);
            return configured;
        }

        public string GetPublicRootPath()
        {
            var configured = _config["AppReleases:PublicRoot"] ?? Environment.GetEnvironmentVariable("MAHIMA_WEB_ROOT");
            if (string.IsNullOrWhiteSpace(configured))
                configured = OperatingSystem.IsLinux() ? "/var/www/mahima" : (_env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot"));
            return Path.GetFullPath(configured);
        }

        public string GetPublicVersionManifestPath(string? tenantSlug = null) =>
            tenantSlug != null
                ? Path.Combine(GetPublicDownloadsRoot(tenantSlug), "app-version.json")
                : Path.Combine(GetPublicRoot(), "app-version.json");

        public string GetPublicDownloadsRoot(string? tenantSlug = null)
        {
            var root = GetPublicDownloadsRootPath(tenantSlug);
            Directory.CreateDirectory(root);
            return root;
        }

        public string GetPublicDownloadsRootPath(string? tenantSlug = null) =>
            tenantSlug != null
                ? Path.Combine(GetPublicRootPath(), "downloads", tenantSlug)
                : Path.Combine(GetPublicRootPath(), "downloads");

        public string GetWritableReleaseRoot(string? tenantSlug = null)
        {
            var configured = GetWritableReleaseRootPath(tenantSlug);
            Directory.CreateDirectory(configured);
            return configured;
        }

        public string GetWritableReleaseRootPath(string? tenantSlug = null)
        {
            var configured =
                _config["AppReleases:WritableRoot"] ??
                Environment.GetEnvironmentVariable("MAHIMA_RELEASE_ROOT");

            if (string.IsNullOrWhiteSpace(configured))
            {
                configured = OperatingSystem.IsLinux()
                    ? "/var/lib/mahima/app-releases"
                    : Path.Combine(_env.ContentRootPath, "App_Data", "app-releases");
            }

            if (tenantSlug != null)
                configured = Path.Combine(configured, "tenants", tenantSlug);

            return Path.GetFullPath(configured);
        }

        public string GetWritableVersionManifestReadPath(string? tenantSlug = null) =>
            Path.Combine(GetWritableReleaseRootPath(tenantSlug), "app-version.json");

        public string GetPublicVersionManifestReadPath(string? tenantSlug = null) =>
            tenantSlug != null
                ? Path.Combine(GetPublicDownloadsRootPath(tenantSlug), "app-version.json")
                : Path.Combine(GetPublicRootPath(), "app-version.json");

        public string GetWritableVersionManifestPath(string? tenantSlug = null) =>
            Path.Combine(GetWritableReleaseRoot(tenantSlug), "app-version.json");

        public string GetWritableDownloadsRoot(string? tenantSlug = null)
        {
            var root = Path.Combine(GetWritableReleaseRoot(tenantSlug), "downloads");
            Directory.CreateDirectory(root);
            return root;
        }

        // Where TenantAppBuildWorker asks build-tenant-app.mjs to write the built
        // APK via --out, and where TenantAppBuildController.Publish reads it from.
        public string GetTenantStagingApkPath(string tenantSlug)
        {
            var root = Path.Combine(GetWritableReleaseRoot(tenantSlug), "staging");
            Directory.CreateDirectory(root);
            return Path.Combine(root, "latest.apk");
        }

        public string? FindLatestApkPath(string? tenantSlug = null)
        {
            // Download lookups must never require write permission. Directories
            // are created only by the publishing workflow.
            var writableDownloadsRoot = Path.Combine(GetWritableReleaseRootPath(tenantSlug), "downloads");
            var writableLatestPath = Path.Combine(writableDownloadsRoot, "mahima-app.apk");
            if (File.Exists(writableLatestPath))
                return writableLatestPath;

            var publicDownloadsRoot = GetPublicDownloadsRootPath(tenantSlug);
            var publicLatestPath = Path.Combine(publicDownloadsRoot, "mahima-app.apk");
            if (File.Exists(publicLatestPath)) return publicLatestPath;

            var manifestVersionedFile = TryReadVersionedApkFileName(GetWritableVersionManifestReadPath(tenantSlug)) ??
                                        TryReadVersionedApkFileName(GetPublicVersionManifestReadPath(tenantSlug));
            if (!string.IsNullOrWhiteSpace(manifestVersionedFile))
            {
                var writableVersionedPath = Path.Combine(writableDownloadsRoot, manifestVersionedFile);
                var publicVersionedPath = Path.Combine(publicDownloadsRoot, manifestVersionedFile);

                if (File.Exists(writableVersionedPath))
                    return writableVersionedPath;

                if (File.Exists(publicVersionedPath)) return publicVersionedPath;
            }

            return null;
        }

        public string? TryReadVersionedApkFileName(string manifestPath)
        {
            try
            {
                if (!File.Exists(manifestPath)) return null;

                using var stream = File.OpenRead(manifestPath);
                using var document = JsonDocument.Parse(stream);
                if (!document.RootElement.TryGetProperty("android", out var android)) return null;

                if (android.TryGetProperty("versionedFileName", out var versionedFileName))
                    return versionedFileName.GetString();

                if (android.TryGetProperty("fileName", out var fileName))
                    return fileName.GetString();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not read APK file name from app release manifest {ManifestPath}", manifestPath);
            }

            return null;
        }

        public void TryMirrorFile(string sourcePath, string destinationPath)
        {
            try
            {
                var destinationDirectory = Path.GetDirectoryName(destinationPath);
                if (!string.IsNullOrWhiteSpace(destinationDirectory))
                    Directory.CreateDirectory(destinationDirectory);

                if (File.Exists(sourcePath))
                    File.Copy(sourcePath, destinationPath, overwrite: true);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not mirror file {SourcePath} to {DestinationPath}", sourcePath, destinationPath);
            }
        }

        public string PublicBaseUrl()
        {
            var request = _httpContextAccessor.HttpContext?.Request;
            if (request != null)
            {
                var scheme = request.Headers["X-Forwarded-Proto"].FirstOrDefault() ?? request.Scheme;
                var host = request.Headers["X-Forwarded-Host"].FirstOrDefault() ?? request.Host.Value;
                if (!string.IsNullOrWhiteSpace(host))
                    return $"{scheme}://{host}".TrimEnd('/');
            }

            var configured =
                _config["AppReleases:PublicBaseUrl"] ??
                Environment.GetEnvironmentVariable("MAHIMA_PUBLIC_BASE_URL") ??
                "https://beta.mahimaministries.in";
            return configured.TrimEnd('/');
        }

        public static string CleanForFileName(string value)
        {
            var clean = string.Join("-", (value ?? "").Trim().Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
            clean = clean.Replace(' ', '-').Replace('/', '-').Replace('\\', '-');
            return string.IsNullOrWhiteSpace(clean) ? DateTime.UtcNow.ToString("yyyyMMddHHmmss") : clean;
        }
    }
}
