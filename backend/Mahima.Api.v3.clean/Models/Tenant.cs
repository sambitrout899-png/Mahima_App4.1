using System;
using System.Collections.Generic;

namespace Mahima.Api.v3.clean.Models
{
    public class Tenant
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string Name { get; set; } = string.Empty;
        public string Slug { get; set; } = string.Empty;
        public string? Domain { get; set; }
        public string DomainStatus { get; set; } = "none";
        public string? DomainVerificationToken { get; set; }
        public DateTime? DomainVerifiedAtUtc { get; set; }
        public DateTime? DomainLastCheckedAtUtc { get; set; }
        public string? ContactName { get; set; }
        public string? ContactEmail { get; set; }
        public string? ContactPhone { get; set; }
        public string CountryCode { get; set; } = "IN";
        public string UserCodePrefix { get; set; } = "MHN";
        public string Status { get; set; } = "active";
        public bool IsRootTenant { get; set; }

        // Twilio Content SIDs (e.g. "HX...") for this tenant's WhatsApp template messages.
        // Falls back to Helpers.TwilioTemplateDefaults when not set.
        public string? WhatsAppUserNotificationTemplateSid { get; set; }
        public string? WhatsAppMarketingTemplateSid { get; set; }
        public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;

        public TenantLandingConfig? LandingConfig { get; set; }
        public TenantBranding? Branding { get; set; }
        public TenantLandingDraft? LandingDraft { get; set; }
        public ICollection<TenantSubscription> Subscriptions { get; set; } = new List<TenantSubscription>();
        public ICollection<TenantModuleLicense> ModuleLicenses { get; set; } = new List<TenantModuleLicense>();
    }
}
