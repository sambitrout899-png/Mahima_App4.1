using System;

namespace Mahima.Api.v3.clean.Models
{
    public class TenantBranding
    {
        public Guid TenantId { get; set; }
        public string? LogoUrl { get; set; }
        public string PrimaryColor { get; set; } = "#0f766e";
        public string AccentColor { get; set; } = "#f59e0b";
        public string NeutralColor { get; set; } = "#f8fafc";
        public string DarkColor { get; set; } = "#0f172a";
        public string HeadingFont { get; set; } = "Inter";
        public string BodyFont { get; set; } = "Inter";
        public string? ContactEmail { get; set; }
        public string? ContactPhone { get; set; }
        public string? Address { get; set; }
        public string SocialLinksJson { get; set; } = "[]";
        public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;

        public Tenant? Tenant { get; set; }
    }
}
