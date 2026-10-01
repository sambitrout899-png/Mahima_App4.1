using Mahima.Api.v3.clean.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Mahima.Api.v3.clean.Migrations;

[DbContext(typeof(MahimaDbContext))]
[Migration("20260729090000_AddUserPreferredLanguage")]
public sealed class AddUserPreferredLanguage : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "preferred_language",
            schema: "public",
            table: "users",
            type: "character varying(8)",
            maxLength: 8,
            nullable: true);

        migrationBuilder.Sql("""
            UPDATE public.users u
            SET preferred_language = l.code
            FROM public.app_languages l
            WHERE l.is_default = TRUE AND l.enabled = TRUE
              AND u.preferred_language IS NULL;
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        migrationBuilder.DropColumn(name: "preferred_language", schema: "public", table: "users");
}
