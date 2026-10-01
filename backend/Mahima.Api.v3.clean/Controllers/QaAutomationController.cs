using System.Data;
using System.Diagnostics;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;

namespace Mahima.Api.v3.clean.Controllers;

[ApiController]
[Authorize(Roles = "admin,Admin")]
[Route("api/admin/qa")]
public sealed class QaAutomationController : ControllerBase
{
    private static readonly Dictionary<string, string[]> ModuleTables = new(StringComparer.OrdinalIgnoreCase)
    {
        ["platform"] = new[] { "tenants", "users", "pages", "roles" },
        ["base"] = new[] { "users", "\"Teams\"", "pages" },
        ["chat"] = new[] { "chats", "chatmembers", "messages" },
        ["operations"] = new[] { "\"Tasks\"", "\"AttendanceRecords\"", "payroll_runs" },
        ["care_ministry"] = new[] { "marriage_applications", "baptism_requests", "counselling_cases" },
        ["admin_tools"] = new[] { "roles", "pages", "app_languages" },
        ["communications"] = new[] { "messages" },
        ["billing"] = new[] { "subscription_plans", "tenant_subscriptions", "billing_invoices" },
    };

    private static readonly Dictionary<string, string[]> ModuleRouteHints = new(StringComparer.OrdinalIgnoreCase)
    {
        ["platform"] = new[] { "auth", "pages", "users" }, ["base"] = new[] { "users", "teams", "sermons" },
        ["chat"] = new[] { "chat" }, ["operations"] = new[] { "tasks", "attendance", "payroll" },
        ["care_ministry"] = new[] { "marriage", "baptism", "counselling" },
        ["admin_tools"] = new[] { "languages", "roles", "positions" },
        ["communications"] = new[] { "messages", "email", "server-files" },
        ["billing"] = new[] { "billing", "subscriptions", "platform" },
    };

    private static readonly PersonaJourney[] PersonaJourneys =
    {
        new("platform", "Root Admin", "Platform Administrator", "authenticate and enter the root tenant", new[] { "auth", "tenant" }, true, true, "Enter valid credentials, resolve the root tenant and load the Root Admin dashboard.", "Correct authentication, root-tenant resolution and token claims; regression-test every secured module."),
        new("platform", "Member", "Member", "authenticate into their own tenant", new[] { "auth", "profile" }, true, true, "Enter valid member credentials and load only the member's tenant profile.", "Correct tenant claims and member authorization without widening platform permissions."),
        new("platform", "Member", "Member", "attempt cross-tenant access", new[] { "users", "tenant" }, false, true, "Replace the tenant identifier with another tenant and attempt to read its user data.", "Enforce tenant filters at API and query layers; regression-test all tenant-owned entities."),

        new("base", "Tenant Admin", "Church Administrator", "create and activate a church user", new[] { "users", "roles" }, true, true, "Create a user, assign an allowed role and verify activation within the same tenant.", "Correct user creation, role assignment and activation transaction boundaries."),
        new("base", "Member", "Member", "view and update own profile", new[] { "profile", "users" }, true, true, "Change an editable profile field and verify protected fields remain server-controlled.", "Correct self-service DTO allowlists and profile persistence."),
        new("base", "Member", "Member", "modify another member profile", new[] { "users" }, false, true, "Submit another user's identifier while signed in as Member.", "Require self-or-admin authorization and verify tenant scoping."),

        new("chat", "Call Center", "Call Center Agent", "receive and respond to a prayer follow-up chat", new[] { "chat", "prayer" }, true, true, "Open the assigned conversation, send a response and verify delivery/read state.", "Correct chat membership, SignalR delivery and prayer-follow-up linkage."),
        new("chat", "Member", "Member", "send a direct message", new[] { "chat" }, true, true, "Create or open a permitted direct chat and send the generated message.", "Correct membership creation, sender attribution and real-time delivery."),
        new("chat", "Member", "Member", "read a chat without membership", new[] { "chat" }, false, true, "Request conversation history for a chat where the persona is not a member.", "Enforce chat membership before returning messages or attachments."),

        new("operations", "Tenant Admin", "Church Administrator", "create and assign a task across positions", new[] { "tasks", "positions" }, true, true, "Create a task and assign it to a user in another tenant position.", "Correct task assignment policy, hierarchy validation and notifications."),
        new("operations", "Member", "Member", "update an assigned task", new[] { "tasks" }, true, true, "Open an assigned task, update progress and verify audit history.", "Correct assignee edit permissions, optimistic concurrency and audit capture."),
        new("operations", "Member", "Member", "reassign a task outside own position", new[] { "tasks", "positions" }, false, true, "Attempt to reassign the task to a member outside the persona's position.", "Enforce same-position reassignment for non-admin users."),

        new("care_ministry", "Call Center", "Call Center Agent", "register a counselling intake", new[] { "counselling" }, true, true, "Record intake details and route the case to an authorized counsellor.", "Correct counselling intake validation, privacy and assignment."),
        new("care_ministry", "Pastor", "Pastoral Care", "approve and schedule a baptism", new[] { "baptism" }, true, true, "Review the request, approve it and schedule the service.", "Correct baptism state transitions, scheduling and notification."),
        new("care_ministry", "Member", "Member", "open another person's confidential counselling case", new[] { "counselling" }, false, true, "Request a counselling case not assigned to or owned by the persona.", "Enforce confidential case ownership and pastoral authorization."),

        new("admin_tools", "Root Admin", "Platform Administrator", "manage a tenant definition", new[] { "tenant", "platform" }, true, true, "Create or update an isolated tenant definition and verify its status.", "Correct platform-only tenant administration and domain/status validation."),
        new("admin_tools", "Tenant Admin", "Church Administrator", "create a position and assign hierarchy", new[] { "positions", "users" }, true, true, "Create a position, place it beneath a parent and assign an eligible user.", "Correct hierarchy cycle detection, tenant scoping and assignments."),
        new("admin_tools", "Member", "Member", "change roles or position definitions", new[] { "roles", "positions" }, false, true, "Attempt to update role permissions and position hierarchy.", "Restrict administrative definitions to Root/Tenant Admin roles."),

        new("communications", "Media", "Media Team", "publish an approved ministry communication", new[] { "messages", "email" }, true, true, "Compose approved content, select recipients and submit the communication.", "Correct media permissions, recipient resolution and delivery logging."),
        new("communications", "Tenant Admin", "Church Administrator", "send a tenant broadcast", new[] { "messages", "email" }, true, true, "Send the generated broadcast to a tenant-scoped audience and verify delivery records.", "Correct audience filters, translation and email/message delivery."),
        new("communications", "Member", "Member", "send an administrative broadcast", new[] { "messages" }, false, true, "Attempt to target all tenant users from a Member account.", "Require broadcast permission and enforce recipient-scope limits."),

        new("billing", "Tenant Admin", "Church Administrator", "request an add-on using UPI donation details", new[] { "subscriptions", "payment" }, true, true, "Submit the synthetic UPI reference and verify Pending Root Approval state.", "Correct payment request state transitions, duplicate detection and Root Admin notification."),
        new("billing", "Root Admin", "Platform Administrator", "approve payment and activate an add-on", new[] { "billing", "subscriptions", "entitlements" }, true, true, "Verify the pending payment and activate the requested tenant add-on.", "Correct payment verification, single active license enforcement and tenant notification."),
        new("billing", "Member", "Member", "approve a payment or activate a package", new[] { "billing", "subscriptions" }, false, true, "Attempt Root Admin payment approval and package activation endpoints.", "Restrict billing approval and license activation to Root Admin."),
    };

    private readonly MahimaDbContext _db;
    private readonly ITenantContextService _tenantContext;
    private readonly EndpointDataSource _endpoints;
    private readonly IConfiguration _configuration;
    private readonly ILogger<QaAutomationController> _logger;
    private readonly IHttpClientFactory _httpClientFactory;

    public QaAutomationController(MahimaDbContext db, ITenantContextService tenantContext, EndpointDataSource endpoints,
        IConfiguration configuration, ILogger<QaAutomationController> logger, IHttpClientFactory httpClientFactory)
        => (_db, _tenantContext, _endpoints, _configuration, _logger, _httpClientFactory) = (db, tenantContext, endpoints, configuration, logger, httpClientFactory);

    [HttpGet("catalog")]
    public async Task<IActionResult> Catalog(CancellationToken ct)
    {
        if (!await IsRootAdminAsync(ct)) return Forbid();
        var modules = await _db.ModuleCatalog.AsNoTracking().Where(x => x.Enabled).OrderBy(x => x.DisplayOrder)
            .Select(x => new CatalogItem(x.Code, x.Name, x.Description)).ToListAsync(ct);
        modules.Insert(0, new("platform", "Platform Core", "Authentication, tenancy, database and routing integrity."));
        modules.Add(new("billing", "Subscriptions & Billing", "Plans, licenses, subscriptions and invoice integrity."));
        return Ok(modules.GroupBy(x => x.Code, StringComparer.OrdinalIgnoreCase).Select(x => x.First()));
    }

    [HttpPost("plans/generate")]
    public async Task<IActionResult> Generate([FromBody] GenerateRequest request, CancellationToken ct)
    {
        if (!await IsRootAdminAsync(ct)) return Forbid();
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var modules = await ValidateModulesAsync(request?.Modules, ct);
        if (modules.Invalid.Count > 0) return BadRequest(new { message = "Unknown or disabled modules were requested.", modules = modules.Invalid });

        var plan = new QaTestPlan
        {
            Name = string.IsNullOrWhiteSpace(request?.Name) ? $"Critical regression plan {DateTime.UtcNow:yyyy-MM-dd HH:mm} UTC" : request.Name.Trim(),
            ModulesJson = JsonSerializer.Serialize(modules.Valid), Status = "draft", GeneratedByUserId = userId,
            DesignFingerprint = DesignFingerprint(modules.Valid)
        };
        var cases = GenerateCases(plan.Id, modules.Valid);
        plan.Cases = cases;
        try
        {
            _db.QaTestPlans.Add(plan);
            await _db.SaveChangesAsync(ct);
            return CreatedAtAction(nameof(Plan), new { id = plan.Id }, ToPlan(plan));
        }
        catch (DbUpdateException exception)
        {
            _logger.LogError(exception,
                "QA plan generation failed for plan {PlanId} and modules {Modules}",
                plan.Id, string.Join(",", modules.Valid));
            return Problem(
                title: "Test case generation failed",
                detail: "The generated plan could not be stored. Confirm that both QA database scripts are deployed, then review the API log using the request trace identifier.",
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    [HttpGet("plans/{id:guid}")]
    public async Task<IActionResult> Plan(Guid id, CancellationToken ct)
    {
        if (!await IsRootAdminAsync(ct)) return Forbid();
        var plan = await _db.QaTestPlans.AsNoTracking().Include(x => x.Cases).FirstOrDefaultAsync(x => x.Id == id, ct);
        return plan == null ? NotFound() : Ok(ToPlan(plan));
    }

    [HttpPut("plans/{id:guid}/review")]
    public async Task<IActionResult> Review(Guid id, [FromBody] ReviewRequest request, CancellationToken ct)
    {
        if (!await IsRootAdminAsync(ct)) return Forbid();
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var plan = await _db.QaTestPlans.Include(x => x.Cases).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (plan == null) return NotFound();
        if (plan.Status != "draft") return Conflict(new { message = "Only a draft plan can be reviewed." });
        var decisions = (request?.Cases ?? new()).ToDictionary(x => x.Id);
        foreach (var testCase in plan.Cases)
        {
            if (!decisions.TryGetValue(testCase.Id, out var decision)) continue;
            testCase.Approved = decision.Approved;
            testCase.TestDataApproved = decision.Approved && decision.TestDataApproved;
            testCase.ReviewerNotes = string.IsNullOrWhiteSpace(decision.ReviewerNotes) ? null : decision.ReviewerNotes.Trim();
        }
        if (!plan.Cases.Any(x => x.Approved)) return BadRequest(new { message = "Approve at least one test case before approving the plan." });
        if (plan.Cases.Any(x => x.Approved && !x.TestDataApproved)) return BadRequest(new { message = "Approve the generated test data for every approved test case." });
        var load = request?.LoadTest ?? new LoadTestDecision();
        plan.LoadTestApproved = load.Approved;
        plan.LoadTestConfigJson = JsonSerializer.Serialize(new
        {
            concurrency = Math.Clamp(load.Concurrency, 1, 20),
            requests = Math.Clamp(load.Requests, 1, 200),
            path = SafeLoadPath(load.Path)
        });
        plan.Status = "approved"; plan.ReviewedByUserId = userId; plan.ReviewedAtUtc = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);
        return Ok(ToPlan(plan));
    }

    [HttpPost("plans/{id:guid}/run")]
    public async Task<IActionResult> ExecuteApproved(Guid id, CancellationToken ct)
    {
        if (!await IsRootAdminAsync(ct)) return Forbid();
        if (!TryGetUserId(out var userId)) return Unauthorized();
        var plan = await _db.QaTestPlans.Include(x => x.Cases).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (plan == null) return NotFound();
        if (plan.Status != "approved") return Conflict(new { message = "The Root Admin must approve this plan before it can run." });
        var approved = plan.Cases.Where(x => x.Approved).OrderBy(x => x.DisplayOrder).ToList();
        if (approved.Count == 0) return BadRequest(new { message = "The approved plan contains no executable test cases." });

        plan.Status = "running";
        var run = new QaTestRun { PlanId = plan.Id, StartedByUserId = userId, RequestedModulesJson = plan.ModulesJson, Status = "running" };
        _db.QaTestRuns.Add(run); await _db.SaveChangesAsync(ct);
        try
        {
            var findings = new List<QaTestFinding>();
            foreach (var testCase in approved)
            {
                try { findings.Add(await ExecuteCaseAsync(run.Id, testCase, ct)); }
                catch (Exception caseError)
                {
                    _logger.LogWarning(caseError, "QA test case {TestKey} failed to execute in run {RunId}", testCase.TestKey, run.Id);
                    findings.Add(new QaTestFinding
                    {
                        RunId = run.Id, ModuleCode = testCase.ModuleCode, TestKey = testCase.TestKey, Title = testCase.Title,
                        Status = "failed", Severity = testCase.Severity,
                        Details = "The scenario executor encountered an error while evaluating this approved test.",
                        Evidence = $"{caseError.GetType().Name}: {caseError.Message}",
                        Recommendation = "Compare the approved executor design with the deployed schema/API, correct the mismatch, and re-run this case.",
                        ImpactAnalysis = ImpactFor(testCase.ModuleCode)
                    });
                }
            }
            if (plan.LoadTestApproved)
            {
                var loadFinding = await ExecuteLoadTestAsync(run.Id, plan.LoadTestConfigJson, ct);
                findings.Add(loadFinding);
                run.LoadTestMetricsJson = loadFinding.Evidence;
            }
            _db.QaTestFindings.AddRange(findings);
            run.PassedCount = findings.Count(x => x.Status == "passed");
            run.WarningCount = findings.Count(x => x.Status == "warning");
            run.FailedCount = findings.Count(x => x.Status == "failed");
            run.Status = run.FailedCount > 0 ? "failed" : run.WarningCount > 0 ? "completed_with_warnings" : "passed";
            run.CompletedAtUtc = DateTime.UtcNow; run.Findings = findings; plan.Status = "completed";
            await _db.SaveChangesAsync(ct);
            return Ok(ToReport(run));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Approved QA plan {PlanId}, run {RunId} failed", plan.Id, run.Id);
            run.Status = "error"; run.Error = "The approved QA run could not complete. Review the API log using the run ID.";
            run.CompletedAtUtc = DateTime.UtcNow; plan.Status = "approved";
            await _db.SaveChangesAsync(CancellationToken.None);
            return StatusCode(500, new { message = run.Error, runId = run.Id });
        }
    }

    [HttpGet("runs")]
    public async Task<IActionResult> Runs([FromQuery] int limit = 30, CancellationToken ct = default)
    {
        if (!await IsRootAdminAsync(ct)) return Forbid();
        return Ok(await _db.QaTestRuns.AsNoTracking().OrderByDescending(x => x.StartedAtUtc).Take(Math.Clamp(limit, 1, 100))
            .Select(x => new { x.Id, x.PlanId, x.Status, x.PassedCount, x.WarningCount, x.FailedCount, x.StartedAtUtc, x.CompletedAtUtc, x.RequestedModulesJson }).ToListAsync(ct));
    }

    [HttpGet("runs/{id:guid}")]
    public async Task<IActionResult> Run(Guid id, CancellationToken ct)
    {
        if (!await IsRootAdminAsync(ct)) return Forbid();
        var run = await _db.QaTestRuns.AsNoTracking().Include(x => x.Findings).FirstOrDefaultAsync(x => x.Id == id, ct);
        return run == null ? NotFound() : Ok(ToReport(run));
    }

    [HttpGet("runs/{id:guid}/solution-report")]
    public async Task<IActionResult> SolutionReport(Guid id, CancellationToken ct)
    {
        if (!await IsRootAdminAsync(ct)) return Forbid();
        var run = await _db.QaTestRuns.AsNoTracking().Include(x => x.Findings).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (run == null) return NotFound();
        var issues = run.Findings.Where(x => x.Status != "passed").OrderByDescending(x => SeverityRank(x.Severity)).Select(x => new
        {
            defectId = $"DEF-{run.Id.ToString("N")[..8]}-{StableKey(x.TestKey)}", x.ModuleCode, x.TestKey, x.Title,
            x.Status, x.Severity, problem = x.Details, evidence = x.Evidence, solution = x.Recommendation,
            verification = $"Re-generate the affected module plan, approve, re-run '{x.TestKey}', and confirm Passed."
            , impact = x.ImpactAnalysis
        });
        return Ok(new { run.Id, run.PlanId, generatedAtUtc = DateTime.UtcNow, summary = new { run.FailedCount, run.WarningCount }, issues });
    }

    private List<QaTestCase> GenerateCases(Guid planId, IReadOnlyList<string> modules)
    {
        var result = new List<QaTestCase>(); var order = 0;
        foreach (var module in modules)
        {
            foreach (var table in TablesFor(module))
                result.Add(Case(planId, module, $"schema:{table}", $"Verify required table {table}", "Confirm the module database design is deployed.",
                    "table_exists", new { table, fix = $"Apply the migration that creates public.{table} and republish the API." }, "critical", order += 10));
            foreach (var hint in RoutesFor(module))
            {
                result.Add(Case(planId, module, $"route:{hint}", $"Verify {hint} API endpoints", "Confirm the published API exposes the controller routes required by the module.",
                    "route_exists", new { hint, fix = "Confirm the controller is compiled, route attributes match the frontend, and the latest API publish is active." }, "high", order += 10, "positive"));
                result.Add(Case(planId, module, $"route:{hint}:access-policy", $"Verify explicit access policy for {hint}", "Confirm every module endpoint explicitly declares protected or intentionally public access.",
                    "route_requires_auth", new { hint, fix = "Declare [Authorize] for protected endpoints and [AllowAnonymous] only for explicitly reviewed public endpoints." }, "critical", order += 10, "negative"));
            }
            result.AddRange(BusinessCases(planId, module, ref order));
            result.AddRange(PersonaCases(planId, module, ref order));
        }
        return result;
    }

    private static IEnumerable<QaTestCase> PersonaCases(Guid planId, string module, ref int order)
    {
        var journeys = PersonaJourneys.Where(x => x.Module == module).ToList();
        var result = new List<QaTestCase>();
        foreach (var journey in journeys)
        {
            order += 10;
            var scenario = journey.Allowed ? "positive" : "negative";
            var key = $"persona:{Normalize(journey.Persona)}:{Normalize(journey.Journey).Replace(' ', '-')}";
            var seed = StableKey($"{module}:{journey.Persona}:{journey.Journey}").ToLowerInvariant();
            var data = new
            {
                dataSetId = $"qa-persona-{seed}", synthetic = true, persist = false,
                persona = new { journey.Persona, username = $"qa_{Normalize(journey.Persona)}_{seed}", email = $"qa+{seed}@example.invalid", position = journey.Position },
                tenant = new { slug = $"qa-tenant-{seed[..5]}", isolated = true },
                transaction = new { correlationId = $"QA-{seed}", journey.Journey, sampleText = $"Automated QA transaction {seed}", amount = module == "billing" ? 499 : 0 },
                invalidInput = journey.Allowed ? null : new { crossTenantId = Guid.Empty, unauthorized = true },
                cleanup = "Rollback the isolated transaction or delete records carrying the correlation ID. Production execution remains contract-only."
            };
            var steps = new List<string>
            {
                $"Sign in as the generated {journey.Persona} persona in the isolated QA tenant.",
                $"Activate the {journey.Position} position context and verify its navigation visibility.",
                $"Open the {module.Replace('_', ' ')} functional area.",
                journey.Action,
                journey.Allowed ? "Submit the transaction and reload it from the server." : "Attempt the restricted transaction without elevating the persona.",
                journey.Allowed ? "Verify persisted values, audit attribution, tenant ownership and downstream notification." : "Verify the API rejects the request, creates no record and writes no cross-tenant side effect.",
                "Capture the HTTP status, response, resulting records, audit event and visible screen message."
            };
            result.Add(Case(planId, module, key, $"{journey.Persona}: {journey.Journey}",
                $"Validate the complete {journey.Journey.ToLowerInvariant()} journey for the {journey.Persona} persona.",
                "workflow_contract", new { hints = journey.RouteHints, requireAuthorization = journey.RequireAuthorization, allowed = journey.Allowed, fix = journey.Fix },
                journey.Allowed ? "high" : "critical", order, scenario, data, steps,
                journey.Allowed ? "The persona completes the transaction and sees the saved, tenant-scoped result." : "The transaction is rejected with 401/403, no data is changed, and the UI explains the restriction.",
                "An isolated QA tenant and approved synthetic persona dataset are available; no production identity is used."));
        }
        return result;
    }

    private static IEnumerable<QaTestCase> BusinessCases(Guid planId, string module, ref int order)
    {
        var list = new List<QaTestCase>();
        var currentOrder = order;
        void Sql(string key, string title, string objective, string sql, long expected, string severity, string fix) =>
            list.Add(Case(planId, module, key, title, objective, "scalar_equals", new { sql, expected, fix }, severity, currentOrder += 10));
        if (module == "platform")
        {
            Sql("tenancy:root-count", "Exactly one root tenant", "Prevent ambiguous platform ownership and tenant override behavior.", "SELECT count(*) FROM public.tenants WHERE is_root_tenant=TRUE", 1, "critical", "Retain exactly one valid root tenant row and correct root flags transactionally.");
            Sql("tenancy:orphan-users", "No users with missing tenants", "Validate tenant isolation prerequisites for every user.", "SELECT count(*) FROM public.users u LEFT JOIN public.tenants t ON t.id=u.tenant_id WHERE t.id IS NULL", 0, "critical", "Correct orphan tenant_id values before allowing authentication.");
            Sql("identity:duplicate-usernames", "Tenant usernames are unique", "Prevent nondeterministic login selection.", "SELECT count(*) FROM (SELECT tenant_id,lower(username) FROM public.users WHERE username IS NOT NULL GROUP BY tenant_id,lower(username) HAVING count(*)>1)d", 0, "critical", "Merge or rename duplicates and enforce a tenant-scoped normalized username unique index.");
            list.Add(Case(planId, module, "config:jwt", "JWT signing key configured", "Confirm production authentication can issue and validate tokens.", "config_present", new { key = "Jwt:Key", fix = "Set Jwt__Key using protected production configuration and restart the API." }, "critical", currentOrder += 10));
        }
        if (module == "base")
            Sql("users:duplicate-email", "No duplicate email per tenant", "Prevent password reset and identity ambiguity.", "SELECT count(*) FROM (SELECT tenant_id,lower(email) FROM public.users WHERE email IS NOT NULL AND trim(email)<>'' GROUP BY tenant_id,lower(email) HAVING count(*)>1)d", 0, "high", "Resolve duplicate tenant email identities and add a normalized tenant/email uniqueness rule where business rules permit.");
        if (module == "chat")
        {
            Sql("chat:orphan-members", "Chat members reference users and chats", "Ensure every membership can be authorized and rendered.", "SELECT count(*) FROM public.chatmembers cm LEFT JOIN public.chats c ON c.id=cm.chatid LEFT JOIN public.users u ON u.id=cm.userid WHERE c.id IS NULL OR u.id IS NULL", 0, "critical", "Delete orphan memberships after evidence backup and restore missing valid relationships.");
            Sql("chat:orphan-messages", "Messages reference valid chats and senders", "Prevent broken history and unauthorized message attribution.", "SELECT count(*) FROM public.messages m LEFT JOIN public.chats c ON c.id=m.chatid LEFT JOIN public.users u ON u.id=m.senderid WHERE c.id IS NULL OR u.id IS NULL", 0, "critical", "Repair message foreign keys or archive invalid messages using an audited data-correction script.");
        }
        if (module == "operations")
        {
            Sql("tasks:cross-tenant-assignee", "Task assignees stay inside task tenant", "Verify task assignment cannot cross tenant boundaries.", "SELECT count(*) FROM public.\"Tasks\" t JOIN public.users u ON u.id=t.\"AssigneeId\" WHERE t.\"AssigneeId\" IS NOT NULL AND u.tenant_id<>t.\"TenantId\"", 0, "critical", "Reassign invalid tasks within their tenant and enforce tenant equality in the assignment API.");
            Sql("payroll:balance", "Payroll balances reconcile", "Validate payable minus paid equals remaining balance.", "SELECT count(*) FROM public.payroll_runs WHERE abs(coalesce(payable_amount,0)-coalesce(paid_amount,0)-coalesce(balance_amount,0))>0.01", 0, "high", "Recalculate affected payroll balances in one transaction and add server-side reconciliation validation.");
        }
        if (module == "admin_tools")
            Sql("languages:default", "Exactly one enabled default language", "Ensure deterministic application language fallback.", "SELECT count(*) FROM public.app_languages WHERE enabled=TRUE AND is_default=TRUE", 1, "high", "Choose one enabled default in Root Admin Languages and prevent multiple defaults with a database constraint.");
        if (module == "communications")
            Sql("messages:orphan-sender", "Communication senders exist", "Ensure messages remain attributable and auditable.", "SELECT count(*) FROM public.messages m LEFT JOIN public.users u ON u.id=m.senderid WHERE u.id IS NULL", 0, "high", "Repair or archive orphan messages and retain sender foreign-key enforcement.");
        if (module == "billing")
        {
            Sql("licenses:duplicate-active", "One active license per tenant module", "Prevent duplicated entitlements and billing.", "SELECT count(*) FROM (SELECT tenant_id,module_code FROM public.tenant_module_licenses WHERE status='active' AND starts_at_utc<=now() AND (ends_at_utc IS NULL OR ends_at_utc>now()) GROUP BY tenant_id,module_code HAVING count(*)>1)d", 0, "critical", "End superseded rows, retain the newest valid license, and enforce the active-license unique constraint.");
            Sql("subscriptions:missing-plan", "Subscriptions reference valid plans", "Ensure every subscription can be priced and versioned.", "SELECT count(*) FROM public.tenant_subscriptions s LEFT JOIN public.subscription_plans p ON p.id=s.plan_id WHERE p.id IS NULL", 0, "critical", "Repair invalid plan references before invoice generation and retain the foreign key.");
        }
        order = currentOrder;
        return list;
    }

    private async Task<QaTestFinding> ExecuteCaseAsync(Guid runId, QaTestCase testCase, CancellationToken ct)
    {
        var timer = Stopwatch.StartNew();
        using var doc = JsonDocument.Parse(testCase.ExecutorSpecJson); var spec = doc.RootElement;
        bool passed; string evidence;
        switch (testCase.ExecutorType)
        {
            case "table_exists":
                var table = spec.GetProperty("table").GetString()!;
                passed = Convert.ToBoolean(await ScalarAsync("SELECT to_regclass(@name) IS NOT NULL", ct, ("name", $"public.{table}")));
                evidence = $"to_regclass(public.{table}) = {passed}"; break;
            case "route_exists":
                var hint = spec.GetProperty("hint").GetString()!;
                passed = _endpoints.Endpoints.Any(x => EndpointMatches(x, hint));
                evidence = $"Runtime endpoint containing '{hint}' found = {passed}"; break;
            case "route_requires_auth":
                var protectedHint = spec.GetProperty("hint").GetString()!;
                var matchingEndpoints = _endpoints.Endpoints.Where(x => EndpointMatches(x, protectedHint)).ToList();
                var protectedCount = matchingEndpoints.Count(RequiresAuthorization);
                var explicitPublicCount = matchingEndpoints.Count(x => x.Metadata.GetMetadata<IAllowAnonymous>() != null);
                passed = matchingEndpoints.Count > 0 && matchingEndpoints.All(x => RequiresAuthorization(x) || x.Metadata.GetMetadata<IAllowAnonymous>() != null);
                evidence = $"Endpoints matched = {matchingEndpoints.Count}; protected = {protectedCount}; explicitly public = {explicitPublicCount}; undeclared = {matchingEndpoints.Count - protectedCount - explicitPublicCount}."; break;
            case "workflow_contract":
                var hints = spec.GetProperty("hints").EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x.Length > 0).ToList();
                var requireAuthorization = spec.GetProperty("requireAuthorization").GetBoolean();
                var routeEvidence = hints.Select(h => new
                {
                    hint = h,
                    endpoints = _endpoints.Endpoints.Where(x => EndpointMatches(x, h)).ToList()
                }).ToList();
                passed = routeEvidence.All(x => x.endpoints.Count > 0) && (!requireAuthorization || routeEvidence.All(x =>
                    x.endpoints.Any(RequiresAuthorization)));
                evidence = JsonSerializer.Serialize(routeEvidence.Select(x => new { x.hint, count = x.endpoints.Count, protectedCount = x.endpoints.Count(RequiresAuthorization), explicitlyPublicCount = x.endpoints.Count(endpoint => endpoint.Metadata.GetMetadata<IAllowAnonymous>() != null) }));
                break;
            case "config_present":
                var key = spec.GetProperty("key").GetString()!;
                passed = !string.IsNullOrWhiteSpace(_configuration[key]); evidence = $"Configuration '{key}' present = {passed}; value redacted."; break;
            case "scalar_equals":
                var sql = spec.GetProperty("sql").GetString()!; var expected = spec.GetProperty("expected").GetInt64();
                var actual = Convert.ToInt64(await ScalarAsync(sql, ct)); passed = actual == expected; evidence = $"Expected {expected}; actual {actual}."; break;
            default: passed = false; evidence = $"Unsupported executor '{testCase.ExecutorType}'."; break;
        }
        timer.Stop();
        var fix = spec.TryGetProperty("fix", out var fixNode) ? fixNode.GetString() : "Review the module implementation and add a supported automated executor.";
        return new QaTestFinding
        {
            RunId = runId, ModuleCode = testCase.ModuleCode, TestKey = testCase.TestKey, Title = testCase.Title,
            Status = passed ? "passed" : "failed", Severity = passed ? "info" : testCase.Severity,
            Details = passed ? testCase.ExpectedResult : $"Scenario failed: {testCase.Objective}", Evidence = evidence,
            Recommendation = passed ? null : fix, DurationMs = timer.ElapsedMilliseconds
            , ImpactAnalysis = passed ? null : ImpactFor(testCase.ModuleCode)
        };
    }

    private async Task<QaTestFinding> ExecuteLoadTestAsync(Guid runId, string configJson, CancellationToken ct)
    {
        using var config = JsonDocument.Parse(configJson);
        var concurrency = Math.Clamp(config.RootElement.GetProperty("concurrency").GetInt32(), 1, 20);
        var requestCount = Math.Clamp(config.RootElement.GetProperty("requests").GetInt32(), 1, 200);
        var path = SafeLoadPath(config.RootElement.GetProperty("path").GetString());
        var configuredBase = _configuration["Qa:LoadTestBaseUrl"];
        var baseUrl = string.IsNullOrWhiteSpace(configuredBase) ? $"{Request.Scheme}://{Request.Host}" : configuredBase.TrimEnd('/');
        var client = _httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(15);
        using var gate = new SemaphoreSlim(concurrency);
        var durations = new long[requestCount];
        var statuses = new int[requestCount];
        var total = Stopwatch.StartNew();
        var tasks = Enumerable.Range(0, requestCount).Select(async index =>
        {
            await gate.WaitAsync(ct);
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, $"{baseUrl}{path}");
                foreach (var name in new[] { "Authorization", "X-Tenant-Slug", "X-Tenant-Id", "X-Mahima-Position-Id" })
                    if (Request.Headers.TryGetValue(name, out var value)) request.Headers.TryAddWithoutValidation(name, value.ToArray());
                var watch = Stopwatch.StartNew();
                using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
                watch.Stop(); durations[index] = watch.ElapsedMilliseconds; statuses[index] = (int)response.StatusCode;
            }
            catch when (!ct.IsCancellationRequested) { statuses[index] = 0; durations[index] = 15000; }
            finally { gate.Release(); }
        });
        await Task.WhenAll(tasks); total.Stop();
        var successful = statuses.Count(x => x is >= 200 and < 400);
        var sorted = durations.OrderBy(x => x).ToArray();
        var p95 = sorted[Math.Min(sorted.Length - 1, (int)Math.Ceiling(sorted.Length * .95) - 1)];
        var metrics = new
        {
            path, requestCount, concurrency, successful, failed = requestCount - successful,
            successRate = Math.Round(successful * 100d / requestCount, 2),
            requestsPerSecond = Math.Round(requestCount / Math.Max(.001, total.Elapsed.TotalSeconds), 2),
            averageMs = Math.Round(durations.Average(), 2), p95Ms = p95, maxMs = durations.Max(),
            statusCodes = statuses.GroupBy(x => x).ToDictionary(x => x.Key.ToString(), x => x.Count())
        };
        var passed = successful == requestCount && p95 <= 2000;
        return new QaTestFinding
        {
            RunId = runId, ModuleCode = "end_to_end", TestKey = "end_to_end:load", Title = "Approved end-to-end load test",
            Status = passed ? "passed" : "failed", Severity = passed ? "info" : "high",
            Details = passed ? "The approved load profile met its availability and latency thresholds." : "The approved load profile exceeded the zero-error or 2-second p95 threshold.",
            Evidence = JsonSerializer.Serialize(metrics),
            Recommendation = passed ? null : "Inspect slow/error endpoints, database query plans, connection pools and reverse-proxy limits; tune one layer at a time and repeat the identical approved profile.",
            ImpactAnalysis = passed ? null : "Performance changes can affect API capacity, database concurrency, authentication, SignalR traffic and all module response times. Re-run functional regression plus this same load profile after each change.",
            DurationMs = total.ElapsedMilliseconds
        };
    }

    private static object SyntheticData(string module, string key, string scenarioType)
    {
        var seed = StableKey($"{module}:{key}:{scenarioType}").ToLowerInvariant();
        return new
        {
            dataSetId = $"qa-{seed}", synthetic = true, persist = false, module,
            scenarioType, tenantSlug = $"qa-tenant-{seed[..4]}",
            user = new { username = $"qa_user_{seed}", email = $"qa+{seed}@example.invalid", role = "member" },
            validValue = $"QA-{seed}", invalidValue = scenarioType == "negative" ? "" : null,
            cleanup = "No cleanup required: read-only executor; generated identities are never persisted."
        };
    }

    private static string ImpactFor(string module) => module switch
    {
        "platform" => "Authentication, tenancy, authorization and every downstream module may be affected. Run the complete regression plan after the fix.",
        "base" => "Users, teams, landing pages, sermons and dependent assignment workflows may be affected.",
        "chat" => "Direct/group messaging, notifications, task alerts and chat safety may be affected.",
        "operations" => "Tasks, attendance, payroll, accounting, reporting and audit trails may be affected.",
        "care_ministry" => "Marriage, baptism, counselling and pastoral-care records or certificates may be affected.",
        "admin_tools" => "Roles, pages, positions, languages and tenant administration may be affected.",
        "communications" => "Message center, email, files, Google Drive and broadcast delivery may be affected.",
        "billing" => "Subscriptions, licenses, entitlements, invoices and pro-rata calculations may be affected.",
        _ => "Re-run this module and all consumers of the affected endpoint or table."
    };

    private static string SafeLoadPath(string? value)
    {
        var path = string.IsNullOrWhiteSpace(value) ? "/api/admin/qa/catalog" : value.Trim();
        return path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase) && !path.Contains("..", StringComparison.Ordinal) && !path.Contains('?')
            ? path : "/api/admin/qa/catalog";
    }

    private static bool EndpointMatches(Endpoint endpoint, string hint)
    {
        if (endpoint is RouteEndpoint routeEndpoint)
            return (routeEndpoint.RoutePattern.RawText ?? string.Empty).Contains(hint, StringComparison.OrdinalIgnoreCase);
        return (endpoint.DisplayName ?? string.Empty).Contains(hint, StringComparison.OrdinalIgnoreCase);
    }

    private static bool RequiresAuthorization(Endpoint endpoint) =>
        endpoint.Metadata.GetOrderedMetadata<IAuthorizeData>().Count > 0 && endpoint.Metadata.GetMetadata<IAllowAnonymous>() == null;

    private static QaTestCase Case(Guid planId, string module, string key, string title, string objective, string executor, object spec, string severity, int order,
        string scenarioType = "positive", object? testData = null, IReadOnlyList<string>? steps = null, string? expectedResult = null, string? preconditions = null) => new()
    {
        // Shared routes and tables can belong to several modules, so identity must
        // be module-scoped within the plan (for example platform:table-users).
        PlanId = planId, ModuleCode = module, TestKey = $"{module}:{key}", Title = title, Objective = objective,
        Preconditions = preconditions ?? "Production database is reachable; execution is read-only; Root Admin has reviewed this case.",
        StepsJson = JsonSerializer.Serialize(steps ?? new[] { "Resolve the current published module design.", "Execute the approved read-only check.", "Compare observed evidence with the expected result.", "Record a defect and fix plan when the comparison fails." }),
        ExpectedResult = expectedResult ?? "The observed result matches the approved critical invariant.", Severity = severity,
        ExecutorType = executor, ExecutorSpecJson = JsonSerializer.Serialize(spec), DisplayOrder = order,
        ScenarioType = scenarioType,
        TestDataJson = JsonSerializer.Serialize(testData ?? SyntheticData(module, key, scenarioType))
    };

    private async Task<(List<string> Valid, List<string> Invalid)> ValidateModulesAsync(IEnumerable<string>? requested, CancellationToken ct)
    {
        var values = (requested ?? Array.Empty<string>()).Select(Normalize).Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (values.Count == 0) values.Add("platform");
        var allowed = (await _db.ModuleCatalog.AsNoTracking().Where(x => x.Enabled).Select(x => x.Code).ToListAsync(ct)).Append("platform").Append("billing").ToHashSet(StringComparer.OrdinalIgnoreCase);
        return (values.Where(allowed.Contains).ToList(), values.Where(x => !allowed.Contains(x)).ToList());
    }

    private string DesignFingerprint(IEnumerable<string> modules)
    {
        var design = string.Join('|', modules.OrderBy(x => x)) + "|" + string.Join('|', _endpoints.Endpoints.Select(x => x.DisplayName).OrderBy(x => x));
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(design))).ToLowerInvariant();
    }

    private static string StableKey(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value ?? string.Empty)))[..8];

    private async Task<object?> ScalarAsync(string sql, CancellationToken ct, params (string Name, object Value)[] parameters)
    {
        var connection = _db.Database.GetDbConnection(); if (connection.State != ConnectionState.Open) await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand(); command.CommandText = sql;
        foreach (var parameter in parameters) { var p = command.CreateParameter(); p.ParameterName = parameter.Name; p.Value = parameter.Value; command.Parameters.Add(p); }
        return await command.ExecuteScalarAsync(ct);
    }

    private static object ToPlan(QaTestPlan plan) => new
    {
        plan.Id, plan.Name, plan.Status, modules = JsonSerializer.Deserialize<List<string>>(plan.ModulesJson) ?? new(),
        plan.GeneratedAtUtc, plan.ReviewedAtUtc, plan.DesignFingerprint,
        loadTest = new { approved = plan.LoadTestApproved, config = JsonSerializer.Deserialize<object>(plan.LoadTestConfigJson) },
        cases = plan.Cases.OrderBy(x => x.DisplayOrder).Select(x => new { x.Id, x.ModuleCode, x.TestKey, x.Title, x.Objective, x.Preconditions, steps = JsonSerializer.Deserialize<List<string>>(x.StepsJson) ?? new(), x.ExpectedResult, x.Severity, x.ScenarioType, testData = JsonSerializer.Deserialize<object>(x.TestDataJson), x.TestDataApproved, x.Approved, x.ReviewerNotes })
    };
    private static object ToReport(QaTestRun run) => new
    {
        run.Id, run.PlanId, run.Status, modules = JsonSerializer.Deserialize<List<string>>(run.RequestedModulesJson) ?? new(), run.PassedCount, run.WarningCount, run.FailedCount,
        run.StartedAtUtc, run.CompletedAtUtc, run.Error, loadTestMetrics = string.IsNullOrWhiteSpace(run.LoadTestMetricsJson) ? null : JsonSerializer.Deserialize<object>(run.LoadTestMetricsJson), healthScore = Math.Max(0, 100 - run.FailedCount * 15 - run.WarningCount * 5),
        findings = run.Findings.OrderByDescending(x => SeverityRank(x.Severity)).ThenBy(x => x.ModuleCode).ThenBy(x => x.Title)
            .Select(x => new { x.Id, x.RunId, x.ModuleCode, x.TestKey, x.Title, x.Status, x.Severity, x.Details, x.Evidence, x.Recommendation, x.ImpactAnalysis, x.DurationMs })
    };
    private static int SeverityRank(string? value) => value?.ToLowerInvariant() switch { "critical" => 4, "high" => 3, "medium" => 2, "low" => 1, _ => 0 };
    private static string Normalize(string? value) => (value ?? "").Trim().ToLowerInvariant();
    private static IEnumerable<string> TablesFor(string module) => ModuleTables.TryGetValue(module, out var x) ? x : ModuleTables["platform"].Take(2);
    private static IEnumerable<string> RoutesFor(string module) => ModuleRouteHints.TryGetValue(module, out var x) ? x : new[] { module.Replace('_', '-') };
    private async Task<bool> IsRootAdminAsync(CancellationToken ct) => (await _tenantContext.GetCurrentTenantAsync(ct))?.IsRootTenant == true;
    private bool TryGetUserId(out Guid id) => Guid.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub"), out id);

    public sealed class GenerateRequest { public string? Name { get; set; } public List<string>? Modules { get; set; } }
    public sealed class ReviewRequest { public List<CaseDecision>? Cases { get; set; } public LoadTestDecision? LoadTest { get; set; } }
    public sealed class CaseDecision { public Guid Id { get; set; } public bool Approved { get; set; } public bool TestDataApproved { get; set; } public string? ReviewerNotes { get; set; } }
    public sealed class LoadTestDecision { public bool Approved { get; set; } public int Concurrency { get; set; } = 5; public int Requests { get; set; } = 50; public string? Path { get; set; } = "/api/admin/qa/catalog"; }
    private sealed record CatalogItem(string Code, string Name, string? Description);
    private sealed record PersonaJourney(string Module, string Persona, string Position, string Journey, string[] RouteHints,
        bool Allowed, bool RequireAuthorization, string Action, string Fix);
}
