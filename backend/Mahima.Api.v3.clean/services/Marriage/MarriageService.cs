using Mahima.Api.v3.clean.Data;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Dtos;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Models.Marriage;
using Mahima.Api.v3.clean.Services;
using Microsoft.EntityFrameworkCore;

namespace Mahima.Api.v3.clean.services.Marriage
{
    public interface IMarriageService
    {
        Task<MarriageApplicationSummaryDto> CreateAsync(
            CreateMarriageApplicationDto dto,
            CancellationToken ct = default);

        Task<IReadOnlyList<MarriageApplicationSummaryDto>> GetAsync(
            string? status,
            CancellationToken ct = default);

        Task<MarriageApplicationSummaryDto> ApproveAsync(
            Guid id,
            ApproveMarriageDto dto,
            string? approverUserId,
            CancellationToken ct = default);

        Task<MarriageApplicationSummaryDto> ScheduleAsync(
            Guid id,
            ScheduleMarriageDto dto,
            CancellationToken ct = default);

        Task CompleteAsync(
            Guid id,
            CompleteMarriageDto dto,
            CancellationToken ct = default);

        Task DeleteAsync(
            Guid id,
            CancellationToken ct = default);
    }

    public class MarriageService : IMarriageService
    {
        private readonly MahimaDbContext _db;
        private readonly ITenantContextService _tenantContext;
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");

        public MarriageService(MahimaDbContext db, ITenantContextService tenantContext)
        {
            _db = db;
            _tenantContext = tenantContext;
        }

        private async Task<Guid> GetCurrentTenantIdAsync()
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync();
            return tenant?.Id ?? RootTenantId;
        }

        private static DateTime ToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        public async Task<MarriageApplicationSummaryDto> CreateAsync(
            CreateMarriageApplicationDto dto,
            CancellationToken ct = default)
        {
            var now = DateTime.UtcNow;
            var tenantId = await GetCurrentTenantIdAsync();

            var entity = new MarriageApplication
            {
                Id = Guid.NewGuid(),
                TenantId = tenantId,
                GroomFullName = dto.GroomFullName,
                BrideFullName = dto.BrideFullName,
                GroomPhone = dto.GroomPhone,
                BridePhone = dto.BridePhone,
                GroomEmail = dto.GroomEmail,
                BrideEmail = dto.BrideEmail,
                Address = dto.Address,
                GroomIsMember = dto.GroomIsMember,
                BrideIsMember = dto.BrideIsMember,
                GroomMemberId = dto.GroomMemberId,
                BrideMemberId = dto.BrideMemberId,
                PreferredDate = dto.PreferredDate.HasValue ? ToUtc(dto.PreferredDate.Value) : null,
                PreferredService = dto.PreferredService,
                Status = MarriageApplicationStatuses.PendingReview,
                CreatedAt = now,
                UpdatedAt = now
            };

            _db.MarriageApplications.Add(entity);
            await _db.SaveChangesAsync(ct);

            return Map(entity);
        }

        public async Task<IReadOnlyList<MarriageApplicationSummaryDto>> GetAsync(
            string? status,
            CancellationToken ct = default)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            IQueryable<MarriageApplication> q = _db.MarriageApplications.AsNoTracking()
                .Where(m => m.TenantId == tenantId);
            var statusAliases = NormalizeStatusAliases(status);

            if (statusAliases.Count > 0)
            {
                q = q.Where(m => statusAliases.Contains(m.Status));
            }

            var list = await q
                .OrderByDescending(m => m.CreatedAt)
                .Take(200)
                .ToListAsync(ct);

            return list.Select(Map).ToList();
        }

        private static IReadOnlyList<string> NormalizeStatusAliases(string? status)
        {
            if (string.IsNullOrWhiteSpace(status)) return Array.Empty<string>();

            var key = status.Trim().Replace(" ", "", StringComparison.Ordinal).ToLowerInvariant();
            return key switch
            {
                "all" or "any" => Array.Empty<string>(),
                "new" or "pending" or "pendingreview" => new[] { MarriageApplicationStatuses.PendingReview, "Pending", "New" },
                "approved" => new[] { MarriageApplicationStatuses.Approved },
                "scheduled" => new[] { MarriageApplicationStatuses.Scheduled },
                "completed" or "complete" => new[] { MarriageApplicationStatuses.Completed, "Closed" },
                "rejected" => new[] { MarriageApplicationStatuses.Rejected },
                _ => new[] { status.Trim() }
            };
        }

        public async Task<MarriageApplicationSummaryDto> ApproveAsync(
            Guid id,
            ApproveMarriageDto dto,
            string? approverUserId,
            CancellationToken ct = default)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var entity = await _db.MarriageApplications
                .FirstOrDefaultAsync(m => m.Id == id && m.TenantId == tenantId, ct);

            if (entity == null)
                throw new InvalidOperationException($"Application {id} not found.");

            entity.Status = MarriageApplicationStatuses.Approved;
            entity.ApprovedAt = DateTime.UtcNow;
            entity.ApprovedByUserId = approverUserId;
            entity.Notes = dto.Notes;
            entity.UpdatedAt = DateTime.UtcNow;

            // Short printable token, safe under varchar(50)
            var shortId = entity.Id.ToString("N").Substring(0, 8);
            entity.Token = $"M-{shortId}-{DateTime.UtcNow:yyyyMMdd}";

            await _db.SaveChangesAsync(ct);
            return Map(entity);
        }

        public async Task<MarriageApplicationSummaryDto> ScheduleAsync(
            Guid id,
            ScheduleMarriageDto dto,
            CancellationToken ct = default)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var entity = await _db.MarriageApplications
                .FirstOrDefaultAsync(m => m.Id == id && m.TenantId == tenantId, ct);

            if (entity == null)
                throw new InvalidOperationException($"Application {id} not found.");

            entity.ScheduledAt = ToUtc(dto.ScheduledAt);
            entity.CeremonyLocation = dto.CeremonyLocation;
            entity.Status = MarriageApplicationStatuses.Scheduled;
            entity.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);
            return Map(entity);
        }

        public async Task CompleteAsync(
            Guid id,
            CompleteMarriageDto dto,
            CancellationToken ct = default)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var entity = await _db.MarriageApplications
                .FirstOrDefaultAsync(m => m.Id == id && m.TenantId == tenantId, ct);

            if (entity == null)
                throw new InvalidOperationException($"Application {id} not found.");

            entity.Status = MarriageApplicationStatuses.Completed;
            entity.CompletedAt = DateTime.UtcNow;
            entity.Notes = string.IsNullOrWhiteSpace(dto.Notes)
                ? entity.Notes
                : dto.Notes;
            entity.UpdatedAt = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);
        }

        public async Task DeleteAsync(
            Guid id,
            CancellationToken ct = default)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var entity = await _db.MarriageApplications
                .FirstOrDefaultAsync(m => m.Id == id && m.TenantId == tenantId, ct);

            if (entity == null)
                throw new InvalidOperationException($"Application {id} not found.");

            _db.MarriageApplications.Remove(entity);
            await _db.SaveChangesAsync(ct);
        }

        private static MarriageApplicationSummaryDto Map(MarriageApplication m)
        {
            return new MarriageApplicationSummaryDto
            {
                Id = m.Id,
                GroomFullName = m.GroomFullName,
                BrideFullName = m.BrideFullName,
                GroomPhone = m.GroomPhone,
                BridePhone = m.BridePhone,
                GroomEmail = m.GroomEmail,
                BrideEmail = m.BrideEmail,
                Address = m.Address,
                GroomIsMember = m.GroomIsMember,
                BrideIsMember = m.BrideIsMember,
                GroomMemberId = m.GroomMemberId,
                BrideMemberId = m.BrideMemberId,
                Status = m.Status,
                PreferredDate = m.PreferredDate,
                PreferredService = m.PreferredService,
                ScheduledAt = m.ScheduledAt,
                CeremonyLocation = m.CeremonyLocation,
                Token = m.Token,
                Notes = m.Notes,
                CreatedAt = m.CreatedAt,
                UpdatedAt = m.UpdatedAt,
                ApprovedAt = m.ApprovedAt,
                CompletedAt = m.CompletedAt
            };
        }
    }
}
