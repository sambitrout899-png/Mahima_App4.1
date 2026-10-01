using System;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Data;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace Mahima.Api.v3.clean.Services
{
    public class RootTenantOverrideMiddleware
    {
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");
        private readonly RequestDelegate _next;

        public RootTenantOverrideMiddleware(RequestDelegate next)
        {
            _next = next;
        }

        public async Task InvokeAsync(HttpContext context, MahimaDbContext db)
        {
            var selectedTenantText = context.Request.Headers["X-Tenant-Id"].FirstOrDefault();
            if (!Guid.TryParse(selectedTenantText, out var selectedTenantId))
            {
                await _next(context);
                return;
            }

            var user = context.User;
            var isAdmin = user?.Claims
                .Where(c => c.Type == ClaimTypes.Role || c.Type == "role" || c.Type == "roles")
                .Any(c => string.Equals(c.Value, "admin", StringComparison.OrdinalIgnoreCase)) == true;

            var claimTenantText = user?.FindFirst("tenant_id")?.Value;
            var isRootAdmin = isAdmin &&
                Guid.TryParse(claimTenantText, out var claimTenantId) &&
                (claimTenantId == RootTenantId || await db.Tenants.AnyAsync(t => t.Id == claimTenantId && t.IsRootTenant));

            if (!isRootAdmin || !await db.Tenants.AnyAsync(t => t.Id == selectedTenantId))
            {
                await _next(context);
                return;
            }

            foreach (var identity in user!.Identities.OfType<ClaimsIdentity>())
            {
                foreach (var claim in identity.FindAll("tenant_id").ToList())
                    identity.RemoveClaim(claim);
                foreach (var claim in identity.FindAll("tenantId").ToList())
                    identity.RemoveClaim(claim);

                identity.AddClaim(new Claim("tenant_id", selectedTenantId.ToString()));
                identity.AddClaim(new Claim("tenantId", selectedTenantId.ToString()));
            }

            await _next(context);
        }
    }
}
