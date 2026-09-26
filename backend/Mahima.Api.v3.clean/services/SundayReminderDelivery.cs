using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Helpers;
using Microsoft.EntityFrameworkCore;

namespace Mahima.Api.v3.clean.Services;

public static class SundayReminderDelivery
{
    public const string ChannelsKey = "SundayServiceReminderChannels";
    public const string TemplateKey = "SundayServiceReminderWhatsAppTemplateSid";
    public static readonly string[] AllowedChannels = { "jai-masih", "sms", "whatsapp", "email" };

    public static string[] Channels(IReadOnlyDictionary<string, string> settings) =>
        settings.TryGetValue(ChannelsKey, out var value)
            ? value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Distinct().ToArray()
            : new[] { "jai-masih" };

    // The caller checkpoints each successful delivery, so retries do not resend to successful recipients.
    public static async Task DeliverAsync(MahimaDbContext db, IEmailService email, Guid tenantId,
        IReadOnlyDictionary<string, string> settings, string message, Func<Task> sendJaiMasih,
        Func<string, Func<Task>, Task> deliver, CancellationToken ct)
    {
        var channels = Channels(settings);
        if (channels.Contains("jai-masih")) await deliver("jai-masih", sendJaiMasih);
        if (!channels.Any(c => c != "jai-masih")) return;

        var users = await db.Users.AsNoTracking().Where(u => u.TenantId == tenantId &&
                (u.Username == null || (u.Username != "pastor.bot" && !u.Username.StartsWith("pastor.bot."))))
            .Select(u => new { u.Id, u.Email, u.Phone }).ToListAsync(ct);
        foreach (var channel in channels.Where(c => c != "jai-masih"))
        {
            var addresses = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var user in users)
            {
                ct.ThrowIfCancellationRequested();
                var address = (channel == "email" ? user.Email : user.Phone)?.Trim();
                if (string.IsNullOrWhiteSpace(address) || !addresses.Add(address)) continue;
                await deliver($"{channel}:{user.Id:N}", async () =>
                {
                    if (channel == "email")
                        await email.SendAsync(address, "Sunday Church Reminder",
                            System.Net.WebUtility.HtmlEncode(message).Replace("\n", "<br>"), message);
                    else if (channel == "sms")
                    {
                        var result = await SmsHelper.SendSmsAsync(address, message);
                        if (!result.Success) throw new InvalidOperationException(result.ErrorMessage);
                    }
                    else if (channel == "whatsapp")
                    {
                        settings.TryGetValue(TemplateKey, out var template);
                        var result = await SmsHelper.SendWhatsAppTemplateAsync(address, template ?? "",
                            new Dictionary<string, string>());
                        if (!result.Success) throw new InvalidOperationException(result.ErrorMessage);
                    }
                });
            }
        }
    }
}
