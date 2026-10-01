using System;

namespace Mahima.Api.v3.clean.Models
{
    public class TenantSubscription
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid TenantId { get; set; }
        public Guid PlanId { get; set; }
        public int AppliedPlanVersion { get; set; }
        public string Status { get; set; } = "active";
        public DateTime StartsAtUtc { get; set; } = DateTime.UtcNow;
        public DateTime? EndsAtUtc { get; set; }
        public DateTime? TrialEndsAtUtc { get; set; }
        public DateTime? ContractEndsAtUtc { get; set; }
        public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;

        public Tenant? Tenant { get; set; }
        public SubscriptionPlan? Plan { get; set; }
    }
}
