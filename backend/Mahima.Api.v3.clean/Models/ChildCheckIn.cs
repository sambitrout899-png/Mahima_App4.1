using System;

namespace Mahima.Api.v3.clean.Models
{
    /// <summary>Kids-ministry check-in/out record with a guardian-matching security code.</summary>
    public class ChildCheckIn
    {
        public long Id { get; set; }
        public Guid TenantId { get; set; }
        public long? EventId { get; set; }
        public string ChildName { get; set; } = "";
        public DateTime? ChildDob { get; set; }
        public string GuardianName { get; set; } = "";
        public string? GuardianPhone { get; set; }
        public Guid? GuardianUserId { get; set; }
        public string SecurityCode { get; set; } = "";
        public string? AllergyNotes { get; set; }
        public string? GeneralNotes { get; set; }
        public DateTime CheckedInAtUtc { get; set; }
        public Guid? CheckedInByUserId { get; set; }
        public DateTime? CheckedOutAtUtc { get; set; }
        public Guid? CheckedOutByUserId { get; set; }
    }
}
