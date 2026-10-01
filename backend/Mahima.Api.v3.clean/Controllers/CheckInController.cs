using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System;
using System.Linq;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Controllers
{
    /// <summary>Child/kids-ministry check-in and check-out with a guardian-matching security code.</summary>
    [ApiController]
    [Route("api/checkin")]
    [Authorize(Roles = "admin,staff,volunteer")]
    public class CheckInController : ControllerBase
    {
        private readonly MahimaDbContext _db;
        private readonly ILogger<CheckInController> _logger;
        private readonly ITenantContextService _tenantContext;
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");

        public CheckInController(MahimaDbContext db, ILogger<CheckInController> logger, ITenantContextService tenantContext)
        {
            _db = db;
            _logger = logger;
            _tenantContext = tenantContext;
        }

        private async Task<Guid> GetCurrentTenantIdAsync()
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
            return tenant?.Id ?? RootTenantId;
        }

        private Guid? CurrentUserId()
        {
            var raw = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
            return Guid.TryParse(raw, out var id) ? id : null;
        }

        private static string GenerateSecurityCode()
        {
            // 4-digit numeric code, easy to read off a printed tag/ticket pair.
            var value = RandomNumberGenerator.GetInt32(0, 10000);
            return value.ToString("D4");
        }

        // GET /api/checkin/active — children currently checked in (not yet picked up).
        [HttpGet("active")]
        public async Task<IActionResult> GetActive()
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var active = await _db.ChildCheckIns.AsNoTracking()
                .Where(c => c.TenantId == tenantId && c.CheckedOutAtUtc == null)
                .OrderByDescending(c => c.CheckedInAtUtc)
                .ToListAsync();
            return Ok(active);
        }

        // GET /api/checkin/history?date=2026-09-11
        [HttpGet("history")]
        public async Task<IActionResult> GetHistory([FromQuery] DateTime? date)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var day = DateTime.SpecifyKind((date ?? DateTime.UtcNow).Date, DateTimeKind.Utc);
            var next = day.AddDays(1);
            var records = await _db.ChildCheckIns.AsNoTracking()
                .Where(c => c.TenantId == tenantId && c.CheckedInAtUtc >= day && c.CheckedInAtUtc < next)
                .OrderByDescending(c => c.CheckedInAtUtc)
                .ToListAsync();
            return Ok(records);
        }

        [HttpPost]
        public async Task<IActionResult> CheckIn([FromBody] CheckInDto dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.ChildName) || string.IsNullOrWhiteSpace(dto.GuardianName))
                return BadRequest("Child name and guardian name are required.");

            var entity = new ChildCheckIn
            {
                TenantId = await GetCurrentTenantIdAsync(),
                EventId = dto.EventId,
                ChildName = dto.ChildName.Trim(),
                ChildDob = dto.ChildDob,
                GuardianName = dto.GuardianName.Trim(),
                GuardianPhone = dto.GuardianPhone,
                GuardianUserId = dto.GuardianUserId,
                SecurityCode = GenerateSecurityCode(),
                AllergyNotes = dto.AllergyNotes,
                GeneralNotes = dto.GeneralNotes,
                CheckedInAtUtc = DateTime.UtcNow,
                CheckedInByUserId = CurrentUserId(),
            };

            _db.ChildCheckIns.Add(entity);
            await _db.SaveChangesAsync();
            _logger.LogInformation("Child check-in {Id} created", entity.Id);
            return CreatedAtAction(nameof(GetActive), entity);
        }

        // POST /api/checkin/{id}/checkout — requires the matching security code.
        [HttpPost("{id:long}/checkout")]
        public async Task<IActionResult> CheckOut(long id, [FromBody] CheckOutDto dto)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var record = await _db.ChildCheckIns.FirstOrDefaultAsync(c => c.Id == id && c.TenantId == tenantId);
            if (record == null) return NotFound();
            if (record.CheckedOutAtUtc != null) return BadRequest("Already checked out.");

            if (!string.Equals(record.SecurityCode, dto?.SecurityCode?.Trim(), StringComparison.Ordinal))
                return BadRequest("Security code does not match. Verify with the guardian's claim ticket.");

            record.CheckedOutAtUtc = DateTime.UtcNow;
            record.CheckedOutByUserId = CurrentUserId();
            await _db.SaveChangesAsync();
            return Ok(record);
        }

        [HttpDelete("{id:long}")]
        [Authorize(Roles = "admin")]
        public async Task<IActionResult> Delete(long id)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var record = await _db.ChildCheckIns.FirstOrDefaultAsync(c => c.Id == id && c.TenantId == tenantId);
            if (record == null) return NotFound();
            _db.ChildCheckIns.Remove(record);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        public class CheckInDto
        {
            public long? EventId { get; set; }
            public string ChildName { get; set; } = "";
            public DateTime? ChildDob { get; set; }
            public string GuardianName { get; set; } = "";
            public string? GuardianPhone { get; set; }
            public Guid? GuardianUserId { get; set; }
            public string? AllergyNotes { get; set; }
            public string? GeneralNotes { get; set; }
        }

        public class CheckOutDto
        {
            public string SecurityCode { get; set; } = "";
        }
    }
}
