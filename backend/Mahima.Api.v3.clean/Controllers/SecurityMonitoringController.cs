using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Mahima.Api.v3.clean.Controllers;

[ApiController]
[Authorize(Roles = "admin,Admin")]
[Route("api/admin/qa/security")]
public sealed class SecurityMonitoringController : ControllerBase
{
    private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");
    private readonly ISecurityPostureMonitor _monitor;
    public SecurityMonitoringController(ISecurityPostureMonitor monitor) => _monitor = monitor;
    private bool IsRoot() => Guid.TryParse(User.FindFirst("tenant_id")?.Value, out var id) && id == RootTenantId;
    [HttpGet("status")] public async Task<IActionResult> Status(CancellationToken ct) => IsRoot() ? Ok(await _monitor.StatusAsync(ct)) : Forbid();
    [HttpGet("runs")] public async Task<IActionResult> Runs([FromQuery]int limit=30,CancellationToken ct=default) => IsRoot() ? Ok(await _monitor.HistoryAsync(limit,ct)) : Forbid();
    [HttpGet("runs/{id:guid}")] public async Task<IActionResult> Run(Guid id,CancellationToken ct){if(!IsRoot())return Forbid();var run=await _monitor.GetAsync(id,ct);return run==null?NotFound():Ok(run);}
    [HttpPost("run-now")] public async Task<IActionResult> RunNow(CancellationToken ct) => IsRoot() ? Ok(await _monitor.RunAsync("manual",ct)) : Forbid();
}
