using Mahima.Api.v3.clean.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable
namespace Mahima.Api.v3.clean.Migrations;

[DbContext(typeof(MahimaDbContext))]
[Migration("20260729170000_ExtendQaFunctionalLoad")]
public sealed class ExtendQaFunctionalLoad : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
ALTER TABLE public.qa_test_plans ADD COLUMN IF NOT EXISTS load_test_approved boolean NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS load_test_config_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.qa_test_cases ADD COLUMN IF NOT EXISTS scenario_type varchar(16) NOT NULL DEFAULT 'positive', ADD COLUMN IF NOT EXISTS test_data_json jsonb NOT NULL DEFAULT '{}'::jsonb, ADD COLUMN IF NOT EXISTS test_data_approved boolean NOT NULL DEFAULT false;
ALTER TABLE public.qa_test_runs ADD COLUMN IF NOT EXISTS load_test_metrics_json jsonb NULL;
ALTER TABLE public.qa_test_findings ADD COLUMN IF NOT EXISTS impact_analysis text NULL;
""");
    protected override void Down(MigrationBuilder migrationBuilder) => migrationBuilder.Sql("""
ALTER TABLE public.qa_test_findings DROP COLUMN IF EXISTS impact_analysis;
ALTER TABLE public.qa_test_runs DROP COLUMN IF EXISTS load_test_metrics_json;
ALTER TABLE public.qa_test_cases DROP COLUMN IF EXISTS test_data_approved, DROP COLUMN IF EXISTS test_data_json, DROP COLUMN IF EXISTS scenario_type;
ALTER TABLE public.qa_test_plans DROP COLUMN IF EXISTS load_test_config_json, DROP COLUMN IF EXISTS load_test_approved;
""");
}
