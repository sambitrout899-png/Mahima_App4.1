using System.Text.Json;
using System.Net;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Twilio.Security;

namespace Mahima.Api.v3.clean.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/public/marketing")]
public sealed class MarketingTrackingController : ControllerBase
{
    private static readonly byte[] TransparentGif = Convert.FromBase64String("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==");
    private readonly MahimaDbContext _db;
    private readonly IMarketingTrackingService _tracking;
    private readonly IConfiguration _config;

    public MarketingTrackingController(MahimaDbContext db, IMarketingTrackingService tracking, IConfiguration config)
        => (_db, _tracking, _config) = (db, tracking, config);

    [HttpGet("track/open/{token}")]
    public async Task<IActionResult> Open(string token, CancellationToken ct)
    {
        if (_tracking.TryReadToken(token, "open", out var outreachId) && await _db.MarketingOutreach.AnyAsync(x => x.Id == outreachId, ct))
            await AddEvent(outreachId, "opened", null, null, ct);
        Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
        return File(TransparentGif, "image/gif");
    }

    [HttpGet("track/click/{token}")]
    public async Task<IActionResult> Click(string token, CancellationToken ct)
    {
        if (!_tracking.TryReadToken(token, "click", out var outreachId)) return BadRequest("This demonstration link is invalid or has expired.");
        var outreach = await _db.MarketingOutreach.Include(x => x.Prospect).SingleOrDefaultAsync(x => x.Id == outreachId, ct);
        if (outreach == null || outreach.Prospect?.DoNotContact == true) return BadRequest("This demonstration link is no longer active.");
        var destination = _config["Marketing:DemoLandingUrl"] ?? "https://beta.mahimaministries.in/#/saas";
        await AddEvent(outreachId, "link_visited", null, destination, ct, new { verified = false, signal = "landing-request" });
        var safeChurch = WebUtility.HtmlEncode(outreach.Prospect.OrganizationName);
        var safeDestination = WebUtility.HtmlEncode(destination);
        var action = $"/api/public/marketing/track/confirm/{Uri.EscapeDataString(token)}";
        var html = $@"<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Continue to Mahima</title></head>
<body style='margin:0;font-family:system-ui;background:#f1f5f9;color:#102a23;display:grid;min-height:100vh;place-items:center'><main style='max-width:560px;margin:24px;background:white;border:1px solid #dbe5e1;border-radius:24px;padding:32px;box-shadow:0 18px 50px #0f51321a'><div style='font-size:13px;font-weight:800;color:#087f5b;text-transform:uppercase'>Mahima Ministries</div><h1>Continue to the church demonstration</h1><p>This link was prepared for <strong>{safeChurch}</strong>. Select Continue to confirm that you want to open the Mahima demonstration.</p><form method='post' action='{action}'><button type='submit' style='border:0;border-radius:12px;background:#087f5b;color:white;font-size:16px;font-weight:800;padding:14px 22px;cursor:pointer'>Continue to Mahima demo</button></form><p style='font-size:12px;color:#64748b;margin-top:22px'>This confirmation prevents automated email-security scanners from being counted as customer engagement.</p><noscript><p><a href='{safeDestination}'>Open the demonstration without tracking</a></p></noscript></main></body></html>";
        return Content(html, "text/html");
    }

    [HttpPost("track/confirm/{token}")]
    public async Task<IActionResult> ConfirmClick(string token, CancellationToken ct)
    {
        if (!_tracking.TryReadToken(token, "click", out var outreachId)) return BadRequest("This demonstration link is invalid or has expired.");
        var outreach = await _db.MarketingOutreach.Include(x => x.Prospect).SingleOrDefaultAsync(x => x.Id == outreachId, ct);
        if (outreach == null || outreach.Prospect?.DoNotContact == true) return BadRequest("This demonstration link is no longer active.");
        var destination = _config["Marketing:DemoLandingUrl"] ?? "https://beta.mahimaministries.in/#/saas";
        var alreadyConfirmed = await _db.MarketingCommunicationEvents.AnyAsync(x => x.OutreachId == outreachId && x.EventType == "clicked" && x.MetadataJson.Contains("user-action"), ct);
        if (!alreadyConfirmed)
        {
            await AddEvent(outreachId, "clicked", null, destination, ct, new { verified = true, confirmation = "user-action" });
            AddRootNotification("MarketingLinkClicked", $"{outreach.Prospect.OrganizationName} confirmed and opened the Mahima demonstration link.", outreach.Id, outreach.ProspectId, "clicked");
        }
        var lead = await _db.MarketingLeads.SingleOrDefaultAsync(x => x.ProspectId == outreach.ProspectId, ct);
        if (lead == null) _db.MarketingLeads.Add(new MarketingLead { ProspectId = outreach.ProspectId, Stage = "engaged", Score = Math.Max(50, outreach.Prospect.Score), QualificationNotes = "Created after a person explicitly confirmed the tracked demonstration link." });
        else { lead.Score = Math.Max(lead.Score, 50); if (lead.Stage == "new") lead.Stage = "engaged"; lead.UpdatedAtUtc = DateTime.UtcNow; }
        await _db.SaveChangesAsync(ct);
        var attributionToken = _tracking.CreateToken(outreach.Id, "registration", TimeSpan.FromDays(45));
        var separator = destination.Contains('?', StringComparison.Ordinal) ? "&" : "?";
        return Redirect($"{destination}{separator}marketingAttribution={Uri.EscapeDataString(attributionToken)}");
    }

    [HttpGet("unsubscribe/{token}")]
    public async Task<IActionResult> Unsubscribe(string token, CancellationToken ct)
    {
        if (!_tracking.TryReadToken(token, "unsubscribe", out var outreachId)) return BadRequest("This unsubscribe link is invalid.");
        var outreach = await _db.MarketingOutreach.Include(x => x.Prospect).SingleOrDefaultAsync(x => x.Id == outreachId, ct);
        if (outreach?.Prospect == null) return NotFound();
        outreach.Prospect.DoNotContact = true; outreach.Prospect.ConsentStatus = "opted-out"; outreach.Prospect.Status = "suppressed"; outreach.Prospect.UpdatedAtUtc = DateTime.UtcNow;
        await AddEvent(outreach.Id, "unsubscribed", null, null, ct, save: false);
        await _db.SaveChangesAsync(ct);
        return Content("You have been unsubscribed. Mahima Ministries will not send further marketing communications to this address.", "text/plain");
    }

    // Generic adapter for SMTP relay/provider webhooks and an inbound-email processor.
    // Configure Marketing:WebhookSecret and send it in X-Marketing-Webhook-Secret.
    [HttpPost("provider-event")]
    public async Task<IActionResult> ProviderEvent([FromBody] ProviderEventInput input, CancellationToken ct)
    {
        var expected = _config["Marketing:WebhookSecret"];
        if (string.IsNullOrWhiteSpace(expected) || Request.Headers["X-Marketing-Webhook-Secret"] != expected) return Unauthorized();
        var type = (input.EventType ?? "").Trim().ToLowerInvariant();
        var allowed = new[] { "accepted", "delivered", "bounced", "complained", "replied", "demo_started", "demo_verified", "trial_activated" };
        if (!allowed.Contains(type)) return BadRequest(new { message = "Unsupported marketing event type." });
        MarketingOutreach? outreach = null;
        if (input.OutreachId.HasValue) outreach = await _db.MarketingOutreach.Include(x => x.Prospect).SingleOrDefaultAsync(x => x.Id == input.OutreachId, ct);
        if (outreach == null && !string.IsNullOrWhiteSpace(input.ExternalMessageId)) outreach = await _db.MarketingOutreach.Include(x => x.Prospect).SingleOrDefaultAsync(x => x.ExternalMessageId == input.ExternalMessageId, ct);
        if (outreach == null) return NotFound(new { message = "No matching outreach attempt was found." });
        if (type == "replied") { outreach.RespondedAtUtc = DateTime.UtcNow; outreach.Status = "responded"; }
        if (type is "bounced" or "complained") { outreach.Status = type; outreach.FailureReason = input.Detail; if (outreach.Prospect != null) { outreach.Prospect.DoNotContact = true; outreach.Prospect.Status = "suppressed"; outreach.Prospect.ConsentStatus = type; } }
        await AddEvent(outreach.Id, type, input.ProviderEventId, input.LinkUrl, ct, input.Metadata, save: false);
        if (type is "replied" or "bounced" or "complained" or "demo_started" or "demo_verified" or "trial_activated")
            AddRootNotification($"Marketing{type.Replace("_", "", StringComparison.Ordinal).ToUpperInvariant()}", $"Marketing event '{type}' received for {outreach.Prospect?.OrganizationName ?? outreach.Recipient}.", outreach.Id, outreach.ProspectId, type);
        await _db.SaveChangesAsync(ct);
        return Ok(new { outreachId = outreach.Id, recorded = type });
    }

    // Twilio can't send custom headers, so the shared secret travels as a query-string
    // parameter on the StatusCallback URL that MarketingAutomationController generates per-send.
    [HttpPost("twilio-status")]
    public async Task<IActionResult> TwilioStatus([FromQuery] string? key, [FromQuery] Guid? outreachId, CancellationToken ct)
    {
        var expected = _config["Marketing:TwilioWebhookSecret"];
        if (string.IsNullOrWhiteSpace(expected) || key != expected) return Unauthorized();
        var form = await Request.ReadFormAsync(ct);
        var authToken = Environment.GetEnvironmentVariable("TWILIO_AUTH_TOKEN") ?? _config["Twilio:AuthToken"];
        var signature = Request.Headers["X-Twilio-Signature"].ToString();
        var requestUrl = $"{Request.Scheme}://{Request.Host}{Request.PathBase}{Request.Path}{Request.QueryString}";
        var parameters = form.ToDictionary(item => item.Key, item => item.Value.ToString());
        if (string.IsNullOrWhiteSpace(authToken)
            || string.IsNullOrWhiteSpace(signature)
            || !new RequestValidator(authToken).Validate(requestUrl, parameters, signature))
            return Unauthorized();
        var messageSid = form["MessageSid"].ToString();
        var status = (form["MessageStatus"].ToString() ?? "").Trim().ToLowerInvariant();
        MarketingOutreach? outreach = null;
        if (outreachId.HasValue) outreach = await _db.MarketingOutreach.SingleOrDefaultAsync(x => x.Id == outreachId, ct);
        if (outreach == null && !string.IsNullOrWhiteSpace(messageSid)) outreach = await _db.MarketingOutreach.SingleOrDefaultAsync(x => x.ExternalMessageId == messageSid, ct);
        if (outreach == null) return NotFound();
        var eventType = status switch { "delivered" => "delivered", "read" => "opened", "failed" or "undelivered" => "bounced", _ => null };
        if (eventType != null)
        {
            if (eventType == "bounced") { outreach.Status = "bounced"; outreach.FailureReason = form["ErrorMessage"].ToString(); }
            await AddEvent(outreach.Id, eventType, messageSid, null, ct);
        }
        return Ok(new { outreachId = outreach.Id, recorded = status });
    }

    private async Task AddEvent(Guid outreachId, string type, string? providerId, string? link, CancellationToken ct, object? metadata = null, bool save = true)
    {
        _db.MarketingCommunicationEvents.Add(new MarketingCommunicationEvent {
            OutreachId = outreachId, EventType = type, ProviderEventId = providerId, LinkUrl = link,
            IpHash = _tracking.HashIp(HttpContext.Connection.RemoteIpAddress?.ToString()),
            UserAgent = Request.Headers.UserAgent.ToString()[..Math.Min(1000, Request.Headers.UserAgent.ToString().Length)],
            MetadataJson = JsonSerializer.Serialize(metadata ?? new { })
        });
        if (save) await _db.SaveChangesAsync(ct);
    }

    private void AddRootNotification(string type, string message, Guid outreachId, Guid prospectId, string eventType)
        => _db.AdminNotifications.Add(new AdminNotification {
            TenantId = Guid.Parse("00000000-0000-0000-0000-000000000001"), Type = type, Message = message,
            Data = JsonSerializer.Serialize(new { outreachId, prospectId, eventType })
        });

    public sealed record ProviderEventInput(Guid? OutreachId, string? ExternalMessageId, string? ProviderEventId, string? EventType, string? Detail, string? LinkUrl, JsonElement? Metadata);
}
