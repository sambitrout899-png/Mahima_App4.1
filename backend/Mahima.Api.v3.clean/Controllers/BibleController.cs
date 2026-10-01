using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Mahima.Api.v3.clean.Controllers;

[ApiController]
[Route("api/bible")]
[Authorize]
public sealed class BibleController : ControllerBase
{
    private const string PublicBibleCdn = "https://cdn.jsdelivr.net/gh/wldeh/bible-api/bibles";
    private static readonly IReadOnlyDictionary<string, string> ProviderVersions = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        ["en"] = "en-kjv", ["es"] = "es-rv09", ["de"] = "de-luther1912",
        ["hi"] = "hi-IN-irvhin", ["pa"] = "pa-IN-irvpun", ["ta"] = "ta-irvtam"
    };
    private static readonly IReadOnlyDictionary<string, string[]> ProviderBookNames = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
    {
        ["es"] = ["génesis","éxodo","levítico","números","deuteronomio","josué","jueces","rut","1samuel","2samuel","1reyes","2reyes","1crónicas","2crónicas","esdras","nehemías","ester","job","salmos","proverbios","eclesiastés","cantares","isaías","jeremías","lamentaciones","ezequiel","daniel","oseas","joel","amós","abdías","jonás","miqueas","nahúm","habacuc","sofonías","hageo","zacarías","malaquías","sanmateo","sanmarcos","sanlucas","sanjuan","hechos","romanos","1corintios","2corintios","gálatas","efesios","filipenses","colosenses","1tesalonicenses","2tesalonicenses","1timoteo","2timoteo","tito","filemón","hebreos","santiago","1pedro","2pedro","1juan","2juan","3juan","judas","apocalipsis"],
        ["de"] = ["1.mose","2.mose","3.mose","4.mose","5.mose","josua","richter","ruth","1.samuel","2.samuel","1.könige","2.könige","1.chonik","2.chronik","esra","nehemia","esther","hiob","psalmen","sprüche","prediger","hohelied","jesaja","jeremia","klagelieder","hesekiel","daniel","hosea","joel","amos","obadja","jona","micha","nahum","habakuk","zephanja","haggai","sacharja","maleachi","matthäus","markus","lukas","johannes","apostelgeschichte","römer","1.korinther","2.korinther","galater","epheser","philipper","kolosser","1.thessalonicher","2.thessalonicher","1.timotheus","2.timotheus","titus","philemon","hebräer","jakobus","1.petrus","2.petrus","1.johannes","2.johannes","3.johannes","judas","offenbarung"],
        ["hi"] = ["उत्पत्ति","निर्गमन","लैव्यव्यवस्था","गिनती","व्यवस्थाविवरण","यहोशू","न्यायियों","रूत","1शमूएल","2शमूएल","1राजाओं","2राजाओं","1इतिहास","2इतिहास","एज्रा","नहेम्याह","एस्तेर","अय्यूब","भजनसंहिता","नीतिवचन","सभोपदेशक","श्रेष्ठगीत","यशायाह","यिर्मयाह","विलापगीत","यहेजकेल","दानिय्येल","होशे","योएल","आमोस","ओबद्याह","योना","मीका","नहूम","हबक्कूक","सपन्याह","हाग्गै","जकर्याह","मलाकी","मत्ती","मरकुस","लूका","यूहन्ना","प्रेरितोंकेकाम","रोमियों","1कुरिन्थियों","2कुरिन्थियों","गलातियों","इफिसियों","फिलिप्पियों","कुलुस्सियों","1थिस्सलुनीकियों","2थिस्सलुनीकियों","1तीमुथियुस","2तीमुथियुस","तीतुस","फिलेमोन","इब्रानियों","याकूब","1पतरस","2पतरस","1यूहन्ना","2यूहन्ना","3यूहन्ना","यहूदा","प्रकाशितवाक्य"],
        ["pa"] = ["ਉਤ","ਕੂਚ","ਲੇਵੀਆਂ","ਗਿਣਤੀ","ਬਿਵਸਥਾ","ਯਹੋਸ਼ੁ","ਨਿਆਂਈ","ਰੂਥ","1ਸਮੂ","2ਸਮੂ","1ਰਾਜਾ","2ਰਾਜਾ","1ਇਤ","2ਇਤ","ਅਜ਼ਰਾ","ਨਹਮਯਾਹ","ਅਸਤਰ","ਅੱਯੂਬ","ਜ਼ਬੂਰ","ਕਹਾਉਤਾਂ","ਉਪਦੇਸ਼ਕ","ਸੁਲੇਮਾਨਦਾਗੀਤ","ਯਸਾ","ਯਿਰਮਿਯਾਹ","ਵਿਰਲਾਪ","ਹਿਜ਼ਕੀਏਲ","ਦਾਨੀਏਲ","ਹੋਸ਼ੇ","ਯੋਏਲ","ਆਮੋਸ","ਓਬਦਯਾਹ","ਯੂਨਾ","ਮੀਕਾ","ਨਹੂਮ","ਹਬੱਕੂਕ","ਸਫ਼ਨਯਾਹ","ਹੱਜਈ","ਜ਼ਕਰ","ਮਲਾਕੀ","ਮੱਤੀ","ਮਰਕੁਸ","ਲੂਕਾ","ਯੂਹੰਨਾ","ਰਸੂਲਾਂਦੇਕਰਤੱਬ","ਰੋਮੀਆਂ","1ਕੁਰਿੰਥੀ","2ਕੁਰਿੰਥੀ","ਗਲਾਤਿਯਾ","ਅਫ਼ਸੀਆਂ","ਫਿਲਿੱਪੀਆਂ","ਕੁਲੁੱਸੀਆਂ","1ਥੱਸਲੁ","2ਥੱਸਲੁ","1ਤਿਮੋਥਿ","2ਤਿਮੋਥਿ","ਤੀਤੁਸ","ਫਿਲੇਮੋਨ","ਇਬਰਾਨੀ","ਯਾਕੂਬ","1ਪਤ","2ਪਤ","1ਯੂਹੰਨਾ","2ਯੂਹੰਨਾ","3ਯੂਹੰਨਾ","ਯਹੂਦਾ","ਪਰਕਾਸ਼ਦੀਪੋਥੀ"],
        ["ta"] = ["ஆதி","யாத்","லேவி","எண்","உபா","யோசு","நியா","ரூத்","1சாமு","2சாமு","1இராஜா","2இராஜா","1நாளா","2நாளா","எஸ்றா","நெகே","எஸ்த","யோபு","சங்","நீதி","பிரச","உன்","ஏசா","எரே","புலம்","எசேக்","தானி","ஓசியா","யோவேல்","ஆமோ","ஒபதி","யோனா","மீகா","நாகூ","ஆப","செப்ப","ஆகாய்","சகரி","மல்கி","மத்","மாற்","லூக்","யோவா","அப்","ரோமர்","1கொரி","2கொரி","கலா","எபே","பிலி","கொலோ","1தெச","2தெச","1தீமோ","2தீமோ","தீத்","பிலே","எபி","யாக்","1பேது","2பேது","1யோவா","2யோவா","3யோவா","யூதா","வெளி"]
    };
    private static readonly (string Code, string Name, int Chapters)[] CanonicalBooks =
    [
        ("GEN","Genesis",50),("EXO","Exodus",40),("LEV","Leviticus",27),("NUM","Numbers",36),("DEU","Deuteronomy",34),
        ("JOS","Joshua",24),("JDG","Judges",21),("RUT","Ruth",4),("1SA","1 Samuel",31),("2SA","2 Samuel",24),
        ("1KI","1 Kings",22),("2KI","2 Kings",25),("1CH","1 Chronicles",29),("2CH","2 Chronicles",36),("EZR","Ezra",10),
        ("NEH","Nehemiah",13),("EST","Esther",10),("JOB","Job",42),("PSA","Psalms",150),("PRO","Proverbs",31),
        ("ECC","Ecclesiastes",12),("SNG","Song of Solomon",8),("ISA","Isaiah",66),("JER","Jeremiah",52),("LAM","Lamentations",5),
        ("EZK","Ezekiel",48),("DAN","Daniel",12),("HOS","Hosea",14),("JOL","Joel",3),("AMO","Amos",9),
        ("OBA","Obadiah",1),("JON","Jonah",4),("MIC","Micah",7),("NAM","Nahum",3),("HAB","Habakkuk",3),
        ("ZEP","Zephaniah",3),("HAG","Haggai",2),("ZEC","Zechariah",14),("MAL","Malachi",4),("MAT","Matthew",28),
        ("MRK","Mark",16),("LUK","Luke",24),("JHN","John",21),("ACT","Acts",28),("ROM","Romans",16),
        ("1CO","1 Corinthians",16),("2CO","2 Corinthians",13),("GAL","Galatians",6),("EPH","Ephesians",6),("PHP","Philippians",4),
        ("COL","Colossians",4),("1TH","1 Thessalonians",5),("2TH","2 Thessalonians",3),("1TI","1 Timothy",6),("2TI","2 Timothy",4),
        ("TIT","Titus",3),("PHM","Philemon",1),("HEB","Hebrews",13),("JAS","James",5),("1PE","1 Peter",5),
        ("2PE","2 Peter",3),("1JN","1 John",5),("2JN","2 John",1),("3JN","3 John",1),("JUD","Jude",1),("REV","Revelation",22)
    ];
    private readonly string _connectionString;
    private readonly IConfiguration _configuration;
    private readonly IWebHostEnvironment _environment;
    private readonly ILogger<BibleController> _logger;

    public BibleController(IConfiguration configuration, IWebHostEnvironment environment, ILogger<BibleController> logger)
    {
        _configuration = configuration;
        _environment = environment;
        _logger = logger;
        _connectionString = configuration.GetConnectionString("DefaultConnection") ?? configuration["DefaultConnection"] ?? "";
    }

    [HttpGet("translations")]
    public async Task<IActionResult> Translations()
    {
        await using var conn = await OpenAsync();
        await using var cmd = new NpgsqlCommand(@"
WITH counted AS (
    SELECT t.""Id"", t.""LanguageCode"", t.""LanguageName"", t.""NativeName"", t.""TranslationName"",
           t.""LicenseName"", t.""LicenseUrl"", t.""SortOrder"", count(v.""TranslationId"") AS ""VerseCount""
    FROM public.""BibleTranslations"" t
    LEFT JOIN public.""BibleVerses"" v ON v.""TranslationId"" = t.""Id""
    GROUP BY t.""Id""
), preferred AS (
    SELECT DISTINCT ON (lower(""LanguageCode"")) * FROM counted
    ORDER BY lower(""LanguageCode""), (""Id"" = lower(""LanguageCode"")) DESC, ""VerseCount"" DESC, ""Id""
)
SELECT ""Id"", ""LanguageCode"", ""LanguageName"", ""NativeName"", ""TranslationName"", ""LicenseName"", ""LicenseUrl"", ""VerseCount""
FROM preferred ORDER BY ""SortOrder"", ""LanguageName"";", conn);
        var rows = new List<object>();
        await using var rdr = await cmd.ExecuteReaderAsync();
        while (await rdr.ReadAsync()) rows.Add(new
        {
            id = rdr.GetString(0), languageCode = rdr.GetString(1), languageName = rdr.GetString(2),
            nativeName = rdr.GetString(3), translationName = rdr.GetString(4),
            licenseName = rdr.IsDBNull(5) ? null : rdr.GetString(5), licenseUrl = rdr.IsDBNull(6) ? null : rdr.GetString(6),
            verseCount = rdr.GetInt64(7), available = rdr.GetInt64(7) > 0 || ProviderVersions.ContainsKey(rdr.GetString(0)),
            contentMode = rdr.GetInt64(7) > 0 ? "cached" : ProviderVersions.ContainsKey(rdr.GetString(0)) ? "on-demand" : "import-required"
        });
        return Ok(rows);
    }

    [HttpGet("{translationId}/books")]
    public async Task<IActionResult> Books(string translationId)
    {
        await using var conn = await OpenAsync();
        await using var cmd = new NpgsqlCommand(@"
SELECT ""BookCode"", min(""BookName"") AS ""BookName"", min(""BookOrder"") AS ""BookOrder"", max(""Chapter"") AS ""Chapters""
FROM public.""BibleVerses"" WHERE ""TranslationId""=@translation
GROUP BY ""BookCode"" ORDER BY min(""BookOrder"");", conn);
        cmd.Parameters.AddWithValue("translation", translationId);
        var installed = new Dictionary<string, (string Name, int Chapters)>(StringComparer.OrdinalIgnoreCase);
        await using var rdr = await cmd.ExecuteReaderAsync();
        while (await rdr.ReadAsync()) installed[rdr.GetString(0)] = (rdr.GetString(1), rdr.GetInt32(3));
        var rows = CanonicalBooks.Select((book, index) =>
        {
            var cached = installed.TryGetValue(book.Code, out var content);
            var available = cached || ProviderVersions.ContainsKey(translationId);
            return new { code = book.Code, name = cached ? content.Name : book.Name, order = index + 1, chapters = book.Chapters, available, installedChapters = cached ? content.Chapters : 0, source = cached ? "cache" : available ? "provider" : "none" };
        });
        return Ok(rows);
    }

    [HttpGet("{translationId}/{bookCode}/{chapter:int}")]
    public async Task<IActionResult> Chapter(string translationId, string bookCode, int chapter)
    {
        await using var conn = await OpenAsync();
        var canonicalIndex = Array.FindIndex(CanonicalBooks, b => b.Code.Equals(bookCode, StringComparison.OrdinalIgnoreCase));
        if (canonicalIndex < 0) return BadRequest(new { message = "The selected Bible book is invalid." });
        if (chapter < 1 || chapter > CanonicalBooks[canonicalIndex].Chapters) return BadRequest(new { message = "The selected chapter is invalid." });
        if (!await ChapterExistsAsync(conn, translationId, bookCode, chapter))
        {
            try { await DownloadAndCacheChapterAsync(conn, translationId, canonicalIndex, chapter); }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Bible provider failed for {Translation} {Book} {Chapter}", translationId, bookCode, chapter);
                return StatusCode(StatusCodes.Status502BadGateway, new { message = ex.Message });
            }
        }
        await using var cmd = new NpgsqlCommand(@"
SELECT ""BookName"", ""Verse"", ""Text"" FROM public.""BibleVerses""
WHERE ""TranslationId""=@translation AND upper(""BookCode"")=upper(@book) AND ""Chapter""=@chapter
ORDER BY ""Verse"";", conn);
        cmd.Parameters.AddWithValue("translation", translationId); cmd.Parameters.AddWithValue("book", bookCode); cmd.Parameters.AddWithValue("chapter", chapter);
        var verses = new List<object>(); string? bookName = null;
        await using var rdr = await cmd.ExecuteReaderAsync();
        while (await rdr.ReadAsync()) { bookName ??= rdr.GetString(0); verses.Add(new { verse = rdr.GetInt32(1), text = rdr.GetString(2) }); }
        if (verses.Count == 0) return NotFound(new { message = "This translation has no approved content provider. A Root Admin must import a legally licensed translation." });
        return Ok(new { translationId, bookCode, bookName, chapter, verses });
    }

    [HttpGet("search")]
    public async Task<IActionResult> Search([FromQuery] string translationId, [FromQuery] string q, [FromQuery] int limit = 50)
    {
        if (string.IsNullOrWhiteSpace(q) || q.Trim().Length < 2) return BadRequest(new { message = "Enter at least two characters to search." });
        await using var conn = await OpenAsync();
        await using var cmd = new NpgsqlCommand(@"
SELECT ""BookCode"", ""BookName"", ""Chapter"", ""Verse"", ""Text"" FROM public.""BibleVerses""
WHERE ""TranslationId""=@translation AND ""Text"" ILIKE @query
ORDER BY ""BookOrder"", ""Chapter"", ""Verse"" LIMIT @limit;", conn);
        cmd.Parameters.AddWithValue("translation", translationId); cmd.Parameters.AddWithValue("query", $"%{q.Trim()}%"); cmd.Parameters.AddWithValue("limit", Math.Clamp(limit, 1, 100));
        var rows = new List<object>(); await using var rdr = await cmd.ExecuteReaderAsync();
        while (await rdr.ReadAsync()) rows.Add(new { bookCode = rdr.GetString(0), bookName = rdr.GetString(1), chapter = rdr.GetInt32(2), verse = rdr.GetInt32(3), text = rdr.GetString(4) });
        return Ok(rows);
    }

    [HttpPost("sync/{translationId}")]
    public async Task<IActionResult> SyncTranslation(string translationId, [FromQuery] bool force = false)
    {
        if (!IsAdmin()) return Forbid();
        if (!ProviderVersions.ContainsKey(translationId)) return BadRequest(new { message = "This translation has no configured content source." });
        await using var conn = await OpenAsync();
        using var client = CreateBibleClient(TimeSpan.FromMinutes(2));
        var importedChapters = 0; var skippedChapters = 0; var importedVerses = 0; var failures = new List<object>();
        for (var bookIndex = 0; bookIndex < CanonicalBooks.Length; bookIndex++)
        {
            var book = CanonicalBooks[bookIndex];
            for (var chapter = 1; chapter <= book.Chapters; chapter++)
            {
                if (!force && await ChapterExistsAsync(conn, translationId, book.Code, chapter)) { skippedChapters++; continue; }
                try { importedVerses += await DownloadAndCacheChapterAsync(conn, translationId, bookIndex, chapter, client); importedChapters++; }
                catch (Exception ex) { failures.Add(new { bookCode = book.Code, bookName = book.Name, chapter, error = ex.Message }); _logger.LogWarning(ex, "Bible bulk sync failed for {Translation} {Book} {Chapter}", translationId, book.Code, chapter); }
            }
        }
        return Ok(new { message = failures.Count == 0 ? "Bible translation synchronization completed." : "Bible translation synchronization completed with some unavailable chapters.", translationId, importedChapters, skippedChapters, importedVerses, failedChapters = failures.Count, failures });
    }

    [HttpPost("import")]
    public async Task<IActionResult> Import([FromBody] BibleImportDto dto)
    {
        if (!IsAdmin()) return Forbid();
        if (!dto.LicenseConfirmed) return BadRequest(new { message = "Confirm that this translation may legally be stored and distributed." });
        if (string.IsNullOrWhiteSpace(dto.TranslationId) || dto.Verses.Count == 0) return BadRequest(new { message = "Translation ID and verses are required." });
        await using var conn = await OpenAsync(); await using var tx = await conn.BeginTransactionAsync();
        await using (var translation = new NpgsqlCommand(@"
INSERT INTO public.""BibleTranslations"" (""Id"",""LanguageCode"",""LanguageName"",""NativeName"",""TranslationName"",""LicenseName"",""LicenseUrl"",""SortOrder"",""UpdatedAtUtc"")
VALUES (@id,@code,@name,@native,@translation,@license,@licenseUrl,@sort,now())
ON CONFLICT (""Id"") DO UPDATE SET ""LanguageCode""=excluded.""LanguageCode"", ""LanguageName""=excluded.""LanguageName"", ""NativeName""=excluded.""NativeName"", ""TranslationName""=excluded.""TranslationName"", ""LicenseName""=excluded.""LicenseName"", ""LicenseUrl""=excluded.""LicenseUrl"", ""UpdatedAtUtc""=now();", conn, tx))
        {
            translation.Parameters.AddWithValue("id", dto.TranslationId.Trim()); translation.Parameters.AddWithValue("code", dto.LanguageCode.Trim().ToLowerInvariant());
            translation.Parameters.AddWithValue("name", dto.LanguageName.Trim()); translation.Parameters.AddWithValue("native", dto.NativeName.Trim());
            translation.Parameters.AddWithValue("translation", dto.TranslationName.Trim()); translation.Parameters.AddWithValue("license", (object?)dto.LicenseName ?? DBNull.Value);
            translation.Parameters.AddWithValue("licenseUrl", (object?)dto.LicenseUrl ?? DBNull.Value); translation.Parameters.AddWithValue("sort", LanguageOrder(dto.LanguageCode));
            await translation.ExecuteNonQueryAsync();
        }
        await using (var delete = new NpgsqlCommand("DELETE FROM public.\"BibleVerses\" WHERE \"TranslationId\"=@id", conn, tx)) { delete.Parameters.AddWithValue("id", dto.TranslationId.Trim()); await delete.ExecuteNonQueryAsync(); }
        foreach (var verse in dto.Verses)
        {
            await using var insert = new NpgsqlCommand(@"INSERT INTO public.""BibleVerses"" (""TranslationId"",""BookCode"",""BookName"",""BookOrder"",""Chapter"",""Verse"",""Text"") VALUES (@t,@bc,@bn,@bo,@c,@v,@text);", conn, tx);
            insert.Parameters.AddWithValue("t", dto.TranslationId.Trim()); insert.Parameters.AddWithValue("bc", verse.BookCode.Trim().ToUpperInvariant()); insert.Parameters.AddWithValue("bn", verse.BookName.Trim()); insert.Parameters.AddWithValue("bo", verse.BookOrder); insert.Parameters.AddWithValue("c", verse.Chapter); insert.Parameters.AddWithValue("v", verse.Verse); insert.Parameters.AddWithValue("text", verse.Text.Trim()); await insert.ExecuteNonQueryAsync();
        }
        await tx.CommitAsync();
        return Ok(new { message = $"Imported {dto.Verses.Count} verses for {dto.TranslationName}.", verseCount = dto.Verses.Count });
    }

    [HttpPost("{translationId}/{bookCode}/{chapter:int}/audio")]
    public async Task<IActionResult> Audio(string translationId, string bookCode, int chapter)
    {
        await using var conn = await OpenAsync();
        var (language, translation, text) = await ChapterTextAsync(conn, translationId, bookCode, chapter);
        if (string.IsNullOrWhiteSpace(text)) return NotFound(new { message = "Chapter text was not found." });
        var root = _configuration["Bible:AudioCacheRoot"] ?? (OperatingSystem.IsLinux() ? "/var/lib/mahima/bible-audio" : Path.Combine(_environment.WebRootPath ?? _environment.ContentRootPath, "bible-audio"));
        var directory = Path.Combine(root, Safe(translationId), Safe(bookCode)); Directory.CreateDirectory(directory);
        var output = Path.Combine(directory, $"{chapter}.mp3");
        if (!System.IO.File.Exists(output)) await GenerateSpeechAsync(text, language, translation, output);
        return PhysicalFile(output, "audio/mpeg", $"{Safe(translationId)}-{Safe(bookCode)}-{chapter}.mp3", enableRangeProcessing: true);
    }

    private async Task<NpgsqlConnection> OpenAsync()
    {
        if (string.IsNullOrWhiteSpace(_connectionString)) throw new InvalidOperationException("DefaultConnection is not configured.");
        var conn = new NpgsqlConnection(_connectionString); await conn.OpenAsync(); await EnsureSchemaAsync(conn); return conn;
    }

    private static async Task EnsureSchemaAsync(NpgsqlConnection conn)
    {
        await using var cmd = new NpgsqlCommand(@"
CREATE TABLE IF NOT EXISTS public.""BibleTranslations"" (""Id"" text PRIMARY KEY,""LanguageCode"" text NOT NULL,""LanguageName"" text NOT NULL,""NativeName"" text NOT NULL,""TranslationName"" text NOT NULL,""LicenseName"" text NULL,""LicenseUrl"" text NULL,""SortOrder"" integer NOT NULL DEFAULT 99,""UpdatedAtUtc"" timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.""BibleVerses"" (""TranslationId"" text NOT NULL REFERENCES public.""BibleTranslations""(""Id"") ON DELETE CASCADE,""BookCode"" text NOT NULL,""BookName"" text NOT NULL,""BookOrder"" integer NOT NULL,""Chapter"" integer NOT NULL,""Verse"" integer NOT NULL,""Text"" text NOT NULL,PRIMARY KEY(""TranslationId"",""BookCode"",""Chapter"",""Verse""));
CREATE INDEX IF NOT EXISTS ""IX_BibleVerses_Search"" ON public.""BibleVerses"" (""TranslationId"",""BookOrder"",""Chapter"",""Verse"");
INSERT INTO public.""BibleTranslations"" (""Id"",""LanguageCode"",""LanguageName"",""NativeName"",""TranslationName"",""SortOrder"") VALUES
('en','en','English','English','Authorized English Translation',1),('es','es','Spanish','Español','Traducción española autorizada',2),('de','de','German','Deutsch','Autorisierte deutsche Übersetzung',3),('hi','hi','Hindi','हिन्दी','अधिकृत हिन्दी अनुवाद',4),('pa','pa','Punjabi','ਪੰਜਾਬੀ','ਅਧਿਕਾਰਤ ਪੰਜਾਬੀ ਅਨੁਵਾਦ',5),('ta','ta','Tamil','தமிழ்','அங்கீகரிக்கப்பட்ட தமிழ் மொழிபெயர்ப்பு',6)
ON CONFLICT (""Id"") DO NOTHING;", conn); await cmd.ExecuteNonQueryAsync();
        var labels = new[]
        {
            ("en", "English", "King James Version (KJV)"),
            ("es", "Español", "Traducción española autorizada"),
            ("de", "Deutsch", "Autorisierte deutsche Übersetzung"),
            ("hi", "हिन्दी", "अधिकृत हिन्दी अनुवाद"),
            ("pa", "ਪੰजाबी", "ਅਧਿकारत ਪੰजाबी ਅਨुवाद"),
            ("ta", "தமிழ்", "அங்கீகரிக்கப்பட்ட தமிழ் மொழிபெயர்ப்பு")
        };
        foreach (var label in labels)
        {
            await using var repair = new NpgsqlCommand(@"UPDATE public.""BibleTranslations"" SET ""NativeName""=@native, ""TranslationName""=CASE WHEN NOT EXISTS (SELECT 1 FROM public.""BibleVerses"" v WHERE v.""TranslationId""=@id) THEN @translation ELSE ""TranslationName"" END WHERE ""Id""=@id;", conn);
            repair.Parameters.AddWithValue("id", label.Item1); repair.Parameters.AddWithValue("native", label.Item2); repair.Parameters.AddWithValue("translation", label.Item3);
            await repair.ExecuteNonQueryAsync();
        }
    }

    private static int LanguageOrder(string code) => Array.IndexOf(new[] { "en", "es", "de", "hi", "pa", "ta" }, code.Trim().ToLowerInvariant()) is var i && i >= 0 ? i + 1 : 99;

    private static async Task<bool> ChapterExistsAsync(NpgsqlConnection conn, string translationId, string bookCode, int chapter)
    {
        await using var cmd = new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM public.\"BibleVerses\" WHERE \"TranslationId\"=@t AND upper(\"BookCode\")=upper(@b) AND \"Chapter\"=@c);", conn);
        cmd.Parameters.AddWithValue("t", translationId); cmd.Parameters.AddWithValue("b", bookCode); cmd.Parameters.AddWithValue("c", chapter);
        return (bool)(await cmd.ExecuteScalarAsync() ?? false);
    }

    private async Task<int> DownloadAndCacheChapterAsync(NpgsqlConnection conn, string translationId, int bookIndex, int chapter, HttpClient? sharedClient = null)
    {
        if (!ProviderVersions.TryGetValue(translationId, out var version))
            throw new InvalidOperationException("This language needs an approved Bible translation import before it can be read.");
        var book = CanonicalBooks[bookIndex];
        var slug = ProviderBookNames.TryGetValue(translationId, out var localized) && localized.Length == CanonicalBooks.Length
            ? localized[bookIndex]
            : string.Concat(book.Name.Where(char.IsLetterOrDigit)).ToLowerInvariant();
        var url = $"{PublicBibleCdn}/{version}/books/{slug}/chapters/{chapter}.json";
        using var ownedClient = sharedClient is null ? CreateBibleClient(TimeSpan.FromSeconds(45)) : null;
        var client = sharedClient ?? ownedClient!;
        using var response = await client.GetAsync(url);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"Bible content provider returned {(int)response.StatusCode} for {book.Name} {chapter}.");
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        var hasVerses = root.TryGetProperty("verses", out var verseArray) || root.TryGetProperty("data", out verseArray);
        if (!hasVerses || verseArray.ValueKind != JsonValueKind.Array)
            throw new InvalidOperationException("Bible content provider returned an unexpected response.");
        var uniqueVerses = new Dictionary<int, string>();
        foreach (var item in verseArray.EnumerateArray())
        {
            var number = ReadInt(item, "verse");
            var text = item.TryGetProperty("text", out var textNode) ? textNode.GetString()?.Trim() : null;
            if (number <= 0 || string.IsNullOrWhiteSpace(text)) continue;
            uniqueVerses[number] = CleanVerseText(text, chapter, number);
        }
        if (uniqueVerses.Count == 0) throw new InvalidOperationException($"No verses were returned for {book.Name} {chapter}.");
        await using var tx = await conn.BeginTransactionAsync();
        await using (var clear = new NpgsqlCommand(@"DELETE FROM public.""BibleVerses"" WHERE ""TranslationId""=@t AND ""BookCode""=@bc AND ""Chapter""=@c;", conn, tx))
        {
            clear.Parameters.AddWithValue("t", translationId); clear.Parameters.AddWithValue("bc", book.Code); clear.Parameters.AddWithValue("c", chapter); await clear.ExecuteNonQueryAsync();
        }
        foreach (var verse in uniqueVerses.OrderBy(v => v.Key))
        {
            await using var insert = new NpgsqlCommand(@"INSERT INTO public.""BibleVerses"" (""TranslationId"",""BookCode"",""BookName"",""BookOrder"",""Chapter"",""Verse"",""Text"") VALUES (@t,@bc,@bn,@bo,@c,@v,@text) ON CONFLICT (""TranslationId"",""BookCode"",""Chapter"",""Verse"") DO UPDATE SET ""Text""=excluded.""Text"";", conn, tx);
            insert.Parameters.AddWithValue("t", translationId); insert.Parameters.AddWithValue("bc", book.Code); insert.Parameters.AddWithValue("bn", book.Name); insert.Parameters.AddWithValue("bo", bookIndex + 1); insert.Parameters.AddWithValue("c", chapter); insert.Parameters.AddWithValue("v", verse.Key); insert.Parameters.AddWithValue("text", verse.Value); await insert.ExecuteNonQueryAsync();
        }
        await tx.CommitAsync();
        return uniqueVerses.Count;
    }

    private static HttpClient CreateBibleClient(TimeSpan timeout)
    {
        var client = new HttpClient { Timeout = timeout }; client.DefaultRequestHeaders.UserAgent.ParseAdd("Mahima-Bible/1.0"); return client;
    }

    private static string CleanVerseText(string text, int chapter, int verse)
    {
        var cleaned = text.Replace("¶", "").Trim();
        cleaned = Regex.Replace(cleaned, $@"\s*{chapter}\.{verse}\s+.*$", "", RegexOptions.Singleline);
        return Regex.Replace(cleaned, @"\s+", " ").Trim();
    }

    private static int ReadInt(JsonElement element, string property)
    {
        if (!element.TryGetProperty(property, out var value)) return 0;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number;
        return value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out number) ? number : 0;
    }

    private bool IsAdmin() => string.Equals(User.FindFirstValue(ClaimTypes.Role) ?? User.FindFirstValue("role"), "admin", StringComparison.OrdinalIgnoreCase);
    private static string Safe(string value) => new(value.Where(char.IsLetterOrDigit).ToArray());

    private static async Task<(string Language, string Translation, string Text)> ChapterTextAsync(NpgsqlConnection conn, string translationId, string bookCode, int chapter)
    {
        await using var cmd = new NpgsqlCommand(@"SELECT t.""LanguageName"",t.""TranslationName"",v.""BookName"",v.""Verse"",v.""Text"" FROM public.""BibleVerses"" v JOIN public.""BibleTranslations"" t ON t.""Id""=v.""TranslationId"" WHERE v.""TranslationId""=@t AND upper(v.""BookCode"")=upper(@b) AND v.""Chapter""=@c ORDER BY v.""Verse"";", conn);
        cmd.Parameters.AddWithValue("t", translationId); cmd.Parameters.AddWithValue("b", bookCode); cmd.Parameters.AddWithValue("c", chapter);
        string language = "English", translation = translationId, book = bookCode; var text = new StringBuilder(); await using var rdr = await cmd.ExecuteReaderAsync();
        while (await rdr.ReadAsync()) { language = rdr.GetString(0); translation = rdr.GetString(1); book = rdr.GetString(2); text.Append($"Verse {rdr.GetInt32(3)}. {rdr.GetString(4)} "); }
        return (language, translation, $"{book}, chapter {chapter}. {text}");
    }

    private async Task GenerateSpeechAsync(string text, string language, string translation, string output)
    {
        var key = _configuration["Bible:OpenAiApiKey"] ?? _configuration["PastorBot:ApiKey"] ?? Environment.GetEnvironmentVariable("OPENAI_API_KEY");
        if (string.IsNullOrWhiteSpace(key)) throw new InvalidOperationException("OpenAI API key is not configured for Bible audio.");
        var baseUrl = (_configuration["Bible:OpenAiBaseUrl"] ?? _configuration["PastorBot:BaseUrl"] ?? "https://api.openai.com/v1").TrimEnd('/');
        var model = _configuration["Bible:TtsModel"] ?? "gpt-4o-mini-tts"; var voice = _configuration["Bible:TtsVoice"] ?? "onyx";
        using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(5) }; client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", key);
        var chunks = text.Chunk(3500).Select(chars => new string(chars)).ToArray(); await using var file = System.IO.File.Create(output);
        foreach (var chunk in chunks)
        {
            var payload = JsonSerializer.Serialize(new { model, voice, input = chunk, instructions = $"Read this {language} Bible text reverently, calmly, clearly, and without adding commentary. Translation: {translation}.", response_format = "mp3" });
            using var response = await client.PostAsync($"{baseUrl}/audio/speech", new StringContent(payload, Encoding.UTF8, "application/json"));
            var bytes = await response.Content.ReadAsByteArrayAsync(); if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"Bible audio generation failed: {(int)response.StatusCode} {Encoding.UTF8.GetString(bytes)}"); await file.WriteAsync(bytes);
        }
        _logger.LogInformation("Generated cached Bible audio {Output}", output);
    }

    public sealed class BibleImportDto { public string TranslationId { get; set; } = ""; public string LanguageCode { get; set; } = ""; public string LanguageName { get; set; } = ""; public string NativeName { get; set; } = ""; public string TranslationName { get; set; } = ""; public string? LicenseName { get; set; } public string? LicenseUrl { get; set; } public bool LicenseConfirmed { get; set; } public List<BibleVerseDto> Verses { get; set; } = []; }
    public sealed class BibleVerseDto { public string BookCode { get; set; } = ""; public string BookName { get; set; } = ""; public int BookOrder { get; set; } public int Chapter { get; set; } public int Verse { get; set; } public string Text { get; set; } = ""; }
}
