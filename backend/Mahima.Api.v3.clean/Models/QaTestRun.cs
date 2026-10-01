namespace Mahima.Api.v3.clean.Models;

public sealed class QaTestRun
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid StartedByUserId { get; set; }
    public Guid? PlanId { get; set; }
    public string RequestedModulesJson { get; set; } = "[]";
    public string Status { get; set; } = "running";
    public int PassedCount { get; set; }
    public int WarningCount { get; set; }
    public int FailedCount { get; set; }
    public DateTime StartedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAtUtc { get; set; }
    public string? Error { get; set; }
    public string? LoadTestMetricsJson { get; set; }
    public ICollection<QaTestFinding> Findings { get; set; } = new List<QaTestFinding>();
}

public sealed class QaTestPlan
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string ModulesJson { get; set; } = "[]";
    public string Status { get; set; } = "draft";
    public Guid GeneratedByUserId { get; set; }
    public Guid? ReviewedByUserId { get; set; }
    public DateTime GeneratedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? ReviewedAtUtc { get; set; }
    public string DesignFingerprint { get; set; } = string.Empty;
    public bool LoadTestApproved { get; set; }
    public string LoadTestConfigJson { get; set; } = "{}";
    public ICollection<QaTestCase> Cases { get; set; } = new List<QaTestCase>();
}

public sealed class QaTestCase
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid PlanId { get; set; }
    public string ModuleCode { get; set; } = string.Empty;
    public string TestKey { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Objective { get; set; } = string.Empty;
    public string Preconditions { get; set; } = string.Empty;
    public string StepsJson { get; set; } = "[]";
    public string ExpectedResult { get; set; } = string.Empty;
    public string Severity { get; set; } = "high";
    public string ExecutorType { get; set; } = string.Empty;
    public string ExecutorSpecJson { get; set; } = "{}";
    public string ScenarioType { get; set; } = "positive";
    public string TestDataJson { get; set; } = "{}";
    public bool TestDataApproved { get; set; }
    public bool Approved { get; set; }
    public string? ReviewerNotes { get; set; }
    public int DisplayOrder { get; set; }
    public QaTestPlan? Plan { get; set; }
}

public sealed class QaTestFinding
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RunId { get; set; }
    public string ModuleCode { get; set; } = "platform";
    public string TestKey { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Status { get; set; } = "passed";
    public string Severity { get; set; } = "info";
    public string Details { get; set; } = string.Empty;
    public string? Evidence { get; set; }
    public string? Recommendation { get; set; }
    public string? ImpactAnalysis { get; set; }
    public long DurationMs { get; set; }
    public QaTestRun? Run { get; set; }
}
