using System.Globalization;
using PhoneNumbers;

namespace Mahima.Api.v3.clean.Helpers;

public static class MarketingPhone
{
    private static readonly PhoneNumberUtil Phones = PhoneNumberUtil.GetInstance();
    public sealed record CountryOption(string Code, string Name, string IsdCode);
    public static IReadOnlyList<CountryOption> Countries { get; } = Phones.GetSupportedRegions()
        .Select(code => new CountryOption(code, CountryName(code), "+" + Phones.GetCountryCodeForRegion(code)))
        .OrderBy(x => x.Name).ToArray();

    private static string CountryName(string code)
    {
        try { return new RegionInfo(code).EnglishName; } catch (ArgumentException) { return code; }
    }

    public static string? Region(string? country)
    {
        var value = country?.Trim();
        if (string.Equals(value, "UK", StringComparison.OrdinalIgnoreCase)) return "GB";
        if (string.Equals(value, "USA", StringComparison.OrdinalIgnoreCase)) return "US";
        return Countries.FirstOrDefault(x => string.Equals(x.Code, value, StringComparison.OrdinalIgnoreCase)
            || string.Equals(x.Name, value, StringComparison.OrdinalIgnoreCase))?.Code;
    }

    public static string? Country(string? country) => Countries.FirstOrDefault(x => x.Code == Region(country))?.Name ?? country?.Trim();

    // Metadata validation does not prove that a line is active or has WhatsApp.
    public static string? Normalize(string? raw, string? country, bool mobileOnly = false)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var value = raw.Trim();
        if (value.StartsWith("whatsapp:", StringComparison.OrdinalIgnoreCase)) value = value[9..];
        if (value.StartsWith("00")) value = "+" + value[2..];
        if (!System.Text.RegularExpressions.Regex.IsMatch(value, @"^\+?[0-9\s().-]+$")) return null;
        try
        {
            var phone = Phones.Parse(value, Region(country));
            if (!Phones.IsValidNumber(phone) || phone.HasExtension) return null;
            var type = Phones.GetNumberType(phone);
            if (mobileOnly && type != PhoneNumberType.MOBILE && type != PhoneNumberType.FIXED_LINE_OR_MOBILE) return null;
            return Phones.Format(phone, PhoneNumberFormat.E164);
        }
        catch (NumberParseException) { return null; }
    }

    public static string? IsdCode(string? raw)
    {
        var normalized = Normalize(raw, null);
        return normalized == null ? null : "+" + Phones.Parse(normalized, null).CountryCode;
    }

    public static string NumberType(string? raw, string? country)
    {
        var normalized = Normalize(raw, country);
        return normalized == null ? "unverified" : Phones.GetNumberType(Phones.Parse(normalized, null)).ToString().ToLowerInvariant();
    }
}
