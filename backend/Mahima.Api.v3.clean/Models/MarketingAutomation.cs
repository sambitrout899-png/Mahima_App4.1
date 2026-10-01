namespace Mahima.Api.v3.clean.Models;

public sealed class MarketingProspect
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string OrganizationName { get; set; } = "";
    public string? Country { get; set; }
    public string? State { get; set; }
    public string? City { get; set; }
    [System.ComponentModel.DataAnnotations.Schema.NotMapped]
    public string? IsdCode => Helpers.MarketingPhone.IsdCode(Helpers.MarketingPhone.Normalize(PublicPhone, Country) ?? Helpers.MarketingPhone.Normalize(PublicWhatsapp, Country));
    [System.ComponentModel.DataAnnotations.Schema.NotMapped]
    public string PhoneType => Helpers.MarketingPhone.NumberType(PublicPhone, Country);
    public string? Website { get; set; }
    public string? ContactName { get; set; }
    public string? PublicEmail { get; set; }
    public string? PublicPhone { get; set; }
    public string? PublicWhatsapp { get; set; }
    public string? SourceUrl { get; set; }
    public DateTime? SourceRetrievedAtUtc { get; set; }
    public string ContactBasis { get; set; } = "public-business-contact";
    public string ConsentStatus { get; set; } = "unknown";
    public string? Denomination { get; set; }
    public bool DoNotContact { get; set; }
    public string Status { get; set; } = "draft";
    public int Score { get; set; }
    public string? AiSummary { get; set; }
    public Guid? ReviewedByUserId { get; set; }
    public DateTime? ReviewedAtUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed class MarketingCampaign
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "";
    public string Objective { get; set; } = "";
    public string ChannelsJson { get; set; } = "[]";
    public string AudienceJson { get; set; } = "{}";
    public string SubjectTemplate { get; set; } = "";
    public string BodyTemplate { get; set; } = "";
    public string SocialTemplate { get; set; } = "";
    public string? DemoVideoUrl { get; set; }
    public string Language { get; set; } = "English";
    public string? WhatsAppContentSid { get; set; }
    public string WhatsAppContentVariablesJson { get; set; } = "{}";
    public string Status { get; set; } = "draft";
    public int IntervalDays { get; set; } = 30;
    public DateTime? NextRunAtUtc { get; set; }
    public DateTime? ApprovedAtUtc { get; set; }
    public Guid? ApprovedByUserId { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public ICollection<MarketingOutreach> Outreach { get; set; } = new List<MarketingOutreach>();
}

public sealed class MarketingOutreach
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid CampaignId { get; set; }
    public Guid ProspectId { get; set; }
    public string Channel { get; set; } = "email";
    public int AttemptNumber { get; set; } = 1;
    public string? Recipient { get; set; }
    public string? RenderedSubject { get; set; }
    public string RenderedBody { get; set; } = "";
    public string Status { get; set; } = "queued";
    public string? Provider { get; set; }
    public string? ExternalMessageId { get; set; }
    public string? FailureReason { get; set; }
    public DateTime AttemptedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAtUtc { get; set; }
    public DateTime? SentAtUtc { get; set; }
    public DateTime? RespondedAtUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public MarketingCampaign? Campaign { get; set; }
    public MarketingProspect? Prospect { get; set; }
    public ICollection<MarketingCommunicationEvent> Events { get; set; } = new List<MarketingCommunicationEvent>();
}

public sealed class MarketingCommunicationEvent
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid OutreachId { get; set; }
    public string EventType { get; set; } = "attempted";
    public DateTime EventAtUtc { get; set; } = DateTime.UtcNow;
    public string? ProviderEventId { get; set; }
    public string? LinkUrl { get; set; }
    public string? IpHash { get; set; }
    public string? UserAgent { get; set; }
    public string MetadataJson { get; set; } = "{}";
    public MarketingOutreach? Outreach { get; set; }
}

public sealed class MarketingLead
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProspectId { get; set; }
    public string Stage { get; set; } = "new";
    public int Score { get; set; }
    public string? QualificationNotes { get; set; }
    public Guid? OwnerUserId { get; set; }
    public DateTime? NextActionAtUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public MarketingProspect? Prospect { get; set; }
    public ICollection<MarketingQuote> Quotes { get; set; } = new List<MarketingQuote>();
}

public sealed class MarketingQuote
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid LeadId { get; set; }
    public string QuoteNumber { get; set; } = "";
    public string Currency { get; set; } = "INR";
    public decimal Amount { get; set; }
    public string LineItemsJson { get; set; } = "[]";
    public string Status { get; set; } = "draft";
    public DateTime ValidUntilUtc { get; set; }
    public DateTime? ApprovedAtUtc { get; set; }
    public DateTime? SentAtUtc { get; set; }
    public DateTime? AcceptedAtUtc { get; set; }
    public string AcceptanceToken { get; set; } = Guid.NewGuid().ToString("N");
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public MarketingLead? Lead { get; set; }
    public MarketingOrder? Order { get; set; }
}

public sealed class MarketingOrder
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid QuoteId { get; set; }
    public string Status { get; set; } = "pending";
    public Guid? TenantId { get; set; }
    public DateTime? DemoStartsAtUtc { get; set; }
    public DateTime? DemoEndsAtUtc { get; set; }
    public DateTime? ConvertedAtUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public MarketingQuote? Quote { get; set; }
    public Tenant? Tenant { get; set; }
}

public sealed class MarketingDiscoverySchedule
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = "Global church discovery";
    public bool Enabled { get; set; }
    public string Regions { get; set; } = "India, Asia, Africa, Europe, North America, South America, Oceania";
    public string Languages { get; set; } = "English, Hindi";
    public string ContactFocus { get; set; } = "all";
    public int MaxProspectsPerRun { get; set; } = 25;
    public int IntervalDays { get; set; } = 7;
    public DateTime? NextRunAtUtc { get; set; }
    public DateTime? LastRunAtUtc { get; set; }
    public Guid? ApprovedByUserId { get; set; }
    public DateTime? ApprovedAtUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

public sealed class MarketingDiscoveryRun
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? ScheduleId { get; set; }
    public string Trigger { get; set; } = "manual";
    public string Regions { get; set; } = "";
    public string Status { get; set; } = "queued";
    public int CandidatesFound { get; set; }
    public int CandidatesImported { get; set; }
    public int CandidatesSkipped { get; set; }
    public string? Provider { get; set; }
    public string? Model { get; set; }
    public string? Error { get; set; }
    public DateTime StartedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAtUtc { get; set; }
    public MarketingDiscoverySchedule? Schedule { get; set; }
}
