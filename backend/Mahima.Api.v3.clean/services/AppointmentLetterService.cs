using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Mahima.Api.v3.clean.Services;

public class AppointmentLetterService : IAppointmentLetterService
{
    private readonly ITenantPrintTemplateService _printTemplates;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IMemoryCache _cache;
    private readonly IConfiguration _configuration;
    private readonly ILogger<AppointmentLetterService> _logger;
    private readonly string _letterRoot;

    public AppointmentLetterService(
        ITenantPrintTemplateService printTemplates,
        IWebHostEnvironment environment,
        IConfiguration configuration,
        IHttpClientFactory httpClientFactory,
        IMemoryCache cache,
        ILogger<AppointmentLetterService> logger)
    {
        _printTemplates = printTemplates;
        _httpClientFactory = httpClientFactory;
        _cache = cache;
        _configuration = configuration;
        _logger = logger;
        // Private, non-web-exposed root -- never under wwwroot. Generated letters (which
        // may contain salary details) are only ever served through UsersController's
        // authenticated, admin/staff-only, tenant-checked action.
        _letterRoot = Path.GetFullPath(configuration["AppointmentLetters:GeneratedRoot"]
            ?? Path.Combine(environment.ContentRootPath, "App_Data", "appointment-letters"));
    }

    private static readonly Dictionary<string, string> LanguageNames = new(StringComparer.OrdinalIgnoreCase)
    {
        ["hi"] = "Hindi",
        ["pa"] = "Punjabi",
    };

    // Fixed template strings, written with {0}/{1}/{2} placeholders where a dynamic value
    // (name, org name, date, amount) is stitched in - those placeholders must survive
    // translation untouched; only the surrounding words get translated.
    private const string TitleText = "LETTER OF APPOINTMENT";
    private const string RefLabel = "Ref:";
    private const string DateLabel = "Date:";
    private const string SalutationTemplate = "Dear {0},";
    private const string IntroTemplate = "We are pleased to confirm your appointment as {0} at {1}, effective from {2}. Your role and the terms of your appointment are set out below.";
    private const string TermsTemplate = "This appointment is subject to the policies, code of conduct, and guidelines of {0} as may be amended from time to time. You are expected to perform your duties with diligence, integrity, and in a manner consistent with the values of this ministry.";
    private const string AdditionalTermsHeading = "Additional Terms:";
    private const string SignRequestText = "Please sign and return a copy of this letter to acknowledge your acceptance of this appointment and its terms.";
    private const string ClosingLineText = "We look forward to your valuable contribution.";
    private const string SincerelyText = "Yours sincerely,";
    private const string ForOrgTemplate = "For {0}";
    private const string SigAuthorizedText = "AUTHORIZED SIGNATORY";
    private const string SigEmployeeText = "EMPLOYEE ACKNOWLEDGEMENT";
    private const string RegNoTemplate = "Society Reg. No: {0}";
    private const string DefaultFooterText = "This is a system-generated appointment letter.";
    private const string PerDayText = "per day";

    private const string LabelEmployeeName = "Employee Name";
    private const string LabelEmployeeCode = "Employee Code";
    private const string LabelRole = "Role / Designation";
    private const string LabelDepartment = "Department";
    private const string LabelReportingTo = "Reporting To";
    private const string LabelJoinDate = "Date of Joining";
    private const string LabelAadhar = "Aadhar Number";
    private const string LabelAddress = "Address";
    private const string LabelSalaryType = "Salary Type";
    private const string LabelGrossMonthly = "Gross Monthly Salary";
    private const string LabelDailyRate = "Daily Rate";
    private const string LabelDeductions = "Deductions";
    private const string LabelNetMonthly = "Net Monthly Take-Home";
    private const string LabelAnnualCtc = "Annual CTC (Approx.)";
    private const string LabelWeeklyOff = "Weekly Off Day";

    private const string ValueDaily = "Daily";
    private const string ValueWeekly = "Weekly";
    private const string ValueMonthly = "Monthly";

    private static readonly string[] DayNames =
        { "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday" };

    public async Task<string> GenerateAsync(AppointmentLetterRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        QuestPDF.Settings.License = LicenseType.Community;

        var letterDir = Path.Combine(_letterRoot, request.TenantId.ToString("N"));
        Directory.CreateDirectory(letterDir);
        var fileName = $"AppointmentLetter_{request.UserId:N}_{DateTime.UtcNow:yyyyMMddHHmmss}.pdf";
        var filePath = Path.Combine(letterDir, fileName);

        var template = await _printTemplates.GetAsync(request.TenantId);
        var logoBytes = await _printTemplates.LoadLogoAsync(template);
        var brandColor = string.IsNullOrWhiteSpace(template.PrimaryColor) ? "#047857" : template.PrimaryColor;
        var orgName = string.IsNullOrWhiteSpace(template.OrganizationName) ? "Our Ministry" : template.OrganizationName;
        var roleName = string.IsNullOrWhiteSpace(request.RoleName) ? "________________" : request.RoleName;
        var department = request.Department;
        var reportingManager = request.ReportingManager;
        var appointmentDate = request.AppointmentDate.ToString("dd MMMM yyyy");
        var joinDate = request.JoinDate.ToString("dd MMMM yyyy");
        var refNumber = $"AL-{request.UserCode ?? request.UserId.ToString("N")[..8].ToUpperInvariant()}-{DateTime.UtcNow:yyyyMMdd}";

        var languageCode = (request.Language ?? "en").Trim().ToLowerInvariant();
        var translations = languageCode != "en" && LanguageNames.TryGetValue(languageCode, out var languageName)
            ? await TranslateLetterStringsAsync(languageCode, languageName, request.AdditionalTerms)
            : new Dictionary<string, string>(StringComparer.Ordinal);
        string T(string text) => translations.TryGetValue(text, out var translated) && !string.IsNullOrWhiteSpace(translated) ? translated : text;

        // QuestPDF bundles its own private Skia build - it does NOT fall back to whatever
        // fonts happen to be installed on the OS. Devanagari/Gurmukhi glyphs render as
        // tofu boxes unless we explicitly register a font that has them and point the
        // page at it by name.
        var scriptFontFamily = languageCode switch
        {
            "hi" => "Noto Sans Devanagari",
            "pa" => "Noto Sans Gurmukhi",
            _ => null,
        };
        if (scriptFontFamily != null) EnsureScriptFontsRegistered();

        var (introBeforeRole, introAfterRole) = SplitOnFirstPlaceholder(T(IntroTemplate), orgName, joinDate);
        var translatedAdditionalTerms = !string.IsNullOrWhiteSpace(request.AdditionalTerms) ? T(request.AdditionalTerms!) : null;

        var compensationRows = BuildCompensationRows(request, T);

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(36);
                page.PageColor(Colors.White);
                page.DefaultTextStyle(style =>
                {
                    var s = style.FontSize(10.5f).FontColor("#1E293B").LineHeight(1.4f);
                    return scriptFontFamily != null ? s.FontFamily(scriptFontFamily) : s;
                });

                page.Header().Column(col =>
                {
                    col.Item().Row(header =>
                    {
                        header.ConstantItem(110).Height(56).Element(logo =>
                        {
                            if (logoBytes is { Length: > 0 })
                                logo.AlignLeft().MaxWidth(95).MaxHeight(52).Image(logoBytes).FitArea();
                        });

                        header.RelativeItem().AlignCenter().Column(center =>
                        {
                            center.Item().AlignCenter().Text(orgName.ToUpperInvariant())
                                .FontSize(16).Bold().FontColor(brandColor).LetterSpacing(0.06f);
                            if (!string.IsNullOrWhiteSpace(template.HeaderText))
                                center.Item().AlignCenter().Text(template.HeaderText).FontSize(8).FontColor("#64748B");
                            if (template.ShowAddress && !string.IsNullOrWhiteSpace(template.Address))
                                center.Item().AlignCenter().Text(template.Address).FontSize(8).FontColor("#64748B");
                            var contact = string.Join("  |  ", new[] { template.Phone, template.Email }
                                .Where(v => !string.IsNullOrWhiteSpace(v)));
                            if (!string.IsNullOrWhiteSpace(contact))
                                center.Item().AlignCenter().Text(contact).FontSize(8).FontColor("#64748B");
                            if (!string.IsNullOrWhiteSpace(template.RegistrationNumber))
                                center.Item().AlignCenter().Text(string.Format(T(RegNoTemplate), template.RegistrationNumber))
                                    .FontSize(8).FontColor("#64748B");
                        });

                        header.ConstantItem(110);
                    });
                    col.Item().PaddingTop(8).LineHorizontal(1.5f).LineColor(brandColor);
                });

                page.Content().PaddingTop(20).Column(col =>
                {
                    col.Spacing(4);

                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Text($"{T(RefLabel)} {refNumber}").FontSize(9).FontColor("#64748B");
                        row.RelativeItem().AlignRight().Text($"{T(DateLabel)} {appointmentDate}").FontSize(9).FontColor("#64748B");
                    });

                    col.Item().PaddingTop(14).Text(T(TitleText))
                        .FontSize(15).Bold().FontColor("#0F172A").LetterSpacing(0.05f);

                    col.Item().PaddingTop(10).Text(string.Format(T(SalutationTemplate), request.FullName));

                    col.Item().PaddingTop(6).Text(text =>
                    {
                        text.Span(introBeforeRole);
                        text.Span(roleName).SemiBold().FontColor(brandColor);
                        text.Span(introAfterRole);
                    });

                    col.Item().PaddingTop(10).Background("#F8FAFC").Border(0.7f).BorderColor("#E2E8F0").Padding(12)
                        .Column(details =>
                        {
                            details.Spacing(6);
                            DetailRow(details, T(LabelEmployeeName), request.FullName);
                            if (!string.IsNullOrWhiteSpace(request.UserCode)) DetailRow(details, T(LabelEmployeeCode), request.UserCode!);
                            DetailRow(details, T(LabelRole), roleName);
                            if (!string.IsNullOrWhiteSpace(department)) DetailRow(details, T(LabelDepartment), department!);
                            if (!string.IsNullOrWhiteSpace(reportingManager)) DetailRow(details, T(LabelReportingTo), reportingManager!);
                            DetailRow(details, T(LabelJoinDate), joinDate);
                            if (!string.IsNullOrWhiteSpace(request.AadharNumber)) DetailRow(details, T(LabelAadhar), request.AadharNumber!);
                            if (!string.IsNullOrWhiteSpace(request.Address)) DetailRow(details, T(LabelAddress), request.Address!);
                            foreach (var (label, value) in compensationRows)
                                DetailRow(details, label, value);
                        });

                    col.Item().PaddingTop(10).Text(string.Format(T(TermsTemplate), orgName));

                    if (!string.IsNullOrWhiteSpace(translatedAdditionalTerms))
                    {
                        col.Item().PaddingTop(8).Text(T(AdditionalTermsHeading)).SemiBold();
                        col.Item().PaddingTop(2).Text(translatedAdditionalTerms!);
                    }

                    col.Item().PaddingTop(10).Text(T(SignRequestText));

                    col.Item().PaddingTop(16).Text(T(ClosingLineText));
                    col.Item().PaddingTop(18).Text(T(SincerelyText));
                    col.Item().PaddingTop(2).Text(string.Format(T(ForOrgTemplate), orgName));

                    col.Item().PaddingTop(30).Row(signatures =>
                    {
                        Signature(signatures.RelativeItem(), T(SigAuthorizedText));
                        signatures.ConstantItem(45);
                        Signature(signatures.RelativeItem(), T(SigEmployeeText));
                    });
                });

                page.Footer().PaddingTop(10).Column(col =>
                {
                    col.Item().LineHorizontal(0.7f).LineColor("#E2E8F0");
                    col.Item().PaddingTop(4).Row(footer =>
                    {
                        footer.RelativeItem().Text(template.FooterText ?? T(DefaultFooterText))
                            .FontSize(7).FontColor("#94A3B8");
                        footer.ConstantItem(160).AlignRight().Text(refNumber).FontSize(7).FontColor("#94A3B8");
                    });
                    if (template.ShowPageNumbers)
                    {
                        col.Item().PaddingTop(2).AlignRight().Text(t =>
                        {
                            t.DefaultTextStyle(s => s.FontSize(7).FontColor("#94A3B8"));
                            t.CurrentPageNumber();
                            t.Span(" / ");
                            t.TotalPages();
                        });
                    }
                });
            });
        });

        document.GeneratePdf(filePath);
        return request.TenantId.ToString("N") + "/" + fileName;
    }

    // Splits a translated template (which must still contain a literal "{0}" for the
    // styled role-name span) into the text before and after it, substituting the
    // remaining {1}/{2} placeholders directly (not via string.Format, since after the
    // split they're no longer at index 0).
    private static (string Before, string After) SplitOnFirstPlaceholder(string template, string p1, string p2)
    {
        var parts = template.Split("{0}", 2);
        var before = parts[0];
        var after = parts.Length > 1 ? parts[1] : "";
        after = after.Replace("{1}", p1).Replace("{2}", p2);
        return (before, after);
    }

    private static List<(string Label, string Value)> BuildCompensationRows(AppointmentLetterRequest request, Func<string, string> t)
    {
        var rows = new List<(string, string)>();
        var hasMonthly = request.MonthlyFixedAmount is > 0;
        var hasDaily = request.HourlyRate is > 0;

        if (!hasMonthly && !hasDaily)
            return rows;

        var salaryTypeValue = request.SalaryType is "Daily" or "Weekly" or "Monthly"
            ? request.SalaryType
            : (hasMonthly ? "Monthly" : "Daily");
        var salaryTypeText = salaryTypeValue switch
        {
            "Daily" => t(ValueDaily),
            "Weekly" => t(ValueWeekly),
            _ => t(ValueMonthly),
        };
        rows.Add((t(LabelSalaryType), salaryTypeText));

        if (hasMonthly)
            rows.Add((t(LabelGrossMonthly), $"Rs. {request.MonthlyFixedAmount:N2}"));
        if (hasDaily)
            rows.Add((t(LabelDailyRate), $"Rs. {request.HourlyRate:N2} {t(PerDayText)}"));
        if (request.Deductions is > 0)
            rows.Add((t(LabelDeductions), $"Rs. {request.Deductions:N2}"));

        if (hasMonthly)
        {
            var net = request.MonthlyFixedAmount!.Value - (request.Deductions ?? 0);
            rows.Add((t(LabelNetMonthly), $"Rs. {net:N2}"));
            rows.Add((t(LabelAnnualCtc), $"Rs. {request.MonthlyFixedAmount!.Value * 12:N2}"));
        }

        if (request.WeeklyOffDay is >= 0 and <= 6)
            rows.Add((t(LabelWeeklyOff), t(DayNames[request.WeeklyOffDay.Value])));

        return rows;
    }

    private static void DetailRow(ColumnDescriptor column, string label, string value)
    {
        column.Item().Row(row =>
        {
            row.ConstantItem(150).Text(label).FontSize(8.5f).Bold().FontColor("#64748B");
            row.RelativeItem().Text(value).FontSize(9.5f).SemiBold().FontColor("#0F172A");
        });
    }

    private static void Signature(IContainer container, string label)
    {
        container.Column(column =>
        {
            column.Item().Height(20);
            column.Item().LineHorizontal(0.8f).LineColor("#64748B");
            column.Item().PaddingTop(4).AlignCenter().Text(label)
                .FontSize(7).Bold().FontColor("#475569").LetterSpacing(0.06f);
        });
    }

    // Translates the letter's fixed labels/paragraphs (plus the admin's free-form
    // Additional Terms, if any) into the requested language via the same AI provider
    // UiTranslationController uses for the app's UI, with a long-lived cache per
    // language+text so the same labels aren't re-translated on every letter.
    private async Task<Dictionary<string, string>> TranslateLetterStringsAsync(string languageCode, string languageName, string? additionalTerms)
    {
        var fixedStrings = new List<string>
        {
            TitleText, RefLabel, DateLabel, SalutationTemplate, IntroTemplate, TermsTemplate,
            AdditionalTermsHeading, SignRequestText, ClosingLineText, SincerelyText, ForOrgTemplate,
            SigAuthorizedText, SigEmployeeText, RegNoTemplate, DefaultFooterText, PerDayText,
            LabelEmployeeName, LabelEmployeeCode, LabelRole, LabelDepartment, LabelReportingTo,
            LabelJoinDate, LabelAadhar, LabelAddress, LabelSalaryType, LabelGrossMonthly, LabelDailyRate,
            LabelDeductions, LabelNetMonthly, LabelAnnualCtc, LabelWeeklyOff,
            ValueDaily, ValueWeekly, ValueMonthly,
        };
        fixedStrings.AddRange(DayNames);

        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        var missing = new List<string>();
        foreach (var text in fixedStrings.Distinct(StringComparer.Ordinal))
        {
            if (_cache.TryGetValue<string>(CacheKey(languageCode, text), out var cached) && !string.IsNullOrWhiteSpace(cached))
                result[text] = cached;
            else
                missing.Add(text);
        }

        // The admin's own free text - not cached long-term the same way (harmless if it is;
        // just also translated in the same batch call to save a round trip).
        if (!string.IsNullOrWhiteSpace(additionalTerms) && !result.ContainsKey(additionalTerms))
            missing.Add(additionalTerms);

        if (missing.Count == 0)
            return result;

        try
        {
            var prompt = BuildTranslationPrompt(languageName, missing);
            var answer = await CallAiAsync(prompt);
            var parsed = ParseTranslationMap(answer, missing);
            if (parsed.Count == 0)
            {
                _logger.LogWarning(
                    "Appointment letter translation for {Language} returned no usable entries out of {Count} requested. Raw AI answer: {Answer}",
                    languageCode, missing.Count, answer ?? "(null)");
            }
            foreach (var pair in parsed)
            {
                result[pair.Key] = pair.Value;
                if (pair.Key != additionalTerms)
                    _cache.Set(CacheKey(languageCode, pair.Key), pair.Value, TimeSpan.FromDays(30));
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Appointment letter translation failed for language {Language}", languageCode);
        }

        return result;
    }

    private static string CacheKey(string languageCode, string text) => $"appointment-letter-translation:{languageCode}:{text}";

    private static readonly object ScriptFontLock = new();
    private static bool _scriptFontsRegistered;

    // Registers the Devanagari/Gurmukhi fonts installed on the server (apt package
    // fonts-noto-core/-unhinted/-extra) with QuestPDF's own font manager, once per
    // process. Best-effort: if a path doesn't exist (e.g. running locally on Windows,
    // or the package layout changes), that language's PDF just falls back to whatever
    // the default font can draw instead of throwing.
    private static void EnsureScriptFontsRegistered()
    {
        if (_scriptFontsRegistered) return;
        lock (ScriptFontLock)
        {
            if (_scriptFontsRegistered) return;
            var candidatePaths = new[]
            {
                "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf",
                "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Bold.ttf",
                "/usr/share/fonts/truetype/noto/NotoSansGurmukhi-Regular.ttf",
                "/usr/share/fonts/truetype/noto/NotoSansGurmukhi-Bold.ttf",
            };
            foreach (var path in candidatePaths)
            {
                try
                {
                    if (!File.Exists(path)) continue;
                    using var stream = File.OpenRead(path);
                    QuestPDF.Drawing.FontManager.RegisterFont(stream);
                }
                catch
                {
                    // Ignored - best-effort registration, see method summary.
                }
            }
            _scriptFontsRegistered = true;
        }
    }

    private static string BuildTranslationPrompt(string languageName, IReadOnlyList<string> texts)
    {
        var json = JsonSerializer.Serialize(texts);
        return
            $"Translate each of these English appointment-letter phrases into {languageName}, in a formal HR/business register. " +
            "Some phrases contain placeholders like {0}, {1} or {2} - copy those placeholders through EXACTLY as-is, unchanged, " +
            "in the same relative position, and translate only the surrounding words. " +
            "Do not translate proper nouns, amounts, or anything that is not plain English prose. " +
            "Return ONLY valid JSON in this exact shape: {\"translations\":{\"original\":\"translated\"}}. " +
            "Do not add markdown or explanation. Input texts JSON array: " + json;
    }

    private async Task<string?> CallAiAsync(string prompt)
    {
        var apiKey = _configuration["PastorBot:ApiKey"] ?? _configuration["PastorBot:OpenAiApiKey"];
        if (string.IsNullOrWhiteSpace(apiKey)) return null;

        var model = _configuration["PastorBot:Model"] ?? "gpt-4.1";
        var endpoint = _configuration["PastorBot:Endpoint"] ?? "https://api.openai.com/v1/responses";
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
                    content = "You translate formal business/HR document text only. Return strict JSON only."
                },
                new { role = "user", content = prompt }
            }
        };

        using var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
        using var response = await client.PostAsync(endpoint, content);
        if (!response.IsSuccessStatusCode)
        {
            _logger.LogWarning("Appointment letter translation provider failed with {StatusCode}", response.StatusCode);
            return null;
        }

        var json = await response.Content.ReadAsStringAsync();
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

    // The AI is asked for one combined {"translations": {...}} object, and usually returns
    // exactly that - but for some languages (observed with Punjabi) it instead answers with
    // several separate {"translations": {...}} objects back-to-back, one per phrase. Rather
    // than assume either shape, scan for every balanced top-level {...} span and merge
    // whatever each one contains.
    private static Dictionary<string, string> ParseTranslationMap(string? answer, IReadOnlyList<string> originals)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(answer)) return result;

        var allowed = originals.ToHashSet(StringComparer.Ordinal);

        foreach (var jsonChunk in ExtractJsonObjects(answer))
        {
            try
            {
                using var document = JsonDocument.Parse(jsonChunk);
                var root = document.RootElement;
                if (root.ValueKind == JsonValueKind.Object &&
                    root.TryGetProperty("translations", out var translations) &&
                    translations.ValueKind == JsonValueKind.Object)
                {
                    root = translations;
                }

                if (root.ValueKind != JsonValueKind.Object) continue;

                foreach (var property in root.EnumerateObject())
                {
                    if (!allowed.Contains(property.Name)) continue;
                    var value = property.Value.ValueKind == JsonValueKind.String ? property.Value.GetString() : null;
                    if (!string.IsNullOrWhiteSpace(value))
                        result[property.Name] = value.Trim();
                }
            }
            catch (JsonException)
            {
                // Skip this chunk - a malformed object shouldn't stop the rest from parsing.
            }
        }

        return result;
    }

    // Finds every balanced top-level {...} substring in the text (brace-depth counting,
    // aware of quoted strings so braces inside translated text don't throw off the count).
    private static IEnumerable<string> ExtractJsonObjects(string text)
    {
        var depth = 0;
        var start = -1;
        var inString = false;
        var escapeNext = false;

        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];

            if (inString)
            {
                if (escapeNext) escapeNext = false;
                else if (c == '\\') escapeNext = true;
                else if (c == '"') inString = false;
                continue;
            }

            if (c == '"') { inString = true; continue; }

            if (c == '{')
            {
                if (depth == 0) start = i;
                depth++;
            }
            else if (c == '}' && depth > 0)
            {
                depth--;
                if (depth == 0 && start >= 0)
                {
                    yield return text[start..(i + 1)];
                    start = -1;
                }
            }
        }
    }
}
