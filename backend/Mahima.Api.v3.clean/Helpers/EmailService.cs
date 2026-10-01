using System;
using System.Threading.Tasks;
using MailKit.Security;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MimeKit;
using System.Text.RegularExpressions;

namespace Mahima.Api.v3.clean.Helpers
{
    public interface IEmailService
    {
        Task SendAsync(string toEmail, string subject, string htmlBody, string? textBody = null, string? ccEmail = null);
        Task<string> SendTrackedAsync(string toEmail, string subject, string htmlBody, string? textBody = null, string? replyTo = null, string? ccEmail = null);
    }

    /// <summary>
    /// Marketing/outreach email (campaign sends to prospects) is deliberately a
    /// distinct DI-registered sender from transactional email (password resets,
    /// quote/order confirmations, etc.) - bulk cold outreach and transactional
    /// mail should never share one mailbox's sending reputation. If a dedicated
    /// "Marketing:Smtp" config section isn't set, MarketingSmtpEmailService
    /// falls back to the same "Email" settings transactional mail uses, so
    /// nothing changes until a separate sending identity is actually configured.
    /// </summary>
    public interface IMarketingEmailService : IEmailService
    {
    }

    /// <summary>
    /// Sends transactional email through SMTP. Configured via appsettings.json:
    ///
    ///   "Email": {
    ///     "Host":       "smtp.hostinger.com",
    ///     "Port":       465,
    ///     "UseSsl":     true,
    ///     "Username":   "sambit.rout@mahimaministries.in",
    ///     "Password":   "...",
    ///     "FromAddress":"sambit.rout@mahimaministries.in",
    ///     "FromName":   "Mahima Ministries"
    ///   }
    ///
    /// Uses MailKit so both implicit TLS on port 465 and STARTTLS on port 587
    /// are negotiated correctly.
    /// </summary>
    public class SmtpEmailService : IEmailService
    {
        private readonly ILogger _logger;
        private readonly string _host;
        private readonly int _port;
        private readonly bool _useSsl;
        private readonly string _username;
        private readonly string _password;
        private readonly string _fromAddress;
        private readonly string _fromName;

        public SmtpEmailService(IConfiguration config, ILogger<SmtpEmailService> logger)
            : this(config, (ILogger)logger, "Email")
        {
        }

        /// <param name="sectionName">
        /// Config section to read from (e.g. "Marketing:Smtp"). Any key not
        /// present there falls back to the "Email" section, so a subclass with
        /// its own section only needs to override the keys it actually wants
        /// to differ (typically Host/Username/Password/FromAddress/FromName).
        /// </param>
        protected SmtpEmailService(IConfiguration config, ILogger logger, string sectionName)
        {
            _logger = logger;
            var section = config.GetSection(sectionName);
            var fallback = config.GetSection("Email");

            _host        = section["Host"]        ?? fallback["Host"]        ?? "smtp.hostinger.com";
            _port        = int.TryParse(section["Port"] ?? fallback["Port"], out var p) ? p : 465;
            _useSsl      = !bool.TryParse(section["UseSsl"] ?? fallback["UseSsl"], out var ssl) || ssl; // default true
            _username    = section["Username"]    ?? fallback["Username"]    ?? "";
            _password    = section["Password"]    ?? fallback["Password"]    ?? "";
            _fromAddress = section["FromAddress"] ?? fallback["FromAddress"] ?? _username;
            _fromName    = section["FromName"]    ?? fallback["FromName"]    ?? "Mahima Ministries";
        }

        public async Task SendAsync(string toEmail, string subject, string htmlBody, string? textBody = null, string? ccEmail = null)
            => _ = await SendTrackedAsync(toEmail, subject, htmlBody, textBody, ccEmail: ccEmail);

        public async Task<string> SendTrackedAsync(string toEmail, string subject, string htmlBody, string? textBody = null, string? replyTo = null, string? ccEmail = null)
        {
            if (string.IsNullOrWhiteSpace(toEmail))
                throw new ArgumentException("Recipient email is required.", nameof(toEmail));

            if (string.IsNullOrWhiteSpace(_username) || string.IsNullOrWhiteSpace(_password))
            {
                _logger.LogWarning("Email not sent — SMTP credentials missing in Email config.");
                throw new InvalidOperationException("Email service is not configured (Email:Username / Email:Password).");
            }

            var message = new MimeMessage();
            message.From.Add(new MailboxAddress(_fromName, _fromAddress));
            // Discovery sources sometimes publish more than one annotated
            // address (for example "office@example.org; shop@example.org (shop)").
            // Extract only syntactically valid addresses instead of handing the
            // entire display string to MimeKit as one mailbox.
            var recipients = Regex.Matches(toEmail, @"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", RegexOptions.IgnoreCase)
                .Select(match => match.Value.Trim().ToLowerInvariant())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
            if (recipients.Length == 0)
                throw new ArgumentException("No valid recipient email address was found.", nameof(toEmail));
            foreach (var recipient in recipients)
                message.To.Add(MailboxAddress.Parse(recipient));
            var ccRecipients = Regex.Matches(ccEmail ?? "", @"[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}", RegexOptions.IgnoreCase)
                .Select(match => match.Value.Trim().ToLowerInvariant())
                .Where(address => !recipients.Contains(address, StringComparer.OrdinalIgnoreCase))
                .Distinct(StringComparer.OrdinalIgnoreCase);
            foreach (var ccRecipient in ccRecipients)
                message.Cc.Add(MailboxAddress.Parse(ccRecipient));
            message.Subject = subject;
            message.MessageId = MimeKit.Utils.MimeUtils.GenerateMessageId();
            if (!string.IsNullOrWhiteSpace(replyTo))
                message.ReplyTo.Add(MailboxAddress.Parse(replyTo));
            message.Body = new BodyBuilder
            {
                HtmlBody = htmlBody,
                TextBody = string.IsNullOrWhiteSpace(textBody) ? null : textBody
            }.ToMessageBody();

            using var client = new MailKit.Net.Smtp.SmtpClient { Timeout = 30000 };
            var socketOptions = !_useSsl
                ? SecureSocketOptions.None
                : _port == 465
                    ? SecureSocketOptions.SslOnConnect
                    : SecureSocketOptions.StartTls;

            try
            {
                await client.ConnectAsync(_host, _port, socketOptions);
                await client.AuthenticateAsync(_username, _password);
                await client.SendAsync(message);
                await client.DisconnectAsync(true);
                _logger.LogInformation("Email sent to {To} subject='{Subject}'", toEmail, subject);
                return message.MessageId;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send email to {To}", toEmail);
                throw;
            }
        }
    }

    /// <summary>
    /// Sends marketing/campaign email. Reads "Marketing:Smtp" config, e.g.:
    ///
    ///   "Marketing": {
    ///     "Smtp": {
    ///       "Host":       "smtp.your-esp.example",
    ///       "Port":       587,
    ///       "UseSsl":     true,
    ///       "Username":   "campaigns@mail.mahimaministries.in",
    ///       "Password":   "...",
    ///       "FromAddress":"campaigns@mail.mahimaministries.in",
    ///       "FromName":   "Mahima Ministries"
    ///     }
    ///   }
    ///
    /// Any key left unset here falls back to the "Email" section (today's
    /// shared transactional mailbox), so this works out of the box and only
    /// needs the keys above once a dedicated sending domain/ESP is ready.
    /// </summary>
    public class MarketingSmtpEmailService : SmtpEmailService, IMarketingEmailService
    {
        public MarketingSmtpEmailService(IConfiguration config, ILogger<MarketingSmtpEmailService> logger)
            : base(config, logger, "Marketing:Smtp")
        {
        }
    }
}
