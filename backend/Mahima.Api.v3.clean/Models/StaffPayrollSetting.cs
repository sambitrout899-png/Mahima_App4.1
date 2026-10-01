// Models/StaffPayrollSetting.cs
using System;

namespace Mahima.Api.v3.clean.Models
{
    public class StaffPayrollSetting
    {
        public int Id { get; set; }
        public Guid TenantId { get; set; } = Guid.Parse("00000000-0000-0000-0000-000000000001");

        // FK to your Users / AspNetUsers table
        public string UserId { get; set; } = null!;

        // If you want pure monthly salary, set HourlyRate = 0 and use MonthlyFixedAmount.
        public decimal HourlyRate { get; set; }

        public decimal? MonthlyFixedAmount { get; set; }

        public decimal? Allowances { get; set; }

        public decimal? Deductions { get; set; }

        public bool IsActive { get; set; } = true;

	public decimal ExpectedMonthlyHours { get; set; } // e.g. 40
	public string SalaryType { get; set; } = "Fixed"; // "Fixed" or "Hourly"
        // System.DayOfWeek value (0 = Sunday ... 6 = Saturday).
        public int WeeklyOffDay { get; set; } = 0;
    }
}
