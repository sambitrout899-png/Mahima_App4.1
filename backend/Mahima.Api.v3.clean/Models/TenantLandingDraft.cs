using System;

namespace Mahima.Api.v3.clean.Models
{
    public class TenantLandingDraft
    {
        public Guid TenantId { get; set; }
        public string HeroTitle { get; set; } = "Welcome";
        public string? HeroSubtitle { get; set; }
        public string? HeroImageUrl { get; set; }
        public string HeroLayout { get; set; } = "split-card";
        public string ServiceTimesJson { get; set; } = "[]";
        public string SectionsJson { get; set; } = "[]";
        public string? SeoTitle { get; set; }
        public string? SeoDescription { get; set; }
        public string? OgImageUrl { get; set; }
        public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
        public Guid? UpdatedByUserId { get; set; }

        public Tenant? Tenant { get; set; }
    }
}
