using System.Data;
using Mahima.Api.v3.clean.Data;
using Microsoft.EntityFrameworkCore;

namespace Mahima.Api.v3.clean.Services;

public sealed record TenantPrintTemplate(
    Guid TenantId,
    string OrganizationName,
    string? LogoUrl,
    string? Address,
    string? Phone,
    string? Email,
    string? RegistrationNumber,
    string? TaxNumber,
    string? HeaderText,
    string? FooterText,
    string PrimaryColor,
    bool ShowLogo,
    bool ShowAddress,
    bool ShowPageNumbers,
    string PaperSize,
    string Orientation,
    string? SignatureUrl = null,
    string? SignatoryName = null,
    string? SignatoryTitle = null);

public interface ITenantPrintTemplateService
{
    Task<TenantPrintTemplate> GetAsync(Guid tenantId, CancellationToken ct = default);
    Task<TenantPrintTemplate> SaveAsync(TenantPrintTemplate value, CancellationToken ct = default);
    Task<byte[]?> LoadLogoAsync(TenantPrintTemplate value, CancellationToken ct = default);

    // The org's authorized signatory's signature image, for documents like appointment
    // letters where it must be attached without re-uploading it every time.
    Task<byte[]?> LoadSignatureAsync(TenantPrintTemplate value, CancellationToken ct = default);
}

public sealed class TenantPrintTemplateService : ITenantPrintTemplateService
{
    private readonly MahimaDbContext _db;
    private readonly IWebHostEnvironment _env;
    private readonly IConfiguration _config;

    public TenantPrintTemplateService(MahimaDbContext db, IWebHostEnvironment env, IConfiguration config)
    {
        _db = db;
        _env = env;
        _config = config;
    }

    public async Task<TenantPrintTemplate> GetAsync(Guid tenantId, CancellationToken ct = default)
    {
        await EnsureTableAsync(ct);
        var connection = _db.Database.GetDbConnection();
        await EnsureOpenAsync(connection, ct);
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            SELECT organization_name, logo_url, address, phone, email, registration_number,
                   tax_number, header_text, footer_text, primary_color, show_logo,
                   show_address, show_page_numbers, paper_size, orientation,
                   signature_url, signatory_name, signatory_title
              FROM public.tenant_print_templates
             WHERE tenant_id = @tenant_id
            """;
        AddParameter(cmd, "@tenant_id", tenantId);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (await reader.ReadAsync(ct))
        {
            return new TenantPrintTemplate(
                tenantId, reader.GetString(0), NullableString(reader, 1), NullableString(reader, 2),
                NullableString(reader, 3), NullableString(reader, 4), NullableString(reader, 5),
                NullableString(reader, 6), NullableString(reader, 7), NullableString(reader, 8),
                reader.GetString(9), reader.GetBoolean(10), reader.GetBoolean(11),
                reader.GetBoolean(12), reader.GetString(13), reader.GetString(14),
                NullableString(reader, 15), NullableString(reader, 16), NullableString(reader, 17));
        }
        await reader.DisposeAsync();

        var tenant = await _db.Tenants.AsNoTracking()
            .Include(t => t.Branding)
            .FirstOrDefaultAsync(t => t.Id == tenantId, ct);
        return new TenantPrintTemplate(
            tenantId,
            tenant?.Name ?? "Church",
            tenant?.Branding?.LogoUrl,
            tenant?.Branding?.Address,
            tenant?.ContactPhone ?? tenant?.Branding?.ContactPhone,
            tenant?.ContactEmail ?? tenant?.Branding?.ContactEmail,
            null, null, null,
            "This document is system generated.",
            tenant?.Branding?.PrimaryColor ?? "#047857",
            true, true, true, "A4", "portrait");
    }

    public async Task<TenantPrintTemplate> SaveAsync(TenantPrintTemplate value, CancellationToken ct = default)
    {
        await EnsureTableAsync(ct);
        if (string.IsNullOrWhiteSpace(value.LogoUrl))
        {
            var brandingLogo = await _db.TenantBrandings.AsNoTracking()
                .Where(x => x.TenantId == value.TenantId)
                .Select(x => x.LogoUrl)
                .FirstOrDefaultAsync(ct);
            if (!string.IsNullOrWhiteSpace(brandingLogo))
                value = value with { LogoUrl = brandingLogo };
        }
        var connection = _db.Database.GetDbConnection();
        await EnsureOpenAsync(connection, ct);
        await using var cmd = connection.CreateCommand();
        cmd.CommandText = """
            INSERT INTO public.tenant_print_templates
                (tenant_id, organization_name, logo_url, address, phone, email, registration_number,
                 tax_number, header_text, footer_text, primary_color, show_logo, show_address,
                 show_page_numbers, paper_size, orientation, signature_url, signatory_name,
                 signatory_title, created_at_utc, updated_at_utc)
            VALUES
                (@tenant_id, @organization_name, @logo_url, @address, @phone, @email, @registration_number,
                 @tax_number, @header_text, @footer_text, @primary_color, @show_logo, @show_address,
                 @show_page_numbers, @paper_size, @orientation, @signature_url, @signatory_name,
                 @signatory_title, now(), now())
            ON CONFLICT (tenant_id) DO UPDATE SET
                organization_name = EXCLUDED.organization_name, logo_url = EXCLUDED.logo_url,
                address = EXCLUDED.address, phone = EXCLUDED.phone, email = EXCLUDED.email,
                registration_number = EXCLUDED.registration_number, tax_number = EXCLUDED.tax_number,
                header_text = EXCLUDED.header_text, footer_text = EXCLUDED.footer_text,
                primary_color = EXCLUDED.primary_color, show_logo = EXCLUDED.show_logo,
                show_address = EXCLUDED.show_address, show_page_numbers = EXCLUDED.show_page_numbers,
                paper_size = EXCLUDED.paper_size, orientation = EXCLUDED.orientation,
                signature_url = EXCLUDED.signature_url, signatory_name = EXCLUDED.signatory_name,
                signatory_title = EXCLUDED.signatory_title, updated_at_utc = now()
            """;
        AddParameter(cmd, "@tenant_id", value.TenantId);
        AddParameter(cmd, "@organization_name", value.OrganizationName);
        AddParameter(cmd, "@logo_url", value.LogoUrl);
        AddParameter(cmd, "@address", value.Address);
        AddParameter(cmd, "@phone", value.Phone);
        AddParameter(cmd, "@email", value.Email);
        AddParameter(cmd, "@registration_number", value.RegistrationNumber);
        AddParameter(cmd, "@tax_number", value.TaxNumber);
        AddParameter(cmd, "@header_text", value.HeaderText);
        AddParameter(cmd, "@footer_text", value.FooterText);
        AddParameter(cmd, "@primary_color", value.PrimaryColor);
        AddParameter(cmd, "@show_logo", value.ShowLogo);
        AddParameter(cmd, "@show_address", value.ShowAddress);
        AddParameter(cmd, "@show_page_numbers", value.ShowPageNumbers);
        AddParameter(cmd, "@paper_size", value.PaperSize);
        AddParameter(cmd, "@orientation", value.Orientation);
        AddParameter(cmd, "@signature_url", value.SignatureUrl);
        AddParameter(cmd, "@signatory_name", value.SignatoryName);
        AddParameter(cmd, "@signatory_title", value.SignatoryTitle);
        await cmd.ExecuteNonQueryAsync(ct);
        return value;
    }

    public async Task<byte[]?> LoadLogoAsync(TenantPrintTemplate value, CancellationToken ct = default)
    {
        if (!value.ShowLogo || string.IsNullOrWhiteSpace(value.LogoUrl)) return null;
        return await LoadUploadedImageAsync(value.LogoUrl, ct);
    }

    public async Task<byte[]?> LoadSignatureAsync(TenantPrintTemplate value, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(value.SignatureUrl)) return null;
        return await LoadUploadedImageAsync(value.SignatureUrl, ct);
    }

    private async Task<byte[]?> LoadUploadedImageAsync(string url, CancellationToken ct)
    {
        var relative = url.Trim();
        if (Uri.TryCreate(relative, UriKind.Absolute, out var uri))
            relative = uri.AbsolutePath;
        relative = Uri.UnescapeDataString(relative.Replace('\\', '/'));
        var marker = "/api/uploads/";
        var markerIndex = relative.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (markerIndex >= 0)
            relative = relative[(markerIndex + marker.Length)..];
        else
        {
            marker = "/uploads/";
            markerIndex = relative.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
            if (markerIndex >= 0)
                relative = relative[(markerIndex + marker.Length)..];
        }

        var configuredRoot = _config["Uploads:Root"]
            ?? Environment.GetEnvironmentVariable("MAHIMA_UPLOADS_ROOT");
        var root = !string.IsNullOrWhiteSpace(configuredRoot)
            ? configuredRoot
            : OperatingSystem.IsLinux()
                ? "/var/www/mahima-uploads"
                : Path.Combine(_env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot"), "uploads");
        var path = Path.GetFullPath(Path.Combine(root, relative.TrimStart('/').Replace('/', Path.DirectorySeparatorChar)));
        if (!path.StartsWith(Path.GetFullPath(root), StringComparison.OrdinalIgnoreCase) || !File.Exists(path)) return null;
        return await File.ReadAllBytesAsync(path, ct);
    }

    private async Task EnsureTableAsync(CancellationToken ct)
    {
        await _db.Database.ExecuteSqlRawAsync("""
            CREATE TABLE IF NOT EXISTS public.tenant_print_templates (
                tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
                organization_name varchar(200) NOT NULL,
                logo_url text NULL, address text NULL, phone varchar(80) NULL, email varchar(200) NULL,
                registration_number varchar(120) NULL, tax_number varchar(120) NULL,
                header_text text NULL, footer_text text NULL, primary_color varchar(16) NOT NULL DEFAULT '#047857',
                show_logo boolean NOT NULL DEFAULT true, show_address boolean NOT NULL DEFAULT true,
                show_page_numbers boolean NOT NULL DEFAULT true, paper_size varchar(16) NOT NULL DEFAULT 'A4',
                orientation varchar(16) NOT NULL DEFAULT 'portrait',
                signature_url text NULL, signatory_name varchar(200) NULL, signatory_title varchar(200) NULL,
                created_at_utc timestamptz NOT NULL DEFAULT now(), updated_at_utc timestamptz NOT NULL DEFAULT now()
            )
            """, ct);
        await _db.Database.ExecuteSqlRawAsync("""
            ALTER TABLE public.tenant_print_templates
                ADD COLUMN IF NOT EXISTS signature_url text NULL,
                ADD COLUMN IF NOT EXISTS signatory_name varchar(200) NULL,
                ADD COLUMN IF NOT EXISTS signatory_title varchar(200) NULL
            """, ct);
    }

    private static string? NullableString(IDataRecord reader, int ordinal) =>
        reader.IsDBNull(ordinal) ? null : reader.GetString(ordinal);

    private static void AddParameter(System.Data.Common.DbCommand cmd, string name, object? value)
    {
        var parameter = cmd.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value ?? DBNull.Value;
        cmd.Parameters.Add(parameter);
    }

    private static async Task EnsureOpenAsync(System.Data.Common.DbConnection connection, CancellationToken ct)
    {
        if (connection.State != ConnectionState.Open) await connection.OpenAsync(ct);
    }
}
