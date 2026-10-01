using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Extensions;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/today-updates")]
    public class TodayUpdatesController : ControllerBase
    {
        private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

        private readonly IHttpClientFactory _httpClientFactory;
        private readonly IPastorBotService _pastorBot;
        private readonly IMemoryCache _cache;
        private readonly ILogger<TodayUpdatesController> _logger;

        public TodayUpdatesController(
            IHttpClientFactory httpClientFactory,
            IPastorBotService pastorBot,
            IMemoryCache cache,
            ILogger<TodayUpdatesController> logger)
        {
            _httpClientFactory = httpClientFactory;
            _pastorBot = pastorBot;
            _cache = cache;
            _logger = logger;
        }

        [HttpGet]
        public async Task<IActionResult> Get([FromQuery] double? lat, [FromQuery] double? lon, [FromQuery] string? timezone, [FromQuery] bool refresh = false)
        {
            if (lat.HasValue && (lat < -90 || lat > 90)) return BadRequest("Invalid latitude.");
            if (lon.HasValue && (lon < -180 || lon > 180)) return BadRequest("Invalid longitude.");

            var cacheKey = $"faith-wire:{Math.Round(lat ?? 0, 1)}:{Math.Round(lon ?? 0, 1)}:{timezone?.Trim().ToLowerInvariant()}";
            if (_cache.TryGetValue(cacheKey, out TodayUpdateResponse? cached) && cached != null &&
                (!refresh || DateTime.UtcNow - cached.GeneratedAtUtc < TimeSpan.FromMinutes(5)))
                return Ok(cached);

            var ct = HttpContext.RequestAborted;
            var client = _httpClientFactory.CreateClient("PastorBot");
            client.Timeout = TimeSpan.FromSeconds(7);

            var location = await ResolveLocationAsync(client, lat, lon, timezone, ct);

            var weatherTask = ResolveWeatherAsync(client, lat, lon, ct);
            var localArticlesTask = FetchChristianArticlesAsync(client, location, ct);
            var globalArticlesTask = FetchGlobalChristianArticlesAsync(client, ct);
            var preacherWordTask = FetchPreacherWordArticlesAsync(client, ct);
            var meetingsTask = FetchChristianMeetingArticlesAsync(client, location, ct);
            var sensitiveTask = FetchSensitiveChristianArticlesAsync(client, ct);
            var israelWatchTask = FetchIsraelWatchArticlesAsync(client, ct);

            await Task.WhenAll(weatherTask, localArticlesTask, globalArticlesTask, preacherWordTask, meetingsTask, sensitiveTask, israelWatchTask);

            var weather = await weatherTask;
            var articles = (await localArticlesTask)
                .Concat(await globalArticlesTask)
                .Concat(await preacherWordTask)
                .Concat(await meetingsTask)
                .Concat(await sensitiveTask)
                .GroupBy(article => article.Url ?? article.Title, StringComparer.OrdinalIgnoreCase)
                .Select(group => group.First())
                .Take(18)
                .ToList();
            var israelWatch = await israelWatchTask;
            var christianUpdate = await BuildChristianUpdateAsync(location, articles, ct);

            var response = new TodayUpdateResponse
            {
                Location = location,
                Weather = weather,
                ChristianUpdate = christianUpdate,
                IsraelWatch = israelWatch,
                GeneratedAtUtc = DateTime.UtcNow
            };
            _cache.Set(cacheKey, response, TimeSpan.FromMinutes(20));
            return Ok(response);
        }

        private async Task<LocationDto> ResolveLocationAsync(HttpClient client, double? lat, double? lon, string? timezone, CancellationToken ct)
        {
            var fallback = new LocationDto
            {
                Label = string.IsNullOrWhiteSpace(timezone) ? "your area" : timezone.Replace("_", " "),
                Timezone = timezone
            };

            if (!lat.HasValue || !lon.HasValue) return fallback;

            try
            {
                var url = $"https://api.bigdatacloud.net/data/reverse-geocode-client?latitude={lat.Value.ToString(Invariant)}&longitude={lon.Value.ToString(Invariant)}&localityLanguage=en";
                var json = await client.GetStringAsync(url, ct);
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                var city = GetString(root, "city") ?? GetString(root, "locality");
                var state = GetString(root, "principalSubdivision");
                var country = GetString(root, "countryName");
                var labelParts = new[] { city, state, country }
                    .Where(part => !string.IsNullOrWhiteSpace(part))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                return new LocationDto
                {
                    City = city,
                    State = state,
                    Country = country,
                    Label = labelParts.Count > 0 ? string.Join(", ", labelParts) : fallback.Label,
                    Timezone = timezone
                };
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Location lookup failed.");
                return fallback;
            }
        }

        private async Task<WeatherDto?> ResolveWeatherAsync(HttpClient client, double? lat, double? lon, CancellationToken ct)
        {
            if (!lat.HasValue || !lon.HasValue) return null;

            try
            {
                var url = "https://api.open-meteo.com/v1/forecast"
                    + $"?latitude={lat.Value.ToString(Invariant)}"
                    + $"&longitude={lon.Value.ToString(Invariant)}"
                    + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code"
                    + "&timezone=auto";

                var json = await client.GetStringAsync(url, ct);
                using var doc = JsonDocument.Parse(json);
                if (!doc.RootElement.TryGetProperty("current", out var current)) return null;

                var codeValue = GetDouble(current, "weather_code");
                var code = codeValue.HasValue ? Convert.ToInt32(codeValue.Value) : (int?)null;
                return new WeatherDto
                {
                    TemperatureC = GetDouble(current, "temperature_2m"),
                    FeelsLikeC = GetDouble(current, "apparent_temperature"),
                    Humidity = GetDouble(current, "relative_humidity_2m"),
                    WindKph = GetDouble(current, "wind_speed_10m"),
                    Code = code,
                    Summary = WeatherSummary(code)
                };
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Weather lookup failed.");
                return null;
            }
        }

        private async Task<IReadOnlyList<ArticleDto>> FetchChristianArticlesAsync(HttpClient client, LocationDto location, CancellationToken ct)
        {
            try
            {
                var terms = new List<string> { "christian", "church", "pastor", "believers", "ministry", "prayer" };
                if (!string.IsNullOrWhiteSpace(location.City)) terms.Add($"\"{location.City}\"");
                if (!string.IsNullOrWhiteSpace(location.State)) terms.Add($"\"{location.State}\"");
                if (!string.IsNullOrWhiteSpace(location.Country)) terms.Add($"\"{location.Country}\"");

                var query = string.Join(" OR ", terms);
                var url = "https://api.gdeltproject.org/api/v2/doc/doc"
                    + $"?query={Uri.EscapeDataString(query)}"
                    + "&mode=ArtList&format=json&maxrecords=8&sort=HybridRel&timespan=48h";

                var json = await client.GetStringAsync(url, ct);
                using var doc = JsonDocument.Parse(json);
                if (!doc.RootElement.TryGetProperty("articles", out var articles) || articles.ValueKind != JsonValueKind.Array)
                    return Array.Empty<ArticleDto>();

                return articles.EnumerateArray()
                    .Select(article => new ArticleDto
                    {
                        Title = GetString(article, "title") ?? "Christian community update",
                        Url = GetString(article, "url"),
                        Source = GetString(article, "domain") ?? GetString(article, "sourcecountry"),
                        SeenDate = GetString(article, "seendate"),
                        Category = "Local",
                        Tone = "news"
                    })
                    .Where(article => IsChristianCommunityUpdate(article.Title))
                    .GroupBy(article => article.Title, StringComparer.OrdinalIgnoreCase)
                    .Select(group => group.First())
                    .Take(5)
                    .ToList();
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Christian update lookup failed.");
                return Array.Empty<ArticleDto>();
            }
        }


        private static bool IsChristianCommunityUpdate(string? title)
        {
            if (string.IsNullOrWhiteSpace(title)) return false;
            var t = title.ToLowerInvariant();
            var faith = new[] { "christian", "church", "pastor", "ministry", "mission", "believers", "prayer", "bible", "gospel", "worship" };
            return faith.Any(t.Contains);
        }

        private async Task<IReadOnlyList<ArticleDto>> FetchGlobalChristianArticlesAsync(HttpClient client, CancellationToken ct)
        {
            var query = @"(Christian OR church OR pastor OR ministry OR Bible OR gospel OR worship OR believers) (global OR world OR international OR mission OR revival OR persecution OR prayer)";
            return await FetchGdeltArticlesAsync(client, query, "Global", "news", 8, IsChristianCommunityUpdate, ct);
        }

        private async Task<IReadOnlyList<ArticleDto>> FetchPreacherWordArticlesAsync(HttpClient client, CancellationToken ct)
        {
            var query = @"(sermon OR preaching OR preacher OR pastor OR ""Sunday message"" OR ""Bible teaching"" OR ""Christian conference"") (Jesus OR Christ OR gospel OR church)";
            return await FetchGdeltArticlesAsync(client, query, "Word", "faith", 8, IsPreacherWordUpdate, ct);
        }

        private async Task<IReadOnlyList<ArticleDto>> FetchChristianMeetingArticlesAsync(HttpClient client, LocationDto location, CancellationToken ct)
        {
            var terms = new List<string> { "Christian meeting", "church meeting", "prayer meeting", "worship night", "revival meeting", "Christian conference" };
            if (!string.IsNullOrWhiteSpace(location.City)) terms.Add($"\"{location.City}\"");
            if (!string.IsNullOrWhiteSpace(location.State)) terms.Add($"\"{location.State}\"");
            if (!string.IsNullOrWhiteSpace(location.Country)) terms.Add($"\"{location.Country}\"");
            var query = string.Join(" OR ", terms);
            return await FetchGdeltArticlesAsync(client, query, "Meetings", "meeting", 8, IsMeetingUpdate, ct);
        }

        private async Task<IReadOnlyList<ArticleDto>> FetchSensitiveChristianArticlesAsync(HttpClient client, CancellationToken ct)
        {
            var query = @"(Christian OR church OR pastor OR believers OR missionary OR ministry) (attack OR persecution OR arrest OR violence OR crisis OR ban OR vandalism OR discrimination OR abuse OR scandal OR conflict OR war)";
            return await FetchGdeltArticlesAsync(client, query, "Sensitive", "alert", 10, IsSensitiveChristianUpdate, ct);
        }

        private async Task<IReadOnlyList<ArticleDto>> FetchGdeltArticlesAsync(
            HttpClient client,
            string query,
            string category,
            string tone,
            int maxRecords,
            Func<string?, bool> predicate,
            CancellationToken ct)
        {
            try
            {
                var url = "https://api.gdeltproject.org/api/v2/doc/doc"
                    + $"?query={Uri.EscapeDataString(query)}"
                    + $"&mode=ArtList&format=json&maxrecords={maxRecords}&sort=HybridRel&timespan=48h";

                var json = await client.GetStringAsync(url, ct);
                using var doc = JsonDocument.Parse(json);
                if (!doc.RootElement.TryGetProperty("articles", out var articles) || articles.ValueKind != JsonValueKind.Array)
                    return Array.Empty<ArticleDto>();

                return articles.EnumerateArray()
                    .Select(article => new ArticleDto
                    {
                        Title = GetString(article, "title") ?? $"{category} Christian update",
                        Url = GetString(article, "url"),
                        Source = GetString(article, "domain") ?? GetString(article, "sourcecountry"),
                        SeenDate = GetString(article, "seendate"),
                        Category = category,
                        Tone = tone
                    })
                    .Where(article => predicate(article.Title))
                    .GroupBy(article => article.Title, StringComparer.OrdinalIgnoreCase)
                    .Select(group => group.First())
                    .Take(6)
                    .ToList();
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "{Category} Christian update lookup failed.", category);
                return Array.Empty<ArticleDto>();
            }
        }

        private static bool IsPreacherWordUpdate(string? title)
        {
            if (string.IsNullOrWhiteSpace(title)) return false;
            var t = title.ToLowerInvariant();
            var word = new[] { "sermon", "preach", "pastor", "bible", "gospel", "teaching", "conference", "message", "worship" };
            return word.Any(t.Contains) && IsChristianCommunityUpdate(title);
        }

        private static bool IsMeetingUpdate(string? title)
        {
            if (string.IsNullOrWhiteSpace(title)) return false;
            var t = title.ToLowerInvariant();
            var meeting = new[] { "meeting", "conference", "gathering", "revival", "prayer", "worship", "service", "crusade" };
            return meeting.Any(t.Contains) && IsChristianCommunityUpdate(title);
        }

        private static bool IsSensitiveChristianUpdate(string? title)
        {
            if (string.IsNullOrWhiteSpace(title)) return false;
            var t = title.ToLowerInvariant();
            var sensitive = new[] { "attack", "persecution", "arrest", "violence", "crisis", "ban", "vandal", "discrimination", "abuse", "scandal", "conflict", "war" };
            return sensitive.Any(t.Contains) && IsChristianCommunityUpdate(title);
        }
        private async Task<IReadOnlyList<ArticleDto>> FetchIsraelWatchArticlesAsync(HttpClient client, CancellationToken ct)
        {
            try
            {
                var query = @"(Israel OR Jerusalem OR ""Middle East"") (""second coming"" OR prophecy OR prophetic OR ""end times"" OR eschatology OR Bible OR Christian)";
                var url = "https://api.gdeltproject.org/api/v2/doc/doc"
                    + $"?query={Uri.EscapeDataString(query)}"
                    + "&mode=ArtList&format=json&maxrecords=12&sort=HybridRel&timespan=48h";

                var json = await client.GetStringAsync(url, ct);
                using var doc = JsonDocument.Parse(json);
                if (!doc.RootElement.TryGetProperty("articles", out var articles) || articles.ValueKind != JsonValueKind.Array)
                    return Array.Empty<ArticleDto>();

                return articles.EnumerateArray()
                    .Select(article => new ArticleDto
                    {
                        Title = GetString(article, "title") ?? "Israel watch update",
                        Url = GetString(article, "url"),
                        Source = GetString(article, "domain") ?? GetString(article, "sourcecountry"),
                        SeenDate = GetString(article, "seendate"),
                        Category = "Israel Watch",
                        Tone = "israel"
                    })
                    .Where(article => IsIsraelSecondComingWatch(article.Title))
                    .GroupBy(article => article.Title, StringComparer.OrdinalIgnoreCase)
                    .Select(group => group.First())
                    .Take(3)
                    .ToList();
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Israel watch lookup failed.");
                return Array.Empty<ArticleDto>();
            }
        }

        private static bool IsIsraelSecondComingWatch(string? title)
        {
            if (string.IsNullOrWhiteSpace(title)) return false;
            var t = title.ToLowerInvariant();
            var israel = new[] { "israel", "jerusalem", "temple mount", "middle east" };
            var watch = new[] { "second coming", "prophecy", "prophetic", "end times", "eschatology", "bible", "christian", "messiah", "revelation" };
            var critical = new[] { "war", "attack", "ceasefire", "hostage", "missile", "nuclear", "iran", "gaza", "hezbollah", "hamas", "crisis", "peace" };
            return israel.Any(t.Contains) && watch.Any(t.Contains) && critical.Any(t.Contains);
        }

        private async Task<ChristianUpdateDto> BuildChristianUpdateAsync(LocationDto location, IReadOnlyList<ArticleDto> articles, CancellationToken ct)
        {
            var region = string.IsNullOrWhiteSpace(location.Label) ? "your area" : location.Label;
            var today = DateTime.UtcNow.ToString("MMMM d, yyyy", Invariant);

            try
            {
                var headlines = articles.Count == 0
                    ? "No verified Christian-specific headlines were returned by the news feed. Do not invent news."
                    : string.Join("\n", articles.Select((article, index) => $"{index + 1}. [{article.Category}] {article.Title} ({article.Source})"));
                var prompt = $@"Create a fresh Live Faith Wire briefing for {region} for {today}.
Use only these verified public headlines; do not invent details:
{headlines}

Return exactly these four single-line fields:
BRIEFING: a factual summary of at most 35 words based only on the supplied headlines
VERSE: one context-appropriate KJV Bible reference and a quotation of at most 30 words
REFLECTION: one fresh Christian encouragement of at most 24 words
PRAYER: one prayer focus of at most 20 words
Keep it pastoral and cautious. Never present prophecy speculation as news.";

                var userId = User.GetUserIdGuid();
                using var summaryTimeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
                summaryTimeout.CancelAfter(TimeSpan.FromSeconds(5));
                var reply = await _pastorBot.AskAsync(userId, prompt, false, "en", "english-teaching-guide", null, summaryTimeout.Token);
                var fields = ParseFaithWireFields(reply.Answer);
                return new ChristianUpdateDto
                {
                    Summary = fields.GetValueOrDefault("BRIEFING") ?? FallbackUpdate(region, articles),
                    Articles = articles,
                    FaithItems = new[] { fields.GetValueOrDefault("VERSE"), fields.GetValueOrDefault("REFLECTION"), fields.GetValueOrDefault("PRAYER") }
                        .Where(value => !string.IsNullOrWhiteSpace(value)).Cast<string>().ToArray()
                };
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "AI Christian update generation failed.");
                return new ChristianUpdateDto
                {
                    Summary = FallbackUpdate(region, articles),
                    Articles = articles,
                    FaithItems = DailyFallbackFaithItems()
                };
            }
        }

        private static Dictionary<string, string> ParseFaithWireFields(string? answer)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var rawLine in (answer ?? string.Empty).Split('\n', StringSplitOptions.RemoveEmptyEntries))
            {
                var line = rawLine.Trim().TrimStart('-', '*', ' ');
                var separator = line.IndexOf(':');
                if (separator <= 0) continue;
                var key = line[..separator].Replace("*", string.Empty).Trim().ToUpperInvariant();
                if (key is not ("BRIEFING" or "VERSE" or "REFLECTION" or "PRAYER")) continue;
                var value = line[(separator + 1)..].Replace("**", string.Empty).Trim();
                if (!string.IsNullOrWhiteSpace(value)) result[key] = value;
            }
            return result;
        }

        private static IReadOnlyList<string> DailyFallbackFaithItems()
        {
            var verses = new[]
            {
                "Psalm 118:24 — This is the day which the Lord hath made; we will rejoice and be glad in it.",
                "Proverbs 3:5 — Trust in the Lord with all thine heart; and lean not unto thine own understanding.",
                "Philippians 4:13 — I can do all things through Christ which strengtheneth me.",
                "Psalm 46:1 — God is our refuge and strength, a very present help in trouble.",
                "Matthew 5:16 — Let your light so shine before men, that they may see your good works."
            };
            return new[]
            {
                verses[DateTime.UtcNow.DayOfYear % verses.Length],
                "Reflection: Receive today as a fresh opportunity to love God and serve someone faithfully.",
                "Prayer: Ask for wisdom, unity, protection, and courage for churches and believers today."
            };
        }

        private static string FallbackUpdate(string region, IReadOnlyList<ArticleDto> articles)
        {
            var first = articles.FirstOrDefault()?.Title;
            if (string.IsNullOrWhiteSpace(first))
                return $"No verified Christian-specific local headlines were found for {region} right now.";

            return $"Christian update for {region}: {first}. Prayer focus: ask God for wisdom, unity, and protection for believers and local church leaders today.";
        }

        private static string? GetString(JsonElement element, string propertyName)
        {
            if (!element.TryGetProperty(propertyName, out var value) || value.ValueKind == JsonValueKind.Null)
                return null;
            return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
        }

        private static double? GetDouble(JsonElement element, string propertyName)
        {
            if (!element.TryGetProperty(propertyName, out var value) || value.ValueKind == JsonValueKind.Null)
                return null;
            if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number)) return number;
            return double.TryParse(value.ToString(), NumberStyles.Any, Invariant, out var parsed) ? parsed : null;
        }

        private static string WeatherSummary(int? code) => code switch
        {
            0 => "Clear sky",
            1 or 2 => "Mostly clear",
            3 => "Cloudy",
            45 or 48 => "Fog",
            51 or 53 or 55 => "Drizzle",
            61 or 63 or 65 => "Rain",
            71 or 73 or 75 => "Snow",
            80 or 81 or 82 => "Showers",
            95 or 96 or 99 => "Thunderstorm",
            _ => "Weather update"
        };

        public class TodayUpdateResponse
        {
            public LocationDto Location { get; set; } = new();
            public WeatherDto? Weather { get; set; }
            public ChristianUpdateDto ChristianUpdate { get; set; } = new();
            public IReadOnlyList<ArticleDto> IsraelWatch { get; set; } = Array.Empty<ArticleDto>();
            public DateTime GeneratedAtUtc { get; set; }
        }

        public class LocationDto
        {
            public string? City { get; set; }
            public string? State { get; set; }
            public string? Country { get; set; }
            public string? Label { get; set; }
            public string? Timezone { get; set; }
        }

        public class WeatherDto
        {
            public double? TemperatureC { get; set; }
            public double? FeelsLikeC { get; set; }
            public double? Humidity { get; set; }
            public double? WindKph { get; set; }
            public int? Code { get; set; }
            public string Summary { get; set; } = "Weather update";
        }

        public class ChristianUpdateDto
        {
            public string Summary { get; set; } = "";
            public IReadOnlyList<ArticleDto> Articles { get; set; } = Array.Empty<ArticleDto>();
            public IReadOnlyList<string> FaithItems { get; set; } = Array.Empty<string>();
        }

        public class ArticleDto
        {
            public string Title { get; set; } = "";
            public string? Url { get; set; }
            public string? Source { get; set; }
            public string? SeenDate { get; set; }
            public string? Category { get; set; }
            public string? Tone { get; set; }
        }
    }
}




