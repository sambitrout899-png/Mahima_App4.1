using Mahima.Api.v3.clean.Data;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Dtos;
using Mahima.Api.v3.clean.Models;                  // Candidate / CounsellingCase / CounsellingSession
using Mahima.Api.v3.clean.Models.Counselling;      // CounsellingSessionStatus (enum)
using Mahima.Api.v3.clean.Services;
using Microsoft.EntityFrameworkCore;

namespace Mahima.Api.v3.clean.services.Counselling
{
    public interface ICounsellingService
    {
        Task<CounsellingSessionSummaryDto> CreateRequestAsync(
            CreateCounsellingRequestDto dto,
            CancellationToken ct = default);

        Task<IReadOnlyList<CounsellingSessionSummaryDto>> GetSessionsAsync(
            string? status,
            CancellationToken ct = default);

        Task<CounsellingSessionSummaryDto> ScheduleSessionAsync(
            Guid sessionId,
            ScheduleSessionDto dto,
            CancellationToken ct = default);

        Task CompleteSessionAsync(
            Guid sessionId,
            CompleteSessionDto dto,
            CancellationToken ct = default);

        Task DeleteSessionAsync(
            Guid sessionId,
            CancellationToken ct = default);
    }

    public class CounsellingService : ICounsellingService
    {
        private readonly MahimaDbContext _db;
        private readonly ITenantContextService _tenantContext;
        private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");

        public CounsellingService(MahimaDbContext db, ITenantContextService tenantContext)
        {
            _db = db;
            _tenantContext = tenantContext;
        }

        private async Task<Guid> GetCurrentTenantIdAsync()
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync();
            return tenant?.Id ?? RootTenantId;
        }

        // Helper: convert nullable DateTime to UTC Kind
        private static DateTime ToUtc(DateTime dt)
        {
            return dt.Kind switch
            {
                DateTimeKind.Utc => dt,
                DateTimeKind.Local => dt.ToUniversalTime(),
                _ => DateTime.SpecifyKind(dt, DateTimeKind.Utc)
            };
        }

        /// <summary>
        /// Step 1 – create candidate, case and initial "Requested" session.
        /// </summary>
        public async Task<CounsellingSessionSummaryDto> CreateRequestAsync(
            CreateCounsellingRequestDto dto,
            CancellationToken ct = default)
        {
            var now = DateTime.UtcNow;
            var tenantId = await GetCurrentTenantIdAsync();

            // 1) Find or create candidate (by phone + name)
            var candidate = await _db.Candidates
                .FirstOrDefaultAsync(
                    c => c.TenantId == tenantId && c.Phone == dto.Phone && c.FullName == dto.FullName,
                    ct);

            if (candidate == null)
            {
                candidate = new Candidate
                {
                    TenantId = tenantId,
                    FullName = dto.FullName,
                    Email = dto.Email,
                    Phone = dto.Phone,
                    IsChurchMember = dto.IsChurchMember,
                    MemberId = dto.MemberId,
                    CreatedAt = now
                };

                _db.Candidates.Add(candidate);
                await _db.SaveChangesAsync(ct);
            }

            // 2) New case – let EF handle keys/FKs
            var caseEntity = new CounsellingCase
            {
                Candidate = candidate,
                IssueCategory = dto.IssueCategory,
                Description = dto.Description
            };

            _db.CounsellingCases.Add(caseEntity);
            await _db.SaveChangesAsync(ct);

            // 3) Initial session – explicitly set status using enum name if it exists
            var session = new CounsellingSession
            {
                Case = caseEntity,
                CreatedAt = now
            };

            if (Enum.TryParse<CounsellingSessionStatus>("Requested", true, out var requested))
            {
                session.Status = requested;
            }

            _db.CounsellingSessions.Add(session);
            await _db.SaveChangesAsync(ct);

            return Map(session);
        }

        /// <summary>
        /// Step 1–4: list sessions by status (Requested/Scheduled/Completed).
        /// </summary>
        public async Task<IReadOnlyList<CounsellingSessionSummaryDto>> GetSessionsAsync(
            string? status,
            CancellationToken ct = default)
        {
            IQueryable<CounsellingSession> q = _db.CounsellingSessions
                .AsNoTracking()
                .Include(s => s.Case)
                .ThenInclude(c => c.Candidate);
            var tenantId = await GetCurrentTenantIdAsync();
            q = q.Where(s => s.Case.Candidate.TenantId == tenantId);

            if (TryNormalizeStatus(status, out var parsedStatus))
            {
                q = q.Where(s => s.Status == parsedStatus);
            }

            var sessions = await q
                .OrderByDescending(s => s.CreatedAt)
                .Take(200)
                .ToListAsync(ct);

            return sessions.Select(Map).ToList();
        }

        /// <summary>
        /// Step 2 – schedule requested session and generate a token.
        /// </summary>
        public async Task<CounsellingSessionSummaryDto> ScheduleSessionAsync(
            Guid sessionId,
            ScheduleSessionDto dto,
            CancellationToken ct = default)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var session = await _db.CounsellingSessions
                .Include(s => s.Case)
                .ThenInclude(c => c.Candidate)
                .FirstOrDefaultAsync(s => s.Id == sessionId && s.Case.Candidate.TenantId == tenantId, ct);

            if (session == null)
            {
                throw new InvalidOperationException($"Session {sessionId} not found.");
            }

            // ensure UTC before saving to timestamptz
            session.ScheduledAt = ToUtc(dto.ScheduledAt);
            session.Location = dto.Location;

            // Convert string counselorId to Guid? if present
            if (!string.IsNullOrWhiteSpace(dto.CounselorId) &&
                Guid.TryParse(dto.CounselorId, out var parsedCounselorId))
            {
                session.CounselorId = parsedCounselorId;
            }
            else
            {
                session.CounselorId = null;
            }

            if (Enum.TryParse<CounsellingSessionStatus>("Scheduled", true, out var scheduled))
            {
                session.Status = scheduled;
            }

            // 🔑 SHORT TOKEN – safely below varchar(50)
            // Example: C-ABC12345-20251128
            var shortId = session.Id.ToString("N").Substring(0, 8); // 8 chars
            session.TokenNumber = $"C-{shortId}-{DateTime.UtcNow:yyyyMMdd}";

            await _db.SaveChangesAsync(ct);

            return Map(session);
        }

        /// <summary>
        /// Step 3/4 – mark session completed and optionally create a follow-up.
        /// </summary>
        public async Task CompleteSessionAsync(
            Guid sessionId,
            CompleteSessionDto dto,
            CancellationToken ct = default)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var session = await _db.CounsellingSessions
                .Include(s => s.Case)
                .FirstOrDefaultAsync(s => s.Id == sessionId && s.Case.Candidate.TenantId == tenantId, ct);

            if (session == null)
            {
                throw new InvalidOperationException($"Session {sessionId} not found.");
            }

            var now = DateTime.UtcNow;
            var outcome = dto.Outcome?.Trim() ?? "Resolved";

            if (Enum.TryParse<CounsellingSessionStatus>("Completed", true, out var completed))
            {
                session.Status = completed;
            }

            session.CompletedAt = now;
            session.Notes = dto.Notes;

            var caseEntity = session.Case;

            // Follow-up logic: if outcome indicates it, create another scheduled session
            var needsFollowup =
                string.Equals(outcome, "NeedsFurtherPrayer", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(outcome, "EscalateToSeniorPastor", StringComparison.OrdinalIgnoreCase);

            if (needsFollowup &&
                dto.NextScheduledAt.HasValue &&
                !string.IsNullOrWhiteSpace(dto.NextLocation))
            {
                var followSession = new CounsellingSession
                {
                    Case = caseEntity,
                    ScheduledAt = ToUtc(dto.NextScheduledAt.Value),
                    Location = dto.NextLocation,
                    CreatedAt = now
                };

                if (Enum.TryParse<CounsellingSessionStatus>("Scheduled", true, out var scheduled))
                {
                    followSession.Status = scheduled;
                }

                _db.CounsellingSessions.Add(followSession);
            }

            await _db.SaveChangesAsync(ct);
        }
        public async Task DeleteSessionAsync(
            Guid sessionId,
            CancellationToken ct = default)
        {
            var tenantId = await GetCurrentTenantIdAsync();
            var session = await _db.CounsellingSessions
                .Include(s => s.Case)
                .ThenInclude(c => c.Candidate)
                .FirstOrDefaultAsync(s => s.Id == sessionId && s.Case.Candidate.TenantId == tenantId, ct);

            if (session == null)
                throw new InvalidOperationException($"Session {sessionId} not found.");

            _db.CounsellingSessions.Remove(session);
            await _db.SaveChangesAsync(ct);
        }

        private static bool TryNormalizeStatus(string? status, out CounsellingSessionStatus parsed)
        {
            parsed = default;
            if (string.IsNullOrWhiteSpace(status))
                return false;

            return Enum.TryParse(status.Trim(), true, out parsed);
        }

        private static CounsellingSessionSummaryDto Map(CounsellingSession session)
        {
            return new CounsellingSessionSummaryDto
            {
                SessionId = session.Id,
                CandidateName = session.Case?.Candidate?.FullName ?? string.Empty,
                IssueCategory = session.Case?.IssueCategory,
                SessionType = session.SessionType.ToString(),
                Status = session.Status.ToString(),
                ScheduledAt = session.ScheduledAt,
                TokenNumber = session.TokenNumber
            };
        }
    }
}
