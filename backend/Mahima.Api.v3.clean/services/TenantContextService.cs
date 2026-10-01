using System;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Models;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace Mahima.Api.v3.clean.Services
{
    public class TenantContextService : ITenantContextService
    {
        private readonly MahimaDbContext _db;
        private readonly IHttpContextAccessor _httpContextAccessor;

        public TenantContextService(MahimaDbContext db, IHttpContextAccessor httpContextAccessor)
        {
            _db = db;
            _httpContextAccessor = httpContextAccessor;
        }

        public async Task<Tenant?> GetCurrentTenantAsync(CancellationToken ct = default)
        {
            var http = _httpContextAccessor.HttpContext;
            var headerTenantIdText = http?.Request?.Headers["X-Tenant-Id"].FirstOrDefault();
            var claimTenantIdText = http?.User?.FindFirst("tenant_id")?.Value;
            var canUseTenantOverride = await CanUseTenantOverrideAsync(http?.User, claimTenantIdText, ct);
            var tenantIdText = canUseTenantOverride && !string.IsNullOrWhiteSpace(headerTenantIdText)
                ? headerTenantIdText
                : claimTenantIdText ?? headerTenantIdText;

            if (Guid.TryParse(tenantIdText, out var tenantId))
            {
                var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == tenantId, ct);
                if (tenant != null) return tenant;
            }

            var slug =
                http?.Request?.Headers["X-Tenant-Slug"].FirstOrDefault() ??
                http?.Request?.Query["tenantSlug"].FirstOrDefault() ??
                http?.Request?.Query["tenant"].FirstOrDefault();

            if (!string.IsNullOrWhiteSpace(slug))
            {
                var normalized = slug.Trim().ToLowerInvariant();
                var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Slug == normalized, ct);
                if (tenant != null) return tenant;
            }

            var host = http?.Request?.Host.Host;
            if (!string.IsNullOrWhiteSpace(host))
            {
                var normalizedHost = host.Trim().ToLowerInvariant();
                if (normalizedHost.StartsWith("www.", StringComparison.Ordinal))
                    normalizedHost = normalizedHost.Substring(4);

                var tenant = await _db.Tenants.FirstOrDefaultAsync(t =>
                    t.Domain != null &&
                    t.Domain.ToLower() == normalizedHost &&
                    t.Status == "active" &&
                    (t.DomainStatus == "verified" || t.DomainStatus == "active"), ct);
                if (tenant != null) return tenant;
            }

            return await GetOrCreateRootTenantAsync(ct);
        }

        private async Task<bool> CanUseTenantOverrideAsync(ClaimsPrincipal? user, string? claimTenantIdText, CancellationToken ct)
        {
            if (user?.Identity?.IsAuthenticated != true) return false;

            var hasAdminRole = user.Claims
                .Where(c => c.Type == ClaimTypes.Role || c.Type == "role" || c.Type == "roles")
                .Select(c => c.Value)
                .Any(v => string.Equals(v, "admin", StringComparison.OrdinalIgnoreCase));
            if (!hasAdminRole) return false;

            if (Guid.TryParse(claimTenantIdText, out var tenantId))
            {
                return await _db.Tenants.AnyAsync(t => t.Id == tenantId && t.IsRootTenant, ct);
            }

            return false;
        }

        public async Task<Tenant> GetOrCreateRootTenantAsync(CancellationToken ct = default)
        {
            var existing = await _db.Tenants.FirstOrDefaultAsync(t => t.IsRootTenant, ct);
            if (existing != null) return existing;

            existing = await _db.Tenants.FirstOrDefaultAsync(t => t.Slug == "mahima-root", ct);
            if (existing != null)
            {
                existing.IsRootTenant = true;
                await _db.SaveChangesAsync(ct);
                return existing;
            }

            var root = new Tenant
            {
                Name = "Mahima Ministry",
                Slug = "mahima-root",
                Status = "active",
                IsRootTenant = true,
                ContactEmail = "admin@mahimaministries.in"
            };
            _db.Tenants.Add(root);
            await _db.SaveChangesAsync(ct);
            return root;
        }
    }
}
