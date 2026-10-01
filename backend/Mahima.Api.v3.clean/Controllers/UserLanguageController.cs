using System.Security.Claims;
using System.Text.RegularExpressions;
using Mahima.Api.v3.clean.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Mahima.Api.v3.clean.Controllers;

[ApiController]
[Authorize]
[Route("api/users/me/language")]
public sealed class UserLanguageController : ControllerBase
{
    private static readonly Regex LanguageCode = new("^[a-z]{2,3}(?:-[a-z0-9]{2,4})?$", RegexOptions.Compiled);
    private readonly MahimaDbContext _db;

    public UserLanguageController(MahimaDbContext db) => _db = db;

    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var language = await _db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => u.PreferredLanguage)
            .FirstOrDefaultAsync(ct);
        return Ok(new { language });
    }

    [HttpPut]
    public async Task<IActionResult> Put([FromBody] PreferenceRequest request, CancellationToken ct)
    {
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var code = (request?.Language ?? string.Empty).Trim().ToLowerInvariant();
        if (!LanguageCode.IsMatch(code)) return BadRequest(new { message = "A valid enabled language code is required." });
        if (!await _db.AppLanguages.AnyAsync(l => l.Code == code && l.Enabled, ct))
            return BadRequest(new { message = "That language is not enabled." });

        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
        if (user == null) return NotFound();
        user.PreferredLanguage = code;
        await _db.SaveChangesAsync(ct);
        return Ok(new { language = code });
    }

    private bool TryGetUserId(out Guid userId) => Guid.TryParse(
        User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"), out userId);

    public sealed class PreferenceRequest { public string? Language { get; set; } }
}
