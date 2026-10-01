using System;
using System.Collections.Generic;

namespace Mahima.Api.v3.clean.Models
{
    public class SubscriptionPlan
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Code { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public string? Description { get; set; }
        public decimal MonthlyPriceInr { get; set; }
        public bool IsBaseFreePlan { get; set; }
        public bool Enabled { get; set; } = true;
        public int DisplayOrder { get; set; }
        public string LifecycleStatus { get; set; } = "draft";
        public int ContractMonths { get; set; } = 12;
        public decimal EarlyExitPenaltyPercent { get; set; } = 10;
        public decimal StorageLimitGb { get; set; } = 10;
        public long AiTokensIncludedMonthly { get; set; }
        public decimal StorageOveragePricePerGbInr { get; set; }
        public decimal AiOveragePricePerMillionTokensInr { get; set; }
        public decimal AiCreditsIncludedInr { get; set; }
        public decimal AiOverageMarkupMultiplier { get; set; } = 2.5m;
        public int PublishedVersion { get; set; }
        public DateTime? PublishedAtUtc { get; set; }
        public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;

        public ICollection<SubscriptionPlanModule> Modules { get; set; } = new List<SubscriptionPlanModule>();
        public ICollection<SubscriptionPlanPublication> Publications { get; set; } = new List<SubscriptionPlanPublication>();
    }
}
