// Controllers/AttendanceController.cs
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Mahima.Api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize]
    public class AttendanceController : ControllerBase
    {
        private readonly MahimaDbContext _db;
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");

        public AttendanceController(MahimaDbContext db)
        {
            _db = db;
        }

        // ---------- helpers ----------

        private Guid? GetActorId()
        {
            var id = User.FindFirstValue(ClaimTypes.NameIdentifier)
                     ?? User.FindFirst("sub")?.Value;

            if (Guid.TryParse(id, out var guid))
                return guid;

            return null;
        }

        private string? GetActorIdString() => GetActorId()?.ToString();

        private Guid GetCurrentTenantId() =>
            Guid.TryParse(User.FindFirstValue("tenant_id"), out var id)
                ? id
                : RootTenantId;

        private bool HasAnyRole(params string[] roles)
        {
            var allowed = roles
                .Where(role => !string.IsNullOrWhiteSpace(role))
                .Select(role => role.Trim().ToLowerInvariant())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            if (allowed.Count == 0)
                return false;

            if (roles.Any(role => User.IsInRole(role)))
                return true;

            var roleClaims = User.FindAll(ClaimTypes.Role)
                .Concat(User.FindAll("role"))
                .Select(c => c.Value?.Trim().ToLowerInvariant())
                .Where(v => !string.IsNullOrWhiteSpace(v));

            return roleClaims.Any(role => allowed.Contains(role!));
        }

        private bool IsAdmin() => HasAnyRole("admin", "administrator");

        private bool CanManageOthers() => HasAnyRole("admin", "administrator", "finance");

        private static readonly HashSet<string> AllowedStatuses = new(StringComparer.OrdinalIgnoreCase)
        {
            "Present", "Absent", "Half-day", "WFH", "Weekend",
            "Leave (Standard)", "Leave (Medical)", "Leave (Casual)"
        };

        private static string NormalizeStatus(string? status)
        {
            var value = status?.Trim() ?? string.Empty;
            // Preserve old records/forms while moving them to the explicit standard category.
            return value.Equals("Leave", StringComparison.OrdinalIgnoreCase) ? "Leave (Standard)" : value;
        }

        private bool IsActor(string? userId)
        {
            var actorId = GetActorIdString();
            return !string.IsNullOrWhiteSpace(actorId)
                && !string.IsNullOrWhiteSpace(userId)
                && string.Equals(actorId, userId, StringComparison.OrdinalIgnoreCase);
        }

        private void AddAudit(string action, string entityType, string entityId, object? details)
        {
            var log = new AuditLog
            {
                TenantId = GetCurrentTenantId(),
                ActorId = GetActorId(),
                Action = action,
                EntityType = entityType,
                EntityId = entityId,
                Details = details != null ? JsonSerializer.Serialize(details) : null,
                CreatedAt = DateTime.UtcNow
            };

            _db.AuditLogs.Add(log);
        }

        // ---------- GET  /api/attendance ----------
        [HttpGet]
        public async Task<ActionResult<IEnumerable<AttendanceRecord>>> Get(
            [FromQuery] DateTime? from,
            [FromQuery] DateTime? to,
            [FromQuery] string? userId)
        {
            var canManageOthers = CanManageOthers();
            var actorId = GetActorIdString();

            if (!canManageOthers)
            {
                if (string.IsNullOrWhiteSpace(actorId))
                    return Forbid();

                if (!string.IsNullOrWhiteSpace(userId) && !string.Equals(userId, actorId, StringComparison.OrdinalIgnoreCase))
                    return Forbid();

                userId = actorId;
            }

            var tenantId = GetCurrentTenantId();
            IQueryable<AttendanceRecord> query = _db.AttendanceRecords.Where(a => a.TenantId == tenantId);

            if (from.HasValue)
            {
                var f = DateTime.SpecifyKind(from.Value, DateTimeKind.Unspecified);
                query = query.Where(a => a.Date >= f);
            }

            if (to.HasValue)
            {
                var t = DateTime.SpecifyKind(to.Value, DateTimeKind.Unspecified);
                query = query.Where(a => a.Date <= t);
            }

            if (!string.IsNullOrWhiteSpace(userId))
            {
                query = query.Where(a => a.UserId == userId);
            }

            var items = await query
                .OrderByDescending(a => a.Date)
                .ToListAsync();

            return Ok(items);
        }

        // ---------- POST  /api/attendance ----------

        [HttpPost]
        public async Task<ActionResult<AttendanceRecord>> Create([FromBody] AttendanceRecord dto)
        {
            if (dto == null)
                return BadRequest("Attendance payload is required.");

            var canManageOthers = CanManageOthers();
            var actorId = GetActorIdString();

            if (string.IsNullOrWhiteSpace(dto.UserId))
                dto.UserId = actorId;

            if (string.IsNullOrWhiteSpace(dto.UserId))
                return BadRequest("UserId is required.");

            if (!canManageOthers && !IsActor(dto.UserId))
                return Forbid();

            dto.TenantId = GetCurrentTenantId();
            dto.Date = DateTime.SpecifyKind(dto.Date, DateTimeKind.Unspecified);
            dto.Status = NormalizeStatus(dto.Status);
            if (!AllowedStatuses.Contains(dto.Status))
                return BadRequest(new { message = "Choose a valid attendance or leave category." });

            var nextDate = dto.Date.Date.AddDays(1);
            var duplicate = await _db.AttendanceRecords.AnyAsync(a =>
                a.TenantId == dto.TenantId && a.UserId == dto.UserId && a.Date >= dto.Date.Date && a.Date < nextDate);
            if (duplicate)
                return Conflict(new { message = "Attendance is already marked for this staff member and date." });

            _db.AttendanceRecords.Add(dto);
            await _db.SaveChangesAsync();   // generate Id

            // AUDIT
            AddAudit(
                action: "Attendance.Create",
                entityType: "AttendanceRecord",
                entityId: dto.Id.ToString(),
                details: dto
            );
            await _db.SaveChangesAsync();

            return CreatedAtAction(nameof(GetById), new { id = dto.Id }, dto);
        }

        // ---------- GET  /api/attendance/{id} ----------
        [HttpGet("{id:int}")]
        public async Task<ActionResult<AttendanceRecord>> GetById(int id)
        {
            var tenantId = GetCurrentTenantId();
            var item = await _db.AttendanceRecords.FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenantId);
            if (item == null) return NotFound();
            if (!CanManageOthers() && !IsActor(item.UserId)) return Forbid();
            return Ok(item);
        }

        // ---------- PUT  /api/attendance/{id} ----------

        [HttpPut("{id:int}")]
        public async Task<IActionResult> Update(int id, [FromBody] AttendanceRecord dto)
        {
            var tenantId = GetCurrentTenantId();
            var existing = await _db.AttendanceRecords.FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenantId);
            if (existing == null) return NotFound();

            var canManageOthers = CanManageOthers();
            if (!canManageOthers && !IsActor(existing.UserId))
                return Forbid();

            var before = new
            {
                existing.UserId,
                existing.Date,
                existing.Status
            };

            if (canManageOthers && !string.IsNullOrWhiteSpace(dto.UserId))
                existing.UserId = dto.UserId;

            existing.Date = DateTime.SpecifyKind(dto.Date, DateTimeKind.Unspecified);
            var normalizedStatus = NormalizeStatus(dto.Status);
            if (!AllowedStatuses.Contains(normalizedStatus))
                return BadRequest(new { message = "Choose a valid attendance or leave category." });
            existing.Status = normalizedStatus;

            var after = new
            {
                existing.UserId,
                existing.Date,
                existing.Status
            };

            // AUDIT
            AddAudit(
                action: "Attendance.Update",
                entityType: "AttendanceRecord",
                entityId: id.ToString(),
                details: new { before, after }
            );

            await _db.SaveChangesAsync();
            return NoContent();
        }

        // ---------- DELETE  /api/attendance/{id} ----------

        [HttpDelete("{id:int}")]
        public async Task<IActionResult> Delete(int id)
        {
            var tenantId = GetCurrentTenantId();
            var existing = await _db.AttendanceRecords.FirstOrDefaultAsync(a => a.Id == id && a.TenantId == tenantId);
            if (existing == null) return NotFound();

            if (!CanManageOthers() && !IsActor(existing.UserId))
                return Forbid();

            var snapshot = new
            {
                existing.UserId,
                existing.Date,
                existing.Status
            };

            _db.AttendanceRecords.Remove(existing);

            // AUDIT
            AddAudit(
                action: "Attendance.Delete",
                entityType: "AttendanceRecord",
                entityId: id.ToString(),
                details: snapshot
            );

            await _db.SaveChangesAsync();
            return NoContent();
        }
    }
}
