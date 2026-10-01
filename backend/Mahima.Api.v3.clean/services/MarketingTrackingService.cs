using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;

namespace Mahima.Api.v3.clean.Services;

public interface IMarketingTrackingService
{
    string CreateToken(Guid outreachId, string action, TimeSpan? lifetime = null);
    bool TryReadToken(string token, string expectedAction, out Guid outreachId);
    string HashIp(string? ip);
}

public sealed class MarketingTrackingService : IMarketingTrackingService
{
    private readonly ITimeLimitedDataProtector _protector;
    private readonly string _salt;

    public MarketingTrackingService(IDataProtectionProvider provider, IConfiguration config)
    {
        _protector = provider.CreateProtector("Mahima.MarketingTracking.v1").ToTimeLimitedDataProtector();
        _salt = config["Marketing:TrackingHashSalt"] ?? config["Jwt:Key"] ?? "mahima-marketing";
    }

    public string CreateToken(Guid outreachId, string action, TimeSpan? lifetime = null)
    {
        var bytes = Encoding.UTF8.GetBytes($"{outreachId:N}|{action.ToLowerInvariant()}");
        return WebEncoders.Base64UrlEncode(_protector.Protect(bytes, lifetime ?? TimeSpan.FromDays(90)));
    }

    public bool TryReadToken(string token, string expectedAction, out Guid outreachId)
    {
        outreachId = Guid.Empty;
        try
        {
            var value = Encoding.UTF8.GetString(_protector.Unprotect(WebEncoders.Base64UrlDecode(token)));
            var parts = value.Split('|', 2);
            return parts.Length == 2 && parts[1].Equals(expectedAction, StringComparison.OrdinalIgnoreCase)
                && Guid.TryParseExact(parts[0], "N", out outreachId);
        }
        catch { return false; }
    }

    public string HashIp(string? ip)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{_salt}|{ip ?? "unknown"}"))).ToLowerInvariant();
}
