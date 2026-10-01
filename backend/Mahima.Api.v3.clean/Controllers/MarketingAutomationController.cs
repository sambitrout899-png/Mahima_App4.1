using System.Security.Claims;
using System.Text.Json;
using System.Net;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Helpers;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Services;
using Mahima.Api.v3.clean.Services.Ai;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Mahima.Api.v3.clean.Controllers;

[ApiController]
[Authorize(Roles = "admin,Admin")]
[Route("api/admin/marketing")]
public sealed class MarketingAutomationController : ControllerBase
{
    private readonly MahimaDbContext _db;
    private readonly ITenantContextService _tenantContext;
    private readonly ILlmProvider _llm;
    private readonly IMarketingEmailService _email;
    private readonly IMarketingDiscoveryService _discovery;
    private readonly IConfiguration _config;
    private readonly IMarketingTrackingService _tracking;

    public MarketingAutomationController(MahimaDbContext db, ITenantContextService tenantContext, ILlmProvider llm, IMarketingEmailService email, IMarketingDiscoveryService discovery, IConfiguration config, IMarketingTrackingService tracking)
        => (_db, _tenantContext, _llm, _email, _discovery, _config, _tracking) = (db, tenantContext, llm, email, discovery, config, tracking);

    [HttpGet("whatsapp/status")]
    public async Task<IActionResult> WhatsAppStatus(CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        var accountSid = Setting("Twilio:AccountSid", "TWILIO_ACCOUNT_SID");
        var authToken = Setting("Twilio:AuthToken", "TWILIO_AUTH_TOKEN");
        var sender = Setting("Twilio:WhatsAppFrom", "TWILIO_WHATSAPP_FROM");
        var messagingServiceSid = Setting("Twilio:MessagingServiceSid", "TWILIO_MESSAGING_SERVICE_SID");
        var wabaId = Setting("Twilio:WhatsAppBusinessAccountId", "TWILIO_WABA_ID");
        var businessManagerId = Setting("Twilio:MetaBusinessManagerId", "TWILIO_META_BUSINESS_MANAGER_ID");
        var credentialsConfigured = !string.IsNullOrWhiteSpace(accountSid) && !string.IsNullOrWhiteSpace(authToken);
        var senderConfigured = !string.IsNullOrWhiteSpace(sender) || !string.IsNullOrWhiteSpace(messagingServiceSid);

        return Ok(new
        {
            ready = credentialsConfigured && senderConfigured,
            credentialsConfigured,
            senderConfigured,
            whatsAppBusinessAccountId = wabaId,
            metaBusinessManagerId = businessManagerId,
            sender = MaskSender(sender),
            messagingServiceConfigured = !string.IsNullOrWhiteSpace(messagingServiceSid),
            templateRequiredOutsideCustomerServiceWindow = true,
            nextStep = !credentialsConfigured
                ? "Configure TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN on the API server."
                : !senderConfigured
                    ? "Create and approve a WhatsApp sender in Twilio, then configure TWILIO_WHATSAPP_FROM (whatsapp:+E164) or TWILIO_MESSAGING_SERVICE_SID."
                    : "WhatsApp transport is ready. Use an approved HX Content Template SID for business-initiated messages."
        });
    }

    [HttpPost("whatsapp/test-template")]
    public async Task<IActionResult> TestWhatsAppTemplate([FromBody] WhatsAppTemplateTestInput input, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        if (string.IsNullOrWhiteSpace(input.ToPhone)) return BadRequest(new { message = "A destination WhatsApp number in E.164 format is required." });
        if (string.IsNullOrWhiteSpace(input.ContentSid) || !input.ContentSid.StartsWith("HX", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { message = "An approved Twilio Content Template SID beginning with HX is required." });
        if (!HasWhatsAppSender()) return Conflict(new { message = "No approved WhatsApp sender is configured yet." });

        var result = await SmsHelper.SendWhatsAppTemplateAsync(input.ToPhone, input.ContentSid, input.Variables ?? new Dictionary<string, string>());
        return result.Success
            ? Ok(new { success = true, messageSid = result.MessageSid })
            : StatusCode(StatusCodes.Status502BadGateway, new { success = false, message = result.ErrorMessage });
    }

    [HttpGet("dashboard")]
    public async Task<IActionResult> Dashboard(CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        // Keep event verification and channel aggregation as simple queries.
        // Grouping correlated event navigations can fail translation on some
        // PostgreSQL/EF deployments and would otherwise blank the whole dashboard.
        var eventStats = await _db.MarketingCommunicationEvents.AsNoTracking()
            .Select(x => new { x.OutreachId, x.EventType, x.MetadataJson }).ToListAsync(ct);
        static bool IsUserConfirmed(string? metadata) =>
            !string.IsNullOrWhiteSpace(metadata) && metadata.Contains("user-action", StringComparison.OrdinalIgnoreCase);
        var deliveredIds = eventStats.Where(x => x.EventType == "delivered").Select(x => x.OutreachId).ToHashSet();
        var confirmedClickIds = eventStats.Where(x => x.EventType == "clicked" && IsUserConfirmed(x.MetadataJson)).Select(x => x.OutreachId).ToHashSet();
        var outreachStats = await _db.MarketingOutreach.AsNoTracking()
            .Select(x => new { x.Id, x.Channel, x.Status }).ToListAsync(ct);
        var byChannel = outreachStats.GroupBy(x => x.Channel).Select(g => new {
            channel = g.Key,
            accepted = g.Count(x => x.Status == "sent" || x.Status == "responded"),
            delivered = g.Count(x => deliveredIds.Contains(x.Id)),
            confirmedClicks = g.Count(x => confirmedClickIds.Contains(x.Id)),
            failed = g.Count(x => x.Status == "failed" || x.Status == "bounced")
        }).ToList();
        var trackingOpens = eventStats.Where(x => x.EventType == "opened").Select(x => x.OutreachId).Distinct().Count();
        var unverifiedLinkVisits = eventStats.Where(x => x.EventType == "link_visited" || (x.EventType == "clicked" && !IsUserConfirmed(x.MetadataJson))).Select(x => x.OutreachId).Distinct().Count();
        var confirmedClicks = confirmedClickIds.Count;
        return Ok(new {
            prospects = await _db.MarketingProspects.CountAsync(ct),
            approvedProspects = await _db.MarketingProspects.CountAsync(x => x.Status == "approved" && !x.DoNotContact, ct),
            campaigns = await _db.MarketingCampaigns.CountAsync(ct),
            activeCampaigns = await _db.MarketingCampaigns.CountAsync(x => x.Status == "active", ct),
            sent = await _db.MarketingOutreach.CountAsync(x => x.Status == "sent" || x.Status == "responded", ct),
            responses = await _db.MarketingOutreach.CountAsync(x => x.Status == "responded", ct),
            delivered = await _db.MarketingCommunicationEvents.Where(x => x.EventType == "delivered").Select(x => x.OutreachId).Distinct().CountAsync(ct),
            opens = trackingOpens,
            trackingOpens,
            unverifiedLinkVisits,
            clicks = confirmedClicks,
            confirmedClicks,
            registrations = await _db.MarketingCommunicationEvents.Where(x => x.EventType == "registered").Select(x => x.OutreachId).Distinct().CountAsync(ct),
            unsubscribed = await _db.MarketingCommunicationEvents.Where(x => x.EventType == "unsubscribed").Select(x => x.OutreachId).Distinct().CountAsync(ct),
            bounced = await _db.MarketingOutreach.CountAsync(x => x.Status == "bounced" || x.Status == "failed", ct),
            leads = await _db.MarketingLeads.CountAsync(ct),
            qualifiedLeads = await _db.MarketingLeads.CountAsync(x => x.Stage == "qualified" || x.Stage == "proposal" || x.Stage == "won", ct),
            openQuotes = await _db.MarketingQuotes.CountAsync(x => x.Status == "sent" || x.Status == "approved", ct),
            demos = await _db.MarketingOrders.CountAsync(x => x.Status == "demo_active", ct),
            byChannel
        });
    }

    [HttpGet("workspace")]
    public async Task<IActionResult> Workspace(CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        return Ok(new {
            prospects = await _db.MarketingProspects.OrderByDescending(x => x.CreatedAtUtc).Take(500).ToListAsync(ct),
            campaigns = await _db.MarketingCampaigns.OrderByDescending(x => x.CreatedAtUtc).Take(100).ToListAsync(ct),
            leads = await _db.MarketingLeads.Include(x => x.Prospect).OrderByDescending(x => x.UpdatedAtUtc).Take(300).ToListAsync(ct),
            quotes = await _db.MarketingQuotes.Include(x => x.Order).OrderByDescending(x => x.CreatedAtUtc).Take(300).ToListAsync(ct)
            ,
            discoverySchedules = await _db.MarketingDiscoverySchedules.OrderByDescending(x => x.CreatedAtUtc).ToListAsync(ct),
            discoveryRuns = await _db.MarketingDiscoveryRuns.OrderByDescending(x => x.StartedAtUtc).Take(100).ToListAsync(ct),
            communications = await _db.MarketingOutreach.AsNoTracking().Include(x => x.Campaign).Include(x => x.Prospect)
                .Include(x => x.Events)
                .OrderByDescending(x => x.AttemptedAtUtc).Take(1000).ToListAsync(ct)
        });
    }

    [HttpGet("phone-countries")]
    public async Task<IActionResult> PhoneCountries(CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        return Ok(MarketingPhone.Countries);
    }

    [HttpGet("prospects")]
    public async Task<IActionResult> ListProspects([FromQuery] string? status, [FromQuery] string? country, [FromQuery] string? state, [FromQuery] string? city, [FromQuery] string? contactChannel, [FromQuery] int page = 1, [FromQuery] int pageSize = 100, CancellationToken ct = default)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        page = Math.Max(1, page); pageSize = Math.Clamp(pageSize, 1, 500);
        var query = _db.MarketingProspects.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(x => x.Status == status);
        if (!string.IsNullOrWhiteSpace(country)) query = query.Where(x => x.Country == country);
        if (!string.IsNullOrWhiteSpace(state)) query = query.Where(x => (x.State ?? "").ToLower() == state.Trim().ToLower());
        if (!string.IsNullOrWhiteSpace(city)) query = query.Where(x => (x.City ?? "").ToLower() == city.Trim().ToLower());
        if (contactChannel == "sms") query = query.Where(x => x.PublicPhone != null && x.PublicPhone != "");
        if (contactChannel == "whatsapp") query = query.Where(x => x.PublicWhatsapp != null && x.PublicWhatsapp != "");
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(x => x.CreatedAtUtc).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return Ok(new { items, total, page, pageSize, totalPages = pageSize <= 0 ? 0 : (int)Math.Ceiling((double)total / pageSize) });
    }

    [HttpGet("communications")]
    public async Task<IActionResult> ListCommunications([FromQuery] string? status, [FromQuery] string? channel, [FromQuery] Guid? campaignId, [FromQuery] int page = 1, [FromQuery] int pageSize = 100, CancellationToken ct = default)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        page = Math.Max(1, page); pageSize = Math.Clamp(pageSize, 1, 500);
        var query = _db.MarketingOutreach.AsNoTracking().Include(x => x.Campaign).Include(x => x.Prospect).Include(x => x.Events).AsQueryable();
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(x => x.Status == status);
        if (!string.IsNullOrWhiteSpace(channel)) query = query.Where(x => x.Channel == channel.ToLowerInvariant());
        if (campaignId.HasValue) query = query.Where(x => x.CampaignId == campaignId.Value);
        var total = await query.CountAsync(ct);
        var items = await query.OrderByDescending(x => x.AttemptedAtUtc).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync(ct);
        return Ok(new { items, total, page, pageSize, totalPages = pageSize <= 0 ? 0 : (int)Math.Ceiling((double)total / pageSize) });
    }

    [HttpPost("discovery/run")]
    public async Task<IActionResult> RunDiscovery([FromBody] DiscoveryInput input, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        if (string.IsNullOrWhiteSpace(input.Regions)) return BadRequest(new { message = "At least one country or region is required." });
        var run = await _discovery.RunAsync(input.Regions, input.Languages ?? "English", input.MaxProspects, "manual", null, ct, input.ContactFocus == "mobile" ? "mobile" : "all");
        return run.Status == "completed" ? Ok(run) : Problem(run.Error, statusCode: 502, title: "AI prospect discovery failed");
    }

    [HttpPost("discovery/schedules")]
    public async Task<IActionResult> SaveDiscoverySchedule([FromBody] DiscoveryScheduleInput input, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        if (string.IsNullOrWhiteSpace(input.Regions) || string.IsNullOrWhiteSpace(input.Name))
            return BadRequest(new { message = "Schedule name and country or geography are required." });
        var schedule = input.Id == null ? new MarketingDiscoverySchedule() : await _db.MarketingDiscoverySchedules.FindAsync(new object[] { input.Id.Value }, ct);
        if (schedule == null) return NotFound();
        schedule.Name = input.Name.Trim(); schedule.Regions = input.Regions.Trim(); schedule.Languages = input.Languages.Trim();
        schedule.ContactFocus = input.ContactFocus == "mobile" ? "mobile" : "all";
        schedule.MaxProspectsPerRun = Math.Clamp(input.MaxProspects, 1, 100); schedule.IntervalDays = Math.Clamp(input.IntervalDays, 1, 90);
        schedule.Enabled = false; schedule.ApprovedAtUtc = null; schedule.ApprovedByUserId = null; schedule.NextRunAtUtc = input.NextRunAtUtc; schedule.UpdatedAtUtc = DateTime.UtcNow;
        if (input.Id == null) _db.MarketingDiscoverySchedules.Add(schedule);
        await _db.SaveChangesAsync(ct); return Ok(schedule);
    }

    [HttpPut("discovery/schedules/{id:guid}/approve")]
    public async Task<IActionResult> ApproveDiscoverySchedule(Guid id, [FromBody] ScheduleApproval input, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        var schedule = await _db.MarketingDiscoverySchedules.FindAsync(new object[] { id }, ct); if (schedule == null) return NotFound();
        schedule.Enabled = input.Enabled; schedule.ApprovedAtUtc = input.Enabled ? DateTime.UtcNow : null;
        schedule.ApprovedByUserId = input.Enabled ? UserId() : null; schedule.NextRunAtUtc ??= DateTime.UtcNow;
        schedule.UpdatedAtUtc = DateTime.UtcNow; await _db.SaveChangesAsync(ct); return Ok(schedule);
    }

    [HttpPost("prospects")]
    public async Task<IActionResult> AddProspect([FromBody] ProspectInput input, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        if (string.IsNullOrWhiteSpace(input.OrganizationName) || string.IsNullOrWhiteSpace(input.SourceUrl))
            return BadRequest(new { message = "Organization name and a verifiable public source URL are required." });
        if (!string.IsNullOrWhiteSpace(input.PublicEmail) &&
            await _db.MarketingProspects.AnyAsync(x => x.PublicEmail == input.PublicEmail, ct))
            return Conflict(new { message = "That public email is already in the prospect register." });

        var phoneError = ValidatePhones(input);
        if (phoneError != null) return BadRequest(new { message = phoneError });
        var phone = MarketingPhone.Normalize(input.PublicPhone, input.Country);
        var whatsapp = MarketingPhone.Normalize(input.PublicWhatsapp, input.Country);
        if (await PhoneExists(phone, whatsapp, ct)) return Conflict(new { message = "That phone number is already in the prospect register." });
        var item = new MarketingProspect {
            OrganizationName = input.OrganizationName.Trim(), Country = MarketingPhone.Country(input.Country), State = input.State?.Trim(), City = input.City?.Trim(), Website = input.Website?.Trim(),
            ContactName = input.ContactName?.Trim(), PublicEmail = input.PublicEmail?.Trim().ToLowerInvariant(),
            PublicPhone = phone, PublicWhatsapp = whatsapp,
            Denomination = string.IsNullOrWhiteSpace(input.Denomination) ? null : input.Denomination.Trim(),
            SourceUrl = input.SourceUrl.Trim(), SourceRetrievedAtUtc = DateTime.UtcNow,
            ContactBasis = string.IsNullOrWhiteSpace(input.ContactBasis) ? "public-business-contact" : input.ContactBasis.Trim(),
            ConsentStatus = string.IsNullOrWhiteSpace(input.ConsentStatus) ? "unknown" : input.ConsentStatus.Trim()
        };
        _db.MarketingProspects.Add(item); await _db.SaveChangesAsync(ct);
        return CreatedAtAction(nameof(Workspace), new { id = item.Id }, item);
    }

    [HttpPost("prospects/import")]
    public async Task<IActionResult> Import([FromBody] List<ProspectInput> inputs, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        var added = new List<MarketingProspect>();
        foreach (var input in inputs.Take(1000))
        {
            if (string.IsNullOrWhiteSpace(input.OrganizationName) || string.IsNullOrWhiteSpace(input.SourceUrl)) continue;
            if (!string.IsNullOrWhiteSpace(input.PublicEmail) && await _db.MarketingProspects.AnyAsync(x => x.PublicEmail == input.PublicEmail.ToLower(), ct)) continue;
            if (ValidatePhones(input) != null) continue;
            var phone = MarketingPhone.Normalize(input.PublicPhone, input.Country);
            var whatsapp = MarketingPhone.Normalize(input.PublicWhatsapp, input.Country);
            if (await PhoneExists(phone, whatsapp, ct) || added.Any(x =>
                (phone != null && (x.PublicPhone == phone || x.PublicWhatsapp == phone)) ||
                (whatsapp != null && (x.PublicPhone == whatsapp || x.PublicWhatsapp == whatsapp)) ||
                (!string.IsNullOrWhiteSpace(input.PublicEmail) && string.Equals(x.PublicEmail, input.PublicEmail.Trim(), StringComparison.OrdinalIgnoreCase)))) continue;
            added.Add(new MarketingProspect { OrganizationName = input.OrganizationName.Trim(), Country = MarketingPhone.Country(input.Country), State = input.State?.Trim(), City = input.City?.Trim(), Website = input.Website,
                ContactName = input.ContactName, PublicEmail = input.PublicEmail?.Trim().ToLowerInvariant(), PublicPhone = phone,
                PublicWhatsapp = whatsapp, Denomination = string.IsNullOrWhiteSpace(input.Denomination) ? null : input.Denomination.Trim(),
                SourceUrl = input.SourceUrl, SourceRetrievedAtUtc = DateTime.UtcNow,
                ContactBasis = input.ContactBasis ?? "public-business-contact", ConsentStatus = input.ConsentStatus ?? "unknown" });
        }
        _db.MarketingProspects.AddRange(added); await _db.SaveChangesAsync(ct);
        return Ok(new { imported = added.Count, skipped = inputs.Count - added.Count });
    }

    [HttpPut("prospects/{id:guid}/review")]
    public async Task<IActionResult> ReviewProspect(Guid id, [FromBody] ProspectReview input, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        var item = await _db.MarketingProspects.FindAsync(new object[] { id }, ct);
        if (item == null) return NotFound();
        item.Status = input.Approved ? "approved" : "rejected"; item.DoNotContact = input.DoNotContact;
        item.ConsentStatus = input.ConsentStatus ?? item.ConsentStatus; item.ReviewedAtUtc = DateTime.UtcNow;
        item.ReviewedByUserId = UserId(); item.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct); return Ok(item);
    }

    [HttpPost("campaigns/ai-draft")]
    public async Task<IActionResult> AiDraft([FromBody] AiCampaignInput input, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        if (!_llm.IsConfigured) return Problem("AI provider is not configured.", statusCode: 503);
        var language = string.IsNullOrWhiteSpace(input.Language) ? "English" : input.Language.Trim();
        var result = await _llm.CompleteAsync(new LlmRequest {
            Temperature = .35, MaxTokens = 1200,
            Messages = {
                LlmMessage.System($"You create respectful B2B outreach for a church-management SaaS. Never fabricate contacts, claims, endorsements, prices or consent. Return JSON only with subject, emailBody and socialPost. Use only these personalization tokens: {{{{contact}}}}, {{{{church}}}}, {{{{country}}}}, {{{{senderName}}}}, {{{{senderPosition}}}}, {{{{company}}}}, {{{{senderContact}}}}, {{{{demoLink}}}}, {{{{optOut}}}}. Never output square-bracket placeholders. In emailBody include an HTML link whose href is exactly {{{{demoLink}}}} and whose visible text invites the recipient to register their church for the one-month demonstration. Include {{{{optOut}}}} exactly once. Write ALL surrounding copy in {language}, but never translate or alter the literal token text itself (it must remain exactly {{{{contact}}}}, {{{{church}}}}, etc. in double curly braces)."),
                LlmMessage.User($"Audience: {input.Audience}\nObjective: {input.Objective}\nCountries: {input.Countries}\nLanguage: {language}\nOffer: one-month full-feature demonstration. Draft concise, professional outreach.")
            }
        }, ct);
        if (!result.Success) return Problem(result.Error, statusCode: 502);
        var parsed = ParseCampaignDraft(result.Text ?? "");
        return Ok(new { draft = result.Text, parsed.Subject, parsed.EmailBody, parsed.SocialPost, provider = result.Provider, model = result.Model });
    }

    [HttpPost("campaigns")]
    public async Task<IActionResult> CreateCampaign([FromBody] CampaignInput input, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        var demoVideoUrl = NormalizePublicVideoUrl(input.DemoVideoUrl);
        if (!string.IsNullOrWhiteSpace(input.DemoVideoUrl) && demoVideoUrl == null)
            return BadRequest(new { message = "Demo video URL must be a valid public http:// or https:// URL." });
        // This flow is root-admin-only prospect outreach with no tenant context, so it always
        // falls back to the global TwilioTemplateDefaults.MarketingInvitation constant rather than
        // Tenant.WhatsAppMarketingTemplateSid (which exists on the model but has no tenant to read here).
        var contentSid = input.Channels.Contains("whatsapp", StringComparer.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(input.WhatsAppContentSid)
            ? TwilioTemplateDefaults.MarketingInvitation : input.WhatsAppContentSid;
        var channelError = ValidateChannels(input.Channels, input.SocialBody, contentSid);
        if (channelError != null) return BadRequest(new { message = channelError });
        var governedBody = input.Body;
        if (!governedBody.Contains("{{demoLink}}", StringComparison.OrdinalIgnoreCase))
            governedBody += "<p><a href=\"{{demoLink}}\">Register your church and start your one-month Mahima demonstration</a></p>";
        var item = new MarketingCampaign { Name = input.Name.Trim(), Objective = input.Objective.Trim(),
            ChannelsJson = JsonSerializer.Serialize(input.Channels.Distinct(StringComparer.OrdinalIgnoreCase)),
            AudienceJson = JsonSerializer.Serialize(input.Audience), SubjectTemplate = input.Subject,
            BodyTemplate = governedBody, SocialTemplate = input.SocialBody ?? "", DemoVideoUrl = demoVideoUrl,
            Language = string.IsNullOrWhiteSpace(input.Language) ? "English" : input.Language.Trim(),
            WhatsAppContentSid = string.IsNullOrWhiteSpace(contentSid) ? null : contentSid.Trim(),
            WhatsAppContentVariablesJson = input.WhatsAppContentVariables == null ? "{}" : JsonSerializer.Serialize(input.WhatsAppContentVariables),
            IntervalDays = Math.Clamp(input.IntervalDays, 1, 365),
            NextRunAtUtc = input.NextRunAtUtc, Status = "pending_approval" };
        _db.MarketingCampaigns.Add(item); await _db.SaveChangesAsync(ct); return Ok(item);
    }

    [HttpPut("campaigns/{id:guid}")]
    public async Task<IActionResult> UpdateCampaign(Guid id, [FromBody] CampaignInput input, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        var item = await _db.MarketingCampaigns.FindAsync(new object[] { id }, ct);
        if (item == null) return NotFound();
        if (item.Status is not ("draft" or "pending_approval")) return Conflict(new { message = "Only a draft or pending campaign can be edited." });
        var demoVideoUrl = NormalizePublicVideoUrl(input.DemoVideoUrl);
        if (!string.IsNullOrWhiteSpace(input.DemoVideoUrl) && demoVideoUrl == null)
            return BadRequest(new { message = "Demo video URL must be a valid public http:// or https:// URL." });
        var contentSid = input.Channels.Contains("whatsapp", StringComparer.OrdinalIgnoreCase) && string.IsNullOrWhiteSpace(input.WhatsAppContentSid)
            ? TwilioTemplateDefaults.MarketingInvitation : input.WhatsAppContentSid;
        var channelError = ValidateChannels(input.Channels, input.SocialBody, contentSid);
        if (channelError != null) return BadRequest(new { message = channelError });
        var governedBody = input.Body;
        if (!governedBody.Contains("{{demoLink}}", StringComparison.OrdinalIgnoreCase))
            governedBody += "<p><a href=\"{{demoLink}}\">Register your church and start your one-month Mahima demonstration</a></p>";
        item.Name = input.Name.Trim(); item.Objective = input.Objective.Trim();
        item.ChannelsJson = JsonSerializer.Serialize(input.Channels.Distinct(StringComparer.OrdinalIgnoreCase));
        item.AudienceJson = JsonSerializer.Serialize(input.Audience); item.SubjectTemplate = input.Subject;
        item.BodyTemplate = governedBody; item.SocialTemplate = input.SocialBody ?? ""; item.DemoVideoUrl = demoVideoUrl;
        item.Language = string.IsNullOrWhiteSpace(input.Language) ? "English" : input.Language.Trim();
        item.WhatsAppContentSid = string.IsNullOrWhiteSpace(contentSid) ? null : contentSid.Trim();
        item.WhatsAppContentVariablesJson = input.WhatsAppContentVariables == null ? "{}" : JsonSerializer.Serialize(input.WhatsAppContentVariables);
        item.IntervalDays = Math.Clamp(input.IntervalDays, 1, 365); item.NextRunAtUtc = input.NextRunAtUtc; item.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct); return Ok(item);
    }

    [HttpPost("campaigns/{id:guid}/clone")]
    public async Task<IActionResult> CloneCampaign(Guid id, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        var source = await _db.MarketingCampaigns.FindAsync(new object[] { id }, ct);
        if (source == null) return NotFound();
        var clone = new MarketingCampaign { Name = $"{source.Name} (copy)", Objective = source.Objective, ChannelsJson = source.ChannelsJson,
            AudienceJson = source.AudienceJson, SubjectTemplate = source.SubjectTemplate, BodyTemplate = source.BodyTemplate,
            SocialTemplate = source.SocialTemplate, DemoVideoUrl = source.DemoVideoUrl, Language = source.Language,
            WhatsAppContentSid = source.WhatsAppContentSid, WhatsAppContentVariablesJson = source.WhatsAppContentVariablesJson,
            IntervalDays = source.IntervalDays, Status = "draft" };
        _db.MarketingCampaigns.Add(clone); await _db.SaveChangesAsync(ct); return Ok(clone);
    }

    [HttpDelete("campaigns/{id:guid}")]
    public async Task<IActionResult> DeleteCampaign(Guid id, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        var item = await _db.MarketingCampaigns.FindAsync(new object[] { id }, ct);
        if (item == null) return NotFound();
        if (item.Status is not ("draft" or "pending_approval")) return Conflict(new { message = "Only a draft or pending campaign can be deleted." });
        if (await _db.MarketingOutreach.AnyAsync(x => x.CampaignId == id, ct)) return Conflict(new { message = "This campaign already has recorded outreach attempts and cannot be deleted." });
        _db.MarketingCampaigns.Remove(item); await _db.SaveChangesAsync(ct); return Ok(new { deleted = true });
    }

    [HttpPost("audience/preview")]
    public async Task<IActionResult> PreviewAudience([FromBody] AudienceFilter? filter, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        var query = ApplyAudienceFilter(filter);
        var count = await query.CountAsync(ct);
        var sample = await query.OrderBy(x => x.OrganizationName).Take(20)
            .Select(x => new { x.Id, x.OrganizationName, x.Country, x.Denomination, x.Score }).ToListAsync(ct);
        return Ok(new { count, sample });
    }

    [HttpPut("campaigns/{id:guid}/approve")]
    public async Task<IActionResult> ApproveCampaign(Guid id, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        var item = await _db.MarketingCampaigns.FindAsync(new object[] { id }, ct);
        if (item == null) return NotFound();
        if (item.Status != "pending_approval" && item.Status != "draft") return Conflict(new { message = "Only a draft or pending campaign can be approved." });
        item.Status = "approved"; item.ApprovedAtUtc = DateTime.UtcNow; item.ApprovedByUserId = UserId(); item.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct); return Ok(item);
    }

    [HttpGet("campaigns/{id:guid}/dispatch-preview")]
    public async Task<IActionResult> DispatchPreview(Guid id, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        var campaign = await _db.MarketingCampaigns.FindAsync(new object[] { id }, ct);
        if (campaign == null) return NotFound();
        if (campaign.Status is not ("approved" or "active")) return Conflict(new { message = "Root Admin approval is required before batch review." });
        var channels = JsonSerializer.Deserialize<string[]>(campaign.ChannelsJson) ?? Array.Empty<string>();
        var prospects = await FilterAudience(campaign).OrderBy(x => x.OrganizationName).ToListAsync(ct);
        var history = await _db.MarketingOutreach.AsNoTracking().Where(x => x.CampaignId == id).ToListAsync(ct);
        var rows = prospects.SelectMany(prospect => channels.Select(channel => {
            var normalized = channel.ToLowerInvariant();
            var attempts = history.Where(x => x.ProspectId == prospect.Id && x.Channel == normalized).OrderByDescending(x => x.AttemptNumber).ThenByDescending(x => x.AttemptedAtUtc).ToList();
            var last = attempts.FirstOrDefault();
            return new { prospectId = prospect.Id, prospect.OrganizationName, channel = normalized,
                recipient = normalized == "email" ? prospect.PublicEmail : normalized == "whatsapp" ? prospect.PublicWhatsapp : normalized == "sms" ? prospect.PublicPhone : prospect.Website,
                attemptCount = attempts.Count, lastStatus = last?.Status ?? "never_attempted", lastAttemptedAtUtc = last?.AttemptedAtUtc,
                lastFailureReason = last?.FailureReason, requiresDecision = true,
                recommendation = last == null ? "send" : last.Status == "failed" ? "review_retry" : last.Status == "sent" ? "review_resend" : "review" };
        })).ToList();
        return Ok(new { campaignId = id, campaign.Name, campaign.DemoVideoUrl, total = rows.Count, firstTime = rows.Count(x => x.attemptCount == 0),
            previouslySent = rows.Count(x => x.lastStatus == "sent"), previouslyFailed = rows.Count(x => x.lastStatus == "failed"), rows });
    }

    [HttpPost("campaigns/{id:guid}/dispatch")]
    public async Task<IActionResult> Dispatch(Guid id, [FromBody] DispatchInput? input, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        var campaign = await _db.MarketingCampaigns.FindAsync(new object[] { id }, ct);
        if (campaign == null) return NotFound();
        if (campaign.Status is not ("approved" or "active")) return Conflict(new { message = "Root Admin approval is required before dispatch." });
        var channels = JsonSerializer.Deserialize<string[]>(campaign.ChannelsJson) ?? Array.Empty<string>();
        var prospects = await FilterAudience(campaign).ToListAsync(ct);
        var eligibleKeys = prospects.SelectMany(p => channels.Select(c => $"{p.Id:N}:{c.ToLowerInvariant()}"))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var decisions = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var decision in input?.Decisions ?? Array.Empty<DispatchDecision>())
        {
            if (decision == null || string.IsNullOrWhiteSpace(decision.Channel) ||
                !(string.Equals(decision.Action, "send", StringComparison.OrdinalIgnoreCase) ||
                  string.Equals(decision.Action, "skip", StringComparison.OrdinalIgnoreCase)))
                return BadRequest(new { message = "Each recipient selection must specify a channel and send or skip." });
            var key = $"{decision.ProspectId:N}:{decision.Channel.ToLowerInvariant()}";
            if (!eligibleKeys.Contains(key))
                return Conflict(new { message = "The audience has changed. Refresh the recipient review before dispatch." });
            if (!decisions.TryAdd(key, decision.Action))
                return BadRequest(new { message = "Duplicate recipient selections are not allowed." });
        }
        if (!decisions.Values.Any(x => x.Equals("send", StringComparison.OrdinalIgnoreCase)))
            return BadRequest(new { message = "Select at least one recipient to send." });
        if (decisions.Any(x => x.Key.EndsWith(":whatsapp", StringComparison.OrdinalIgnoreCase) &&
                x.Value.Equals("send", StringComparison.OrdinalIgnoreCase)) && !HasWhatsAppSender())
            return Conflict(new { message = "WhatsApp dispatch is not ready. Register an approved Twilio sender and configure TWILIO_WHATSAPP_FROM or TWILIO_MESSAGING_SERVICE_SID." });
        // Cold outreach from a sending identity with no history looks exactly
        // like a spam burst to receiving mail servers/ESPs if it all fires at
        // once. Pace real provider calls instead of firing the whole batch as
        // fast as the loop can go - configurable so it can be tightened once
        // the sending domain has a track record, or loosened for small tests.
        var dispatchDelayMs = int.TryParse(_config["Marketing:DispatchDelayMs"], out var configuredDelay) ? Math.Max(0, configuredDelay) : 2000;
        var sent = 0; var queued = 0; var suppressed = 0;
        var mobileTargets = new HashSet<string>(StringComparer.Ordinal);
        foreach (var prospect in prospects)
        foreach (var channel in channels)
        {
            var attemptedExternalCall = false;
            var normalizedChannel = channel.ToLowerInvariant();
            // First-time recipients are never implicitly included. Omitted rows are skipped.
            if (!decisions.TryGetValue($"{prospect.Id:N}:{normalizedChannel}", out var action) ||
                !action.Equals("send", StringComparison.OrdinalIgnoreCase)) continue;
            var previous = await _db.MarketingOutreach
                .Where(x => x.CampaignId == id && x.ProspectId == prospect.Id && x.Channel == normalizedChannel)
                .OrderByDescending(x => x.AttemptNumber).ThenByDescending(x => x.AttemptedAtUtc).FirstOrDefaultAsync(ct);
            var attemptNumber = (previous?.AttemptNumber ?? 0) + 1;
            var renderedSubject = Merge(campaign.SubjectTemplate, prospect);
            var renderedBody = channel.Equals("email", StringComparison.OrdinalIgnoreCase)
                ? Merge(ExtractEmailBody(campaign.BodyTemplate), prospect) : Merge(campaign.SocialTemplate, prospect);
            renderedBody = AddDemoVideo(renderedBody, campaign.DemoVideoUrl, channel);
            var recipient = channel.Equals("email", StringComparison.OrdinalIgnoreCase) ? prospect.PublicEmail
                : channel.Equals("whatsapp", StringComparison.OrdinalIgnoreCase) ? prospect.PublicWhatsapp
                : channel.Equals("sms", StringComparison.OrdinalIgnoreCase) ? prospect.PublicPhone : prospect.Website;
            if (normalizedChannel is "sms" or "whatsapp") recipient = MarketingPhone.Normalize(recipient, prospect.Country);
            var outreach = new MarketingOutreach { CampaignId = id, ProspectId = prospect.Id, Channel = normalizedChannel,
                AttemptNumber = attemptNumber, Recipient = recipient, RenderedSubject = renderedSubject, RenderedBody = renderedBody,
                Status = "attempting", Provider = channel.Equals("email", StringComparison.OrdinalIgnoreCase) ? "smtp" : $"{normalizedChannel}-connector",
                AttemptedAtUtc = DateTime.UtcNow };
            _db.MarketingOutreach.Add(outreach);
            await _db.SaveChangesAsync(ct);
            var ccAddress = _config["Marketing:CcAddress"] ?? "sambitrout30@hotmail.com";
            _db.MarketingCommunicationEvents.Add(new MarketingCommunicationEvent { OutreachId = outreach.Id, EventType = "attempted", MetadataJson = JsonSerializer.Serialize(new { cc = ccAddress }) });
            await _db.SaveChangesAsync(ct);
            if (normalizedChannel is "sms" or "whatsapp" && recipient != null && mobileTargets.Contains($"{normalizedChannel}:{recipient}"))
            {
                outreach.Status = "suppressed"; outreach.CompletedAtUtc = DateTime.UtcNow;
                outreach.FailureReason = "This number was already attempted in this channel in this batch."; suppressed++;
            }
            else if (channel.Equals("email", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrWhiteSpace(prospect.PublicEmail))
            {
                attemptedExternalCall = true;
                try {
                    var publicBase = (_config["Marketing:PublicBaseUrl"] ?? "https://beta.mahimaministries.in").TrimEnd('/');
                    var openToken = _tracking.CreateToken(outreach.Id, "open");
                    var clickToken = _tracking.CreateToken(outreach.Id, "click");
                    var unsubscribeToken = _tracking.CreateToken(outreach.Id, "unsubscribe", TimeSpan.FromDays(3650));
                    var clickUrl = $"{publicBase}/api/public/marketing/track/click/{clickToken}";
                    var openUrl = $"{publicBase}/api/public/marketing/track/open/{openToken}";
                    var unsubscribeUrl = $"{publicBase}/api/public/marketing/unsubscribe/{unsubscribeToken}";
                    renderedBody = renderedBody.Replace("{{demoLink}}", clickUrl, StringComparison.OrdinalIgnoreCase)
                        .Replace("{{optOut}}", $"If you prefer not to receive further communications, <a href=\"{unsubscribeUrl}\">unsubscribe here</a> or reply UNSUBSCRIBE and we will permanently suppress your address.", StringComparison.OrdinalIgnoreCase)
                        .Replace("If you prefer not to receive further communications, reply UNSUBSCRIBE and we will permanently suppress your address.", $"If you prefer not to receive further communications, <a href=\"{unsubscribeUrl}\">unsubscribe here</a> or reply UNSUBSCRIBE and we will permanently suppress your address.", StringComparison.OrdinalIgnoreCase);
                    renderedBody = FormatEmailBody(renderedBody);
                    if (!renderedBody.Contains(clickUrl, StringComparison.OrdinalIgnoreCase))
                        renderedBody += $"<p><a href=\"{clickUrl}\">Register your church and start your one-month Mahima demonstration</a></p>";
                    renderedBody += $"<img src=\"{openUrl}\" width=\"1\" height=\"1\" alt=\"\" style=\"display:none\" />";
                    outreach.RenderedBody = renderedBody;
                    var sender = _config["Marketing:SenderContact"] ?? _config["Email:FromAddress"] ?? "sambit.rout@mahimaministries.in";
                    var replyDomain = _config["Marketing:ReplyDomain"] ?? sender.Split('@').Last();
                    var replyTo = $"marketing+{outreach.Id:N}@{replyDomain}";
                    outreach.ExternalMessageId = await _email.SendTrackedAsync(prospect.PublicEmail, renderedSubject, renderedBody, HtmlToPlainText(renderedBody), replyTo, ccAddress);
                    outreach.Status = "sent"; outreach.SentAtUtc = DateTime.UtcNow; outreach.CompletedAtUtc = DateTime.UtcNow; sent++;
                    _db.MarketingCommunicationEvents.Add(new MarketingCommunicationEvent { OutreachId = outreach.Id, EventType = "accepted", ProviderEventId = outreach.ExternalMessageId, MetadataJson = JsonSerializer.Serialize(new { cc = ccAddress }) });
                } catch (Exception ex) { outreach.Status = "failed"; outreach.CompletedAtUtc = DateTime.UtcNow; outreach.FailureReason = ex.Message[..Math.Min(2000, ex.Message.Length)]; }
            }
            else if (channel.Equals("email", StringComparison.OrdinalIgnoreCase)) { outreach.Status = "suppressed"; outreach.CompletedAtUtc = DateTime.UtcNow; outreach.FailureReason = "No approved public email."; suppressed++; }
            else if (channel.Equals("sms", StringComparison.OrdinalIgnoreCase))
            {
                if (MarketingPhone.Normalize(prospect.PublicPhone, prospect.Country, mobileOnly: true) == null) { outreach.Status = "suppressed"; outreach.CompletedAtUtc = DateTime.UtcNow; outreach.FailureReason = "No valid public mobile number. Review its country and ISD code."; suppressed++; }
                else
                {
                    attemptedExternalCall = true;
                    try
                    {
                        SmsHelper.Initialize(_config);
                        // SMS uses only the authored message: do not generate or append a tracking URL.
                        // Shared campaign templates can still use demoLink for email and WhatsApp.
                        var smsBody = renderedBody.Replace("{{demoLink}}", "", StringComparison.OrdinalIgnoreCase)
                            .Replace("{{optOut}}", "Reply STOP to opt out.", StringComparison.OrdinalIgnoreCase);
                        if (!smsBody.Contains("Reply STOP", StringComparison.OrdinalIgnoreCase)) smsBody += "\n\nReply STOP to opt out.";
                        smsBody = smsBody.Trim();
                        mobileTargets.Add($"sms:{recipient}");
                        var result = await SmsHelper.SendSmsDetailedAsync(MarketingPhone.Normalize(prospect.PublicPhone, prospect.Country, true)!, smsBody);
                        outreach.RenderedBody = smsBody;
                        if (result.Success) {
                            outreach.Status = "sent"; outreach.SentAtUtc = DateTime.UtcNow; outreach.CompletedAtUtc = DateTime.UtcNow; outreach.ExternalMessageId = result.MessageSid; sent++;
                            _db.MarketingCommunicationEvents.Add(new MarketingCommunicationEvent { OutreachId = outreach.Id, EventType = "accepted", ProviderEventId = result.MessageSid });
                        } else { outreach.Status = "failed"; outreach.CompletedAtUtc = DateTime.UtcNow; outreach.FailureReason = result.ErrorMessage; }
                    } catch (Exception ex) { outreach.Status = "failed"; outreach.CompletedAtUtc = DateTime.UtcNow; outreach.FailureReason = ex.Message[..Math.Min(2000, ex.Message.Length)]; }
                }
            }
            else if (channel.Equals("whatsapp", StringComparison.OrdinalIgnoreCase))
            {
                if (MarketingPhone.Normalize(prospect.PublicWhatsapp, prospect.Country) == null) { outreach.Status = "suppressed"; outreach.CompletedAtUtc = DateTime.UtcNow; outreach.FailureReason = "No approved public WhatsApp number."; suppressed++; }
                else if (!string.Equals(prospect.ConsentStatus, "whatsapp_opted_in", StringComparison.OrdinalIgnoreCase)) { outreach.Status = "suppressed"; outreach.CompletedAtUtc = DateTime.UtcNow; outreach.FailureReason = "Explicit WhatsApp marketing opt-in is not recorded for this prospect."; suppressed++; }
                else if (string.IsNullOrWhiteSpace(campaign.WhatsAppContentSid)) { outreach.Status = "failed"; outreach.CompletedAtUtc = DateTime.UtcNow; outreach.FailureReason = "No approved WhatsApp Content Template SID is configured for this campaign."; }
                else
                {
                    try
                    {
                        var phone = MarketingPhone.Normalize(prospect.PublicWhatsapp, prospect.Country);
                        var contactState = await _db.WhatsAppContactStates.AsNoTracking().SingleOrDefaultAsync(x => x.PhoneE164 == phone, ct);
                        if (contactState?.OptedOut == true)
                        {
                            outreach.Status = "suppressed"; outreach.CompletedAtUtc = DateTime.UtcNow;
                            outreach.FailureReason = "Recipient opted out through WhatsApp."; suppressed++;
                            await _db.SaveChangesAsync(ct);
                            continue;
                        }
                        attemptedExternalCall = true;
                        SmsHelper.Initialize(_config);
                        var publicBase = (_config["Marketing:PublicBaseUrl"] ?? "https://beta.mahimaministries.in").TrimEnd('/');
                        var webhookSecret = _config["Marketing:TwilioWebhookSecret"];
                        var statusCallback = string.IsNullOrWhiteSpace(webhookSecret) ? null : $"{publicBase}/api/public/marketing/twilio-status?key={Uri.EscapeDataString(webhookSecret)}&outreachId={outreach.Id:N}";
                        var variables = BuildWhatsAppVariables(campaign, prospect, outreach.Id);
                        mobileTargets.Add($"whatsapp:{recipient}");
                        var result = await SmsHelper.SendWhatsAppTemplateAsync(MarketingPhone.Normalize(prospect.PublicWhatsapp, prospect.Country)!, campaign.WhatsAppContentSid, variables, statusCallback);
                        if (result.Success) {
                            outreach.Status = "sent"; outreach.SentAtUtc = DateTime.UtcNow; outreach.CompletedAtUtc = DateTime.UtcNow; outreach.ExternalMessageId = result.MessageSid; sent++;
                            _db.MarketingCommunicationEvents.Add(new MarketingCommunicationEvent { OutreachId = outreach.Id, EventType = "accepted", ProviderEventId = result.MessageSid });
                        } else { outreach.Status = "failed"; outreach.CompletedAtUtc = DateTime.UtcNow; outreach.FailureReason = result.ErrorMessage; }
                    } catch (Exception ex) { outreach.Status = "failed"; outreach.CompletedAtUtc = DateTime.UtcNow; outreach.FailureReason = ex.Message[..Math.Min(2000, ex.Message.Length)]; }
                }
            }
            else { outreach.Status = "awaiting_connector"; outreach.CompletedAtUtc = DateTime.UtcNow; queued++; }
            await _db.SaveChangesAsync(ct);
            if (attemptedExternalCall && dispatchDelayMs > 0)
                await Task.Delay(dispatchDelayMs, ct);
        }
        campaign.Status = "active"; campaign.NextRunAtUtc = DateTime.UtcNow.AddDays(campaign.IntervalDays); campaign.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct); return Ok(new { sent, queuedForConfiguredConnectors = queued, suppressed });
    }

    [HttpPost("leads")]
    public async Task<IActionResult> CreateLead([FromBody] LeadInput input, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        var prospect = await _db.MarketingProspects.FindAsync(new object[] { input.ProspectId }, ct);
        if (prospect == null) return NotFound();
        var lead = await _db.MarketingLeads.SingleOrDefaultAsync(x => x.ProspectId == input.ProspectId, ct);
        if (lead == null) { lead = new MarketingLead { ProspectId = input.ProspectId }; _db.MarketingLeads.Add(lead); }
        lead.Stage = input.Stage ?? "new"; lead.Score = Math.Clamp(input.Score, 0, 100); lead.QualificationNotes = input.Notes;
        lead.OwnerUserId = input.OwnerUserId; lead.NextActionAtUtc = input.NextActionAtUtc; lead.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct); return Ok(lead);
    }

    [HttpPut("leads/{id:guid}/stage")]
    public async Task<IActionResult> MoveLead(Guid id, [FromBody] LeadStageInput input, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        string[] stages = ["new", "contacted", "engaged", "qualified", "proposal", "negotiation", "won", "lost"];
        if (!stages.Contains(input.Stage)) return BadRequest(new { message = "Invalid lead stage." });
        var lead = await _db.MarketingLeads.FindAsync(new object[] { id }, ct); if (lead == null) return NotFound();
        lead.Stage = input.Stage;
        lead.QualificationNotes = input.Notes ?? lead.QualificationNotes;
        if (input.OwnerUserId.HasValue) lead.OwnerUserId = input.OwnerUserId;
        if (input.NextActionAtUtc.HasValue) lead.NextActionAtUtc = input.NextActionAtUtc;
        lead.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct); return Ok(lead);
    }

    [HttpPost("quotes")]
    public async Task<IActionResult> CreateQuote([FromBody] QuoteInput input, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        if (!await _db.MarketingLeads.AnyAsync(x => x.Id == input.LeadId && (x.Stage == "qualified" || x.Stage == "proposal" || x.Stage == "negotiation"), ct))
            return Conflict(new { message = "The lead must be qualified before a quote is created." });
        var quote = new MarketingQuote { LeadId = input.LeadId, QuoteNumber = $"MH-{DateTime.UtcNow:yyyyMMdd}-{Random.Shared.Next(1000, 9999)}",
            Currency = input.Currency, Amount = input.Amount, LineItemsJson = JsonSerializer.Serialize(input.LineItems),
            ValidUntilUtc = input.ValidUntilUtc, Status = "draft" };
        _db.MarketingQuotes.Add(quote); await _db.SaveChangesAsync(ct); return Ok(quote);
    }

    [HttpPut("quotes/{id:guid}/approve-send")]
    public async Task<IActionResult> ApproveAndSendQuote(Guid id, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        var quote = await _db.MarketingQuotes.Include(x => x.Lead)!.ThenInclude(x => x!.Prospect).SingleOrDefaultAsync(x => x.Id == id, ct);
        if (quote == null) return NotFound(); var email = quote.Lead?.Prospect?.PublicEmail;
        if (string.IsNullOrWhiteSpace(email)) return Conflict(new { message = "The prospect has no approved public email." });
        quote.Status = "approved"; quote.ApprovedAtUtc = DateTime.UtcNow;
        var link = $"{Request.Scheme}://{Request.Host}/api/admin/marketing/quotes/accept/{quote.AcceptanceToken}";
        await _email.SendAsync(email, $"Mahima proposal {quote.QuoteNumber}", $"<p>Please review proposal <strong>{quote.QuoteNumber}</strong> for {quote.Currency} {quote.Amount:N2}.</p><p><a href=\"{link}\">Accept proposal and begin the one-month demonstration</a></p>", ccEmail: _config["Marketing:CcAddress"] ?? "sambitrout30@hotmail.com");
        quote.Status = "sent"; quote.SentAtUtc = DateTime.UtcNow; await _db.SaveChangesAsync(ct); return Ok(quote);
    }

    [AllowAnonymous]
    [HttpGet("quotes/accept/{token}")]
    public async Task<IActionResult> AcceptQuote(string token, CancellationToken ct)
    {
        var quote = await _db.MarketingQuotes.Include(x => x.Order).SingleOrDefaultAsync(x => x.AcceptanceToken == token, ct);
        if (quote == null || quote.ValidUntilUtc < DateTime.UtcNow) return NotFound("Quote not found or expired.");
        if (quote.Status != "accepted") { quote.Status = "accepted"; quote.AcceptedAtUtc = DateTime.UtcNow;
            quote.Order ??= new MarketingOrder { QuoteId = quote.Id, Status = "customer_accepted" }; await _db.SaveChangesAsync(ct); }
        var html = $@"<!doctype html><html><head><meta charset=""utf-8""><meta name=""viewport"" content=""width=device-width,initial-scale=1""><title>Proposal accepted — Mahima Ministries</title>
<style>body{{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f1f5f9;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}}
.card{{max-width:32rem;background:#fff;border-radius:1.5rem;overflow:hidden;box-shadow:0 20px 40px rgba(0,0,0,.12)}}
.hero{{background:linear-gradient(90deg,#022c22,#115e59);color:#fff;padding:2rem}}.hero h1{{margin:.5rem 0 0;font-size:1.5rem}}
.body{{padding:2rem;color:#334155}}.body p{{line-height:1.6}}.badge{{display:inline-block;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:999px;padding:.25rem .75rem;font-size:.75rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase}}</style>
</head><body><div class=""card""><div class=""hero""><span class=""badge"">Proposal {WebUtility.HtmlEncode(quote.QuoteNumber)}</span><h1>Thank you — your acceptance was recorded</h1></div>
<div class=""body""><p>Mahima Ministries has received your acceptance of proposal <strong>{WebUtility.HtmlEncode(quote.QuoteNumber)}</strong>.</p>
<p>Our team will provision your one-month, all-feature demonstration account and be in touch with your login details shortly.</p>
<p>If you have any questions in the meantime, simply reply to the proposal email you received.</p></div></div></body></html>";
        return Content(html, "text/html");
    }

    [HttpPost("orders/{id:guid}/activate-demo")]
    public async Task<IActionResult> ActivateDemo(Guid id, [FromBody] DemoInput input, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        var order = await _db.MarketingOrders.Include(x => x.Quote).SingleOrDefaultAsync(x => x.Id == id, ct);
        var tenant = await _db.Tenants.FindAsync(new object[] { input.TenantId }, ct);
        if (order == null || tenant == null) return NotFound();
        if (order.Status != "customer_accepted") return Conflict(new { message = "Customer acceptance is required before demo activation." });
        var now = DateTime.UtcNow; var end = now.AddMonths(1);
        var modules = await _db.ModuleCatalog.Where(x => x.Enabled).ToListAsync(ct);
        foreach (var module in modules)
        {
            var active = await _db.TenantModuleLicenses.FirstOrDefaultAsync(x => x.TenantId == tenant.Id && x.ModuleCode == module.Code && x.Status == "active", ct);
            if (active == null) _db.TenantModuleLicenses.Add(new TenantModuleLicense { TenantId = tenant.Id, ModuleCode = module.Code, Status = "active", PriceInr = 0, Source = "marketing_demo", StartsAtUtc = now, EndsAtUtc = end });
            else if (active.EndsAtUtc < end) active.EndsAtUtc = end;
        }
        order.TenantId = tenant.Id; order.Status = "demo_active"; order.DemoStartsAtUtc = now; order.DemoEndsAtUtc = end; order.UpdatedAtUtc = now;
        await _db.SaveChangesAsync(ct); return Ok(new { orderId = order.Id, order.Status, tenantId = tenant.Id, tenant.Slug, order.DemoStartsAtUtc, order.DemoEndsAtUtc });
    }

    [HttpPut("prospects/{id:guid}/suppress")]
    public async Task<IActionResult> Suppress(Guid id, CancellationToken ct)
    {
        if (!await IsRootAsync(ct)) return Forbid();
        var p = await _db.MarketingProspects.FindAsync(new object[] { id }, ct); if (p == null) return NotFound();
        p.DoNotContact = true; p.ConsentStatus = "opted_out"; p.Status = "suppressed"; p.UpdatedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct); return Ok(p);
    }

    private async Task<bool> IsRootAsync(CancellationToken ct) => (await _tenantContext.GetCurrentTenantAsync(ct))?.IsRootTenant == true;
    private Guid? UserId() => Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"), out var id) ? id : null;

    private string? Setting(string configurationKey, string environmentKey)
    {
        var environmentValue = Environment.GetEnvironmentVariable(environmentKey);
        return !string.IsNullOrWhiteSpace(environmentValue) ? environmentValue : _config[configurationKey];
    }

    private static string? ValidatePhones(ProspectInput input)
    {
        if (!string.IsNullOrWhiteSpace(input.PublicPhone) && MarketingPhone.Normalize(input.PublicPhone, input.Country) == null)
            return "Enter a valid public phone with an ISD code, or select its country for a local number.";
        if (!string.IsNullOrWhiteSpace(input.PublicWhatsapp) && MarketingPhone.Normalize(input.PublicWhatsapp, input.Country) == null)
            return "Enter a valid WhatsApp number with an ISD code, or select its country for a local number.";
        return null;
    }

    private async Task<bool> PhoneExists(string? phone, string? whatsapp, CancellationToken ct)
    {
        if (phone == null && whatsapp == null) return false;
        var contacts = await _db.MarketingProspects.AsNoTracking().Select(x => new { x.PublicPhone, x.PublicWhatsapp, x.Country }).ToListAsync(ct);
        return contacts.Any(x => new[] { MarketingPhone.Normalize(x.PublicPhone, x.Country), MarketingPhone.Normalize(x.PublicWhatsapp, x.Country) }
            .Any(n => n != null && (n == phone || n == whatsapp)));
    }

    private bool HasWhatsAppSender()
        => !string.IsNullOrWhiteSpace(Setting("Twilio:WhatsAppFrom", "TWILIO_WHATSAPP_FROM"))
            || !string.IsNullOrWhiteSpace(Setting("Twilio:MessagingServiceSid", "TWILIO_MESSAGING_SERVICE_SID"));

    private static string? MaskSender(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var normalized = value.Replace("whatsapp:", "", StringComparison.OrdinalIgnoreCase).Trim();
        return normalized.Length <= 4 ? normalized : $"***{normalized[^4..]}";
    }

    private static readonly JsonSerializerOptions AudienceJsonOptions = new(JsonSerializerDefaults.Web);

    private static string? ValidateChannels(string[] channels, string? socialBody, string? whatsAppContentSid)
    {
        var normalized = (channels ?? Array.Empty<string>()).Select(c => c.ToLowerInvariant()).Distinct().ToArray();
        if (normalized.Any(c => c != "email") && string.IsNullOrWhiteSpace(socialBody))
            return "A message body is required when any non-email channel is selected.";
        if (normalized.Contains("whatsapp") && string.IsNullOrWhiteSpace(whatsAppContentSid))
            return "An approved Twilio WhatsApp Content Template SID is required when the WhatsApp channel is selected.";
        return null;
    }

    private IQueryable<MarketingProspect> FilterAudience(MarketingCampaign campaign)
    {
        AudienceFilter? filter;
        try { filter = JsonSerializer.Deserialize<AudienceFilter>(campaign.AudienceJson, AudienceJsonOptions); } catch { filter = null; }
        return ApplyAudienceFilter(filter);
    }

    private IQueryable<MarketingProspect> ApplyAudienceFilter(AudienceFilter? filter)
    {
        var query = _db.MarketingProspects.Where(x => x.Status == "approved" && !x.DoNotContact);
        if (filter == null) return query;
        if (filter.Countries is { Length: > 0 } countries) query = query.Where(x => x.Country != null && countries.Contains(x.Country));
        if (!string.IsNullOrWhiteSpace(filter.State)) query = query.Where(x => (x.State ?? "").ToLower() == filter.State.Trim().ToLower());
        if (!string.IsNullOrWhiteSpace(filter.City)) query = query.Where(x => (x.City ?? "").ToLower() == filter.City.Trim().ToLower());
        if (filter.ContactChannel == "sms") query = query.Where(x => x.PublicPhone != null && x.PublicPhone != "");
        if (filter.ContactChannel == "whatsapp") query = query.Where(x => x.PublicWhatsapp != null && x.PublicWhatsapp != "");
        if (filter.MinScore is int min && min > 0) query = query.Where(x => x.Score >= min);
        if (!string.IsNullOrWhiteSpace(filter.Denomination))
        {
            var keyword = filter.Denomination.Trim().ToLowerInvariant();
            query = query.Where(x => (x.Denomination ?? "").ToLower().Contains(keyword) || (x.AiSummary ?? "").ToLower().Contains(keyword));
        }
        if (filter.OnlyNeverContacted == true) query = query.Where(x => !_db.MarketingOutreach.Any(o => o.ProspectId == x.Id));
        return query;
    }

    private Dictionary<string, string> BuildWhatsAppVariables(MarketingCampaign campaign, MarketingProspect prospect, Guid outreachId)
    {
        var raw = string.IsNullOrWhiteSpace(campaign.WhatsAppContentVariablesJson)
            ? new Dictionary<string, string>()
            : JsonSerializer.Deserialize<Dictionary<string, string>>(campaign.WhatsAppContentVariablesJson, AudienceJsonOptions) ?? new();
        var publicBase = (_config["Marketing:PublicBaseUrl"] ?? "https://beta.mahimaministries.in").TrimEnd('/');
        var clickUrl = $"{publicBase}/api/public/marketing/track/click/{_tracking.CreateToken(outreachId, "click")}";
        if (raw.Count == 0)
        {
            raw["1"] = "{{contact}}";
            raw["2"] = "{{church}}";
            raw["3"] = "{{demoLink}}";
        }
        var result = new Dictionary<string, string>();
        foreach (var (key, template) in raw)
            result[key] = Merge(template, prospect)
                .Replace("{{demoLink}}", clickUrl, StringComparison.OrdinalIgnoreCase)
                .Replace("{{optOut}}", "Reply STOP to opt out.", StringComparison.OrdinalIgnoreCase);
        return result;
    }

    public sealed record AudienceFilter(string[]? Countries, int? MinScore, string? Denomination, bool? OnlyNeverContacted, string? State = null, string? City = null, string? ContactChannel = null);
    private string Merge(string template, MarketingProspect p)
    {
        var cleanContact = CleanContactName(p.ContactName);
        var contact = string.IsNullOrWhiteSpace(cleanContact) ? $"Leader of {p.OrganizationName}" : cleanContact;
        var senderName = _config["Marketing:SenderName"] ?? "Sambit Rout";
        var senderPosition = _config["Marketing:SenderPosition"] ?? "Root Administrator";
        var company = _config["Marketing:Company"] ?? "Mahima Ministries";
        var senderContact = _config["Marketing:SenderContact"] ?? _config["Email:FromAddress"] ?? "sambit.rout@mahimaministries.in";
        return template
            .Replace("{{church}}", p.OrganizationName, StringComparison.OrdinalIgnoreCase)
            .Replace("{{contact}}", contact, StringComparison.OrdinalIgnoreCase)
            .Replace("{{country}}", p.Country ?? "", StringComparison.OrdinalIgnoreCase)
            .Replace("{{senderName}}", senderName, StringComparison.OrdinalIgnoreCase)
            .Replace("{{senderPosition}}", senderPosition, StringComparison.OrdinalIgnoreCase)
            .Replace("{{company}}", company, StringComparison.OrdinalIgnoreCase)
            .Replace("{{senderContact}}", senderContact, StringComparison.OrdinalIgnoreCase)
            .Replace("[Recipient's Name]", contact, StringComparison.OrdinalIgnoreCase)
            .Replace("[Recipient Name]", contact, StringComparison.OrdinalIgnoreCase)
            .Replace("[Your Name]", senderName, StringComparison.OrdinalIgnoreCase)
            .Replace("[Your Position]", senderPosition, StringComparison.OrdinalIgnoreCase)
            .Replace("[Your Company]", company, StringComparison.OrdinalIgnoreCase)
            .Replace("[Your Contact Information]", senderContact, StringComparison.OrdinalIgnoreCase)
            .Replace("please click here to opt-out", "reply UNSUBSCRIBE and we will permanently suppress your address", StringComparison.OrdinalIgnoreCase);
    }
    private static string FormatEmailBody(string value)
    {
        var hasHtml = System.Text.RegularExpressions.Regex.IsMatch(value, @"<\s*(?:p|br|div|a|strong|em|ul|ol|li)\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        var html = hasHtml ? value : WebUtility.HtmlEncode(value);
        html = System.Text.RegularExpressions.Regex.Replace(html, @"\[([^\]]+)\]\((https?://[^\s)]+)\)", match =>
        {
            var label = match.Groups[1].Value;
            var url = WebUtility.HtmlDecode(match.Groups[2].Value);
            return $"<a href=\"{WebUtility.HtmlEncode(url)}\">{label}</a>";
        }, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return html.Replace("\r\n", "\n").Replace("\n", "<br/>\n");
    }
    private static string HtmlToPlainText(string value)
    {
        var withLinks = System.Text.RegularExpressions.Regex.Replace(value, @"<a\s+[^>]*href=[""']([^""']+)[""'][^>]*>(.*?)</a>",
            match => $"{System.Text.RegularExpressions.Regex.Replace(match.Groups[2].Value, "<[^>]+>", string.Empty)} ({WebUtility.HtmlDecode(match.Groups[1].Value)})",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.Singleline);
        withLinks = System.Text.RegularExpressions.Regex.Replace(withLinks, @"<img\b[^>]*>", string.Empty, System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        withLinks = System.Text.RegularExpressions.Regex.Replace(withLinks, @"<br\s*/?>|</p>|</div>|</li>", "\n", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return WebUtility.HtmlDecode(System.Text.RegularExpressions.Regex.Replace(withLinks, "<[^>]+>", string.Empty)).Trim();
    }
    private static string? CleanContactName(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var cleaned = System.Text.RegularExpressions.Regex.Replace(value.Trim(),
            @"\s+[—–-]\s+(?:name\s+listed|listed\s+on|source|from\s+the\s+site|as\s+published).*$", "",
            System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return cleaned.Trim().TrimEnd(',', ';', '-', '—', '–');
    }
    private static (string Subject, string EmailBody, string SocialPost) ParseCampaignDraft(string value)
    {
        var cleaned = value.Trim();
        if (cleaned.StartsWith("```")) cleaned = cleaned[(cleaned.IndexOf('\n') + 1)..];
        if (cleaned.EndsWith("```")) cleaned = cleaned[..^3];
        try
        {
            using var json = JsonDocument.Parse(cleaned);
            var root = json.RootElement;
            string Read(params string[] names) { foreach (var name in names) if (root.TryGetProperty(name, out var item) && item.ValueKind == JsonValueKind.String) return item.GetString() ?? ""; return ""; }
            return (Read("subject"), Read("emailBody", "email_body", "body"), Read("socialPost", "social_post"));
        }
        catch { return ("", value, ""); }
    }
    private static string ExtractEmailBody(string value)
    {
        var parsed = ParseCampaignDraft(value);
        return string.IsNullOrWhiteSpace(parsed.EmailBody) ? value : parsed.EmailBody;
    }

    public sealed record ProspectInput(string OrganizationName, string? Country, string? Website, string? ContactName, string? PublicEmail, string? PublicPhone, string? PublicWhatsapp, string SourceUrl, string? ContactBasis, string? ConsentStatus, string? Denomination = null, string? State = null, string? City = null);
    public sealed record ProspectReview(bool Approved, bool DoNotContact, string? ConsentStatus);
    public sealed record AiCampaignInput(string Audience, string Objective, string Countries, string? Language = null);
    private static string? NormalizePublicVideoUrl(string? value)
    {
        var raw = value?.Trim();
        if (string.IsNullOrWhiteSpace(raw)) return null;
        return Uri.TryCreate(raw, UriKind.Absolute, out var uri)
            && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp)
            && !string.IsNullOrWhiteSpace(uri.Host)
                ? uri.AbsoluteUri
                : null;
    }

    private static string AddDemoVideo(string body, string? videoUrl, string channel)
    {
        if (channel.Equals("sms", StringComparison.OrdinalIgnoreCase)) return body;
        if (string.IsNullOrWhiteSpace(videoUrl) || body.Contains(videoUrl, StringComparison.OrdinalIgnoreCase)) return body;
        if (channel.Equals("email", StringComparison.OrdinalIgnoreCase))
        {
            var safeUrl = System.Net.WebUtility.HtmlEncode(videoUrl);
            return $"{body}<p><strong>Watch the Mahima demo video:</strong><br><a href=\"{safeUrl}\" target=\"_blank\" rel=\"noopener noreferrer\">Open demo video</a></p>";
        }
        return $"{body.TrimEnd()}\n\nWatch the Mahima demo video: {videoUrl}";
    }

    public sealed record CampaignInput(string Name, string Objective, string[] Channels, object Audience, string Subject, string Body, string? SocialBody, string? DemoVideoUrl, int IntervalDays, DateTime? NextRunAtUtc, string? Language = null, string? WhatsAppContentSid = null, object? WhatsAppContentVariables = null);
    public sealed record LeadInput(Guid ProspectId, string? Stage, int Score, string? Notes, Guid? OwnerUserId, DateTime? NextActionAtUtc);
    public sealed record LeadStageInput(string Stage, string? Notes, DateTime? NextActionAtUtc = null, Guid? OwnerUserId = null);
    public sealed record QuoteInput(Guid LeadId, string Currency, decimal Amount, object[] LineItems, DateTime ValidUntilUtc);
    public sealed record DemoInput(Guid TenantId);
    public sealed record DiscoveryInput(string Regions, string? Languages, int MaxProspects, string ContactFocus = "all");
    public sealed record DiscoveryScheduleInput(Guid? Id, string Name, string Regions, string Languages, int MaxProspects, int IntervalDays, DateTime? NextRunAtUtc, string ContactFocus = "all");
    public sealed record ScheduleApproval(bool Enabled);
    public sealed record DispatchInput(DispatchDecision[] Decisions);
    public sealed record DispatchDecision(Guid ProspectId, string Channel, string Action);
    public sealed record WhatsAppTemplateTestInput(string ToPhone, string ContentSid, Dictionary<string, string>? Variables);
}
