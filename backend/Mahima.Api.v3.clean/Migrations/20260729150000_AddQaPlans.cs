using Mahima.Api.v3.clean.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
namespace Mahima.Api.v3.clean.Migrations;

[DbContext(typeof(MahimaDbContext))]
[Migration("20260729150000_AddQaPlans")]
public sealed class AddQaPlans : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql(QaPlanSql.Create);
    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("DROP TABLE IF EXISTS public.qa_test_cases; DROP TABLE IF EXISTS public.qa_test_plans; ALTER TABLE public.qa_test_runs DROP COLUMN IF EXISTS plan_id;");
}

internal static class QaPlanSql
{
    public const string Create = """
CREATE TABLE IF NOT EXISTS public.qa_test_plans (
 id uuid PRIMARY KEY, name varchar(240) NOT NULL, modules_json jsonb NOT NULL DEFAULT '[]'::jsonb,
 status varchar(24) NOT NULL, generated_by_user_id uuid NOT NULL, reviewed_by_user_id uuid NULL,
 generated_at_utc timestamptz NOT NULL, reviewed_at_utc timestamptz NULL, design_fingerprint varchar(128) NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_qa_test_plans_generated_at_utc ON public.qa_test_plans(generated_at_utc);
CREATE TABLE IF NOT EXISTS public.qa_test_cases (
 id uuid PRIMARY KEY, plan_id uuid NOT NULL REFERENCES public.qa_test_plans(id) ON DELETE CASCADE,
 module_code varchar(64) NOT NULL, test_key varchar(160) NOT NULL, title varchar(240) NOT NULL,
 objective text NOT NULL, preconditions text NOT NULL, steps_json jsonb NOT NULL DEFAULT '[]'::jsonb,
 expected_result text NOT NULL, severity varchar(24) NOT NULL, executor_type varchar(40) NOT NULL,
 executor_spec_json jsonb NOT NULL DEFAULT '{}'::jsonb, approved boolean NOT NULL DEFAULT false,
 reviewer_notes text NULL, display_order integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_qa_test_cases_plan_id ON public.qa_test_cases(plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_qa_test_cases_plan_key ON public.qa_test_cases(plan_id,test_key);
ALTER TABLE public.qa_test_runs ADD COLUMN IF NOT EXISTS plan_id uuid NULL;
CREATE INDEX IF NOT EXISTS ix_qa_test_runs_plan_id ON public.qa_test_runs(plan_id);
""";
}
