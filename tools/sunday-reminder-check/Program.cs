using System.Collections;
using System.Reflection;
using Mahima.Api.v3.clean.Controllers;
using Mahima.Api.v3.clean.Dtos;
using Mahima.Api.v3.clean.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

static void Check(bool condition, string name)
{
    if (!condition) throw new Exception(name);
    Console.WriteLine($"PASS: {name}");
}

const BindingFlags PrivateInstance = BindingFlags.NonPublic | BindingFlags.Instance;
const BindingFlags PrivateStatic = BindingFlags.NonPublic | BindingFlags.Static;
var settings = new Dictionary<string, string>();
var service = new MinistryChatAutomationService(null!, null!, new ConfigurationBuilder().Build(),
    NullLogger<MinistryChatAutomationService>.Instance);
var sunday = new DateTime(2026, 9, 27, 8, 0, 0);
var schedules = (IEnumerable)typeof(MinistryChatAutomationService).GetMethod("BuildSchedules", PrivateInstance)!
    .Invoke(service, new object[] { sunday, settings, new List<(string, string)> { ("en", "English") } })!;
var reminder = schedules.Cast<object>().Single(s => (string)s.GetType().GetProperty("Key")!.GetValue(s)! == "sunday-service-reminder");
bool Due(DateTime time) => (bool)typeof(MinistryChatAutomationService).GetMethod("IsDue", PrivateInstance)!
    .Invoke(service, new object[] { time, reminder, settings })!;
Check(Due(sunday), "Sunday at 08:00 is due");
Check(!Due(sunday.AddMinutes(-1)), "Sunday before 08:00 is not due");
Check(!Due(sunday.AddDays(-1)), "Saturday is not due");
Check(!Due(sunday.AddDays(1)), "Monday is not due");
Check(!Due(sunday.AddMinutes(91)), "Delivery window is enforced");
var validate = typeof(MinistryAutomationController).GetMethod("Validate", PrivateStatic)!;
string Validate(MinistryAutomationSettingsDto dto) => (string)validate.Invoke(null, new object[] { dto })!;
Check(Validate(new()) == "", "Default settings validate");
Check(Validate(new() { SundayServiceReminderChannels = new() }) != "", "Empty channel selection rejected");
Check(Validate(new() { SundayServiceReminderChannels = new() { "unknown" } }) != "", "Unknown channels rejected");
Check(Validate(new() { SundayServiceReminderChannels = new() { "whatsapp" } }) != "", "WhatsApp requires configured template");
Check(Validate(new() { SundayServiceReminderChannels = new() { "whatsapp" }, SundayServiceReminderWhatsAppTemplateSid = "HX" + new string('a', 32) }) == "", "Configured WhatsApp validates");
Check(SundayReminderDelivery.Channels(settings).SequenceEqual(new[] { "jai-masih" }), "Existing settings default to Jai Masih only");
var sends = 0;
// Null database/email deliberately verifies that the default never accesses external-channel recipients/providers.
await SundayReminderDelivery.DeliverAsync(null!, null!, Guid.NewGuid(), settings, "Reminder",
    () => { sends++; return Task.CompletedTask; }, (_, send) => send(), default);
Check(sends == 1, "Default delivers only to Jai Masih");
settings[SundayReminderDelivery.ChannelsKey] = "email,sms,email";
Check(SundayReminderDelivery.Channels(settings).SequenceEqual(new[] { "email", "sms" }), "Selected channels retain opt-out and deduplicate");
Console.WriteLine("All Sunday reminder checks passed.");
