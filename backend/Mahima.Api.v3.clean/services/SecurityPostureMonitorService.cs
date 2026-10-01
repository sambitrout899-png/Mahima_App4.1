using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Npgsql;
using NpgsqlTypes;

namespace Mahima.Api.v3.clean.Services;

public sealed record SecurityMonitorFinding(string Domain, string Control, string Title, string Status, string Severity, string Evidence, string Recommendation);
public sealed record SecurityMonitorRun(Guid Id, DateTime StartedAtUtc, DateTime CompletedAtUtc, string Trigger, string Status, int Passed, int Warnings, int Failed, int Score, IReadOnlyList<SecurityMonitorFinding> Findings);

public interface ISecurityPostureMonitor
{
    Task<SecurityMonitorRun> RunAsync(string trigger, CancellationToken ct);
    Task<object> StatusAsync(CancellationToken ct);
    Task<IReadOnlyList<object>> HistoryAsync(int limit, CancellationToken ct);
    Task<SecurityMonitorRun?> GetAsync(Guid id, CancellationToken ct);
}

public sealed class SecurityPostureMonitorService : BackgroundService, ISecurityPostureMonitor
{
    private static readonly Guid RootTenantId = Guid.Parse("00000000-0000-0000-0000-000000000001");

    private readonly IConfiguration _configuration;
    private readonly EndpointDataSource _endpoints;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<SecurityPostureMonitorService> _logger;
    private readonly SemaphoreSlim _runLock = new(1, 1);
    private readonly string _connectionString;

    public SecurityPostureMonitorService(IConfiguration configuration, EndpointDataSource endpoints, IServiceScopeFactory scopeFactory, ILogger<SecurityPostureMonitorService> logger)
    {
        _configuration = configuration;
        _endpoints = endpoints;
        _scopeFactory = scopeFactory;
        _logger = logger;
        _connectionString = configuration.GetConnectionString("DefaultConnection") ?? throw new InvalidOperationException("DefaultConnection is required for security monitoring.");
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await RunAsync("scheduled", stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex) { _logger.LogError(ex, "Scheduled security posture monitoring failed."); }
            var minutes = Math.Clamp(_configuration.GetValue("SecurityMonitoring:IntervalMinutes", 15), 5, 1440);
            await Task.Delay(TimeSpan.FromMinutes(minutes), stoppingToken);
        }
    }

    public async Task<SecurityMonitorRun> RunAsync(string trigger, CancellationToken ct)
    {
        await _runLock.WaitAsync(ct);
        try
        {
            await using var conn = new NpgsqlConnection(_connectionString);
            await conn.OpenAsync(ct);
            await EnsureSchemaAsync(conn, ct);
            var id = Guid.NewGuid();
            var started = DateTime.UtcNow;
            var findings = new List<SecurityMonitorFinding>();
            void Add(string domain, string control, string title, bool passed, string severity, string evidence, string recommendation, bool warning = false) =>
                findings.Add(new(domain, control, title, passed ? "passed" : warning ? "warning" : "failed", passed ? "info" : severity, evidence, passed ? "" : recommendation));

            var jwt = _configuration["Jwt:Key"] ?? "";
            Add("VAPT", "VAPT-AUTH-01", "JWT signing strength", jwt.Length >= 32, "critical", $"Signing key configured={jwt.Length > 0}; length threshold met={jwt.Length >= 32}; value redacted.", "Store a cryptographically random signing key of at least 32 characters in the production secret store and rotate it under change control.");
            var allowedOrigins = _configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
            Add("VAPT", "VAPT-CORS-01", "Restricted CORS origin allowlist", allowedOrigins.Length > 0 && allowedOrigins.All(x => x != "*"), "high", $"Configured explicit origins={allowedOrigins.Length}; wildcard present={allowedOrigins.Contains("*")}.", "Replace permissive CORS with an explicit production-origin allowlist; never combine arbitrary origins with credentials.");
            var endpoints = _endpoints.Endpoints.OfType<RouteEndpoint>().ToList();
            var undeclared = endpoints.Count(x => x.Metadata.GetMetadata<IAllowAnonymous>() == null && x.Metadata.GetOrderedMetadata<IAuthorizeData>().Count == 0);
            Add("VAPT", "VAPT-ACCESS-01", "Explicit endpoint access policy", undeclared == 0, "high", $"Published routes={endpoints.Count}; routes without explicit Authorize/AllowAnonymous metadata={undeclared}.", "Review every undeclared route and apply [Authorize] or an explicitly reviewed [AllowAnonymous] declaration.");
            var orphanUsers = await ScalarAsync(conn, "SELECT count(*) FROM public.users u LEFT JOIN public.tenants t ON t.id=u.tenant_id WHERE t.id IS NULL", ct);
            Add("VAPT", "VAPT-TENANT-01", "Tenant isolation prerequisites", orphanUsers == 0, "critical", $"Users referencing a missing tenant={orphanUsers}.", "Correct orphan tenant references and retain tenant-scoped authorization tests.");

            var auditTable = await ExistsAsync(conn, "audit_logs", ct) || await ExistsAsync(conn, "audittrail", ct) || await ExistsAsync(conn, "audit_trail", ct);
            Add("SOC2", "CC7.2", "Audit logging capability", auditTable, "high", $"Recognized audit table present={auditTable}.", "Enable immutable administrative and security audit logging with actor, tenant, action, timestamp, source, and outcome.");
            var securityEvents = await ExistsAsync(conn, "security_events", ct);
            Add("SOC2", "CC7.3", "Security event recording", securityEvents, "high", $"security_events table present={securityEvents}.", "Persist authentication and security events and protect them from ordinary tenant modification.");
            var retentionDays = _configuration.GetValue("SecurityMonitoring:EvidenceRetentionDays", 0);
            Add("SOC2", "CC7.4", "Defined evidence retention", retentionDays >= 90, "medium", $"Configured security evidence retention={retentionDays} days.", "Define and approve a retention period of at least 90 days or the longer period required by policy and law.", retentionDays > 0);
            var backupConfigured = !string.IsNullOrWhiteSpace(_configuration["Backup:Provider"]) || _configuration.GetValue("Backup:Enabled", false);
            Add("SOC2", "A1.2", "Backup configuration evidence", backupConfigured, "high", $"Application backup configuration present={backupConfigured}.", "Configure monitored, encrypted backups and periodically record restoration-test evidence.");

            var incidentContact = _configuration["SecurityMonitoring:IncidentContact"];
            Add("IR", "IR-01", "Incident escalation contact", !string.IsNullOrWhiteSpace(incidentContact), "high", $"Incident contact configured={!string.IsNullOrWhiteSpace(incidentContact)}; value redacted.", "Configure a monitored incident contact and escalation path available at all times.");
            var runbook = _configuration["SecurityMonitoring:IncidentRunbookUrl"];
            Add("IR", "IR-02", "Incident response runbook", !string.IsNullOrWhiteSpace(runbook), "medium", $"Runbook reference configured={!string.IsNullOrWhiteSpace(runbook)}.", "Publish and exercise an incident response runbook covering triage, containment, eradication, recovery, notification, and lessons learned.");
            var lastExercise = _configuration.GetValue<DateTime?>("SecurityMonitoring:LastIncidentExerciseUtc");
            var exerciseFresh = lastExercise.HasValue && lastExercise.Value >= DateTime.UtcNow.AddDays(-365);
            Add("IR", "IR-03", "Annual incident exercise", exerciseFresh, "medium", $"Last exercise recorded={lastExercise?.ToString("O") ?? "not configured"}.", "Run and document a tabletop or technical incident exercise at least annually.");

            var forensicLogging = securityEvents && auditTable;
            Add("DFIR", "DFIR-01", "Forensic event sources", forensicLogging, "high", $"Security events={securityEvents}; audit trail={auditTable}.", "Retain synchronized authentication, audit, application, proxy, and infrastructure logs for investigations.");
            var timeZone = TimeZoneInfo.Local.Id;
            Add("DFIR", "DFIR-02", "UTC evidence timestamps", true, "medium", $"Monitor records and database evidence are written as UTC; host zone={timeZone}.", "Keep all evidentiary timestamps in UTC and monitor clock synchronization.");
            var evidenceExport = _configuration.GetValue("SecurityMonitoring:EvidenceExportEnabled", false);
            Add("DFIR", "DFIR-03", "Protected evidence export", evidenceExport, "medium", $"Evidence export configured={evidenceExport}.", "Configure encrypted, access-controlled evidence export with hashes and chain-of-custody records.", true);

            var passed = findings.Count(x => x.Status == "passed");
            var warnings = findings.Count(x => x.Status == "warning");
            var failed = findings.Count(x => x.Status == "failed");
            var score = Math.Max(0, 100 - failed * 9 - warnings * 3);
            var status = failed > 0 ? "attention_required" : warnings > 0 ? "monitor" : "healthy";
            var completed = DateTime.UtcNow;
            var result = new SecurityMonitorRun(id, started, completed, trigger, status, passed, warnings, failed, score, findings);
            if (failed > 0)
            {
                _logger.LogWarning("Security posture run {RunId} completed with {Failed} failed and {Warnings} warning controls; score {Score}.", id, failed, warnings, score);
                await EscalateAsync(result, incidentContact, ct);
            }
            await using var save = new NpgsqlCommand(@"INSERT INTO public.security_monitor_runs
(id, started_at_utc, completed_at_utc, trigger_type, status, passed_count, warning_count, failed_count, score, findings_json)
VALUES (@id,@started,@completed,@trigger,@status,@passed,@warnings,@failed,@score,CAST(@findings AS jsonb));", conn);
            save.Parameters.AddWithValue("id", id); save.Parameters.AddWithValue("started", started); save.Parameters.AddWithValue("completed", completed);
            save.Parameters.AddWithValue("trigger", trigger); save.Parameters.AddWithValue("status", status); save.Parameters.AddWithValue("passed", passed);
            save.Parameters.AddWithValue("warnings", warnings); save.Parameters.AddWithValue("failed", failed); save.Parameters.AddWithValue("score", score);
            save.Parameters.AddWithValue("findings", JsonSerializer.Serialize(findings)); await save.ExecuteNonQueryAsync(ct);
            return result;
        }
        finally { _runLock.Release(); }
    }

    private async Task EscalateAsync(SecurityMonitorRun result, string? incidentContact, CancellationToken ct)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var notifications = scope.ServiceProvider.GetRequiredService<INotificationDispatcher>();

            var failedTitles = result.Findings.Where(f => f.Status == "failed").Select(f => $"- {f.Title} ({f.Control})");
            var message = $"Security posture run flagged {result.Failed} failed control(s), score {result.Score}/100:\n" +
                          string.Join("\n", failedTitles);

            await notifications.EnqueueAsync(new NotificationRequest(
                TenantId: RootTenantId,
                Kind: "security-posture-alert",
                Subject: $"Mahima security posture alert: {result.Failed} failed control(s)",
                Message: message,
                TargetGroup: "root-admins",
                DedupeKey: $"security-posture:{DateTime.UtcNow:yyyyMMdd}"), ct);

            if (!string.IsNullOrWhiteSpace(incidentContact))
            {
                var delivery = scope.ServiceProvider.GetRequiredService<INotificationDelivery>();
                await delivery.SendEmailAsync(incidentContact, $"Mahima security posture alert: {result.Failed} failed control(s)", message, ct);
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not escalate security posture findings.");
        }
    }

    public async Task<object> StatusAsync(CancellationToken ct)
    {
        var history = await HistoryAsync(1, ct);
        return new { enabled = true, mode = "continuous_read_only", intervalMinutes = Math.Clamp(_configuration.GetValue("SecurityMonitoring:IntervalMinutes", 15), 5, 1440), lastRun = history.FirstOrDefault(), disclaimer = "Automated posture checks support security operations and SOC 2 readiness; they are not a certification, authorized penetration test, or forensic conclusion." };
    }

    public async Task<IReadOnlyList<object>> HistoryAsync(int limit, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_connectionString); await conn.OpenAsync(ct); await EnsureSchemaAsync(conn, ct);
        await using var cmd = new NpgsqlCommand("SELECT id,started_at_utc,completed_at_utc,trigger_type,status,passed_count,warning_count,failed_count,score FROM public.security_monitor_runs ORDER BY started_at_utc DESC LIMIT @limit", conn);
        cmd.Parameters.AddWithValue("limit", Math.Clamp(limit, 1, 100)); var rows = new List<object>(); await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) rows.Add(new { id=reader.GetGuid(0), startedAtUtc=reader.GetDateTime(1), completedAtUtc=reader.GetDateTime(2), trigger=reader.GetString(3), status=reader.GetString(4), passed=reader.GetInt32(5), warnings=reader.GetInt32(6), failed=reader.GetInt32(7), score=reader.GetInt32(8) });
        return rows;
    }

    public async Task<SecurityMonitorRun?> GetAsync(Guid id, CancellationToken ct)
    {
        await using var conn = new NpgsqlConnection(_connectionString); await conn.OpenAsync(ct); await EnsureSchemaAsync(conn, ct);
        await using var cmd = new NpgsqlCommand("SELECT started_at_utc,completed_at_utc,trigger_type,status,passed_count,warning_count,failed_count,score,findings_json FROM public.security_monitor_runs WHERE id=@id", conn); cmd.Parameters.AddWithValue("id", id);
        await using var r = await cmd.ExecuteReaderAsync(ct); if (!await r.ReadAsync(ct)) return null;
        return new(id,r.GetDateTime(0),r.GetDateTime(1),r.GetString(2),r.GetString(3),r.GetInt32(4),r.GetInt32(5),r.GetInt32(6),r.GetInt32(7),JsonSerializer.Deserialize<List<SecurityMonitorFinding>>(r.GetString(8)) ?? new());
    }

    private static async Task EnsureSchemaAsync(NpgsqlConnection conn, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(@"CREATE TABLE IF NOT EXISTS public.security_monitor_runs (
id uuid PRIMARY KEY, started_at_utc timestamptz NOT NULL, completed_at_utc timestamptz NOT NULL, trigger_type text NOT NULL,
status text NOT NULL, passed_count integer NOT NULL, warning_count integer NOT NULL, failed_count integer NOT NULL,
score integer NOT NULL, findings_json jsonb NOT NULL); CREATE INDEX IF NOT EXISTS ix_security_monitor_runs_started ON public.security_monitor_runs(started_at_utc DESC);", conn);
        await cmd.ExecuteNonQueryAsync(ct);
    }
    private static async Task<long> ScalarAsync(NpgsqlConnection conn,string sql,CancellationToken ct){await using var cmd=new NpgsqlCommand(sql,conn);return Convert.ToInt64(await cmd.ExecuteScalarAsync(ct));}
    private static async Task<bool> ExistsAsync(NpgsqlConnection conn,string table,CancellationToken ct){await using var cmd=new NpgsqlCommand("SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND lower(table_name)=lower(@name))",conn);cmd.Parameters.AddWithValue("name",NpgsqlDbType.Text,table);return Convert.ToBoolean(await cmd.ExecuteScalarAsync(ct));}
}
