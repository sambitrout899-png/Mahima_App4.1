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
    /// <summary>
    /// Public-facing church events: public/private visibility, capacity, and RSVP —
    /// distinct from the lightweight internal <see cref="Meeting"/> scheduler.
    /// </summary>
    [ApiController]
    [Route("api/events")]
    public class EventsController : ControllerBase
    {
        private readonly MahimaDbContext _db;
        private readonly ILogger<EventsController> _logger;
        private readonly ITenantContextService _tenantContext;
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");

        public EventsController(MahimaDbContext db, ILogger<EventsController> logger, ITenantContextService tenantContext)
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

        // GET /api/events?includePast=false — visible events for the signed-in member/admin.
        // Admins see private events too; everyone else only sees IsPublic ones.
        [HttpGet]
        public async Task<IActionResult> GetAll([FromQuery] bool includePast = false)
        {
            try
            {
                var tenantId = await GetCurrentTenantIdAsync();
                var canManage = User.IsInRole("admin") || User.IsInRole("staff");
                var query = _db.Events.AsNoTracking().Where(e => e.TenantId == tenantId);
                if (!canManage) query = query.Where(e => e.IsPublic);
                if (!includePast) query = query.Where(e => e.StartAtUtc >= DateTime.UtcNow.AddDays(-1));

                var events = await query.OrderBy(e => e.StartAtUtc).ToListAsync();

                var eventIds = events.Select(e => e.Id).ToList();
                var rsvpCounts = await _db.EventRsvps.AsNoTracking()
                    .Where(r => eventIds.Contains(r.EventId) && r.Status != "cancelled")
                    .GroupBy(r => r.EventId)
                    .Select(g => new { EventId = g.Key, Count = g.Sum(r => r.PartySize) })
                    .ToListAsync();
                var countMap = rsvpCounts.ToDictionary(x => x.EventId, x => x.Count);

                var attachmentCounts = await _db.EventAttachments.AsNoTracking()
                    .Where(a => eventIds.Contains(a.EventId))
                    .GroupBy(a => a.EventId)
                    .Select(g => new { EventId = g.Key, Count = g.Count() })
                    .ToListAsync();
                var attachmentCountMap = attachmentCounts.ToDictionary(x => x.EventId, x => x.Count);

                var myUserId = CurrentUserId();
                var myRsvpEventIds = myUserId.HasValue
                    ? (await _db.EventRsvps.AsNoTracking()
                        .Where(r => eventIds.Contains(r.EventId) && r.UserId == myUserId && r.Status != "cancelled")
                        .Select(r => r.EventId)
                        .ToListAsync()).ToHashSet()
                    : new System.Collections.Generic.HashSet<long>();

                var result = events.Select(e => new
                {
                    e.Id,
                    e.TenantId,
                    e.Title,
                    e.Description,
                    e.Category,
                    e.Location,
                    e.CoverImageUrl,
                    e.StartAtUtc,
                    e.EndAtUtc,
                    e.IsPublic,
                    e.RequiresRsvp,
                    e.Capacity,
                    e.Status,
                    RsvpCount = countMap.TryGetValue(e.Id, out var c) ? c : 0,
                    IsFull = e.Capacity.HasValue && (countMap.TryGetValue(e.Id, out var c2) ? c2 : 0) >= e.Capacity.Value,
                    IHaveRsvped = myRsvpEventIds.Contains(e.Id),
                    AttachmentCount = attachmentCountMap.TryGetValue(e.Id, out var ac) ? ac : 0,
                });

                return Ok(result);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to load events");
                return StatusCode(500, "Error loading events.");
            }
        }

        [HttpGet("{id:long}")]
        public async Task<IActionResult> Get(long id)
        {
            try
            {
                var tenantId = await GetCurrentTenantIdAsync();
                var ev = await _db.Events.AsNoTracking().FirstOrDefaultAsync(e => e.Id == id && e.TenantId == tenantId);
                if (ev == null) return NotFound();
                if (!ev.IsPublic && !User.IsInRole("admin")) return NotFound();
                return Ok(ev);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to load event {Id}", id);
                return StatusCode(500, "Error loading event.");
            }
        }

        [HttpPost]
        [Authorize(Roles = "admin,staff")]
        public async Task<IActionResult> Create([FromBody] EventCreateDto dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.Title)) return BadRequest("Title is required.");
            if (dto.StartAtUtc == default) return BadRequest("StartAtUtc is required.");

            var entity = new EventItem
            {
                TenantId = await GetCurrentTenantIdAsync(),
                Title = dto.Title.Trim(),
                Description = dto.Description,
                Category = dto.Category,
                Location = dto.Location,
                CoverImageUrl = dto.CoverImageUrl,
                StartAtUtc = dto.StartAtUtc,
                EndAtUtc = dto.EndAtUtc,
                IsPublic = dto.IsPublic,
                RequiresRsvp = dto.RequiresRsvp,
                Capacity = dto.Capacity,
                Status = "scheduled",
                CreatedByUserId = CurrentUserId(),
                CreatedAtUtc = DateTime.UtcNow,
                UpdatedAtUtc = DateTime.UtcNow,
            };

            _db.Events.Add(entity);
            await _db.SaveChangesAsync();
            _logger.LogInformation("Event {Id} created", entity.Id);
            return CreatedAtAction(nameof(Get), new { id = entity.Id }, entity);
        }

        [HttpPut("{id:long}")]
        [Authorize(Roles = "admin,staff")]
        public async Task<IActionResult> Update(long id, [FromBody] EventCreateDto dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.Title)) return BadRequest("Title is required.");

            var tenantId = await GetCurrentTenantIdAsync();
            var ev = await _db.Events.FirstOrDefaultAsync(e => e.Id == id && e.TenantId == tenantId);
            if (ev == null) return NotFound();

            ev.Title = dto.Title.Trim();
            ev.Description = dto.Description;
            ev.Category = dto.Category;
            ev.Location = dto.Location;
            ev.CoverImageUrl = dto.CoverImageUrl;
            ev.StartAtUtc = dto.StartAtUtc;
            ev.EndAtUtc = dto.EndAtUtc;
            ev.IsPublic = dto.IsPublic;
            ev.RequiresRsvp = dto.RequiresRsvp;
            ev.Capacity = dto.Capacity;
            ev.UpdatedAtUtc = DateTime.UtcNow;

            await _db.SaveChangesAsync();
            return Ok(ev);
        }

        [HttpPatch("{id:long}/status")]
        [Authorize(Roles = "admin,staff")]
        public async Task<IActionResult> UpdateStatus(long id, [FromBody] EventStatusDto dto)
        {
            var allowed = new[] { "scheduled", "cancelled", "completed" };
            if (dto == null || !allowed.Contains(dto.Status)) return BadRequest("Invalid status.");

            var tenantId = await GetCurrentTenantIdAsync();
            var ev = await _db.Events.FirstOrDefaultAsync(e => e.Id == id && e.TenantId == tenantId);
            if (ev == null) return NotFound();

            ev.Status = dto.Status;
            ev.UpdatedAtUtc = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            return Ok(ev);
        }

        [HttpDelete("{id:long}")]
        [Authorize(Roles = "admin")]
        public async Task<IActionResult> Delete(long id)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var ev = await _db.Events.FirstOrDefaultAsync(e => e.Id == id && e.TenantId == tenantId);
            if (ev == null) return NotFound();

            _db.Events.Remove(ev);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        // -------- RSVP --------

        [HttpGet("{id:long}/rsvps")]
        [Authorize(Roles = "admin,staff")]
        public async Task<IActionResult> GetRsvps(long id)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var rsvps = await _db.EventRsvps.AsNoTracking()
                .Where(r => r.EventId == id && r.TenantId == tenantId)
                .OrderBy(r => r.CreatedAtUtc)
                .ToListAsync();
            return Ok(rsvps);
        }

        [HttpPost("{id:long}/rsvp")]
        [Authorize]
        public async Task<IActionResult> Rsvp(long id, [FromBody] EventRsvpDto? dto)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var ev = await _db.Events.FirstOrDefaultAsync(e => e.Id == id && e.TenantId == tenantId);
            if (ev == null) return NotFound();
            if (ev.Status != "scheduled") return BadRequest("This event is not accepting RSVPs.");

            var userId = CurrentUserId();
            if (userId == null) return Unauthorized();

            var existing = await _db.EventRsvps.FirstOrDefaultAsync(r => r.EventId == id && r.UserId == userId);
            var partySize = Math.Max(1, dto?.PartySize ?? 1);

            if (existing != null)
            {
                existing.Status = "confirmed";
                existing.PartySize = partySize;
                await _db.SaveChangesAsync();
                return Ok(existing);
            }

            if (ev.Capacity.HasValue)
            {
                var currentCount = await _db.EventRsvps.Where(r => r.EventId == id && r.Status != "cancelled").SumAsync(r => r.PartySize);
                if (currentCount + partySize > ev.Capacity.Value)
                {
                    var waitlisted = new EventRsvp
                    {
                        TenantId = tenantId,
                        EventId = id,
                        UserId = userId,
                        PartySize = partySize,
                        Status = "waitlisted",
                        CreatedAtUtc = DateTime.UtcNow,
                    };
                    _db.EventRsvps.Add(waitlisted);
                    await _db.SaveChangesAsync();
                    return Ok(waitlisted);
                }
            }

            var rsvp = new EventRsvp
            {
                TenantId = tenantId,
                EventId = id,
                UserId = userId,
                PartySize = partySize,
                Status = "confirmed",
                CreatedAtUtc = DateTime.UtcNow,
            };
            _db.EventRsvps.Add(rsvp);
            await _db.SaveChangesAsync();
            return Ok(rsvp);
        }

        [HttpDelete("{id:long}/rsvp")]
        [Authorize]
        public async Task<IActionResult> CancelRsvp(long id)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var userId = CurrentUserId();
            if (userId == null) return Unauthorized();

            var rsvp = await _db.EventRsvps.FirstOrDefaultAsync(r => r.EventId == id && r.TenantId == tenantId && r.UserId == userId);
            if (rsvp == null) return NotFound();

            rsvp.Status = "cancelled";
            await _db.SaveChangesAsync();
            return NoContent();
        }

        // -------- Attachments --------
        // The file itself is uploaded via POST /api/uploads?purpose=events first; this just
        // records the resulting URL against the event. Images, documents, and video clips
        // are all allowed - UploadsController.AllowedContentTypes already covers them.

        [HttpGet("{id:long}/attachments")]
        public async Task<IActionResult> GetAttachments(long id)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var ev = await _db.Events.AsNoTracking().FirstOrDefaultAsync(e => e.Id == id && e.TenantId == tenantId);
            if (ev == null) return NotFound();
            if (!ev.IsPublic && !User.IsInRole("admin") && !User.IsInRole("staff")) return NotFound();

            var attachments = await _db.EventAttachments.AsNoTracking()
                .Where(a => a.EventId == id && a.TenantId == tenantId)
                .OrderBy(a => a.CreatedAtUtc)
                .ToListAsync();
            return Ok(attachments);
        }

        [HttpPost("{id:long}/attachments")]
        [Authorize(Roles = "admin,staff")]
        public async Task<IActionResult> AddAttachment(long id, [FromBody] EventAttachmentDto dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.FileUrl) || string.IsNullOrWhiteSpace(dto.FileName))
                return BadRequest("fileUrl and fileName are required.");

            var tenantId = await GetCurrentTenantIdAsync();
            var ev = await _db.Events.AsNoTracking().FirstOrDefaultAsync(e => e.Id == id && e.TenantId == tenantId);
            if (ev == null) return NotFound();

            var attachment = new EventAttachment
            {
                TenantId = tenantId,
                EventId = id,
                FileName = dto.FileName.Trim(),
                FileUrl = dto.FileUrl.Trim(),
                ContentType = dto.ContentType?.Trim() ?? "application/octet-stream",
                FileSizeBytes = dto.FileSizeBytes,
                UploadedByUserId = CurrentUserId(),
                CreatedAtUtc = DateTime.UtcNow,
            };
            _db.EventAttachments.Add(attachment);
            await _db.SaveChangesAsync();
            return Ok(attachment);
        }

        [HttpDelete("{id:long}/attachments/{attachmentId:long}")]
        [Authorize(Roles = "admin,staff")]
        public async Task<IActionResult> DeleteAttachment(long id, long attachmentId)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var attachment = await _db.EventAttachments
                .FirstOrDefaultAsync(a => a.Id == attachmentId && a.EventId == id && a.TenantId == tenantId);
            if (attachment == null) return NotFound();

            _db.EventAttachments.Remove(attachment);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        public class EventCreateDto
        {
            public string Title { get; set; } = "";
            public string? Description { get; set; }
            public string? Category { get; set; }
            public string? Location { get; set; }
            public string? CoverImageUrl { get; set; }
            public DateTime StartAtUtc { get; set; }
            public DateTime? EndAtUtc { get; set; }
            public bool IsPublic { get; set; } = true;
            public bool RequiresRsvp { get; set; } = false;
            public int? Capacity { get; set; }
        }

        public class EventStatusDto
        {
            public string Status { get; set; } = "";
        }

        public class EventRsvpDto
        {
            public int PartySize { get; set; } = 1;
        }

        public class EventAttachmentDto
        {
            public string FileName { get; set; } = "";
            public string FileUrl { get; set; } = "";
            public string? ContentType { get; set; }
            public long? FileSizeBytes { get; set; }
        }
    }
}
