using System;

namespace Mahima.Api.v3.clean.Models
{
    public class TenantLandingConfig
    {
        public Guid TenantId { get; set; }
        // Branding fields (LogoUrl/PrimaryColor/AccentColor/ContactEmail/ContactPhone/Address/SocialLinksJson)
        // moved to TenantBranding — the shared source of truth also used by TenantPrintTemplateService.
        // Old columns are kept in the database, unused, for safe rollback; not mapped here anymore.
        public string? HeroImageUrl { get; set; }
        public string HeroTitle { get; set; } = "Welcome";
        public string? HeroSubtitle { get; set; }
        public string HeroLayout { get; set; } = "split-card";
        public string? ServiceTimesJson { get; set; }
        public string? SectionsJson { get; set; }
        public string? SeoTitle { get; set; }
        public string? SeoDescription { get; set; }
        public string? OgImageUrl { get; set; }
        public bool Published { get; set; } = true;
        public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;

        public Tenant? Tenant { get; set; }
    }
}
