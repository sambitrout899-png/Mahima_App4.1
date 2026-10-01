using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mahima.Api.v3.clean.Migrations
{
    public partial class AddVersionedSubscriptionPackages : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "published_version", schema: "public", table: "subscription_plans",
                type: "integer", nullable: false, defaultValue: 0);
            migrationBuilder.AddColumn<DateTime>(
                name: "published_at_utc", schema: "public", table: "subscription_plans",
                type: "timestamp with time zone", nullable: true);
            migrationBuilder.AddColumn<int>(
                name: "applied_plan_version", schema: "public", table: "tenant_subscriptions",
                type: "integer", nullable: false, defaultValue: 0);

            migrationBuilder.CreateTable(
                name: "subscription_plan_publications",
                schema: "public",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    plan_id = table.Column<Guid>(type: "uuid", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    definition_json = table.Column<string>(type: "jsonb", nullable: false),
                    effective_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    published_at_utc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()"),
                    published_by_user_id = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_subscription_plan_publications", x => x.id);
                    table.ForeignKey(
                        name: "fk_subscription_plan_publications_subscription_plans_plan_id",
                        column: x => x.plan_id,
                        principalSchema: "public",
                        principalTable: "subscription_plans",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });
            migrationBuilder.CreateIndex(
                name: "ix_subscription_plan_publications_plan_id_version",
                schema: "public",
                table: "subscription_plan_publications",
                columns: new[] { "plan_id", "version" },
                unique: true);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "subscription_plan_publications", schema: "public");
            migrationBuilder.DropColumn(name: "published_version", schema: "public", table: "subscription_plans");
            migrationBuilder.DropColumn(name: "published_at_utc", schema: "public", table: "subscription_plans");
            migrationBuilder.DropColumn(name: "applied_plan_version", schema: "public", table: "tenant_subscriptions");
        }
    }
}
