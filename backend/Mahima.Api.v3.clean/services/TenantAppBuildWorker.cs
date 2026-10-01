using Mahima.Api.v3.clean.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Services
{
    // Consumes TenantAppBuildQueue's channel one job at a time - the single
    // consumer *is* the concurrency guard, since every tenant's icon-generation
    // step temporarily overwrites the one shared frontend/android/app/src/main/res
    // directory on this server (see build-tenant-app.mjs). Two builds running at
    // once would corrupt each other's icons.
    public sealed class TenantAppBuildWorker : BackgroundService
    {
        private static readonly Regex ProgressLine = new(@"^PROGRESS:(\w+)", RegexOptions.Compiled);

        private readonly TenantAppBuildQueue _queue;
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly IWebHostEnvironment _env;
        private readonly IConfiguration _config;
        private readonly ILogger<TenantAppBuildWorker> _logger;

        public TenantAppBuildWorker(
            TenantAppBuildQueue queue,
            IServiceScopeFactory scopeFactory,
            IWebHostEnvironment env,
            IConfiguration config,
            ILogger<TenantAppBuildWorker> logger)
        {
            _queue = queue;
            _scopeFactory = scopeFactory;
            _env = env;
            _config = config;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            await foreach (var job in _queue.Reader.ReadAllAsync(stoppingToken))
            {
                try
                {
                    await ProcessAsync(job, stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Tenant app build job failed for {Slug}", job.Slug);
                    _queue.UpdateStage(job.TenantId, job.Slug, TenantAppBuildStage.Failed, errorMessage: ex.Message);
                }
            }
        }

        private async Task ProcessAsync(TenantAppBuildJob job, CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<MahimaDbContext>();
            var publisher = scope.ServiceProvider.GetRequiredService<AppReleasePublishingService>();

            var tenant = await db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == job.TenantId, ct);
            var branding = await db.TenantBrandings.AsNoTracking().FirstOrDefaultAsync(b => b.TenantId == job.TenantId, ct);
            if (tenant == null)
            {
                _queue.UpdateStage(job.TenantId, job.Slug, TenantAppBuildStage.Failed, errorMessage: "Tenant no longer exists.");
                return;
            }
            if (string.IsNullOrWhiteSpace(branding?.LogoUrl))
            {
                _queue.UpdateStage(job.TenantId, job.Slug, TenantAppBuildStage.Failed,
                    errorMessage: "This tenant has no logo set in Brand settings - upload one before generating the app.");
                return;
            }

            var repoRoot = ResolveRepoRoot();
            var scriptPath = Path.Combine(repoRoot, "tools", "build-tenant-app", "build-tenant-app.mjs");
            var stagingApkPath = publisher.GetTenantStagingApkPath(job.Slug);
            var build = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();

            var psi = new ProcessStartInfo
            {
                FileName = "node",
                WorkingDirectory = repoRoot,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add(scriptPath);
            psi.ArgumentList.Add("--slug"); psi.ArgumentList.Add(job.Slug);
            psi.ArgumentList.Add("--tenant-name"); psi.ArgumentList.Add(tenant.Name);
            psi.ArgumentList.Add("--logo-url"); psi.ArgumentList.Add(branding.LogoUrl!);
            psi.ArgumentList.Add("--primary-color"); psi.ArgumentList.Add(branding.PrimaryColor);
            psi.ArgumentList.Add("--version"); psi.ArgumentList.Add(job.Version);
            psi.ArgumentList.Add("--build"); psi.ArgumentList.Add(build);
            psi.ArgumentList.Add("--out"); psi.ArgumentList.Add(stagingApkPath);
            psi.ArgumentList.Add("--skip-upload");

            _queue.UpdateStage(job.TenantId, job.Slug, TenantAppBuildStage.Queued, "Starting build...");

            using var process = new Process { StartInfo = psi, EnableRaisingEvents = true };
            var stderrTail = new StringBuilder();

            process.OutputDataReceived += (_, e) =>
            {
                if (string.IsNullOrEmpty(e.Data)) return;
                var match = ProgressLine.Match(e.Data);
                if (match.Success && Enum.TryParse<TenantAppBuildStage>(match.Groups[1].Value, out var stage))
                {
                    _queue.UpdateStage(job.TenantId, job.Slug, stage, version: job.Version, build: build);
                }
                _logger.LogInformation("[tenant-app-build:{Slug}] {Line}", job.Slug, e.Data);
            };
            process.ErrorDataReceived += (_, e) =>
            {
                if (string.IsNullOrEmpty(e.Data)) return;
                stderrTail.AppendLine(e.Data);
                if (stderrTail.Length > 4000) stderrTail.Remove(0, stderrTail.Length - 4000);
                _logger.LogWarning("[tenant-app-build:{Slug}] {Line}", job.Slug, e.Data);
            };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            await process.WaitForExitAsync(ct);

            if (process.ExitCode == 0 && File.Exists(stagingApkPath))
            {
                _queue.UpdateStage(job.TenantId, job.Slug, TenantAppBuildStage.Ready,
                    "Ready to publish.", version: job.Version, build: build);
            }
            else
            {
                var error = stderrTail.Length > 0 ? stderrTail.ToString() : $"Build process exited with code {process.ExitCode}.";
                _queue.UpdateStage(job.TenantId, job.Slug, TenantAppBuildStage.Failed, errorMessage: error);
            }
        }

        private string ResolveRepoRoot()
        {
            var configured = _config["TenantAppBuild:RepoRoot"];
            if (!string.IsNullOrWhiteSpace(configured)) return Path.GetFullPath(configured);

            // Default: this API project lives at {repoRoot}/backend/Mahima.Api.v3.clean
            return Path.GetFullPath(Path.Combine(_env.ContentRootPath, "..", ".."));
        }
    }
}
