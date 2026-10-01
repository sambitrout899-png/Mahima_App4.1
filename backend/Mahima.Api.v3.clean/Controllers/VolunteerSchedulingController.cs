using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Controllers
{
    /// <summary>Volunteer shift scheduling with self-signup, built on top of the existing Teams/Events data.</summary>
    [ApiController]
    [Route("api/volunteer-shifts")]
    [Authorize]
    public class VolunteerSchedulingController : ControllerBase
    {
        private readonly MahimaDbContext _db;
        private readonly ILogger<VolunteerSchedulingController> _logger;
        private readonly ITenantContextService _tenantContext;
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");

        public VolunteerSchedulingController(MahimaDbContext db, ILogger<VolunteerSchedulingController> logger, ITenantContextService tenantContext)
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

        // GET /api/volunteer-shifts?from=2026-09-01&to=2026-09-30
        [HttpGet]
        public async Task<IActionResult> GetAll([FromQuery] DateTime? from, [FromQuery] DateTime? to)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var query = _db.VolunteerShifts.AsNoTracking().Where(s => s.TenantId == tenantId);
            if (from.HasValue) query = query.Where(s => s.ShiftDate >= from.Value.Date);
            if (to.HasValue) query = query.Where(s => s.ShiftDate <= to.Value.Date);

            var shifts = await query.OrderBy(s => s.ShiftDate).ThenBy(s => s.StartTime).ToListAsync();
            var shiftIds = shifts.Select(s => s.Id).ToList();

            var signups = await _db.VolunteerSignups.AsNoTracking()
                .Where(s => shiftIds.Contains(s.ShiftId) && s.Status != "cancelled")
                .ToListAsync();

            var myUserId = CurrentUserId();
            var result = shifts.Select(s => new
            {
                s.Id,
                s.Title,
                s.Notes,
                s.TeamId,
                s.EventId,
                s.ShiftDate,
                s.StartTime,
                s.EndTime,
                s.SlotsNeeded,
                SignupCount = signups.Count(x => x.ShiftId == s.Id),
                IsFull = signups.Count(x => x.ShiftId == s.Id) >= s.SlotsNeeded,
                IHaveSignedUp = myUserId.HasValue && signups.Any(x => x.ShiftId == s.Id && x.UserId == myUserId),
            });

            return Ok(result);
        }

        [HttpGet("{id:long}/signups")]
        [Authorize(Roles = "admin,staff")]
        public async Task<IActionResult> GetSignups(long id)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var signups = await _db.VolunteerSignups.AsNoTracking()
                .Where(s => s.ShiftId == id && s.TenantId == tenantId)
                .OrderBy(s => s.SignedUpAtUtc)
                .ToListAsync();
            return Ok(signups);
        }

        [HttpPost]
        [Authorize(Roles = "admin,staff")]
        public async Task<IActionResult> Create([FromBody] ShiftCreateDto dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.Title)) return BadRequest("Title is required.");
            if (dto.ShiftDate == default) return BadRequest("ShiftDate is required.");

            var entity = new VolunteerShift
            {
                TenantId = await GetCurrentTenantIdAsync(),
                Title = dto.Title.Trim(),
                Notes = dto.Notes,
                TeamId = dto.TeamId,
                EventId = dto.EventId,
                ShiftDate = dto.ShiftDate.Date,
                StartTime = dto.StartTime,
                EndTime = dto.EndTime,
                SlotsNeeded = Math.Max(1, dto.SlotsNeeded),
                CreatedByUserId = CurrentUserId(),
                CreatedAtUtc = DateTime.UtcNow,
                UpdatedAtUtc = DateTime.UtcNow,
            };

            _db.VolunteerShifts.Add(entity);
            await _db.SaveChangesAsync();
            return CreatedAtAction(nameof(GetAll), new { }, entity);
        }

        [HttpPut("{id:long}")]
        [Authorize(Roles = "admin,staff")]
        public async Task<IActionResult> Update(long id, [FromBody] ShiftCreateDto dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.Title)) return BadRequest("Title is required.");

            var tenantId = await GetCurrentTenantIdAsync();
            var shift = await _db.VolunteerShifts.FirstOrDefaultAsync(s => s.Id == id && s.TenantId == tenantId);
            if (shift == null) return NotFound();

            shift.Title = dto.Title.Trim();
            shift.Notes = dto.Notes;
            shift.TeamId = dto.TeamId;
            shift.EventId = dto.EventId;
            shift.ShiftDate = dto.ShiftDate.Date;
            shift.StartTime = dto.StartTime;
            shift.EndTime = dto.EndTime;
            shift.SlotsNeeded = Math.Max(1, dto.SlotsNeeded);
            shift.UpdatedAtUtc = DateTime.UtcNow;

            await _db.SaveChangesAsync();
            return Ok(shift);
        }

        [HttpDelete("{id:long}")]
        [Authorize(Roles = "admin,staff")]
        public async Task<IActionResult> Delete(long id)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var shift = await _db.VolunteerShifts.FirstOrDefaultAsync(s => s.Id == id && s.TenantId == tenantId);
            if (shift == null) return NotFound();

            _db.VolunteerShifts.Remove(shift);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        // -------- Self-signup --------

        [HttpPost("{id:long}/signup")]
        public async Task<IActionResult> SignUp(long id)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var userId = CurrentUserId();
            if (userId == null) return Unauthorized();

            var shift = await _db.VolunteerShifts.FirstOrDefaultAsync(s => s.Id == id && s.TenantId == tenantId);
            if (shift == null) return NotFound();

            var existing = await _db.VolunteerSignups.FirstOrDefaultAsync(s => s.ShiftId == id && s.UserId == userId);
            if (existing != null && existing.Status != "cancelled")
                return Ok(existing);

            var activeCount = await _db.VolunteerSignups.CountAsync(s => s.ShiftId == id && s.Status != "cancelled");
            if (activeCount >= shift.SlotsNeeded)
                return BadRequest("This shift is already fully staffed.");

            if (existing != null)
            {
                existing.Status = "signed_up";
                existing.SignedUpAtUtc = DateTime.UtcNow;
                await _db.SaveChangesAsync();
                return Ok(existing);
            }

            var signup = new VolunteerSignup
            {
                TenantId = tenantId,
                ShiftId = id,
                UserId = userId.Value,
                Status = "signed_up",
                SignedUpAtUtc = DateTime.UtcNow,
            };
            _db.VolunteerSignups.Add(signup);
            await _db.SaveChangesAsync();
            return Ok(signup);
        }

        [HttpDelete("{id:long}/signup")]
        public async Task<IActionResult> CancelSignUp(long id)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var userId = CurrentUserId();
            if (userId == null) return Unauthorized();

            var signup = await _db.VolunteerSignups.FirstOrDefaultAsync(s => s.ShiftId == id && s.TenantId == tenantId && s.UserId == userId);
            if (signup == null) return NotFound();

            signup.Status = "cancelled";
            await _db.SaveChangesAsync();
            return NoContent();
        }

        public class ShiftCreateDto
        {
            public string Title { get; set; } = "";
            public string? Notes { get; set; }
            public long? TeamId { get; set; }
            public long? EventId { get; set; }
            public DateTime ShiftDate { get; set; }
            public TimeSpan? StartTime { get; set; }
            public TimeSpan? EndTime { get; set; }
            public int SlotsNeeded { get; set; } = 1;
        }
    }
}
