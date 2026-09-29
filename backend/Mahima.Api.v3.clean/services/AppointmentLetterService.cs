using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Mahima.Api.v3.clean.Services;

public class AppointmentLetterService : IAppointmentLetterService
{
    private readonly ITenantPrintTemplateService _printTemplates;
    private readonly string _letterRoot;

    public AppointmentLetterService(ITenantPrintTemplateService printTemplates, IWebHostEnvironment environment, IConfiguration configuration)
    {
        _printTemplates = printTemplates;
        // Private, non-web-exposed root -- never under wwwroot. Generated letters (which
        // may contain salary details) are only ever served through UsersController's
        // authenticated, admin/staff-only, tenant-checked action.
        _letterRoot = Path.GetFullPath(configuration["AppointmentLetters:GeneratedRoot"]
            ?? Path.Combine(environment.ContentRootPath, "App_Data", "appointment-letters"));
    }

    public async Task<string> GenerateAsync(AppointmentLetterRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        QuestPDF.Settings.License = LicenseType.Community;

        var letterDir = Path.Combine(_letterRoot, request.TenantId.ToString("N"));
        Directory.CreateDirectory(letterDir);
        var fileName = $"AppointmentLetter_{request.UserId:N}_{DateTime.UtcNow:yyyyMMddHHmmss}.pdf";
        var filePath = Path.Combine(letterDir, fileName);

        var template = await _printTemplates.GetAsync(request.TenantId);
        var logoBytes = await _printTemplates.LoadLogoAsync(template);
        var brandColor = string.IsNullOrWhiteSpace(template.PrimaryColor) ? "#047857" : template.PrimaryColor;
        var orgName = string.IsNullOrWhiteSpace(template.OrganizationName) ? "Our Ministry" : template.OrganizationName;
        var roleName = string.IsNullOrWhiteSpace(request.RoleName) ? "________________" : request.RoleName;
        var department = request.Department;
        var reportingManager = request.ReportingManager;
        var appointmentDate = request.AppointmentDate.ToString("dd MMMM yyyy");
        var joinDate = request.JoinDate.ToString("dd MMMM yyyy");
        var refNumber = $"AL-{request.UserCode ?? request.UserId.ToString("N")[..8].ToUpperInvariant()}-{DateTime.UtcNow:yyyyMMdd}";

        var compensationRows = BuildCompensationRows(request);

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4);
                page.Margin(36);
                page.PageColor(Colors.White);
                page.DefaultTextStyle(style => style.FontSize(10.5f).FontColor("#1E293B").LineHeight(1.4f));

                page.Header().Column(col =>
                {
                    col.Item().Row(header =>
                    {
                        header.ConstantItem(110).Height(56).Element(logo =>
                        {
                            if (logoBytes is { Length: > 0 })
                                logo.AlignLeft().MaxWidth(95).MaxHeight(52).Image(logoBytes).FitArea();
                        });

                        header.RelativeItem().AlignCenter().Column(center =>
                        {
                            center.Item().AlignCenter().Text(orgName.ToUpperInvariant())
                                .FontSize(16).Bold().FontColor(brandColor).LetterSpacing(0.06f);
                            if (!string.IsNullOrWhiteSpace(template.HeaderText))
                                center.Item().AlignCenter().Text(template.HeaderText).FontSize(8).FontColor("#64748B");
                            if (template.ShowAddress && !string.IsNullOrWhiteSpace(template.Address))
                                center.Item().AlignCenter().Text(template.Address).FontSize(8).FontColor("#64748B");
                            var contact = string.Join("  |  ", new[] { template.Phone, template.Email }
                                .Where(v => !string.IsNullOrWhiteSpace(v)));
                            if (!string.IsNullOrWhiteSpace(contact))
                                center.Item().AlignCenter().Text(contact).FontSize(8).FontColor("#64748B");
                            if (!string.IsNullOrWhiteSpace(template.RegistrationNumber))
                                center.Item().AlignCenter().Text($"Society Reg. No: {template.RegistrationNumber}")
                                    .FontSize(8).FontColor("#64748B");
                        });

                        header.ConstantItem(110);
                    });
                    col.Item().PaddingTop(8).LineHorizontal(1.5f).LineColor(brandColor);
                });

                page.Content().PaddingTop(20).Column(col =>
                {
                    col.Spacing(4);

                    col.Item().Row(row =>
                    {
                        row.RelativeItem().Text($"Ref: {refNumber}").FontSize(9).FontColor("#64748B");
                        row.RelativeItem().AlignRight().Text($"Date: {appointmentDate}").FontSize(9).FontColor("#64748B");
                    });

                    col.Item().PaddingTop(14).Text("LETTER OF APPOINTMENT")
                        .FontSize(15).Bold().FontColor("#0F172A").LetterSpacing(0.05f);

                    col.Item().PaddingTop(10).Text($"Dear {request.FullName},");

                    col.Item().PaddingTop(6).Text(text =>
                    {
                        text.Span("We are pleased to confirm your appointment as ");
                        text.Span(roleName).SemiBold().FontColor(brandColor);
                        text.Span($" at {orgName}, effective from {joinDate}. Your role and the terms of your ");
                        text.Span("appointment are set out below.");
                    });

                    col.Item().PaddingTop(10).Background("#F8FAFC").Border(0.7f).BorderColor("#E2E8F0").Padding(12)
                        .Column(details =>
                        {
                            details.Spacing(6);
                            DetailRow(details, "Employee Name", request.FullName);
                            if (!string.IsNullOrWhiteSpace(request.UserCode)) DetailRow(details, "Employee Code", request.UserCode!);
                            DetailRow(details, "Role / Designation", roleName);
                            if (!string.IsNullOrWhiteSpace(department)) DetailRow(details, "Department", department!);
                            if (!string.IsNullOrWhiteSpace(reportingManager)) DetailRow(details, "Reporting To", reportingManager!);
                            DetailRow(details, "Date of Joining", joinDate);
                            foreach (var (label, value) in compensationRows)
                                DetailRow(details, label, value);
                        });

                    col.Item().PaddingTop(10).Text(
                        "This appointment is subject to the policies, code of conduct, and guidelines of " +
                        $"{orgName} as may be amended from time to time. You are expected to perform your " +
                        "duties with diligence, integrity, and in a manner consistent with the values of this ministry.");

                    if (!string.IsNullOrWhiteSpace(request.AdditionalTerms))
                    {
                        col.Item().PaddingTop(8).Text("Additional Terms:").SemiBold();
                        col.Item().PaddingTop(2).Text(request.AdditionalTerms!);
                    }

                    col.Item().PaddingTop(10).Text(
                        "Please sign and return a copy of this letter to acknowledge your acceptance of this appointment " +
                        "and its terms.");

                    col.Item().PaddingTop(16).Text("We look forward to your valuable contribution.");
                    col.Item().PaddingTop(18).Text("Yours sincerely,");
                    col.Item().PaddingTop(2).Text($"For {orgName}");

                    col.Item().PaddingTop(30).Row(signatures =>
                    {
                        Signature(signatures.RelativeItem(), "AUTHORIZED SIGNATORY");
                        signatures.ConstantItem(45);
                        Signature(signatures.RelativeItem(), "EMPLOYEE ACKNOWLEDGEMENT");
                    });
                });

                page.Footer().PaddingTop(10).Column(col =>
                {
                    col.Item().LineHorizontal(0.7f).LineColor("#E2E8F0");
                    col.Item().PaddingTop(4).Row(footer =>
                    {
                        footer.RelativeItem().Text(template.FooterText ?? "This is a system-generated appointment letter.")
                            .FontSize(7).FontColor("#94A3B8");
                        footer.ConstantItem(160).AlignRight().Text(refNumber).FontSize(7).FontColor("#94A3B8");
                    });
                    if (template.ShowPageNumbers)
                    {
                        col.Item().PaddingTop(2).AlignRight().Text(t =>
                        {
                            t.DefaultTextStyle(s => s.FontSize(7).FontColor("#94A3B8"));
                            t.CurrentPageNumber();
                            t.Span(" / ");
                            t.TotalPages();
                        });
                    }
                });
            });
        });

        document.GeneratePdf(filePath);
        return request.TenantId.ToString("N") + "/" + fileName;
    }

    private static readonly string[] DayNames =
        { "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday" };

    private static List<(string Label, string Value)> BuildCompensationRows(AppointmentLetterRequest request)
    {
        var rows = new List<(string, string)>();
        var hasMonthly = request.MonthlyFixedAmount is > 0;
        var hasDaily = request.HourlyRate is > 0;

        if (!hasMonthly && !hasDaily)
            return rows;

        var salaryType = request.SalaryType is "Daily" or "Weekly" or "Monthly"
            ? request.SalaryType
            : (hasMonthly ? "Monthly" : "Daily");
        rows.Add(("Salary Type", salaryType));

        if (hasMonthly)
            rows.Add(("Monthly Fixed Amount", $"Rs. {request.MonthlyFixedAmount:N2}"));
        if (hasDaily)
            rows.Add(("Daily Rate", $"Rs. {request.HourlyRate:N2} per day"));
        if (request.Allowances is > 0)
            rows.Add(("Allowances", $"Rs. {request.Allowances:N2}"));
        if (request.Deductions is > 0)
            rows.Add(("Deductions", $"Rs. {request.Deductions:N2}"));

        if (hasMonthly)
        {
            var net = request.MonthlyFixedAmount!.Value + (request.Allowances ?? 0) - (request.Deductions ?? 0);
            rows.Add(("Net Monthly Compensation", $"Rs. {net:N2}"));
        }

        if (request.WeeklyOffDay is >= 0 and <= 6)
            rows.Add(("Weekly Off Day", DayNames[request.WeeklyOffDay.Value]));

        return rows;
    }

    private static void DetailRow(ColumnDescriptor column, string label, string value)
    {
        column.Item().Row(row =>
        {
            row.ConstantItem(150).Text(label).FontSize(8.5f).Bold().FontColor("#64748B");
            row.RelativeItem().Text(value).FontSize(9.5f).SemiBold().FontColor("#0F172A");
        });
    }

    private static void Signature(IContainer container, string label)
    {
        container.Column(column =>
        {
            column.Item().Height(20);
            column.Item().LineHorizontal(0.8f).LineColor("#64748B");
            column.Item().PaddingTop(4).AlignCenter().Text(label)
                .FontSize(7).Bold().FontColor("#475569").LetterSpacing(0.06f);
        });
    }
}
