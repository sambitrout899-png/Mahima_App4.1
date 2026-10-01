using System;
using System.Collections.Generic;
using System.IO.Compression;
using System.IO;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Authorize(Roles = "admin,ADMIN")]
    [Route("api/server-files")]
    public class ServerFilesController : ControllerBase
    {
        private const long MaxBytes = 2L * 1024L * 1024L * 1024L;

        private readonly IConfiguration _config;
        private readonly IWebHostEnvironment _env;
        private readonly ILogger<ServerFilesController> _logger;
        private readonly FileExtensionContentTypeProvider _contentTypeProvider = new();
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");

        public ServerFilesController(IConfiguration config, IWebHostEnvironment env, ILogger<ServerFilesController> logger)
        {
            _config = config;
            _env = env;
            _logger = logger;
        }

        [HttpGet]
        public IActionResult List([FromQuery] string? path, [FromQuery] string? sortBy = "name", [FromQuery] string? direction = "asc")
        {
            try
            {
                var root = GetRootPath();
                var folder = ResolveSafePath(root, path);
                if (!Directory.Exists(folder)) return NotFound("Folder not found.");

                var entries = Directory.EnumerateFileSystemEntries(folder)
                    .Select(fullPath =>
                    {
                        var isDirectory = Directory.Exists(fullPath);
                        FileSystemInfo info = isDirectory
                            ? new DirectoryInfo(fullPath)
                            : new FileInfo(fullPath);

                        return new ServerFileEntry
                        {
                            Name = info.Name,
                            Path = ToRelativePath(root, fullPath),
                            IsDirectory = isDirectory,
                            Size = isDirectory ? null : new FileInfo(fullPath).Length,
                            ModifiedAtUtc = info.LastWriteTimeUtc
                        };
                    })
                    .ToList();

                entries = SortEntries(entries, sortBy, direction).ToList();

                return Ok(new
                {
                    root = root,
                    path = ToRelativePath(root, folder),
                    parentPath = GetParentPath(root, folder),
                    entries
                });
            }
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogWarning(ex, "Server file access denied for {Path}", path);
                return Forbid();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Could not list server files for {Path}", path);
                return StatusCode(500, "Could not list server files.");
            }
        }

        private static IEnumerable<ServerFileEntry> SortEntries(IEnumerable<ServerFileEntry> entries, string? sortBy, string? direction)
        {
            var descending = string.Equals(direction, "desc", StringComparison.OrdinalIgnoreCase);
            var key = (sortBy ?? "name").Trim().ToLowerInvariant();

            IOrderedEnumerable<ServerFileEntry> ordered = entries
                .OrderByDescending(item => item.IsDirectory);

            return key switch
            {
                "date" or "modified" => descending
                    ? ordered.ThenByDescending(item => item.ModifiedAtUtc).ThenBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
                    : ordered.ThenBy(item => item.ModifiedAtUtc).ThenBy(item => item.Name, StringComparer.OrdinalIgnoreCase),
                "size" => descending
                    ? ordered.ThenByDescending(item => item.Size ?? -1).ThenBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
                    : ordered.ThenBy(item => item.Size ?? -1).ThenBy(item => item.Name, StringComparer.OrdinalIgnoreCase),
                _ => descending
                    ? ordered.ThenByDescending(item => item.Name, StringComparer.OrdinalIgnoreCase)
                    : ordered.ThenBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            };
        }

        [HttpPost("upload")]
        [RequestSizeLimit(MaxBytes)]
        [RequestFormLimits(MultipartBodyLengthLimit = MaxBytes)]
        public async Task<IActionResult> Upload([FromForm] IFormFile? file, [FromForm] string? path, [FromForm] string? relativePath)
        {
            file ??= Request.Form.Files.FirstOrDefault();
            if (file == null) return BadRequest("file is required.");
            if (file.Length > MaxBytes) return BadRequest("File too large. Maximum size is 2 GB.");

            try
            {
                var root = GetRootPath();
                var folder = ResolveSafePath(root, path);
                Directory.CreateDirectory(folder);

                var uploadRelativePath = CleanRelativeUploadPath(relativePath);
                var targetFolder = folder;
                if (!string.IsNullOrWhiteSpace(uploadRelativePath))
                {
                    var relativeFolder = Path.GetDirectoryName(uploadRelativePath);
                    if (!string.IsNullOrWhiteSpace(relativeFolder))
                    {
                        targetFolder = ResolveSafePath(root, Path.Combine(ToRelativePath(root, folder), relativeFolder));
                        Directory.CreateDirectory(targetFolder);
                    }
                }

                var cleanFileName = !string.IsNullOrWhiteSpace(uploadRelativePath)
                    ? Path.GetFileName(uploadRelativePath)
                    : CleanFileName(file.FileName);
                var targetPath = UniqueTargetPath(targetFolder, cleanFileName);

                await using var stream = System.IO.File.Create(targetPath);
                await file.CopyToAsync(stream, HttpContext.RequestAborted);

                return Ok(new
                {
                    message = "File uploaded.",
                    name = Path.GetFileName(targetPath),
                    path = ToRelativePath(root, targetPath),
                    size = file.Length
                });
            }
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogWarning(ex, "Server file upload access denied for {Path}", path);
                return StatusCode(500, "Download folder is not writable by the API service user.");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Could not upload server file {FileName}", file?.FileName);
                return StatusCode(500, "Could not upload file.");
            }
        }

        [HttpPost("folder")]
        public IActionResult CreateFolder([FromBody] ServerFolderRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.Name))
                return BadRequest("Folder name is required.");

            try
            {
                var root = GetRootPath();
                var parent = ResolveSafePath(root, request.Path);
                Directory.CreateDirectory(parent);

                var cleanName = CleanFileName(request.Name);
                var folderPath = ResolveSafePath(root, Path.Combine(ToRelativePath(root, parent), cleanName));
                if (Directory.Exists(folderPath) || System.IO.File.Exists(folderPath))
                    return BadRequest("A file or folder with this name already exists.");

                Directory.CreateDirectory(folderPath);
                return Ok(new
                {
                    message = "Folder created.",
                    name = cleanName,
                    path = ToRelativePath(root, folderPath)
                });
            }
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogWarning(ex, "Server folder create access denied for {Path}", request?.Path);
                return Forbid();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Could not create server folder {Name}", request?.Name);
                return StatusCode(500, "Could not create folder.");
            }
        }

        [HttpPut("rename")]
        public IActionResult Rename([FromBody] ServerRenameRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.Path) || string.IsNullOrWhiteSpace(request.NewName))
                return BadRequest("path and newName are required.");

            try
            {
                var root = GetRootPath();
                var source = ResolveSafePath(root, request.Path);
                var isDirectory = Directory.Exists(source);
                if (!isDirectory && !System.IO.File.Exists(source)) return NotFound("File or folder not found.");

                var parent = Directory.GetParent(source)?.FullName;
                if (string.IsNullOrWhiteSpace(parent)) return BadRequest("Cannot rename this path.");

                var cleanName = CleanFileName(request.NewName);
                var target = ResolveSafePath(root, Path.Combine(ToRelativePath(root, parent), cleanName));
                if (Directory.Exists(target) || System.IO.File.Exists(target))
                    return BadRequest("A file or folder with this name already exists.");

                if (isDirectory)
                    Directory.Move(source, target);
                else
                    System.IO.File.Move(source, target);

                return Ok(new
                {
                    message = "Renamed.",
                    name = cleanName,
                    path = ToRelativePath(root, target)
                });
            }
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogWarning(ex, "Server file rename access denied for {Path}", request?.Path);
                return Forbid();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Could not rename server file {Path}", request?.Path);
                return StatusCode(500, "Could not rename item.");
            }
        }

        [HttpPost("copy")]
        public async Task<IActionResult> Copy([FromBody] ServerTransferRequest request, [FromServices] Mahima.Api.v3.clean.Services.TenantStorageService storage)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.SourcePath))
                return BadRequest("sourcePath is required.");

            try
            {
                var root = GetRootPath();
                var source = ResolveSafePath(root, request.SourcePath);
                var destinationFolder = ResolveSafePath(root, request.DestinationPath);
                await storage.ReserveFilesAsync(GetCurrentTenantId(), Mahima.Api.v3.clean.Services.TenantStorageService.DirectoryBytes(source), HttpContext.RequestAborted);
                Directory.CreateDirectory(destinationFolder);

                var target = UniqueTargetPath(destinationFolder, Path.GetFileName(source));
                if (Directory.Exists(source))
                {
                    if (IsInsidePath(source, target))
                        return BadRequest("Cannot copy a folder into itself.");
                    CopyDirectory(source, target);
                }
                else if (System.IO.File.Exists(source))
                    System.IO.File.Copy(source, target);
                else
                    return NotFound("File or folder not found.");

                return Ok(new { message = "Copied.", path = ToRelativePath(root, target) });
            }
            catch (Mahima.Api.v3.clean.Services.TenantStorageLimitException) { throw; }
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogWarning(ex, "Server file copy access denied for {Path}", request?.SourcePath);
                return Forbid();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Could not copy server file {Path}", request?.SourcePath);
                return StatusCode(500, "Could not copy item.");
            }
        }

        [HttpPost("move")]
        public IActionResult Move([FromBody] ServerTransferRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.SourcePath))
                return BadRequest("sourcePath is required.");

            try
            {
                var root = GetRootPath();
                var source = ResolveSafePath(root, request.SourcePath);
                var destinationFolder = ResolveSafePath(root, request.DestinationPath);
                Directory.CreateDirectory(destinationFolder);

                var target = UniqueTargetPath(destinationFolder, Path.GetFileName(source));
                if (Directory.Exists(source))
                {
                    if (IsInsidePath(source, target))
                        return BadRequest("Cannot move a folder into itself.");
                    Directory.Move(source, target);
                }
                else if (System.IO.File.Exists(source))
                    System.IO.File.Move(source, target);
                else
                    return NotFound("File or folder not found.");

                return Ok(new { message = "Moved.", path = ToRelativePath(root, target) });
            }
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogWarning(ex, "Server file move access denied for {Path}", request?.SourcePath);
                return Forbid();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Could not move server file {Path}", request?.SourcePath);
                return StatusCode(500, "Could not move item.");
            }
        }

        [HttpDelete]
        public IActionResult Delete([FromQuery] string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return BadRequest("path is required.");

            try
            {
                var root = GetRootPath();
                var fullPath = ResolveSafePath(root, path);
                if (Directory.Exists(fullPath))
                {
                    Directory.Delete(fullPath, recursive: true);
                    return Ok(new { message = "Folder deleted." });
                }

                if (System.IO.File.Exists(fullPath))
                {
                    System.IO.File.Delete(fullPath);
                    return Ok(new { message = "File deleted." });
                }

                return NotFound("File or folder not found.");
            }
            catch (UnauthorizedAccessException ex)
            {
                _logger.LogWarning(ex, "Server file delete access denied for {Path}", path);
                return Forbid();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Could not delete server file {Path}", path);
                return StatusCode(500, "Could not delete item.");
            }
        }

        [HttpGet("download")]
        public IActionResult Download([FromQuery] string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return BadRequest("path is required.");

            try
            {
                var root = GetRootPath();
                var fullPath = ResolveSafePath(root, path);
                if (Directory.Exists(fullPath))
                {
                    var archiveName = $"{Path.GetFileName(fullPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))}.zip";
                    var memory = new MemoryStream();
                    using (var archive = new ZipArchive(memory, ZipArchiveMode.Create, leaveOpen: true))
                    {
                        foreach (var file in Directory.EnumerateFiles(fullPath, "*", SearchOption.AllDirectories))
                        {
                            var entryName = Path.GetRelativePath(fullPath, file).Replace('\\', '/');
                            archive.CreateEntryFromFile(file, entryName, CompressionLevel.Fastest);
                        }
                    }
                    memory.Position = 0;
                    return File(memory, "application/zip", string.IsNullOrWhiteSpace(archiveName) ? "folder.zip" : archiveName);
                }

                if (!System.IO.File.Exists(fullPath)) return NotFound("File not found.");

                if (!_contentTypeProvider.TryGetContentType(fullPath, out var contentType))
                    contentType = "application/octet-stream";

                var stream = System.IO.File.OpenRead(fullPath);
                return File(stream, contentType, Path.GetFileName(fullPath));
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Could not download server file {Path}", path);
                return StatusCode(500, "Could not download file.");
            }
        }

        private string GetRootPath()
        {
            var configured = _config["ServerFiles:Root"]
                ?? Environment.GetEnvironmentVariable("MAHIMA_DOWNLOADS_ROOT");

            if (string.IsNullOrWhiteSpace(configured))
            {
                configured = OperatingSystem.IsLinux()
                    ? "/var/www/mahima-downloads"
                    : Path.Combine(_env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot"), "downloads");
            }

            var tenantRoot = Path.Combine(configured, "tenants", GetCurrentTenantId().ToString("N"));
            Directory.CreateDirectory(tenantRoot);
            return Path.GetFullPath(tenantRoot);
        }

        private Guid GetCurrentTenantId() =>
            Guid.TryParse(User.FindFirstValue("tenant_id"), out var id)
                ? id
                : RootTenantId;

        private static string ResolveSafePath(string root, string? relativePath)
        {
            var safeRelative = (relativePath ?? string.Empty)
                .Replace('\\', Path.DirectorySeparatorChar)
                .Replace('/', Path.DirectorySeparatorChar)
                .TrimStart(Path.DirectorySeparatorChar);

            var fullPath = Path.GetFullPath(Path.Combine(root, safeRelative));
            var rootWithSlash = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;

            if (!string.Equals(fullPath, root, StringComparison.OrdinalIgnoreCase)
                && !fullPath.StartsWith(rootWithSlash, StringComparison.OrdinalIgnoreCase))
            {
                throw new UnauthorizedAccessException("Path escapes the configured download folder.");
            }

            return fullPath;
        }

        private static string ToRelativePath(string root, string fullPath)
        {
            var relative = Path.GetRelativePath(root, fullPath).Replace('\\', '/');
            return relative == "." ? string.Empty : relative;
        }

        private static string? GetParentPath(string root, string folder)
        {
            if (string.Equals(Path.GetFullPath(root), Path.GetFullPath(folder), StringComparison.OrdinalIgnoreCase))
                return null;

            var parent = Directory.GetParent(folder)?.FullName;
            return parent == null ? null : ToRelativePath(root, parent);
        }

        private static string CleanFileName(string fileName)
        {
            var clean = Path.GetFileName(fileName);
            foreach (var invalid in Path.GetInvalidFileNameChars())
                clean = clean.Replace(invalid, '_');

            return string.IsNullOrWhiteSpace(clean) ? $"upload-{Guid.NewGuid():N}.bin" : clean;
        }

        private static string CleanRelativeUploadPath(string? relativePath)
        {
            if (string.IsNullOrWhiteSpace(relativePath)) return string.Empty;

            var segments = relativePath
                .Replace('\\', '/')
                .Split('/', StringSplitOptions.RemoveEmptyEntries)
                .Select(CleanFileName)
                .Where(segment => segment != "." && segment != ".." && !string.IsNullOrWhiteSpace(segment))
                .ToArray();

            return segments.Length == 0 ? string.Empty : Path.Combine(segments);
        }

        private static string UniqueTargetPath(string folder, string fileName)
        {
            var target = Path.Combine(folder, fileName);
            if (!System.IO.File.Exists(target) && !Directory.Exists(target)) return target;

            var name = Path.GetFileNameWithoutExtension(fileName);
            var ext = Path.GetExtension(fileName);
            for (var i = 1; i <= 999; i++)
            {
                target = Path.Combine(folder, $"{name}-{i}{ext}");
                if (!System.IO.File.Exists(target) && !Directory.Exists(target)) return target;
            }

            return Path.Combine(folder, $"{name}-{Guid.NewGuid():N}{ext}");
        }

        private static void CopyDirectory(string source, string target)
        {
            Directory.CreateDirectory(target);

            foreach (var file in Directory.EnumerateFiles(source))
            {
                var targetFile = UniqueTargetPath(target, Path.GetFileName(file));
                System.IO.File.Copy(file, targetFile);
            }

            foreach (var directory in Directory.EnumerateDirectories(source))
            {
                var targetDirectory = UniqueTargetPath(target, Path.GetFileName(directory));
                CopyDirectory(directory, targetDirectory);
            }
        }

        private static bool IsInsidePath(string parent, string child)
        {
            var parentFull = Path.GetFullPath(parent).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            var childFull = Path.GetFullPath(child).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            return childFull.StartsWith(parentFull, StringComparison.OrdinalIgnoreCase);
        }

        public class ServerFileEntry
        {
            public string Name { get; set; } = "";
            public string Path { get; set; } = "";
            public bool IsDirectory { get; set; }
            public long? Size { get; set; }
            public DateTime ModifiedAtUtc { get; set; }
        }

        public class ServerFolderRequest
        {
            public string? Path { get; set; }
            public string Name { get; set; } = "";
        }

        public class ServerRenameRequest
        {
            public string Path { get; set; } = "";
            public string NewName { get; set; } = "";
        }

        public class ServerTransferRequest
        {
            public string SourcePath { get; set; } = "";
            public string? DestinationPath { get; set; }
        }
    }
}
