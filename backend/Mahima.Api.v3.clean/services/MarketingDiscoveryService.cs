using Mahima.Api.v3.clean.Helpers;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Models;
using Microsoft.EntityFrameworkCore;

namespace Mahima.Api.v3.clean.Services;

public interface IMarketingDiscoveryService
{
    Task<MarketingDiscoveryRun> RunAsync(string regions, string languages, int maximum, string trigger, Guid? scheduleId, CancellationToken ct, string contactFocus = "all");
}

public sealed class MarketingDiscoveryService : IMarketingDiscoveryService
{
    private readonly MahimaDbContext _db;
    private readonly IHttpClientFactory _clients;
    private readonly IConfiguration _config;
    private readonly ILogger<MarketingDiscoveryService> _logger;
    public MarketingDiscoveryService(MahimaDbContext db, IHttpClientFactory clients, IConfiguration config, ILogger<MarketingDiscoveryService> logger)
        => (_db, _clients, _config, _logger) = (db, clients, config, logger);

    public async Task<MarketingDiscoveryRun> RunAsync(string regions, string languages, int maximum, string trigger, Guid? scheduleId, CancellationToken ct, string contactFocus = "all")
    {
        maximum = Math.Clamp(maximum, 1, 100);
        var run = new MarketingDiscoveryRun { ScheduleId = scheduleId, Trigger = trigger, Regions = regions, Status = "running" };
        _db.MarketingDiscoveryRuns.Add(run); await _db.SaveChangesAsync(ct);
        try
        {
            var key = (_config["PastorBot:ApiKey"] ?? _config["PastorBot:OpenAiApiKey"] ?? "").Trim();
            var baseUrl = (_config["PastorBot:BaseUrl"] ?? "https://api.openai.com/v1").TrimEnd('/');
            if (!baseUrl.Contains("api.openai.com", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("AI web discovery requires an OpenAI Responses API endpoint with the web_search tool.");
            if (string.IsNullOrWhiteSpace(key)) throw new InvalidOperationException("PastorBot API key is not configured.");
            var model = _config["MarketingDiscovery:Model"] ?? "gpt-5-mini";
            var prompt = $"""
                Research public websites for up to {maximum} churches or Christian ministry organizations in: {regions}.
                Prefer organizations likely to benefit from multi-tenant church administration, member management,
                ministry workflows, communications, and reporting. Languages: {languages}.

                Return ONLY a JSON array. Each item must contain:
                organizationName, country, state, city, website, contactName, publicEmail, publicPhone, publicWhatsapp,
                denomination, sourceUrl, contactBasis, confidence, evidence.

                denomination is the church/ministry's tradition or affiliation if explicitly published
                (for example Catholic, Baptist, Pentecostal, Methodist, Orthodox, non-denominational) — use null if not stated.

                Contact focus: {contactFocus}. For mobile focus, prioritize published mobile and WhatsApp business
                contacts, including churches without email. Return a separate item for each distinct published mobile.
                Use country names, state/province and city from the source. Return phone numbers in international
                E.164 format with their country calling (ISD) code. Do not assume a landline is mobile or a mobile
                has WhatsApp: publicWhatsapp requires explicit WhatsApp evidence on the source page.
                Evidence should describe observable fit (branches, ministries, events, giving, member programs).
                Never claim they are looking for software without explicit published evidence.

                Rules:
                - Use only contact details explicitly published on the organization's own public website or official public profile.
                - sourceUrl must be the exact public page supporting the organization/contact details.
                - Never infer, generate, buy, or guess an email/phone/WhatsApp address.
                - Use null when a field is not published.
                - Exclude personal/private contacts, scraped people directories, data brokers and organizations without a verifiable source URL.
                - This is research only. Do not contact anyone.
                """;
            var payload = new { model, store = false, tools = new[] { new { type = "web_search" } }, input = prompt };
            var client = _clients.CreateClient("MarketingDiscovery");
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/responses");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
            request.Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
            using var response = await client.SendAsync(request, ct);
            var raw = await response.Content.ReadAsStringAsync(ct);
            if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"Discovery API returned {(int)response.StatusCode}: {Safe(raw)}");
            using var responseJson = JsonDocument.Parse(raw);
            var text = ExtractOutputText(responseJson.RootElement);
            var candidates = ParseCandidates(text);
            run.CandidatesFound = candidates.Count; run.Provider = "openai-responses-web-search"; run.Model = model;
            var existing = await _db.MarketingProspects.AsNoTracking().ToListAsync(ct);
            var phones = existing.SelectMany(x => new[] { MarketingPhone.Normalize(x.PublicPhone, x.Country), MarketingPhone.Normalize(x.PublicWhatsapp, x.Country) })
                .Where(x => x != null).ToHashSet(StringComparer.Ordinal);
            var emails = existing.Where(x => !string.IsNullOrWhiteSpace(x.PublicEmail)).Select(x => x.PublicEmail!.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
            foreach (var candidate in candidates.Take(maximum))
            {
                if (string.IsNullOrWhiteSpace(candidate.OrganizationName) || !IsPublicHttpUrl(candidate.SourceUrl)) { run.CandidatesSkipped++; continue; }
                var normalizedEmail = candidate.PublicEmail?.Trim().ToLowerInvariant();
                var phone = MarketingPhone.Normalize(candidate.PublicPhone, candidate.Country, mobileOnly: contactFocus == "mobile");
                var whatsapp = MarketingPhone.Normalize(candidate.PublicWhatsapp, candidate.Country);
                if (phone == null && whatsapp == null && string.IsNullOrWhiteSpace(normalizedEmail)) { run.CandidatesSkipped++; continue; }
                if (contactFocus == "mobile" && phone == null && whatsapp == null) { run.CandidatesSkipped++; continue; }
                var hadNumber = phone != null || whatsapp != null;
                if (phone != null && phones.Contains(phone)) phone = null;
                if (whatsapp != null && phones.Contains(whatsapp)) whatsapp = null;
                // Keep a new alternate number even if another number on this source was already imported.
                if (phone == null && whatsapp == null && (hadNumber || (normalizedEmail != null && emails.Contains(normalizedEmail))))
                { run.CandidatesSkipped++; continue; }
                if (phone != null) phones.Add(phone);
                if (whatsapp != null) phones.Add(whatsapp);
                if (normalizedEmail != null && !emails.Add(normalizedEmail)) normalizedEmail = null;
                _db.MarketingProspects.Add(new MarketingProspect {
                    OrganizationName = candidate.OrganizationName.Trim(), Country = MarketingPhone.Country(candidate.Country), State = candidate.State, City = candidate.City, Website = candidate.Website,
                    ContactName = candidate.ContactName, PublicEmail = normalizedEmail, PublicPhone = phone,
                    PublicWhatsapp = whatsapp, Denomination = candidate.Denomination, SourceUrl = candidate.SourceUrl, SourceRetrievedAtUtc = DateTime.UtcNow,
                    ContactBasis = candidate.ContactBasis ?? "public-business-contact", ConsentStatus = "unknown", Status = "draft",
                    Score = NormalizeConfidence(candidate.Confidence), AiSummary = candidate.Evidence
                });
                run.CandidatesImported++;
            }
            run.Status = "completed"; run.CompletedAtUtc = DateTime.UtcNow; await _db.SaveChangesAsync(ct);
        }
        catch (OperationCanceledException ex) when (!ct.IsCancellationRequested)
        {
            _logger.LogError(ex, "Marketing discovery run {RunId} exceeded the configured HTTP timeout", run.Id);
            run.Status = "failed";
            run.Error = "The AI web-search run exceeded eight minutes. Reduce the maximum prospects or narrow the regions and retry.";
            run.CompletedAtUtc = DateTime.UtcNow;
            await _db.SaveChangesAsync(CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Marketing discovery run {RunId} failed", run.Id);
            run.Status = "failed"; run.Error = Safe(ex.Message); run.CompletedAtUtc = DateTime.UtcNow; await _db.SaveChangesAsync(CancellationToken.None);
        }
        return run;
    }

    private static string ExtractOutputText(JsonElement root)
    {
        if (root.TryGetProperty("output_text", out var direct) && direct.ValueKind == JsonValueKind.String) return direct.GetString() ?? "[]";
        var values = new List<string>();
        if (root.TryGetProperty("output", out var output) && output.ValueKind == JsonValueKind.Array)
            foreach (var item in output.EnumerateArray())
                if (item.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.Array)
                    foreach (var part in content.EnumerateArray())
                        if (part.TryGetProperty("text", out var text) && text.ValueKind == JsonValueKind.String) values.Add(text.GetString() ?? "");
        return string.Join("\n", values);
    }
    private static List<DiscoveredProspect> ParseCandidates(string value)
    {
        var cleaned = value.Trim();
        if (cleaned.StartsWith("```")) cleaned = cleaned[(cleaned.IndexOf('\n') + 1)..];
        if (cleaned.EndsWith("```")) cleaned = cleaned[..^3];
        var start = cleaned.IndexOf('['); var end = cleaned.LastIndexOf(']');
        if (start < 0 || end <= start) throw new InvalidOperationException("Discovery returned no readable prospect array. Narrow the geography and retry.");
        return JsonSerializer.Deserialize<List<DiscoveredProspect>>(cleaned[start..(end + 1)], new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
    }
    private static bool IsPublicHttpUrl(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri) && (uri.Scheme == "https" || uri.Scheme == "http");
    private static string Safe(string value) => value.Length > 1000 ? value[..1000] : value;
    private static int NormalizeConfidence(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var numeric))
            return Math.Clamp((int)Math.Round(numeric <= 1 ? numeric * 100 : numeric), 0, 100);
        if (value.ValueKind == JsonValueKind.String)
        {
            var text = (value.GetString() ?? "").Trim().TrimEnd('%').ToLowerInvariant();
            if (double.TryParse(text, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsed))
                return Math.Clamp((int)Math.Round(parsed <= 1 ? parsed * 100 : parsed), 0, 100);
            return text switch { "very high" => 95, "high" => 85, "medium" or "moderate" => 65, "low" => 35, "very low" => 15, _ => 50 };
        }
        return 50;
    }
    private sealed class DiscoveredProspect { public string OrganizationName { get; set; } = ""; public string? Country { get; set; } public string? State { get; set; } public string? City { get; set; } public string? Website { get; set; } public string? ContactName { get; set; } public string? PublicEmail { get; set; } public string? PublicPhone { get; set; } public string? PublicWhatsapp { get; set; } public string? Denomination { get; set; } public string? SourceUrl { get; set; } public string? ContactBasis { get; set; } public JsonElement Confidence { get; set; } public string? Evidence { get; set; } }
}

public sealed class MarketingDiscoveryScheduler : BackgroundService
{
    private readonly IServiceScopeFactory _scopes;
    private readonly ILogger<MarketingDiscoveryScheduler> _logger;
    public MarketingDiscoveryScheduler(IServiceScopeFactory scopes, ILogger<MarketingDiscoveryScheduler> logger) => (_scopes, _logger) = (scopes, logger);
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var scope = _scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<MahimaDbContext>();
                var discovery = scope.ServiceProvider.GetRequiredService<IMarketingDiscoveryService>();
                var now = DateTime.UtcNow;
                var due = await db.MarketingDiscoverySchedules.Where(x => x.Enabled && x.ApprovedAtUtc != null && x.NextRunAtUtc <= now).ToListAsync(stoppingToken);
                foreach (var schedule in due)
                {
                    await discovery.RunAsync(schedule.Regions, schedule.Languages, schedule.MaxProspectsPerRun, "scheduled", schedule.Id, stoppingToken, schedule.ContactFocus);
                    schedule.LastRunAtUtc = now; schedule.NextRunAtUtc = now.AddDays(schedule.IntervalDays); schedule.UpdatedAtUtc = DateTime.UtcNow;
                    await db.SaveChangesAsync(stoppingToken);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch (Exception ex) { _logger.LogError(ex, "Scheduled marketing discovery polling failed."); }
            await Task.Delay(TimeSpan.FromMinutes(15), stoppingToken);
        }
    }
}
