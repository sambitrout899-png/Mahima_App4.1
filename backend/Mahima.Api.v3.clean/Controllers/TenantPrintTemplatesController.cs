using System.Security.Claims;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Mahima.Api.v3.clean.Controllers;

[ApiController]
[Route("api/tenant-admin/print-template")]
[Authorize]
public sealed class TenantPrintTemplatesController : ControllerBase
{
    private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");
    private readonly ITenantPrintTemplateService _templates;

    public TenantPrintTemplatesController(ITenantPrintTemplateService templates) => _templates = templates;

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct) =>
        Ok(await _templates.GetAsync(CurrentTenantId(), ct));

    [HttpPut]
    [Authorize(Roles = "admin,ADMIN")]
    public async Task<IActionResult> Save([FromBody] TenantPrintTemplateRequest request, CancellationToken ct)
    {
        if (request == null || string.IsNullOrWhiteSpace(request.OrganizationName))
            return BadRequest("Organization name is required.");
        var paper = string.Equals(request.PaperSize, "Letter", StringComparison.OrdinalIgnoreCase) ? "Letter" : "A4";
        var orientation = string.Equals(request.Orientation, "landscape", StringComparison.OrdinalIgnoreCase) ? "landscape" : "portrait";
        var color = NormalizeColor(request.PrimaryColor);
        var saved = await _templates.SaveAsync(new TenantPrintTemplate(
            CurrentTenantId(), request.OrganizationName.Trim(), Clean(request.LogoUrl), Clean(request.Address),
            Clean(request.Phone), Clean(request.Email), Clean(request.RegistrationNumber), Clean(request.TaxNumber),
            Clean(request.HeaderText), Clean(request.FooterText), color, request.ShowLogo, request.ShowAddress,
            request.ShowPageNumbers, paper, orientation,
            Clean(request.SignatureUrl), Clean(request.SignatoryName), Clean(request.SignatoryTitle)), ct);
        return Ok(saved);
    }

    private Guid CurrentTenantId() =>
        Guid.TryParse(User.FindFirstValue("tenant_id"), out var id) ? id : RootTenantId;
    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static string NormalizeColor(string? value) =>
        !string.IsNullOrWhiteSpace(value) && System.Text.RegularExpressions.Regex.IsMatch(value, "^#[0-9a-fA-F]{6}$")
            ? value : "#047857";
}

public sealed record TenantPrintTemplateRequest(
    string OrganizationName, string? LogoUrl, string? Address, string? Phone, string? Email,
    string? RegistrationNumber, string? TaxNumber, string? HeaderText, string? FooterText,
    string? PrimaryColor, bool ShowLogo, bool ShowAddress, bool ShowPageNumbers,
    string? PaperSize, string? Orientation,
    string? SignatureUrl = null, string? SignatoryName = null, string? SignatoryTitle = null);
