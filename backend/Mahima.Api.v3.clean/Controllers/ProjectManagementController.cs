using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Net.Http.Headers;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Npgsql;
using NpgsqlTypes;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    [Authorize]
    [Route("api/projectmanagement")]
    public class ProjectManagementController : ControllerBase
    {
        // Keep the compatibility version for existing clients. The current UI also
        // checks the build and script capability before starting a render.
        private const string DemoRendererVersion = "2026.08.10-short-video-v3";
        private const string DemoRendererBuild = "2026.09.18-cinematic-story-v7";
        private readonly string _connStr;
        private readonly ILogger<ProjectManagementController> _logger;
        private readonly IConfiguration _config;
        private readonly IWebHostEnvironment _env;
        private static volatile bool _schemaReady;

        public ProjectManagementController(IConfiguration config, ILogger<ProjectManagementController> logger, IWebHostEnvironment env)
        {
            _connStr = config.GetConnectionString("DefaultConnection") ?? string.Empty;
            _logger = logger;
            _config = config;
            _env = env;
        }

        [HttpPost("demo-voice-preview")]
        public async Task<IActionResult> PreviewDemoVoice([FromBody] DemoRenderJobDto dto)
        {
            var allowedVoices = new[] { "onyx", "ash", "echo", "nova", "shimmer" };
            if (!allowedVoices.Contains(dto.TtsVoice) || string.IsNullOrWhiteSpace(dto.VoiceOver) || dto.VoiceOver.Length > 1000)
                return BadRequest(new { message = "Select a supported voice and a short preview script." });
            var apiKey = OpenAiApiKey();
            if (string.IsNullOrWhiteSpace(apiKey))
                return BadRequest(new { message = "Demo speech is not configured." });
            var baseUrl = (_config["ProjectDemo:OpenAiBaseUrl"] ?? _config["PastorBot:BaseUrl"] ?? "https://api.openai.com/v1").TrimEnd('/');
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(60) };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
            using var content = new StringContent(JsonSerializer.Serialize(new {
                model = _config["ProjectDemo:TtsModel"] ?? "gpt-4o-mini-tts",
                voice = dto.TtsVoice, input = dto.VoiceOver,
                instructions = dto.TtsInstructions, response_format = "mp3"
            }), Encoding.UTF8, "application/json");
            using var response = await client.PostAsync($"{baseUrl}/audio/speech", content, HttpContext.RequestAborted);
            if (!response.IsSuccessStatusCode)
                return StatusCode(502, new { message = "The speech provider could not generate the selected voice preview." });
            return File(await response.Content.ReadAsByteArrayAsync(HttpContext.RequestAborted), "audio/mpeg");
        }

        private async Task EnsureSchemaAsync(NpgsqlConnection conn)
        {
            if (_schemaReady) return;

            const string sql = @"
CREATE TABLE IF NOT EXISTS public.""ProjectManagementProjects"" (
    ""Id"" text PRIMARY KEY,
    ""Name"" text NOT NULL,
    ""TemplateKey"" text NOT NULL,
    ""Type"" text NOT NULL,
    ""Sponsor"" text NULL,
    ""Manager"" text NULL,
    ""Status"" text NOT NULL DEFAULT 'Active',
    ""Health"" text NOT NULL DEFAULT 'Green',
    ""Priority"" text NULL,
    ""Budget"" numeric(18,2) NOT NULL DEFAULT 0,
    ""Spent"" numeric(18,2) NOT NULL DEFAULT 0,
    ""Progress"" integer NOT NULL DEFAULT 0,
    ""StartDate"" date NULL,
    ""TargetDate"" date NULL,
    ""Phases"" jsonb NOT NULL DEFAULT '[]'::jsonb,
    ""Workstreams"" jsonb NOT NULL DEFAULT '[]'::jsonb,
    ""Risks"" jsonb NOT NULL DEFAULT '[]'::jsonb,
    ""Decisions"" jsonb NOT NULL DEFAULT '[]'::jsonb,
    ""CreatedById"" uuid NULL,
    ""CreatedAtUtc"" timestamp with time zone NOT NULL DEFAULT now(),
    ""UpdatedAtUtc"" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_project_management_projects_status ON public.""ProjectManagementProjects"" (""Status"", ""Health"");
CREATE INDEX IF NOT EXISTS ix_project_management_projects_template ON public.""ProjectManagementProjects"" (""TemplateKey"");

CREATE TABLE IF NOT EXISTS public.""ProjectDemoRenderJobs"" (
    ""Id"" text PRIMARY KEY,
    ""ProjectId"" text NULL REFERENCES public.""ProjectManagementProjects""(""Id"") ON DELETE SET NULL,
    ""Name"" text NOT NULL,
    ""Language"" text NOT NULL,
    ""Status"" text NOT NULL DEFAULT 'queued',
    ""OutputFileName"" text NOT NULL,
    ""FrameRate"" integer NOT NULL DEFAULT 30,
    ""Resolution"" text NOT NULL DEFAULT '1920x1080',
    ""VoiceOver"" text NULL,
    ""AppBaseUrl"" text NULL,
    ""VoiceKey"" text NULL,
    ""VoiceLabel"" text NULL,
    ""TtsVoice"" text NULL,
    ""TtsInstructions"" text NULL,
    ""DurationSeconds"" integer NOT NULL DEFAULT 90,
    ""MusicStyle"" text NOT NULL DEFAULT 'uplifting',
    ""MusicVolume"" double precision NOT NULL DEFAULT 0.12,
    ""CaptureRoutes"" jsonb NOT NULL DEFAULT '[]'::jsonb,
    ""RendererRequirements"" jsonb NOT NULL DEFAULT '[]'::jsonb,
    ""RequestedById"" uuid NULL,
    ""RequestedAtUtc"" timestamp with time zone NOT NULL DEFAULT now(),
    ""CompletedAtUtc"" timestamp with time zone NULL,
    ""DownloadUrl"" text NULL,
    ""LastError"" text NULL
);

CREATE INDEX IF NOT EXISTS ix_project_demo_render_jobs_language_status ON public.""ProjectDemoRenderJobs"" (""Language"", ""Status"");

ALTER TABLE public.""ProjectDemoRenderJobs"" ADD COLUMN IF NOT EXISTS ""AppBaseUrl"" text NULL;
ALTER TABLE public.""ProjectDemoRenderJobs"" ADD COLUMN IF NOT EXISTS ""VoiceKey"" text NULL;
ALTER TABLE public.""ProjectDemoRenderJobs"" ADD COLUMN IF NOT EXISTS ""VoiceLabel"" text NULL;
ALTER TABLE public.""ProjectDemoRenderJobs"" ADD COLUMN IF NOT EXISTS ""TtsVoice"" text NULL;
ALTER TABLE public.""ProjectDemoRenderJobs"" ADD COLUMN IF NOT EXISTS ""TtsInstructions"" text NULL;
ALTER TABLE public.""ProjectDemoRenderJobs"" ADD COLUMN IF NOT EXISTS ""DurationSeconds"" integer NOT NULL DEFAULT 90;
ALTER TABLE public.""ProjectDemoRenderJobs"" ADD COLUMN IF NOT EXISTS ""MusicStyle"" text NOT NULL DEFAULT 'uplifting';
ALTER TABLE public.""ProjectDemoRenderJobs"" ADD COLUMN IF NOT EXISTS ""MusicVolume"" double precision NOT NULL DEFAULT 0.12;";

            await using var cmd = new NpgsqlCommand(sql, conn);
            await cmd.ExecuteNonQueryAsync();
            _schemaReady = true;
        }

        [HttpGet("projects")]
        public async Task<IActionResult> GetProjects()
        {
            var list = new List<object>();
            await using var conn = new NpgsqlConnection(_connStr);
            await conn.OpenAsync();
            await EnsureSchemaAsync(conn);

            await using var cmd = new NpgsqlCommand(@"
SELECT ""Id"", ""Name"", ""TemplateKey"", ""Type"", ""Sponsor"", ""Manager"", ""Status"", ""Health"", ""Priority"",
       ""Budget"", ""Spent"", ""Progress"", ""StartDate"", ""TargetDate"", ""Phases""::text, ""Workstreams""::text, ""Risks""::text, ""Decisions""::text,
       ""CreatedAtUtc"", ""UpdatedAtUtc""
FROM public.""ProjectManagementProjects""
ORDER BY ""UpdatedAtUtc"" DESC, ""CreatedAtUtc"" DESC;", conn);

            await using var rdr = await cmd.ExecuteReaderAsync();
            while (await rdr.ReadAsync())
            {
                list.Add(new
                {
                    id = rdr.GetString(0),
                    name = rdr.GetString(1),
                    templateKey = rdr.GetString(2),
                    type = rdr.GetString(3),
                    sponsor = rdr.IsDBNull(4) ? "" : rdr.GetString(4),
                    manager = rdr.IsDBNull(5) ? "" : rdr.GetString(5),
                    status = rdr.GetString(6),
                    health = rdr.GetString(7),
                    priority = rdr.IsDBNull(8) ? "" : rdr.GetString(8),
                    budget = rdr.GetDecimal(9),
                    spent = rdr.GetDecimal(10),
                    progress = rdr.GetInt32(11),
                    startDate = rdr.IsDBNull(12) ? null : rdr.GetDateTime(12).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    targetDate = rdr.IsDBNull(13) ? null : rdr.GetDateTime(13).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    phases = JsonElementFrom(rdr.GetString(14)),
                    workstreams = JsonElementFrom(rdr.GetString(15)),
                    risks = JsonElementFrom(rdr.GetString(16)),
                    decisions = JsonElementFrom(rdr.GetString(17)),
                    createdAtUtc = rdr.GetDateTime(18),
                    updatedAtUtc = rdr.GetDateTime(19)
                });
            }

            return Ok(list);
        }

        [HttpPost("projects")]
        public async Task<IActionResult> UpsertProject([FromBody] ProjectDto dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.Name)) return BadRequest(new { message = "Project name is required." });

            var id = string.IsNullOrWhiteSpace(dto.Id) ? $"project_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}" : dto.Id.Trim();
            await using var conn = new NpgsqlConnection(_connStr);
            await conn.OpenAsync();
            await EnsureSchemaAsync(conn);

            await using var cmd = new NpgsqlCommand(@"
INSERT INTO public.""ProjectManagementProjects""
(""Id"", ""Name"", ""TemplateKey"", ""Type"", ""Sponsor"", ""Manager"", ""Status"", ""Health"", ""Priority"", ""Budget"", ""Spent"", ""Progress"", ""StartDate"", ""TargetDate"", ""Phases"", ""Workstreams"", ""Risks"", ""Decisions"", ""CreatedById"", ""CreatedAtUtc"", ""UpdatedAtUtc"")
VALUES (@id, @name, @templateKey, @type, @sponsor, @manager, @status, @health, @priority, @budget, @spent, @progress, @startDate, @targetDate, @phases, @workstreams, @risks, @decisions, @createdById, now(), now())
ON CONFLICT (""Id"") DO UPDATE SET
    ""Name"" = EXCLUDED.""Name"",
    ""TemplateKey"" = EXCLUDED.""TemplateKey"",
    ""Type"" = EXCLUDED.""Type"",
    ""Sponsor"" = EXCLUDED.""Sponsor"",
    ""Manager"" = EXCLUDED.""Manager"",
    ""Status"" = EXCLUDED.""Status"",
    ""Health"" = EXCLUDED.""Health"",
    ""Priority"" = EXCLUDED.""Priority"",
    ""Budget"" = EXCLUDED.""Budget"",
    ""Spent"" = EXCLUDED.""Spent"",
    ""Progress"" = EXCLUDED.""Progress"",
    ""StartDate"" = EXCLUDED.""StartDate"",
    ""TargetDate"" = EXCLUDED.""TargetDate"",
    ""Phases"" = EXCLUDED.""Phases"",
    ""Workstreams"" = EXCLUDED.""Workstreams"",
    ""Risks"" = EXCLUDED.""Risks"",
    ""Decisions"" = EXCLUDED.""Decisions"",
    ""UpdatedAtUtc"" = now()
RETURNING ""Id"";", conn);

            AddProjectParameters(cmd, id, dto);
            var savedId = Convert.ToString(await cmd.ExecuteScalarAsync());
            return Ok(new { id = savedId });
        }

        [HttpDelete("projects/{id}")]
        public async Task<IActionResult> DeleteProject(string id)
        {
            await using var conn = new NpgsqlConnection(_connStr);
            await conn.OpenAsync();
            await EnsureSchemaAsync(conn);

            await using var cmd = new NpgsqlCommand(@"DELETE FROM public.""ProjectManagementProjects"" WHERE ""Id"" = @id;", conn);
            cmd.Parameters.AddWithValue("id", id);
            var rows = await cmd.ExecuteNonQueryAsync();
            return rows == 0 ? NotFound() : NoContent();
        }

        [HttpGet("demo-jobs")]
        public async Task<IActionResult> GetDemoJobs([FromQuery] string? language = null)
        {
            var list = new List<object>();
            await using var conn = new NpgsqlConnection(_connStr);
            await conn.OpenAsync();
            await EnsureSchemaAsync(conn);

            var sql = @"
SELECT ""Id"", ""ProjectId"", ""Name"", ""Language"", ""Status"", ""OutputFileName"", ""FrameRate"", ""Resolution"", ""VoiceOver"", ""AppBaseUrl"", ""VoiceKey"", ""VoiceLabel"", ""TtsVoice"", ""TtsInstructions"", ""CaptureRoutes""::text, ""RendererRequirements""::text, ""DurationSeconds"", ""MusicStyle"", ""MusicVolume"", ""RequestedAtUtc"", ""CompletedAtUtc"", ""DownloadUrl"", ""LastError""
FROM public.""ProjectDemoRenderJobs""" + (string.IsNullOrWhiteSpace(language) ? "" : " WHERE \"Language\" = @language") + @"
ORDER BY ""RequestedAtUtc"" DESC
LIMIT 50;";
            await using var cmd = new NpgsqlCommand(sql, conn);
            if (!string.IsNullOrWhiteSpace(language)) cmd.Parameters.AddWithValue("language", language.Trim());

            await using var rdr = await cmd.ExecuteReaderAsync();
            while (await rdr.ReadAsync())
            {
                list.Add(new
                {
                    id = rdr.GetString(0),
                    projectId = rdr.IsDBNull(1) ? null : rdr.GetString(1),
                    name = rdr.GetString(2),
                    language = rdr.GetString(3),
                    status = rdr.GetString(4),
                    output = rdr.GetString(5),
                    frameRate = rdr.GetInt32(6),
                    resolution = rdr.GetString(7),
                    voiceOver = rdr.IsDBNull(8) ? "" : rdr.GetString(8),
                    appBaseUrl = rdr.IsDBNull(9) ? null : rdr.GetString(9),
                    voiceKey = rdr.IsDBNull(10) ? null : rdr.GetString(10),
                    voiceLabel = rdr.IsDBNull(11) ? null : rdr.GetString(11),
                    ttsVoice = rdr.IsDBNull(12) ? null : rdr.GetString(12),
                    ttsInstructions = rdr.IsDBNull(13) ? null : rdr.GetString(13),
                    captureRoutes = JsonElementFrom(rdr.GetString(14)),
                    rendererRequirements = JsonElementFrom(rdr.GetString(15)),
                    durationSeconds = rdr.GetInt32(16),
                    musicStyle = rdr.GetString(17),
                    musicVolume = rdr.GetDouble(18),
                    requestedAt = rdr.GetDateTime(19),
                    completedAt = rdr.IsDBNull(20) ? (DateTime?)null : rdr.GetDateTime(20),
                    downloadUrl = rdr.IsDBNull(21) ? null : rdr.GetString(21),
                    lastError = rdr.IsDBNull(22) ? null : rdr.GetString(22)
                });
            }

            return Ok(list);
        }

        [HttpGet("demo-renderer-info")]
        public IActionResult GetDemoRendererInfo() => Ok(new
        {
            version = DemoRendererVersion,
            build = DemoRendererBuild,
            backgroundJobs = true,
            shortVideoMode = "complete-story-all-modules",
            sceneSynchronizedSpeech = DemoRendererScriptIsCurrent(),
            rendererScriptFound = !string.IsNullOrWhiteSpace(ResolveDemoRendererScriptPath())
        });

        [HttpPost("demo-jobs")]
        public async Task<IActionResult> CreateDemoJob([FromBody] DemoRenderJobDto dto)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.Language)) return BadRequest(new { message = "Language is required." });
            var id = string.IsNullOrWhiteSpace(dto.Id) ? $"demo_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}" : dto.Id.Trim();

            await using var conn = new NpgsqlConnection(_connStr);
            await conn.OpenAsync();
            await EnsureSchemaAsync(conn);

            await using var cmd = new NpgsqlCommand(@"
INSERT INTO public.""ProjectDemoRenderJobs""
(""Id"", ""ProjectId"", ""Name"", ""Language"", ""Status"", ""OutputFileName"", ""FrameRate"", ""Resolution"", ""VoiceOver"", ""AppBaseUrl"", ""VoiceKey"", ""VoiceLabel"", ""TtsVoice"", ""TtsInstructions"", ""CaptureRoutes"", ""RendererRequirements"", ""DurationSeconds"", ""MusicStyle"", ""MusicVolume"", ""RequestedById"", ""RequestedAtUtc"")
VALUES (@id, @projectId, @name, @language, @status, @output, @frameRate, @resolution, @voiceOver, @appBaseUrl, @voiceKey, @voiceLabel, @ttsVoice, @ttsInstructions, @captureRoutes, @rendererRequirements, @durationSeconds, @musicStyle, @musicVolume, @requestedById, now())
ON CONFLICT (""Id"") DO UPDATE SET
    ""ProjectId"" = EXCLUDED.""ProjectId"",
    ""Name"" = EXCLUDED.""Name"",
    ""Language"" = EXCLUDED.""Language"",
    ""Status"" = EXCLUDED.""Status"",
    ""OutputFileName"" = EXCLUDED.""OutputFileName"",
    ""FrameRate"" = EXCLUDED.""FrameRate"",
    ""Resolution"" = EXCLUDED.""Resolution"",
    ""VoiceOver"" = EXCLUDED.""VoiceOver"",
    ""AppBaseUrl"" = EXCLUDED.""AppBaseUrl"",
    ""VoiceKey"" = EXCLUDED.""VoiceKey"",
    ""VoiceLabel"" = EXCLUDED.""VoiceLabel"",
    ""TtsVoice"" = EXCLUDED.""TtsVoice"",
    ""TtsInstructions"" = EXCLUDED.""TtsInstructions"",
    ""CaptureRoutes"" = EXCLUDED.""CaptureRoutes"",
    ""RendererRequirements"" = EXCLUDED.""RendererRequirements""
    , ""DurationSeconds"" = EXCLUDED.""DurationSeconds""
    , ""MusicStyle"" = EXCLUDED.""MusicStyle""
    , ""MusicVolume"" = EXCLUDED.""MusicVolume""
    , ""CompletedAtUtc"" = NULL
    , ""DownloadUrl"" = NULL
    , ""LastError"" = NULL
WHERE ""ProjectDemoRenderJobs"".""Status"" IN ('queued', 'failed')
RETURNING ""Id"";", conn);

            cmd.Parameters.AddWithValue("id", id);
            cmd.Parameters.AddWithValue("projectId", string.IsNullOrWhiteSpace(dto.ProjectId) ? (object)DBNull.Value : dto.ProjectId.Trim());
            cmd.Parameters.AddWithValue("name", string.IsNullOrWhiteSpace(dto.Name) ? "Mahima Application Demo Project" : dto.Name.Trim());
            cmd.Parameters.AddWithValue("language", dto.Language.Trim());
            cmd.Parameters.AddWithValue("status", "queued");
            cmd.Parameters.AddWithValue("output", string.IsNullOrWhiteSpace(dto.Output) ? $"mahima-app-demo-{dto.Language.Trim()}.mp4" : dto.Output.Trim());
            cmd.Parameters.AddWithValue("frameRate", dto.FrameRate <= 0 ? 30 : dto.FrameRate);
            cmd.Parameters.AddWithValue("resolution", string.IsNullOrWhiteSpace(dto.Resolution) ? "1920x1080" : dto.Resolution.Trim());
            cmd.Parameters.AddWithValue("voiceOver", string.IsNullOrWhiteSpace(dto.VoiceOver) ? (object)DBNull.Value : dto.VoiceOver.Trim());
            cmd.Parameters.AddWithValue("appBaseUrl", string.IsNullOrWhiteSpace(dto.AppBaseUrl) ? (object)DBNull.Value : dto.AppBaseUrl.Trim().TrimEnd('/'));
            cmd.Parameters.AddWithValue("voiceKey", string.IsNullOrWhiteSpace(dto.VoiceKey) ? (object)DBNull.Value : dto.VoiceKey.Trim());
            cmd.Parameters.AddWithValue("voiceLabel", string.IsNullOrWhiteSpace(dto.VoiceLabel) ? (object)DBNull.Value : dto.VoiceLabel.Trim());
            cmd.Parameters.AddWithValue("ttsVoice", string.IsNullOrWhiteSpace(dto.TtsVoice) ? (object)DBNull.Value : dto.TtsVoice.Trim());
            cmd.Parameters.AddWithValue("ttsInstructions", string.IsNullOrWhiteSpace(dto.TtsInstructions) ? (object)DBNull.Value : dto.TtsInstructions.Trim());
            cmd.Parameters.Add(new NpgsqlParameter("captureRoutes", NpgsqlDbType.Jsonb) { Value = ToJson(dto.CaptureRoutes) });
            cmd.Parameters.Add(new NpgsqlParameter("rendererRequirements", NpgsqlDbType.Jsonb) { Value = ToJson(dto.RendererRequirements) });
            cmd.Parameters.AddWithValue("durationSeconds", Math.Clamp(dto.DurationSeconds <= 0 ? 90 : dto.DurationSeconds, 30, 1800));
            cmd.Parameters.AddWithValue("musicStyle", NormalizeMusicStyle(dto.MusicStyle));
            cmd.Parameters.AddWithValue("musicVolume", Math.Clamp(dto.MusicVolume, 0d, 0.6d));
            var userId = GetCurrentUserId();
            cmd.Parameters.AddWithValue("requestedById", userId == Guid.Empty ? (object)DBNull.Value : userId);

            var savedId = Convert.ToString(await cmd.ExecuteScalarAsync());
            if (string.IsNullOrWhiteSpace(savedId)) return Conflict(new { message = "This render is already running or completed. Prepare a new job to use different settings." });
            return Ok(new { id = savedId, status = "queued" });
        }


        [HttpPost("demo-jobs/analyze-captures")]
        [Consumes("multipart/form-data")]
        [RequestSizeLimit(157286400)]
        public async Task<IActionResult> AnalyzeDemoCaptures([FromForm] string? language = "en", [FromForm] bool requireAi = true)
        {
            if (requireAi && string.IsNullOrWhiteSpace(OpenAiApiKey()))
            {
                return BadRequest(new { message = "OpenAI is not configured. Set ProjectDemo:OpenAiApiKey or OPENAI_API_KEY before using AI screenshot narration." });
            }

            var files = Request.Form.Files;
            if (files == null || files.Count == 0) return BadRequest(new { message = "Upload at least one screenshot." });

            var lang = NormalizeDemoLanguage(language);
            var captureSetId = $"captures_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var webRoot = _env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot");
            if (!Guid.TryParse(User.FindFirstValue("tenant_id"), out var storageTenantId)) return Forbid();
            var captureRoot = Path.Combine(webRoot, "demo-captures", storageTenantId.ToString("N"), captureSetId);
            Directory.CreateDirectory(captureRoot);

            var routes = new List<object>();
            for (var i = 0; i < files.Count; i += 1)
            {
                var file = files[i];
                if (file.Length <= 0) continue;

                var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
                if (extension is not ".png" and not ".jpg" and not ".jpeg" and not ".webp")
                {
                    return BadRequest(new { message = "Only PNG, JPG, JPEG, and WEBP screenshots are supported.", file = file.FileName });
                }

                var safeName = $"{(i + 1).ToString("00", CultureInfo.InvariantCulture)}-{SanitizeFileName(Path.GetFileNameWithoutExtension(file.FileName))}{extension}";
                var savedPath = Path.Combine(captureRoot, safeName);
                await using (var stream = System.IO.File.Create(savedPath))
                {
                    await file.CopyToAsync(stream);
                }

                var title = Path.GetFileNameWithoutExtension(file.FileName).Replace('_', ' ').Replace('-', ' ').Trim();
                if (string.IsNullOrWhiteSpace(title)) title = $"Uploaded screen {i + 1}";
                var narration = await GenerateCaptureNarrationAsync(savedPath, file.ContentType, lang, i + 1, title);

                routes.Add(new
                {
                    key = $"UPLOAD_{i + 1}",
                    title,
                    path = $"manual://capture/{i + 1}",
                    uploadedImagePath = savedPath,
                    screenshotName = safeName,
                    narration,
                    waitMs = 500,
                    durationSeconds = 7,
                    source = "uploaded"
                });
            }

            return Ok(new
            {
                captureSetId,
                language = lang,
                aiNarration = HasOpenAiKey(),
                routes
            });
        }


        [HttpPost("demo-jobs/{id}/render")]
        public async Task<IActionResult> RenderDemoJob(string id)
        {
            await using var conn = new NpgsqlConnection(_connStr);
            await conn.OpenAsync();
            await EnsureSchemaAsync(conn);

            var job = await LoadDemoJobPayloadAsync(conn, id);
            if (job == null) return NotFound(new { message = "Demo render job was not found." });
            if (!string.Equals(Convert.ToString(job["status"]), "queued", StringComparison.OrdinalIgnoreCase))
                return Conflict(new { message = "Only a newly queued job can be rendered. Prepare a new job and try again." });
            if (!DemoRendererScriptIsCurrent())
                return StatusCode(503, new { message = "The Demo Studio API and renderer script are different versions. Deploy the current renderer script before generating a video." });

            var token = ReadBearerToken();
            if (string.IsNullOrWhiteSpace(token)) return Unauthorized(new { message = "Render requires the current bearer token so Playwright can open protected pages." });

            var outputRoot = Path.Combine(ResolveDemoVideoRoot(), id);
            Directory.CreateDirectory(outputRoot);

            var scriptPath = ResolveDemoRendererScriptPath();
            if (string.IsNullOrWhiteSpace(scriptPath))
            {
                return StatusCode(500, new
                {
                    message = "Demo renderer script is missing.",
                    checkedPaths = GetDemoRendererScriptCandidates()
                });
            }

            var jobAppBaseUrl = Convert.ToString(job.GetValueOrDefault("appBaseUrl"));
            var appBaseUrl = string.IsNullOrWhiteSpace(jobAppBaseUrl) ? _config["ProjectDemo:AppBaseUrl"] : jobAppBaseUrl;
            if (string.IsNullOrWhiteSpace(appBaseUrl))
            {
                var request = HttpContext.Request;
                appBaseUrl = $"{request.Scheme}://{request.Host}";
            }

            var payload = new Dictionary<string, object?>
            {
                ["rendererBuild"] = DemoRendererBuild,
                ["job"] = job,
                ["appBaseUrl"] = appBaseUrl.TrimEnd('/'),
                ["authToken"] = token,
                ["outputRoot"] = outputRoot
            };

            var payloadPath = Path.Combine(outputRoot, "render-job.json");
            await System.IO.File.WriteAllTextAsync(payloadPath, JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false));

            await using (var claim = new NpgsqlCommand(@"UPDATE public.""ProjectDemoRenderJobs"" SET ""Status"" = 'rendering', ""CompletedAtUtc"" = NULL, ""DownloadUrl"" = NULL, ""LastError"" = NULL WHERE ""Id"" = @id AND ""Status"" = 'queued'", conn))
            {
                claim.Parameters.AddWithValue("id", id);
                if (await claim.ExecuteNonQueryAsync() != 1) return Conflict(new { message = "This render has already started." });
            }
            var outputFileName = Convert.ToString(job["output"]) ?? $"mahima-app-demo-{job["language"]}.mp4";
            var outputPath = Path.Combine(outputRoot, outputFileName);
            var downloadUrl = $"/api/projectmanagement/demo-jobs/{Uri.EscapeDataString(id)}/download";
            _ = Task.Run(async () =>
            {
                try
                {
                    var result = await RunRendererAsync(scriptPath, payloadPath, outputRoot);
                    await using var backgroundConn = new NpgsqlConnection(_connStr);
                    await backgroundConn.OpenAsync();
                    if (result.ExitCode != 0)
                    {
                        var renderError = string.IsNullOrWhiteSpace(result.Output)
                            ? $"The renderer process exited with code {result.ExitCode} without diagnostic output."
                            : result.Output.Trim();
                        await UpdateDemoJobStatusAsync(backgroundConn, id, "failed", null, null, renderError);
                        _logger.LogError("Demo MP4 render {JobId} failed with exit code {ExitCode}: {RenderError}", id, result.ExitCode, renderError);
                        return;
                    }
                    if (!System.IO.File.Exists(outputPath))
                    {
                        await UpdateDemoJobStatusAsync(backgroundConn, id, "failed", null, null, "Renderer finished but MP4 output was not found.");
                        return;
                    }
                    await UpdateDemoJobStatusAsync(backgroundConn, id, "completed", downloadUrl, DateTime.UtcNow, null);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Background demo MP4 render {JobId} crashed.", id);
                    try
                    {
                        await using var failureConn = new NpgsqlConnection(_connStr);
                        await failureConn.OpenAsync();
                        await UpdateDemoJobStatusAsync(failureConn, id, "failed", null, null, ex.Message);
                    }
                    catch (Exception statusEx) { _logger.LogError(statusEx, "Could not persist failed demo render status for {JobId}.", id); }
                }
            });

            return Accepted(new { id, status = "rendering", durationSeconds = job["durationSeconds"], rendererVersion = DemoRendererVersion, rendererBuild = DemoRendererBuild, message = "MP4 rendering started. Demo Studio will update automatically.", outputFileName });
        }



        [HttpGet("demo-jobs/{id}/download")]
        [AllowAnonymous]
        public async Task<IActionResult> DownloadDemoJobMp4(string id)
        {
            await using var conn = new NpgsqlConnection(_connStr);
            await conn.OpenAsync();
            await EnsureSchemaAsync(conn);

            await using var cmd = new NpgsqlCommand(@"
SELECT ""OutputFileName"", ""DownloadUrl"", ""Status"", ""LastError""
FROM public.""ProjectDemoRenderJobs""
WHERE ""Id"" = @id;", conn);
            cmd.Parameters.AddWithValue("id", id);

            string? outputFileName = null;
            string? downloadUrl = null;
            string? status = null;
            string? lastError = null;
            await using (var rdr = await cmd.ExecuteReaderAsync())
            {
                if (!await rdr.ReadAsync()) return NotFound(new { message = "Demo render job was not found. Refresh Demo Studio and prepare a new job." });
                outputFileName = rdr.IsDBNull(0) ? null : rdr.GetString(0);
                downloadUrl = rdr.IsDBNull(1) ? null : rdr.GetString(1);
                status = rdr.IsDBNull(2) ? null : rdr.GetString(2);
                lastError = rdr.IsDBNull(3) ? null : rdr.GetString(3);
            }

            if (!string.Equals(status, "completed", StringComparison.OrdinalIgnoreCase))
            {
                return Conflict(new
                {
                    message = string.Equals(status, "failed", StringComparison.OrdinalIgnoreCase)
                        ? "This MP4 render failed. Review the render error, correct the server dependency or AI configuration, and generate it again."
                        : $"This MP4 is not ready for download. Current status: {status ?? "unknown"}.",
                    status,
                    lastError
                });
            }

            if (string.IsNullOrWhiteSpace(outputFileName) && !string.IsNullOrWhiteSpace(downloadUrl))
            {
                outputFileName = Path.GetFileName(downloadUrl);
            }

            if (string.IsNullOrWhiteSpace(outputFileName)) outputFileName = $"mahima-app-demo-{id}.mp4";

            var path = Path.Combine(ResolveDemoVideoRoot(), id, outputFileName);
            if (!System.IO.File.Exists(path))
            {
                var legacyWebRoot = _env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot");
                var legacyPath = Path.Combine(legacyWebRoot, "demo-videos", id, outputFileName);
                if (System.IO.File.Exists(legacyPath)) path = legacyPath;
                else return NotFound(new
                {
                    message = "The render record is complete, but its MP4 file is missing. It may have been removed during deployment; generate this MP4 again.",
                    status,
                    expectedFileName = outputFileName
                });
            }

            return PhysicalFile(path, "video/mp4", outputFileName, enableRangeProcessing: true);
        }

        private string ResolveDemoVideoRoot()
        {
            var configured = _config["ProjectDemo:OutputRoot"];
            if (!string.IsNullOrWhiteSpace(configured)) return Path.GetFullPath(configured.Trim());
            if (OperatingSystem.IsLinux()) return "/var/lib/mahima/demo-videos";
            var webRoot = _env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot");
            return Path.Combine(webRoot, "demo-videos");
        }

        private async Task<string> GenerateCaptureNarrationAsync(string imagePath, string? contentType, string language, int index, string title)
        {
            var fallback = FallbackCaptureNarration(language, index, title);
            var apiKey = OpenAiApiKey();
            if (string.IsNullOrWhiteSpace(apiKey))
            {
                _logger.LogInformation("Demo Studio OpenAI screenshot narration skipped: no API key configured.");
                return fallback;
            }

            try
            {
                var baseUrl = (_config["ProjectDemo:OpenAiBaseUrl"] ?? _config["PastorBot:BaseUrl"] ?? "https://api.openai.com/v1").TrimEnd('/');
                var model = _config["ProjectDemo:VisionModel"] ?? _config["PastorBot:VisionModel"] ?? _config["PastorBot:Model"] ?? "gpt-4o-mini";
                var mediaType = string.IsNullOrWhiteSpace(contentType) ? ContentTypeFromPath(imagePath) : contentType;
                var bytes = await System.IO.File.ReadAllBytesAsync(imagePath);
                var dataUrl = $"data:{mediaType};base64,{Convert.ToBase64String(bytes)}";
                var langInstruction = language switch
                {
                    "hi" => "Write in simple spoken Hindi using natural ministry/product-demo language.",
                    "pa" => "Write in simple spoken Punjabi using natural ministry/product-demo language.",
                    _ => "Write in natural spoken English for a ministry application product demo."
                };

                var payload = new
                {
                    model,
                    temperature = 0.35,
                    max_tokens = 120,
                    messages = new object[]
                    {
                        new { role = "system", content = "You generate concise voice-over narration for Mahima Ministry application demo screenshots. Do not mention that you are looking at an image. Focus on what the screen helps a church leader do." },
                        new
                        {
                            role = "user",
                            content = new object[]
                            {
                                new { type = "text", text = $"Screen {index}: {title}. {langInstruction} Return one clear sentence, maximum 32 words." },
                                new { type = "image_url", image_url = new { url = dataUrl } }
                            }
                        }
                    }
                };

                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(45) };
                client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
                using var request = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
                _logger.LogInformation("Demo Studio invoking OpenAI vision narration. Model={Model}, BaseUrl={BaseUrl}, Screen={Screen}", model, baseUrl, index);
                using var response = await client.PostAsync($"{baseUrl}/chat/completions", request);
                var responseText = await response.Content.ReadAsStringAsync();
                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning("OpenAI screenshot narration failed: {Status} {Body}", response.StatusCode, responseText);
                    return fallback;
                }

                using var doc = JsonDocument.Parse(responseText);
                var content = doc.RootElement.GetProperty("choices")[0].GetProperty("message").GetProperty("content").GetString();
                return string.IsNullOrWhiteSpace(content) ? fallback : content.Trim().Trim('"');
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "OpenAI screenshot narration failed for {ImagePath}", imagePath);
                return fallback;
            }
        }

        private string? OpenAiApiKey()
        {
            var candidates = new[]
            {
                _config["ProjectDemo:OpenAiApiKey"],
                _config["PastorBot:OpenAiApiKey"],
                _config["PastorBot:ApiKey"],
                Environment.GetEnvironmentVariable("OPENAI_API_KEY")
            };

            return candidates
                .Select(value => string.IsNullOrWhiteSpace(value) ? null : value.Trim())
                .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value));
        }

        private bool HasOpenAiKey() => !string.IsNullOrWhiteSpace(OpenAiApiKey());

        private static string NormalizeDemoLanguage(string? language)
        {
            var value = (language ?? "en").Trim().ToLowerInvariant();
            return value is "hi" or "pa" ? value : "en";
        }

        private static string NormalizeMusicStyle(string? style)
        {
            var value = (style ?? "uplifting").Trim().ToLowerInvariant();
            return value is "uplifting" or "peaceful" or "corporate" or "none" ? value : "uplifting";
        }

        private static string FallbackCaptureNarration(string language, int index, string title) => language switch
        {
            "hi" => $"Screen {index} mein {title} dikhaya gaya hai, jisse ministry team apna kaam clearly track aur manage kar sakti hai.",
            "pa" => $"Screen {index} vich {title} dikhaya gaya hai, jis naal ministry team apna kaam clearly track ate manage kar sakdi hai.",
            _ => $"Screen {index} shows {title}, helping the ministry team understand, track, and manage this workflow clearly."
        };

        private static string ContentTypeFromPath(string path)
        {
            return Path.GetExtension(path).ToLowerInvariant() switch
            {
                ".jpg" or ".jpeg" => "image/jpeg",
                ".webp" => "image/webp",
                _ => "image/png"
            };
        }

        private static string SanitizeFileName(string value)
        {
            var cleaned = new string((value ?? "capture").Select(ch => char.IsLetterOrDigit(ch) ? ch : '-').ToArray()).Trim('-');
            return string.IsNullOrWhiteSpace(cleaned) ? "capture" : cleaned[..Math.Min(cleaned.Length, 60)];
        }

        private bool DemoRendererScriptIsCurrent()
        {
            var script = ResolveDemoRendererScriptPath();
            return script != null
                && System.IO.File.Exists(Path.Combine(Path.GetDirectoryName(script)!, "story.js"))
                && System.IO.File.ReadAllText(script).Contains($"const DEMO_RENDERER_BUILD = \"{DemoRendererBuild}\";", StringComparison.Ordinal);
        }

        private string? ResolveDemoRendererScriptPath()
        {
            foreach (var candidate in GetDemoRendererScriptCandidates())
            {
                if (System.IO.File.Exists(candidate)) return candidate;
            }

            return null;
        }

        private string[] GetDemoRendererScriptCandidates()
        {
            var configuredPath = _config["ProjectDemo:RendererScriptPath"];
            var candidates = new List<string?>
            {
                configuredPath,
                Path.Combine(_env.ContentRootPath, "Scripts", "DemoRenderer", "render-demo.js"),
                Path.Combine(AppContext.BaseDirectory, "Scripts", "DemoRenderer", "render-demo.js"),
                Path.Combine(Directory.GetCurrentDirectory(), "Scripts", "DemoRenderer", "render-demo.js"),
                "/opt/mahima-api/Scripts/DemoRenderer/render-demo.js",
                "/root/Mahima_App_V4.1/backend/Mahima.Api.v3.clean/Scripts/DemoRenderer/render-demo.js"
            };

            return candidates
                .Where(path => !string.IsNullOrWhiteSpace(path))
                .Select(path => Path.GetFullPath(path!))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
        private async Task<Dictionary<string, object?>?> LoadDemoJobPayloadAsync(NpgsqlConnection conn, string id)
        {
            await using var cmd = new NpgsqlCommand(@"
SELECT ""Id"", ""ProjectId"", ""Name"", ""Language"", ""Status"", ""OutputFileName"", ""FrameRate"", ""Resolution"", ""VoiceOver"", ""AppBaseUrl"", ""VoiceKey"", ""VoiceLabel"", ""TtsVoice"", ""TtsInstructions"", ""CaptureRoutes""::text, ""RendererRequirements""::text, ""DurationSeconds"", ""MusicStyle"", ""MusicVolume""
FROM public.""ProjectDemoRenderJobs""
WHERE ""Id"" = @id;", conn);
            cmd.Parameters.AddWithValue("id", id);

            await using var rdr = await cmd.ExecuteReaderAsync();
            if (!await rdr.ReadAsync()) return null;

            return new Dictionary<string, object?>
            {
                ["id"] = rdr.GetString(0),
                ["projectId"] = rdr.IsDBNull(1) ? null : rdr.GetString(1),
                ["name"] = rdr.GetString(2),
                ["language"] = rdr.GetString(3),
                ["status"] = rdr.GetString(4),
                ["output"] = rdr.GetString(5),
                ["frameRate"] = rdr.GetInt32(6),
                ["resolution"] = rdr.GetString(7),
                ["voiceOver"] = rdr.IsDBNull(8) ? "" : rdr.GetString(8),
                ["appBaseUrl"] = rdr.IsDBNull(9) ? null : rdr.GetString(9),
                ["voiceKey"] = rdr.IsDBNull(10) ? null : rdr.GetString(10),
                ["voiceLabel"] = rdr.IsDBNull(11) ? null : rdr.GetString(11),
                ["ttsVoice"] = rdr.IsDBNull(12) ? null : rdr.GetString(12),
                ["ttsInstructions"] = rdr.IsDBNull(13) ? null : rdr.GetString(13),
                ["requireOpenAiSpeech"] = true,
                ["captureRoutes"] = JsonElementFrom(rdr.GetString(14)),
                ["rendererRequirements"] = JsonElementFrom(rdr.GetString(15)),
                ["durationSeconds"] = rdr.GetInt32(16),
                ["musicStyle"] = rdr.GetString(17),
                ["musicVolume"] = rdr.GetDouble(18)
            };
        }

        private async Task UpdateDemoJobStatusAsync(NpgsqlConnection conn, string id, string status, string? downloadUrl, DateTime? completedAtUtc, string? error)
        {
            await using var cmd = new NpgsqlCommand(@"
UPDATE public.""ProjectDemoRenderJobs""
SET ""Status"" = @status,
    ""DownloadUrl"" = COALESCE(@downloadUrl, ""DownloadUrl""),
    ""CompletedAtUtc"" = COALESCE(@completedAtUtc, ""CompletedAtUtc""),
    ""LastError"" = @error
WHERE ""Id"" = @id;", conn);
            cmd.Parameters.AddWithValue("id", id);
            cmd.Parameters.AddWithValue("status", status);
            cmd.Parameters.AddWithValue("downloadUrl", string.IsNullOrWhiteSpace(downloadUrl) ? (object)DBNull.Value : downloadUrl);
            cmd.Parameters.AddWithValue("completedAtUtc", completedAtUtc.HasValue ? completedAtUtc.Value : (object)DBNull.Value);
            cmd.Parameters.AddWithValue("error", string.IsNullOrWhiteSpace(error) ? (object)DBNull.Value : error);
            await cmd.ExecuteNonQueryAsync();
        }

        private async Task<(int ExitCode, string Output)> RunRendererAsync(string scriptPath, string payloadPath, string outputRoot)
        {
            var nodePath = _config["ProjectDemo:NodePath"] ?? "node";
            var timeoutMinutes = int.TryParse(_config["ProjectDemo:RenderTimeoutMinutes"], out var configuredTimeout) ? configuredTimeout : 20;
            var psi = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = $"\"{scriptPath}\" \"{payloadPath}\"",
                WorkingDirectory = outputRoot,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            };

            psi.Environment["DEMO_RENDER_OUTPUT_ROOT"] = outputRoot;
            if (!string.IsNullOrWhiteSpace(_config["ProjectDemo:FfmpegPath"])) psi.Environment["FFMPEG_PATH"] = _config["ProjectDemo:FfmpegPath"];
            if (!string.IsNullOrWhiteSpace(_config["ProjectDemo:FfprobePath"])) psi.Environment["FFPROBE_PATH"] = _config["ProjectDemo:FfprobePath"];
            if (!string.IsNullOrWhiteSpace(_config["ProjectDemo:TtsCommand"])) psi.Environment["DEMO_TTS_COMMAND"] = _config["ProjectDemo:TtsCommand"];
            if (!string.IsNullOrWhiteSpace(_config["ProjectDemo:ChromiumExecutablePath"])) psi.Environment["PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH"] = _config["ProjectDemo:ChromiumExecutablePath"];
            if (!string.IsNullOrWhiteSpace(_config["ProjectDemo:PlaywrightBrowsersPath"])) psi.Environment["PLAYWRIGHT_BROWSERS_PATH"] = _config["ProjectDemo:PlaywrightBrowsersPath"];
            var openAiKey = OpenAiApiKey();
            if (!string.IsNullOrWhiteSpace(openAiKey))
            {
                psi.Environment["OPENAI_API_KEY"] = openAiKey;
                _logger.LogInformation("Demo Studio renderer OpenAI speech enabled.");
            }
            else
            {
                _logger.LogInformation("Demo Studio renderer OpenAI speech disabled: no API key configured.");
            }
            if (!string.IsNullOrWhiteSpace(_config["ProjectDemo:OpenAiBaseUrl"])) psi.Environment["OPENAI_BASE_URL"] = _config["ProjectDemo:OpenAiBaseUrl"];
            else if (!string.IsNullOrWhiteSpace(_config["PastorBot:BaseUrl"])) psi.Environment["OPENAI_BASE_URL"] = _config["PastorBot:BaseUrl"];
            psi.Environment["OPENAI_TTS_MODEL"] = _config["ProjectDemo:TtsModel"] ?? "gpt-4o-mini-tts";
            psi.Environment["OPENAI_VISION_MODEL"] = _config["ProjectDemo:VisionModel"] ?? _config["PastorBot:VisionModel"] ?? "gpt-4o-mini";
            if (!string.IsNullOrWhiteSpace(_config["ProjectDemo:TtsInstructions"])) psi.Environment["OPENAI_TTS_INSTRUCTIONS"] = _config["ProjectDemo:TtsInstructions"];
            if (!string.IsNullOrWhiteSpace(_config["ProjectDemo:BackgroundMusicPath"])) psi.Environment["DEMO_BACKGROUND_MUSIC_PATH"] = _config["ProjectDemo:BackgroundMusicPath"];
            if (!string.IsNullOrWhiteSpace(_config["ProjectDemo:BackgroundMusicVolume"])) psi.Environment["DEMO_BACKGROUND_MUSIC_VOLUME"] = _config["ProjectDemo:BackgroundMusicVolume"];

            using var process = new Process { StartInfo = psi };
            var output = new StringBuilder();
            process.OutputDataReceived += (_, e) => { if (e.Data != null) output.AppendLine(e.Data); };
            process.ErrorDataReceived += (_, e) => { if (e.Data != null) output.AppendLine(e.Data); };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            try
            {
                await process.WaitForExitAsync().WaitAsync(TimeSpan.FromMinutes(Math.Max(1, timeoutMinutes)));
                return (process.ExitCode, output.ToString());
            }
            catch (TimeoutException)
            {
                try { if (!process.HasExited) process.Kill(entireProcessTree: true); } catch { }
                return (-1, $"Demo rendering exceeded the {timeoutMinutes}-minute server limit and was stopped. Try a shorter duration or fewer capture routes.\n{output}");
            }
        }

        private string? ReadBearerToken()
        {
            var header = Convert.ToString(Request.Headers.Authorization);
            if (string.IsNullOrWhiteSpace(header)) return null;
            return header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header.Substring("Bearer ".Length).Trim() : header.Trim();
        }
        private void AddProjectParameters(NpgsqlCommand cmd, string id, ProjectDto dto)
        {
            cmd.Parameters.AddWithValue("id", id);
            cmd.Parameters.AddWithValue("name", dto.Name.Trim());
            cmd.Parameters.AddWithValue("templateKey", string.IsNullOrWhiteSpace(dto.TemplateKey) ? "construction" : dto.TemplateKey.Trim());
            cmd.Parameters.AddWithValue("type", string.IsNullOrWhiteSpace(dto.Type) ? "Church Construction" : dto.Type.Trim());
            cmd.Parameters.AddWithValue("sponsor", string.IsNullOrWhiteSpace(dto.Sponsor) ? (object)DBNull.Value : dto.Sponsor.Trim());
            cmd.Parameters.AddWithValue("manager", string.IsNullOrWhiteSpace(dto.Manager) ? (object)DBNull.Value : dto.Manager.Trim());
            cmd.Parameters.AddWithValue("status", string.IsNullOrWhiteSpace(dto.Status) ? "Active" : dto.Status.Trim());
            cmd.Parameters.AddWithValue("health", string.IsNullOrWhiteSpace(dto.Health) ? "Green" : dto.Health.Trim());
            cmd.Parameters.AddWithValue("priority", string.IsNullOrWhiteSpace(dto.Priority) ? (object)DBNull.Value : dto.Priority.Trim());
            cmd.Parameters.AddWithValue("budget", dto.Budget);
            cmd.Parameters.AddWithValue("spent", dto.Spent);
            cmd.Parameters.AddWithValue("progress", Math.Clamp(dto.Progress, 0, 100));
            cmd.Parameters.AddWithValue("startDate", ParseDate(dto.StartDate));
            cmd.Parameters.AddWithValue("targetDate", ParseDate(dto.TargetDate));
            cmd.Parameters.Add(new NpgsqlParameter("phases", NpgsqlDbType.Jsonb) { Value = ToJson(dto.Phases) });
            cmd.Parameters.Add(new NpgsqlParameter("workstreams", NpgsqlDbType.Jsonb) { Value = ToJson(dto.Workstreams) });
            cmd.Parameters.Add(new NpgsqlParameter("risks", NpgsqlDbType.Jsonb) { Value = ToJson(dto.Risks) });
            cmd.Parameters.Add(new NpgsqlParameter("decisions", NpgsqlDbType.Jsonb) { Value = ToJson(dto.Decisions) });
            var userId = GetCurrentUserId();
            cmd.Parameters.AddWithValue("createdById", userId == Guid.Empty ? (object)DBNull.Value : userId);
        }

        private static object ParseDate(string? value)
        {
            if (DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var parsed)) return parsed.Date;
            return DBNull.Value;
        }

        private static string ToJson(JsonElement? value)
        {
            if (!value.HasValue || value.Value.ValueKind == JsonValueKind.Undefined || value.Value.ValueKind == JsonValueKind.Null) return "[]";
            return value.Value.GetRawText();
        }

        private static JsonElement JsonElementFrom(string json)
        {
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) ? "[]" : json);
            return doc.RootElement.Clone();
        }

        private Guid GetCurrentUserId() =>
            Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"), out var id) ? id : Guid.Empty;

        public class ProjectDto
        {
            public string? Id { get; set; }
            public string? Name { get; set; }
            public string? TemplateKey { get; set; }
            public string? Type { get; set; }
            public string? Sponsor { get; set; }
            public string? Manager { get; set; }
            public string? Status { get; set; }
            public string? Health { get; set; }
            public string? Priority { get; set; }
            public decimal Budget { get; set; }
            public decimal Spent { get; set; }
            public int Progress { get; set; }
            public string? StartDate { get; set; }
            public string? TargetDate { get; set; }
            public JsonElement? Phases { get; set; }
            public JsonElement? Workstreams { get; set; }
            public JsonElement? Risks { get; set; }
            public JsonElement? Decisions { get; set; }
        }

        public class DemoRenderJobDto
        {
            public string? Id { get; set; }
            public string? ProjectId { get; set; }
            public string? Name { get; set; }
            public string? Language { get; set; }
            public string? Status { get; set; }
            public string? Output { get; set; }
            public int FrameRate { get; set; }
            public string? Resolution { get; set; }
            public string? VoiceOver { get; set; }
            public string? AppBaseUrl { get; set; }
            public string? VoiceKey { get; set; }
            public string? VoiceLabel { get; set; }
            public string? TtsVoice { get; set; }
            public string? TtsInstructions { get; set; }
            public int DurationSeconds { get; set; } = 90;
            public string? MusicStyle { get; set; }
            public double MusicVolume { get; set; } = 0.35;
            public JsonElement? CaptureRoutes { get; set; }
            public JsonElement? RendererRequirements { get; set; }
        }
    }
}











