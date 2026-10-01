using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Dtos;
using Mahima.Api.v3.clean.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Mahima.Api.v3.clean.Services;
using System.Text.RegularExpressions;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Controllers
{
    /// <summary>
    /// Admin-managed language list used by:
    ///   - the UI LanguageContext (for the language switcher and translations dictionary)
    ///   - the message pipeline (which languages to auto-translate broadcasts into)
    ///   - the user profile (which languages the user can pick as preferred)
    ///
    /// Public endpoint:  GET /api/languages           -> enabled list, no auth required
    /// Admin endpoints:  GET/POST/PUT/DELETE /api/admin/languages
    /// </summary>
    [ApiController]
    public class AdminLanguagesController : ControllerBase
    {
        private readonly MahimaDbContext _db;
        private readonly ILogger<AdminLanguagesController> _logger;
        private readonly ITenantContextService _tenantContext;
        private static readonly Regex ValidCode = new("^[a-z]{2,3}(?:-[a-z0-9]{2,4})?$", RegexOptions.Compiled);

        public AdminLanguagesController(MahimaDbContext db, ILogger<AdminLanguagesController> logger, ITenantContextService tenantContext)
        {
            _db = db;
            _logger = logger;
            _tenantContext = tenantContext;
        }

        // -----------------------------------------------------------------
        // PUBLIC: list enabled languages (for app boot / language switcher)
        // -----------------------------------------------------------------
        [AllowAnonymous]
        [HttpGet("/api/languages")]
        public async Task<IActionResult> ListEnabled()
        {
            var items = await _db.AppLanguages
                .AsNoTracking()
                .Where(l => l.Enabled)
                .OrderBy(l => l.DisplayOrder)
                .ThenBy(l => l.Name)
                .Select(l => Map(l))
                .ToListAsync();
            return Ok(items);
        }

        // -----------------------------------------------------------------
        // ADMIN: list all languages (including disabled)
        // -----------------------------------------------------------------
        [Authorize(Roles = "admin,Admin")]
        [HttpGet("/api/admin/languages")]
        public async Task<IActionResult> ListAll()
        {
            if (!await IsRootAdminAsync()) return Forbid();
            var items = await _db.AppLanguages
                .AsNoTracking()
                .OrderBy(l => l.DisplayOrder)
                .ThenBy(l => l.Name)
                .Select(l => Map(l))
                .ToListAsync();
            return Ok(items);
        }

        // -----------------------------------------------------------------
        // ADMIN: create
        // -----------------------------------------------------------------
        [Authorize(Roles = "admin,Admin")]
        [HttpPost("/api/admin/languages")]
        public async Task<IActionResult> Create([FromBody] CreateAppLanguageDto dto)
        {
            if (!await IsRootAdminAsync()) return Forbid();
            if (dto == null) return BadRequest("Payload required.");
            var code = (dto.Code ?? string.Empty).Trim().ToLowerInvariant();
            if (!ValidCode.IsMatch(code)) return BadRequest("Use a valid ISO language code such as en, hi, or pt-br.");
            if (string.IsNullOrWhiteSpace(dto.Name)) return BadRequest("Name is required.");
            if (string.IsNullOrWhiteSpace(dto.NativeName)) return BadRequest("Native name is required.");

            if (await _db.AppLanguages.AnyAsync(l => l.Code == code))
                return Conflict($"Language '{code}' already exists.");

            var mustBeDefault = dto.IsDefault || !await _db.AppLanguages.AnyAsync();
            if (mustBeDefault && !dto.Enabled)
                return BadRequest("The default language must be enabled.");

            await using var transaction = await _db.Database.BeginTransactionAsync();
            if (mustBeDefault) await ClearDefaults();

            var entity = new AppLanguage
            {
                Code         = code,
                Name         = dto.Name.Trim(),
                NativeName   = dto.NativeName.Trim(),
                Enabled      = dto.Enabled,
                IsDefault    = mustBeDefault,
                DisplayOrder = dto.DisplayOrder,
                Rtl          = dto.Rtl,
                CreatedAt    = DateTime.UtcNow,
                UpdatedAt    = DateTime.UtcNow,
            };
            _db.AppLanguages.Add(entity);
            await _db.SaveChangesAsync();
            await transaction.CommitAsync();

            _logger.LogInformation("Admin created language {Code} ({Name})", entity.Code, entity.Name);
            return CreatedAtAction(nameof(ListAll), new { code = entity.Code }, Map(entity));
        }

        // -----------------------------------------------------------------
        // ADMIN: update (partial)
        // -----------------------------------------------------------------
        [Authorize(Roles = "admin,Admin")]
        [HttpPut("/api/admin/languages/{code}")]
        public async Task<IActionResult> Update(string code, [FromBody] UpdateAppLanguageDto dto)
        {
            if (!await IsRootAdminAsync()) return Forbid();
            if (dto == null) return BadRequest("Payload required.");
            code = (code ?? string.Empty).Trim().ToLowerInvariant();

            var entity = await _db.AppLanguages.FirstOrDefaultAsync(l => l.Code == code);
            if (entity == null) return NotFound();

            await using var transaction = await _db.Database.BeginTransactionAsync();
            if (dto.IsDefault == true && !entity.IsDefault) await ClearDefaults();

            if (dto.Name         != null) entity.Name         = dto.Name.Trim();
            if (dto.NativeName   != null) entity.NativeName   = dto.NativeName.Trim();
            if (dto.Enabled      != null) entity.Enabled      = dto.Enabled.Value;
            if (dto.IsDefault    != null) entity.IsDefault    = dto.IsDefault.Value;
            if (dto.DisplayOrder != null) entity.DisplayOrder = dto.DisplayOrder.Value;
            if (dto.Rtl          != null) entity.Rtl          = dto.Rtl.Value;
            entity.UpdatedAt = DateTime.UtcNow;

            // Guard: refuse to disable the default
            if (entity.IsDefault && !entity.Enabled)
                return BadRequest("Cannot disable the default language. Set another language as default first.");

            // Guard: must always have at least one default
            if (entity.IsDefault == false)
            {
                var anyDefault = await _db.AppLanguages.AnyAsync(l => l.IsDefault && l.Code != code);
                if (!anyDefault)
                    return BadRequest("At least one language must be marked as default.");
            }

            await _db.SaveChangesAsync();
            await transaction.CommitAsync();
            return Ok(Map(entity));
        }

        // -----------------------------------------------------------------
        // ADMIN: delete
        // -----------------------------------------------------------------
        [Authorize(Roles = "admin,Admin")]
        [HttpDelete("/api/admin/languages/{code}")]
        public async Task<IActionResult> Delete(string code)
        {
            if (!await IsRootAdminAsync()) return Forbid();
            code = (code ?? string.Empty).Trim().ToLowerInvariant();
            var entity = await _db.AppLanguages.FirstOrDefaultAsync(l => l.Code == code);
            if (entity == null) return NotFound();
            if (entity.IsDefault) return BadRequest("Cannot delete the default language.");

            _db.AppLanguages.Remove(entity);
            await _db.SaveChangesAsync();
            _logger.LogInformation("Admin deleted language {Code}", code);
            return NoContent();
        }

        // -----------------------------------------------------------------
        // ADMIN: bulk reorder — accepts array of { code, displayOrder }
        // -----------------------------------------------------------------
        [Authorize(Roles = "admin,Admin")]
        [HttpPut("/api/admin/languages/reorder")]
        public async Task<IActionResult> Reorder([FromBody] List<ReorderItem> items)
        {
            if (!await IsRootAdminAsync()) return Forbid();
            if (items == null || items.Count == 0) return BadRequest("Empty payload.");
            var codes = items.Select(i => i.Code.Trim().ToLowerInvariant()).ToList();
            var entities = await _db.AppLanguages.Where(l => codes.Contains(l.Code)).ToListAsync();
            foreach (var it in items)
            {
                var e = entities.FirstOrDefault(x => x.Code == it.Code.Trim().ToLowerInvariant());
                if (e == null) continue;
                e.DisplayOrder = it.DisplayOrder;
                e.UpdatedAt    = DateTime.UtcNow;
            }
            await _db.SaveChangesAsync();
            return NoContent();
        }

        // -----------------------------------------------------------------
        // helpers
        // -----------------------------------------------------------------
        private async Task ClearDefaults()
        {
            var defaults = await _db.AppLanguages.Where(l => l.IsDefault).ToListAsync();
            foreach (var d in defaults) d.IsDefault = false;
        }

        private async Task<bool> IsRootAdminAsync()
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(HttpContext.RequestAborted);
            return tenant?.IsRootTenant == true;
        }

        private static AppLanguageDto Map(AppLanguage l) => new AppLanguageDto
        {
            Code         = l.Code,
            Name         = l.Name,
            NativeName   = l.NativeName,
            Enabled      = l.Enabled,
            IsDefault    = l.IsDefault,
            DisplayOrder = l.DisplayOrder,
            Rtl          = l.Rtl,
        };

        public class ReorderItem
        {
            public string Code { get; set; } = string.Empty;
            public int DisplayOrder { get; set; }
        }
    }
}
