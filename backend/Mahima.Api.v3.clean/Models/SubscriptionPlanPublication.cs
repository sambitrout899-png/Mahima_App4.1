using System;

namespace Mahima.Api.v3.clean.Models
{
    public class SubscriptionPlanPublication
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public Guid PlanId { get; set; }
        public int Version { get; set; }
        public string DefinitionJson { get; set; } = "{}";
        public DateTime EffectiveAtUtc { get; set; }
        public DateTime PublishedAtUtc { get; set; } = DateTime.UtcNow;
        public DateTime? ExpiredAtUtc { get; set; }
        public Guid? PublishedByUserId { get; set; }
        public SubscriptionPlan? Plan { get; set; }
    }
}
