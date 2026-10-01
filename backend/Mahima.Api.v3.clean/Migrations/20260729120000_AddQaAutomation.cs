using Mahima.Api.v3.clean.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
namespace Mahima.Api.v3.clean.Migrations;

[DbContext(typeof(MahimaDbContext))]
[Migration("20260729120000_AddQaAutomation")]
public sealed class AddQaAutomation : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql(QaAutomationSql.Create);
    }
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("DROP TABLE IF EXISTS public.qa_test_findings; DROP TABLE IF EXISTS public.qa_test_runs;");
    }
}

internal static class QaAutomationSql
{
    public const string Create = """
CREATE TABLE IF NOT EXISTS public.qa_test_runs (
 id uuid PRIMARY KEY, started_by_user_id uuid NOT NULL,
 requested_modules_json jsonb NOT NULL DEFAULT '[]'::jsonb,
 status varchar(24) NOT NULL, passed_count integer NOT NULL DEFAULT 0,
 warning_count integer NOT NULL DEFAULT 0, failed_count integer NOT NULL DEFAULT 0,
 started_at_utc timestamptz NOT NULL, completed_at_utc timestamptz NULL, error text NULL
);
CREATE INDEX IF NOT EXISTS ix_qa_test_runs_started_at_utc ON public.qa_test_runs(started_at_utc);
CREATE TABLE IF NOT EXISTS public.qa_test_findings (
 id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES public.qa_test_runs(id) ON DELETE CASCADE,
 module_code varchar(64) NOT NULL, test_key varchar(160) NOT NULL, title varchar(240) NOT NULL,
 status varchar(24) NOT NULL, severity varchar(24) NOT NULL, details text NOT NULL,
 evidence text NULL, recommendation text NULL, duration_ms bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_qa_test_findings_run_id ON public.qa_test_findings(run_id);
CREATE INDEX IF NOT EXISTS ix_qa_test_findings_module_status ON public.qa_test_findings(module_code,status);
""";
}
