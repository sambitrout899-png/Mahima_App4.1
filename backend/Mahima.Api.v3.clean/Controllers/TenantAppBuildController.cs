using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System;
using System.IO;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Route("api/tenants/{slug}/app-build")]
    [Authorize(Roles = "admin,ADMIN")]
    public class TenantAppBuildController : ControllerBase
    {
        private readonly MahimaDbContext _db;
        private readonly ITenantContextService _tenantContext;
        private readonly TenantAppBuildQueue _queue;
        private readonly AppReleasePublishingService _publisher;

        public TenantAppBuildController(
            MahimaDbContext db,
            ITenantContextService tenantContext,
            TenantAppBuildQueue queue,
            AppReleasePublishingService publisher)
        {
            _db = db;
            _tenantContext = tenantContext;
            _queue = queue;
            _publisher = publisher;
        }

        public record GenerateRequest(string? Version);
        public record PublishRequest(string Version, string? Build, string? MinSupportedVersion, string? ReleaseNotes, bool ForceUpgrade);

        [HttpPost("generate")]
        public async Task<IActionResult> Generate(string slug, [FromBody] GenerateRequest? request, CancellationToken ct)
        {
            var (tenant, error) = await ResolveManageableTenantAsync(slug, ct);
            if (error != null) return error;

            var version = string.IsNullOrWhiteSpace(request?.Version) ? "1.0.0" : request!.Version!.Trim();
            var (accepted, state) = _queue.EnqueueGenerate(tenant!.Id, tenant.Slug, version, CurrentUserId());

            if (!accepted)
                return Conflict(ToStatusPayload(state));

            return Ok(ToStatusPayload(state));
        }

        [HttpGet("status")]
        public async Task<IActionResult> Status(string slug, CancellationToken ct)
        {
            var (tenant, error) = await ResolveManageableTenantAsync(slug, ct);
            if (error != null) return error;

            var state = _queue.GetStatus(tenant!.Id);
            if (state == null)
                return Ok(new { stage = "Idle", message = "Not generated yet.", errorMessage = (string?)null, version = (string?)null, build = (string?)null, canPublish = false });

            return Ok(ToStatusPayload(state));
        }

        [HttpPost("publish")]
        public async Task<IActionResult> Publish(string slug, [FromBody] PublishRequest request, CancellationToken ct)
        {
            var (tenant, error) = await ResolveManageableTenantAsync(slug, ct);
            if (error != null) return error;

            var state = _queue.GetStatus(tenant!.Id);
            if (state == null || state.Stage != TenantAppBuildStage.Ready)
                return Conflict(new { message = "No generated build is ready to publish. Click Generate APK first." });

            if (string.IsNullOrWhiteSpace(request.Version))
                return BadRequest("Version is required.");

            var stagingApkPath = _publisher.GetTenantStagingApkPath(tenant.Slug);
            if (!System.IO.File.Exists(stagingApkPath))
            {
                _queue.UpdateStage(tenant.Id, tenant.Slug, TenantAppBuildStage.Failed, errorMessage: "Staged APK went missing - generate again.");
                return Conflict(new { message = "Staged APK went missing - generate again." });
            }

            _queue.UpdateStage(tenant.Id, tenant.Slug, TenantAppBuildStage.Publishing, "Publishing...", version: request.Version);

            try
            {
                var manifest = await _publisher.PublishAsync(
                    tenant.Slug, stagingApkPath, request.Version, request.Build,
                    request.MinSupportedVersion, request.ReleaseNotes, request.ForceUpgrade,
                    CurrentUserId(), ct);

                _queue.UpdateStage(tenant.Id, tenant.Slug, TenantAppBuildStage.Published, "Published.", version: request.Version, build: request.Build);
                return Ok(manifest);
            }
            catch (Exception ex)
            {
                _queue.UpdateStage(tenant.Id, tenant.Slug, TenantAppBuildStage.Failed, errorMessage: ex.Message);
                return StatusCode(500, new { message = "Could not publish the app.", detail = ex.Message });
            }
        }

        private static object ToStatusPayload(TenantAppBuildState state) => new
        {
            stage = state.Stage.ToString(),
            message = state.Message,
            errorMessage = state.ErrorMessage,
            version = state.Version,
            build = state.Build,
            canPublish = state.Stage == TenantAppBuildStage.Ready,
            updatedAtUtc = state.UpdatedAtUtc,
        };

        private async Task<(Tenant? tenant, IActionResult? error)> ResolveManageableTenantAsync(string slug, CancellationToken ct)
        {
            var normalized = AppReleasePublishingService.NormalizeTenantSlug(slug);
            if (normalized == null) return (null, BadRequest("Invalid tenant."));

            var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Slug == normalized, ct);
            if (tenant == null) return (null, NotFound("Tenant not found."));

            var currentTenant = await _tenantContext.GetCurrentTenantAsync(ct);
            var canManage = currentTenant?.IsRootTenant == true || currentTenant?.Id == tenant.Id;
            if (!canManage) return (null, Forbid());

            return (tenant, null);
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
