using Mahima.Api.v3.clean.Models;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace Mahima.Api.v3.clean.Services;

public class BaptismCertificateService : IBaptismCertificateService
{
    private readonly ITenantPrintTemplateService _printTemplates;
    private readonly string _certificateRoot;

    public BaptismCertificateService(ITenantPrintTemplateService printTemplates, IWebHostEnvironment environment, IConfiguration configuration)
    {
        _printTemplates = printTemplates;
        // Private, non-web-exposed root -- never under wwwroot. Generated certificates are
        // only ever served through BaptismsController's authenticated, tenant-checked action.
        _certificateRoot = Path.GetFullPath(configuration["BaptismCertificates:GeneratedRoot"]
            ?? Path.Combine(environment.ContentRootPath, "App_Data", "baptism-certificates", "generated"));
    }

    public async Task<string> GenerateCertificateAsync(BaptismRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        QuestPDF.Settings.License = LicenseType.Community;

        var certDir = Path.Combine(_certificateRoot, request.TenantId.ToString("N"));
        Directory.CreateDirectory(certDir);
        var fileName = $"BaptismCertificate_{request.Id}_{DateTime.UtcNow:yyyyMMddHHmmss}.pdf";
        var filePath = Path.Combine(certDir, fileName);

        var template = await _printTemplates.GetAsync(request.TenantId);
        var logoBytes = await _printTemplates.LoadLogoAsync(template);
        var brandColor = string.IsNullOrWhiteSpace(template.PrimaryColor) ? "#047857" : template.PrimaryColor;
        var fullName = string.IsNullOrWhiteSpace(request.FullName)
            ? "BAPTISM CANDIDATE"
            : request.FullName.ToUpperInvariant();
        var baptismDate = request.BaptismDate?.ToLocalTime().ToString("dd MMMM yyyy") ?? "________________";
        var baptismPlace = string.IsNullOrWhiteSpace(request.BaptismPlace) ? "________________" : request.BaptismPlace;
        var issuedOn = DateTime.Now.ToString("dd MMMM yyyy");
        const string verse =
            "\"Therefore we are buried with him by baptism into death: that like as Christ was raised up " +
            "from the dead by the glory of the Father, even so we also should walk in newness of life.\"";

        var document = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(PageSizes.A4.Landscape());
                page.Margin(24);
                page.PageColor(Colors.White);

                page.Content()
                    .Border(2).BorderColor(brandColor).Padding(5)
                    .Border(0.75f).BorderColor("#CBD5E1").Padding(26)
                    .Column(col =>
                    {
                        col.Spacing(8);
                        col.Item().Row(header =>
                        {
                            header.ConstantItem(120).Height(62).Element(logo =>
                            {
                                if (logoBytes is { Length: > 0 })
                                    logo.AlignLeft().MaxWidth(105).MaxHeight(58).Image(logoBytes).FitArea();
                            });

                            header.RelativeItem().AlignCenter().Column(center =>
                            {
                                center.Item().AlignCenter().Text(template.OrganizationName.ToUpperInvariant())
                                    .FontSize(18).Bold().FontColor(brandColor).LetterSpacing(0.08f);
                                if (!string.IsNullOrWhiteSpace(template.HeaderText))
                                    center.Item().AlignCenter().Text(template.HeaderText).FontSize(8).FontColor("#64748B");
                                if (template.ShowAddress && !string.IsNullOrWhiteSpace(template.Address))
                                    center.Item().AlignCenter().Text(template.Address).FontSize(8).FontColor("#64748B");
                                var contact = string.Join("  |  ", new[] { template.Phone, template.Email }
                                    .Where(value => !string.IsNullOrWhiteSpace(value)));
                                if (!string.IsNullOrWhiteSpace(contact))
                                    center.Item().AlignCenter().Text(contact).FontSize(8).FontColor("#64748B");
                            });

                            header.ConstantItem(120).AlignRight().Column(reference =>
                            {
                                reference.Item().AlignRight().Text("CERTIFICATE NO.").FontSize(7).Bold().FontColor("#64748B");
                                reference.Item().AlignRight().Text(request.Token ?? $"BAP-{request.Id:000000}")
                                    .FontSize(9).Bold().FontColor(brandColor);
                                reference.Item().PaddingTop(10).AlignRight().Text("DATE ISSUED").FontSize(7).Bold().FontColor("#64748B");
                                reference.Item().AlignRight().Text(issuedOn).FontSize(9).SemiBold();
                            });
                        });

                        col.Item().PaddingVertical(5).LineHorizontal(1).LineColor(brandColor);
                        col.Item().AlignCenter().Text("CERTIFICATE OF BAPTISM")
                            .FontSize(30).Bold().FontColor("#0F172A").LetterSpacing(0.12f);
                        col.Item().AlignCenter().Text("BORN OF WATER AND THE SPIRIT")
                            .FontSize(10).SemiBold().FontColor(brandColor).LetterSpacing(0.18f);
                        col.Item().PaddingTop(9).AlignCenter().Text("THIS IS TO CERTIFY THAT")
                            .FontSize(9).Bold().FontColor("#64748B").LetterSpacing(0.12f);
                        col.Item().PaddingHorizontal(55).AlignCenter().Text(fullName)
                            .FontSize(25).Bold().FontColor(brandColor);
                        col.Item().PaddingHorizontal(110).LineHorizontal(1).LineColor("#94A3B8");

                        col.Item().PaddingTop(7).PaddingHorizontal(60).AlignCenter().Text(text =>
                        {
                            text.DefaultTextStyle(style => style.FontSize(12).LineHeight(1.35f).FontColor("#334155"));
                            text.Span("has publicly confessed faith in our Lord Jesus Christ and, in obedience to His command, ");
                            text.Span("was baptized in the name of the Father, and of the Son, and of the Holy Spirit.")
                                .SemiBold().FontColor("#0F172A");
                        });

                        col.Item().PaddingTop(10).PaddingHorizontal(70).Row(details =>
                        {
                            DetailBox(details.RelativeItem(), "DATE OF BAPTISM", baptismDate);
                            details.ConstantItem(14);
                            DetailBox(details.RelativeItem(), "PLACE OF BAPTISM", baptismPlace);
                        });

                        col.Item().PaddingTop(8).Background("#F0FDFA")
                            .BorderLeft(3).BorderColor(brandColor).Padding(10).Column(scripture =>
                            {
                                scripture.Item().AlignCenter().Text(verse).FontSize(9).Italic().FontColor("#334155");
                                scripture.Item().PaddingTop(3).AlignCenter().Text("ROMANS 6:4")
                                    .FontSize(7).Bold().FontColor(brandColor).LetterSpacing(0.12f);
                            });

                        col.Item().PaddingTop(20).Row(signatures =>
                        {
                            Signature(signatures.RelativeItem(), "BAPTIZED BY / PASTOR");
                            signatures.ConstantItem(45);
                            Signature(signatures.RelativeItem(), "WITNESS / ELDER");
                            signatures.ConstantItem(45);
                            Signature(signatures.RelativeItem(), "CHURCH SEAL");
                        });

                        col.Item().PaddingTop(8).Row(footer =>
                        {
                            footer.RelativeItem().Text(template.FooterText ?? "Issued as an official church record.")
                                .FontSize(7).FontColor("#64748B");
                            footer.ConstantItem(220).AlignRight()
                                .Text($"Internal reference: {request.Token ?? request.Id.ToString()}")
                                .FontSize(7).FontColor("#64748B");
                        });
                    });
            });
        });

        document.GeneratePdf(filePath);
        return request.TenantId.ToString("N") + "/" + fileName;
    }

    private static void DetailBox(IContainer container, string label, string value)
    {
        container.Background("#F8FAFC").Border(0.7f).BorderColor("#CBD5E1").Padding(9).Column(item =>
        {
            item.Item().Text(label).FontSize(7).Bold().FontColor("#64748B");
            item.Item().PaddingTop(3).Text(value).FontSize(11).SemiBold().FontColor("#0F172A");
        });
    }

    private static void Signature(IContainer container, string label)
    {
        container.Column(column =>
        {
            column.Item().Height(18);
            column.Item().LineHorizontal(0.8f).LineColor("#64748B");
            column.Item().PaddingTop(4).AlignCenter().Text(label)
                .FontSize(7).Bold().FontColor("#475569").LetterSpacing(0.08f);
        });
    }
}
