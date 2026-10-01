// File: Helpers/SmsHelper.cs
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Twilio;
using Twilio.Exceptions;
using Twilio.Rest.Api.V2010.Account;
using Twilio.Types;

namespace Mahima.Api.v3.clean.Helpers
{
    public sealed record SmsSendResult(bool Success, string? MessageSid, string? ErrorMessage);

    /// <summary>
    /// Static facade preserving the previous static API (Initialize, SendSmsAsync, SendWhatsappAsync).
    /// Internally holds an instance-based implementation to make later DI refactors straightforward.
    /// </summary>
    public static class SmsHelper
    {
        private static SmsHelperInstance? _instance;
        private static readonly object _sync = new object();

        /// <summary>
        /// Initialize with IConfiguration (optional). If null, environment variables will be used.
        /// </summary>
        public static void Initialize(IConfiguration? configuration = null)
        {
            if (_instance != null) return;
            lock (_sync)
            {
                if (_instance == null)
                {
                    _instance = new SmsHelperInstance(configuration, null);
                }
            }
        }

        /// <summary>
        /// Initialize with IConfiguration and ILogger - matches call-sites that provide logger too.
        /// </summary>
        public static void Initialize(IConfiguration? configuration, ILogger? logger)
        {
            if (_instance != null) return;
            lock (_sync)
            {
                if (_instance == null)
                {
                    _instance = new SmsHelperInstance(configuration, logger);
                }
            }
        }

        /// <summary>
        /// Initialize with AccountSid and AuthToken (two-arg overload).
        /// </summary>
        public static void Initialize(string accountSid, string authToken)
        {
            Initialize(accountSid, authToken, null, null);
        }

        /// <summary>
        /// Initialize with explicit accountSid, authToken, fromNumber and messagingServiceSid.
        /// Pass null for optional values.
        /// </summary>
        public static void Initialize(string accountSid, string authToken, string? fromNumber, string? messagingServiceSid)
        {
            if (_instance != null) return;
            lock (_sync)
            {
                if (_instance == null)
                {
                    _instance = new SmsHelperInstance(accountSid, authToken, fromNumber, messagingServiceSid, null);
                }
            }
        }

        public static Task<(bool Success, string? ErrorMessage)> SendSmsAsync(string toPhone, string body, ILogger? logger = null)
        {
            EnsureInstance();
            return _instance!.SendSmsAsync(toPhone, body, logger);
        }

        public static Task<(bool Success, string? ErrorMessage)> SendWhatsappAsync(string toPhone, string body, ILogger? logger = null, string? statusCallbackUrl = null)
        {
            EnsureInstance();
            return _instance!.SendWhatsappAsync(toPhone, body, logger, statusCallbackUrl);
        }

        public static Task<SmsSendResult> SendSmsDetailedAsync(string toPhone, string body, ILogger? logger = null)
        {
            EnsureInstance();
            return _instance!.SendSmsDetailedAsync(toPhone, body, logger);
        }

        public static Task<SmsSendResult> SendWhatsAppTemplateAsync(string toPhone, string contentSid, IDictionary<string, string> contentVariables, string? statusCallbackUrl = null, ILogger? logger = null)
        {
            EnsureInstance();
            return _instance!.SendWhatsAppTemplateAsync(toPhone, contentSid, contentVariables, statusCallbackUrl, logger);
        }

        private static void EnsureInstance()
        {
            if (_instance == null)
            {
                // try to initialize with environment variables only if Initialize was not called
                Initialize(null);
            }
        }

        // -------------------------
        // Internal instance class
        // -------------------------
        private class SmsHelperInstance
        {
            private readonly IConfiguration? _configuration;
            private readonly ILogger? _logger;
            private readonly string? _accountSid;
            private readonly string? _authToken;
            private readonly string? _smsFromNumber;
            private readonly string? _whatsAppFrom;
            private readonly string? _messagingServiceSid;

            // constructor used when IConfiguration provided or when Initialize(null) is used
            public SmsHelperInstance(IConfiguration? configuration = null, ILogger? logger = null)
            {
                _configuration = configuration;
                _logger = logger;

                // Environment variables take precedence so production credentials never need
                // to be committed to appsettings.json.
                _accountSid = GetSetting("Twilio:AccountSid", "TWILIO_ACCOUNT_SID");
                _authToken = GetSetting("Twilio:AuthToken", "TWILIO_AUTH_TOKEN");
                _smsFromNumber = GetSetting("Twilio:FromNumber", "TWILIO_FROM_NUMBER");
                _whatsAppFrom = GetSetting("Twilio:WhatsAppFrom", "TWILIO_WHATSAPP_FROM");
                _messagingServiceSid = GetSetting("Twilio:MessagingServiceSid", "TWILIO_MESSAGING_SERVICE_SID");

                if (!string.IsNullOrWhiteSpace(_accountSid) && !string.IsNullOrWhiteSpace(_authToken))
                {
                    try
                    {
                        TwilioClient.Init(_accountSid, _authToken);
                    }
                    catch (Exception ex)
                    {
                        _logger?.LogWarning(ex, "TwilioClient.Init failed during SmsHelper initialization.");
                    }
                }
                else
                {
                    _logger?.LogWarning("Twilio credentials not found during SmsHelper initialization. Ensure TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are set.");
                }
            }

            // constructor used when explicit values passed
            public SmsHelperInstance(string accountSid, string authToken, string? fromNumber, string? messagingServiceSid, ILogger? logger = null)
            {
                _configuration = null;
                _logger = logger;

                _accountSid = accountSid;
                _authToken = authToken;
                _smsFromNumber = fromNumber;
                _whatsAppFrom = fromNumber;
                _messagingServiceSid = messagingServiceSid;

                if (!string.IsNullOrWhiteSpace(_accountSid) && !string.IsNullOrWhiteSpace(_authToken))
                {
                    try
                    {
                        TwilioClient.Init(_accountSid, _authToken);
                    }
                    catch (Exception ex)
                    {
                        _logger?.LogWarning(ex, "TwilioClient.Init failed during SmsHelper explicit initialization.");
                    }
                }
                else
                {
                    _logger?.LogWarning("Twilio credentials not found during SmsHelper explicit initialization.");
                }
            }

            private string? GetSetting(string configurationKey, string environmentKey)
            {
                var environmentValue = Environment.GetEnvironmentVariable(environmentKey);
                return !string.IsNullOrWhiteSpace(environmentValue)
                    ? environmentValue
                    : _configuration?[configurationKey];
            }

            // helper: normalize E.164 for SMS (strip any whatsapp: prefix)
            private string NormalizeE164(string n)
            {
                if (string.IsNullOrWhiteSpace(n)) return n ?? string.Empty;
                n = n.Trim();

                // if someone passed "whatsapp:+9198..." remove the whatsapp: part for SMS path
                if (n.StartsWith("whatsapp:", StringComparison.OrdinalIgnoreCase))
                {
                    n = n.Substring("whatsapp:".Length);
                }

                if (!n.StartsWith("+")) n = "+" + n;
                return n;
            }

            // helper: normalize WhatsApp number: ensure "whatsapp:+..." prefix
            private string NormalizeWhatsAppNumber(string n)
            {
                if (string.IsNullOrWhiteSpace(n)) return n ?? string.Empty;
                n = n.Trim();

                // allow inputs with or without whatsapp: prefix
                if (!n.StartsWith("whatsapp:", StringComparison.OrdinalIgnoreCase))
                {
                    if (!n.StartsWith("+")) n = "+" + n;
                    return $"whatsapp:{n}";
                }
                return n;
            }

            public async Task<(bool Success, string? ErrorMessage)> SendSmsAsync(string toPhone, string body, ILogger? logger = null)
            {
                var log = logger ?? _logger;
                try
                {
                    if (string.IsNullOrWhiteSpace(_accountSid) || string.IsNullOrWhiteSpace(_authToken))
                    {
                        var em = "Twilio credentials missing (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN).";
                        log?.LogError(em);
                        return (false, em);
                    }

                    if (string.IsNullOrWhiteSpace(toPhone))
                    {
                        var em = "Destination phone number is empty.";
                        log?.LogError(em);
                        return (false, em);
                    }

                    // Ensure the phone passed to SMS is plain E.164 (no whatsapp: prefix)
                    var toE164 = NormalizeE164(toPhone);
                    var fromE164 = !string.IsNullOrWhiteSpace(_smsFromNumber) ? NormalizeE164(_smsFromNumber) : null;

                    log?.LogInformation("Sending SMS -> To: {To}, From: {From}, Using MessagingService: {Ms}", toE164, fromE164, _messagingServiceSid);

                    var to = new PhoneNumber(toE164);
                    MessageResource message;

                    if (!string.IsNullOrWhiteSpace(_messagingServiceSid))
                    {
                        message = await MessageResource.CreateAsync(
                            to: to,
                            messagingServiceSid: _messagingServiceSid,
                            body: body
                        );
                    }
                    else if (!string.IsNullOrWhiteSpace(fromE164))
                    {
                        message = await MessageResource.CreateAsync(
                            to: to,
                            from: new PhoneNumber(fromE164),
                            body: body
                        );
                    }
                    else
                    {
                        var em = "No SMS sender configured. Set TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID.";
                        log?.LogError(em);
                        return (false, em);
                    }

                    log?.LogInformation("SMS sent. SID: {Sid}", message?.Sid);
                    return (true, null);
                }
                catch (ApiException aex)
                {
                    log?.LogError(aex, "Twilio API Exception (SMS): Code={Code}, Message={Message}, MoreInfo={MoreInfo}", aex.Code, aex.Message, aex.MoreInfo);
                    return (false, $"Twilio API error: {aex.Message}");
                }
                catch (Exception ex)
                {
                    log?.LogError(ex, "Unexpected error sending SMS");
                    return (false, ex.Message);
                }
            }

            public async Task<(bool Success, string? ErrorMessage)> SendWhatsappAsync(string toPhone, string body, ILogger? logger = null, string? statusCallbackUrl = null)
            {
                var log = logger ?? _logger;
                try
                {
                    if (string.IsNullOrWhiteSpace(_accountSid) || string.IsNullOrWhiteSpace(_authToken))
                    {
                        var em = "Twilio credentials missing (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN).";
                        log?.LogError(em);
                        return (false, em);
                    }

                    if (string.IsNullOrWhiteSpace(toPhone))
                    {
                        var em = "Destination phone number is empty.";
                        log?.LogError(em);
                        return (false, em);
                    }

                    var toWhats = NormalizeWhatsAppNumber(toPhone);
                    string? fromWhats = null;
                    if (!string.IsNullOrWhiteSpace(_whatsAppFrom)) fromWhats = NormalizeWhatsAppNumber(_whatsAppFrom);

                    log?.LogInformation("Sending WhatsApp -> To: {To}, From: {From}, Using MessagingService: {Ms}", toWhats, fromWhats, _messagingServiceSid);

                    // init Twilio client (safe to call multiple times)
                    if (!string.IsNullOrWhiteSpace(_accountSid) && !string.IsNullOrWhiteSpace(_authToken))
                    {
                        try { TwilioClient.Init(_accountSid, _authToken); } catch { /* ignore init issues here */ }
                    }

                    MessageResource? message = null;
                    Uri? statusCallback = Uri.TryCreate(statusCallbackUrl, UriKind.Absolute, out var scUri) ? scUri : null;

                    if (!string.IsNullOrWhiteSpace(_messagingServiceSid))
                    {
                        message = await MessageResource.CreateAsync(
                            to: new PhoneNumber(toWhats),
                            messagingServiceSid: _messagingServiceSid,
                            body: body,
                            statusCallback: statusCallback
                        );
                    }
                    else if (!string.IsNullOrWhiteSpace(fromWhats))
                    {
                        message = await MessageResource.CreateAsync(
                            to: new PhoneNumber(toWhats),
                            from: new PhoneNumber(fromWhats),
                            body: body,
                            statusCallback: statusCallback
                        );
                    }
                    else
                    {
                        var em = "No WhatsApp sender configured. Set TWILIO_WHATSAPP_FROM or TWILIO_MESSAGING_SERVICE_SID.";
                        log?.LogError(em);
                        return (false, em);
                    }

                    log?.LogInformation("WhatsApp message sent. SID: {Sid}", message?.Sid);
                    return (true, null);
                }
                catch (ApiException aex)
                {
                    log?.LogError(aex, "Twilio API Exception (WhatsApp): Code={Code}, Message={Message}, MoreInfo={MoreInfo}", aex.Code, aex.Message, aex.MoreInfo);
                    return (false, $"Twilio API error: {aex.Message}");
                }
                catch (Exception ex)
                {
                    log?.LogError(ex, "Unexpected error sending WhatsApp");
                    return (false, ex.Message);
                }
            }

            public async Task<SmsSendResult> SendSmsDetailedAsync(string toPhone, string body, ILogger? logger = null)
            {
                var log = logger ?? _logger;
                if (string.IsNullOrWhiteSpace(_accountSid) || string.IsNullOrWhiteSpace(_authToken))
                    return new SmsSendResult(false, null, "Twilio credentials missing (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN).");
                if (string.IsNullOrWhiteSpace(toPhone))
                    return new SmsSendResult(false, null, "Destination phone number is empty.");
                try
                {
                    var to = new PhoneNumber(NormalizeE164(toPhone));
                    var fromE164 = !string.IsNullOrWhiteSpace(_smsFromNumber) ? NormalizeE164(_smsFromNumber) : null;
                    MessageResource message = !string.IsNullOrWhiteSpace(_messagingServiceSid)
                        ? await MessageResource.CreateAsync(to: to, messagingServiceSid: _messagingServiceSid, body: body)
                        : !string.IsNullOrWhiteSpace(fromE164)
                            ? await MessageResource.CreateAsync(to: to, from: new PhoneNumber(fromE164), body: body)
                            : throw new InvalidOperationException("No SMS sender configured. Set TWILIO_FROM_NUMBER or TWILIO_MESSAGING_SERVICE_SID.");
                    log?.LogInformation("SMS sent. SID: {Sid}", message.Sid);
                    return new SmsSendResult(true, message.Sid, null);
                }
                catch (ApiException aex)
                {
                    log?.LogError(aex, "Twilio API Exception (SMS): Code={Code}, Message={Message}", aex.Code, aex.Message);
                    return new SmsSendResult(false, null, $"Twilio API error: {aex.Message}");
                }
                catch (Exception ex)
                {
                    log?.LogError(ex, "Unexpected error sending SMS");
                    return new SmsSendResult(false, null, ex.Message);
                }
            }

            // Cold, business-initiated WhatsApp outreach requires a pre-approved Twilio/Meta
            // Content Template (contentSid + positional contentVariables). Free-form body text
            // is only permitted inside WhatsApp's 24-hour customer-initiated session window.
            public async Task<SmsSendResult> SendWhatsAppTemplateAsync(string toPhone, string contentSid, IDictionary<string, string> contentVariables, string? statusCallbackUrl = null, ILogger? logger = null)
            {
                var log = logger ?? _logger;
                if (string.IsNullOrWhiteSpace(_accountSid) || string.IsNullOrWhiteSpace(_authToken))
                    return new SmsSendResult(false, null, "Twilio credentials missing (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN).");
                if (string.IsNullOrWhiteSpace(toPhone))
                    return new SmsSendResult(false, null, "Destination phone number is empty.");
                if (string.IsNullOrWhiteSpace(contentSid))
                    return new SmsSendResult(false, null, "No approved WhatsApp Content Template SID is configured for this campaign.");
                try
                {
                    var to = new PhoneNumber(NormalizeWhatsAppNumber(toPhone));
                    var fromWhats = !string.IsNullOrWhiteSpace(_whatsAppFrom) ? NormalizeWhatsAppNumber(_whatsAppFrom) : null;
                    var variablesJson = JsonSerializer.Serialize(contentVariables ?? new Dictionary<string, string>());
                    Uri? statusCallback = Uri.TryCreate(statusCallbackUrl, UriKind.Absolute, out var scUri) ? scUri : null;
                    MessageResource? message = !string.IsNullOrWhiteSpace(_messagingServiceSid)
                        ? await MessageResource.CreateAsync(to: to, messagingServiceSid: _messagingServiceSid, contentSid: contentSid, contentVariables: variablesJson, statusCallback: statusCallback)
                        : !string.IsNullOrWhiteSpace(fromWhats)
                            ? await MessageResource.CreateAsync(to: to, from: new PhoneNumber(fromWhats), contentSid: contentSid, contentVariables: variablesJson, statusCallback: statusCallback)
                            : throw new InvalidOperationException("No WhatsApp sender configured. Set TWILIO_WHATSAPP_FROM or TWILIO_MESSAGING_SERVICE_SID.");
                    log?.LogInformation("WhatsApp template message sent. SID: {Sid}", message?.Sid);
                    return new SmsSendResult(true, message?.Sid, null);
                }
                catch (ApiException aex)
                {
                    log?.LogError(aex, "Twilio API Exception (WhatsApp template): Code={Code}, Message={Message}, MoreInfo={MoreInfo}", aex.Code, aex.Message, aex.MoreInfo);
                    return new SmsSendResult(false, null, $"Twilio API error: {aex.Message}");
                }
                catch (Exception ex)
                {
                    log?.LogError(ex, "Unexpected error sending WhatsApp template message");
                    return new SmsSendResult(false, null, ex.Message);
                }
            }
        }
    }
}
