using System;

namespace Mahima.Api.v3.clean.Models
{
    /// <summary>Worship/service run-sheet for a service date: an ordered list of ServicePlanItems.</summary>
    public class ServicePlan
    {
        public long Id { get; set; }
        public Guid TenantId { get; set; }
        public string Title { get; set; } = "";
        public DateTime ServiceDate { get; set; }
        public long? SermonId { get; set; }
        public string? Notes { get; set; }
        public Guid? CreatedByUserId { get; set; }
        public DateTime CreatedAtUtc { get; set; }
        public DateTime UpdatedAtUtc { get; set; }
    }

    public class ServicePlanItem
    {
        public long Id { get; set; }
        public Guid TenantId { get; set; }
        public long ServicePlanId { get; set; }
        public int OrderIndex { get; set; }
        public string ItemType { get; set; } = "song"; // song | announcement | sermon | prayer | offering | other
        public string Title { get; set; } = "";
        public string? Details { get; set; }
        public Guid? AssignedUserId { get; set; }
        public int? DurationMinutes { get; set; }
    }
}
