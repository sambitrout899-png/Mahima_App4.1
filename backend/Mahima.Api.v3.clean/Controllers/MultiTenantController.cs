using System;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net;
using System.Data;
using System.IO;
using System.Collections.Generic;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Dtos;
using Mahima.Api.v3.clean.Helpers;
using Mahima.Api.v3.clean.Hubs;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Npgsql;
using NpgsqlTypes;

namespace Mahima.Api.v3.clean.Controllers
{
    [ApiController]
    public class MultiTenantController : ControllerBase
    {
        private readonly MahimaDbContext _db;
        private readonly ITenantContextService _tenantContext;
        private readonly ILicensingService _licensing;
        private readonly IConfiguration _config;
        private readonly IWebHostEnvironment _env;
        private readonly IEmailService _email;
        private readonly IChatService _chat;
        private readonly IHubContext<ChatHub> _hub;
        private readonly IMobilePushNotificationService? _mobilePush;
        private readonly ILogger<MultiTenantController> _logger;
        private readonly IMarketingTrackingService _marketingTracking;
        private const string BillingDaySettingKey = "saas_billing_day";

        public MultiTenantController(
            MahimaDbContext db,
            ITenantContextService tenantContext,
            ILicensingService licensing,
            IConfiguration config,
            IWebHostEnvironment env,
            IEmailService email,
            IChatService chat,
            IHubContext<ChatHub> hub,
            IEnumerable<IMobilePushNotificationService> mobilePushServices,
            ILogger<MultiTenantController> logger,
            IMarketingTrackingService marketingTracking)
        {
            _db = db;
            _tenantContext = tenantContext;
            _licensing = licensing;
            _config = config;
            _env = env;
            _email = email;
            _chat = chat;
            _hub = hub;
            _mobilePush = mobilePushServices?.FirstOrDefault();
            _logger = logger;
            _marketingTracking = marketingTracking;
        }

        private async Task<bool> CurrentTenantIsRootAsync(CancellationToken ct)
        {
            var tenantIdText = User.FindFirstValue("tenant_id");
            if (Guid.TryParse(tenantIdText, out var tenantId))
            {
                return await _db.Tenants
                    .AsNoTracking()
                    .Where(t => t.Id == tenantId)
                    .Select(t => t.IsRootTenant)
                    .FirstOrDefaultAsync(ct);
            }

            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            return tenant?.IsRootTenant == true;
        }

        public record CreateTenantRequest(
            string Name,
            string? Slug,
            string? Domain,
            string? ContactName,
            string? ContactEmail,
            string? ContactPhone,
            string? UserCodePrefix,
            string? AdminUsername,
            string? AdminDisplayName,
            string? AdminEmail,
            string? AdminPhone,
            string? AdminPassword,
            string? CountryCode = "IN");
        public record UpsertModuleRequest(string Code, string Name, string? Description, decimal MonthlyPriceInr, bool IsBaseModule, bool Enabled, int DisplayOrder);
        public record UpsertPackageRequest(Guid? Id, string Code, string Name, string? Description, decimal MonthlyPriceInr, bool Enabled, int DisplayOrder, IReadOnlyList<string>? ModuleCodes, IReadOnlyList<string>? PageKeys, int ContractMonths = 12, decimal EarlyExitPenaltyPercent = 10, bool IsBaseFreePlan = false, decimal StorageLimitGb = 10, long AiTokensIncludedMonthly = 0, decimal StorageOveragePricePerGbInr = 49, decimal AiOveragePricePerMillionTokensInr = 0, decimal AiCreditsIncludedInr = 0, decimal AiOverageMarkupMultiplier = 2.5m);
        public record PublishPackageRequest(DateTime? EffectiveAtUtc);
        public record SubmitPackagePaymentRequest(
            string UpiTransactionNumber,
            string PayerName,
            string? PayerPhone,
            string? PayerEmail,
            decimal AmountInr,
            string? Note);
        public record ReviewPackagePaymentRequest(string? Note);
        private sealed record PackagePaymentRow(
            Guid Id, Guid TenantId, Guid PlanId, string Status, decimal AmountInr,
            string UpiTransactionNumber, string PayerName, string? PayerPhone,
            string? PayerEmail, string? Note, DateTime CreatedAtUtc,
            string? TenantName = null, string? TenantSlug = null, string? PlanName = null);
        public record SubscriptionActionRequest(string Action, Guid? TargetPlanId, int? TargetVersion);
        public record ActivateModuleRequest(
            decimal? PriceInr,
            string? Source,
            DateTime? EndsAtUtc,
            string? ReceiptNumber,
            string? Note,
            string? ApprovedBy);
        public record RevokeModuleRequest(string? Note, string? ApprovedBy);
        public record UpdateTenantStatusRequest(string Status, string? Reason, string? ApprovedBy);
        public record ResetTenantAdminPasswordRequest(string Password, string? Note, string? ApprovedBy);
        public record CreateTenantAdminUserRequest(
            string Username,
            string? DisplayName,
            string? Email,
            string? Phone,
            string Password,
            string? Note,
            string? ApprovedBy);
        public record UpdateTenantProfileRequest(
            string? Name,
            string? Slug,
            string? Domain,
            string? ContactName,
            string? ContactEmail,
            string? ContactPhone,
            string? UserCodePrefix,
            IFormFile? Logo,
            string? CountryCode = null,
            string? WhatsAppUserNotificationTemplateSid = null,
            string? WhatsAppMarketingTemplateSid = null);
        public record LandingConfigRequest(
            string? LogoUrl,
            string? HeroImageUrl,
            string HeroTitle,
            string? HeroSubtitle,
            string? PrimaryColor,
            string? AccentColor,
            string? ContactEmail,
            string? ContactPhone,
            string? Address,
            JsonElement? ServiceTimes,
            JsonElement? SocialLinks,
            JsonElement? Sections,
            bool Published);
        public record BrandingRequest(
            string? LogoUrl,
            string PrimaryColor,
            string AccentColor,
            string NeutralColor,
            string DarkColor,
            string HeadingFont,
            string BodyFont,
            string? ContactEmail,
            string? ContactPhone,
            string? Address,
            JsonElement? SocialLinks);
        public record LandingDraftRequest(
            string HeroTitle,
            string? HeroSubtitle,
            string? HeroImageUrl,
            string? HeroLayout,
            JsonElement? ServiceTimes,
            JsonElement? Sections,
            string? SeoTitle,
            string? SeoDescription,
            string? OgImageUrl);
        public record LandingVisibilityRequest(bool Published);
        public record CreatePaymentIntentRequest(string? Provider, string? UpiVpa, string? UpiPayeeName);
        public record SubmitDonationDetailsRequest(
            string? UpiTransactionNumber,
            string? PayerName,
            string? PayerPhone,
            string? PayerEmail,
            decimal? AmountInr,
            string? Note);

        private static readonly Dictionary<string, string> PackagePageModules = new(StringComparer.OrdinalIgnoreCase)
        {
            ["DASHBOARD"] = "base", ["SUBSCRIPTIONS"] = "base", ["LANDING_PAGE"] = "base",
            ["USERS"] = "base", ["PRAYER_REQUESTS"] = "base", ["SERMONS"] = "base",
            ["TEAMS"] = "base", ["ROLES"] = "base", ["PAGES"] = "base",
            ["SECURITY"] = "base",
            ["CHAT"] = "chat",
            ["TASKS"] = "operations", ["ATTENDANCE"] = "operations", ["PAYROLL"] = "operations",
            ["COSTS"] = "operations", ["ACCOUNTING"] = "operations", ["REPORTS"] = "operations",
            ["AUDIT_TRAIL"] = "operations",
            ["VOLUNTEERS"] = "operations",
            ["PASTOR"] = "care_ministry", ["README"] = "care_ministry", ["MARRIAGE"] = "care_ministry",
            ["BAPTISM"] = "care_ministry", ["COUNSELLING"] = "care_ministry",
            ["EVENTS"] = "care_ministry", ["CHECKIN"] = "care_ministry",
            ["SERVICE_PLANS"] = "care_ministry",
            ["ADMIN_DASHBOARD"] = "admin_tools", ["LIVE_USERS"] = "admin_tools",
            ["MULTITENANT"] = "admin_tools", ["TENANT_DASHBOARD"] = "admin_tools",
            ["SAAS_BILLING"] = "admin_tools", ["LANGUAGES"] = "admin_tools",
            ["APP_DOWNLOADS"] = "base", ["MESSAGE_CENTER"] = "communications",
            ["EMAIL_CLIENT"] = "communications", ["GOOGLE_DRIVE"] = "communications",
            ["SERVER_FILES"] = "communications"
        };
        public record MarkPaymentPaidRequest(string? ProviderPaymentId, string? PayloadJson);
        public record VerifyModulePaymentRequest(string RazorpayOrderId, string RazorpayPaymentId, string RazorpaySignature);
        public record GenerateInvoicesRequest(string? Month, bool ProRata = false, bool ReplaceExisting = false, int? BillingDay = null, Guid? TenantId = null);
        public record DeleteInvoicePeriodRequest(string? Month);
        public record DeleteTenantBillingRequest(Guid TenantId, string? Month);
        public record BillingSettingsRequest(int BillingDay);
        public record ApplyInvoicePaymentRequest(Guid? PaymentIntentId, decimal? AmountInr, string? ProviderPaymentId, string? Note);
        public record ReviewModuleRequest(string? Note, string? ApprovedBy);
        public record PublicRegisterTenantRequest(
            string ChurchName,
            string? Slug,
            string? Domain,
            string? ContactName,
            string? ContactEmail,
            string? ContactPhone,
            string? AdminUsername,
            string? AdminPassword,
            string? UserCodePrefix,
            IFormFile? Logo,
            string? MemberUsername,
            string? MemberPassword,
            string? CountryCode = "IN",
            string? MarketingAttribution = null);

        [AllowAnonymous]
        [HttpGet("/api/public/tenants/{slug}/landing")]
        public async Task<IActionResult> PublicLanding(string slug, CancellationToken ct)
        {
            DisableLandingCache();
            var normalized = NormalizeSlug(slug);
            var tenant = await _db.Tenants
                .AsNoTracking()
                .Include(t => t.LandingConfig)
                .FirstOrDefaultAsync(t => t.Slug == normalized && t.Status == "active", ct);
            if (tenant == null || tenant.LandingConfig?.Published == false) return NotFound();
            var slugBranding = await _db.TenantBrandings.AsNoTracking().FirstOrDefaultAsync(b => b.TenantId == tenant.Id, ct);

            return Ok(new
            {
                tenant = new { tenant.Id, tenant.Name, tenant.Slug, tenant.Domain },
                landing = ToLandingDto(tenant.LandingConfig, slugBranding ?? new TenantBranding { TenantId = tenant.Id })
            });
        }

        [AllowAnonymous]
        [HttpGet("/api/public/tenants")]
        public async Task<IActionResult> PublicTenantDirectory(CancellationToken ct)
        {
            var tenants = await _db.Tenants
                .AsNoTracking()
                .Where(t => t.Status == "active")
                .OrderByDescending(t => t.IsRootTenant)
                .ThenBy(t => t.Name)
                .Select(t => new
                {
                    t.Name,
                    t.Slug,
                    t.Domain,
                    LogoUrl = t.LandingConfig != null && t.LandingConfig.Published && t.Branding != null
                        ? t.Branding.LogoUrl
                        : null
                })
                .Take(1000)
                .ToListAsync(ct);

            return Ok(new { tenants });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpGet("/api/tenants/{slug}/branding")]
        public async Task<IActionResult> TenantBrandingForBuild(string slug, CancellationToken ct)
        {
            var normalized = NormalizeSlug(slug);
            var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Slug == normalized, ct);
            if (tenant == null) return NotFound("Tenant not found.");

            var currentTenant = await _tenantContext.GetCurrentTenantAsync(ct);
            var canManage = currentTenant?.IsRootTenant == true || currentTenant?.Id == tenant.Id;
            if (!canManage) return Forbid();

            var branding = await _db.TenantBrandings.AsNoTracking().FirstOrDefaultAsync(b => b.TenantId == tenant.Id, ct);

            return Ok(new
            {
                tenant.Name,
                tenant.Slug,
                LogoUrl = branding?.LogoUrl,
                PrimaryColor = branding?.PrimaryColor ?? "#0f766e"
            });
        }

        [AllowAnonymous]
        [HttpGet("/api/public/modules")]
        public async Task<IActionResult> PublicModules(CancellationToken ct)
        {
            await _licensing.EnsureCatalogSeededAsync(ct);
            var modules = await _db.ModuleCatalog
                .AsNoTracking()
                .Where(m => m.Enabled)
                .OrderBy(m => m.DisplayOrder)
                .Select(m => new
                {
                    m.Code,
                    m.Name,
                    m.Description,
                    m.MonthlyPriceInr,
                    m.IsBaseModule
                })
                .ToListAsync(ct);
            return Ok(new { modules });
        }

        [AllowAnonymous]
        [HttpGet("/api/public/tenant-by-host")]
        public async Task<IActionResult> PublicTenantByHost([FromQuery] string? host, CancellationToken ct)
        {
            var normalizedHost = NormalizeDomain(host ?? Request.Host.Host);
            if (string.IsNullOrWhiteSpace(normalizedHost)) return NotFound();

            var tenant = await _db.Tenants
                .AsNoTracking()
                .FirstOrDefaultAsync(t =>
                    t.Domain == normalizedHost &&
                    t.Status == "active" &&
                    (t.DomainStatus == "verified" || t.DomainStatus == "active"), ct);
            if (tenant == null) return NotFound();

            return Ok(new
            {
                tenant.Id,
                tenant.Name,
                tenant.Slug,
                tenant.Domain,
                tenant.DomainStatus,
                PublicUrl = BuildTenantPublicUrl(tenant),
                LoginUrl = BuildTenantLoginUrl(tenant)
            });
        }

        [AllowAnonymous]
        [HttpGet("/api/public/domain-check")]
        public async Task<IActionResult> PublicDomainCheck([FromQuery] string? domain, CancellationToken ct)
        {
            var normalizedDomain = NormalizeDomain(domain ?? Request.Query["host"].FirstOrDefault() ?? Request.Host.Host);
            if (string.IsNullOrWhiteSpace(normalizedDomain)) return NotFound();

            var exists = await _db.Tenants
                .AsNoTracking()
                .AnyAsync(t =>
                    t.Domain == normalizedDomain &&
                    t.Status == "active" &&
                    (t.DomainStatus == "verified" || t.DomainStatus == "active"), ct);

            return exists ? Ok(new { allowed = true }) : NotFound(new { allowed = false });
        }

        [AllowAnonymous]
        [HttpPost("/api/public/tenants/register")]
        public async Task<IActionResult> PublicRegisterTenant([FromForm] PublicRegisterTenantRequest dto, CancellationToken ct)
        {
            if (dto == null || string.IsNullOrWhiteSpace(dto.ChurchName))
                return BadRequest(new { message = "Church name is required." });

            if (string.IsNullOrWhiteSpace(dto.ContactEmail))
                return BadRequest(new { message = "Tenant primary email is required." });
            try
            {
                _ = new System.Net.Mail.MailAddress(dto.ContactEmail.Trim());
            }
            catch (FormatException)
            {
                return BadRequest(new { message = "Enter a valid tenant primary email address." });
            }

            if (string.IsNullOrWhiteSpace(dto.AdminUsername))
                return BadRequest(new { message = "At least one tenant admin is required. Enter an admin username." });

            var adminPassword = string.IsNullOrWhiteSpace(dto.AdminPassword) ? "NewPass@123" : dto.AdminPassword.Trim();
            var memberPassword = string.IsNullOrWhiteSpace(dto.MemberPassword) ? "Member@123" : dto.MemberPassword.Trim();
            if (adminPassword.Length < 6 || memberPassword.Length < 6)
                return BadRequest(new { message = "Passwords must be at least 6 characters." });

            await _licensing.EnsureCatalogSeededAsync(ct);
            var slug = NormalizeSlug(string.IsNullOrWhiteSpace(dto.Slug) ? dto.ChurchName : dto.Slug);
            if (await _db.Tenants.AnyAsync(t => t.Slug == slug, ct))
                return Conflict(new { message = "This church URL slug is already taken. Please choose another slug." });
            var requestedDomain = NormalizeDomain(dto.Domain);
            if (!string.IsNullOrWhiteSpace(requestedDomain) &&
                await _db.Tenants.AnyAsync(t => t.Domain == requestedDomain, ct))
                return Conflict(new { message = "This church domain is already configured for another tenant." });
            var userCodePrefix = NormalizeUserCodePrefix(dto.UserCodePrefix, slug);

            var adminUsername = NormalizeUsername(dto.AdminUsername);
            var memberUsername = NormalizeUsername(string.IsNullOrWhiteSpace(dto.MemberUsername) ? $"{slug}-member" : dto.MemberUsername);
            if (string.IsNullOrWhiteSpace(adminUsername))
                return BadRequest(new { message = "Enter a valid admin username." });
            if (adminUsername.Equals(memberUsername, StringComparison.OrdinalIgnoreCase))
                return BadRequest(new { message = "Admin username and member username must be different." });

            var strategy = _db.Database.CreateExecutionStrategy();
            try
            {
                return await strategy.ExecuteAsync<IActionResult>(async () =>
                {
                    await using var tx = await _db.Database.BeginTransactionAsync(ct);
                    if (await _db.Tenants.AnyAsync(t => t.Slug == slug, ct))
                        return Conflict(new { message = "This church URL slug is already taken. Please choose another slug." });

                    var tenant = new Tenant
                    {
                        Name = dto.ChurchName.Trim(),
                        Slug = slug,
                        Domain = requestedDomain,
                        DomainStatus = string.IsNullOrWhiteSpace(requestedDomain) ? "none" : "pending",
                        DomainVerificationToken = string.IsNullOrWhiteSpace(requestedDomain) ? null : NewDomainVerificationToken(),
                        ContactName = NormalizeNullable(dto.ContactName),
                        ContactEmail = NormalizeNullable(dto.ContactEmail),
                        ContactPhone = NormalizeNullable(dto.ContactPhone),
                        CountryCode = NormalizeCountryCode(dto.CountryCode),
                        UserCodePrefix = userCodePrefix,
                        Status = "active",
                    };

                    _db.Tenants.Add(tenant);
                    await _db.SaveChangesAsync(ct);

                    await _licensing.ActivateModuleAsync(tenant.Id, LicensingService.BaseModule, 0, "beta-free", null, ct);

                string? logoUrl;
                try
                {
                    logoUrl = await SaveTenantLogoAsync(dto.Logo, slug, ct);
                }
                catch (InvalidOperationException ex)
                {
                    return BadRequest(new { message = ex.Message });
                }
                var seedServiceTimes = JsonSerializer.Serialize(new[]
                {
                    new { day = "Sunday", title = "Worship Service", time = "10:00 AM", note = "Update from Landing Page." },
                    new { day = "Wednesday", title = "Prayer Meeting", time = "7:00 PM", note = "Update from Landing Page." }
                });
                var seedSections = JsonSerializer.Serialize(new object[]
                {
                    new
                    {
                        type = "feature-grid",
                        eyebrow = "Welcome",
                        title = "Start your church page",
                        subtitle = "Edit this content from the Landing Page module.",
                        items = new[]
                        {
                            new { title = "Prayer", text = "Receive and manage prayer requests." },
                            new { title = "Sermons", text = "Publish sermons for members." },
                            new { title = "Teams", text = "Organize your ministry groups." }
                        }
                    }
                });
                var branding = new TenantBranding
                {
                    TenantId = tenant.Id,
                    LogoUrl = logoUrl,
                    ContactEmail = tenant.ContactEmail,
                    ContactPhone = tenant.ContactPhone,
                };
                _db.TenantBrandings.Add(branding);
                var landingConfig = new TenantLandingConfig
                {
                    TenantId = tenant.Id,
                    HeroTitle = tenant.Name,
                    HeroSubtitle = $"Welcome to {tenant.Name}.",
                    ServiceTimesJson = seedServiceTimes,
                    SectionsJson = seedSections,
                    Published = true
                };
                _db.TenantLandingConfigs.Add(landingConfig);
                _db.TenantLandingDrafts.Add(new TenantLandingDraft
                {
                    TenantId = tenant.Id,
                    HeroTitle = landingConfig.HeroTitle,
                    HeroSubtitle = landingConfig.HeroSubtitle,
                    ServiceTimesJson = seedServiceTimes,
                    SectionsJson = seedSections,
                });
                await _db.SaveChangesAsync(ct);

                    // A church contact number may already belong to the platform owner or
                    // another user. The database intentionally has a global normalized-phone
                    // unique index, so keep the number on the tenant contact record and only
                    // copy it to the admin user when it is not already used.
                    var adminUserPhone = await UserPhoneAlreadyExistsAsync(tenant.ContactPhone, ct)
                        ? null
                        : tenant.ContactPhone;
                    var adminUserId = await CreateTenantUserAsync(
                    tenant.Id,
                    adminUsername,
                    NormalizeNullable(dto.ContactName) ?? $"{tenant.Name} Admin",
                    NormalizeNullable(dto.ContactEmail),
                    adminUserPhone,
                    adminPassword,
                    "admin",
                    ct);
                var memberUserId = await CreateTenantUserAsync(
                    tenant.Id,
                    memberUsername,
                    $"{tenant.Name} Member",
                    null,
                    null,
                    memberPassword,
                    "member",
                    ct);
                await _db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);

                    await RecordMarketingRegistrationAsync(dto.MarketingAttribution, tenant, ct);

                    var publicUrl = BuildTenantPublicUrl(tenant);
                    var loginUrl = BuildTenantLoginUrl(tenant);
                    var emailSent = true;
                    string? emailWarning = null;
                    try
                    {
                        static string Encode(string? value) => WebUtility.HtmlEncode(value ?? string.Empty);
                        var subject = $"Your {tenant.Name} church space is ready";
                        var html = $@"<!doctype html>
<html><body style=""margin:0;background:#f4f7f6;font-family:Arial,sans-serif;color:#17212b"">
<div style=""max-width:680px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #dce8e4"">
  <div style=""background:#064e3b;color:#fff;padding:28px""><h1 style=""margin:0;font-size:25px"">Your church space is ready</h1><p style=""margin:8px 0 0;color:#d1fae5"">Welcome to Mahima for Churches.</p></div>
  <div style=""padding:28px""><h2 style=""margin-top:0"">Tenancy details</h2>
    <p><strong>Church:</strong> {Encode(tenant.Name)}<br><strong>Tenant ID:</strong> {tenant.Id}<br><strong>Church slug:</strong> {Encode(tenant.Slug)}<br><strong>User code prefix:</strong> {Encode(tenant.UserCodePrefix)}<br><strong>Primary contact:</strong> {Encode(tenant.ContactName ?? "-")}<br><strong>Primary email:</strong> {Encode(tenant.ContactEmail ?? "-")}<br><strong>Contact phone:</strong> {Encode(tenant.ContactPhone ?? "-")}</p>
    <p><a href=""{Encode(loginUrl)}"" style=""display:inline-block;background:#f59e0b;color:#111827;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:8px"">Sign in to your church space</a></p>
    <p><strong>Church URL:</strong> <a href=""{Encode(publicUrl)}"">{Encode(publicUrl)}</a><br><strong>Login URL:</strong> <a href=""{Encode(loginUrl)}"">{Encode(loginUrl)}</a></p>
    <h2>Administrator user</h2><p><strong>Username:</strong> {Encode(adminUsername)}<br><strong>Password:</strong> {Encode(adminPassword)}</p>
    <h2>Default member user</h2><p><strong>Username:</strong> {Encode(memberUsername)}<br><strong>Password:</strong> {Encode(memberPassword)}</p>
    <p style=""margin-top:24px;padding:14px;background:#fff7ed;border-radius:8px;color:#9a3412""><strong>Security:</strong> Sign in and change these initial passwords immediately. Do not forward this email.</p>
  </div>
</div></body></html>";
                        var text = $@"Your {tenant.Name} church space is ready.

Tenant ID: {tenant.Id}
Church slug: {tenant.Slug}
User code prefix: {tenant.UserCodePrefix}
Primary contact: {tenant.ContactName ?? "-"}
Primary email: {tenant.ContactEmail}
Contact phone: {tenant.ContactPhone ?? "-"}
Church URL: {publicUrl}
Login URL: {loginUrl}

Administrator username: {adminUsername}
Administrator password: {adminPassword}

Default member username: {memberUsername}
Default member password: {memberPassword}

Sign in and change these initial passwords immediately. Do not forward this email.";
                        await _email.SendAsync(tenant.ContactEmail!, subject, html, text);
                    }
                    catch (Exception emailException)
                    {
                        emailSent = false;
                        emailWarning = emailException is MailKit.Security.AuthenticationException
                            ? "The church space was created, but SMTP rejected the configured sender credentials. The administrator must verify the Email settings and resend the welcome details."
                            : emailException is InvalidOperationException
                                ? $"The church space was created, but email is not configured on the server. {emailException.Message}"
                                : "The church space was created, but the SMTP server could not deliver the welcome email. The administrator should check the API email log and SMTP connectivity.";
                        _logger.LogError(emailException, "Tenant {TenantId} was created but its welcome email to {Email} failed", tenant.Id, tenant.ContactEmail);
                    }

                    return Ok(new
                    {
                    message = emailSent
                        ? $"{tenant.Name} was created successfully. Tenancy and user details were emailed to {tenant.ContactEmail}."
                        : $"{tenant.Name} was created successfully.",
                    emailSent,
                    emailWarning,
                    tenant = new
                    {
                        tenant.Id,
                        tenant.Name,
                        tenant.Slug,
                        tenant.Domain,
                        tenant.DomainStatus,
                        tenant.DomainVerificationToken,
                        publicUrl,
                        loginUrl,
                        dns = BuildDomainSetupInstructions(tenant)
                    },
                    landing = ToLandingDto(landingConfig, branding),
                    adminUser = new { id = adminUserId, username = adminUsername, password = adminPassword },
                    memberUser = new { id = memberUserId, username = memberUsername, password = memberPassword },
                    freeModules = new[] { LicensingService.BaseModule }
                    });
                });
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                _logger.LogWarning(ex, "Tenant registration conflict for slug {Slug}; constraint {Constraint}", slug, ex.ConstraintName);
                return Conflict(new
                {
                    message = ex.ConstraintName?.Contains("phone", StringComparison.OrdinalIgnoreCase) == true
                        ? "That mobile number is already linked to an existing user. Use a different contact number."
                        : "A church or user with one of these details already exists. Please change the church URL or usernames."
                });
            }
            catch (IOException ex)
            {
                _logger.LogError(ex, "Tenant registration logo upload failed for slug {Slug}", slug);
                return StatusCode(StatusCodes.Status503ServiceUnavailable, new
                {
                    message = "The church logo could not be saved. Please verify the server upload-folder permissions or register without a logo."
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Tenant registration failed for slug {Slug}", slug);
                return StatusCode(StatusCodes.Status500InternalServerError, new
                {
                    message = "Church registration failed on the server. Check the API log entry for this church URL."
                });
            }
        }

        private async Task RecordMarketingRegistrationAsync(string? token, Tenant tenant, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(token) || !_marketingTracking.TryReadToken(token, "registration", out var outreachId)) return;
            try
            {
                var outreach = await _db.MarketingOutreach
                    .Include(x => x.Prospect)
                    .SingleOrDefaultAsync(x => x.Id == outreachId, ct);
                if (outreach?.Prospect == null) return;

                var alreadyRecorded = await _db.MarketingCommunicationEvents.AnyAsync(
                    x => x.OutreachId == outreachId && x.EventType == "registered", ct);
                if (alreadyRecorded) return;
                _db.MarketingCommunicationEvents.Add(new MarketingCommunicationEvent
                {
                    OutreachId = outreachId,
                    EventType = "registered",
                    MetadataJson = JsonSerializer.Serialize(new { tenantId = tenant.Id, tenant.Name, tenant.Slug })
                });

                var lead = await _db.MarketingLeads.SingleOrDefaultAsync(x => x.ProspectId == outreach.ProspectId, ct);
                if (lead == null)
                {
                    lead = new MarketingLead
                    {
                        ProspectId = outreach.ProspectId,
                        Stage = "qualified",
                        Score = 75,
                        QualificationNotes = $"Church registration completed as tenant {tenant.Name} ({tenant.Slug}).",
                        NextActionAtUtc = DateTime.UtcNow
                    };
                    _db.MarketingLeads.Add(lead);
                }
                else
                {
                    lead.Stage = lead.Stage is "won" or "lost" ? lead.Stage : "qualified";
                    lead.Score = Math.Max(lead.Score, 75);
                    lead.QualificationNotes = $"Church registration completed as tenant {tenant.Name} ({tenant.Slug}).";
                    lead.NextActionAtUtc = DateTime.UtcNow;
                    lead.UpdatedAtUtc = DateTime.UtcNow;
                }

                _db.AdminNotifications.Add(new AdminNotification
                {
                    TenantId = Guid.Parse("00000000-0000-0000-0000-000000000001"),
                    Type = "MarketingRegistrationCompleted",
                    Message = $"{outreach.Prospect.OrganizationName} completed church registration as {tenant.Name}.",
                    Data = JsonSerializer.Serialize(new { outreachId, outreach.ProspectId, tenantId = tenant.Id, tenant.Slug })
                });
                await _db.SaveChangesAsync(ct);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Church {TenantId} was registered, but marketing attribution could not be recorded.", tenant.Id);
            }
        }

        [AllowAnonymous]
        [HttpGet("/api/public/landing/current")]
        public async Task<IActionResult> PublicLandingForCurrentDomain(CancellationToken ct)
        {
            DisableLandingCache();
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound();
            if (tenant.IsRootTenant != true &&
                !string.Equals(tenant.Status, "active", StringComparison.OrdinalIgnoreCase))
                return NotFound();

            var landing = await _db.TenantLandingConfigs
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.TenantId == tenant.Id, ct);

            if (landing?.Published == false) return NotFound();
            var currentBranding = await _db.TenantBrandings.AsNoTracking().FirstOrDefaultAsync(b => b.TenantId == tenant.Id, ct);

            return Ok(new
            {
                tenant = new { tenant.Id, tenant.Name, tenant.Slug, tenant.Domain },
                landing = ToLandingDto(landing ?? new TenantLandingConfig { TenantId = tenant.Id, HeroTitle = tenant.Name }, currentBranding ?? new TenantBranding { TenantId = tenant.Id })
            });
        }

        [Authorize]
        [HttpGet("/api/tenants/current/entitlements")]
        public async Task<IActionResult> CurrentEntitlements(CancellationToken ct)
        {
            await EnsurePackagePublishingTablesAsync(ct);
            await EnsureTenantModuleRequestsTableAsync(ct);
            try
            {
                await _licensing.EnsureCatalogSeededAsync(ct);
            }
            catch (Exception ex)
            {
                // Subscription discovery must remain available even if optional
                // catalogue repair cannot run against an older production schema.
                _logger.LogWarning(ex, "Catalogue repair was skipped while loading current tenant entitlements.");
            }
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound("Tenant not found.");
            await RestoreReplacedAddOnsAsync(tenant.Id, ct);
            await RepairStaleAddOnSubscriptionsAsync(tenant.Id, ct);
            var landing = await _db.TenantLandingConfigs
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.TenantId == tenant.Id, ct);
            var entitlementsBranding = await _db.TenantBrandings
                .AsNoTracking()
                .FirstOrDefaultAsync(b => b.TenantId == tenant.Id, ct);

            var availablePlanIds = await _db.SubscriptionPlans.AsNoTracking()
                .Where(p => p.Enabled && p.LifecycleStatus == "published").Select(p => p.Id).ToListAsync(ct);
            var availableSources = availablePlanIds.Select(PackageLicenseSource).ToArray();

            var modules = await _db.ModuleCatalog
                .AsNoTracking()
                .Where(m => m.Enabled)
                .OrderBy(m => m.DisplayOrder)
                .Select(m => new
                {
                    m.Code,
                    m.Name,
                    m.Description,
                    m.MonthlyPriceInr,
                    m.IsBaseModule,
                    pendingRequest = _db.TenantModuleRequests.Any(r =>
                        r.TenantId == tenant.Id &&
                        r.ModuleCode == m.Code &&
                        r.Status == "pending"),
                    licensed = m.IsBaseModule || _db.TenantModuleLicenses.Any(l =>
                        l.TenantId == tenant.Id &&
                        l.ModuleCode == m.Code &&
                        l.Status == "active" &&
                        (!l.Source.StartsWith("plan:") || availableSources.Contains(l.Source)) &&
                        l.StartsAtUtc <= DateTime.UtcNow &&
                        (l.EndsAtUtc == null || l.EndsAtUtc > DateTime.UtcNow))
                })
                .ToListAsync(ct);
            var publishedRows = await _db.SubscriptionPlanPublications.AsNoTracking()
                .Where(publication => publication.Plan!.Enabled && publication.Plan.LifecycleStatus == "published" && publication.ExpiredAtUtc == null)
                .Where(publication => publication.Version ==
                    _db.SubscriptionPlanPublications.Where(other => other.PlanId == publication.PlanId).Max(other => other.Version))
                .OrderBy(publication => publication.Plan!.DisplayOrder)
                .Select(publication => new { publication.PlanId, publication.Version, publication.DefinitionJson })
                .ToListAsync(ct);
            var subscriptions = await _db.TenantSubscriptions.AsNoTracking()
                .Where(s => s.TenantId == tenant.Id)
                .OrderByDescending(s => s.StartsAtUtc)
                .Select(s => new { s.Id, s.PlanId, s.AppliedPlanVersion, s.ContractEndsAtUtc, s.Status })
                .ToListAsync(ct);
            var latestSubscriptions = subscriptions
                .GroupBy(s => s.PlanId)
                .ToDictionary(group => group.Key, group => group.First());
            var activePackageSources = (await _db.TenantModuleLicenses.AsNoTracking()
                    .Where(license => license.TenantId == tenant.Id && license.Status == "active" &&
                                      license.StartsAtUtc <= DateTime.UtcNow &&
                                      (license.EndsAtUtc == null || license.EndsAtUtc > DateTime.UtcNow) &&
                                      license.Source.StartsWith("plan:"))
                    .Select(license => license.Source)
                    .ToListAsync(ct))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            var pendingUpgrades = await ReadPendingPackageUpgradesAsync(tenant.Id, ct);
            var paymentRequests = (await ReadPackagePaymentRequestsAsync(tenant.Id, null, ct))
                .GroupBy(request => request.PlanId)
                .ToDictionary(group => group.Key, group => group.OrderByDescending(request => request.CreatedAtUtc).First());
            static (decimal Price, decimal StorageGb, decimal AiCredits)? CanonicalPackagePricing(string? code, string? name)
            {
                var normalizedCode = (code ?? string.Empty).Trim().ToLowerInvariant();
                var normalizedName = (name ?? string.Empty).Trim().ToLowerInvariant();
                if (normalizedCode is "chat" or "jai-masih-chat" || normalizedName.Contains("chat")) return (1249m, 10m, 25m);
                if (normalizedCode == "operations" || normalizedName.Contains("operations")) return (1999m, 20m, 20m);
                if (normalizedCode is "care" or "care_ministry" || normalizedName.Contains("care ministry")) return (1499m, 10m, 100m);
                if (normalizedCode is "administration" or "admin_tools" || normalizedName.Contains("administration") || normalizedName.Contains("administrative")) return (1749m, 10m, 20m);
                if (normalizedCode == "communications" || normalizedName.Contains("communications")) return (1499m, 25m, 30m);
                if (normalizedCode == "mahima-complete" || normalizedName == "mahima complete") return (6249m, 100m, 250m);
                return null;
            }
            var packages = publishedRows.Select(row =>
            {
                using var document = JsonDocument.Parse(row.DefinitionJson);
                var root = document.RootElement;
                var code = root.GetProperty("Code").GetString();
                var name = root.GetProperty("Name").GetString();
                var canonicalPricing = CanonicalPackagePricing(code, name);
                return new
                {
                    Id = row.PlanId,
                    Code = code,
                    Name = name,
                    Description = root.TryGetProperty("Description", out var description) ? description.GetString() : null,
                    MonthlyPriceInr = canonicalPricing?.Price ?? root.GetProperty("MonthlyPriceInr").GetDecimal(),
                    Enabled = root.GetProperty("Enabled").GetBoolean(),
                    StorageLimitGb = canonicalPricing?.StorageGb ?? (root.TryGetProperty("StorageLimitGb", out var storageLimit) ? storageLimit.GetDecimal() : 10),
                    AiTokensIncludedMonthly = root.TryGetProperty("AiTokensIncludedMonthly", out var includedTokens) ? includedTokens.GetInt64() : 0,
                    StorageOveragePricePerGbInr = canonicalPricing.HasValue ? 49m : (root.TryGetProperty("StorageOveragePricePerGbInr", out var storageOverage) ? storageOverage.GetDecimal() : 0),
                    AiOveragePricePerMillionTokensInr = root.TryGetProperty("AiOveragePricePerMillionTokensInr", out var aiOverage) ? aiOverage.GetDecimal() : 0,
                    AiCreditsIncludedInr = canonicalPricing?.AiCredits ?? (root.TryGetProperty("AiCreditsIncludedInr", out var aiCredits) ? aiCredits.GetDecimal() : 0),
                    AiOverageMarkupMultiplier = canonicalPricing.HasValue ? 2.5m : (root.TryGetProperty("AiOverageMarkupMultiplier", out var aiMarkup) ? aiMarkup.GetDecimal() : 2.5m),
                    Version = row.Version,
                    Active = latestSubscriptions.GetValueOrDefault(row.PlanId)?.Status == "active" &&
                             activePackageSources.Contains(PackageLicenseSource(row.PlanId)),
                    SubscriptionId = latestSubscriptions.GetValueOrDefault(row.PlanId)?.Id,
                    SubscriptionStatus = latestSubscriptions.GetValueOrDefault(row.PlanId)?.Status,
                    CurrentVersion = latestSubscriptions.GetValueOrDefault(row.PlanId)?.AppliedPlanVersion,
                    ContractEndsAtUtc = latestSubscriptions.GetValueOrDefault(row.PlanId)?.ContractEndsAtUtc,
                    UpgradePending = pendingUpgrades.Any(upgrade => upgrade.planId == row.PlanId && upgrade.version == row.Version),
                    PaymentRequestId = paymentRequests.GetValueOrDefault(row.PlanId)?.Id,
                    PaymentStatus = paymentRequests.GetValueOrDefault(row.PlanId)?.Status,
                    AddOnState =
                        latestSubscriptions.GetValueOrDefault(row.PlanId)?.Status == "active" &&
                        activePackageSources.Contains(PackageLicenseSource(row.PlanId)) ? "active" :
                        latestSubscriptions.GetValueOrDefault(row.PlanId)?.Status == "suspended" ? "suspended" :
                        paymentRequests.GetValueOrDefault(row.PlanId)?.Status == "pending" ? "payment_pending" :
                        paymentRequests.GetValueOrDefault(row.PlanId)?.Status == "rejected" ? "payment_rejected" :
                        "available"
                };
            }).Where(package => package.Enabled && package.MonthlyPriceInr > 0).ToList();

            return Ok(new
            {
                tenant = new
                {
                    tenant.Id,
                    tenant.Name,
                    tenant.Slug,
                    tenant.CountryCode,
                    logoUrl = entitlementsBranding?.LogoUrl,
                    heroTitle = landing?.HeroTitle
                },
                modules,
                packages
            });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/tenants/current/packages/{planId:guid}/payment-requests")]
        public async Task<IActionResult> SubmitPackagePayment(
            Guid planId,
            [FromBody] SubmitPackagePaymentRequest dto,
            CancellationToken ct)
        {
            await EnsurePackagePublishingTablesAsync(ct);
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound(new { message = "Tenant not found." });
            if (string.IsNullOrWhiteSpace(dto.UpiTransactionNumber) || string.IsNullOrWhiteSpace(dto.PayerName))
                return BadRequest(new { message = "UPI transaction number and payer name are required." });
            var plan = await _db.SubscriptionPlans.AsNoTracking()
                .FirstOrDefaultAsync(p => p.Id == planId && p.LifecycleStatus == "published" && p.Enabled, ct);
            if (plan == null) return NotFound(new { message = "Published add-on not found." });
            if (await HasActivePackageLicenseAsync(tenant.Id, planId, ct))
                return Conflict(new { message = "This add-on is already active." });
            var staleSubscriptions = await _db.TenantSubscriptions
                .Where(subscription =>
                    subscription.TenantId == tenant.Id &&
                    subscription.PlanId == planId &&
                    subscription.Status == "active")
                .ToListAsync(ct);
            foreach (var stale in staleSubscriptions)
            {
                stale.Status = "revoked";
                stale.EndsAtUtc = DateTime.UtcNow;
                stale.UpdatedAtUtc = DateTime.UtcNow;
            }
            if (staleSubscriptions.Count > 0) await _db.SaveChangesAsync(ct);
            if ((await ReadPackagePaymentRequestsAsync(tenant.Id, "pending", ct)).Any(request => request.PlanId == planId))
                return Conflict(new { message = "A donation transaction for this add-on is already awaiting SambitR verification." });
            if (dto.AmountInr <= 0)
                return BadRequest(new { message = "Donation amount must be greater than zero." });

            var result = await InsertPackagePaymentRequestAsync(
                tenant.Id, planId, dto with
                {
                    UpiTransactionNumber = dto.UpiTransactionNumber.Trim(),
                    PayerName = dto.PayerName.Trim()
                }, ct);
            if (!result.created)
                return Conflict(new { message = "This UPI transaction number has already been submitted." });
            var rootEmailSent = await TrySendPackagePaymentSubmittedEmailAsync(
                tenant, plan, dto, result.id, ct);
            return Ok(new
            {
                result.id,
                tenantId = tenant.Id,
                planId,
                planName = plan.Name,
                status = "pending",
                addOnState = "payment_pending",
                rootEmailSent,
                message = "Donation transaction recorded. SambitR has been notified for verification; the add-on remains unavailable until approval."
            });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpGet("/api/platform/package-payment-requests")]
        public async Task<IActionResult> PackagePaymentRequests([FromQuery] string? status, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsurePackagePublishingTablesAsync(ct);
            var rows = await ReadPackagePaymentRequestsAsync(null, NormalizeNullable(status), ct);
            return Ok(rows.OrderByDescending(row => row.CreatedAtUtc));
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/package-payment-requests/{requestId:guid}/approve")]
        public async Task<IActionResult> ApprovePackagePayment(
            Guid requestId,
            [FromBody] ReviewPackagePaymentRequest? dto,
            CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsurePackagePublishingTablesAsync(ct);
            var request = (await ReadPackagePaymentRequestsAsync(null, null, ct))
                .FirstOrDefault(row => row.Id == requestId);
            if (request == null) return NotFound(new { message = "Payment request not found." });
            if (request.Status != "pending") return Conflict(new { message = $"Payment request is already {request.Status}." });

            var activation = await ActivatePackageCore(request.TenantId, request.PlanId, ct);
            if (activation is ObjectResult result && result.StatusCode is >= 400)
                return activation;
            await ReviewPackagePaymentRequestAsync(
                requestId, "approved", dto?.Note, User.Identity?.Name ?? "SambitR", ct);
            var tenantEmailSent = await TrySendPackagePaymentDecisionEmailAsync(request, true, dto?.Note, ct);
            return Ok(new
            {
                requestId, status = "approved", addOnState = "active",
                request.TenantId, request.PlanId, activated = true, tenantEmailSent,
                message = "Payment verified. The add-on is active and the tenant administrators have been notified."
            });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/package-payment-requests/{requestId:guid}/reject")]
        public async Task<IActionResult> RejectPackagePayment(
            Guid requestId,
            [FromBody] ReviewPackagePaymentRequest? dto,
            CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsurePackagePublishingTablesAsync(ct);
            await ReviewPackagePaymentRequestAsync(
                requestId, "rejected", dto?.Note, User.Identity?.Name ?? "SambitR", ct);
            var request = (await ReadPackagePaymentRequestsAsync(null, null, ct))
                .FirstOrDefault(row => row.Id == requestId);
            var tenantEmailSent = request != null &&
                                  await TrySendPackagePaymentDecisionEmailAsync(request, false, dto?.Note, ct);
            return Ok(new
            {
                requestId, status = "rejected", addOnState = "payment_rejected", tenantEmailSent,
                message = "Payment rejected. The tenant administrators have been notified and may submit a new transaction."
            });
        }

        [Authorize]
        [HttpPost("/api/tenants/current/packages/{planId:guid}/versions/{version:int}/decision")]
        public async Task<IActionResult> DecidePackageUpgrade(Guid planId, int version, [FromQuery] bool accept, CancellationToken ct)
        {
            await EnsurePackagePublishingTablesAsync(ct);
            if (!await _db.SubscriptionPlans.AnyAsync(p => p.Id == planId && p.Enabled && p.LifecycleStatus == "published", ct))
                return Conflict(new { message = "This package is no longer available." });
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound(new { message = "Tenant not found." });
            var subscription = await _db.TenantSubscriptions
                .FirstOrDefaultAsync(s => s.TenantId == tenant.Id && s.PlanId == planId && s.Status == "active", ct);
            if (subscription == null) return NotFound(new { message = "Active subscription not found." });
            if (!await PackageUpgradeIsPendingAsync(tenant.Id, planId, version, ct))
                return Conflict(new { message = "No pending version approval was found." });

            if (accept)
            {
                var plan = await _db.SubscriptionPlans.AsNoTracking().Include(p => p.Modules).ThenInclude(pm => pm.Module)
                    .FirstAsync(p => p.Id == planId, ct);
                var publication = await _db.SubscriptionPlanPublications.AsNoTracking()
                    .FirstOrDefaultAsync(p => p.PlanId == planId && p.Version == version && p.ExpiredAtUtc == null, ct);
                if (publication == null) return NotFound(new { message = "Package version not found." });
                using var document = JsonDocument.Parse(publication.DefinitionJson);
                var definition = document.RootElement;
                var moduleCodes = definition.GetProperty("modules").EnumerateArray()
                    .Select(item => item.GetString()).Where(code => !string.IsNullOrWhiteSpace(code)).Cast<string>().ToList();
                var catalog = await _db.ModuleCatalog.Where(m => moduleCodes.Contains(m.Code)).ToDictionaryAsync(m => m.Code, ct);
                plan.MonthlyPriceInr = definition.GetProperty("MonthlyPriceInr").GetDecimal();
                plan.Modules = moduleCodes.Where(catalog.ContainsKey).Select(code => new SubscriptionPlanModule
                {
                    PlanId = plan.Id, ModuleCode = code, Module = catalog[code]
                }).ToList();
                await ApplyPublishedPackageAsync(subscription, plan, DateTime.UtcNow, version, ct);
                await _db.SaveChangesAsync(ct);
                await RecalculateCurrentOpenInvoiceAsync(tenant.Id, ct);
                await _db.SaveChangesAsync(ct);
            }
            await CompletePackageUpgradeRequestAsync(tenant.Id, planId, version, accept ? "accepted" : "declined", ct);
            return Ok(new { planId, version, decision = accept ? "accepted" : "declined", appliedImmediately = accept });
        }

        [Authorize]
        [HttpPost("/api/tenants/current/subscriptions/{subscriptionId:guid}/action")]
        public async Task<IActionResult> ChangeCurrentSubscription(Guid subscriptionId, [FromBody] SubscriptionActionRequest dto, CancellationToken ct)
        {
            await EnsurePackagePublishingTablesAsync(ct);
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound(new { message = "Tenant not found." });
            var subscription = await _db.TenantSubscriptions.Include(s => s.Plan)
                .FirstOrDefaultAsync(s => s.Id == subscriptionId && s.TenantId == tenant.Id, ct);
            if (subscription == null) return NotFound(new { message = "Subscription not found." });
            var action = NormalizeCode(dto.Action);
            if (action is not ("resume" or "suspend" or "terminate"))
                return BadRequest(new { message = "Add-ons are independent. Supported actions are resume, suspend and terminate; version upgrades are handled on the same add-on." });
            var now = DateTime.UtcNow;
            if (action == "resume")
            {
                if (subscription.Plan?.LifecycleStatus != "published" || !subscription.Plan.Enabled)
                    return Conflict(new { message = "This package is no longer available." });
                if (subscription.Status != "suspended")
                    return Conflict(new { message = "Only a suspended subscription can be resumed." });
                var resumePlan = await _db.SubscriptionPlans.AsNoTracking().Include(p => p.Modules).ThenInclude(pm => pm.Module)
                    .FirstAsync(p => p.Id == subscription.PlanId, ct);
                subscription.Status = "active";
                subscription.EndsAtUtc = null;
                subscription.UpdatedAtUtc = now;
                await ApplyPublishedPackageAsync(subscription, resumePlan, now, resumePlan.PublishedVersion, ct);
                await _db.SaveChangesAsync(ct);
                await RecalculateCurrentOpenInvoiceAsync(tenant.Id, ct);
                await _db.SaveChangesAsync(ct);
                return Ok(new { subscription.Id, subscription.Status, action, penaltyInr = 0 });
            }
            var withinContract = subscription.ContractEndsAtUtc.HasValue && subscription.ContractEndsAtUtc > now;
            var penaltyApplies = action == "terminate";
            var penalty = withinContract && penaltyApplies
                ? Math.Round((subscription.Plan?.MonthlyPriceInr ?? 0) * Math.Max(1, subscription.Plan?.ContractMonths ?? 12)
                    * (subscription.Plan?.EarlyExitPenaltyPercent ?? 10) / 100m, 2)
                : 0;
            subscription.Status = action == "suspend" ? "suspended" : "terminated";
            subscription.EndsAtUtc = now;
            subscription.UpdatedAtUtc = now;
            await EndPackageLicensesAsync(subscription, now, ct);
            await _db.SaveChangesAsync(ct);
            if (penalty > 0) await AddEarlyExitPenaltyAsync(tenant.Id, subscription.Plan!, penalty, action, ct);
            return Ok(new { subscription.Id, subscription.Status, penaltyInr = penalty, penaltyPercent = subscription.Plan?.EarlyExitPenaltyPercent ?? 0 });
        }

        [Authorize]
        [HttpPost("/api/tenants/current/modules/{moduleCode}/beta-enable")]
        public async Task<IActionResult> BetaEnableCurrentTenantModule(string moduleCode, CancellationToken ct)
        {
            await _licensing.EnsureCatalogSeededAsync(ct);
            await EnsureTenantModuleRequestsTableAsync(ct);
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound(new { message = "Tenant not found." });

            var code = NormalizeCode(moduleCode);
            var module = await _db.ModuleCatalog.AsNoTracking().FirstOrDefaultAsync(m => m.Code == code && m.Enabled, ct);
            if (module == null) return NotFound(new { message = "Module not found." });

            if (module.IsBaseModule)
                return Ok(new { tenantId = tenant.Id, moduleCode = code, status = "active", message = "Base module is already active." });

            var alreadyLicensed = await _licensing.HasModuleAsync(tenant.Id, code, ct);
            if (alreadyLicensed)
                return Ok(new { tenantId = tenant.Id, moduleCode = code, status = "active", message = "Module is already active." });

            var existing = await _db.TenantModuleRequests
                .FirstOrDefaultAsync(r => r.TenantId == tenant.Id && r.ModuleCode == code && r.Status == "pending", ct);
            if (existing != null)
                return Ok(new { tenantId = tenant.Id, moduleCode = code, status = "pending", requestId = existing.Id, message = "Request already sent to Mahima admin." });

            var requesterId = GetCurrentUserId();
            var requester = requesterId == Guid.Empty
                ? null
                : await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == requesterId, ct);

            var request = new TenantModuleRequest
            {
                TenantId = tenant.Id,
                ModuleCode = code,
                RequestedByUserId = requesterId == Guid.Empty ? null : requesterId,
                RequestedByName = requester?.DisplayName ?? requester?.Username,
                RequestedByEmail = requester?.Email,
                Status = "pending",
                RequestedAtUtc = DateTime.UtcNow
            };
            _db.TenantModuleRequests.Add(request);
            await _db.SaveChangesAsync(ct);

            var sambit = await FindSambitAsync(ct);
            await AddModuleRequestNotificationAsync(request, tenant, module, sambit?.Id, ct);
            request.NotificationEmailSent = await TrySendModuleRequestEmailAsync(request, tenant, module);
            request.JaiMasihMessageSent = await TrySendModuleRequestChatAsync(request, requesterId, sambit?.Id);
            await _db.SaveChangesAsync(ct);

            return Ok(new
            {
                tenantId = tenant.Id,
                moduleCode = code,
                status = "pending",
                requestId = request.Id,
                message = "Request sent to Mahima admin for approval."
            });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpGet("/api/platform/modules")]
        public async Task<IActionResult> Modules(CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await _licensing.EnsureCatalogSeededAsync(ct);
            var modules = await _db.ModuleCatalog.AsNoTracking()
                .Where(m => m.Enabled)
                .OrderBy(m => m.DisplayOrder)
                .ToListAsync(ct);
            return Ok(modules);
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/modules")]
        public async Task<IActionResult> UpsertModule([FromBody] UpsertModuleRequest dto, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            if (string.IsNullOrWhiteSpace(dto.Code) || string.IsNullOrWhiteSpace(dto.Name))
                return BadRequest("code and name are required.");

            var code = NormalizeCode(dto.Code);
            var module = await _db.ModuleCatalog.FirstOrDefaultAsync(m => m.Code == code, ct);
            if (module == null)
            {
                module = new ModuleCatalogItem { Code = code, CreatedAtUtc = DateTime.UtcNow };
                _db.ModuleCatalog.Add(module);
            }

            module.Name = dto.Name.Trim();
            module.Description = dto.Description;
            module.MonthlyPriceInr = Math.Max(0, dto.MonthlyPriceInr);
            module.IsBaseModule = dto.IsBaseModule;
            module.Enabled = dto.Enabled;
            module.DisplayOrder = dto.DisplayOrder;
            module.UpdatedAtUtc = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(module);
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpGet("/api/platform/packages")]
        public async Task<IActionResult> Packages(CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsurePackagePublishingTablesAsync(ct);
            var pageRows = await ReadPackagePageRowsAsync(ct);
            var pagesByPlan = pageRows.GroupBy(row => row.planId)
                .ToDictionary(group => group.Key, group => group.Select(row => row.pageKey).ToArray());
            var plans = await _db.SubscriptionPlans.AsNoTracking()
                .Where(p => p.LifecycleStatus != "deleted")
                .Include(p => p.Modules).ThenInclude(pm => pm.Module)
                .OrderBy(p => p.DisplayOrder).ThenBy(p => p.Name)
                .ToListAsync(ct);
            return Ok(plans.Select(p => new
            {
                p.Id, p.Code, p.Name, p.Description, p.MonthlyPriceInr, p.Enabled,
                p.DisplayOrder, p.PublishedVersion, p.PublishedAtUtc, p.LifecycleStatus,
                p.ContractMonths, p.EarlyExitPenaltyPercent, p.IsBaseFreePlan,
                p.StorageLimitGb, p.AiTokensIncludedMonthly, p.StorageOveragePricePerGbInr,
                p.AiOveragePricePerMillionTokensInr,
                p.AiCreditsIncludedInr, p.AiOverageMarkupMultiplier,
                status = p.LifecycleStatus,
                moduleCodes = p.Modules.OrderBy(m => m.Module?.DisplayOrder).Select(m => m.ModuleCode),
                pageKeys = pagesByPlan.GetValueOrDefault(p.Id, Array.Empty<string>())
            }));
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpGet("/api/platform/package-pages")]
        public async Task<IActionResult> PackagePages(CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            var titles = await _db.Pages.AsNoTracking()
                .Where(page => PackagePageModules.Keys.Contains(page.Key))
                .ToDictionaryAsync(page => page.Key, page => page.Title, StringComparer.OrdinalIgnoreCase, ct);
            return Ok(PackagePageModules.Select(pair => new
            {
                key = pair.Key,
                title = titles.GetValueOrDefault(pair.Key) ?? HumanizePageKey(pair.Key),
                moduleCode = pair.Value
            }).OrderBy(page => page.moduleCode).ThenBy(page => page.title));
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/packages")]
        public async Task<IActionResult> UpsertPackage([FromBody] UpsertPackageRequest dto, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsurePackagePublishingTablesAsync(ct);
            if (string.IsNullOrWhiteSpace(dto.Code) || string.IsNullOrWhiteSpace(dto.Name))
                return BadRequest(new { message = "Package code and name are required." });
            if (dto.MonthlyPriceInr < 0)
                return BadRequest(new { message = "Package price cannot be negative." });
            if (dto.StorageLimitGb <= 0 || dto.AiTokensIncludedMonthly < 0 || dto.StorageOveragePricePerGbInr < 0 || dto.AiOveragePricePerMillionTokensInr < 0 || dto.AiCreditsIncludedInr < 0 || dto.AiOverageMarkupMultiplier < 1)
                return BadRequest(new { message = "Storage must be positive and AI token/overage values cannot be negative." });
            if (dto.IsBaseFreePlan && (dto.MonthlyPriceInr != 0 || dto.StorageLimitGb != 10))
                return BadRequest(new { message = "Essentials must remain free with a 10 GB data-growth limit." });

            var code = NormalizeCode(dto.Code);
            var plan = dto.Id.HasValue
                ? await _db.SubscriptionPlans.Include(p => p.Modules).FirstOrDefaultAsync(p => p.Id == dto.Id.Value, ct)
                : await _db.SubscriptionPlans.Include(p => p.Modules).FirstOrDefaultAsync(p => p.Code == code, ct);
            if (plan == null)
            {
                plan = new SubscriptionPlan { Id = Guid.NewGuid(), Code = code, CreatedAtUtc = DateTime.UtcNow };
                _db.SubscriptionPlans.Add(plan);
            }
            else if (plan.LifecycleStatus == "deleted")
                return Conflict(new { message = "This package has been deleted." });
            else if (plan.PublishedVersion > 0 && plan.LifecycleStatus != "draft")
                return Conflict(new { message = "Expire the published version and open a new draft before editing." });
            else if (!string.Equals(plan.Code, code, StringComparison.OrdinalIgnoreCase) &&
                     await _db.SubscriptionPlans.AnyAsync(p => p.Id != plan.Id && p.Code == code, ct))
                return Conflict(new { message = "Another package already uses this code." });

            var requestedCodes = (dto.ModuleCodes ?? Array.Empty<string>())
                .Select(NormalizeCode).Where(c => !string.IsNullOrWhiteSpace(c)).Distinct().ToList();
            var validCodes = await _db.ModuleCatalog.Where(m => requestedCodes.Contains(m.Code)).Select(m => m.Code).ToListAsync(ct);
            if (validCodes.Count != requestedCodes.Count)
                return BadRequest(new { message = "One or more package modules do not exist." });
            var requestedPageKeys = (dto.PageKeys ?? Array.Empty<string>())
                .Select(key => (key ?? "").Trim().ToUpperInvariant()).Where(key => key.Length > 0).Distinct().ToList();
            if (requestedPageKeys.Any(key => !PackagePageModules.TryGetValue(key, out var moduleCode) || !validCodes.Contains(moduleCode)))
                return BadRequest(new { message = "Every selected page must belong to an included package module." });

            plan.Code = code;
            plan.Name = dto.Name.Trim();
            plan.Description = NormalizeNullable(dto.Description);
            plan.MonthlyPriceInr = dto.MonthlyPriceInr;
            plan.IsBaseFreePlan = dto.IsBaseFreePlan;
            plan.StorageLimitGb = dto.IsBaseFreePlan ? 10 : dto.StorageLimitGb;
            plan.AiTokensIncludedMonthly = dto.AiTokensIncludedMonthly;
            plan.StorageOveragePricePerGbInr = dto.StorageOveragePricePerGbInr;
            plan.AiOveragePricePerMillionTokensInr = dto.AiOveragePricePerMillionTokensInr;
            plan.AiCreditsIncludedInr = dto.AiCreditsIncludedInr;
            plan.AiOverageMarkupMultiplier = dto.AiOverageMarkupMultiplier;
            plan.Enabled = dto.Enabled;
            plan.DisplayOrder = dto.DisplayOrder;
            plan.ContractMonths = Math.Clamp(dto.ContractMonths, 1, 60);
            plan.EarlyExitPenaltyPercent = Math.Clamp(dto.EarlyExitPenaltyPercent, 0, 100);
            plan.LifecycleStatus = "draft";
            plan.UpdatedAtUtc = DateTime.UtcNow;
            _db.SubscriptionPlanModules.RemoveRange(plan.Modules.Where(m => !validCodes.Contains(m.ModuleCode)));
            foreach (var moduleCode in validCodes.Where(c => plan.Modules.All(m => m.ModuleCode != c)))
                plan.Modules.Add(new SubscriptionPlanModule { PlanId = plan.Id, ModuleCode = moduleCode });
            await _db.SaveChangesAsync(ct);
            await ReplacePackagePagesAsync(plan.Id, requestedPageKeys, ct);
            return Ok(new { plan.Id, plan.Code, plan.Name, plan.PublishedVersion, plan.LifecycleStatus, moduleCodes = validCodes, pageKeys = requestedPageKeys });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpDelete("/api/platform/packages/{planId:guid}")]
        public async Task<IActionResult> DeleteDraftPackage(Guid planId, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsurePackagePublishingTablesAsync(ct);
            var plan = await _db.SubscriptionPlans.FirstOrDefaultAsync(p => p.Id == planId, ct);
            if (plan == null) return NotFound(new { message = "Package not found." });
            if (plan.LifecycleStatus == "deleted") return NoContent();
            if (plan.LifecycleStatus != "expired" && !(plan.LifecycleStatus == "draft" && plan.PublishedVersion == 0))
                return Conflict(new { message = "Only an expired package or an unpublished draft can be deleted." });
            await RetirePackageAsync(plan, "deleted", ct);
            await _db.SaveChangesAsync(ct);
            return NoContent();
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/packages/{planId:guid}/expire")]
        public async Task<IActionResult> ExpirePackage(Guid planId, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsurePackagePublishingTablesAsync(ct);
            var plan = await _db.SubscriptionPlans.FirstOrDefaultAsync(p => p.Id == planId, ct);
            if (plan == null) return NotFound(new { message = "Package not found." });
            if (plan.LifecycleStatus != "published" && plan.LifecycleStatus != "expired")
                return Conflict(new { message = "Only a published package can be expired." });
            await RetirePackageAsync(plan, "expired", ct);
            await _db.SaveChangesAsync(ct);
            return Ok(new { plan.Id, plan.LifecycleStatus, plan.PublishedVersion });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/packages/{planId:guid}/new-draft")]
        public async Task<IActionResult> ReopenPackageDraft(Guid planId, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsurePackagePublishingTablesAsync(ct);
            var plan = await _db.SubscriptionPlans.FirstOrDefaultAsync(p => p.Id == planId, ct);
            if (plan == null) return NotFound(new { message = "Package not found." });
            if (plan.LifecycleStatus != "expired")
                return Conflict(new { message = "Expire the current published version before opening a new draft." });
            plan.LifecycleStatus = "draft";
            plan.Enabled = true;
            plan.UpdatedAtUtc = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { plan.Id, plan.LifecycleStatus, nextVersion = plan.PublishedVersion + 1 });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/packages/{planId:guid}/publish")]
        public async Task<IActionResult> PublishPackage(Guid planId, [FromBody] PublishPackageRequest? dto, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsurePackagePublishingTablesAsync(ct);
            var plan = await _db.SubscriptionPlans.Include(p => p.Modules).ThenInclude(pm => pm.Module)
                .FirstOrDefaultAsync(p => p.Id == planId, ct);
            if (plan == null) return NotFound(new { message = "Package not found." });
            if (!plan.Modules.Any()) return BadRequest(new { message = "Add at least one module before publishing." });
            if (plan.LifecycleStatus != "draft") return Conflict(new { message = "Only a draft package can be published." });

            var effectiveAt = dto?.EffectiveAtUtc?.ToUniversalTime() ?? DateTime.UtcNow;
            if (effectiveAt > DateTime.UtcNow.AddMinutes(5))
                return BadRequest(new { message = "Future-dated publication is not supported yet." });
            var version = plan.PublishedVersion + 1;
            var pageKeys = (await ReadPackagePageRowsAsync(ct)).Where(row => row.planId == plan.Id).Select(row => row.pageKey).ToArray();
            if (pageKeys.Length == 0) return BadRequest(new { message = "Select at least one individual page before publishing." });
            var definition = JsonSerializer.Serialize(new
            {
                plan.Code, plan.Name, plan.Description, plan.MonthlyPriceInr, plan.Enabled,
                plan.IsBaseFreePlan, plan.StorageLimitGb, plan.AiTokensIncludedMonthly,
                plan.StorageOveragePricePerGbInr, plan.AiOveragePricePerMillionTokensInr,
                plan.AiCreditsIncludedInr, plan.AiOverageMarkupMultiplier,
                modules = plan.Modules.OrderBy(m => m.ModuleCode).Select(m => m.ModuleCode).ToArray(),
                pages = pageKeys.OrderBy(key => key).ToArray()
            });
            _db.SubscriptionPlanPublications.Add(new SubscriptionPlanPublication
            {
                PlanId = plan.Id, Version = version, DefinitionJson = definition,
                EffectiveAtUtc = effectiveAt, PublishedAtUtc = DateTime.UtcNow,
                PublishedByUserId = GetCurrentUserId() == Guid.Empty ? null : GetCurrentUserId()
            });
            plan.PublishedVersion = version;
            plan.PublishedAtUtc = DateTime.UtcNow;
            plan.LifecycleStatus = "published";
            plan.UpdatedAtUtc = DateTime.UtcNow;

            var subscriptions = await _db.TenantSubscriptions
                .Where(s => s.PlanId == plan.Id && s.Status == "active" &&
                            s.StartsAtUtc <= effectiveAt && (s.EndsAtUtc == null || s.EndsAtUtc > effectiveAt))
                .ToListAsync(ct);
            foreach (var subscription in subscriptions)
                await CreatePackageUpgradeRequestAsync(subscription, plan, version, ct);
            await _db.SaveChangesAsync(ct);
            return Ok(new { plan.Id, plan.Code, version, effectiveAtUtc = effectiveAt, tenantsNotified = subscriptions.Count });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/tenants/{tenantId:guid}/packages/{planId:guid}/activate")]
        public async Task<IActionResult> ActivatePackage(Guid tenantId, Guid planId, CancellationToken ct)
        {
            try
            {
                return await ActivatePackageCore(tenantId, planId, ct);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Package activation endpoint failed for tenant {TenantId}, plan {PlanId}",
                    tenantId, planId);
                var detail = ex is DbUpdateException updateException
                    ? updateException.InnerException?.Message ?? updateException.Message
                    : ex.GetBaseException().Message;
                return Problem(
                    title: "Package activation endpoint failed",
                    detail: detail,
                    statusCode: StatusCodes.Status500InternalServerError);
            }
        }

        private async Task<IActionResult> ActivatePackageCore(Guid tenantId, Guid planId, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsurePackagePublishingTablesAsync(ct);
            var tenantExists = await _db.Tenants.AnyAsync(t => t.Id == tenantId, ct);
            if (!tenantExists) return NotFound(new { message = "Tenant not found." });
            var plan = await _db.SubscriptionPlans.AsNoTracking().Include(p => p.Modules).ThenInclude(pm => pm.Module)
                .FirstOrDefaultAsync(p => p.Id == planId && p.Enabled && p.PublishedVersion > 0 && p.LifecycleStatus == "published", ct);
            if (plan == null) return NotFound(new { message = "Published package not found." });
            var publication = await _db.SubscriptionPlanPublications.AsNoTracking()
                .Where(p => p.PlanId == planId && p.ExpiredAtUtc == null)
                .OrderByDescending(p => p.Version)
                .FirstOrDefaultAsync(ct);
            if (publication == null) return Conflict(new { message = "This package has no available published version." });
            using (var document = JsonDocument.Parse(publication.DefinitionJson))
            {
                var definition = document.RootElement;
                if (!definition.GetProperty("Enabled").GetBoolean())
                    return BadRequest(new { message = "This package is not available for activation." });
                var moduleCodes = definition.GetProperty("modules").EnumerateArray()
                    .Select(item => item.GetString()).Where(code => !string.IsNullOrWhiteSpace(code)).Cast<string>().ToList();
                var catalog = await _db.ModuleCatalog.Where(m => moduleCodes.Contains(m.Code)).ToDictionaryAsync(m => m.Code, ct);
                plan.MonthlyPriceInr = definition.GetProperty("MonthlyPriceInr").GetDecimal();
                plan.Modules = moduleCodes.Where(catalog.ContainsKey).Select(code => new SubscriptionPlanModule
                {
                    PlanId = plan.Id, ModuleCode = code, Module = catalog[code]
                }).ToList();
            }
            var now = DateTime.UtcNow;
            var subscription = await _db.TenantSubscriptions
                .OrderByDescending(s => s.CreatedAtUtc)
                .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.PlanId == planId, ct);
            if (subscription == null)
            {
                subscription = new TenantSubscription
                {
                    TenantId = tenantId, PlanId = planId, StartsAtUtc = now, Status = "active",
                    ContractEndsAtUtc = now.AddMonths(Math.Max(1, plan.ContractMonths))
                };
                _db.TenantSubscriptions.Add(subscription);
            }
            else
            {
                subscription.Status = "active";
                subscription.EndsAtUtc = null;
                subscription.ContractEndsAtUtc ??= now.AddMonths(Math.Max(1, plan.ContractMonths));
                subscription.UpdatedAtUtc = now;
            }

            try
            {
                await ApplyPublishedPackageAsync(subscription, plan, now, publication.Version, ct);
                await _db.SaveChangesAsync(ct);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Package activation failed for tenant {TenantId}, plan {PlanId}, version {Version}",
                    tenantId, planId, publication.Version);
                var detail = ex is DbUpdateException updateException
                    ? updateException.InnerException?.Message ?? updateException.Message
                    : ex.Message;
                return Problem(
                    title: "Package activation failed",
                    detail: detail,
                    statusCode: StatusCodes.Status500InternalServerError);
            }

            try
            {
                await RecalculateCurrentOpenInvoiceAsync(tenantId, ct);
                await _db.SaveChangesAsync(ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "Package {PlanId} activated for tenant {TenantId}, but the current invoice could not be recalculated.",
                    planId, tenantId);
                _db.ChangeTracker.Clear();
            }
            return Ok(new { tenantId, planId, version = plan.PublishedVersion, status = "active" });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpGet("/api/platform/tenants")]
        public async Task<IActionResult> Tenants(CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            var tenants = await _db.Tenants
                .AsNoTracking()
                .Include(t => t.Branding)
                .OrderBy(t => t.Name)
                .Select(t => new
                {
                    t.Id,
                    t.Name,
                    t.Slug,
                    t.Domain,
                    t.DomainStatus,
                    t.DomainVerificationToken,
                    t.DomainVerifiedAtUtc,
                    t.DomainLastCheckedAtUtc,
                    t.Status,
            t.IsRootTenant,
                    t.UserCodePrefix,
            t.ContactName,
                    t.ContactEmail,
                    t.ContactPhone,
                    t.CountryCode,
                    t.WhatsAppUserNotificationTemplateSid,
                    t.WhatsAppMarketingTemplateSid,
                    LogoUrl = t.Branding != null ? t.Branding.LogoUrl : null,
                    t.CreatedAtUtc,
                    t.UpdatedAtUtc
                })
                .ToListAsync(ct);

            var countsByTenant = await ReadTenantUserCountsAsync(ct);
            var adminsByTenant = await ReadTenantAdminsAsync(ct);

            return Ok(tenants.Select(t => new
            {
                t.Id,
                t.Name,
                t.Slug,
                t.Domain,
                t.DomainStatus,
                t.DomainVerificationToken,
                t.DomainVerifiedAtUtc,
                t.DomainLastCheckedAtUtc,
                t.Status,
                t.IsRootTenant,
                t.UserCodePrefix,
                t.ContactName,
                t.ContactEmail,
                t.ContactPhone,
                t.CountryCode,
                t.WhatsAppUserNotificationTemplateSid,
                t.WhatsAppMarketingTemplateSid,
                t.LogoUrl,
                t.CreatedAtUtc,
                t.UpdatedAtUtc,
                PublicUrl = BuildTenantPublicUrl(t.Slug, t.Domain),
                LoginUrl = BuildTenantLoginUrl(t.Slug, t.Domain),
                DomainSetup = BuildDomainSetupInstructions(t.Domain, t.DomainStatus, t.DomainVerificationToken),
                UserCounts = countsByTenant.TryGetValue(t.Id, out var counts) ? counts : new TenantUserCounts(),
                AdminUsers = adminsByTenant.TryGetValue(t.Id, out var admins) ? admins : new List<TenantAdminUser>()
            }));
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPut("/api/platform/tenants/{tenantId:guid}")]
        public async Task<IActionResult> UpdateTenantProfile(Guid tenantId, [FromForm] UpdateTenantProfileRequest dto, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            if (dto == null) return BadRequest("tenant profile data is required.");

            var tenant = await _db.Tenants
                .Include(t => t.LandingConfig)
                .Include(t => t.Branding)
                .FirstOrDefaultAsync(t => t.Id == tenantId, ct);
            if (tenant == null) return NotFound("tenant not found.");

            var nextName = NormalizeNullable(dto.Name) ?? tenant.Name;
            if (string.IsNullOrWhiteSpace(nextName)) return BadRequest("name is required.");

            var requestedSlug = NormalizeNullable(dto.Slug);
            var nextSlug = string.IsNullOrWhiteSpace(requestedSlug) ? tenant.Slug : NormalizeSlug(requestedSlug);
            if (!string.Equals(nextSlug, tenant.Slug, StringComparison.OrdinalIgnoreCase) &&
                await _db.Tenants.AnyAsync(t => t.Id != tenantId && t.Slug == nextSlug, ct))
                return Conflict(new { message = "tenant slug already exists." });

            var nextDomain = NormalizeDomain(dto.Domain);
            if (!string.IsNullOrWhiteSpace(nextDomain) &&
                !string.Equals(nextDomain, tenant.Domain, StringComparison.OrdinalIgnoreCase) &&
                await _db.Tenants.AnyAsync(t => t.Id != tenantId && t.Domain == nextDomain, ct))
                return Conflict(new { message = "tenant domain already exists." });

            var now = DateTime.UtcNow;
            tenant.Name = nextName.Trim();
            tenant.Slug = nextSlug;
            var domainChanged = !string.Equals(nextDomain, tenant.Domain, StringComparison.OrdinalIgnoreCase);
            tenant.Domain = nextDomain;
            if (domainChanged)
            {
                tenant.DomainStatus = string.IsNullOrWhiteSpace(nextDomain) ? "none" : "pending";
                tenant.DomainVerificationToken = string.IsNullOrWhiteSpace(nextDomain) ? null : NewDomainVerificationToken();
                tenant.DomainVerifiedAtUtc = null;
                tenant.DomainLastCheckedAtUtc = null;
            }
            tenant.ContactName = NormalizeNullable(dto.ContactName);
            tenant.ContactEmail = NormalizeNullable(dto.ContactEmail);
            tenant.ContactPhone = NormalizeNullable(dto.ContactPhone);
            if (dto.CountryCode != null) tenant.CountryCode = NormalizeCountryCode(dto.CountryCode);
            tenant.UserCodePrefix = NormalizeUserCodePrefix(dto.UserCodePrefix, tenant.Slug);
            tenant.WhatsAppUserNotificationTemplateSid = NormalizeNullable(dto.WhatsAppUserNotificationTemplateSid);
            tenant.WhatsAppMarketingTemplateSid = NormalizeNullable(dto.WhatsAppMarketingTemplateSid);
            tenant.UpdatedAtUtc = now;

            var chatBrand = tenant.CountryCode.Equals("IN", StringComparison.OrdinalIgnoreCase) ? "Jai Masih" : "Praise The Lord";
            var systemChats = await _db.Chats.Where(chat => chat.TenantId == tenant.Id && chat.IsGroup &&
                (chat.Name == "Jai Masih" || chat.Name == "Praise The Lord")).ToListAsync(ct);
            foreach (var systemChat in systemChats) systemChat.Name = chatBrand;

            if (tenant.LandingConfig == null)
            {
                tenant.LandingConfig = new TenantLandingConfig
                {
                    TenantId = tenant.Id,
                    CreatedAtUtc = now,
                    HeroTitle = tenant.Name,
                    Published = true
                };
                _db.TenantLandingConfigs.Add(tenant.LandingConfig);
            }
            if (tenant.Branding == null)
            {
                tenant.Branding = new TenantBranding { TenantId = tenant.Id, CreatedAtUtc = now };
                _db.TenantBrandings.Add(tenant.Branding);
            }

            string? logoUrl = tenant.Branding.LogoUrl;
            if (dto.Logo != null && dto.Logo.Length > 0)
            {
                try
                {
                    logoUrl = await SaveTenantLogoAsync(dto.Logo, tenant.Slug, ct);
                }
                catch (InvalidOperationException ex)
                {
                    return BadRequest(new { message = ex.Message });
                }
                tenant.Branding.LogoUrl = logoUrl;
            }
            tenant.Branding.ContactEmail = tenant.ContactEmail;
            tenant.Branding.ContactPhone = tenant.ContactPhone;
            tenant.Branding.UpdatedAtUtc = now;
            if (string.IsNullOrWhiteSpace(tenant.LandingConfig.HeroTitle))
                tenant.LandingConfig.HeroTitle = tenant.Name;
            tenant.LandingConfig.UpdatedAtUtc = now;

            var approvedBy = User.FindFirstValue(ClaimTypes.Name)
                ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? User.FindFirstValue("sub")
                ?? "root-admin";
            var payloadJson = JsonSerializer.Serialize(new
            {
                tenant = tenant.Slug,
                tenantId,
                tenant.Name,
                tenant.Domain,
                tenant.DomainStatus,
                tenant.DomainVerificationToken,
                tenant.DomainVerifiedAtUtc,
                tenant.DomainLastCheckedAtUtc,
                tenant.ContactName,
                tenant.ContactEmail,
                tenant.ContactPhone,
                tenant.CountryCode,
                tenant.UserCodePrefix,
                tenant.WhatsAppUserNotificationTemplateSid,
                tenant.WhatsAppMarketingTemplateSid,
                logoUrl,
                approvedBy,
                updatedAtUtc = now
            });
            _db.PaymentIntents.Add(new PaymentIntent
            {
                TenantId = tenant.Id,
                Purpose = "tenant_profile_update",
                AmountInr = 0,
                Provider = "root_admin",
                Status = "paid",
                PaidAtUtc = now,
                MetadataJson = payloadJson
            });

            await _db.SaveChangesAsync(ct);
            return Ok(new
            {
                tenant.Id,
                tenant.Name,
                tenant.Slug,
                tenant.Domain,
                tenant.DomainStatus,
                tenant.DomainVerificationToken,
                tenant.DomainVerifiedAtUtc,
                tenant.DomainLastCheckedAtUtc,
                tenant.Status,
                tenant.IsRootTenant,
                tenant.UserCodePrefix,
                tenant.ContactName,
                tenant.ContactEmail,
                tenant.ContactPhone,
                tenant.CountryCode,
                tenant.WhatsAppUserNotificationTemplateSid,
                tenant.WhatsAppMarketingTemplateSid,
                LogoUrl = tenant.Branding.LogoUrl,
                tenant.CreatedAtUtc,
                tenant.UpdatedAtUtc,
                PublicUrl = BuildTenantPublicUrl(tenant),
                LoginUrl = BuildTenantLoginUrl(tenant),
                DomainSetup = BuildDomainSetupInstructions(tenant)
            });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/tenants/{tenantId:guid}/status")]
        public async Task<IActionResult> UpdateTenantStatus(Guid tenantId, [FromBody] UpdateTenantStatusRequest dto, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == tenantId, ct);
            if (tenant == null) return NotFound("tenant not found.");
            if (tenant.IsRootTenant) return BadRequest("root tenant status cannot be changed from this page.");

            var status = NormalizeCode(dto.Status);
            var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "active", "suspended", "expired", "blocked" };
            if (!allowed.Contains(status))
                return BadRequest("status must be active, suspended, expired, or blocked.");

            var reason = NormalizeNullable(dto.Reason);
            var approvedBy = NormalizeNullable(dto.ApprovedBy)
                ?? User.FindFirstValue(ClaimTypes.Name)
                ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? User.FindFirstValue("sub")
                ?? "root-admin";

            tenant.Status = status;
            tenant.UpdatedAtUtc = DateTime.UtcNow;

            var payloadJson = JsonSerializer.Serialize(new
            {
                tenant = tenant.Slug,
                status,
                reason,
                approvedBy,
                changedAtUtc = tenant.UpdatedAtUtc
            });
            var intent = new PaymentIntent
            {
                TenantId = tenant.Id,
                Purpose = "tenant_status",
                AmountInr = 0,
                Provider = "root_admin",
                Status = "paid",
                PaidAtUtc = tenant.UpdatedAtUtc,
                MetadataJson = payloadJson
            };
            _db.PaymentIntents.Add(intent);
            _db.PaymentEvents.Add(new PaymentEvent
            {
                PaymentIntentId = intent.Id,
                EventType = $"tenant_{status}",
                ProviderEventId = tenant.Id.ToString(),
                PayloadJson = payloadJson
            });

            await _db.SaveChangesAsync(ct);
            return Ok(new
            {
                tenant.Id,
                tenant.Name,
                tenant.Slug,
                tenant.Status,
                tenant.UpdatedAtUtc,
                reason,
                approvedBy
            });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/tenants/{tenantId:guid}/domain/verify")]
        public async Task<IActionResult> VerifyTenantDomain(Guid tenantId, CancellationToken ct)
        {
            var currentTenant = await _tenantContext.GetCurrentTenantAsync(ct);
            var canManage = currentTenant?.IsRootTenant == true || currentTenant?.Id == tenantId;
            if (!canManage) return Forbid();

            var tenant = await _db.Tenants.FirstOrDefaultAsync(t => t.Id == tenantId, ct);
            if (tenant == null) return NotFound("tenant not found.");
            if (string.IsNullOrWhiteSpace(tenant.Domain))
                return BadRequest(new { message = "No custom domain is configured for this tenant." });

            tenant.Domain = NormalizeDomain(tenant.Domain);
            tenant.DomainLastCheckedAtUtc = DateTime.UtcNow;

            var resolved = await DomainResolvesToExpectedTargetAsync(tenant.Domain, ct);
            if (!resolved.ok)
            {
                tenant.DomainStatus = "pending";
                tenant.UpdatedAtUtc = DateTime.UtcNow;
                await _db.SaveChangesAsync(ct);
                return BadRequest(new
                {
                    message = resolved.message,
                    tenant.Domain,
                    tenant.DomainStatus,
                    tenant.DomainVerificationToken,
                    DomainSetup = BuildDomainSetupInstructions(tenant)
                });
            }

            tenant.DomainStatus = "verified";
            tenant.DomainVerifiedAtUtc = DateTime.UtcNow;
            tenant.UpdatedAtUtc = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);

            return Ok(new
            {
                tenant.Id,
                tenant.Name,
                tenant.Slug,
                tenant.Domain,
                tenant.DomainStatus,
                tenant.DomainVerifiedAtUtc,
                PublicUrl = BuildTenantPublicUrl(tenant),
                LoginUrl = BuildTenantLoginUrl(tenant),
                DomainSetup = BuildDomainSetupInstructions(tenant)
            });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/tenants/{tenantId:guid}/admins")]
        public async Task<IActionResult> CreateTenantAdminUser(
            Guid tenantId,
            [FromBody] CreateTenantAdminUserRequest dto,
            CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            if (dto == null || string.IsNullOrWhiteSpace(dto.Username))
                return BadRequest("username is required.");
            if (string.IsNullOrWhiteSpace(dto.Password) || dto.Password.Trim().Length < 6)
                return BadRequest("password must be at least 6 characters.");

            var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
            if (tenant == null) return NotFound("tenant not found.");

            var username = NormalizeUsername(dto.Username);
            var email = NormalizeNullable(dto.Email);
            var phone = NormalizeNullable(dto.Phone);
            var displayName = NormalizeNullable(dto.DisplayName) ?? username;
            var password = dto.Password.Trim();

            var duplicateUser = await FindDuplicateTenantUserAsync(tenantId, username, email, ct);
            if (duplicateUser != null)
            {
                var duplicateField = duplicateUser.UsernameMatches && duplicateUser.EmailMatches
                    ? "username and email"
                    : duplicateUser.UsernameMatches ? "username" : "email";
                return Conflict(new
                {
                    code = "tenant_admin_duplicate",
                    field = duplicateField,
                    message = $"This {duplicateField} is already used by {duplicateUser.DisplayName ?? duplicateUser.Username ?? "an existing user"} in this church.",
                    existingUser = new
                    {
                        duplicateUser.Id,
                        duplicateUser.Username,
                        duplicateUser.DisplayName,
                        duplicateUser.Email
                    }
                });
            }

            var userId = await CreateTenantAdminUserAsync(
                tenantId,
                username,
                displayName,
                email,
                phone,
                password,
                ct);

            var approvedBy = NormalizeNullable(dto.ApprovedBy)
                ?? User.FindFirstValue(ClaimTypes.Name)
                ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? User.FindFirstValue("sub")
                ?? "root-admin";
            var note = NormalizeNullable(dto.Note);
            var now = DateTime.UtcNow;
            var payloadJson = JsonSerializer.Serialize(new
            {
                tenant = tenant.Slug,
                userId,
                username,
                displayName,
                email,
                phone,
                note,
                approvedBy,
                createdAtUtc = now
            });

            _db.PaymentIntents.Add(new PaymentIntent
            {
                TenantId = tenantId,
                Purpose = "tenant_admin_user_created",
                AmountInr = 0,
                Provider = "root_admin",
                Status = "paid",
                PaidAtUtc = now,
                MetadataJson = payloadJson
            });
            await _db.SaveChangesAsync(ct);

            var notificationEmailSent = false;
            if (!string.IsNullOrWhiteSpace(email))
            {
                try
                {
                    var loginUrl = BuildTenantLoginUrl(tenant);
                    var safeName = WebUtility.HtmlEncode(displayName);
                    var safeChurch = WebUtility.HtmlEncode(tenant.Name);
                    var safeUsername = WebUtility.HtmlEncode(username);
                    await _email.SendAsync(
                        email,
                        $"Your {tenant.Name} administrator account is ready",
                        $"<p>Dear {safeName},</p><p>Your administrator account for <strong>{safeChurch}</strong> has been created.</p><p>Username: <strong>{safeUsername}</strong></p><p><a href=\"{WebUtility.HtmlEncode(loginUrl)}\">Sign in to Mahima</a></p><p>For security, obtain the initial password directly from your Root Administrator and change it after signing in.</p>",
                        $"Dear {displayName}, your administrator account for {tenant.Name} is ready. Username: {username}. Sign in: {loginUrl}. Obtain the initial password securely from your Root Administrator.");
                    notificationEmailSent = true;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Tenant admin creation email failed for tenant {TenantId}, user {UserId}", tenantId, userId);
                }
            }

            return Ok(new
            {
                tenantId,
                userId,
                username,
                displayName,
                email,
                phone,
                role = "admin",
                initialPassword = password,
                approvedBy,
                note,
                notificationEmailSent,
                createdAtUtc = now
            });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/tenants/{tenantId:guid}/admins/{userId:guid}/reset-password")]
        public async Task<IActionResult> ResetTenantAdminPassword(
            Guid tenantId,
            Guid userId,
            [FromBody] ResetTenantAdminPasswordRequest dto,
            CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            if (dto == null || string.IsNullOrWhiteSpace(dto.Password))
                return BadRequest("password is required.");

            var password = dto.Password.Trim();
            if (password.Length < 6)
                return BadRequest("password must be at least 6 characters.");

            var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
            if (tenant == null) return NotFound("tenant not found.");

            var conn = (NpgsqlConnection)_db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);

            await using var lookup = new NpgsqlCommand(@"
SELECT id, username, displayname, email, role::text
FROM public.users
WHERE id = @user_id
  AND tenant_id = @tenant_id
  AND lower(role::text) IN ('admin', '1')
LIMIT 1;", conn);
            lookup.Parameters.AddWithValue("user_id", NpgsqlDbType.Uuid, userId);
            lookup.Parameters.AddWithValue("tenant_id", NpgsqlDbType.Uuid, tenantId);

            string? username;
            string? displayName;
            string? email;
            await using (var rdr = await lookup.ExecuteReaderAsync(ct))
            {
                if (!await rdr.ReadAsync(ct)) return NotFound("tenant admin user not found.");
                username = rdr["username"] as string;
                displayName = rdr["displayname"] as string;
                email = rdr["email"] as string;
            }

            var passwordHash = new PasswordHasher<object>().HashPassword(null!, password);
            await using var update = new NpgsqlCommand(@"
UPDATE public.users
SET passwordhash = @passwordhash
WHERE id = @user_id
  AND tenant_id = @tenant_id;", conn);
            update.Parameters.AddWithValue("passwordhash", NpgsqlDbType.Text, passwordHash);
            update.Parameters.AddWithValue("user_id", NpgsqlDbType.Uuid, userId);
            update.Parameters.AddWithValue("tenant_id", NpgsqlDbType.Uuid, tenantId);
            var affected = await update.ExecuteNonQueryAsync(ct);
            if (affected == 0) return NotFound("tenant admin user not found.");

            var approvedBy = NormalizeNullable(dto.ApprovedBy)
                ?? User.FindFirstValue(ClaimTypes.Name)
                ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? User.FindFirstValue("sub")
                ?? "root-admin";
            var note = NormalizeNullable(dto.Note);
            var now = DateTime.UtcNow;
            var payloadJson = JsonSerializer.Serialize(new
            {
                tenant = tenant.Slug,
                userId,
                username,
                displayName,
                email,
                note,
                approvedBy,
                resetAtUtc = now
            });

            _db.PaymentIntents.Add(new PaymentIntent
            {
                TenantId = tenantId,
                Purpose = "tenant_admin_password_reset",
                AmountInr = 0,
                Provider = "root_admin",
                Status = "paid",
                PaidAtUtc = now,
                MetadataJson = payloadJson
            });
            await _db.SaveChangesAsync(ct);

            var notificationEmailSent = false;
            if (!string.IsNullOrWhiteSpace(email))
            {
                try
                {
                    var loginUrl = BuildTenantLoginUrl(tenant);
                    var safeName = WebUtility.HtmlEncode(displayName ?? username ?? "Administrator");
                    var safeChurch = WebUtility.HtmlEncode(tenant.Name);
                    await _email.SendAsync(
                        email,
                        $"Your {tenant.Name} password was reset",
                        $"<p>Dear {safeName},</p><p>The password for your <strong>{safeChurch}</strong> administrator account was reset by an authorized administrator.</p><p><a href=\"{WebUtility.HtmlEncode(loginUrl)}\">Sign in to Mahima</a></p><p>For security, obtain the new temporary password directly from your administrator. If you did not expect this change, contact your church administrator immediately.</p>",
                        $"The password for your {tenant.Name} administrator account was reset. Sign in: {loginUrl}. Obtain the temporary password securely from your administrator.");
                    notificationEmailSent = true;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Tenant admin password-reset email failed for tenant {TenantId}, user {UserId}", tenantId, userId);
                }
            }

            return Ok(new
            {
                tenantId,
                userId,
                username,
                displayName,
                email,
                resetAtUtc = now,
                approvedBy,
                note,
                notificationEmailSent
            });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpGet("/api/platform/tenants/{tenantId:guid}/entitlements")]
        public async Task<IActionResult> TenantEntitlements(Guid tenantId, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await _licensing.EnsureCatalogSeededAsync(ct);
            var tenant = await _db.Tenants
                .AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == tenantId, ct);
            if (tenant == null) return NotFound("tenant not found.");

            var now = DateTime.UtcNow;
            var modules = await _db.ModuleCatalog
                .AsNoTracking()
                .Where(m => m.Enabled)
                .OrderBy(m => m.DisplayOrder)
                .Select(m => new
                {
                    m.Code,
                    m.Name,
                    m.Description,
                    m.MonthlyPriceInr,
                    m.IsBaseModule,
                    License = _db.TenantModuleLicenses
                        .Where(l =>
                            l.TenantId == tenantId &&
                            l.ModuleCode == m.Code &&
                            l.Status == "active" &&
                            l.StartsAtUtc <= now &&
                            (l.EndsAtUtc == null || l.EndsAtUtc > now))
                        .OrderByDescending(l => l.UpdatedAtUtc)
                        .Select(l => new
                        {
                            l.Id,
                            l.Status,
                            l.PriceInr,
                            l.Source,
                            l.StartsAtUtc,
                            l.EndsAtUtc,
                            l.ActivatedByPaymentId
                        })
                        .FirstOrDefault()
                })
                .ToListAsync(ct);

            return Ok(new
            {
                tenant = new { tenant.Id, tenant.Name, tenant.Slug, tenant.Status },
                modules = modules.Select(m => new
                {
                    m.Code,
                    m.Name,
                    m.Description,
                    m.MonthlyPriceInr,
                    m.IsBaseModule,
                    licensed = m.IsBaseModule || m.License != null,
                    license = m.License
                })
            });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpGet("/api/platform/module-requests")]
        public async Task<IActionResult> ModuleRequests([FromQuery] string? status = "pending", [FromQuery] Guid? tenantId = null, [FromQuery] int limit = 100, CancellationToken ct = default)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsureTenantModuleRequestsTableAsync(ct);
            limit = Math.Clamp(limit, 1, 500);

            var query = _db.TenantModuleRequests
                .AsNoTracking()
                .Include(r => r.Tenant)
                .Include(r => r.Module)
                .AsQueryable();

            if (tenantId.HasValue && tenantId.Value != Guid.Empty)
                query = query.Where(r => r.TenantId == tenantId.Value);

            var normalizedStatus = NormalizeNullable(status)?.ToLowerInvariant();
            if (!string.IsNullOrWhiteSpace(normalizedStatus))
                query = query.Where(r => r.Status == normalizedStatus);

            var items = await query
                .OrderByDescending(r => r.RequestedAtUtc)
                .Take(limit)
                .Select(r => new
                {
                    r.Id,
                    r.TenantId,
                    TenantName = r.Tenant != null ? r.Tenant.Name : null,
                    TenantSlug = r.Tenant != null ? r.Tenant.Slug : null,
                    r.ModuleCode,
                    ModuleName = r.Module != null ? r.Module.Name : r.ModuleCode,
                    ModulePriceInr = r.Module != null ? r.Module.MonthlyPriceInr : 0,
                    r.RequestedByUserId,
                    r.RequestedByName,
                    r.RequestedByEmail,
                    r.Status,
                    r.AdminNotes,
                    r.RequestedAtUtc,
                    r.ReviewedAtUtc,
                    r.ReviewedByUserId,
                    r.NotificationEmailSent,
                    r.JaiMasihMessageSent
                })
                .ToListAsync(ct);

            return Ok(new { items, total = items.Count });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/module-requests/{requestId:guid}/approve")]
        public async Task<IActionResult> ApproveModuleRequest(Guid requestId, [FromBody] ReviewModuleRequest? dto, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsureBillingTablesAsync(ct);
            await EnsureTenantModuleRequestsTableAsync(ct);

            var request = await _db.TenantModuleRequests
                .Include(r => r.Tenant)
                .Include(r => r.Module)
                .FirstOrDefaultAsync(r => r.Id == requestId, ct);
            if (request == null) return NotFound("module request not found.");
            if (request.Status != "pending") return BadRequest("request is no longer pending.");

            var module = request.Module ?? await _db.ModuleCatalog.AsNoTracking().FirstOrDefaultAsync(m => m.Code == request.ModuleCode, ct);
            if (module == null) return NotFound("module not found.");
            var tenant = request.Tenant ?? await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == request.TenantId, ct);
            if (tenant == null) return NotFound("tenant not found.");

            var reviewerId = GetCurrentUserId();
            var approvedBy = NormalizeNullable(dto?.ApprovedBy)
                ?? User.FindFirstValue(ClaimTypes.Name)
                ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? User.FindFirstValue("sub")
                ?? "root-admin";
            var note = NormalizeNullable(dto?.Note);
            var now = DateTime.UtcNow;
            var payloadJson = JsonSerializer.Serialize(new
            {
                tenant = tenant.Slug,
                tenantId = tenant.Id,
                module = request.ModuleCode,
                requestId = request.Id,
                note,
                approvedBy,
                approvedAtUtc = now
            });

            var intent = new PaymentIntent
            {
                TenantId = request.TenantId,
                Purpose = "module_request_approval",
                ModuleCode = request.ModuleCode,
                AmountInr = module.MonthlyPriceInr,
                Provider = "root_admin_request_approval",
                Status = "paid",
                PaidAtUtc = now,
                MetadataJson = payloadJson
            };
            _db.PaymentIntents.Add(intent);
            _db.PaymentEvents.Add(new PaymentEvent
            {
                PaymentIntentId = intent.Id,
                EventType = "module_request_approved",
                ProviderEventId = request.Id.ToString(),
                PayloadJson = payloadJson
            });
            await _db.SaveChangesAsync(ct);

            await _licensing.ActivateModuleAsync(request.TenantId, request.ModuleCode, module.MonthlyPriceInr, "request_approved", intent.Id, ct);
            await EnsureCurrentMonthBillingForModuleAsync(request.TenantId, request.ModuleCode, module.Name, module.MonthlyPriceInr, intent.Id, ct);

            request.Status = "approved";
            request.AdminNotes = note;
            request.ReviewedAtUtc = now;
            request.ReviewedByUserId = reviewerId == Guid.Empty ? null : reviewerId;
            await _db.SaveChangesAsync(ct);

            return Ok(new { status = "approved", requestId = request.Id, tenantId = request.TenantId, moduleCode = request.ModuleCode, paymentIntentId = intent.Id });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/module-requests/{requestId:guid}/reject")]
        public async Task<IActionResult> RejectModuleRequest(Guid requestId, [FromBody] ReviewModuleRequest? dto, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsureTenantModuleRequestsTableAsync(ct);

            var request = await _db.TenantModuleRequests.FirstOrDefaultAsync(r => r.Id == requestId, ct);
            if (request == null) return NotFound("module request not found.");
            if (request.Status != "pending") return BadRequest("request is no longer pending.");

            request.Status = "rejected";
            request.AdminNotes = NormalizeNullable(dto?.Note);
            request.ReviewedAtUtc = DateTime.UtcNow;
            var reviewerId = GetCurrentUserId();
            request.ReviewedByUserId = reviewerId == Guid.Empty ? null : reviewerId;
            await _db.SaveChangesAsync(ct);

            return Ok(new { status = "rejected", requestId = request.Id, tenantId = request.TenantId, moduleCode = request.ModuleCode });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/tenants")]
        public async Task<IActionResult> CreateTenant([FromBody] CreateTenantRequest dto, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            if (string.IsNullOrWhiteSpace(dto.Name)) return BadRequest("name is required.");
            var initialAdminPassword = string.IsNullOrWhiteSpace(dto.AdminPassword)
                ? "NewPass@123"
                : dto.AdminPassword.Trim();
            if (initialAdminPassword.Length < 6)
                return BadRequest("adminPassword must be at least 6 characters.");

            await _licensing.EnsureCatalogSeededAsync(ct);
            var slug = NormalizeSlug(string.IsNullOrWhiteSpace(dto.Slug) ? dto.Name : dto.Slug);
            if (await _db.Tenants.AnyAsync(t => t.Slug == slug, ct)) return Conflict("tenant slug already exists.");
            var requestedDomain = NormalizeDomain(dto.Domain);
            if (!string.IsNullOrWhiteSpace(requestedDomain) &&
                await _db.Tenants.AnyAsync(t => t.Domain == requestedDomain, ct))
                return Conflict("tenant domain already exists.");
            var adminUsername = NormalizeUsername(string.IsNullOrWhiteSpace(dto.AdminUsername) ? $"{slug}-admin" : dto.AdminUsername);
            var adminEmail = NormalizeNullable(dto.AdminEmail) ?? NormalizeNullable(dto.ContactEmail);

            var tenant = new Tenant
            {
                Name = dto.Name.Trim(),
                Slug = slug,
                Domain = requestedDomain,
                DomainStatus = string.IsNullOrWhiteSpace(requestedDomain) ? "none" : "pending",
                DomainVerificationToken = string.IsNullOrWhiteSpace(requestedDomain) ? null : NewDomainVerificationToken(),
                ContactName = NormalizeNullable(dto.ContactName),
                ContactEmail = NormalizeNullable(dto.ContactEmail),
                ContactPhone = NormalizeNullable(dto.ContactPhone),
                CountryCode = NormalizeCountryCode(dto.CountryCode),
                UserCodePrefix = NormalizeUserCodePrefix(dto.UserCodePrefix, slug),
                Status = "active",
            };

            _db.Tenants.Add(tenant);
            await _db.SaveChangesAsync(ct);

            if (await UserExistsInTenantAsync(tenant.Id, adminUsername, adminEmail, ct))
                return Conflict("admin username or email already exists for this tenant.");

            await _licensing.ActivateModuleAsync(tenant.Id, LicensingService.BaseModule, 0, "base-free", null, ct);
            var seedServiceTimes2 = JsonSerializer.Serialize(new[]
            {
                new { day = "Sunday", title = "Worship Service", time = "10:00 AM", note = "Configure this for your church." },
                new { day = "Wednesday", title = "Prayer Meeting", time = "7:00 PM", note = "Configure this for your church." }
            });
            var seedSections2 = JsonSerializer.Serialize(new object[]
            {
                new
                {
                    type = "story",
                    eyebrow = "Welcome",
                    title = $"Welcome to {tenant.Name}",
                    text = "Write this church's story, pastor welcome, and vision from the Landing Page editor.",
                    imageUrl = ""
                },
                new
                {
                    type = "feature-grid",
                    eyebrow = "Ministry",
                    title = "Ministries",
                    subtitle = "Show the ministries and groups this church offers.",
                    items = new[]
                    {
                        new { title = "Prayer", text = "Prayer support and care." },
                        new { title = "Worship", text = "Weekly worship gatherings." },
                        new { title = "Community", text = "Fellowship and discipleship." }
                    }
                },
                new
                {
                    type = "cta",
                    title = "Plan your visit",
                    text = "Tell visitors what to do next.",
                    buttonLabel = "Member Login",
                    buttonHref = "/#/login"
                }
            });
            var branding = new TenantBranding
            {
                TenantId = tenant.Id,
                ContactEmail = tenant.ContactEmail,
                ContactPhone = tenant.ContactPhone,
            };
            _db.TenantBrandings.Add(branding);
            var landingConfig = new TenantLandingConfig
            {
                TenantId = tenant.Id,
                HeroTitle = tenant.Name,
                HeroSubtitle = $"Welcome to {tenant.Name}.",
                ServiceTimesJson = seedServiceTimes2,
                SectionsJson = seedSections2,
                Published = true
            };
            _db.TenantLandingConfigs.Add(landingConfig);
            _db.TenantLandingDrafts.Add(new TenantLandingDraft
            {
                TenantId = tenant.Id,
                HeroTitle = landingConfig.HeroTitle,
                HeroSubtitle = landingConfig.HeroSubtitle,
                ServiceTimesJson = seedServiceTimes2,
                SectionsJson = seedSections2,
            });
            await _db.SaveChangesAsync(ct);

            var adminDisplayName = NormalizeNullable(dto.AdminDisplayName) ?? NormalizeNullable(dto.ContactName) ?? $"{tenant.Name} Admin";
            var adminPhone = NormalizeNullable(dto.AdminPhone) ?? NormalizeNullable(dto.ContactPhone);
            var adminUserId = await CreateTenantAdminUserAsync(
                tenant.Id,
                adminUsername,
                adminDisplayName,
                adminEmail,
                adminPhone,
                initialAdminPassword,
                ct);
            await _db.SaveChangesAsync(ct);

            return Ok(new
            {
                tenant.Id,
                tenant.Name,
                tenant.Slug,
                tenant.Domain,
                tenant.DomainStatus,
                tenant.DomainVerificationToken,
                tenant.ContactName,
                tenant.ContactEmail,
                tenant.ContactPhone,
                tenant.Status,
                tenant.IsRootTenant,
                tenant.CreatedAtUtc,
                tenant.UpdatedAtUtc,
                PublicUrl = BuildTenantPublicUrl(tenant),
                LoginUrl = BuildTenantLoginUrl(tenant),
                DomainSetup = BuildDomainSetupInstructions(tenant),
                landingConfig = ToLandingDto(landingConfig, branding),
                adminUser = new
                {
                    id = adminUserId,
                    username = adminUsername,
                    displayName = adminDisplayName,
                    email = adminEmail,
                    phone = adminPhone,
                    role = "admin",
                    initialPassword = initialAdminPassword
                }
            });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/tenants/{tenantId:guid}/modules/{moduleCode}/activate")]
        public async Task<IActionResult> ActivateModule(Guid tenantId, string moduleCode, [FromBody] ActivateModuleRequest? dto, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsureBillingTablesAsync(ct);
            dto ??= new ActivateModuleRequest(null, null, null, null, null, null);
            var code = NormalizeCode(moduleCode);
            var module = await _db.ModuleCatalog.AsNoTracking().FirstOrDefaultAsync(m => m.Code == code, ct);
            if (module == null) return NotFound("module not found.");
            var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
            if (tenant == null) return NotFound("tenant not found.");

            var source = NormalizeCode(NormalizeNullable(dto.Source) ?? "admin_override");
            var isPaidActivation = source is "payment" or "manual-receipt" or "manual_receipt" or "paid";
            var price = isPaidActivation ? dto.PriceInr ?? module.MonthlyPriceInr : 0;
            var receipt = NormalizeNullable(dto.ReceiptNumber);
            var note = NormalizeNullable(dto.Note);
            var approvedBy = NormalizeNullable(dto.ApprovedBy)
                ?? User.FindFirstValue(ClaimTypes.Name)
                ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? User.FindFirstValue("sub")
                ?? "root-admin";

            var intent = new PaymentIntent
            {
                TenantId = tenantId,
                Purpose = "module_activation",
                ModuleCode = code,
                AmountInr = Math.Max(0, price),
                Provider = source == "payment" ? "manual_receipt" : source,
                Status = "paid",
                ProviderPaymentId = receipt,
                PaidAtUtc = DateTime.UtcNow,
                MetadataJson = JsonSerializer.Serialize(new
                {
                    tenant = tenant.Slug,
                    module = code,
                    source,
                    receiptNumber = receipt,
                    note,
                    approvedBy,
                    overrideByRootAdmin = true
                })
            };
            _db.PaymentIntents.Add(intent);
            _db.PaymentEvents.Add(new PaymentEvent
            {
                PaymentIntentId = intent.Id,
                EventType = "admin_override",
                ProviderEventId = receipt,
                PayloadJson = intent.MetadataJson ?? "{}"
            });
            await _db.SaveChangesAsync(ct);

            await _licensing.ActivateModuleAsync(tenantId, code, price, source, intent.Id, ct);
            await EnsureCurrentMonthBillingForModuleAsync(tenantId, code, module.Name, price, intent.Id, ct);
            if (dto.EndsAtUtc.HasValue)
            {
                var license = await _db.TenantModuleLicenses
                    .OrderByDescending(l => l.CreatedAtUtc)
                    .FirstOrDefaultAsync(l => l.TenantId == tenantId && l.ModuleCode == code && l.Status == "active", ct);
                if (license != null)
                {
                    license.EndsAtUtc = dto.EndsAtUtc.Value.ToUniversalTime();
                    await _db.SaveChangesAsync(ct);
                }
            }

            return Ok(new { tenantId, moduleCode = code, status = "active", paymentIntentId = intent.Id, receiptNumber = receipt, note, approvedBy });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/platform/tenants/{tenantId:guid}/modules/{moduleCode}/revoke")]
        public async Task<IActionResult> RevokeModule(Guid tenantId, string moduleCode, [FromBody] RevokeModuleRequest dto, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            var code = NormalizeCode(moduleCode);
            var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
            if (tenant == null) return NotFound("tenant not found.");

            var now = DateTime.UtcNow;
            var license = await _db.TenantModuleLicenses
                .OrderByDescending(l => l.UpdatedAtUtc)
                .FirstOrDefaultAsync(l =>
                    l.TenantId == tenantId &&
                    l.ModuleCode == code &&
                    l.Status == "active" &&
                    l.StartsAtUtc <= now &&
                    (l.EndsAtUtc == null || l.EndsAtUtc > now), ct);

            if (license == null) return NotFound("active license not found.");

            var note = NormalizeNullable(dto.Note);
            var approvedBy = NormalizeNullable(dto.ApprovedBy)
                ?? User.FindFirstValue(ClaimTypes.Name)
                ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? User.FindFirstValue("sub")
                ?? "root-admin";

            var payloadJson = JsonSerializer.Serialize(new
            {
                tenant = tenant.Slug,
                module = code,
                note,
                approvedBy,
                revokedAtUtc = now,
                revokedLicenseId = license.Id,
                previousPaymentIntentId = license.ActivatedByPaymentId
            });

            var intent = new PaymentIntent
            {
                TenantId = tenantId,
                Purpose = "module_revocation",
                ModuleCode = code,
                AmountInr = 0,
                Provider = "admin_revoke",
                Status = "paid",
                PaidAtUtc = now,
                MetadataJson = payloadJson
            };
            _db.PaymentIntents.Add(intent);
            _db.PaymentEvents.Add(new PaymentEvent
            {
                PaymentIntentId = intent.Id,
                EventType = "admin_revoke",
                PayloadJson = payloadJson
            });

            license.Status = "revoked";
            license.EndsAtUtc = now;
            license.UpdatedAtUtc = now;

            // Package licenses and package subscriptions are one lifecycle. Revoking
            // a package-owned module from the root console revokes the owning add-on
            // and all of its remaining module licenses for this tenant.
            if (license.Source.StartsWith("plan:", StringComparison.OrdinalIgnoreCase))
            {
                var planIds = await _db.SubscriptionPlans.AsNoTracking().Select(plan => plan.Id).ToListAsync(ct);
                var owningPlanId = planIds.FirstOrDefault(planId =>
                    string.Equals(PackageLicenseSource(planId), license.Source, StringComparison.OrdinalIgnoreCase));
                if (owningPlanId != Guid.Empty)
                {
                    var subscriptions = await _db.TenantSubscriptions
                        .Where(subscription =>
                            subscription.TenantId == tenantId &&
                            subscription.PlanId == owningPlanId &&
                            subscription.Status == "active")
                        .ToListAsync(ct);
                    foreach (var subscription in subscriptions)
                    {
                        subscription.Status = "revoked";
                        subscription.EndsAtUtc = now;
                        subscription.UpdatedAtUtc = now;
                    }
                    var siblingLicenses = await _db.TenantModuleLicenses
                        .Where(other =>
                            other.TenantId == tenantId &&
                            other.Id != license.Id &&
                            other.Source == license.Source &&
                            other.Status == "active")
                        .ToListAsync(ct);
                    foreach (var sibling in siblingLicenses)
                    {
                        sibling.Status = "revoked";
                        sibling.EndsAtUtc = now;
                        sibling.UpdatedAtUtc = now;
                    }
                }
            }

            await _db.SaveChangesAsync(ct);
            return Ok(new { tenantId, moduleCode = code, status = "revoked", revokedAtUtc = now, note, approvedBy });
        }

        [Authorize]
        [HttpGet("/api/tenant-admin/landing")]
        public async Task<IActionResult> GetLanding(CancellationToken ct)
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound("tenant not found.");
            var config = await _db.TenantLandingConfigs.AsNoTracking().FirstOrDefaultAsync(c => c.TenantId == tenant.Id, ct);
            var branding = await _db.TenantBrandings.AsNoTracking().FirstOrDefaultAsync(b => b.TenantId == tenant.Id, ct);
            return Ok(ToLandingDto(config ?? new TenantLandingConfig { TenantId = tenant.Id, HeroTitle = tenant.Name }, branding ?? new TenantBranding { TenantId = tenant.Id }));
        }

        // Branding (logo/colors/fonts/contact) — single source of truth shared with Print Templates.
        // Saves immediately; not part of the landing draft/publish cycle.
        [Authorize]
        [HttpGet("/api/tenant-admin/branding")]
        public async Task<IActionResult> GetBranding(CancellationToken ct)
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound("tenant not found.");
            var branding = await _db.TenantBrandings.AsNoTracking().FirstOrDefaultAsync(b => b.TenantId == tenant.Id, ct);
            return Ok(ToBrandingDto(branding ?? new TenantBranding { TenantId = tenant.Id }));
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPut("/api/tenant-admin/branding")]
        public async Task<IActionResult> SaveBranding([FromBody] BrandingRequest dto, CancellationToken ct)
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound("tenant not found.");

            var branding = await _db.TenantBrandings.FirstOrDefaultAsync(b => b.TenantId == tenant.Id, ct);
            if (branding == null)
            {
                branding = new TenantBranding { TenantId = tenant.Id, CreatedAtUtc = DateTime.UtcNow };
                _db.TenantBrandings.Add(branding);
            }

            branding.LogoUrl = NormalizeNullable(dto.LogoUrl);
            branding.PrimaryColor = string.IsNullOrWhiteSpace(dto.PrimaryColor) ? "#0f766e" : dto.PrimaryColor.Trim();
            branding.AccentColor = string.IsNullOrWhiteSpace(dto.AccentColor) ? "#f59e0b" : dto.AccentColor.Trim();
            branding.NeutralColor = string.IsNullOrWhiteSpace(dto.NeutralColor) ? "#f8fafc" : dto.NeutralColor.Trim();
            branding.DarkColor = string.IsNullOrWhiteSpace(dto.DarkColor) ? "#0f172a" : dto.DarkColor.Trim();
            branding.HeadingFont = string.IsNullOrWhiteSpace(dto.HeadingFont) ? "Inter" : dto.HeadingFont.Trim();
            branding.BodyFont = string.IsNullOrWhiteSpace(dto.BodyFont) ? "Inter" : dto.BodyFont.Trim();
            branding.ContactEmail = NormalizeNullable(dto.ContactEmail);
            branding.ContactPhone = NormalizeNullable(dto.ContactPhone);
            branding.Address = NormalizeNullable(dto.Address);
            branding.SocialLinksJson = JsonOrNull(dto.SocialLinks) ?? "[]";
            branding.UpdatedAtUtc = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);

            return Ok(ToBrandingDto(branding));
        }

        // Draft — every admin content edit lands here first. The live public page is untouched
        // until Publish is called.
        [Authorize]
        [HttpGet("/api/tenant-admin/landing/draft")]
        public async Task<IActionResult> GetLandingDraft(CancellationToken ct)
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound("tenant not found.");
            var draft = await _db.TenantLandingDrafts.FirstOrDefaultAsync(d => d.TenantId == tenant.Id, ct);
            if (draft == null)
            {
                var live = await _db.TenantLandingConfigs.AsNoTracking().FirstOrDefaultAsync(c => c.TenantId == tenant.Id, ct);
                draft = new TenantLandingDraft
                {
                    TenantId = tenant.Id,
                    HeroTitle = live?.HeroTitle ?? tenant.Name,
                    HeroSubtitle = live?.HeroSubtitle,
                    HeroImageUrl = live?.HeroImageUrl,
                    HeroLayout = live?.HeroLayout ?? "split-card",
                    ServiceTimesJson = live?.ServiceTimesJson ?? "[]",
                    SectionsJson = live?.SectionsJson ?? "[]",
                    SeoTitle = live?.SeoTitle,
                    SeoDescription = live?.SeoDescription,
                    OgImageUrl = live?.OgImageUrl,
                };
                _db.TenantLandingDrafts.Add(draft);
                await _db.SaveChangesAsync(ct);
            }
            return Ok(ToLandingDraftDto(draft));
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPut("/api/tenant-admin/landing/draft")]
        public async Task<IActionResult> SaveLandingDraft([FromBody] LandingDraftRequest dto, CancellationToken ct)
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound("tenant not found.");

            var draft = await _db.TenantLandingDrafts.FirstOrDefaultAsync(d => d.TenantId == tenant.Id, ct);
            if (draft == null)
            {
                draft = new TenantLandingDraft { TenantId = tenant.Id };
                _db.TenantLandingDrafts.Add(draft);
            }

            draft.HeroTitle = string.IsNullOrWhiteSpace(dto.HeroTitle) ? tenant.Name : dto.HeroTitle.Trim();
            draft.HeroSubtitle = NormalizeNullable(dto.HeroSubtitle);
            draft.HeroImageUrl = NormalizeNullable(dto.HeroImageUrl);
            draft.HeroLayout = string.IsNullOrWhiteSpace(dto.HeroLayout) ? "split-card" : dto.HeroLayout.Trim();
            draft.ServiceTimesJson = JsonOrNull(dto.ServiceTimes) ?? "[]";
            draft.SectionsJson = JsonOrNull(dto.Sections) ?? "[]";
            draft.SeoTitle = NormalizeNullable(dto.SeoTitle);
            draft.SeoDescription = NormalizeNullable(dto.SeoDescription);
            draft.OgImageUrl = NormalizeNullable(dto.OgImageUrl);
            draft.UpdatedAtUtc = DateTime.UtcNow;
            var userId = GetCurrentUserId();
            draft.UpdatedByUserId = userId == Guid.Empty ? null : userId;
            await _db.SaveChangesAsync(ct);

            return Ok(ToLandingDraftDto(draft));
        }

        // Publish — copies the draft's content into the live page and records a version snapshot.
        // The only way draft content ever reaches the public site.
        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/tenant-admin/landing/publish")]
        public async Task<IActionResult> PublishLanding(CancellationToken ct)
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound("tenant not found.");

            var draft = await _db.TenantLandingDrafts.AsNoTracking().FirstOrDefaultAsync(d => d.TenantId == tenant.Id, ct);
            if (draft == null) return Conflict(new { message = "There is no draft to publish yet." });

            var live = await _db.TenantLandingConfigs.FirstOrDefaultAsync(c => c.TenantId == tenant.Id, ct);
            if (live == null)
            {
                live = new TenantLandingConfig { TenantId = tenant.Id, CreatedAtUtc = DateTime.UtcNow };
                _db.TenantLandingConfigs.Add(live);
            }

            live.HeroTitle = draft.HeroTitle;
            live.HeroSubtitle = draft.HeroSubtitle;
            live.HeroImageUrl = draft.HeroImageUrl;
            live.HeroLayout = draft.HeroLayout;
            live.ServiceTimesJson = draft.ServiceTimesJson;
            live.SectionsJson = draft.SectionsJson;
            live.SeoTitle = draft.SeoTitle;
            live.SeoDescription = draft.SeoDescription;
            live.OgImageUrl = draft.OgImageUrl;
            live.UpdatedAtUtc = DateTime.UtcNow;

            var userId = GetCurrentUserId();
            var version = new TenantLandingVersion
            {
                TenantId = tenant.Id,
                SnapshotJson = JsonSerializer.Serialize(ToLandingDraftDto(draft)),
                PublishedByUserId = userId == Guid.Empty ? null : userId,
            };
            _db.TenantLandingVersions.Add(version);
            await _db.SaveChangesAsync(ct);

            // Prune history beyond the last 20 for this tenant.
            var oldVersionIds = await _db.TenantLandingVersions.AsNoTracking()
                .Where(v => v.TenantId == tenant.Id)
                .OrderByDescending(v => v.PublishedAtUtc)
                .Skip(20)
                .Select(v => v.Id)
                .ToListAsync(ct);
            if (oldVersionIds.Count > 0)
            {
                await _db.TenantLandingVersions.Where(v => oldVersionIds.Contains(v.Id)).ExecuteDeleteAsync(ct);
            }

            var branding = await _db.TenantBrandings.AsNoTracking().FirstOrDefaultAsync(b => b.TenantId == tenant.Id, ct);
            return Ok(ToLandingDto(live, branding ?? new TenantBranding { TenantId = tenant.Id }));
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPut("/api/tenant-admin/landing/visibility")]
        public async Task<IActionResult> SetLandingVisibility([FromBody] LandingVisibilityRequest dto, CancellationToken ct)
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound("tenant not found.");
            var live = await _db.TenantLandingConfigs.FirstOrDefaultAsync(c => c.TenantId == tenant.Id, ct);
            if (live == null)
            {
                live = new TenantLandingConfig { TenantId = tenant.Id, HeroTitle = tenant.Name };
                _db.TenantLandingConfigs.Add(live);
            }
            live.Published = dto.Published;
            live.UpdatedAtUtc = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { published = live.Published });
        }

        [Authorize]
        [HttpGet("/api/tenant-admin/landing/versions")]
        public async Task<IActionResult> GetLandingVersions(CancellationToken ct)
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound("tenant not found.");
            var versions = await _db.TenantLandingVersions.AsNoTracking()
                .Where(v => v.TenantId == tenant.Id)
                .OrderByDescending(v => v.PublishedAtUtc)
                .Take(20)
                .Select(v => new { v.Id, v.PublishedAtUtc, v.PublishedByUserId, v.SnapshotJson })
                .ToListAsync(ct);
            return Ok(versions.Select(v =>
            {
                string? heroTitle = null;
                try { using var doc = JsonDocument.Parse(v.SnapshotJson); if (doc.RootElement.TryGetProperty("heroTitle", out var ht)) heroTitle = ht.GetString(); } catch { }
                return new { v.Id, v.PublishedAtUtc, v.PublishedByUserId, heroTitle };
            }));
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/tenant-admin/landing/versions/{id:guid}/restore")]
        public async Task<IActionResult> RestoreLandingVersion(Guid id, CancellationToken ct)
        {
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound("tenant not found.");
            var version = await _db.TenantLandingVersions.AsNoTracking().FirstOrDefaultAsync(v => v.Id == id && v.TenantId == tenant.Id, ct);
            if (version == null) return NotFound(new { message = "That version was not found." });

            JsonElement snapshot;
            try { using var doc = JsonDocument.Parse(version.SnapshotJson); snapshot = doc.RootElement.Clone(); }
            catch { return Problem("Stored version snapshot is corrupt.", statusCode: 500); }

            var draft = await _db.TenantLandingDrafts.FirstOrDefaultAsync(d => d.TenantId == tenant.Id, ct);
            if (draft == null)
            {
                draft = new TenantLandingDraft { TenantId = tenant.Id };
                _db.TenantLandingDrafts.Add(draft);
            }

            string? Str(string prop) => snapshot.TryGetProperty(prop, out var el) && el.ValueKind == JsonValueKind.String ? el.GetString() : null;

            draft.HeroTitle = Str("heroTitle") ?? tenant.Name;
            draft.HeroSubtitle = Str("heroSubtitle");
            draft.HeroImageUrl = Str("heroImageUrl");
            draft.HeroLayout = Str("heroLayout") ?? "split-card";
            draft.ServiceTimesJson = snapshot.TryGetProperty("serviceTimes", out var st) ? st.GetRawText() : "[]";
            draft.SectionsJson = snapshot.TryGetProperty("sections", out var sec) ? sec.GetRawText() : "[]";
            draft.SeoTitle = Str("seoTitle");
            draft.SeoDescription = Str("seoDescription");
            draft.OgImageUrl = Str("ogImageUrl");
            draft.UpdatedAtUtc = DateTime.UtcNow;
            var userId = GetCurrentUserId();
            draft.UpdatedByUserId = userId == Guid.Empty ? null : userId;
            await _db.SaveChangesAsync(ct);

            return Ok(ToLandingDraftDto(draft));
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/billing/tenants/{tenantId:guid}/modules/{moduleCode}/payment-intents")]
        public async Task<IActionResult> CreatePaymentIntent(Guid tenantId, string moduleCode, [FromBody] CreatePaymentIntentRequest dto, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await _licensing.EnsureCatalogSeededAsync(ct);
            var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
            if (tenant == null) return NotFound("tenant not found.");
            var code = NormalizeCode(moduleCode);
            var module = await _db.ModuleCatalog.AsNoTracking().FirstOrDefaultAsync(m => m.Code == code && m.Enabled, ct);
            if (module == null) return NotFound("module not found.");
            if (module.MonthlyPriceInr <= 0)
            {
                await _licensing.ActivateModuleAsync(tenantId, code, 0, "base-free", null, ct);
                return Ok(new { status = "activated", tenantId, moduleCode = code, amountInr = 0 });
            }

            var provider = NormalizeCode(NormalizeNullable(dto.Provider) ?? _config["Billing:DefaultProvider"] ?? "upi");
            var vpa = NormalizeNullable(dto.UpiVpa) ?? _config["Billing:UpiVpa"] ?? "merchant@upi";
            var payee = NormalizeNullable(dto.UpiPayeeName) ?? _config["Billing:UpiPayeeName"] ?? "Mahima Ministries";
            var intent = new PaymentIntent
            {
                TenantId = tenantId,
                Purpose = "module_activation",
                ModuleCode = code,
                AmountInr = module.MonthlyPriceInr,
                Provider = provider,
                Status = "pending",
                UpiVpa = vpa,
                UpiPayeeName = payee,
                ExpiresAtUtc = DateTime.UtcNow.AddHours(24),
                MetadataJson = JsonSerializer.Serialize(new { tenant = tenant.Slug, module = code })
            };

            string? razorpayKeyId = null;
            if (provider == "razorpay")
            {
                var order = await CreateRazorpayOrderAsync(intent, tenant.Slug, code, ct);
                intent.ProviderOrderId = order.orderId;
                intent.MetadataJson = JsonSerializer.Serialize(new
                {
                    tenant = tenant.Slug,
                    module = code,
                    razorpayOrderId = order.orderId
                });
                razorpayKeyId = order.keyId;
            }
            else
            {
                intent.Provider = "upi";
                intent.UpiDeepLink = BuildUpiLink(vpa, payee, intent.AmountInr, intent.Id.ToString("N"), $"{tenant.Slug}-{code}");
            }

            _db.PaymentIntents.Add(intent);
            _db.PaymentEvents.Add(new PaymentEvent { PaymentIntentId = intent.Id, EventType = "created", PayloadJson = "{}" });
            await _db.SaveChangesAsync(ct);

            return Ok(new
            {
                intent.Id,
                intent.TenantId,
                intent.ModuleCode,
                intent.AmountInr,
                intent.Currency,
                intent.Provider,
                intent.Status,
                intent.ProviderOrderId,
                razorpayOrderId = intent.ProviderOrderId,
                razorpayKeyId,
                intent.UpiVpa,
                intent.UpiPayeeName,
                intent.UpiDeepLink,
                intent.ExpiresAtUtc
            });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/billing/payment-intents/{paymentIntentId:guid}/mark-paid")]
        public async Task<IActionResult> MarkPaid(Guid paymentIntentId, [FromBody] MarkPaymentPaidRequest dto, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsureBillingTablesAsync(ct);
            await _licensing.EnsureCatalogSeededAsync(ct);

            try
            {
                var strategy = _db.Database.CreateExecutionStrategy();
                return await strategy.ExecuteAsync<IActionResult>(async () =>
                {
                    await using var tx = await _db.Database.BeginTransactionAsync(ct);

                    var intent = await _db.PaymentIntents.FirstOrDefaultAsync(p => p.Id == paymentIntentId, ct);
                    if (intent == null) return NotFound("payment intent not found.");
                    if (string.IsNullOrWhiteSpace(intent.ModuleCode)) return BadRequest("payment intent has no module.");
                    if (string.Equals(intent.Status, "paid", StringComparison.OrdinalIgnoreCase))
                        return Ok(new { intent.Id, intent.Status, activatedModule = intent.ModuleCode, intent.TenantId });

                    var providerPaymentId = NormalizeNullable(dto?.ProviderPaymentId) ?? intent.ProviderPaymentId;

                    intent.Status = "paid";
                    intent.ProviderPaymentId = providerPaymentId;
                    intent.PaidAtUtc = DateTime.UtcNow;
                    _db.PaymentEvents.Add(new PaymentEvent
                    {
                        PaymentIntentId = intent.Id,
                        EventType = "paid",
                        ProviderEventId = $"admin-confirmed:{intent.Id:N}",
                        PayloadJson = string.IsNullOrWhiteSpace(dto?.PayloadJson) ? "{}" : dto.PayloadJson
                    });

                    await _licensing.ActivateModuleAsync(intent.TenantId, intent.ModuleCode, intent.AmountInr, "payment", intent.Id, ct);
                    await ApplyPaymentToOpenInvoicesAsync(intent, ct);
                    await _db.SaveChangesAsync(ct);
                    await tx.CommitAsync(ct);
                    return Ok(new { intent.Id, intent.Status, activatedModule = intent.ModuleCode, intent.TenantId });
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Could not confirm billing donation payment intent {PaymentIntentId}", paymentIntentId);
                return StatusCode(500, new
                {
                    message = "Could not confirm donation and activate module.",
                    detail = ex.GetBaseException().Message
                });
            }
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/billing/tenants/current/modules/{moduleCode}/payment-intents")]
        public async Task<IActionResult> CreateCurrentTenantPaymentIntent(string moduleCode, [FromBody] CreatePaymentIntentRequest dto, CancellationToken ct)
        {
            await _licensing.EnsureCatalogSeededAsync(ct);
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound(new { message = "Tenant not found." });

            var code = NormalizeCode(moduleCode);
            var module = await _db.ModuleCatalog.AsNoTracking().FirstOrDefaultAsync(m => m.Code == code && m.Enabled, ct);
            if (module == null) return NotFound(new { message = "Module not found." });

            if (module.IsBaseModule || module.MonthlyPriceInr <= 0)
            {
                await _licensing.ActivateModuleAsync(tenant.Id, code, 0, "base-free", null, ct);
                return Ok(new { status = "activated", tenantId = tenant.Id, moduleCode = code, amountInr = 0 });
            }

            if (await _licensing.HasModuleAsync(tenant.Id, code, ct))
                return Ok(new { status = "active", tenantId = tenant.Id, moduleCode = code, amountInr = module.MonthlyPriceInr });

            var isIndia = NormalizeCountryCode(tenant.CountryCode) == "IN";
            var provider = NormalizeCode(NormalizeNullable(dto.Provider) ?? "upi");
            if (isIndia && provider != "upi" && provider != "razorpay")
                return BadRequest(new { message = "Indian tenants must use UPI/Razorpay checkout." });
            if (!isIndia)
                return BadRequest(new { message = "In order to activate your paid subscriptions, please write to us at contact@mahimaministries.in." });
            var vpa = NormalizeNullable(dto.UpiVpa) ?? _config["Billing:UpiVpa"] ?? "merchant@upi";
            var payee = NormalizeNullable(dto.UpiPayeeName) ?? _config["Billing:UpiPayeeName"] ?? "Mahima Ministries Welfare Society";

            var intent = new PaymentIntent
            {
                TenantId = tenant.Id,
                Purpose = "module_donation",
                ModuleCode = code,
                AmountInr = module.MonthlyPriceInr,
                Provider = provider,
                Status = "pending",
                UpiVpa = vpa,
                UpiPayeeName = payee,
                ExpiresAtUtc = DateTime.UtcNow.AddHours(24),
                MetadataJson = JsonSerializer.Serialize(new { tenant = tenant.Slug, module = code, source = "tenant_admin_subscription_donation" })
            };

            string? razorpayKeyId = null;
            if (provider == "razorpay")
            {
                var order = await CreateRazorpayOrderAsync(intent, tenant.Slug, code, ct);
                intent.ProviderOrderId = order.orderId;
                intent.MetadataJson = JsonSerializer.Serialize(new
                {
                    tenant = tenant.Slug,
                    module = code,
                    razorpayOrderId = order.orderId,
                    source = "tenant_admin_subscription_donation"
                });
                razorpayKeyId = order.keyId;
            }
            else
            {
                intent.UpiDeepLink = BuildUpiLink(vpa, payee, intent.AmountInr, intent.Id.ToString("N"), $"{tenant.Slug}-{code}-donation");
            }

            _db.PaymentIntents.Add(intent);
            _db.PaymentEvents.Add(new PaymentEvent { PaymentIntentId = intent.Id, EventType = "created", PayloadJson = "{}" });
            await _db.SaveChangesAsync(ct);

            return Ok(new
            {
                intent.Id,
                intent.TenantId,
                intent.ModuleCode,
                intent.AmountInr,
                intent.Currency,
                intent.Provider,
                intent.Status,
                intent.ProviderOrderId,
                razorpayOrderId = intent.ProviderOrderId,
                razorpayKeyId,
                intent.UpiVpa,
                intent.UpiPayeeName,
                intent.UpiDeepLink,
                intent.ExpiresAtUtc
            });
        }

        [Authorize]
        [HttpPost("/api/billing/payment-intents/{paymentIntentId:guid}/donation-details")]
        public async Task<IActionResult> SubmitDonationDetails(Guid paymentIntentId, [FromBody] SubmitDonationDetailsRequest dto, CancellationToken ct)
        {
            var intent = await _db.PaymentIntents.FirstOrDefaultAsync(p => p.Id == paymentIntentId, ct);
            if (intent == null) return NotFound(new { message = "Donation request not found." });

            var currentTenant = await _tenantContext.GetCurrentTenantAsync(ct);
            var root = await CurrentTenantIsRootAsync(ct);
            if (!root && currentTenant?.Id != intent.TenantId) return Forbid();
            if (intent.Status == "paid") return BadRequest(new { message = "This donation is already confirmed." });

            var upiTransactionNumber = NormalizeNullable(dto.UpiTransactionNumber);
            var payerName = NormalizeNullable(dto.PayerName);
            if (string.IsNullOrWhiteSpace(upiTransactionNumber))
                return BadRequest(new { message = "UPI transaction number is required." });
            if (string.IsNullOrWhiteSpace(payerName))
                return BadRequest(new { message = "Name is required." });

            var donation = new
            {
                upiTransactionNumber,
                payerName,
                payerPhone = NormalizeNullable(dto.PayerPhone),
                payerEmail = NormalizeNullable(dto.PayerEmail),
                amountInr = dto.AmountInr.GetValueOrDefault(intent.AmountInr),
                note = NormalizeNullable(dto.Note),
                submittedAtUtc = DateTime.UtcNow
            };

            intent.Provider = "upi";
            intent.Status = "submitted";
            intent.ProviderPaymentId = upiTransactionNumber;
            intent.MetadataJson = JsonSerializer.Serialize(new
            {
                previous = intent.MetadataJson,
                donation
            });

            _db.PaymentEvents.Add(new PaymentEvent
            {
                PaymentIntentId = intent.Id,
                EventType = "donation.details.submitted",
                ProviderEventId = upiTransactionNumber,
                PayloadJson = JsonSerializer.Serialize(donation)
            });
            await LinkPaymentIntentToOpenInvoiceAsync(intent, ct);
            await _db.SaveChangesAsync(ct);

            return Ok(new
            {
                intent.Id,
                intent.TenantId,
                intent.ModuleCode,
                intent.AmountInr,
                intent.Currency,
                intent.Provider,
                intent.Status,
                intent.ProviderPaymentId,
                donation
            });
        }

        [Authorize]
        [HttpPost("/api/billing/payment-intents/{paymentIntentId:guid}/razorpay-verify")]
        public async Task<IActionResult> VerifyModulePayment(Guid paymentIntentId, [FromBody] VerifyModulePaymentRequest dto, CancellationToken ct)
        {
            var intent = await _db.PaymentIntents.FirstOrDefaultAsync(p => p.Id == paymentIntentId, ct);
            if (intent == null) return NotFound(new { message = "Payment intent not found." });

            var currentTenant = await _tenantContext.GetCurrentTenantAsync(ct);
            var root = await CurrentTenantIsRootAsync(ct);
            if (!root && currentTenant?.Id != intent.TenantId) return Forbid();

            if (string.IsNullOrWhiteSpace(intent.ProviderOrderId) ||
                !string.Equals(intent.ProviderOrderId, dto.RazorpayOrderId, StringComparison.Ordinal))
                return BadRequest(new { message = "Razorpay order does not match this payment intent." });

            var keySecret = _config["Billing:RazorpayKeySecret"];
            if (string.IsNullOrWhiteSpace(keySecret))
                return StatusCode(503, new { message = "Razorpay key secret is not configured." });

            if (!IsValidRazorpayCheckoutSignature(dto.RazorpayOrderId, dto.RazorpayPaymentId, dto.RazorpaySignature, keySecret))
                return Unauthorized(new { message = "Invalid Razorpay payment signature." });

            if (intent.Status != "paid")
            {
                intent.Status = "paid";
                intent.ProviderPaymentId = NormalizeNullable(dto.RazorpayPaymentId);
                intent.PaidAtUtc = DateTime.UtcNow;
                _db.PaymentEvents.Add(new PaymentEvent
                {
                    PaymentIntentId = intent.Id,
                    EventType = "razorpay.checkout.verified",
                    ProviderEventId = intent.ProviderPaymentId,
                    PayloadJson = JsonSerializer.Serialize(dto)
                });

                if (!string.IsNullOrWhiteSpace(intent.ModuleCode))
                    await _licensing.ActivateModuleAsync(intent.TenantId, intent.ModuleCode, intent.AmountInr, "payment", intent.Id, ct);

                await ApplyPaymentToOpenInvoicesAsync(intent, ct);
                await _db.SaveChangesAsync(ct);
            }

            return Ok(new { intent.Id, intent.Status, activatedModule = intent.ModuleCode, intent.TenantId });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpGet("/api/billing/invoices")]
        public async Task<IActionResult> ListInvoices([FromQuery] string? month, [FromQuery] string? status, [FromQuery] Guid? tenantId, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsureBillingTablesAsync(ct);

            var query = _db.BillingInvoices
                .AsNoTracking()
                .Include(i => i.Tenant)
                .Include(i => i.Lines)
                .Include(i => i.PaymentIntent)
                    .ThenInclude(p => p!.Events)
                .AsQueryable();

            var monthRange = ParseCalendarMonth(month);
            if (monthRange.HasValue)
            {
                query = query.Where(i => i.PeriodStartUtc >= monthRange.Value.start && i.PeriodStartUtc < monthRange.Value.end);
            }

            if (tenantId.HasValue) query = query.Where(i => i.TenantId == tenantId.Value);
            var normalizedStatus = NormalizeNullable(status)?.ToLowerInvariant();
            if (!string.IsNullOrWhiteSpace(normalizedStatus)) query = query.Where(i => i.Status == normalizedStatus);

            var invoices = await query
                .OrderByDescending(i => i.PeriodStartUtc)
                .ThenBy(i => i.Tenant!.Name)
                .Take(500)
                .ToListAsync(ct);

            var allForSummary = await _db.BillingInvoices.AsNoTracking().ToListAsync(ct);
            var donationRecords = await _db.PaymentIntents
                .AsNoTracking()
                .Include(p => p.Tenant)
                .Include(p => p.Module)
                .Where(p => p.Purpose == "module_donation" && p.Status == "submitted")
                .OrderByDescending(p => p.CreatedAtUtc)
                .Take(200)
                .ToListAsync(ct);

            return Ok(new
            {
                summary = new
                {
                    invoiceCount = allForSummary.Count,
                    openAmountInr = allForSummary.Where(i => i.Status != "paid").Sum(i => i.TotalInr - i.PaidInr),
                    paidAmountInr = allForSummary.Sum(i => i.PaidInr),
                    monthlyRecurringInr = await _db.TenantModuleLicenses.AsNoTracking()
                        .Where(l => l.Status == "active" && l.PriceInr > 0 && (l.EndsAtUtc == null || l.EndsAtUtc > DateTime.UtcNow))
                        .SumAsync(l => l.PriceInr, ct)
                },
                items = invoices.Select(ToInvoiceDto),
                donationRecords = donationRecords.Select(ToDonationRecordDto)
            });
        }

        [Authorize]
        [HttpGet("/api/billing/tenants/current/invoices")]
        public async Task<IActionResult> ListCurrentTenantInvoices([FromQuery] string? month, [FromQuery] string? status, CancellationToken ct)
        {
            await EnsureBillingTablesAsync(ct);
            var tenant = await _tenantContext.GetCurrentTenantAsync(ct);
            if (tenant == null) return NotFound(new { message = "Tenant not found." });

            var query = _db.BillingInvoices
                .AsNoTracking()
                .Include(i => i.Tenant)
                .Include(i => i.Lines)
                .Include(i => i.PaymentIntent)
                    .ThenInclude(p => p!.Events)
                .Where(i => i.TenantId == tenant.Id);

            var monthRange = ParseCalendarMonth(month);
            if (monthRange.HasValue)
                query = query.Where(i => i.PeriodStartUtc >= monthRange.Value.start && i.PeriodStartUtc < monthRange.Value.end);

            var normalizedStatus = NormalizeNullable(status)?.ToLowerInvariant();
            if (!string.IsNullOrWhiteSpace(normalizedStatus)) query = query.Where(i => i.Status == normalizedStatus);

            var invoices = await query
                .OrderByDescending(i => i.PeriodStartUtc)
                .Take(36)
                .ToListAsync(ct);

            return Ok(new
            {
                tenant = new { tenant.Id, tenant.Name, tenant.Slug },
                items = invoices.Select(ToInvoiceDto)
            });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpGet("/api/billing/settings")]
        public async Task<IActionResult> GetBillingSettings(CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsureBillingTablesAsync(ct);
            return Ok(new { billingDay = await GetBillingDayAsync(ct) });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPut("/api/billing/settings")]
        public async Task<IActionResult> UpdateBillingSettings([FromBody] BillingSettingsRequest dto, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            if (dto.BillingDay is < 1 or > 28)
                return BadRequest(new { message = "Billing day must be between 1 and 28." });
            await EnsureBillingTablesAsync(ct);
            var rootId = await _db.Tenants.Where(t => t.IsRootTenant).Select(t => t.Id).FirstAsync(ct);
            var setting = await _db.MinistryAutomationSettings
                .FirstOrDefaultAsync(s => s.TenantId == rootId && s.Key == BillingDaySettingKey, ct);
            if (setting == null)
            {
                setting = new MinistryAutomationSetting
                {
                    TenantId = rootId,
                    Key = BillingDaySettingKey
                };
                _db.MinistryAutomationSettings.Add(setting);
            }
            setting.Value = dto.BillingDay.ToString();
            setting.UpdatedAtUtc = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
            return Ok(new { billingDay = dto.BillingDay });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/billing/invoices/delete-period")]
        public async Task<IActionResult> DeleteInvoicePeriod([FromBody] DeleteInvoicePeriodRequest dto, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsureBillingTablesAsync(ct);
            var billingDay = await GetBillingDayAsync(ct);
            var period = BillingPeriodForMonth(dto.Month, billingDay);
            if (!period.HasValue) return BadRequest(new { message = "A valid billing month is required." });

            var invoices = await _db.BillingInvoices
                .Where(i => i.PeriodStartUtc == period.Value.start)
                .ToListAsync(ct);
            _db.BillingInvoices.RemoveRange(invoices);
            await _db.SaveChangesAsync(ct);
            return Ok(new { deleted = invoices.Count, periodStartUtc = period.Value.start, periodEndUtc = period.Value.end });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/billing/invoices/delete-tenant")]
        public async Task<IActionResult> DeleteTenantBilling([FromBody] DeleteTenantBillingRequest dto, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsureBillingTablesAsync(ct);
            var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == dto.TenantId, ct);
            if (tenant == null) return NotFound(new { message = "Tenant not found." });

            var query = _db.BillingInvoices.Where(i => i.TenantId == dto.TenantId);
            if (!string.IsNullOrWhiteSpace(dto.Month))
            {
                var month = ParseCalendarMonth(dto.Month);
                if (!month.HasValue) return BadRequest(new { message = "A valid billing month is required." });
                query = query.Where(i => i.PeriodStartUtc >= month.Value.start && i.PeriodStartUtc < month.Value.end);
            }

            var invoices = await query.ToListAsync(ct);
            _db.BillingInvoices.RemoveRange(invoices);
            await _db.SaveChangesAsync(ct);
            return Ok(new { deleted = invoices.Count, tenantId = tenant.Id, tenantName = tenant.Name, month = dto.Month });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpDelete("/api/platform/tenants/{tenantId:guid}/purge")]
        public async Task<IActionResult> PurgeTenant(Guid tenantId, [FromQuery] string? confirm, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            var tenant = await _db.Tenants.AsNoTracking()
                .Where(t => t.Id == tenantId)
                .Select(t => new { t.Id, t.Name, t.Slug, t.IsRootTenant })
                .FirstOrDefaultAsync(ct);
            if (tenant == null) return NotFound(new { message = "Tenant not found." });
            if (tenant.IsRootTenant) return BadRequest(new { message = "The root tenant cannot be purged." });
            if (!string.Equals(confirm?.Trim(), tenant.Slug, StringComparison.OrdinalIgnoreCase))
                return BadRequest(new { message = $"Type the tenant slug '{tenant.Slug}' to confirm permanent deletion." });

            var deletedRows = await PurgeTenantDataAsync(tenantId, ct);
            return Ok(new { deleted = true, tenant.Id, tenant.Name, tenant.Slug, deletedRows });
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpDelete("/api/billing/invoices/{invoiceId:guid}")]
        public async Task<IActionResult> DeleteBillingInvoice(Guid invoiceId, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsureBillingTablesAsync(ct);
            var invoice = await _db.BillingInvoices
                .Include(i => i.Tenant)
                .FirstOrDefaultAsync(i => i.Id == invoiceId, ct);
            if (invoice == null) return NotFound(new { message = "Invoice not found." });
            var result = new { deleted = 1, invoice.Id, invoice.InvoiceNumber, invoice.TenantId, TenantName = invoice.Tenant?.Name };
            _db.BillingInvoices.Remove(invoice);
            await _db.SaveChangesAsync(ct);
            return Ok(result);
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/billing/invoices/generate")]
        public async Task<IActionResult> GenerateMonthlyInvoices([FromBody] GenerateInvoicesRequest dto, CancellationToken ct)
        {
            string? processingTenant = null;
            try
            {
                if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
                await EnsureBillingTablesAsync(ct);
                await _licensing.EnsureCatalogSeededAsync(ct);

                var savedBillingDay = await GetBillingDayAsync(ct);
                var billingDay = dto.BillingDay ?? savedBillingDay;
                if (billingDay is < 1 or > 28)
                    return BadRequest(new { message = "Billing day must be between 1 and 28." });
                var period = BillingPeriodForMonth(dto.Month, billingDay) ?? CurrentInvoicePeriod(billingDay);

                if (dto.ReplaceExisting)
                {
                    var existingQuery = _db.BillingInvoices.Where(i => i.PeriodStartUtc == period.start);
                    if (dto.TenantId.HasValue)
                        existingQuery = existingQuery.Where(i => i.TenantId == dto.TenantId.Value);
                    await existingQuery.ExecuteDeleteAsync(ct);
                }
                var tenants = await _db.Tenants
                    .AsNoTracking()
                    .Where(t => !t.IsRootTenant && t.Status == "active" && (!dto.TenantId.HasValue || t.Id == dto.TenantId.Value))
                    .OrderBy(t => t.Name)
                    .ToListAsync(ct);
                if (dto.TenantId.HasValue && tenants.Count == 0)
                    return NotFound(new { message = "Active tenant not found." });

                var created = 0;
                var updated = 0;
                foreach (var tenant in tenants)
                {
                    processingTenant = $"{tenant.Name} ({tenant.Slug})";
                    var licenses = await _db.TenantModuleLicenses
                        .AsNoTracking()
                        .Include(l => l.Module)
                        .Where(l =>
                            l.TenantId == tenant.Id &&
                            (l.Status == "active" || l.Status == "superseded" || l.Status == "terminated") &&
                            l.StartsAtUtc < period.end &&
                            (l.EndsAtUtc == null || l.EndsAtUtc > period.start))
                        .OrderBy(l => l.ModuleCode)
                        .ToListAsync(ct);
                    if (!licenses.Any()) continue;

                    var invoice = await _db.BillingInvoices
                        .Include(i => i.Lines)
                        .FirstOrDefaultAsync(i => i.TenantId == tenant.Id && i.PeriodStartUtc == period.start, ct);
                    if (invoice == null)
                    {
                        invoice = new BillingInvoice
                        {
                            TenantId = tenant.Id,
                            InvoiceNumber = BuildInvoiceNumber(period.start, tenant.Slug, tenant.Id),
                            PeriodStartUtc = period.start,
                            PeriodEndUtc = period.end,
                            Status = "open",
                            Currency = "INR",
                            CreatedAtUtc = DateTime.UtcNow,
                            UpdatedAtUtc = DateTime.UtcNow
                        };
                        _db.BillingInvoices.Add(invoice);
                        created++;
                    }
                    else
                    {
                        updated++;
                    }

                    var licenseGroups = licenses
                        .GroupBy(l => l.ModuleCode, StringComparer.OrdinalIgnoreCase)
                        .ToDictionary(group => group.Key, StringComparer.OrdinalIgnoreCase);
                    var lineIdsToDelete = new HashSet<Guid>();

                    // Keep penalties as immutable audit lines, but reconcile generated
                    // subscription lines to the license history for this billing period.
                    foreach (var staleLine in invoice.Lines
                                 .Where(line => !IsPenaltyInvoiceLine(line) && !licenseGroups.ContainsKey(line.ModuleCode))
                                 .ToList())
                        lineIdsToDelete.Add(staleLine.Id);

                    foreach (var licenseGroup in licenseGroups.Values)
                    {
                        var license = licenseGroup.OrderByDescending(l => l.StartsAtUtc).First();
                        var regularLines = invoice.Lines
                            .Where(line => !IsPenaltyInvoiceLine(line) &&
                                           string.Equals(line.ModuleCode, licenseGroup.Key, StringComparison.OrdinalIgnoreCase))
                            .ToList();
                        var existingLine = regularLines.FirstOrDefault();
                        foreach (var duplicateLine in regularLines.Skip(1))
                            lineIdsToDelete.Add(duplicateLine.Id);

                        var amount = licenseGroup.Sum(segment =>
                            CalculateInvoiceAmount(segment.PriceInr, segment.StartsAtUtc, segment.EndsAtUtc, period.start, period.end, dto.ProRata));
                        if (existingLine == null)
                        {
                            invoice.Lines.Add(new BillingInvoiceLine
                            {
                                ModuleCode = licenseGroup.Key,
                                Description = license.Module?.Name ?? license.ModuleCode,
                                Quantity = 1,
                                UnitPriceInr = license.PriceInr,
                                AmountInr = amount
                            });
                        }
                        else
                        {
                            existingLine.Description = license.Module?.Name ?? license.ModuleCode;
                            existingLine.UnitPriceInr = license.PriceInr;
                            existingLine.AmountInr = amount;
                        }
                    }

                    if (lineIdsToDelete.Count > 0)
                    {
                        // ExecuteDelete is intentionally idempotent. Historical rows may
                        // already have been removed by a revoke/recalculation request, in
                        // which case zero affected rows is valid and must not abort billing.
                        await _db.BillingInvoiceLines
                            .Where(line => lineIdsToDelete.Contains(line.Id))
                            .ExecuteDeleteAsync(ct);
                        foreach (var removedLine in invoice.Lines.Where(line => lineIdsToDelete.Contains(line.Id)).ToList())
                        {
                            invoice.Lines.Remove(removedLine);
                            _db.Entry(removedLine).State = EntityState.Detached;
                        }
                    }

                    invoice.SubtotalInr = invoice.Lines.Sum(l => l.AmountInr);
                    invoice.TaxInr = 0;
                    invoice.TotalInr = invoice.SubtotalInr + invoice.TaxInr;
                    invoice.PaidInr = invoice.TotalInr == 0 ? 0 : Math.Min(invoice.PaidInr, invoice.TotalInr);
                    invoice.Status = invoice.TotalInr == 0 ? "paid" : invoice.PaidInr >= invoice.TotalInr ? "paid" : invoice.PaidInr > 0 ? "partial" : "open";
                    invoice.UpdatedAtUtc = DateTime.UtcNow;

                    // Persist each tenant independently. Keeping every tenant's invoices
                    // tracked until one final save creates a very large batch and leaves
                    // early rows exposed to concurrent recalculation/deletion for the
                    // entire duration of the request.
                    await SaveBillingChangesWithConcurrencyRecoveryAsync(ct);
                    _db.ChangeTracker.Clear();
                }

                return Ok(new { created, updated, tenantId = dto.TenantId, proRata = dto.ProRata, billingDay, periodStartUtc = period.start, periodEndUtc = period.end });
            }
            catch (Exception ex)
            {
                var databaseDetail = ex is DbUpdateException dbUpdate
                    ? dbUpdate.InnerException?.Message ?? dbUpdate.Message
                    : ex.Message;
                _logger.LogError(ex, "Invoice generation failed while processing {Tenant}.", processingTenant ?? "billing setup");
                return Problem(
                    title: "Invoice generation failed",
                    detail: $"{(processingTenant == null ? "" : $"Tenant: {processingTenant}. ")}{databaseDetail}",
                    statusCode: StatusCodes.Status500InternalServerError);
            }
        }

        [Authorize(Roles = "admin,ADMIN")]
        [HttpPost("/api/billing/invoices/{invoiceId:guid}/payments")]
        public async Task<IActionResult> ApplyInvoicePayment(Guid invoiceId, [FromBody] ApplyInvoicePaymentRequest dto, CancellationToken ct)
        {
            if (!await CurrentTenantIsRootAsync(ct)) return Forbid();
            await EnsureBillingTablesAsync(ct);
            var invoice = await _db.BillingInvoices.FirstOrDefaultAsync(i => i.Id == invoiceId, ct);
            if (invoice == null) return NotFound(new { message = "Invoice not found." });

            PaymentIntent? intent = null;
            if (dto.PaymentIntentId.HasValue)
            {
                intent = await _db.PaymentIntents.FirstOrDefaultAsync(p => p.Id == dto.PaymentIntentId.Value, ct);
                if (intent == null) return NotFound(new { message = "Payment intent not found." });
                if (intent.TenantId != invoice.TenantId) return BadRequest(new { message = "Payment belongs to another tenant." });
            }

            var amount = dto.AmountInr ?? intent?.AmountInr ?? Math.Max(0, invoice.TotalInr - invoice.PaidInr);
            invoice.PaidInr = Math.Min(invoice.TotalInr, invoice.PaidInr + Math.Max(0, amount));
            invoice.Status = invoice.PaidInr >= invoice.TotalInr ? "paid" : invoice.PaidInr > 0 ? "partial" : "open";
            invoice.PaymentIntentId = intent?.Id ?? invoice.PaymentIntentId;
            invoice.UpdatedAtUtc = DateTime.UtcNow;

            if (intent != null && intent.Status != "paid")
            {
                intent.Status = "paid";
                intent.ProviderPaymentId = NormalizeNullable(dto.ProviderPaymentId) ?? intent.ProviderPaymentId;
                intent.PaidAtUtc = DateTime.UtcNow;
                _db.PaymentEvents.Add(new PaymentEvent
                {
                    PaymentIntentId = intent.Id,
                    EventType = "invoice.payment.applied",
                    ProviderEventId = intent.ProviderPaymentId,
                    PayloadJson = JsonSerializer.Serialize(new { invoiceId, dto.AmountInr, dto.Note })
                });
            }

            await _db.SaveChangesAsync(ct);
            return Ok(ToInvoiceDto(invoice));
        }

        private async Task<(string orderId, string keyId)> CreateRazorpayOrderAsync(PaymentIntent intent, string tenantSlug, string moduleCode, CancellationToken ct)
        {
            var keyId = _config["Billing:RazorpayKeyId"];
            var keySecret = _config["Billing:RazorpayKeySecret"];
            if (string.IsNullOrWhiteSpace(keyId) || string.IsNullOrWhiteSpace(keySecret))
                throw new InvalidOperationException("Razorpay key id/secret are not configured.");

            using var client = new HttpClient();
            var credentials = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{keyId}:{keySecret}"));
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", credentials);

            var payload = new
            {
                amount = decimal.ToInt32(decimal.Round(intent.AmountInr * 100, 0)),
                currency = intent.Currency,
                receipt = intent.Id.ToString("N"),
                notes = new
                {
                    paymentIntentId = intent.Id.ToString(),
                    tenant = tenantSlug,
                    module = moduleCode
                }
            };

            using var content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
            using var response = await client.PostAsync("https://api.razorpay.com/v1/orders", content, ct);
            var body = await response.Content.ReadAsStringAsync(ct);
            if (!response.IsSuccessStatusCode)
                throw new InvalidOperationException($"Razorpay order creation failed: {(int)response.StatusCode} {body}");

            using var doc = JsonDocument.Parse(body);
            var orderId = doc.RootElement.TryGetProperty("id", out var idNode) ? idNode.GetString() : null;
            if (string.IsNullOrWhiteSpace(orderId))
                throw new InvalidOperationException("Razorpay order response did not include order id.");

            return (orderId, keyId);
        }

        private async Task<bool> UserExistsInTenantAsync(Guid tenantId, string username, string? email, CancellationToken ct)
        {
            var conn = (NpgsqlConnection)_db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);
            var tx = (NpgsqlTransaction?)_db.Database.CurrentTransaction?.GetDbTransaction();

            await using var cmd = new NpgsqlCommand(@"
SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE tenant_id = @tenant_id
      AND (
          lower(trim(username)) = lower(trim(@username))
          OR (@email IS NOT NULL AND lower(trim(email)) = lower(trim(@email)))
      )
);", conn, tx);
            cmd.Parameters.AddWithValue("tenant_id", NpgsqlDbType.Uuid, tenantId);
            cmd.Parameters.AddWithValue("username", NpgsqlDbType.Text, username);
            cmd.Parameters.AddWithValue("email", NpgsqlDbType.Text, (object?)email ?? DBNull.Value);
            var result = await cmd.ExecuteScalarAsync(ct);
            return result is bool exists && exists;
        }

        private sealed record DuplicateTenantUser(
            Guid Id,
            string? Username,
            string? DisplayName,
            string? Email,
            bool UsernameMatches,
            bool EmailMatches);

        private async Task<DuplicateTenantUser?> FindDuplicateTenantUserAsync(
            Guid tenantId,
            string username,
            string? email,
            CancellationToken ct)
        {
            var conn = (NpgsqlConnection)_db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);
            var tx = (NpgsqlTransaction?)_db.Database.CurrentTransaction?.GetDbTransaction();

            await using var cmd = new NpgsqlCommand(@"
SELECT id,
       username,
       displayname,
       email,
       lower(trim(username)) = lower(trim(@username)) AS username_matches,
       (@email IS NOT NULL AND lower(trim(email)) = lower(trim(@email))) AS email_matches
FROM public.users
WHERE tenant_id = @tenant_id
  AND (
      lower(trim(username)) = lower(trim(@username))
      OR (@email IS NOT NULL AND lower(trim(email)) = lower(trim(@email)))
  )
ORDER BY CASE WHEN lower(trim(username)) = lower(trim(@username)) THEN 0 ELSE 1 END
LIMIT 1;", conn, tx);
            cmd.Parameters.AddWithValue("tenant_id", NpgsqlDbType.Uuid, tenantId);
            cmd.Parameters.AddWithValue("username", NpgsqlDbType.Text, username);
            cmd.Parameters.AddWithValue("email", NpgsqlDbType.Text, (object?)email ?? DBNull.Value);

            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return null;

            return new DuplicateTenantUser(
                reader.GetGuid(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                reader.GetBoolean(4),
                reader.GetBoolean(5));
        }

        private sealed record TenantUserCounts(int Total = 0, int Admins = 0, int Staff = 0, int Members = 0, int Volunteers = 0, int Other = 0);
        private sealed record TenantAdminUser(Guid Id, string? UserCode, string? Username, string? DisplayName, string? Email, string? Phone, string? Role);

        private async Task<Dictionary<Guid, TenantUserCounts>> ReadTenantUserCountsAsync(CancellationToken ct)
        {
            var result = new Dictionary<Guid, TenantUserCounts>();
            var conn = (NpgsqlConnection)_db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);

            await using var cmd = new NpgsqlCommand(@"
SELECT
    tenant_id,
    count(*)::int AS total,
    count(*) FILTER (WHERE lower(role::text) IN ('admin', '1'))::int AS admins,
    count(*) FILTER (WHERE lower(role::text) IN ('staff', '2'))::int AS staff,
    count(*) FILTER (WHERE lower(role::text) IN ('member', '3'))::int AS members,
    count(*) FILTER (WHERE lower(role::text) IN ('volunteer', '4'))::int AS volunteers,
    count(*) FILTER (WHERE lower(role::text) NOT IN ('admin', '1', 'staff', '2', 'member', '3', 'volunteer', '4'))::int AS other
FROM public.users
WHERE tenant_id IS NOT NULL
GROUP BY tenant_id;", conn);

            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                var tenantId = rdr.GetGuid(0);
                result[tenantId] = new TenantUserCounts(
                    rdr.GetInt32(1),
                    rdr.GetInt32(2),
                    rdr.GetInt32(3),
                    rdr.GetInt32(4),
                    rdr.GetInt32(5),
                    rdr.GetInt32(6));
            }

            return result;
        }

        private async Task<Dictionary<Guid, List<TenantAdminUser>>> ReadTenantAdminsAsync(CancellationToken ct)
        {
            var result = new Dictionary<Guid, List<TenantAdminUser>>();
            var conn = (NpgsqlConnection)_db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);

            await using var cmd = new NpgsqlCommand(@"
SELECT id, tenant_id, ""UserCode"", username, displayname, email, phone, role::text
FROM public.users
WHERE tenant_id IS NOT NULL
  AND lower(role::text) IN ('admin', '1')
ORDER BY tenant_id, username;", conn);

            await using var rdr = await cmd.ExecuteReaderAsync(ct);
            while (await rdr.ReadAsync(ct))
            {
                var tenantId = rdr.GetGuid(1);
                if (!result.TryGetValue(tenantId, out var admins))
                {
                    admins = new List<TenantAdminUser>();
                    result[tenantId] = admins;
                }

                admins.Add(new TenantAdminUser(
                    rdr.GetGuid(0),
                    rdr["UserCode"] as string,
                    rdr["username"] as string,
                    rdr["displayname"] as string,
                    rdr["email"] as string,
                    rdr["phone"] as string,
                    rdr["role"] as string));
            }

            return result;
        }

        private async Task<Guid> CreateTenantAdminUserAsync(
            Guid tenantId,
            string username,
            string displayName,
            string? email,
            string? phone,
            string password,
            CancellationToken ct)
        {
            var conn = (NpgsqlConnection)_db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);
            var tx = (NpgsqlTransaction?)_db.Database.CurrentTransaction?.GetDbTransaction();

            var roleId = await ResolveAdminRoleIdAsync(conn, tx, ct);
            var passwordHash = new PasswordHasher<object>().HashPassword(null!, password);
            var prefix = await ReadTenantUserCodePrefixAsync(conn, tx, tenantId, ct);
            var userCode = await GenerateTenantUserCodeAsync(conn, tx, prefix, ct);

            await using var cmd = new NpgsqlCommand(@"
INSERT INTO public.users
    (id, tenant_id, ""UserCode"", username, email, phone, displayname, passwordhash, role, joindate)
VALUES
    (gen_random_uuid(), @tenant_id, @user_code, @username, @email, @phone, @displayname, @passwordhash, @role, now())
RETURNING id;", conn, tx);

            cmd.Parameters.AddWithValue("tenant_id", NpgsqlDbType.Uuid, tenantId);
            cmd.Parameters.AddWithValue("user_code", NpgsqlDbType.Text, userCode);
            cmd.Parameters.AddWithValue("username", NpgsqlDbType.Text, username);
            cmd.Parameters.AddWithValue("email", NpgsqlDbType.Text, (object?)email ?? DBNull.Value);
            cmd.Parameters.AddWithValue("phone", NpgsqlDbType.Text, (object?)phone ?? DBNull.Value);
            cmd.Parameters.AddWithValue("displayname", NpgsqlDbType.Text, displayName);
            cmd.Parameters.AddWithValue("passwordhash", NpgsqlDbType.Text, passwordHash);
            cmd.Parameters.AddWithValue("role", NpgsqlDbType.Integer, roleId);

            var id = await cmd.ExecuteScalarAsync(ct);
            return Guid.TryParse(id?.ToString(), out var userId) ? userId : Guid.Empty;
        }

        private async Task<Guid> CreateTenantUserAsync(
            Guid tenantId,
            string username,
            string displayName,
            string? email,
            string? phone,
            string password,
            string roleName,
            CancellationToken ct)
        {
            var conn = (NpgsqlConnection)_db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);
            var tx = (NpgsqlTransaction?)_db.Database.CurrentTransaction?.GetDbTransaction();

            var roleId = await ResolveRoleIdAsync(conn, tx, roleName, roleName == "admin" ? 1 : 3, ct);
            var passwordHash = new PasswordHasher<object>().HashPassword(null!, password);
            var prefix = await ReadTenantUserCodePrefixAsync(conn, tx, tenantId, ct);
            var userCode = await GenerateTenantUserCodeAsync(conn, tx, prefix, ct);

            await using var cmd = new NpgsqlCommand(@"
INSERT INTO public.users
    (id, tenant_id, ""UserCode"", username, email, phone, displayname, passwordhash, role, joindate)
VALUES
    (gen_random_uuid(), @tenant_id, @user_code, @username, @email, @phone, @displayname, @passwordhash, @role, now())
RETURNING id;", conn, tx);

            cmd.Parameters.AddWithValue("tenant_id", NpgsqlDbType.Uuid, tenantId);
            cmd.Parameters.AddWithValue("user_code", NpgsqlDbType.Text, userCode);
            cmd.Parameters.AddWithValue("username", NpgsqlDbType.Text, username);
            cmd.Parameters.AddWithValue("email", NpgsqlDbType.Text, (object?)email ?? DBNull.Value);
            cmd.Parameters.AddWithValue("phone", NpgsqlDbType.Text, (object?)phone ?? DBNull.Value);
            cmd.Parameters.AddWithValue("displayname", NpgsqlDbType.Text, displayName);
            cmd.Parameters.AddWithValue("passwordhash", NpgsqlDbType.Text, passwordHash);
            cmd.Parameters.AddWithValue("role", NpgsqlDbType.Integer, roleId);

            var id = await cmd.ExecuteScalarAsync(ct);
            return Guid.TryParse(id?.ToString(), out var userId) ? userId : Guid.Empty;
        }

        private static async Task<string> GenerateTenantUserCodeAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, string? prefix, CancellationToken ct)
        {
            var cleanPrefix = NormalizeUserCodePrefix(prefix, null);
            for (var attempt = 0; attempt < 50; attempt++)
            {
                var code = $"{cleanPrefix}{Random.Shared.Next(1, 999999):D6}";
                await using var cmd = new NpgsqlCommand(
                    @"SELECT COUNT(*) FROM public.users WHERE ""UserCode"" = @code;",
                    conn,
                    tx);
                cmd.Parameters.AddWithValue("code", NpgsqlDbType.Text, code);
                var exists = Convert.ToInt32(await cmd.ExecuteScalarAsync(ct)) > 0;
                if (!exists) return code;
            }

            return $"{cleanPrefix}{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() % 100000000:D8}";
        }

        private async Task<bool> UserPhoneAlreadyExistsAsync(string? phone, CancellationToken ct)
        {
            var digits = new string((phone ?? string.Empty).Where(char.IsDigit).ToArray());
            if (digits.Length > 10 && digits.StartsWith("91", StringComparison.Ordinal))
                digits = digits[^10..];
            if (digits.Length == 0) return false;

            var conn = (NpgsqlConnection)_db.Database.GetDbConnection();
            if (conn.State != ConnectionState.Open) await conn.OpenAsync(ct);
            var tx = (NpgsqlTransaction?)_db.Database.CurrentTransaction?.GetDbTransaction();
            await using var cmd = new NpgsqlCommand(@"
SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE CASE
        WHEN length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) > 10
             AND regexp_replace(coalesce(phone, ''), '\D', '', 'g') LIKE '91%'
            THEN right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10)
        ELSE regexp_replace(coalesce(phone, ''), '\D', '', 'g')
    END = @phone
);", conn, tx);
            cmd.Parameters.AddWithValue("phone", NpgsqlDbType.Text, digits);
            return Convert.ToBoolean(await cmd.ExecuteScalarAsync(ct));
        }

        private static async Task<string> ReadTenantUserCodePrefixAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, Guid tenantId, CancellationToken ct)
        {
            await using var columnCmd = new NpgsqlCommand(@"
SELECT 1
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'tenants'
  AND column_name = 'user_code_prefix'
LIMIT 1;", conn, tx);
            var hasColumn = await columnCmd.ExecuteScalarAsync(ct) != null;
            if (!hasColumn) return "MHN";

            await using var cmd = new NpgsqlCommand(@"
SELECT user_code_prefix
FROM public.tenants
WHERE id = @tenant_id
LIMIT 1;", conn, tx);
            cmd.Parameters.AddWithValue("tenant_id", NpgsqlDbType.Uuid, tenantId);
            var value = await cmd.ExecuteScalarAsync(ct);
            return NormalizeUserCodePrefix(value?.ToString(), null);
        }

        private static async Task<int> ResolveAdminRoleIdAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, CancellationToken ct)
        {
            return await ResolveRoleIdAsync(conn, tx, "admin", 1, ct);
        }

        private static async Task<int> ResolveRoleIdAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, string roleName, int fallbackRoleId, CancellationToken ct)
        {
            await using var cmd = new NpgsqlCommand(@"
SELECT id
FROM public.roles
WHERE lower(trim(name)) = lower(trim(@role_name))
ORDER BY id
LIMIT 1;", conn, tx);
            cmd.Parameters.AddWithValue("role_name", NpgsqlDbType.Text, roleName);
            var result = await cmd.ExecuteScalarAsync(ct);
            return int.TryParse(result?.ToString(), out var roleId) ? roleId : fallbackRoleId;
        }

        // Combines the live page content with the tenant's shared branding into the one
        // DTO shape the frontend has always consumed as `landing` — field names preserved.
        private static object ToLandingDto(TenantLandingConfig? config, TenantBranding? branding) => new
        {
            logoUrl = branding?.LogoUrl,
            heroImageUrl = config?.HeroImageUrl,
            heroTitle = config?.HeroTitle,
            heroSubtitle = config?.HeroSubtitle,
            heroLayout = config?.HeroLayout ?? "split-card",
            primaryColor = branding?.PrimaryColor ?? "#0f766e",
            accentColor = branding?.AccentColor ?? "#f59e0b",
            neutralColor = branding?.NeutralColor ?? "#f8fafc",
            darkColor = branding?.DarkColor ?? "#0f172a",
            headingFont = branding?.HeadingFont ?? "Inter",
            bodyFont = branding?.BodyFont ?? "Inter",
            contactEmail = branding?.ContactEmail,
            contactPhone = branding?.ContactPhone,
            address = branding?.Address,
            serviceTimes = ParseJson(config?.ServiceTimesJson),
            socialLinks = ParseJson(branding?.SocialLinksJson),
            sections = ParseJson(config?.SectionsJson),
            seoTitle = config?.SeoTitle,
            seoDescription = config?.SeoDescription,
            ogImageUrl = config?.OgImageUrl,
            published = config?.Published ?? false,
            updatedAtUtc = config?.UpdatedAtUtc
        };

        private static object ToBrandingDto(TenantBranding branding) => new
        {
            logoUrl = branding.LogoUrl,
            primaryColor = branding.PrimaryColor,
            accentColor = branding.AccentColor,
            neutralColor = branding.NeutralColor,
            darkColor = branding.DarkColor,
            headingFont = branding.HeadingFont,
            bodyFont = branding.BodyFont,
            contactEmail = branding.ContactEmail,
            contactPhone = branding.ContactPhone,
            address = branding.Address,
            socialLinks = ParseJson(branding.SocialLinksJson),
            updatedAtUtc = branding.UpdatedAtUtc
        };

        private static object ToLandingDraftDto(TenantLandingDraft draft) => new
        {
            heroTitle = draft.HeroTitle,
            heroSubtitle = draft.HeroSubtitle,
            heroImageUrl = draft.HeroImageUrl,
            heroLayout = draft.HeroLayout,
            serviceTimes = ParseJson(draft.ServiceTimesJson),
            sections = ParseJson(draft.SectionsJson),
            seoTitle = draft.SeoTitle,
            seoDescription = draft.SeoDescription,
            ogImageUrl = draft.OgImageUrl,
            updatedAtUtc = draft.UpdatedAtUtc,
            updatedByUserId = draft.UpdatedByUserId
        };

        private void DisableLandingCache()
        {
            Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
            Response.Headers.Pragma = "no-cache";
            Response.Headers.Expires = "0";
        }

        private static (DateTime start, DateTime end) CurrentInvoiceMonth()
        {
            var now = DateTime.UtcNow;
            var start = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc);
            return (start, start.AddMonths(1));
        }

        private static (DateTime start, DateTime end) CurrentInvoicePeriod(int billingDay)
        {
            var now = DateTime.UtcNow;
            return InvoicePeriod(now.Year, now.Month, billingDay);
        }

        private static (DateTime start, DateTime end) InvoicePeriod(int year, int month, int billingDay)
        {
            var day = Math.Clamp(billingDay, 1, 28);
            var start = new DateTime(year, month, day, 0, 0, 0, DateTimeKind.Utc);
            return (start, start.AddMonths(1));
        }

        private static (DateTime start, DateTime end)? ParseCalendarMonth(string? month)
        {
            if (string.IsNullOrWhiteSpace(month)) return null;
            var value = month.Trim();
            if (!DateTime.TryParse($"{value}-01", out var parsed) && !DateTime.TryParse(value, out parsed))
                return null;
            var start = new DateTime(parsed.Year, parsed.Month, 1, 0, 0, 0, DateTimeKind.Utc);
            return (start, start.AddMonths(1));
        }

        private static (DateTime start, DateTime end)? BillingPeriodForMonth(string? month, int billingDay)
        {
            var calendar = ParseCalendarMonth(month);
            return calendar.HasValue
                ? InvoicePeriod(calendar.Value.start.Year, calendar.Value.start.Month, billingDay)
                : null;
        }

        private static (DateTime start, DateTime end)? ParseInvoiceMonth(string? month)
        {
            if (string.IsNullOrWhiteSpace(month)) return null;
            var value = month.Trim();
            if (DateTime.TryParse($"{value}-01", out var parsed) || DateTime.TryParse(value, out parsed))
            {
                var start = new DateTime(parsed.Year, parsed.Month, 1, 0, 0, 0, DateTimeKind.Utc);
                return (start, start.AddMonths(1));
            }
            return null;
        }

        private async Task<int> GetBillingDayAsync(CancellationToken ct)
        {
            var rootId = await _db.Tenants
                .AsNoTracking()
                .Where(t => t.IsRootTenant)
                .Select(t => t.Id)
                .FirstAsync(ct);
            var value = await _db.MinistryAutomationSettings
                .AsNoTracking()
                .Where(s => s.TenantId == rootId && s.Key == BillingDaySettingKey)
                .Select(s => s.Value)
                .FirstOrDefaultAsync(ct);
            _ = int.TryParse(value, out var day);
            return day is >= 1 and <= 28 ? day : 1;
        }

        private async Task EnsurePackagePublishingTablesAsync(CancellationToken ct)
        {
            const string sql = """
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS published_version integer NOT NULL DEFAULT 0;
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS published_at_utc timestamp with time zone NULL;
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'draft';
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS contract_months integer NOT NULL DEFAULT 12;
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS early_exit_penalty_percent numeric(5,2) NOT NULL DEFAULT 10;
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS storage_limit_gb numeric(12,2) NOT NULL DEFAULT 10;
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS ai_tokens_included_monthly bigint NOT NULL DEFAULT 0;
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS storage_overage_price_per_gb_inr numeric(12,2) NOT NULL DEFAULT 0;
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS ai_overage_price_per_million_tokens_inr numeric(12,2) NOT NULL DEFAULT 0;
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS ai_credits_included_inr numeric(12,2) NOT NULL DEFAULT 0;
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS ai_overage_markup_multiplier numeric(6,2) NOT NULL DEFAULT 2.5;
                ALTER TABLE public.tenant_subscriptions
                    ADD COLUMN IF NOT EXISTS applied_plan_version integer NOT NULL DEFAULT 0;
                ALTER TABLE public.tenant_subscriptions
                    ADD COLUMN IF NOT EXISTS contract_ends_at_utc timestamp with time zone NULL;
                CREATE TABLE IF NOT EXISTS public.subscription_plan_publications (
                    id uuid PRIMARY KEY,
                    plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
                    version integer NOT NULL,
                    definition_json jsonb NOT NULL,
                    effective_at_utc timestamp with time zone NOT NULL,
                    published_at_utc timestamp with time zone NOT NULL DEFAULT now(),
                    published_by_user_id uuid NULL,
                    CONSTRAINT ux_subscription_plan_publications_plan_version UNIQUE (plan_id, version)
                );
                CREATE TABLE IF NOT EXISTS public.subscription_plan_pages (
                    plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
                    page_key text NOT NULL,
                    created_at_utc timestamp with time zone NOT NULL DEFAULT now(),
                    PRIMARY KEY (plan_id, page_key)
                );
                ALTER TABLE public.subscription_plan_publications
                    ADD COLUMN IF NOT EXISTS expired_at_utc timestamp with time zone NULL;
                CREATE TABLE IF NOT EXISTS public.package_version_upgrade_requests (
                    id uuid PRIMARY KEY,
                    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
                    plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
                    from_version integer NOT NULL,
                    to_version integer NOT NULL,
                    status text NOT NULL DEFAULT 'pending',
                    email_sent boolean NOT NULL DEFAULT false,
                    created_at_utc timestamp with time zone NOT NULL DEFAULT now(),
                    decided_at_utc timestamp with time zone NULL,
                    CONSTRAINT ux_package_upgrade_request UNIQUE (tenant_id, plan_id, to_version)
                );
                CREATE TABLE IF NOT EXISTS public.package_payment_requests (
                    id uuid PRIMARY KEY,
                    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
                    plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
                    amount_inr numeric(12,2) NOT NULL,
                    upi_transaction_number text NOT NULL,
                    payer_name text NOT NULL,
                    payer_phone text NULL,
                    payer_email text NULL,
                    note text NULL,
                    status text NOT NULL DEFAULT 'pending',
                    reviewed_by text NULL,
                    review_note text NULL,
                    root_email_sent boolean NOT NULL DEFAULT false,
                    tenant_email_sent boolean NOT NULL DEFAULT false,
                    created_at_utc timestamp with time zone NOT NULL DEFAULT now(),
                    reviewed_at_utc timestamp with time zone NULL,
                    CONSTRAINT ux_package_payment_requests_upi UNIQUE (upi_transaction_number)
                );
                CREATE INDEX IF NOT EXISTS ix_package_payment_requests_tenant_plan
                    ON public.package_payment_requests (tenant_id, plan_id, created_at_utc DESC);
                WITH ranked_pending AS (
                    SELECT id, row_number() OVER (
                        PARTITION BY tenant_id, plan_id ORDER BY created_at_utc DESC, id DESC
                    ) AS position
                    FROM public.package_payment_requests
                    WHERE status = 'pending'
                )
                UPDATE public.package_payment_requests request
                SET status = 'rejected',
                    review_note = COALESCE(request.review_note, 'Superseded by a newer pending transaction'),
                    reviewed_at_utc = COALESCE(request.reviewed_at_utc, now())
                FROM ranked_pending ranked
                WHERE request.id = ranked.id AND ranked.position > 1;
                CREATE UNIQUE INDEX IF NOT EXISTS ux_package_payment_requests_pending
                    ON public.package_payment_requests (tenant_id, plan_id)
                    WHERE status = 'pending';
                ALTER TABLE public.package_payment_requests
                    ADD COLUMN IF NOT EXISTS root_email_sent boolean NOT NULL DEFAULT false;
                ALTER TABLE public.package_payment_requests
                    ADD COLUMN IF NOT EXISTS tenant_email_sent boolean NOT NULL DEFAULT false;
                """;
            await _db.Database.ExecuteSqlRawAsync(sql, ct);
        }

        private async Task<List<(Guid planId, string pageKey)>> ReadPackagePageRowsAsync(CancellationToken ct)
        {
            var rows = new List<(Guid planId, string pageKey)>();
            var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
            if (connection.State != ConnectionState.Open) await connection.OpenAsync(ct);
            await using var command = new NpgsqlCommand(
                "SELECT plan_id, page_key FROM public.subscription_plan_pages ORDER BY page_key", connection);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) rows.Add((reader.GetGuid(0), reader.GetString(1)));
            return rows;
        }

        private async Task ReplacePackagePagesAsync(Guid planId, IReadOnlyCollection<string> pageKeys, CancellationToken ct)
        {
            var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
            if (connection.State != ConnectionState.Open) await connection.OpenAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            await using (var delete = new NpgsqlCommand(
                "DELETE FROM public.subscription_plan_pages WHERE plan_id = @plan_id", connection, transaction))
            {
                delete.Parameters.AddWithValue("plan_id", NpgsqlDbType.Uuid, planId);
                await delete.ExecuteNonQueryAsync(ct);
            }
            foreach (var pageKey in pageKeys)
            {
                await using var insert = new NpgsqlCommand(
                    "INSERT INTO public.subscription_plan_pages (plan_id, page_key) VALUES (@plan_id, @page_key)", connection, transaction);
                insert.Parameters.AddWithValue("plan_id", NpgsqlDbType.Uuid, planId);
                insert.Parameters.AddWithValue("page_key", NpgsqlDbType.Text, pageKey);
                await insert.ExecuteNonQueryAsync(ct);
            }
            await transaction.CommitAsync(ct);
        }

        private static string HumanizePageKey(string key) =>
            string.Join(" ", key.Split('_', StringSplitOptions.RemoveEmptyEntries)
                .Select(part => char.ToUpperInvariant(part[0]) + part[1..].ToLowerInvariant()));

        private async Task CreatePackageUpgradeRequestAsync(TenantSubscription subscription, SubscriptionPlan plan, int version, CancellationToken ct)
        {
            var tenant = await _db.Tenants.AsNoTracking().FirstAsync(t => t.Id == subscription.TenantId, ct);
            var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
            if (connection.State != ConnectionState.Open) await connection.OpenAsync(ct);
            await using var command = new NpgsqlCommand(@"
INSERT INTO public.package_version_upgrade_requests
    (id, tenant_id, plan_id, from_version, to_version, status)
VALUES (@id, @tenant_id, @plan_id, @from_version, @to_version, 'pending')
ON CONFLICT (tenant_id, plan_id, to_version) DO NOTHING;", connection);
            command.Parameters.AddWithValue("id", NpgsqlDbType.Uuid, Guid.NewGuid());
            command.Parameters.AddWithValue("tenant_id", NpgsqlDbType.Uuid, subscription.TenantId);
            command.Parameters.AddWithValue("plan_id", NpgsqlDbType.Uuid, plan.Id);
            command.Parameters.AddWithValue("from_version", NpgsqlDbType.Integer, subscription.AppliedPlanVersion);
            command.Parameters.AddWithValue("to_version", NpgsqlDbType.Integer, version);
            var created = await command.ExecuteNonQueryAsync(ct) > 0;
            if (!created || string.IsNullOrWhiteSpace(tenant.ContactEmail)) return;
            try
            {
                var subject = $"{plan.Name} v{version} is available for your approval";
                var html = $"<p>Jai Masih Di {WebUtility.HtmlEncode(tenant.ContactName ?? tenant.Name)},</p>" +
                           $"<p>A new version of <strong>{WebUtility.HtmlEncode(plan.Name)}</strong> is available. " +
                           $"You are currently on v{subscription.AppliedPlanVersion}. Your current version and billing will remain unchanged unless you approve the upgrade.</p>" +
                           "<p>Please sign in to Mahima and open Subscriptions to review and accept or decline the update. " +
                           "If accepted, the new access and price apply immediately and the current invoice is recalculated pro-rata.</p>";
                await _email.SendAsync(tenant.ContactEmail, subject, html,
                    $"A new version of {plan.Name} is available. Sign in to Subscriptions to accept or remain on your current version.");
                await using var sent = new NpgsqlCommand(@"
UPDATE public.package_version_upgrade_requests SET email_sent = true
WHERE tenant_id = @tenant_id AND plan_id = @plan_id AND to_version = @version;", connection);
                sent.Parameters.AddWithValue("tenant_id", NpgsqlDbType.Uuid, tenant.Id);
                sent.Parameters.AddWithValue("plan_id", NpgsqlDbType.Uuid, plan.Id);
                sent.Parameters.AddWithValue("version", NpgsqlDbType.Integer, version);
                await sent.ExecuteNonQueryAsync(ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not email package upgrade request to tenant {TenantId}", tenant.Id);
            }
        }

        private async Task<List<(Guid planId, int version)>> ReadPendingPackageUpgradesAsync(Guid tenantId, CancellationToken ct)
        {
            var result = new List<(Guid planId, int version)>();
            var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
            if (connection.State != ConnectionState.Open) await connection.OpenAsync(ct);
            await using var command = new NpgsqlCommand(@"
SELECT r.plan_id, r.to_version FROM public.package_version_upgrade_requests r
JOIN public.subscription_plans p ON p.id=r.plan_id AND p.enabled AND p.lifecycle_status='published'
WHERE r.tenant_id = @tenant_id AND r.status = 'pending';", connection);
            command.Parameters.AddWithValue("tenant_id", NpgsqlDbType.Uuid, tenantId);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) result.Add((reader.GetGuid(0), reader.GetInt32(1)));
            return result;
        }

        private async Task<(bool created, Guid id)> InsertPackagePaymentRequestAsync(
            Guid tenantId,
            Guid planId,
            SubmitPackagePaymentRequest dto,
            CancellationToken ct)
        {
            var id = Guid.NewGuid();
            try
            {
                await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO public.package_payment_requests
                        (id, tenant_id, plan_id, amount_inr, upi_transaction_number, payer_name,
                         payer_phone, payer_email, note, status, created_at_utc)
                    VALUES
                        ({id}, {tenantId}, {planId}, {dto.AmountInr}, {dto.UpiTransactionNumber},
                         {dto.PayerName}, {NormalizeNullable(dto.PayerPhone)}, {NormalizeNullable(dto.PayerEmail)},
                         {NormalizeNullable(dto.Note)}, 'pending', now());
                    """, ct);
                return (true, id);
            }
            catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
            {
                return (false, Guid.Empty);
            }
        }

        private async Task<bool> TrySendPackagePaymentSubmittedEmailAsync(
            Tenant tenant,
            SubscriptionPlan plan,
            SubmitPackagePaymentRequest payment,
            Guid requestId,
            CancellationToken ct)
        {
            try
            {
                var sambit = await FindSambitAsync(ct);
                var rootEmail = NormalizeNullable(sambit?.Email) ?? "sambit.rout@mahimaministries.in";
                var subject = $"UPI add-on verification required: {tenant.Name} - {plan.Name}";
                var html = $"""
                    <h2>New add-on donation transaction</h2>
                    <p><strong>Tenant:</strong> {WebUtility.HtmlEncode(tenant.Name)} ({WebUtility.HtmlEncode(tenant.Slug)})</p>
                    <p><strong>Add-on:</strong> {WebUtility.HtmlEncode(plan.Name)}</p>
                    <p><strong>Amount:</strong> Rs {payment.AmountInr:0.00}</p>
                    <p><strong>UPI reference:</strong> {WebUtility.HtmlEncode(payment.UpiTransactionNumber)}</p>
                    <p><strong>Payer:</strong> {WebUtility.HtmlEncode(payment.PayerName)}</p>
                    <p>Open Root Administration → Add-On Donation Verification. Verify the bank transaction before selecting <strong>Verify &amp; Activate</strong>.</p>
                    """;
                await _email.SendAsync(rootEmail, subject, html);
                await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE public.package_payment_requests SET root_email_sent = true WHERE id = {requestId};
                    """, ct);
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Root-admin email failed for package payment request {RequestId}", requestId);
                return false;
            }
        }

        private async Task<bool> TrySendPackagePaymentDecisionEmailAsync(
            PackagePaymentRow request,
            bool approved,
            string? reviewNote,
            CancellationToken ct)
        {
            try
            {
                var tenant = await _db.Tenants.AsNoTracking().FirstAsync(t => t.Id == request.TenantId, ct);
                var recipients = await _db.Users.AsNoTracking()
                    .Where(user =>
                        user.TenantId == request.TenantId &&
                        user.Email != null &&
                        (user.Role.ToLower() == "admin" || user.Role.ToLower() == "administrator"))
                    .Select(user => user.Email!)
                    .Distinct()
                    .ToListAsync(ct);
                if (!string.IsNullOrWhiteSpace(tenant.ContactEmail))
                    recipients.Add(tenant.ContactEmail);
                recipients = recipients.Where(email => !string.IsNullOrWhiteSpace(email))
                    .Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                if (recipients.Count == 0) return false;

                var subject = approved
                    ? $"Add-on activated: {request.PlanName}"
                    : $"Add-on payment requires attention: {request.PlanName}";
                var statusMessage = approved
                    ? "The UPI transaction was verified and the add-on is now active for your tenant."
                    : "The UPI transaction could not be verified. The add-on remains unavailable; you may submit a new transaction reference.";
                var html = $"""
                    <h2>{WebUtility.HtmlEncode(subject)}</h2>
                    <p><strong>Tenant:</strong> {WebUtility.HtmlEncode(tenant.Name)}</p>
                    <p><strong>Add-on:</strong> {WebUtility.HtmlEncode(request.PlanName ?? "")}</p>
                    <p><strong>UPI reference:</strong> {WebUtility.HtmlEncode(request.UpiTransactionNumber)}</p>
                    <p>{WebUtility.HtmlEncode(statusMessage)}</p>
                    {(string.IsNullOrWhiteSpace(reviewNote) ? "" : $"<p><strong>Review note:</strong> {WebUtility.HtmlEncode(reviewNote)}</p>")}
                    <p>Open the Mahima Subscriptions page to view the current state.</p>
                    """;
                foreach (var recipient in recipients)
                    await _email.SendAsync(recipient, subject, html);
                await _db.Database.ExecuteSqlInterpolatedAsync($"""
                    UPDATE public.package_payment_requests SET tenant_email_sent = true WHERE id = {request.Id};
                    """, ct);
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Tenant-admin email failed for package payment request {RequestId}", request.Id);
                return false;
            }
        }

        private async Task<List<PackagePaymentRow>> ReadPackagePaymentRequestsAsync(
            Guid? tenantId,
            string? status,
            CancellationToken ct)
        {
            var rows = new List<PackagePaymentRow>();
            var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
            if (connection.State != ConnectionState.Open) await connection.OpenAsync(ct);
            await using var command = new NpgsqlCommand("""
                SELECT r.id, r.tenant_id, r.plan_id, r.status, r.amount_inr,
                       r.upi_transaction_number, r.payer_name, r.payer_phone, r.payer_email,
                       r.note, r.created_at_utc, t.name, t.slug, p.name
                FROM public.package_payment_requests r
                JOIN public.tenants t ON t.id = r.tenant_id
                JOIN public.subscription_plans p ON p.id = r.plan_id
                WHERE (@tenant_id IS NULL OR r.tenant_id = @tenant_id)
                  AND (@status IS NULL OR r.status = @status)
                ORDER BY r.created_at_utc DESC;
                """, connection);
            command.Parameters.Add(new NpgsqlParameter("tenant_id", NpgsqlDbType.Uuid)
            {
                Value = tenantId.HasValue ? tenantId.Value : DBNull.Value
            });
            command.Parameters.Add(new NpgsqlParameter("status", NpgsqlDbType.Text)
            {
                Value = string.IsNullOrWhiteSpace(status) ? DBNull.Value : status.Trim().ToLowerInvariant()
            });
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                rows.Add(new PackagePaymentRow(
                    reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3),
                    reader.GetDecimal(4), reader.GetString(5), reader.GetString(6),
                    reader.IsDBNull(7) ? null : reader.GetString(7),
                    reader.IsDBNull(8) ? null : reader.GetString(8),
                    reader.IsDBNull(9) ? null : reader.GetString(9),
                    reader.GetDateTime(10), reader.GetString(11), reader.GetString(12), reader.GetString(13)));
            }
            return rows;
        }

        private async Task ReviewPackagePaymentRequestAsync(
            Guid requestId,
            string status,
            string? note,
            string reviewedBy,
            CancellationToken ct)
        {
            var affected = await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE public.package_payment_requests
                SET status = {status}, reviewed_by = {reviewedBy},
                    review_note = {NormalizeNullable(note)}, reviewed_at_utc = now()
                WHERE id = {requestId} AND status = 'pending';
                """, ct);
            if (affected == 0)
                throw new InvalidOperationException("Pending payment request not found.");
        }

        private async Task<bool> PackageUpgradeIsPendingAsync(Guid tenantId, Guid planId, int version, CancellationToken ct)
        {
            var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
            if (connection.State != ConnectionState.Open) await connection.OpenAsync(ct);
            await using var command = new NpgsqlCommand(@"
SELECT EXISTS (
  SELECT 1 FROM public.package_version_upgrade_requests
  WHERE tenant_id = @tenant_id AND plan_id = @plan_id AND to_version = @version AND status = 'pending'
);", connection);
            command.Parameters.AddWithValue("tenant_id", NpgsqlDbType.Uuid, tenantId);
            command.Parameters.AddWithValue("plan_id", NpgsqlDbType.Uuid, planId);
            command.Parameters.AddWithValue("version", NpgsqlDbType.Integer, version);
            return (bool)(await command.ExecuteScalarAsync(ct) ?? false);
        }

        private async Task CompletePackageUpgradeRequestAsync(Guid tenantId, Guid planId, int version, string status, CancellationToken ct)
        {
            await _db.Database.ExecuteSqlInterpolatedAsync($"""
                UPDATE public.package_version_upgrade_requests
                SET status = {status}, decided_at_utc = now()
                WHERE tenant_id = {tenantId} AND plan_id = {planId} AND to_version = {version};
                """, ct);
        }

        private static string PackageLicenseSource(Guid planId) =>
            $"plan:{planId:N}"[..32];

        private async Task RetirePackageAsync(SubscriptionPlan plan, string status, CancellationToken ct)
        {
            var now = DateTime.UtcNow;
            plan.LifecycleStatus = status;
            plan.Enabled = false;
            plan.UpdatedAtUtc = now;
            foreach (var publication in await _db.SubscriptionPlanPublications.Where(p => p.PlanId == plan.Id).ToListAsync(ct))
                publication.ExpiredAtUtc ??= now;
            foreach (var subscription in await _db.TenantSubscriptions.Where(s => s.PlanId == plan.Id && s.Status != "terminated").ToListAsync(ct))
            {
                subscription.Status = "expired";
                subscription.EndsAtUtc = now;
                subscription.UpdatedAtUtc = now;
            }
            var source = PackageLicenseSource(plan.Id);
            foreach (var license in await _db.TenantModuleLicenses.Where(l => l.Source == source && l.Status == "active").ToListAsync(ct))
            {
                license.Status = "expired";
                license.EndsAtUtc = now;
                license.UpdatedAtUtc = now;
            }
            // Caller saves all retirement changes in one EF transaction. Historical
            // subscriptions, publications and billing references are retained.
        }

        private async Task<bool> HasActivePackageLicenseAsync(Guid tenantId, Guid planId, CancellationToken ct)
        {
            var source = PackageLicenseSource(planId);
            var now = DateTime.UtcNow;
            return await _db.TenantModuleLicenses.AsNoTracking().AnyAsync(license =>
                license.TenantId == tenantId &&
                license.Source == source &&
                license.Status == "active" &&
                license.StartsAtUtc <= now &&
                (license.EndsAtUtc == null || license.EndsAtUtc > now), ct);
        }

        private async Task RepairStaleAddOnSubscriptionsAsync(Guid tenantId, CancellationToken ct)
        {
            var activeSubscriptions = await _db.TenantSubscriptions
                .Where(subscription => subscription.TenantId == tenantId && subscription.Status == "active")
                .ToListAsync(ct);
            if (activeSubscriptions.Count == 0) return;
            var now = DateTime.UtcNow;
            var changed = false;
            foreach (var subscription in activeSubscriptions)
            {
                if (await HasActivePackageLicenseAsync(tenantId, subscription.PlanId, ct)) continue;
                subscription.Status = "revoked";
                subscription.EndsAtUtc = now;
                subscription.UpdatedAtUtc = now;
                changed = true;
            }
            if (changed) await _db.SaveChangesAsync(ct);
        }

        private async Task RestoreReplacedAddOnsAsync(Guid tenantId, CancellationToken ct)
        {
            var latestSubscriptions = await _db.TenantSubscriptions
                .Where(s => s.TenantId == tenantId)
                .OrderByDescending(s => s.StartsAtUtc)
                .ThenByDescending(s => s.CreatedAtUtc)
                .ToListAsync(ct);
            var replaced = latestSubscriptions
                .GroupBy(s => s.PlanId)
                .Select(group => group.First())
                .Where(s => s.Status == "replaced")
                .ToList();
            if (replaced.Count == 0) return;

            var planIds = replaced.Select(s => s.PlanId).ToList();
            var plans = await _db.SubscriptionPlans.AsNoTracking()
                .Include(p => p.Modules).ThenInclude(pm => pm.Module)
                .Where(p => planIds.Contains(p.Id) && p.LifecycleStatus == "published" && p.Enabled)
                .ToDictionaryAsync(p => p.Id, ct);
            var now = DateTime.UtcNow;
            foreach (var subscription in replaced.Where(s => plans.ContainsKey(s.PlanId)))
            {
                subscription.Status = "active";
                subscription.EndsAtUtc = null;
                subscription.UpdatedAtUtc = now;
                await ApplyPublishedPackageAsync(
                    subscription, plans[subscription.PlanId], now,
                    plans[subscription.PlanId].PublishedVersion, ct);
            }
            await _db.SaveChangesAsync(ct);
            await RecalculateCurrentOpenInvoiceAsync(tenantId, ct);
            await _db.SaveChangesAsync(ct);
        }

        private async Task EndPackageLicensesAsync(TenantSubscription subscription, DateTime endedAt, CancellationToken ct)
        {
            var source = PackageLicenseSource(subscription.PlanId);
            var licenses = await _db.TenantModuleLicenses
                .Where(l => l.TenantId == subscription.TenantId && l.Source == source && l.Status == "active")
                .ToListAsync(ct);
            foreach (var license in licenses)
            {
                license.Status = "terminated";
                license.EndsAtUtc = endedAt;
                license.UpdatedAtUtc = endedAt;
            }
        }

        private async Task AddEarlyExitPenaltyAsync(Guid tenantId, SubscriptionPlan plan, decimal penalty, string action, CancellationToken ct)
        {
            var period = CurrentInvoicePeriod(await GetBillingDayAsync(ct));
            var invoice = await _db.BillingInvoices.Include(i => i.Lines)
                .FirstOrDefaultAsync(i => i.TenantId == tenantId && i.PeriodStartUtc == period.start, ct);
            if (invoice == null)
            {
                var tenant = await _db.Tenants.AsNoTracking().FirstAsync(t => t.Id == tenantId, ct);
                invoice = new BillingInvoice
                {
                    TenantId = tenantId,
                    InvoiceNumber = $"MIC-{period.start:yyyyMM}-{tenant.Slug}".ToUpperInvariant(),
                    PeriodStartUtc = period.start,
                    PeriodEndUtc = period.end,
                    Status = "open"
                };
                _db.BillingInvoices.Add(invoice);
            }
            invoice.Lines.Add(new BillingInvoiceLine
            {
                ModuleCode = plan.Modules.FirstOrDefault()?.ModuleCode ?? LicensingService.BaseModule,
                Description = $"{plan.Name} early {action} penalty ({plan.EarlyExitPenaltyPercent:0.##}%)",
                Quantity = 1, UnitPriceInr = penalty, AmountInr = penalty
            });
            invoice.SubtotalInr += penalty;
            invoice.TotalInr += penalty;
            invoice.UpdatedAtUtc = DateTime.UtcNow;
            await _db.SaveChangesAsync(ct);
        }

        private async Task ApplyPublishedPackageAsync(
            TenantSubscription subscription,
            SubscriptionPlan plan,
            DateTime effectiveAt,
            int version,
            CancellationToken ct)
        {
            var source = PackageLicenseSource(plan.Id);
            var moduleCodes = plan.Modules.Select(m => m.ModuleCode).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var activeLicenses = await _db.TenantModuleLicenses
                .Where(l => l.TenantId == subscription.TenantId && l.Status == "active" &&
                            l.StartsAtUtc <= effectiveAt && (l.EndsAtUtc == null || l.EndsAtUtc > effectiveAt) &&
                            (moduleCodes.Contains(l.ModuleCode) || l.Source == source))
                .ToListAsync(ct);

            var weightedModules = plan.Modules.OrderBy(m => m.Module?.DisplayOrder ?? 0).ToList();
            var catalogTotal = weightedModules.Sum(m => Math.Max(0, m.Module?.MonthlyPriceInr ?? 0));
            var allocations = new Dictionary<string, decimal>(StringComparer.OrdinalIgnoreCase);
            decimal allocated = 0;
            for (var index = 0; index < weightedModules.Count; index++)
            {
                var item = weightedModules[index];
                var price = index == weightedModules.Count - 1
                    ? plan.MonthlyPriceInr - allocated
                    : catalogTotal > 0
                        ? Math.Round(plan.MonthlyPriceInr * Math.Max(0, item.Module?.MonthlyPriceInr ?? 0) / catalogTotal, 2)
                        : index == 0 ? plan.MonthlyPriceInr : 0;
                price = Math.Max(0, price);
                allocations[item.ModuleCode] = price;
                allocated += price;
            }

            foreach (var license in activeLicenses)
            {
                var belongsToThisPackage = string.Equals(license.Source, source, StringComparison.OrdinalIgnoreCase);
                var remainsInPackage = allocations.TryGetValue(license.ModuleCode, out var newPrice);
                var isUnchangedPackageLicense = belongsToThisPackage && remainsInPackage && license.PriceInr == newPrice;
                if (!isUnchangedPackageLicense && (belongsToThisPackage || remainsInPackage))
                {
                    license.EndsAtUtc = effectiveAt;
                    license.Status = "superseded";
                    license.UpdatedAtUtc = DateTime.UtcNow;
                }
            }

            // The database permits only one active license per tenant/module. Persist
            // superseded rows before inserting their package-priced replacements.
            if (activeLicenses.Any(l => l.Status == "superseded"))
                await _db.SaveChangesAsync(ct);

            foreach (var moduleCode in moduleCodes)
            {
                var price = allocations[moduleCode];
                var unchanged = activeLicenses.Any(l =>
                    l.ModuleCode == moduleCode &&
                    l.Status == "active" &&
                    string.Equals(l.Source, source, StringComparison.OrdinalIgnoreCase) &&
                    l.PriceInr == price);
                if (unchanged) continue;
                _db.TenantModuleLicenses.Add(new TenantModuleLicense
                {
                    TenantId = subscription.TenantId,
                    ModuleCode = moduleCode,
                    Status = "active",
                    PriceInr = price,
                    Source = source,
                    StartsAtUtc = effectiveAt,
                    CreatedAtUtc = DateTime.UtcNow,
                    UpdatedAtUtc = DateTime.UtcNow
                });
            }
            subscription.AppliedPlanVersion = version;
            subscription.UpdatedAtUtc = DateTime.UtcNow;
        }

        private async Task RecalculateCurrentOpenInvoiceAsync(Guid tenantId, CancellationToken ct)
        {
            var period = CurrentInvoicePeriod(await GetBillingDayAsync(ct));
            var invoice = await _db.BillingInvoices.Include(i => i.Lines)
                .FirstOrDefaultAsync(i => i.TenantId == tenantId && i.PeriodStartUtc == period.start &&
                                          (i.Status == "open" || i.Status == "partial"), ct);
            if (invoice == null) return;

            var licenses = await _db.TenantModuleLicenses.AsNoTracking().Include(l => l.Module)
                .Where(l => l.TenantId == tenantId &&
                            (l.Status == "active" || l.Status == "superseded" || l.Status == "terminated") &&
                            l.StartsAtUtc < period.end &&
                            (l.EndsAtUtc == null || l.EndsAtUtc > period.start))
                .ToListAsync(ct);
            var groups = licenses.GroupBy(l => l.ModuleCode).ToDictionary(g => g.Key, StringComparer.OrdinalIgnoreCase);
            foreach (var staleLine in invoice.Lines.Where(line => !groups.ContainsKey(line.ModuleCode)).ToList())
                _db.BillingInvoiceLines.Remove(staleLine);
            foreach (var group in groups.Values)
            {
                var latest = group.OrderByDescending(l => l.StartsAtUtc).First();
                var amount = group.Sum(segment =>
                    CalculateInvoiceAmount(segment.PriceInr, segment.StartsAtUtc, segment.EndsAtUtc, period.start, period.end, true));
                var line = invoice.Lines.FirstOrDefault(item => item.ModuleCode == group.Key);
                if (line == null)
                {
                    line = new BillingInvoiceLine { ModuleCode = group.Key, Quantity = 1 };
                    invoice.Lines.Add(line);
                }
                line.Description = latest.Module?.Name ?? group.Key;
                line.UnitPriceInr = latest.PriceInr;
                line.AmountInr = amount;
            }
            invoice.SubtotalInr = invoice.Lines.Where(line => groups.ContainsKey(line.ModuleCode)).Sum(line => line.AmountInr);
            invoice.TaxInr = 0;
            invoice.TotalInr = invoice.SubtotalInr;
            invoice.PaidInr = Math.Min(invoice.PaidInr, invoice.TotalInr);
            invoice.Status = invoice.TotalInr == 0 || invoice.PaidInr >= invoice.TotalInr
                ? "paid" : invoice.PaidInr > 0 ? "partial" : "open";
            invoice.UpdatedAtUtc = DateTime.UtcNow;
        }

        private static decimal CalculateInvoiceAmount(
            decimal monthlyPrice,
            DateTime licenseStart,
            DateTime? licenseEnd,
            DateTime periodStart,
            DateTime periodEnd,
            bool proRata)
        {
            if (!proRata) return monthlyPrice;
            var activeStart = licenseStart > periodStart ? licenseStart : periodStart;
            var activeEnd = licenseEnd.HasValue && licenseEnd.Value < periodEnd ? licenseEnd.Value : periodEnd;
            if (activeEnd <= activeStart) return 0;
            var periodDays = (decimal)(periodEnd - periodStart).TotalDays;
            var activeDays = (decimal)(activeEnd - activeStart).TotalDays;
            return periodDays <= 0
                ? monthlyPrice
                : Math.Round(monthlyPrice * activeDays / periodDays, 2, MidpointRounding.AwayFromZero);
        }

        private static bool IsPenaltyInvoiceLine(BillingInvoiceLine line) =>
            line.Description.Contains("penalty", StringComparison.OrdinalIgnoreCase);

        private async Task SaveBillingChangesWithConcurrencyRecoveryAsync(CancellationToken ct)
        {
            const int maxAttempts = 5;

            for (var attempt = 1; attempt <= maxAttempts; attempt++)
            {
                try
                {
                    await _db.SaveChangesAsync(ct);
                    return;
                }
                catch (DbUpdateConcurrencyException concurrency) when (attempt < maxAttempts)
                {
                    _logger.LogWarning(
                        concurrency,
                        "Recovering billing generation concurrency on attempt {Attempt}/{MaxAttempts} for {Entries}.",
                        attempt,
                        maxAttempts,
                        string.Join(", ", concurrency.Entries.Select(entry =>
                            $"{entry.Metadata.ClrType.Name}:{string.Join("/", entry.Properties.Where(property => property.Metadata.IsPrimaryKey()).Select(property => property.CurrentValue))}")));

                    // Audit entries were produced for the failed save attempt. Detach
                    // them; the retry interceptor will create one clean audit record.
                    foreach (var auditEntry in _db.ChangeTracker.Entries<AuditLog>()
                                 .Where(entry => entry.State == EntityState.Added)
                                 .ToList())
                        auditEntry.State = EntityState.Detached;

                    foreach (var entry in concurrency.Entries)
                    {
                        var databaseValues = await entry.GetDatabaseValuesAsync(ct);
                        if (databaseValues != null)
                        {
                            // Billing generation is authoritative for calculated fields.
                            entry.OriginalValues.SetValues(databaseValues);
                            continue;
                        }

                        if (entry.State == EntityState.Deleted)
                        {
                            // Another reconciliation already removed it.
                            entry.State = EntityState.Detached;
                        }
                        else if (entry.Entity is BillingInvoice or BillingInvoiceLine)
                        {
                            // Recreate a calculated row that disappeared after loading.
                            entry.State = EntityState.Added;
                        }
                        else
                        {
                            throw;
                        }
                    }
                }
            }
        }

        private static string BuildInvoiceNumber(DateTime periodStart, string? tenantSlug, Guid tenantId)
        {
            const int maximumLength = 80;
            var prefix = $"MIC-{periodStart:yyyyMM}-";
            var suffix = $"-{tenantId:N}"[..9];
            var normalizedSlug = new string((tenantSlug ?? "tenant")
                .Trim()
                .ToUpperInvariant()
                .Select(character => char.IsLetterOrDigit(character) || character == '-' ? character : '-')
                .ToArray())
                .Trim('-');
            if (string.IsNullOrWhiteSpace(normalizedSlug)) normalizedSlug = "TENANT";
            var allowedSlugLength = Math.Max(1, maximumLength - prefix.Length - suffix.Length);
            if (normalizedSlug.Length > allowedSlugLength)
                normalizedSlug = normalizedSlug[..allowedSlugLength].TrimEnd('-');
            return $"{prefix}{normalizedSlug}{suffix}";
        }

        private async Task EnsureCurrentMonthBillingForModuleAsync(
            Guid tenantId,
            string moduleCode,
            string moduleName,
            decimal priceInr,
            Guid? paymentIntentId,
            CancellationToken ct)
        {
            var period = CurrentInvoiceMonth();
            var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == tenantId, ct);
            if (tenant == null) return;

            var invoice = await _db.BillingInvoices
                .Include(i => i.Lines)
                .FirstOrDefaultAsync(i => i.TenantId == tenantId && i.PeriodStartUtc == period.start, ct);

            if (invoice == null)
            {
                invoice = new BillingInvoice
                {
                    TenantId = tenantId,
                    InvoiceNumber = $"MIC-{period.start:yyyyMM}-{tenant.Slug}".ToUpperInvariant(),
                    PeriodStartUtc = period.start,
                    PeriodEndUtc = period.end,
                    Currency = "INR",
                    Status = "open",
                    PaymentIntentId = paymentIntentId,
                    CreatedAtUtc = DateTime.UtcNow,
                    UpdatedAtUtc = DateTime.UtcNow
                };
                _db.BillingInvoices.Add(invoice);
            }
            else if (paymentIntentId.HasValue && invoice.PaymentIntentId == null)
            {
                invoice.PaymentIntentId = paymentIntentId;
            }

            var code = NormalizeCode(moduleCode);
            var line = invoice.Lines.FirstOrDefault(l => l.ModuleCode == code);
            if (line == null)
            {
                invoice.Lines.Add(new BillingInvoiceLine
                {
                    ModuleCode = code,
                    Description = string.IsNullOrWhiteSpace(moduleName) ? code : moduleName,
                    Quantity = 1,
                    UnitPriceInr = Math.Max(0, priceInr),
                    AmountInr = Math.Max(0, priceInr),
                    CreatedAtUtc = DateTime.UtcNow
                });
            }
            else
            {
                line.Description = string.IsNullOrWhiteSpace(moduleName) ? code : moduleName;
                line.UnitPriceInr = Math.Max(0, priceInr);
                line.AmountInr = Math.Max(0, priceInr);
            }

            invoice.SubtotalInr = invoice.Lines.Sum(l => l.AmountInr);
            invoice.TaxInr = 0;
            invoice.TotalInr = invoice.SubtotalInr + invoice.TaxInr;
            invoice.PaidInr = invoice.TotalInr == 0 ? 0 : Math.Min(invoice.PaidInr, invoice.TotalInr);
            invoice.Status = invoice.TotalInr == 0 ? "paid" : invoice.PaidInr >= invoice.TotalInr ? "paid" : invoice.PaidInr > 0 ? "partial" : "open";
            invoice.UpdatedAtUtc = DateTime.UtcNow;

            await _db.SaveChangesAsync(ct);
        }

        private static object ToInvoiceDto(BillingInvoice invoice) => new
        {
            invoice.Id,
            invoice.InvoiceNumber,
            invoice.TenantId,
            tenantName = invoice.Tenant?.Name,
            tenantSlug = invoice.Tenant?.Slug,
            invoice.PeriodStartUtc,
            invoice.PeriodEndUtc,
            invoice.SubtotalInr,
            invoice.TaxInr,
            invoice.TotalInr,
            invoice.PaidInr,
            balanceInr = invoice.TotalInr - invoice.PaidInr,
            invoice.Currency,
            invoice.Status,
            invoice.PaymentIntentId,
            invoice.CreatedAtUtc,
            invoice.UpdatedAtUtc,
            lines = (invoice.Lines ?? new List<BillingInvoiceLine>()).Select(line => new
            {
                line.Id,
                line.ModuleCode,
                line.Description,
                line.Quantity,
                line.UnitPriceInr,
                line.AmountInr
            }),
            paymentRecords = invoice.PaymentIntent == null
                ? Array.Empty<object>()
                : new object[]
                {
                    new
                    {
                        invoice.PaymentIntent.Id,
                        invoice.PaymentIntent.Purpose,
                        invoice.PaymentIntent.ModuleCode,
                        invoice.PaymentIntent.AmountInr,
                        invoice.PaymentIntent.Currency,
                        invoice.PaymentIntent.Provider,
                        invoice.PaymentIntent.Status,
                        invoice.PaymentIntent.ProviderPaymentId,
                        invoice.PaymentIntent.MetadataJson,
                        invoice.PaymentIntent.CreatedAtUtc,
                        invoice.PaymentIntent.PaidAtUtc,
                        events = (invoice.PaymentIntent.Events ?? new List<PaymentEvent>())
                            .OrderByDescending(e => e.CreatedAtUtc)
                            .Select(e => new
                            {
                                e.Id,
                                e.EventType,
                                e.ProviderEventId,
                                e.PayloadJson,
                                e.CreatedAtUtc
                            })
                    }
                }
        };

        private static object ToDonationRecordDto(PaymentIntent intent) => new
        {
            intent.Id,
            intent.TenantId,
            tenantName = intent.Tenant?.Name,
            tenantSlug = intent.Tenant?.Slug,
            intent.ModuleCode,
            moduleName = intent.Module?.Name,
            intent.AmountInr,
            intent.Currency,
            intent.Provider,
            intent.Status,
            intent.ProviderPaymentId,
            intent.MetadataJson,
            intent.CreatedAtUtc,
            intent.ExpiresAtUtc
        };

        private async Task LinkPaymentIntentToOpenInvoiceAsync(PaymentIntent intent, CancellationToken ct)
        {
            var invoice = await _db.BillingInvoices
                .Where(i => i.TenantId == intent.TenantId && i.Status != "paid")
                .OrderBy(i => i.PeriodStartUtc)
                .FirstOrDefaultAsync(ct);

            if (invoice == null)
            {
                var period = CurrentInvoiceMonth();
                invoice = await _db.BillingInvoices
                    .Include(i => i.Lines)
                    .FirstOrDefaultAsync(i => i.TenantId == intent.TenantId && i.PeriodStartUtc == period.start, ct);
                if (invoice == null)
                {
                    var tenant = await _db.Tenants.AsNoTracking().FirstOrDefaultAsync(t => t.Id == intent.TenantId, ct);
                    var module = !string.IsNullOrWhiteSpace(intent.ModuleCode)
                        ? await _db.ModuleCatalog.AsNoTracking().FirstOrDefaultAsync(m => m.Code == intent.ModuleCode, ct)
                        : null;
                    invoice = new BillingInvoice
                    {
                        TenantId = intent.TenantId,
                        InvoiceNumber = $"MIC-{period.start:yyyyMM}-{tenant?.Slug ?? intent.TenantId.ToString("N").Substring(0, 8)}".ToUpperInvariant(),
                        PeriodStartUtc = period.start,
                        PeriodEndUtc = period.end,
                        Status = "open",
                        SubtotalInr = intent.AmountInr,
                        TotalInr = intent.AmountInr,
                        PaidInr = 0,
                        Currency = intent.Currency
                    };
                    invoice.Lines.Add(new BillingInvoiceLine
                    {
                        InvoiceId = invoice.Id,
                        ModuleCode = intent.ModuleCode ?? "donation",
                        Description = module?.Name ?? intent.ModuleCode ?? "Module donation",
                        Quantity = 1,
                        UnitPriceInr = intent.AmountInr,
                        AmountInr = intent.AmountInr
                    });
                    _db.BillingInvoices.Add(invoice);
                }
            }

            invoice.PaymentIntentId = intent.Id;
            invoice.UpdatedAtUtc = DateTime.UtcNow;
        }

        private async Task ApplyPaymentToOpenInvoicesAsync(PaymentIntent intent, CancellationToken ct)
        {
            var invoice = await _db.BillingInvoices
                .Where(i => i.TenantId == intent.TenantId && i.Status != "paid")
                .OrderBy(i => i.PeriodStartUtc)
                .FirstOrDefaultAsync(ct);
            if (invoice == null) return;

            invoice.PaidInr = Math.Min(invoice.TotalInr, invoice.PaidInr + intent.AmountInr);
            invoice.PaymentIntentId = intent.Id;
            invoice.Status = invoice.PaidInr >= invoice.TotalInr ? "paid" : "partial";
            invoice.UpdatedAtUtc = DateTime.UtcNow;
        }

        private static bool IsValidRazorpayCheckoutSignature(string orderId, string paymentId, string signature, string secret)
        {
            if (string.IsNullOrWhiteSpace(orderId) ||
                string.IsNullOrWhiteSpace(paymentId) ||
                string.IsNullOrWhiteSpace(signature)) return false;

            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
            var payload = $"{orderId}|{paymentId}";
            var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(payload));
            var computed = Convert.ToHexString(hash).ToLowerInvariant();
            return CryptographicOperations.FixedTimeEquals(
                Encoding.UTF8.GetBytes(computed),
                Encoding.UTF8.GetBytes(signature.Trim().ToLowerInvariant()));
        }

        private async Task EnsureBillingTablesAsync(CancellationToken ct)
        {
            await _db.Database.ExecuteSqlRawAsync(@"
CREATE TABLE IF NOT EXISTS public.billing_invoices (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    invoice_number varchar(80) NOT NULL UNIQUE,
    period_start_utc timestamptz NOT NULL,
    period_end_utc timestamptz NOT NULL,
    subtotal_inr numeric(12,2) NOT NULL DEFAULT 0,
    tax_inr numeric(12,2) NOT NULL DEFAULT 0,
    total_inr numeric(12,2) NOT NULL DEFAULT 0,
    paid_inr numeric(12,2) NOT NULL DEFAULT 0,
    currency varchar(8) NOT NULL DEFAULT 'INR',
    status varchar(32) NOT NULL DEFAULT 'open',
    payment_intent_id uuid NULL REFERENCES public.payment_intents(id) ON DELETE SET NULL,
    created_at_utc timestamptz NOT NULL DEFAULT now(),
    updated_at_utc timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_billing_invoices_tenant_period
    ON public.billing_invoices (tenant_id, period_start_utc);
CREATE INDEX IF NOT EXISTS ix_billing_invoices_status
    ON public.billing_invoices (status);

CREATE TABLE IF NOT EXISTS public.billing_invoice_lines (
    id uuid PRIMARY KEY,
    invoice_id uuid NOT NULL REFERENCES public.billing_invoices(id) ON DELETE CASCADE,
    module_code varchar(64) NOT NULL REFERENCES public.module_catalog(code) ON DELETE RESTRICT,
    description text NOT NULL,
    quantity integer NOT NULL DEFAULT 1,
    unit_price_inr numeric(12,2) NOT NULL DEFAULT 0,
    amount_inr numeric(12,2) NOT NULL DEFAULT 0,
    created_at_utc timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_billing_invoice_lines_invoice
    ON public.billing_invoice_lines (invoice_id);
", ct);
        }

        private async Task<int> PurgeTenantDataAsync(Guid tenantId, CancellationToken ct)
        {
            var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
            var openedHere = connection.State != ConnectionState.Open;
            if (openedHere) await connection.OpenAsync(ct);
            await using var transaction = await connection.BeginTransactionAsync(ct);
            try
            {
                var scopedTables = new List<(string Schema, string Table, string Column)>();
                const string catalogSql = @"
SELECT c.table_schema, c.table_name, c.column_name
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.column_name IN ('tenant_id', 'TenantId')
  AND c.table_name <> 'tenants'
ORDER BY c.table_name;";
                await using (var catalog = new NpgsqlCommand(catalogSql, connection, transaction))
                await using (var reader = await catalog.ExecuteReaderAsync(ct))
                {
                    while (await reader.ReadAsync(ct))
                        scopedTables.Add((reader.GetString(0), reader.GetString(1), reader.GetString(2)));
                }

                var remaining = new List<(string Schema, string Table, string Column)>(scopedTables);
                var deletedRows = 0;
                for (var pass = 0; pass < scopedTables.Count + 2 && remaining.Count > 0; pass++)
                {
                    var progress = false;
                    foreach (var table in remaining.ToList())
                    {
                        var sql = $"DELETE FROM {QuoteIdentifier(table.Schema)}.{QuoteIdentifier(table.Table)} WHERE {QuoteIdentifier(table.Column)} = @tenantId;";
                        try
                        {
                            await using var command = new NpgsqlCommand(sql, connection, transaction);
                            command.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenantId);
                            deletedRows += await command.ExecuteNonQueryAsync(ct);
                            remaining.Remove(table);
                            progress = true;
                        }
                        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.ForeignKeyViolation)
                        {
                            // A child table is still present; retry this table on the next pass.
                        }
                    }
                    if (!progress) break;
                }

                if (remaining.Count > 0)
                    throw new InvalidOperationException($"Could not purge dependent tenant tables: {string.Join(", ", remaining.Select(t => t.Table).Distinct())}");

                await using (var deleteTenant = new NpgsqlCommand("DELETE FROM public.tenants WHERE id = @tenantId;", connection, transaction))
                {
                    deleteTenant.Parameters.AddWithValue("tenantId", NpgsqlDbType.Uuid, tenantId);
                    if (await deleteTenant.ExecuteNonQueryAsync(ct) != 1)
                        throw new InvalidOperationException("Tenant disappeared before purge completed.");
                }

                await transaction.CommitAsync(ct);
                return deletedRows + 1;
            }
            catch
            {
                await transaction.RollbackAsync(ct);
                throw;
            }
            finally
            {
                if (openedHere) await connection.CloseAsync();
            }
        }

        private static string QuoteIdentifier(string value) => "\"" + value.Replace("\"", "\"\"") + "\"";

        private async Task EnsureTenantModuleRequestsTableAsync(CancellationToken ct)
        {
            await _db.Database.ExecuteSqlRawAsync(@"
CREATE TABLE IF NOT EXISTS public.tenant_module_requests (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    module_code varchar(64) NOT NULL REFERENCES public.module_catalog(code) ON DELETE RESTRICT,
    requested_by_user_id uuid NULL,
    requested_by_name text NULL,
    requested_by_email text NULL,
    status varchar(32) NOT NULL DEFAULT 'pending',
    admin_notes text NULL,
    requested_at_utc timestamptz NOT NULL DEFAULT now(),
    reviewed_at_utc timestamptz NULL,
    reviewed_by_user_id uuid NULL,
    notification_email_sent boolean NOT NULL DEFAULT false,
    jai_masih_message_sent boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenant_module_requests_pending
    ON public.tenant_module_requests (tenant_id, module_code)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_tenant_module_requests_status_requested
    ON public.tenant_module_requests (status, requested_at_utc DESC);
", ct);
        }

        private Guid GetCurrentUserId()
        {
            var id = User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? User.FindFirstValue("sub")
                ?? User.FindFirstValue("nameid");
            return Guid.TryParse(id, out var parsed) ? parsed : Guid.Empty;
        }

        private async Task<User?> FindSambitAsync(CancellationToken ct)
        {
            const string email = "sambit.rout@mahimaministries.in";
            const string username = "sambitr";
            return await _db.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u =>
                    (u.Email != null && u.Email.ToLower() == email) ||
                    (u.Username != null && u.Username.ToLower() == username) ||
                    (u.UserCode != null && u.UserCode.ToUpper() == "SAMBITR") ||
                    (u.DisplayName != null && u.DisplayName.ToLower() == username), ct);
        }

        private async Task AddModuleRequestNotificationAsync(
            TenantModuleRequest request,
            Tenant tenant,
            ModuleCatalogItem module,
            Guid? sambitUserId,
            CancellationToken ct)
        {
            var data = JsonSerializer.Serialize(new
            {
                requestId = request.Id,
                tenantId = request.TenantId,
                tenantName = tenant.Name,
                tenantSlug = tenant.Slug,
                moduleCode = request.ModuleCode,
                moduleName = module.Name,
                monthlyPriceInr = module.MonthlyPriceInr,
                requestedByUserId = request.RequestedByUserId,
                requestedByName = request.RequestedByName,
                requestedByEmail = request.RequestedByEmail
            });

            _db.AdminNotifications.Add(new AdminNotification
            {
                TenantId = tenant.Id,
                UserId = sambitUserId,
                Type = "TenantModuleRequest",
                Message = $"{tenant.Name} requested {module.Name}.",
                Data = data,
                IsRead = false,
                CreatedAt = DateTime.UtcNow
            });
            await _db.SaveChangesAsync(ct);
        }

        private async Task<bool> TrySendModuleRequestEmailAsync(TenantModuleRequest request, Tenant tenant, ModuleCatalogItem module)
        {
            try
            {
                var tenantUrl = BuildTenantPublicUrl(tenant);
                var subject = $"Tenant subscription request: {tenant.Name} - {module.Name}";
                var html = $@"
<h2>New tenant subscription request</h2>
<p><strong>Tenant:</strong> {WebUtility.HtmlEncode(tenant.Name)} ({WebUtility.HtmlEncode(tenant.Slug)})</p>
<p><strong>Tenant URL:</strong> {WebUtility.HtmlEncode(tenantUrl)}</p>
<p><strong>Package:</strong> {WebUtility.HtmlEncode(module.Name)} - Rs {module.MonthlyPriceInr:0}/mo</p>
<p><strong>Requested by:</strong> {WebUtility.HtmlEncode(request.RequestedByName ?? "")} {WebUtility.HtmlEncode(request.RequestedByEmail ?? "")}</p>
<p>Open Mahima Tenant Administration to approve or reject this request.</p>";
                await _email.SendAsync("sambit.rout@mahimaministries.in", subject, html);
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Tenant module request email failed for request {RequestId}", request.Id);
                return false;
            }
        }

        private async Task<bool> TrySendModuleRequestChatAsync(TenantModuleRequest request, Guid requesterId, Guid? sambitUserId)
        {
            if (!sambitUserId.HasValue || requesterId == Guid.Empty || requesterId == sambitUserId.Value)
                return false;

            try
            {
                var chat = await _chat.CreateOrGetDirectChatAsync(requesterId, sambitUserId.Value);
                var message = await _chat.AddMessageAsync(
                    chat.Id,
                    requesterId,
                    $"Subscription approval needed: {request.RequestedByName ?? "Tenant admin"} requested {request.ModuleCode}. Please approve it from Tenant Administration.",
                    "text");

                var members = (await _chat.GetChatMemberIdsAsync(chat.Id)).Distinct().ToList();
                await _hub.Clients.Users(members.Select(id => id.ToString())).SendAsync("ReceiveMessage", message);
                if (_mobilePush != null)
                    await _mobilePush.NotifyChatMessageAsync(chat.Id, requesterId, members, message);
                return true;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Jai Masih module request message failed for request {RequestId}", request.Id);
                return false;
            }
        }

        private static JsonElement? ParseJson(string? json)
        {
            if (string.IsNullOrWhiteSpace(json)) return null;
            try
            {
                return JsonDocument.Parse(json).RootElement.Clone();
            }
            catch
            {
                return null;
            }
        }

        private static string? JsonOrNull(JsonElement? element)
        {
            if (!element.HasValue || element.Value.ValueKind == JsonValueKind.Null || element.Value.ValueKind == JsonValueKind.Undefined)
                return null;
            return element.Value.GetRawText();
        }

        private static string NormalizeSlug(string? value)
        {
            var raw = string.IsNullOrWhiteSpace(value) ? "tenant" : value.Trim().ToLowerInvariant();
            var chars = raw.Select(ch => char.IsLetterOrDigit(ch) ? ch : '-').ToArray();
            return string.Join("-", new string(chars).Split('-', StringSplitOptions.RemoveEmptyEntries));
        }

        private static string NormalizeUserCodePrefix(string? value, string? fallbackSlug)
        {
            var raw = string.IsNullOrWhiteSpace(value) ? fallbackSlug : value;
            var cleaned = new string((raw ?? "MHN").ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
            if (cleaned.Length < 2)
                cleaned = "MHN";
            return cleaned.Length > 12 ? cleaned[..12] : cleaned;
        }

        private static string NormalizeUsername(string? value)
        {
            var raw = string.IsNullOrWhiteSpace(value) ? "church-admin" : value.Trim().ToLowerInvariant();
            var chars = raw.Select(ch => char.IsLetterOrDigit(ch) || ch == '.' || ch == '_' || ch == '-' ? ch : '-').ToArray();
            return string.Join("-", new string(chars).Split('-', StringSplitOptions.RemoveEmptyEntries));
        }

        private static string NormalizeCode(string value)
        {
            var raw = string.IsNullOrWhiteSpace(value) ? "" : value.Trim().ToLowerInvariant();
            var chars = raw.Select(ch => char.IsLetterOrDigit(ch) ? ch : ch == '_' || ch == '-' ? '_' : '_').ToArray();
            return string.Join("_", new string(chars).Split('_', StringSplitOptions.RemoveEmptyEntries));
        }
        private static string? NormalizeNullable(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        private static string NormalizeCountryCode(string? value)
        {
            var code = (value ?? "IN").Trim().ToUpperInvariant();
            return code.Length == 2 && code.All(char.IsLetter) ? code : "IN";
        }

        private static string? NormalizeDomain(string? value)
        {
            if (string.IsNullOrWhiteSpace(value)) return null;
            var domain = value.Trim().ToLowerInvariant();
            if (domain.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
                domain.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                if (Uri.TryCreate(domain, UriKind.Absolute, out var uri))
                    domain = uri.Host;
            }
            domain = domain.Trim().Trim('/').Trim('.');
            if (domain.StartsWith("www.", StringComparison.Ordinal)) domain = domain[4..];
            return domain.Length == 0 ? null : domain;
        }

        private static string NewDomainVerificationToken()
        {
            return $"mahima-verify-{Guid.NewGuid():N}";
        }

        private object? BuildDomainSetupInstructions(Tenant tenant)
        {
            return BuildDomainSetupInstructions(tenant.Domain, tenant.DomainStatus, tenant.DomainVerificationToken);
        }

        private object? BuildDomainSetupInstructions(string? domain, string? domainStatus, string? verificationToken)
        {
            if (string.IsNullOrWhiteSpace(domain)) return null;
            var targetHost = NormalizeNullable(_config["Saas:DomainCnameTarget"])
                ?? NormalizeNullable(_config["Saas:PublicHost"])
                ?? "beta.mahimaministries.in";
            var targetIp = NormalizeNullable(_config["Saas:DomainTargetIp"]);
            return new
            {
                Domain = NormalizeDomain(domain),
                DomainStatus = domainStatus,
                DomainVerificationToken = verificationToken,
                txt = new
                {
                    type = "TXT",
                    host = "_mahima",
                    value = verificationToken
                },
                cname = new
                {
                    type = "CNAME",
                    host = "app",
                    value = targetHost,
                    note = "Use this if the tenant wants a subdomain such as app.churchdomain.org."
                },
                a = new
                {
                    type = "A",
                    host = "@",
                    value = targetIp,
                    note = string.IsNullOrWhiteSpace(targetIp)
                        ? "Set Saas:DomainTargetIp on the server to show the exact root-domain A record target."
                        : "Use this if the tenant wants the root domain itself."
                }
            };
        }

        private async Task<(bool ok, string message)> DomainResolvesToExpectedTargetAsync(string? domain, CancellationToken ct)
        {
            var normalized = NormalizeDomain(domain);
            if (string.IsNullOrWhiteSpace(normalized))
                return (false, "Domain is missing.");

            try
            {
                var addresses = await Dns.GetHostAddressesAsync(normalized, ct);
                if (addresses.Length == 0)
                    return (false, "Domain does not resolve yet. Please wait for DNS propagation.");

                var expectedIp = NormalizeNullable(_config["Saas:DomainTargetIp"]);
                if (!string.IsNullOrWhiteSpace(expectedIp) &&
                    !addresses.Any(a => string.Equals(a.ToString(), expectedIp, StringComparison.OrdinalIgnoreCase)))
                    return (false, $"Domain resolves, but not to the configured server IP {expectedIp}.");

                return (true, "Domain DNS is ready.");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Domain verification DNS lookup failed for {Domain}", normalized);
                return (false, "Domain does not resolve yet. Please check DNS records and try again.");
            }
        }

        private string BuildTenantPublicUrl(Tenant tenant)
        {
            return BuildTenantPublicUrl(tenant.Slug, tenant.Domain);
        }

        private string BuildTenantLoginUrl(Tenant tenant)
        {
            return BuildTenantLoginUrl(tenant.Slug, tenant.Domain);
        }

        private string BuildTenantPublicUrl(string slug, string? domain)
        {
            if (!string.IsNullOrWhiteSpace(domain))
                return $"https://{NormalizeDomain(domain)}/";
            return BuildTenantPublicUrl(slug);
        }

        private string BuildTenantLoginUrl(string slug, string? domain)
        {
            if (!string.IsNullOrWhiteSpace(domain))
                return $"https://{NormalizeDomain(domain)}/#/login";
            return $"{BuildTenantPublicUrl(slug).Split('#')[0]}#/login?tenantSlug={Uri.EscapeDataString(slug)}";
        }

        private string BuildTenantPublicUrl(string slug)
        {
            var baseUrl = NormalizeNullable(_config["Saas:PublicBaseUrl"])
                ?? (Request?.Host.HasValue == true ? $"{Request.Scheme}://{Request.Host.Value}" : null)
                ?? "https://beta.mahimaministries.in";
            return $"{baseUrl.TrimEnd('/')}/#/t/{Uri.EscapeDataString(slug)}";
        }

        private async Task<string?> SaveTenantLogoAsync(IFormFile? logo, string slug, CancellationToken ct)
        {
            if (logo == null || logo.Length == 0) return null;
            if (logo.Length > 5 * 1024 * 1024)
                throw new InvalidOperationException("Church logo must be 5 MB or smaller.");

            var contentType = (logo.ContentType ?? "").ToLowerInvariant();
            if (!contentType.StartsWith("image/"))
                throw new InvalidOperationException("Church logo must be an image file.");

            var extension = Path.GetExtension(logo.FileName ?? "").ToLowerInvariant();
            var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { ".png", ".jpg", ".jpeg", ".webp", ".gif" };
            if (!allowed.Contains(extension))
                extension = contentType switch
                {
                    "image/png" => ".png",
                    "image/webp" => ".webp",
                    "image/gif" => ".gif",
                    _ => ".jpg"
                };

            var uploadRoot = _config["Uploads:Root"]
                ?? Environment.GetEnvironmentVariable("MAHIMA_UPLOADS_ROOT")
                ?? (OperatingSystem.IsLinux()
                    ? "/var/www/mahima-uploads"
                    : Path.Combine(_env.WebRootPath ?? Path.Combine(_env.ContentRootPath, "wwwroot"), "uploads"));
            var folder = Path.Combine(uploadRoot, "tenant-logos", NormalizeSlug(slug));
            Directory.CreateDirectory(folder);

            var fileName = $"{Guid.NewGuid():N}{extension}";
            var path = Path.Combine(folder, fileName);
            await using var stream = System.IO.File.Create(path);
            await logo.CopyToAsync(stream, ct);

            return $"/api/uploads/tenant-logos/{NormalizeSlug(slug)}/{fileName}";
        }

        private static string BuildUpiLink(string vpa, string payee, decimal amount, string txnRef, string note)
        {
            return "upi://pay" +
                   $"?pa={WebUtility.UrlEncode(vpa)}" +
                   $"&pn={WebUtility.UrlEncode(payee)}" +
                   $"&am={WebUtility.UrlEncode(amount.ToString("0.00"))}" +
                   "&cu=INR" +
                   $"&tr={WebUtility.UrlEncode(txnRef)}" +
                   $"&tn={WebUtility.UrlEncode(note)}";
        }
    }
}
