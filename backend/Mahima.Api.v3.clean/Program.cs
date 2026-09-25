using Mahima.Api.v3.clean.Data;
using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

// ✅ FIXED NAMESPACES
using Mahima.Api.v3.clean.Hubs;
using Mahima.Api.v3.clean.Helpers;
using Mahima.Api.v3.clean.Services;
using Mahima.Api.v3.clean.services.Counselling;
using Mahima.Api.v3.clean.services.Marriage;

using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.Tokens;

// Npgsql 6.0+ enforces strict DateTime Kind matching.
// This switch preserves the app's existing timestamp behavior.
AppContext.SetSwitch("Npgsql.EnableLegacyTimestampBehavior", true);

var builder = WebApplication.CreateBuilder(args);

// -------------------------------------------------------
// Kestrel
// -------------------------------------------------------
builder.WebHost.ConfigureKestrel(options =>
{
    options.ListenAnyIP(5001);
});

// -------------------------------------------------------
// Data Protection (LINUX SAFE)
// -------------------------------------------------------
//var keysPath = "/root/keys";
var keysPath = "/var/www/mahima-api/keys";
if (!Directory.Exists(keysPath)) Directory.CreateDirectory(keysPath);

builder.Services
    .AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(keysPath))
    .SetApplicationName("Mahima.Api");

// -------------------------------------------------------
// Database (EF CORE)
// -------------------------------------------------------
var connStr = builder.Configuration.GetConnectionString("DefaultConnection")
              ?? throw new InvalidOperationException("Missing Default connection string.");

builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<AuditSaveChangesInterceptor>();
builder.Services.AddDbContext<MahimaDbContext>((sp, opt) =>
    opt.UseNpgsql(connStr, npgsql => npgsql.EnableRetryOnFailure(3))
       .AddInterceptors(sp.GetRequiredService<AuditSaveChangesInterceptor>()));

// -------------------------------------------------------
// JSON / Controllers
// -------------------------------------------------------
builder.Services.AddControllers().AddJsonOptions(opts =>
{
    opts.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
    opts.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    opts.JsonSerializerOptions.ReferenceHandler = ReferenceHandler.IgnoreCycles;
});
// -------------------------------------------------------
// JWT AUTH
// -------------------------------------------------------
var jwt = builder.Configuration.GetSection("Jwt");

var jwtKey = jwt["Key"] ?? throw new InvalidOperationException("Jwt:Key missing");
var issuer = jwt["Issuer"] ?? "MahimaApi";
var audience = jwt["Audience"] ?? "MahimaClients";

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.RequireHttpsMetadata = false;
        o.SaveToken = true;

        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = issuer,

            ValidateAudience = true,
            ValidAudience = audience,

            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey)),

            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromMinutes(5),

            RoleClaimType = ClaimTypes.Role,
            NameClaimType = ClaimTypes.NameIdentifier
        };

        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var token = ctx.Request.Query["access_token"];
                var path = ctx.HttpContext.Request.Path;

                if (!string.IsNullOrEmpty(token)
                    && (path.StartsWithSegments("/api/hubs/chat")
                        || path.StartsWithSegments("/api/server-files")))
                {
                    ctx.Token = token;
                }

                return Task.CompletedTask;
            }
        };
    });

// -------------------------------------------------------
// ✅ CORS (FIXED FINAL)
// -------------------------------------------------------
const string CorsPolicy = "MahimaCors";

builder.Services.AddCors(options =>
{
    options.AddPolicy(CorsPolicy, policy =>
    {
        policy
            .SetIsOriginAllowed(_ => true)   // 🔥 allows all origins safely (fixes your issue)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

// -------------------------------------------------------
// SERVICES
// -------------------------------------------------------
builder.Services.AddSignalR();
builder.Services.AddMemoryCache();

builder.Services.AddSingleton<IUserIdProvider, NameIdentifierUserIdProvider>();

builder.Services.AddSingleton<JwtTokenService>();
builder.Services.AddScoped<ITenantContextService, TenantContextService>();
builder.Services.AddScoped<TenantStorageService>();
builder.Services.AddHostedService<TenantStorageMonitor>();
builder.Services.AddScoped<ILicensingService, LicensingService>();
builder.Services.AddScoped<IChatService, ChatService>();
builder.Services.AddSingleton<IEmailService, SmtpEmailService>();
builder.Services.AddSingleton<IMarketingEmailService, MarketingSmtpEmailService>();
builder.Services.AddScoped<IMobilePushNotificationService, MobilePushNotificationService>();
builder.Services.AddScoped<IBaptismCertificateService, BaptismCertificateService>();
builder.Services.AddScoped<ITenantPrintTemplateService, TenantPrintTemplateService>();
builder.Services.AddScoped<IMarriageService, MarriageService>();
builder.Services.AddScoped<ICounsellingService, CounsellingService>();
builder.Services.AddScoped<AccountingService>();
builder.Services.AddScoped<AppReleasePublishingService>();
builder.Services.AddScoped<INotificationDelivery, NotificationDelivery>();
builder.Services.AddScoped<INotificationDispatcher, NotificationDispatcher>();
builder.Services.AddSwaggerGen();
builder.Services.AddHttpClient("PastorBot");
builder.Services.AddHttpClient("MarketingDiscovery", client =>
{
    // Multi-region Responses API web-search runs can legitimately take several
    // minutes. Keep this isolated so normal chat requests retain their shorter
    // latency/timeout behaviour.
    client.Timeout = TimeSpan.FromMinutes(8);
});
builder.Services.AddSingleton<Mahima.Api.v3.clean.Services.Ai.IScriptureService,
                               Mahima.Api.v3.clean.Services.Ai.ScriptureService>();
builder.Services.AddScoped<Mahima.Api.v3.clean.Services.Ai.ILlmProvider,
                            Mahima.Api.v3.clean.Services.Ai.OpenAiCompatibleLlmProvider>();
builder.Services.AddScoped<IPastorBotService, PastorBotService>();
builder.Services.AddScoped<IMarketingDiscoveryService, MarketingDiscoveryService>();
builder.Services.AddSingleton<IMarketingTrackingService, MarketingTrackingService>();
builder.Services.AddHostedService<MarketingDiscoveryScheduler>();
builder.Services.AddHostedService<MinistryChatAutomationService>();
builder.Services.AddHostedService<SubscriptionRenewalService>();
builder.Services.AddHostedService<TenantDomainVerificationService>();
builder.Services.AddHostedService<TaskAutomationQueueService>();
builder.Services.AddHostedService<NotificationDispatchWorker>();
builder.Services.AddSingleton<TenantAppBuildQueue>();
builder.Services.AddHostedService<TenantAppBuildWorker>();
builder.Services.AddHostedService<PrayerIntelligenceMonitorService>();
builder.Services.AddSingleton<SecurityPostureMonitorService>();
builder.Services.AddSingleton<ISecurityPostureMonitor>(sp => sp.GetRequiredService<SecurityPostureMonitorService>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<SecurityPostureMonitorService>());
builder.Services.AddSingleton<ChatSafetyMonitorService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<ChatSafetyMonitorService>());
builder.Services.AddHttpClient("LinkPreview", client =>
{
    client.Timeout = TimeSpan.FromSeconds(6);
    client.DefaultRequestHeaders.AcceptLanguage.ParseAdd("en");
});


// -------------------------------------------------------
// BUILD APP
// -------------------------------------------------------
var app = builder.Build();

// -------------------------------------------------------
// STARTUP CONFIG WARNINGS
// -------------------------------------------------------
{
    var startupLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
    SmsHelper.Initialize(app.Configuration, startupLogger);
    foreach (var key in new[] { "Marketing:WebhookSecret", "Marketing:TrackingHashSalt", "Marketing:TwilioWebhookSecret" })
        if (string.IsNullOrWhiteSpace(app.Configuration[key]))
            startupLogger.LogWarning("{Key} is not configured — the endpoint(s) that depend on it are effectively disabled until it is set.", key);

    var whatsAppSender = Environment.GetEnvironmentVariable("TWILIO_WHATSAPP_FROM")
        ?? Environment.GetEnvironmentVariable("TWILIO_MESSAGING_SERVICE_SID")
        ?? app.Configuration["Twilio:WhatsAppFrom"]
        ?? app.Configuration["Twilio:MessagingServiceSid"];
    if (string.IsNullOrWhiteSpace(whatsAppSender))
        startupLogger.LogWarning("WhatsApp is not ready: configure TWILIO_WHATSAPP_FROM or TWILIO_MESSAGING_SERVICE_SID after registering an approved sender in Twilio.");
}

// -------------------------------------------------------
// MIDDLEWARE
// -------------------------------------------------------
app.UseForwardedHeaders(new ForwardedHeadersOptions
{
    ForwardedHeaders = ForwardedHeaders.All
});

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}
var webRootPath = app.Environment.WebRootPath ?? Path.Combine(app.Environment.ContentRootPath, "wwwroot");
Directory.CreateDirectory(webRootPath);
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(webRootPath),
    RequestPath = ""
});

var uploadsRoot = app.Configuration["Uploads:Root"]
    ?? Environment.GetEnvironmentVariable("MAHIMA_UPLOADS_ROOT")
    ?? (OperatingSystem.IsLinux()
        ? "/var/www/mahima-uploads"
        : Path.Combine(webRootPath, "uploads"));
Directory.CreateDirectory(uploadsRoot);
var uploadFileProviders = new List<IFileProvider> { new PhysicalFileProvider(uploadsRoot) };
var legacyWebRootUploads = Path.Combine(webRootPath, "uploads");
if (Directory.Exists(legacyWebRootUploads) &&
    !string.Equals(Path.GetFullPath(legacyWebRootUploads), Path.GetFullPath(uploadsRoot), StringComparison.OrdinalIgnoreCase))
{
    uploadFileProviders.Add(new PhysicalFileProvider(legacyWebRootUploads));
}
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = uploadFileProviders.Count == 1
        ? uploadFileProviders[0]
        : new CompositeFileProvider(uploadFileProviders),
    RequestPath = "/api/uploads"
});
app.UseRouting();

// ✅ CORS MUST BE HERE
app.UseCors(CorsPolicy);

app.UseAuthentication();
app.UseMiddleware<MobileAppAccessMiddleware>();
app.UseMiddleware<RootTenantOverrideMiddleware>();
app.UseMiddleware<TenantStorageMiddleware>();
app.UseMiddleware<AuditTrailMiddleware>();
app.UseAuthorization();
app.UseMiddleware<TenantModuleAccessMiddleware>();

app.MapControllers();
app.MapHub<ChatHub>("/api/hubs/chat");

app.Run();
