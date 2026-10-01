using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Mahima.Api.v3.clean.Controllers;

[ApiController]
[Authorize(Roles = "admin,ADMIN")]
public sealed class TenantStorageController(ITenantContextService tenants, TenantStorageService storage, MahimaDbContext db) : ControllerBase
{
    [HttpGet("api/tenants/current/storage")]
    public async Task<IActionResult> Current(CancellationToken ct)
    {
        var tenant = await tenants.GetCurrentTenantAsync(ct);
        if (tenant is null) return Forbid();
        return Ok(await storage.GetAsync(tenant.Id, ct));
    }

    [HttpGet("api/platform/tenants/{tenantId:guid}/storage")]
    public async Task<IActionResult> Tenant(Guid tenantId, CancellationToken ct)
    {
        var current = await tenants.GetCurrentTenantAsync(ct);
        if (current?.IsRootTenant != true) return Forbid();
        if (!await db.Tenants.AnyAsync(t => t.Id == tenantId, ct)) return NotFound();
        return Ok(await storage.GetAsync(tenantId, ct));
    }
}
