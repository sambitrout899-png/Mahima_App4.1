using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Controllers
{
    /// <summary>Worship/service run-sheets: an ordered list of items (songs, sermon, prayer, etc.) per service date.</summary>
    [ApiController]
    [Route("api/service-plans")]
    [Authorize(Roles = "admin,staff,pastor")]
    public class ServicePlansController : ControllerBase
    {
        private readonly MahimaDbContext _db;
        private readonly ILogger<ServicePlansController> _logger;
        private readonly ITenantContextService _tenantContext;
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");

        public ServicePlansController(MahimaDbContext db, ILogger<ServicePlansController> logger, ITenantContextService tenantContext)
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

        [HttpGet]
        public async Task<IActionResult> GetAll([FromQuery] DateTime? from, [FromQuery] DateTime? to)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var query = _db.ServicePlans.AsNoTracking().Where(p => p.TenantId == tenantId);
            if (from.HasValue) query = query.Where(p => p.ServiceDate >= from.Value.Date);
            if (to.HasValue) query = query.Where(p => p.ServiceDate <= to.Value.Date);

            var plans = await query.OrderByDescending(p => p.ServiceDate).ToListAsync();
            return Ok(plans);
        }

        [HttpGet("{id:long}")]
        public async Task<IActionResult> Get(long id)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var plan = await _db.ServicePlans.AsNoTracking().FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
            if (plan == null) return NotFound();

            var items = await _db.ServicePlanItems.AsNoTracking()
                .Where(i => i.ServicePlanId == id && i.TenantId == tenantId)
                .OrderBy(i => i.OrderIndex)
                .ToListAsync();

            return Ok(new { plan, items });
        }

        [HttpPost]
        public async Task<IActionResult> Create([FromBody] ServicePlanCreateDto dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.Title)) return BadRequest("Title is required.");
            if (dto.ServiceDate == default) return BadRequest("ServiceDate is required.");

            var tenantId = await GetCurrentTenantIdAsync();
            var plan = new ServicePlan
            {
                TenantId = tenantId,
                Title = dto.Title.Trim(),
                ServiceDate = dto.ServiceDate.Date,
                SermonId = dto.SermonId,
                Notes = dto.Notes,
                CreatedByUserId = CurrentUserId(),
                CreatedAtUtc = DateTime.UtcNow,
                UpdatedAtUtc = DateTime.UtcNow,
            };
            _db.ServicePlans.Add(plan);
            await _db.SaveChangesAsync();

            if (dto.Items != null && dto.Items.Count > 0)
            {
                var order = 0;
                foreach (var item in dto.Items)
                {
                    _db.ServicePlanItems.Add(new ServicePlanItem
                    {
                        TenantId = tenantId,
                        ServicePlanId = plan.Id,
                        OrderIndex = order++,
                        ItemType = string.IsNullOrWhiteSpace(item.ItemType) ? "song" : item.ItemType,
                        Title = item.Title?.Trim() ?? "",
                        Details = item.Details,
                        AssignedUserId = item.AssignedUserId,
                        DurationMinutes = item.DurationMinutes,
                    });
                }
                await _db.SaveChangesAsync();
            }

            return CreatedAtAction(nameof(Get), new { id = plan.Id }, plan);
        }

        [HttpPut("{id:long}")]
        public async Task<IActionResult> Update(long id, [FromBody] ServicePlanCreateDto dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.Title)) return BadRequest("Title is required.");

            var tenantId = await GetCurrentTenantIdAsync();
            var plan = await _db.ServicePlans.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
            if (plan == null) return NotFound();

            plan.Title = dto.Title.Trim();
            plan.ServiceDate = dto.ServiceDate.Date;
            plan.SermonId = dto.SermonId;
            plan.Notes = dto.Notes;
            plan.UpdatedAtUtc = DateTime.UtcNow;

            if (dto.Items != null)
            {
                var existingItems = await _db.ServicePlanItems.Where(i => i.ServicePlanId == id).ToListAsync();
                _db.ServicePlanItems.RemoveRange(existingItems);

                var order = 0;
                foreach (var item in dto.Items)
                {
                    _db.ServicePlanItems.Add(new ServicePlanItem
                    {
                        TenantId = tenantId,
                        ServicePlanId = plan.Id,
                        OrderIndex = order++,
                        ItemType = string.IsNullOrWhiteSpace(item.ItemType) ? "song" : item.ItemType,
                        Title = item.Title?.Trim() ?? "",
                        Details = item.Details,
                        AssignedUserId = item.AssignedUserId,
                        DurationMinutes = item.DurationMinutes,
                    });
                }
            }

            await _db.SaveChangesAsync();
            return Ok(plan);
        }

        [HttpDelete("{id:long}")]
        public async Task<IActionResult> Delete(long id)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var plan = await _db.ServicePlans.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
            if (plan == null) return NotFound();

            _db.ServicePlans.Remove(plan);
            await _db.SaveChangesAsync();
            return NoContent();
        }

        public class ServicePlanItemDto
        {
            public string ItemType { get; set; } = "song";
            public string Title { get; set; } = "";
            public string? Details { get; set; }
            public Guid? AssignedUserId { get; set; }
            public int? DurationMinutes { get; set; }
        }

        public class ServicePlanCreateDto
        {
            public string Title { get; set; } = "";
            public DateTime ServiceDate { get; set; }
            public long? SermonId { get; set; }
            public string? Notes { get; set; }
            public List<ServicePlanItemDto>? Items { get; set; }
        }
    }
}
