using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Mahima.Api.v3.clean.Services.Ai
{
    /// <summary>
    /// Loads scripture_pack.json once and retrieves the verses most relevant to
    /// a user's question by keyword scoring. Register as a singleton.
    ///
    /// This is deliberately a simple, dependency-free retriever (no embeddings,
    /// no external service) so the AI Counseller's Scripture grounding works fully
    /// offline alongside a self-hosted model. To upgrade to semantic search
    /// later, swap the scoring in FindRelevant for a vector similarity lookup;
    /// the interface does not change.
    /// </summary>
    public sealed class ScriptureService : IScriptureService
    {
        private readonly ILogger<ScriptureService> _logger;
        private readonly List<VerseEntry> _verses = new();

        private sealed class VerseEntry
        {
            public string Theme = string.Empty;
            public string Reference = string.Empty;
            public string[] Keywords = Array.Empty<string>();
            public Dictionary<string, string> Text = new();
        }

        public ScriptureService(IHostEnvironment env, ILogger<ScriptureService> logger)
        {
            _logger = logger;
            LoadPack(env);
        }

        private void LoadPack(IHostEnvironment env)
        {
            var candidates = new[]
            {
                Path.Combine(env.ContentRootPath, "services", "Ai", "scripture_pack.json"),
                Path.Combine(env.ContentRootPath, "Services", "Ai", "scripture_pack.json"),
                Path.Combine(AppContext.BaseDirectory, "services", "Ai", "scripture_pack.json"),
                Path.Combine(AppContext.BaseDirectory, "scripture_pack.json"),
            };

            var path = candidates.FirstOrDefault(File.Exists);
            if (path == null)
            {
                _logger.LogWarning(
                    "scripture_pack.json not found; AI Counseller will run without verse grounding. " +
                    "Checked: {Paths}", string.Join("; ", candidates));
                return;
            }

            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(path));
                if (!doc.RootElement.TryGetProperty("verses", out var verses)
                    || verses.ValueKind != JsonValueKind.Array)
                {
                    _logger.LogWarning("scripture_pack.json has no 'verses' array.");
                    return;
                }

                foreach (var v in verses.EnumerateArray())
                {
                    var entry = new VerseEntry
                    {
                        Theme = v.TryGetProperty("theme", out var th) ? th.GetString() ?? "" : "",
                        Reference = v.TryGetProperty("reference", out var rf) ? rf.GetString() ?? "" : "",
                    };

                    if (v.TryGetProperty("keywords", out var kw) && kw.ValueKind == JsonValueKind.Array)
                        entry.Keywords = kw.EnumerateArray()
                            .Select(k => (k.GetString() ?? "").ToLowerInvariant())
                            .Where(k => k.Length > 0)
                            .ToArray();

                    if (v.TryGetProperty("text", out var txt) && txt.ValueKind == JsonValueKind.Object)
                        foreach (var prop in txt.EnumerateObject())
                            entry.Text[prop.Name] = prop.Value.GetString() ?? "";

                    if (!string.IsNullOrEmpty(entry.Reference))
                        _verses.Add(entry);
                }

                _logger.LogInformation("ScriptureService loaded {Count} verses from {Path}",
                    _verses.Count, path);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to parse scripture_pack.json at {Path}", path);
            }
        }

        public IReadOnlyList<ScriptureVerse> FindRelevant(string question, string language, int max = 3)
        {
            if (_verses.Count == 0 || string.IsNullOrWhiteSpace(question))
                return Array.Empty<ScriptureVerse>();

            var q = " " + question.ToLowerInvariant() + " ";

            var scored = _verses
                .Select(v => new
                {
                    Verse = v,
                    Score = v.Keywords.Count(k => q.Contains(" " + k + " ") || q.Contains(k))
                })
                .Where(x => x.Score > 0)
                .OrderByDescending(x => x.Score)
                .Take(max)
                .Select(x => Map(x.Verse, language))
                .ToList();

            // If nothing matched, fall back to the general guidance verse so the
            // pastor always has at least one real verse to anchor on.
            if (scored.Count == 0)
            {
                var general = _verses.FirstOrDefault(v => v.Theme == "general") ?? _verses[0];
                scored.Add(Map(general, language));
            }

            return scored;
        }

        public ScriptureVerse ForTheme(string theme, string language)
        {
            var match = _verses.FirstOrDefault(v =>
                            string.Equals(v.Theme, theme, StringComparison.OrdinalIgnoreCase))
                        ?? _verses.FirstOrDefault(v => v.Theme == "general")
                        ?? _verses.FirstOrDefault();

            return match == null
                ? new ScriptureVerse { Reference = "Psalm 119:105", Theme = "general",
                    Text = "Your word is a lamp for my feet, a light on my path." }
                : Map(match, language);
        }

        private static ScriptureVerse Map(VerseEntry v, string language)
        {
            // Requested language, else English, else the first available rendering.
            var text = v.Text.TryGetValue(language, out var t) && !string.IsNullOrWhiteSpace(t)
                ? t
                : v.Text.TryGetValue("en", out var en) ? en
                : v.Text.Values.FirstOrDefault() ?? string.Empty;

            return new ScriptureVerse
            {
                Reference = v.Reference,
                Theme = v.Theme,
                Text = text
            };
        }
    }
}

