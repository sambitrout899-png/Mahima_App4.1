namespace Mahima.Api.v3.clean.Models;

public sealed class WhatsAppContactState
{
    public string PhoneE164 { get; set; } = "";
    public DateTime? LastInboundAtUtc { get; set; }
    public string? LastInboundMessageSid { get; set; }
    public string? LastInboundBody { get; set; }
    public bool ExplicitOptIn { get; set; }
    public DateTime? OptedInAtUtc { get; set; }
    public bool OptedOut { get; set; }
    public DateTime? OptedOutAtUtc { get; set; }
    public string? LastOutboundMessageSid { get; set; }
    public string? LastOutboundStatus { get; set; }
    public DateTime? LastOutboundStatusAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}
