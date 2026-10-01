using System.Net;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Twilio.Security;

namespace Mahima.Api.v3.clean.Controllers;

[ApiController]
[AllowAnonymous]
[Route("api/public/twilio/whatsapp")]
public sealed class TwilioWhatsAppWebhookController : ControllerBase
{
    private static readonly HashSet<string> OptOutKeywords = new(StringComparer.OrdinalIgnoreCase)
        { "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT" };
    private static readonly HashSet<string> OptInKeywords = new(StringComparer.OrdinalIgnoreCase)
        { "START", "UNSTOP", "YES" };

    private readonly MahimaDbContext _db;
    private readonly IConfiguration _config;
    private readonly ILogger<TwilioWhatsAppWebhookController> _logger;

    public TwilioWhatsAppWebhookController(MahimaDbContext db, IConfiguration config, ILogger<TwilioWhatsAppWebhookController> logger)
        => (_db, _config, _logger) = (db, config, logger);

    [HttpPost("incoming")]
    public Task<IActionResult> Incoming(CancellationToken ct) => ProcessAsync(false, ct);

    [HttpPost("fallback")]
    public Task<IActionResult> Fallback(CancellationToken ct) => ProcessAsync(true, ct);

    [HttpPost("status")]
    public async Task<IActionResult> Status(CancellationToken ct)
    {
        if (!Request.HasFormContentType) return BadRequest();
        var form = await Request.ReadFormAsync(ct);
        if (!IsValidTwilioRequest(form)) return Unauthorized();
        var phone = NormalizePhone(form["To"].ToString());
        if (string.IsNullOrWhiteSpace(phone)) return Ok();
        var state = await _db.WhatsAppContactStates.SingleOrDefaultAsync(x => x.PhoneE164 == phone, ct);
        if (state == null)
        {
            state = new WhatsAppContactState { PhoneE164 = phone };
            _db.WhatsAppContactStates.Add(state);
        }
        state.LastOutboundMessageSid = form["MessageSid"].ToString();
        state.LastOutboundStatus = form["MessageStatus"].ToString().Trim().ToLowerInvariant();
        state.LastOutboundStatusAtUtc = DateTime.UtcNow;
        state.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok();
    }

    private async Task<IActionResult> ProcessAsync(bool fallback, CancellationToken ct)
    {
        if (!Request.HasFormContentType) return BadRequest();
        var form = await Request.ReadFormAsync(ct);
        if (!IsValidTwilioRequest(form)) return Unauthorized();

        var phone = NormalizePhone(form["From"].ToString());
        var messageSid = form["MessageSid"].ToString();
        var body = form["Body"].ToString().Trim();
        if (string.IsNullOrWhiteSpace(phone)) return BadRequest();

        var state = await _db.WhatsAppContactStates.SingleOrDefaultAsync(x => x.PhoneE164 == phone, ct);
        if (state == null)
        {
            state = new WhatsAppContactState { PhoneE164 = phone };
            _db.WhatsAppContactStates.Add(state);
        }

        // Twilio may retry a webhook or invoke the fallback. Keep processing idempotent.
        if (!string.IsNullOrWhiteSpace(messageSid) && state.LastInboundMessageSid == messageSid)
            return Twiml();

        var now = DateTime.UtcNow;
        state.LastInboundAtUtc = now;
        state.LastInboundMessageSid = messageSid;
        state.LastInboundBody = body[..Math.Min(body.Length, 2000)];
        state.UpdatedAtUtc = now;

        if (OptOutKeywords.Contains(body))
        {
            state.OptedOut = true;
            state.OptedOutAtUtc = now;
            state.ExplicitOptIn = false;
            await SuppressMarketingProspectsAsync(phone, "whatsapp_opted_out", ct);
        }
        else if (OptInKeywords.Contains(body))
        {
            state.OptedOut = false;
            state.OptedOutAtUtc = null;
            state.ExplicitOptIn = true;
            state.OptedInAtUtc = now;
            await MarkMarketingOptInAsync(phone, ct);
        }

        await _db.SaveChangesAsync(ct);
        _logger.LogInformation("Processed {Kind} WhatsApp webhook {MessageSid} from {Phone}", fallback ? "fallback" : "incoming", messageSid, Mask(phone));
        return Twiml();
    }

    private bool IsValidTwilioRequest(IFormCollection form)
    {
        var token = Environment.GetEnvironmentVariable("TWILIO_AUTH_TOKEN") ?? _config["Twilio:AuthToken"];
        var signature = Request.Headers["X-Twilio-Signature"].ToString();
        if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(signature)) return false;
        var url = $"{Request.Scheme}://{Request.Host}{Request.PathBase}{Request.Path}{Request.QueryString}";
        var parameters = form.ToDictionary(x => x.Key, x => x.Value.ToString());
        return new RequestValidator(token).Validate(url, parameters, signature);
    }

    private async Task SuppressMarketingProspectsAsync(string phone, string consent, CancellationToken ct)
    {
        var candidates = await _db.MarketingProspects.Where(x => x.PublicWhatsapp != null).ToListAsync(ct);
        foreach (var prospect in candidates.Where(x => NormalizePhone(x.PublicWhatsapp) == phone))
        {
            prospect.DoNotContact = true;
            prospect.Status = "suppressed";
            prospect.ConsentStatus = consent;
            prospect.UpdatedAtUtc = DateTime.UtcNow;
        }
    }

    private async Task MarkMarketingOptInAsync(string phone, CancellationToken ct)
    {
        var candidates = await _db.MarketingProspects.Where(x => x.PublicWhatsapp != null).ToListAsync(ct);
        foreach (var prospect in candidates.Where(x => NormalizePhone(x.PublicWhatsapp) == phone))
        {
            prospect.DoNotContact = false;
            prospect.ConsentStatus = "whatsapp_opted_in";
            prospect.UpdatedAtUtc = DateTime.UtcNow;
        }
    }

    internal static string NormalizePhone(string? value)
    {
        var phone = (value ?? "").Trim();
        if (phone.StartsWith("whatsapp:", StringComparison.OrdinalIgnoreCase)) phone = phone[9..];
        var digits = new string(phone.Where(char.IsDigit).ToArray());
        return string.IsNullOrWhiteSpace(digits) ? "" : $"+{digits}";
    }

    private static string Mask(string phone) => phone.Length <= 4 ? "***" : $"***{phone[^4..]}";
    private ContentResult Twiml() => Content("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", "application/xml", System.Text.Encoding.UTF8);
}
