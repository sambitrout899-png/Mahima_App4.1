using System;

namespace Mahima.Api.v3.clean.Models
{
    /// <summary>A volunteer shift slot (optionally tied to a Team/Event) accepting self-signups.</summary>
    public class VolunteerShift
    {
        public long Id { get; set; }
        public Guid TenantId { get; set; }
        public string Title { get; set; } = "";
        public string? Notes { get; set; }
        public long? TeamId { get; set; }
        public long? EventId { get; set; }
        public DateTime ShiftDate { get; set; }
        public TimeSpan? StartTime { get; set; }
        public TimeSpan? EndTime { get; set; }
        public int SlotsNeeded { get; set; } = 1;
        public Guid? CreatedByUserId { get; set; }
        public DateTime CreatedAtUtc { get; set; }
        public DateTime UpdatedAtUtc { get; set; }
    }

    public class VolunteerSignup
    {
        public long Id { get; set; }
        public Guid TenantId { get; set; }
        public long ShiftId { get; set; }
        public Guid UserId { get; set; }
        public string Status { get; set; } = "signed_up";
        public DateTime SignedUpAtUtc { get; set; }
        public DateTime? ReminderSentAtUtc { get; set; }
    }
}
