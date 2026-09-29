using System;
using System.Threading.Tasks;

namespace Mahima.Api.v3.clean.Services
{
    /// <summary>Everything the appointment letter PDF needs - user-level data plus the
    /// admin-provided employment details that aren't modeled anywhere else in the app.</summary>
    public class AppointmentLetterRequest
    {
        public Guid TenantId { get; set; }
        public Guid UserId { get; set; }
        public string FullName { get; set; } = "";
        public string? UserCode { get; set; }
        public DateTime JoinDate { get; set; }

        // The user's assigned Role from the Users module (e.g. "Pastor", "Staff") -
        // used as the letter's Role/Designation line instead of free-text input.
        public string? RoleName { get; set; }
        public string? Department { get; set; }

        // Resolved display name (+ position, if any) of the reporting manager chosen
        // from the position-hierarchy dropdown - never free text.
        public string? ReportingManager { get; set; }
        public DateTime AppointmentDate { get; set; }
        public string? AdditionalTerms { get; set; }

        // Pulled from StaffPayrollSettings for this user, if any.
        public decimal? MonthlyFixedAmount { get; set; }
        public decimal? HourlyRate { get; set; }
        public decimal? Allowances { get; set; }
        public decimal? Deductions { get; set; }
        public int? WeeklyOffDay { get; set; }
    }

    public interface IAppointmentLetterService
    {
        /// <summary>
        /// Generates an appointment letter PDF for the given user, saves it under a private,
        /// tenant-scoped, non-web-exposed directory, and returns a relative path
        /// (e.g. "{tenantId}/AppointmentLetter_{userId}_20260929120000.pdf") for
        /// UsersController's authenticated, tenant-checked download endpoint to resolve -
        /// never a public URL.
        /// </summary>
        Task<string> GenerateAsync(AppointmentLetterRequest request);
    }
}
