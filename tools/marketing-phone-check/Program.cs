using Mahima.Api.v3.clean.Helpers;

var checks = 0;
void Equal(string? actual, string? expected, string description)
{
    checks++;
    if (actual != expected) throw new Exception($"{description}: expected {expected ?? "null"}, got {actual ?? "null"}");
}
Equal(MarketingPhone.Normalize("96634 31597", "India", true), "+919663431597", "Indian mobile");
Equal(MarketingPhone.Normalize("09663431597", "IN", true), "+919663431597", "Trunk prefix");
Equal(MarketingPhone.Normalize("0091 96634 31597", null, true), "+919663431597", "International prefix");
Equal(MarketingPhone.Normalize("whatsapp:+91 96634 31597", "India"), "+919663431597", "WhatsApp prefix");
Equal(MarketingPhone.Normalize("020 7946 0018", "UK"), "+442079460018", "UK landline");
Equal(MarketingPhone.Normalize("020 7946 0018", "UK", true), null, "Landline blocked for SMS");
Equal(MarketingPhone.Normalize("9663431597", null), null, "No guessed country");
Equal(MarketingPhone.Normalize("+91 9663431597 / 9880219562", "India"), null, "Multiple contacts rejected");
Equal(MarketingPhone.Normalize("12345", "India"), null, "Short invalid number");
Equal(MarketingPhone.Normalize("+91 9663431597 ext 12", "India"), null, "Extensions rejected");
Equal(MarketingPhone.IsdCode("+919663431597"), "+91", "ISD code");
Equal(MarketingPhone.Countries.Single(x => x.Code == "IN").IsdCode, "+91", "Country list");
Equal(MarketingPhone.NumberType("+919663431597", null), "mobile", "Mobile type");
Console.WriteLine($"Passed {checks} international phone checks. No messages sent.");
