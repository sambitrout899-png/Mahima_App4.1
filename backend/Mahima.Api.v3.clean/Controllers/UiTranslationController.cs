using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.EntityFrameworkCore;
using Mahima.Api.v3.clean.Data;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/ui-translation")]
    public class UiTranslationController : ControllerBase
    {
        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IConfiguration _config;
        private readonly ILogger<UiTranslationController> _logger;
        private readonly MahimaDbContext _db;
        private readonly IMemoryCache _cache;

        public UiTranslationController(IHttpClientFactory httpClientFactory, IConfiguration config, ILogger<UiTranslationController> logger, MahimaDbContext db, IMemoryCache cache)
        {
            _httpClientFactory = httpClientFactory;
            _config = config;
            _logger = logger;
            _db = db;
            _cache = cache;
        }

        public class UiTranslationRequest
        {
            public string? Language { get; set; }
            public string? LanguageName { get; set; }
            public List<string>? Texts { get; set; }
        }

        public class UiTranslationResponse
        {
            public string Language { get; set; } = "en";
            public Dictionary<string, string> Translations { get; set; } = new();
        }

        [HttpPost("batch")]
        [RequestSizeLimit(64_000)]
        public async Task<ActionResult<UiTranslationResponse>> Batch([FromBody] UiTranslationRequest request, CancellationToken ct)
        {
            var language = NormalizeLanguage(request?.Language);
            if (language == null) return BadRequest(new { message = "A valid language code is required." });
            var configuredLanguage = await _db.AppLanguages.AsNoTracking()
                .FirstOrDefaultAsync(l => l.Code == language && l.Enabled, ct);
            if (configuredLanguage == null) return BadRequest(new { message = "That language is not enabled." });
            var texts = (request?.Texts ?? new List<string>())
                .Select(NormalizeText)
                .Where(IsSafeUiText)
                .Distinct(StringComparer.Ordinal)
                .Take(80)
                .ToList();

            var response = new UiTranslationResponse { Language = language };
            if (texts.Count == 0) return Ok(response);

            if (language == "en")
            {
                response.Translations = texts.ToDictionary(text => text, text => text, StringComparer.Ordinal);
                return Ok(response);
            }

            var languageName = configuredLanguage.Name;
            var cached = new Dictionary<string, string>(StringComparer.Ordinal);
            var missing = new List<string>();
            foreach (var text in texts)
            {
                if (_cache.TryGetValue<string>($"ui-translation:{language}:{text}", out var value) && !string.IsNullOrWhiteSpace(value))
                    cached[text] = value;
                else missing.Add(text);
            }
            if (missing.Count == 0)
            {
                response.Translations = cached;
                return Ok(response);
            }
            var prompt = BuildPrompt(languageName, missing);

            try
            {
                var answer = await TranslateWithConfiguredAiAsync(prompt, ct);
                var parsed = ParseTranslationMap(answer, missing);
                foreach (var pair in parsed)
                    _cache.Set($"ui-translation:{language}:{pair.Key}", pair.Value, TimeSpan.FromDays(30));
                response.Translations = texts.ToDictionary(
                    text => text,
                    text => cached.TryGetValue(text, out var cachedValue) ? cachedValue :
                        parsed.TryGetValue(text, out var translated) && !string.IsNullOrWhiteSpace(translated) ? translated.Trim() : text,
                    StringComparer.Ordinal);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "UI translation failed for language {Language}", language);
                response.Translations = texts.ToDictionary(text => text, text => text, StringComparer.Ordinal);
            }

            return Ok(response);
        }

        private static string? NormalizeLanguage(string? language)
        {
            var value = (language ?? "en").Trim().ToLowerInvariant();
            return Regex.IsMatch(value, "^[a-z]{2,3}(?:-[a-z0-9]{2,4})?$") ? value : null;
        }

        private static string NormalizeText(string? text) =>
            Regex.Replace(text ?? string.Empty, @"\s+", " ").Trim();

        private static bool IsSafeUiText(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return false;
            if (text.Length < 2 || text.Length > 260) return false;
            if (Regex.IsMatch(text, @"https?://|www\.|@")) return false;
            if (Regex.IsMatch(text, @"^[\d\s.,:/\\\-+()%$#]+$")) return false;
            if (Regex.IsMatch(text, @"^\+?\d[\d\s()\-]{6,}$")) return false;
            if (Regex.IsMatch(text, @"^(MHN|INV|TXN|JE|GL|GST|PAN|TAN|IFSC)[A-Z0-9_-]*$", RegexOptions.IgnoreCase)) return false;
            return true;
        }

        private static string BuildPrompt(string languageName, IReadOnlyList<string> texts)
        {
            var json = JsonSerializer.Serialize(texts);
            return
                "You are a product-localization engine for a church management application. " +
                $"Translate each UI label, heading, button, placeholder, and help sentence into {languageName}. " +
                "Keep ministry names, person names, IDs, amounts, dates, URLs, and placeholders unchanged. " +
                "Preserve the meaning and keep the output concise enough for buttons and forms. " +
                "Return ONLY valid JSON in this exact shape: {\"translations\":{\"original\":\"translated\"}}. " +
                "Do not add markdown or explanation. Input texts JSON array: " + json;
        }

        private async Task<string?> TranslateWithConfiguredAiAsync(string prompt, CancellationToken ct)
        {
            var apiKey = _config["PastorBot:ApiKey"] ?? _config["PastorBot:OpenAiApiKey"];
            if (string.IsNullOrWhiteSpace(apiKey)) return null;

            var model = _config["PastorBot:Model"] ?? "gpt-4.1";
            var endpoint = _config["PastorBot:Endpoint"] ?? "https://api.openai.com/v1/responses";
            var client = _httpClientFactory.CreateClient("PastorBot");
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);

            var payload = new
            {
                model,
                input = new object[]
                {
                    new
                    {
                        role = "system",
                        content = "You translate application UI text only. Return strict JSON only. Do not answer pastorally."
                    },
                    new { role = "user", content = prompt }
                }
            };

            using var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
            using var response = await client.PostAsync(endpoint, content, ct);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("UI translation provider failed with {StatusCode}", response.StatusCode);
                return null;
            }

            var json = await response.Content.ReadAsStringAsync(ct);
            using var document = JsonDocument.Parse(json);

            if (document.RootElement.TryGetProperty("output_text", out var outputText))
                return outputText.GetString();

            if (document.RootElement.TryGetProperty("output", out var output) && output.ValueKind == JsonValueKind.Array)
            {
                var parts = new List<string>();
                foreach (var item in output.EnumerateArray())
                {
                    if (!item.TryGetProperty("content", out var contentArray) || contentArray.ValueKind != JsonValueKind.Array) continue;
                    foreach (var part in contentArray.EnumerateArray())
                    {
                        if (part.TryGetProperty("text", out var text))
                            parts.Add(text.GetString() ?? string.Empty);
                    }
                }

                var joined = string.Join("\n", parts.Where(part => !string.IsNullOrWhiteSpace(part))).Trim();
                return string.IsNullOrWhiteSpace(joined) ? null : joined;
            }

            return null;
        }

        private static Dictionary<string, string> ParseTranslationMap(string? answer, IReadOnlyList<string> originals)
        {
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            if (string.IsNullOrWhiteSpace(answer)) return result;

            var json = ExtractJsonObject(answer);
            if (string.IsNullOrWhiteSpace(json)) return result;

            try
            {
                using var document = JsonDocument.Parse(json);
                var root = document.RootElement;
                if (root.ValueKind == JsonValueKind.Object &&
                    root.TryGetProperty("translations", out var translations) &&
                    translations.ValueKind == JsonValueKind.Object)
                {
                    root = translations;
                }

                if (root.ValueKind != JsonValueKind.Object) return result;

                var allowed = originals.ToHashSet(StringComparer.Ordinal);
                foreach (var property in root.EnumerateObject())
                {
                    if (!allowed.Contains(property.Name)) continue;
                    if (property.Value.ValueKind != JsonValueKind.String) continue;
                    var translated = property.Value.GetString()?.Trim();
                    if (!string.IsNullOrWhiteSpace(translated))
                        result[property.Name] = translated;
                }
            }
            catch
            {
                return result;
            }

            return result;
        }

        private static string ExtractJsonObject(string text)
        {
            var value = text.Trim();
            var start = value.IndexOf('{');
            var end = value.LastIndexOf('}');
            return start >= 0 && end > start ? value.Substring(start, end - start + 1) : string.Empty;
        }
    }
}
