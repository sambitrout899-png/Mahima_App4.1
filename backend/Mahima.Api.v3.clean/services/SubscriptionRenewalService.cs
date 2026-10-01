using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Mahima.Api.v3.clean.Services
{
    public class SubscriptionRenewalService : BackgroundService
    {
        private static readonly TimeSpan Interval = TimeSpan.FromHours(6);
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<SubscriptionRenewalService> _logger;
        private readonly IConfiguration _config;

        public SubscriptionRenewalService(IServiceScopeFactory scopeFactory, ILogger<SubscriptionRenewalService> logger, IConfiguration config)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
            _config = config;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await RunOnceAsync(stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Subscription renewal service failed.");
                }

                var configuredInterval = _config["Billing:RenewalCheckMinutes"];
                var delay = int.TryParse(configuredInterval, out var intervalMinutes) && intervalMinutes > 0
                    ? TimeSpan.FromMinutes(intervalMinutes)
                    : Interval;
                await Task.Delay(delay, stoppingToken);
            }
        }

        private async Task RunOnceAsync(CancellationToken ct)
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<MahimaDbContext>();
            var notifications = scope.ServiceProvider.GetRequiredService<INotificationDispatcher>();
            var now = DateTime.UtcNow;
            var renewalWindow = now.AddDays(7);

            var expiredLicenses = await db.TenantModuleLicenses
                .Where(l => l.Status == "active" && l.EndsAtUtc != null && l.EndsAtUtc <= now)
                .ToListAsync(ct);

            foreach (var license in expiredLicenses)
            {
                license.Status = "expired";
                license.UpdatedAtUtc = now;

                await notifications.EnqueueAsync(new NotificationRequest(
                    TenantId: license.TenantId,
                    Kind: "subscription-expired",
                    Subject: $"Mahima subscription expired: {license.ModuleCode}",
                    Message: $"Your \"{license.ModuleCode}\" module subscription expired on {license.EndsAtUtc:yyyy-MM-dd}. Renew it to keep the module active.",
                    TargetGroup: "tenant-admins",
                    DedupeKey: $"expired:{license.Id}:{license.EndsAtUtc:yyyyMMdd}"), ct);
            }

            var renewableLicenses = await db.TenantModuleLicenses
                .AsNoTracking()
                .Where(l =>
                    l.Status == "active" &&
                    l.PriceInr > 0 &&
                    l.EndsAtUtc != null &&
                    l.EndsAtUtc > now &&
                    l.EndsAtUtc <= renewalWindow)
                .ToListAsync(ct);

            foreach (var license in renewableLicenses)
            {
                var hasPendingRenewal = await db.PaymentIntents.AnyAsync(p =>
                    p.TenantId == license.TenantId &&
                    p.ModuleCode == license.ModuleCode &&
                    p.Purpose == "module_renewal" &&
                    p.Status == "pending" &&
                    (p.ExpiresAtUtc == null || p.ExpiresAtUtc > now), ct);

                if (hasPendingRenewal) continue;

                db.PaymentIntents.Add(new PaymentIntent
                {
                    TenantId = license.TenantId,
                    ModuleCode = license.ModuleCode,
                    Purpose = "module_renewal",
                    AmountInr = license.PriceInr,
                    Provider = "upi",
                    Status = "pending",
                    MetadataJson = "{\"reason\":\"auto-renewal\"}",
                    CreatedAtUtc = now,
                    ExpiresAtUtc = license.EndsAtUtc
                });

                await notifications.EnqueueAsync(new NotificationRequest(
                    TenantId: license.TenantId,
                    Kind: "subscription-renewal-due",
                    Subject: $"Mahima subscription renewal due: {license.ModuleCode}",
                    Message: $"Your \"{license.ModuleCode}\" module subscription renews on {license.EndsAtUtc:yyyy-MM-dd}. Complete the payment to avoid interruption.",
                    TargetGroup: "tenant-admins",
                    DedupeKey: $"renewal-due:{license.Id}:{license.EndsAtUtc:yyyyMMdd}"), ct);
            }

            await db.SaveChangesAsync(ct);
            _logger.LogInformation(
                "Subscription renewal scan completed. Expired={ExpiredCount}, RenewalIntentsChecked={RenewableCount}",
                expiredLicenses.Count,
                renewableLicenses.Count);
        }
    }
}
