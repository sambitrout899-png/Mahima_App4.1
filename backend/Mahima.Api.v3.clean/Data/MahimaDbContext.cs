using Mahima.Api.v3.clean.Data;
using Microsoft.EntityFrameworkCore;
using Mahima.Api.v3.clean.Models;
using Mahima.Api.v3.clean.Models.Counselling;
using Mahima.Api.v3.clean.Models.Marriage;

namespace Mahima.Api.v3.clean.Data
{
    public class MahimaDbContext : DbContext
    {
        public MahimaDbContext(DbContextOptions<MahimaDbContext> options) : base(options) { }

        // -------------------------
        // DbSets
        // -------------------------
        public DbSet<User> Users => Set<User>();
        public DbSet<Team> Teams => Set<Team>();
        public DbSet<TeamMember> TeamMembers => Set<TeamMember>();
        public DbSet<TaskItem> Tasks => Set<TaskItem>();
        public DbSet<Sermon> Sermons => Set<Sermon>();
        public DbSet<PrayerRequest> PrayerRequests => Set<PrayerRequest>();
        public DbSet<Meeting> Meetings => Set<Meeting>();
        public DbSet<Attachment> Attachments => Set<Attachment>();
        public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
        public DbSet<AdminNotification> AdminNotifications => Set<AdminNotification>();
        public DbSet<MarriageApplication> MarriageApplications { get; set; } = null!;

        public DbSet<Timesheet> Timesheets { get; set; } = null!;
        public DbSet<AttendanceRecord> AttendanceRecords { get; set; } = null!;
        public DbSet<Expense> Expenses { get; set; } = null!;
        public DbSet<BaptismRequest> BaptismRequests { get; set; } = null!;

        public DbSet<StaffPayrollSetting> StaffPayrollSettings { get; set; } = null!;
        public DbSet<PayrollRun> PayrollRuns { get; set; } = null!;

        public DbSet<Role> Roles => Set<Role>();
        public DbSet<Page> Pages => Set<Page>();
        public DbSet<RolePermission> RolePermissions => Set<RolePermission>();

        public DbSet<Chat> Chats => Set<Chat>();
        public DbSet<ChatMember> ChatMembers => Set<ChatMember>();
        public DbSet<Message> Messages => Set<Message>();
        public DbSet<MessageRead> MessageReads => Set<MessageRead>();
        public DbSet<ChatSafetyAlert> ChatSafetyAlerts => Set<ChatSafetyAlert>();
        public DbSet<ChatSafetyScan> ChatSafetyScans => Set<ChatSafetyScan>();
        public DbSet<UserBlock> UserBlocks => Set<UserBlock>();
        public DbSet<MinistryScheduledMessageRun> MinistryScheduledMessageRuns => Set<MinistryScheduledMessageRun>();
        public DbSet<MinistryAutomationSetting> MinistryAutomationSettings => Set<MinistryAutomationSetting>();
        public DbSet<AppLanguage> AppLanguages => Set<AppLanguage>();
        public DbSet<Tenant> Tenants => Set<Tenant>();
        public DbSet<ModuleCatalogItem> ModuleCatalog => Set<ModuleCatalogItem>();
        public DbSet<SubscriptionPlan> SubscriptionPlans => Set<SubscriptionPlan>();
        public DbSet<SubscriptionPlanModule> SubscriptionPlanModules => Set<SubscriptionPlanModule>();
        public DbSet<SubscriptionPlanPublication> SubscriptionPlanPublications => Set<SubscriptionPlanPublication>();
        public DbSet<TenantSubscription> TenantSubscriptions => Set<TenantSubscription>();
        public DbSet<TenantModuleLicense> TenantModuleLicenses => Set<TenantModuleLicense>();
        public DbSet<TenantModuleRequest> TenantModuleRequests => Set<TenantModuleRequest>();
        public DbSet<QaTestRun> QaTestRuns => Set<QaTestRun>();
        public DbSet<QaTestFinding> QaTestFindings => Set<QaTestFinding>();
        public DbSet<QaTestPlan> QaTestPlans => Set<QaTestPlan>();
        public DbSet<QaTestCase> QaTestCases => Set<QaTestCase>();
        public DbSet<PaymentIntent> PaymentIntents => Set<PaymentIntent>();
        public DbSet<PaymentEvent> PaymentEvents => Set<PaymentEvent>();
        public DbSet<BillingInvoice> BillingInvoices => Set<BillingInvoice>();
        public DbSet<BillingInvoiceLine> BillingInvoiceLines => Set<BillingInvoiceLine>();
        public DbSet<TenantLandingConfig> TenantLandingConfigs => Set<TenantLandingConfig>();
        public DbSet<TenantBranding> TenantBrandings => Set<TenantBranding>();
        public DbSet<TenantLandingDraft> TenantLandingDrafts => Set<TenantLandingDraft>();
        public DbSet<TenantLandingVersion> TenantLandingVersions => Set<TenantLandingVersion>();
        public DbSet<MarketingProspect> MarketingProspects => Set<MarketingProspect>();
        public DbSet<MarketingCampaign> MarketingCampaigns => Set<MarketingCampaign>();
        public DbSet<MarketingOutreach> MarketingOutreach => Set<MarketingOutreach>();
        public DbSet<MarketingCommunicationEvent> MarketingCommunicationEvents => Set<MarketingCommunicationEvent>();
        public DbSet<WhatsAppContactState> WhatsAppContactStates => Set<WhatsAppContactState>();
        public DbSet<MarketingLead> MarketingLeads => Set<MarketingLead>();
        public DbSet<MarketingQuote> MarketingQuotes => Set<MarketingQuote>();
        public DbSet<MarketingOrder> MarketingOrders => Set<MarketingOrder>();
        public DbSet<MarketingDiscoverySchedule> MarketingDiscoverySchedules => Set<MarketingDiscoverySchedule>();
        public DbSet<MarketingDiscoveryRun> MarketingDiscoveryRuns => Set<MarketingDiscoveryRun>();

        public DbSet<PrayerResponse> PrayerResponses => Set<PrayerResponse>();

        public DbSet<AnalyticsUserOverview> AnalyticsUserOverviews { get; set; } = null!;
        public DbSet<AnalyticsTaskByRole> AnalyticsTaskByRole { get; set; } = null!;
        public DbSet<AnalyticsTeamProductivity> AnalyticsTeamProductivities { get; set; } = null!;
        public DbSet<AnalyticsPrayerOverview> AnalyticsPrayerOverviews { get; set; } = null!;

        public DbSet<Candidate> Candidates { get; set; } = null!;
        public DbSet<CounsellingCase> CounsellingCases { get; set; } = null!;
        public DbSet<CounsellingSession> CounsellingSessions { get; set; } = null!;
		
		public DbSet<Account> Accounts { get; set; } = null!;
        public DbSet<JournalEntry> JournalEntries { get; set; } = null!;
		public DbSet<JournalLine> JournalLines { get; set; } = null!;

        public DbSet<EventItem> Events => Set<EventItem>();
        public DbSet<EventRsvp> EventRsvps => Set<EventRsvp>();
        public DbSet<EventAttachment> EventAttachments => Set<EventAttachment>();
        public DbSet<ChildCheckIn> ChildCheckIns => Set<ChildCheckIn>();
        public DbSet<VolunteerShift> VolunteerShifts => Set<VolunteerShift>();
        public DbSet<VolunteerSignup> VolunteerSignups => Set<VolunteerSignup>();
        public DbSet<ServicePlan> ServicePlans => Set<ServicePlan>();
        public DbSet<ServicePlanItem> ServicePlanItems => Set<ServicePlanItem>();

        private static void ConfigureMultiTenancy(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<Tenant>(eb =>
            {
                eb.ToTable("tenants", "public");
                eb.HasKey(t => t.Id);
                eb.Property(t => t.Id).HasColumnName("id");
                eb.Property(t => t.Name).HasColumnName("name").HasMaxLength(160).IsRequired();
                eb.Property(t => t.Slug).HasColumnName("slug").HasMaxLength(80).IsRequired();
                eb.Property(t => t.Domain).HasColumnName("domain").HasMaxLength(180);
                eb.Property(t => t.DomainStatus).HasColumnName("domain_status").HasMaxLength(32).HasDefaultValue("none");
                eb.Property(t => t.DomainVerificationToken).HasColumnName("domain_verification_token").HasMaxLength(160);
                eb.Property(t => t.DomainVerifiedAtUtc).HasColumnName("domain_verified_at_utc");
                eb.Property(t => t.DomainLastCheckedAtUtc).HasColumnName("domain_last_checked_at_utc");
                eb.Property(t => t.ContactName).HasColumnName("contact_name").HasMaxLength(160);
                eb.Property(t => t.ContactEmail).HasColumnName("contact_email").HasMaxLength(256);
                eb.Property(t => t.ContactPhone).HasColumnName("contact_phone").HasMaxLength(32);
                eb.Property(t => t.CountryCode).HasColumnName("country_code").HasMaxLength(2).HasDefaultValue("IN");
                eb.Property(t => t.UserCodePrefix).HasColumnName("user_code_prefix").HasMaxLength(12).HasDefaultValue("MHN");
                eb.Property(t => t.Status).HasColumnName("status").HasMaxLength(32).HasDefaultValue("active");
                eb.Property(t => t.IsRootTenant).HasColumnName("is_root_tenant").HasDefaultValue(false);
                eb.Property(t => t.WhatsAppUserNotificationTemplateSid).HasColumnName("whatsapp_user_notification_template_sid").HasMaxLength(64);
                eb.Property(t => t.WhatsAppMarketingTemplateSid).HasColumnName("whatsapp_marketing_template_sid").HasMaxLength(64);
                eb.Property(t => t.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.Property(t => t.UpdatedAtUtc).HasColumnName("updated_at_utc").HasDefaultValueSql("now()");
                eb.HasIndex(t => t.Slug).IsUnique();
                eb.HasIndex(t => t.Domain).IsUnique();
            });

            modelBuilder.Entity<ModuleCatalogItem>(eb =>
            {
                eb.ToTable("module_catalog", "public");
                eb.HasKey(m => m.Code);
                eb.Property(m => m.Code).HasColumnName("code").HasMaxLength(64);
                eb.Property(m => m.Name).HasColumnName("name").HasMaxLength(120).IsRequired();
                eb.Property(m => m.Description).HasColumnName("description");
                eb.Property(m => m.MonthlyPriceInr).HasColumnName("monthly_price_inr").HasColumnType("numeric(12,2)");
                eb.Property(m => m.IsBaseModule).HasColumnName("is_base_module").HasDefaultValue(false);
                eb.Property(m => m.Enabled).HasColumnName("enabled").HasDefaultValue(true);
                eb.Property(m => m.DisplayOrder).HasColumnName("display_order").HasDefaultValue(0);
                eb.Property(m => m.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.Property(m => m.UpdatedAtUtc).HasColumnName("updated_at_utc").HasDefaultValueSql("now()");
            });

            modelBuilder.Entity<SubscriptionPlan>(eb =>
            {
                eb.ToTable("subscription_plans", "public");
                eb.HasKey(p => p.Id);
                eb.Property(p => p.Id).HasColumnName("id");
                eb.Property(p => p.Code).HasColumnName("code").HasMaxLength(64).IsRequired();
                eb.Property(p => p.Name).HasColumnName("name").HasMaxLength(120).IsRequired();
                eb.Property(p => p.Description).HasColumnName("description");
                eb.Property(p => p.MonthlyPriceInr).HasColumnName("monthly_price_inr").HasColumnType("numeric(12,2)");
                eb.Property(p => p.IsBaseFreePlan).HasColumnName("is_base_free_plan").HasDefaultValue(false);
                eb.Property(p => p.Enabled).HasColumnName("enabled").HasDefaultValue(true);
                eb.Property(p => p.DisplayOrder).HasColumnName("display_order").HasDefaultValue(0);
                eb.Property(p => p.LifecycleStatus).HasColumnName("lifecycle_status").HasMaxLength(32).HasDefaultValue("draft");
                eb.Property(p => p.ContractMonths).HasColumnName("contract_months").HasDefaultValue(12);
                eb.Property(p => p.EarlyExitPenaltyPercent).HasColumnName("early_exit_penalty_percent").HasColumnType("numeric(5,2)").HasDefaultValue(10);
                eb.Property(p => p.StorageLimitGb).HasColumnName("storage_limit_gb").HasColumnType("numeric(12,2)").HasDefaultValue(10);
                eb.Property(p => p.AiTokensIncludedMonthly).HasColumnName("ai_tokens_included_monthly").HasDefaultValue(0L);
                eb.Property(p => p.StorageOveragePricePerGbInr).HasColumnName("storage_overage_price_per_gb_inr").HasColumnType("numeric(12,2)").HasDefaultValue(0);
                eb.Property(p => p.AiOveragePricePerMillionTokensInr).HasColumnName("ai_overage_price_per_million_tokens_inr").HasColumnType("numeric(12,2)").HasDefaultValue(0);
                eb.Property(p => p.AiCreditsIncludedInr).HasColumnName("ai_credits_included_inr").HasColumnType("numeric(12,2)").HasDefaultValue(0);
                eb.Property(p => p.AiOverageMarkupMultiplier).HasColumnName("ai_overage_markup_multiplier").HasColumnType("numeric(6,2)").HasDefaultValue(2.5m);
                eb.Property(p => p.PublishedVersion).HasColumnName("published_version").HasDefaultValue(0);
                eb.Property(p => p.PublishedAtUtc).HasColumnName("published_at_utc");
                eb.Property(p => p.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.Property(p => p.UpdatedAtUtc).HasColumnName("updated_at_utc").HasDefaultValueSql("now()");
                eb.HasIndex(p => p.Code).IsUnique();
            });

            modelBuilder.Entity<SubscriptionPlanPublication>(eb =>
            {
                eb.ToTable("subscription_plan_publications", "public");
                eb.HasKey(p => p.Id);
                eb.Property(p => p.Id).HasColumnName("id");
                eb.Property(p => p.PlanId).HasColumnName("plan_id");
                eb.Property(p => p.Version).HasColumnName("version");
                eb.Property(p => p.DefinitionJson).HasColumnName("definition_json").HasColumnType("jsonb");
                eb.Property(p => p.EffectiveAtUtc).HasColumnName("effective_at_utc");
                eb.Property(p => p.PublishedAtUtc).HasColumnName("published_at_utc").HasDefaultValueSql("now()");
                eb.Property(p => p.ExpiredAtUtc).HasColumnName("expired_at_utc");
                eb.Property(p => p.PublishedByUserId).HasColumnName("published_by_user_id");
                eb.HasOne(p => p.Plan).WithMany(p => p.Publications).HasForeignKey(p => p.PlanId).OnDelete(DeleteBehavior.Cascade);
                eb.HasIndex(p => new { p.PlanId, p.Version }).IsUnique();
            });

            modelBuilder.Entity<SubscriptionPlanModule>(eb =>
            {
                eb.ToTable("subscription_plan_modules", "public");
                eb.HasKey(pm => new { pm.PlanId, pm.ModuleCode });
                eb.Property(pm => pm.PlanId).HasColumnName("plan_id");
                eb.Property(pm => pm.ModuleCode).HasColumnName("module_code").HasMaxLength(64);
                eb.Property(pm => pm.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.HasOne(pm => pm.Plan).WithMany(p => p.Modules).HasForeignKey(pm => pm.PlanId).OnDelete(DeleteBehavior.Cascade);
                eb.HasOne(pm => pm.Module).WithMany(m => m.PlanModules).HasForeignKey(pm => pm.ModuleCode).OnDelete(DeleteBehavior.Restrict);
            });

            modelBuilder.Entity<TenantSubscription>(eb =>
            {
                eb.ToTable("tenant_subscriptions", "public");
                eb.HasKey(s => s.Id);
                eb.Property(s => s.Id).HasColumnName("id");
                eb.Property(s => s.TenantId).HasColumnName("tenant_id");
                eb.Property(s => s.PlanId).HasColumnName("plan_id");
                eb.Property(s => s.AppliedPlanVersion).HasColumnName("applied_plan_version").HasDefaultValue(0);
                eb.Property(s => s.Status).HasColumnName("status").HasMaxLength(32).HasDefaultValue("active");
                eb.Property(s => s.StartsAtUtc).HasColumnName("starts_at_utc").HasDefaultValueSql("now()");
                eb.Property(s => s.EndsAtUtc).HasColumnName("ends_at_utc");
                eb.Property(s => s.TrialEndsAtUtc).HasColumnName("trial_ends_at_utc");
                eb.Property(s => s.ContractEndsAtUtc).HasColumnName("contract_ends_at_utc");
                eb.Property(s => s.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.Property(s => s.UpdatedAtUtc).HasColumnName("updated_at_utc").HasDefaultValueSql("now()");
                eb.HasOne(s => s.Tenant).WithMany(t => t.Subscriptions).HasForeignKey(s => s.TenantId).OnDelete(DeleteBehavior.Cascade);
                eb.HasOne(s => s.Plan).WithMany().HasForeignKey(s => s.PlanId).OnDelete(DeleteBehavior.Restrict);
                eb.HasIndex(s => new { s.TenantId, s.Status });
            });

            modelBuilder.Entity<TenantModuleLicense>(eb =>
            {
                eb.ToTable("tenant_module_licenses", "public");
                eb.HasKey(l => l.Id);
                eb.Property(l => l.Id).HasColumnName("id");
                eb.Property(l => l.TenantId).HasColumnName("tenant_id");
                eb.Property(l => l.ModuleCode).HasColumnName("module_code").HasMaxLength(64);
                eb.Property(l => l.Status).HasColumnName("status").HasMaxLength(32).HasDefaultValue("active");
                eb.Property(l => l.PriceInr).HasColumnName("price_inr").HasColumnType("numeric(12,2)");
                eb.Property(l => l.Source).HasColumnName("source").HasMaxLength(32).HasDefaultValue("manual");
                eb.Property(l => l.ActivatedByPaymentId).HasColumnName("activated_by_payment_id");
                eb.Property(l => l.StartsAtUtc).HasColumnName("starts_at_utc").HasDefaultValueSql("now()");
                eb.Property(l => l.EndsAtUtc).HasColumnName("ends_at_utc");
                eb.Property(l => l.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.Property(l => l.UpdatedAtUtc).HasColumnName("updated_at_utc").HasDefaultValueSql("now()");
                eb.HasOne(l => l.Tenant).WithMany(t => t.ModuleLicenses).HasForeignKey(l => l.TenantId).OnDelete(DeleteBehavior.Cascade);
                eb.HasOne(l => l.Module).WithMany(m => m.TenantLicenses).HasForeignKey(l => l.ModuleCode).OnDelete(DeleteBehavior.Restrict);
                eb.HasOne(l => l.ActivatedByPayment).WithMany().HasForeignKey(l => l.ActivatedByPaymentId).OnDelete(DeleteBehavior.SetNull);
                eb.HasIndex(l => new { l.TenantId, l.ModuleCode, l.Status });
            });

            modelBuilder.Entity<TenantModuleRequest>(eb =>
            {
                eb.ToTable("tenant_module_requests", "public");
                eb.HasKey(r => r.Id);
                eb.Property(r => r.Id).HasColumnName("id");
                eb.Property(r => r.TenantId).HasColumnName("tenant_id");
                eb.Property(r => r.ModuleCode).HasColumnName("module_code").HasMaxLength(64);
                eb.Property(r => r.RequestedByUserId).HasColumnName("requested_by_user_id");
                eb.Property(r => r.RequestedByName).HasColumnName("requested_by_name");
                eb.Property(r => r.RequestedByEmail).HasColumnName("requested_by_email");
                eb.Property(r => r.Status).HasColumnName("status").HasMaxLength(32).HasDefaultValue("pending");
                eb.Property(r => r.AdminNotes).HasColumnName("admin_notes");
                eb.Property(r => r.RequestedAtUtc).HasColumnName("requested_at_utc").HasDefaultValueSql("now()");
                eb.Property(r => r.ReviewedAtUtc).HasColumnName("reviewed_at_utc");
                eb.Property(r => r.ReviewedByUserId).HasColumnName("reviewed_by_user_id");
                eb.Property(r => r.NotificationEmailSent).HasColumnName("notification_email_sent").HasDefaultValue(false);
                eb.Property(r => r.JaiMasihMessageSent).HasColumnName("jai_masih_message_sent").HasDefaultValue(false);
                eb.HasOne(r => r.Tenant).WithMany().HasForeignKey(r => r.TenantId).OnDelete(DeleteBehavior.Cascade);
                eb.HasOne(r => r.Module).WithMany().HasForeignKey(r => r.ModuleCode).OnDelete(DeleteBehavior.Restrict);
                eb.HasOne(r => r.RequestedByUser).WithMany().HasForeignKey(r => r.RequestedByUserId).OnDelete(DeleteBehavior.SetNull);
                eb.HasIndex(r => new { r.TenantId, r.ModuleCode, r.Status });
            });

            modelBuilder.Entity<PaymentIntent>(eb =>
            {
                eb.ToTable("payment_intents", "public");
                eb.HasKey(p => p.Id);
                eb.Property(p => p.Id).HasColumnName("id");
                eb.Property(p => p.TenantId).HasColumnName("tenant_id");
                eb.Property(p => p.Purpose).HasColumnName("purpose").HasMaxLength(64);
                eb.Property(p => p.ModuleCode).HasColumnName("module_code").HasMaxLength(64);
                eb.Property(p => p.PlanId).HasColumnName("plan_id");
                eb.Property(p => p.AmountInr).HasColumnName("amount_inr").HasColumnType("numeric(12,2)");
                eb.Property(p => p.Currency).HasColumnName("currency").HasMaxLength(8).HasDefaultValue("INR");
                eb.Property(p => p.Provider).HasColumnName("provider").HasMaxLength(40).HasDefaultValue("upi");
                eb.Property(p => p.Status).HasColumnName("status").HasMaxLength(32).HasDefaultValue("pending");
                eb.Property(p => p.ProviderOrderId).HasColumnName("provider_order_id").HasMaxLength(160);
                eb.Property(p => p.ProviderPaymentId).HasColumnName("provider_payment_id").HasMaxLength(160);
                eb.Property(p => p.UpiVpa).HasColumnName("upi_vpa").HasMaxLength(120);
                eb.Property(p => p.UpiPayeeName).HasColumnName("upi_payee_name").HasMaxLength(160);
                eb.Property(p => p.UpiDeepLink).HasColumnName("upi_deep_link");
                eb.Property(p => p.MetadataJson).HasColumnName("metadata_json").HasColumnType("jsonb");
                eb.Property(p => p.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.Property(p => p.PaidAtUtc).HasColumnName("paid_at_utc");
                eb.Property(p => p.ExpiresAtUtc).HasColumnName("expires_at_utc");
                eb.HasOne(p => p.Tenant).WithMany().HasForeignKey(p => p.TenantId).OnDelete(DeleteBehavior.Cascade);
                eb.HasOne(p => p.Module).WithMany().HasForeignKey(p => p.ModuleCode).OnDelete(DeleteBehavior.Restrict);
                eb.HasOne(p => p.Plan).WithMany().HasForeignKey(p => p.PlanId).OnDelete(DeleteBehavior.Restrict);
                eb.HasIndex(p => new { p.TenantId, p.Status });
                eb.HasIndex(p => p.ProviderOrderId);
            });

            modelBuilder.Entity<PaymentEvent>(eb =>
            {
                eb.ToTable("payment_events", "public");
                eb.HasKey(e => e.Id);
                eb.Property(e => e.Id).HasColumnName("id");
                eb.Property(e => e.PaymentIntentId).HasColumnName("payment_intent_id");
                eb.Property(e => e.EventType).HasColumnName("event_type").HasMaxLength(80);
                eb.Property(e => e.ProviderEventId).HasColumnName("provider_event_id").HasMaxLength(160);
                eb.Property(e => e.PayloadJson).HasColumnName("payload_json").HasColumnType("jsonb");
                eb.Property(e => e.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.HasOne(e => e.PaymentIntent).WithMany(p => p.Events).HasForeignKey(e => e.PaymentIntentId).OnDelete(DeleteBehavior.Cascade);
                eb.HasIndex(e => e.ProviderEventId);
            });

            modelBuilder.Entity<BillingInvoice>(eb =>
            {
                eb.ToTable("billing_invoices", "public");
                eb.HasKey(i => i.Id);
                eb.Property(i => i.Id).HasColumnName("id");
                eb.Property(i => i.TenantId).HasColumnName("tenant_id");
                eb.Property(i => i.InvoiceNumber).HasColumnName("invoice_number").HasMaxLength(80).IsRequired();
                eb.Property(i => i.PeriodStartUtc).HasColumnName("period_start_utc");
                eb.Property(i => i.PeriodEndUtc).HasColumnName("period_end_utc");
                eb.Property(i => i.SubtotalInr).HasColumnName("subtotal_inr").HasColumnType("numeric(12,2)");
                eb.Property(i => i.TaxInr).HasColumnName("tax_inr").HasColumnType("numeric(12,2)");
                eb.Property(i => i.TotalInr).HasColumnName("total_inr").HasColumnType("numeric(12,2)");
                eb.Property(i => i.PaidInr).HasColumnName("paid_inr").HasColumnType("numeric(12,2)");
                eb.Property(i => i.Currency).HasColumnName("currency").HasMaxLength(8).HasDefaultValue("INR");
                eb.Property(i => i.Status).HasColumnName("status").HasMaxLength(32).HasDefaultValue("open");
                eb.Property(i => i.PaymentIntentId).HasColumnName("payment_intent_id");
                eb.Property(i => i.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.Property(i => i.UpdatedAtUtc).HasColumnName("updated_at_utc").HasDefaultValueSql("now()");
                eb.HasOne(i => i.Tenant).WithMany().HasForeignKey(i => i.TenantId).OnDelete(DeleteBehavior.Cascade);
                eb.HasOne(i => i.PaymentIntent).WithMany().HasForeignKey(i => i.PaymentIntentId).OnDelete(DeleteBehavior.SetNull);
                eb.HasMany(i => i.Lines).WithOne(l => l.Invoice).HasForeignKey(l => l.InvoiceId).OnDelete(DeleteBehavior.Cascade);
                eb.HasIndex(i => i.InvoiceNumber).IsUnique();
                eb.HasIndex(i => new { i.TenantId, i.PeriodStartUtc }).IsUnique();
                eb.HasIndex(i => i.Status);
            });

            modelBuilder.Entity<BillingInvoiceLine>(eb =>
            {
                eb.ToTable("billing_invoice_lines", "public");
                eb.HasKey(l => l.Id);
                eb.Property(l => l.Id).HasColumnName("id");
                eb.Property(l => l.InvoiceId).HasColumnName("invoice_id");
                eb.Property(l => l.ModuleCode).HasColumnName("module_code").HasMaxLength(64);
                eb.Property(l => l.Description).HasColumnName("description");
                eb.Property(l => l.Quantity).HasColumnName("quantity").HasDefaultValue(1);
                eb.Property(l => l.UnitPriceInr).HasColumnName("unit_price_inr").HasColumnType("numeric(12,2)");
                eb.Property(l => l.AmountInr).HasColumnName("amount_inr").HasColumnType("numeric(12,2)");
                eb.Property(l => l.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.HasOne(l => l.Module).WithMany().HasForeignKey(l => l.ModuleCode).OnDelete(DeleteBehavior.Restrict);
                eb.HasIndex(l => l.InvoiceId);
            });

            modelBuilder.Entity<TenantLandingConfig>(eb =>
            {
                eb.ToTable("tenant_landing_configs", "public");
                eb.HasKey(c => c.TenantId);
                eb.Property(c => c.TenantId).HasColumnName("tenant_id");
                eb.Property(c => c.HeroImageUrl).HasColumnName("hero_image_url");
                eb.Property(c => c.HeroTitle).HasColumnName("hero_title").HasMaxLength(220).IsRequired();
                eb.Property(c => c.HeroSubtitle).HasColumnName("hero_subtitle");
                eb.Property(c => c.HeroLayout).HasColumnName("hero_layout").HasMaxLength(32).HasDefaultValue("split-card");
                eb.Property(c => c.ServiceTimesJson).HasColumnName("service_times_json").HasColumnType("jsonb");
                eb.Property(c => c.SectionsJson).HasColumnName("sections_json").HasColumnType("jsonb");
                eb.Property(c => c.SeoTitle).HasColumnName("seo_title").HasMaxLength(220);
                eb.Property(c => c.SeoDescription).HasColumnName("seo_description").HasMaxLength(400);
                eb.Property(c => c.OgImageUrl).HasColumnName("og_image_url");
                eb.Property(c => c.Published).HasColumnName("published").HasDefaultValue(true);
                eb.Property(c => c.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.Property(c => c.UpdatedAtUtc).HasColumnName("updated_at_utc").HasDefaultValueSql("now()");
                eb.HasOne(c => c.Tenant).WithOne(t => t.LandingConfig).HasForeignKey<TenantLandingConfig>(c => c.TenantId).OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<TenantBranding>(eb =>
            {
                eb.ToTable("tenant_branding", "public");
                eb.HasKey(c => c.TenantId);
                eb.Property(c => c.TenantId).HasColumnName("tenant_id");
                eb.Property(c => c.LogoUrl).HasColumnName("logo_url");
                eb.Property(c => c.PrimaryColor).HasColumnName("primary_color").HasMaxLength(32).HasDefaultValue("#0f766e");
                eb.Property(c => c.AccentColor).HasColumnName("accent_color").HasMaxLength(32).HasDefaultValue("#f59e0b");
                eb.Property(c => c.NeutralColor).HasColumnName("neutral_color").HasMaxLength(32).HasDefaultValue("#f8fafc");
                eb.Property(c => c.DarkColor).HasColumnName("dark_color").HasMaxLength(32).HasDefaultValue("#0f172a");
                eb.Property(c => c.HeadingFont).HasColumnName("heading_font").HasMaxLength(80).HasDefaultValue("Inter");
                eb.Property(c => c.BodyFont).HasColumnName("body_font").HasMaxLength(80).HasDefaultValue("Inter");
                eb.Property(c => c.ContactEmail).HasColumnName("contact_email").HasMaxLength(256);
                eb.Property(c => c.ContactPhone).HasColumnName("contact_phone").HasMaxLength(32);
                eb.Property(c => c.Address).HasColumnName("address");
                eb.Property(c => c.SocialLinksJson).HasColumnName("social_links_json").HasColumnType("jsonb");
                eb.Property(c => c.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.Property(c => c.UpdatedAtUtc).HasColumnName("updated_at_utc").HasDefaultValueSql("now()");
                eb.HasOne(c => c.Tenant).WithOne(t => t.Branding).HasForeignKey<TenantBranding>(c => c.TenantId).OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<TenantLandingDraft>(eb =>
            {
                eb.ToTable("tenant_landing_drafts", "public");
                eb.HasKey(c => c.TenantId);
                eb.Property(c => c.TenantId).HasColumnName("tenant_id");
                eb.Property(c => c.HeroTitle).HasColumnName("hero_title").HasMaxLength(220).IsRequired();
                eb.Property(c => c.HeroSubtitle).HasColumnName("hero_subtitle");
                eb.Property(c => c.HeroImageUrl).HasColumnName("hero_image_url");
                eb.Property(c => c.HeroLayout).HasColumnName("hero_layout").HasMaxLength(32).HasDefaultValue("split-card");
                eb.Property(c => c.ServiceTimesJson).HasColumnName("service_times_json").HasColumnType("jsonb").HasDefaultValue("[]");
                eb.Property(c => c.SectionsJson).HasColumnName("sections_json").HasColumnType("jsonb").HasDefaultValue("[]");
                eb.Property(c => c.SeoTitle).HasColumnName("seo_title").HasMaxLength(220);
                eb.Property(c => c.SeoDescription).HasColumnName("seo_description").HasMaxLength(400);
                eb.Property(c => c.OgImageUrl).HasColumnName("og_image_url");
                eb.Property(c => c.UpdatedAtUtc).HasColumnName("updated_at_utc").HasDefaultValueSql("now()");
                eb.Property(c => c.UpdatedByUserId).HasColumnName("updated_by_user_id");
                eb.HasOne(c => c.Tenant).WithOne(t => t.LandingDraft).HasForeignKey<TenantLandingDraft>(c => c.TenantId).OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<TenantLandingVersion>(eb =>
            {
                eb.ToTable("tenant_landing_versions", "public");
                eb.HasKey(c => c.Id);
                eb.Property(c => c.Id).HasColumnName("id");
                eb.Property(c => c.TenantId).HasColumnName("tenant_id");
                eb.Property(c => c.SnapshotJson).HasColumnName("snapshot_json").HasColumnType("jsonb");
                eb.Property(c => c.PublishedAtUtc).HasColumnName("published_at_utc").HasDefaultValueSql("now()");
                eb.Property(c => c.PublishedByUserId).HasColumnName("published_by_user_id");
                eb.HasOne(c => c.Tenant).WithMany().HasForeignKey(c => c.TenantId).OnDelete(DeleteBehavior.Cascade);
                eb.HasIndex(c => new { c.TenantId, c.PublishedAtUtc });
            });
        }

        private static void ConfigureCommunityModules(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<EventItem>(eb =>
            {
                eb.ToTable("events", "public");
                eb.HasKey(e => e.Id);
                eb.Property(e => e.Id).HasColumnName("id");
                eb.Property(e => e.TenantId).HasColumnName("tenant_id");
                eb.Property(e => e.Title).HasColumnName("title").HasMaxLength(200).IsRequired();
                eb.Property(e => e.Description).HasColumnName("description");
                eb.Property(e => e.Category).HasColumnName("category").HasMaxLength(60);
                eb.Property(e => e.Location).HasColumnName("location");
                eb.Property(e => e.CoverImageUrl).HasColumnName("cover_image_url");
                eb.Property(e => e.StartAtUtc).HasColumnName("start_at_utc");
                eb.Property(e => e.EndAtUtc).HasColumnName("end_at_utc");
                eb.Property(e => e.IsPublic).HasColumnName("is_public").HasDefaultValue(true);
                eb.Property(e => e.RequiresRsvp).HasColumnName("requires_rsvp").HasDefaultValue(false);
                eb.Property(e => e.Capacity).HasColumnName("capacity");
                eb.Property(e => e.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("scheduled");
                eb.Property(e => e.CreatedByUserId).HasColumnName("created_by_user_id");
                eb.Property(e => e.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.Property(e => e.UpdatedAtUtc).HasColumnName("updated_at_utc").HasDefaultValueSql("now()");
                eb.HasIndex(e => new { e.TenantId, e.StartAtUtc });
            });

            modelBuilder.Entity<EventRsvp>(eb =>
            {
                eb.ToTable("event_rsvps", "public");
                eb.HasKey(r => r.Id);
                eb.Property(r => r.Id).HasColumnName("id");
                eb.Property(r => r.TenantId).HasColumnName("tenant_id");
                eb.Property(r => r.EventId).HasColumnName("event_id");
                eb.Property(r => r.UserId).HasColumnName("user_id");
                eb.Property(r => r.GuestName).HasColumnName("guest_name").HasMaxLength(160);
                eb.Property(r => r.GuestContact).HasColumnName("guest_contact").HasMaxLength(160);
                eb.Property(r => r.PartySize).HasColumnName("party_size").HasDefaultValue(1);
                eb.Property(r => r.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("confirmed");
                eb.Property(r => r.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.HasIndex(r => new { r.EventId, r.Status });
            });

            modelBuilder.Entity<EventAttachment>(eb =>
            {
                eb.ToTable("event_attachments", "public");
                eb.HasKey(a => a.Id);
                eb.Property(a => a.Id).HasColumnName("id");
                eb.Property(a => a.TenantId).HasColumnName("tenant_id");
                eb.Property(a => a.EventId).HasColumnName("event_id");
                eb.Property(a => a.FileName).HasColumnName("file_name").HasMaxLength(260).IsRequired();
                eb.Property(a => a.FileUrl).HasColumnName("file_url").IsRequired();
                eb.Property(a => a.ContentType).HasColumnName("content_type").HasMaxLength(120).IsRequired();
                eb.Property(a => a.FileSizeBytes).HasColumnName("file_size_bytes");
                eb.Property(a => a.UploadedByUserId).HasColumnName("uploaded_by_user_id");
                eb.Property(a => a.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.HasIndex(a => a.EventId);
            });

            modelBuilder.Entity<ChildCheckIn>(eb =>
            {
                eb.ToTable("child_checkins", "public");
                eb.HasKey(c => c.Id);
                eb.Property(c => c.Id).HasColumnName("id");
                eb.Property(c => c.TenantId).HasColumnName("tenant_id");
                eb.Property(c => c.EventId).HasColumnName("event_id");
                eb.Property(c => c.ChildName).HasColumnName("child_name").HasMaxLength(160).IsRequired();
                eb.Property(c => c.ChildDob).HasColumnName("child_dob").HasColumnType("date");
                eb.Property(c => c.GuardianName).HasColumnName("guardian_name").HasMaxLength(160).IsRequired();
                eb.Property(c => c.GuardianPhone).HasColumnName("guardian_phone").HasMaxLength(32);
                eb.Property(c => c.GuardianUserId).HasColumnName("guardian_user_id");
                eb.Property(c => c.SecurityCode).HasColumnName("security_code").HasMaxLength(12).IsRequired();
                eb.Property(c => c.AllergyNotes).HasColumnName("allergy_notes");
                eb.Property(c => c.GeneralNotes).HasColumnName("general_notes");
                eb.Property(c => c.CheckedInAtUtc).HasColumnName("checked_in_at_utc").HasDefaultValueSql("now()");
                eb.Property(c => c.CheckedInByUserId).HasColumnName("checked_in_by_user_id");
                eb.Property(c => c.CheckedOutAtUtc).HasColumnName("checked_out_at_utc");
                eb.Property(c => c.CheckedOutByUserId).HasColumnName("checked_out_by_user_id");
                eb.HasIndex(c => new { c.TenantId, c.CheckedOutAtUtc });
            });

            modelBuilder.Entity<VolunteerShift>(eb =>
            {
                eb.ToTable("volunteer_shifts", "public");
                eb.HasKey(s => s.Id);
                eb.Property(s => s.Id).HasColumnName("id");
                eb.Property(s => s.TenantId).HasColumnName("tenant_id");
                eb.Property(s => s.Title).HasColumnName("title").HasMaxLength(200).IsRequired();
                eb.Property(s => s.Notes).HasColumnName("notes");
                eb.Property(s => s.TeamId).HasColumnName("team_id");
                eb.Property(s => s.EventId).HasColumnName("event_id");
                eb.Property(s => s.ShiftDate).HasColumnName("shift_date").HasColumnType("date");
                eb.Property(s => s.StartTime).HasColumnName("start_time").HasColumnType("time without time zone");
                eb.Property(s => s.EndTime).HasColumnName("end_time").HasColumnType("time without time zone");
                eb.Property(s => s.SlotsNeeded).HasColumnName("slots_needed").HasDefaultValue(1);
                eb.Property(s => s.CreatedByUserId).HasColumnName("created_by_user_id");
                eb.Property(s => s.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.Property(s => s.UpdatedAtUtc).HasColumnName("updated_at_utc").HasDefaultValueSql("now()");
                eb.HasIndex(s => new { s.TenantId, s.ShiftDate });
            });

            modelBuilder.Entity<VolunteerSignup>(eb =>
            {
                eb.ToTable("volunteer_signups", "public");
                eb.HasKey(s => s.Id);
                eb.Property(s => s.Id).HasColumnName("id");
                eb.Property(s => s.TenantId).HasColumnName("tenant_id");
                eb.Property(s => s.ShiftId).HasColumnName("shift_id");
                eb.Property(s => s.UserId).HasColumnName("user_id");
                eb.Property(s => s.Status).HasColumnName("status").HasMaxLength(20).HasDefaultValue("signed_up");
                eb.Property(s => s.SignedUpAtUtc).HasColumnName("signed_up_at_utc").HasDefaultValueSql("now()");
                eb.Property(s => s.ReminderSentAtUtc).HasColumnName("reminder_sent_at_utc");
                eb.HasIndex(s => new { s.ShiftId, s.Status });
            });

            modelBuilder.Entity<ServicePlan>(eb =>
            {
                eb.ToTable("service_plans", "public");
                eb.HasKey(p => p.Id);
                eb.Property(p => p.Id).HasColumnName("id");
                eb.Property(p => p.TenantId).HasColumnName("tenant_id");
                eb.Property(p => p.Title).HasColumnName("title").HasMaxLength(200).IsRequired();
                eb.Property(p => p.ServiceDate).HasColumnName("service_date").HasColumnType("date");
                eb.Property(p => p.SermonId).HasColumnName("sermon_id");
                eb.Property(p => p.Notes).HasColumnName("notes");
                eb.Property(p => p.CreatedByUserId).HasColumnName("created_by_user_id");
                eb.Property(p => p.CreatedAtUtc).HasColumnName("created_at_utc").HasDefaultValueSql("now()");
                eb.Property(p => p.UpdatedAtUtc).HasColumnName("updated_at_utc").HasDefaultValueSql("now()");
                eb.HasIndex(p => new { p.TenantId, p.ServiceDate });
            });

            modelBuilder.Entity<ServicePlanItem>(eb =>
            {
                eb.ToTable("service_plan_items", "public");
                eb.HasKey(i => i.Id);
                eb.Property(i => i.Id).HasColumnName("id");
                eb.Property(i => i.TenantId).HasColumnName("tenant_id");
                eb.Property(i => i.ServicePlanId).HasColumnName("service_plan_id");
                eb.Property(i => i.OrderIndex).HasColumnName("order_index").HasDefaultValue(0);
                eb.Property(i => i.ItemType).HasColumnName("item_type").HasMaxLength(30).HasDefaultValue("song");
                eb.Property(i => i.Title).HasColumnName("title").HasMaxLength(200).IsRequired();
                eb.Property(i => i.Details).HasColumnName("details");
                eb.Property(i => i.AssignedUserId).HasColumnName("assigned_user_id");
                eb.Property(i => i.DurationMinutes).HasColumnName("duration_minutes");
                eb.HasIndex(i => new { i.ServicePlanId, i.OrderIndex });
            });
        }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            ConfigureMultiTenancy(modelBuilder);
            ConfigureMarketing(modelBuilder);
            ConfigureCommunityModules(modelBuilder);

            modelBuilder.Entity<Attachment>(eb =>
            {
                eb.ToTable("Attachments");
                eb.Property(a => a.TenantId).HasColumnName("TenantId");
                eb.HasIndex(a => a.TenantId);
            });

            modelBuilder.Entity<Meeting>(eb =>
            {
                eb.ToTable("Meetings");
                eb.Property(m => m.TenantId).HasColumnName("TenantId");
                eb.HasIndex(m => m.TenantId);
            });

            modelBuilder.Entity<TaskItem>(eb =>
            {
                eb.ToTable("Tasks");
                eb.Property(t => t.TenantId).HasColumnName("TenantId");
                eb.HasIndex(t => t.TenantId);
            });

            modelBuilder.Entity<Team>(eb =>
            {
                eb.ToTable("Teams");
                eb.Property(t => t.TenantId).HasColumnName("TenantId");
                eb.HasIndex(t => t.TenantId);
            });

            modelBuilder.Entity<UserBlock>(eb =>
            {
                eb.ToTable("user_blocks", "public");
                eb.HasKey(b => new { b.BlockerId, b.BlockedId });
                eb.Property(b => b.BlockerId).HasColumnName("blocker_id");
                eb.Property(b => b.BlockedId).HasColumnName("blocked_id");
                eb.Property(b => b.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
                eb.HasIndex(b => b.BlockedId);
                eb.HasOne(b => b.Blocker)
                  .WithMany()
                  .HasForeignKey(b => b.BlockerId)
                  .HasConstraintName("fk_user_blocks_blocker")
                  .OnDelete(DeleteBehavior.Cascade);
                eb.HasOne(b => b.Blocked)
                  .WithMany()
                  .HasForeignKey(b => b.BlockedId)
                  .HasConstraintName("fk_user_blocks_blocked")
                  .OnDelete(DeleteBehavior.Cascade);
            });

            modelBuilder.Entity<MinistryScheduledMessageRun>(eb =>
            {
                eb.ToTable("ministry_scheduled_message_runs", "public");
                eb.HasKey(r => r.Id);
                eb.Property(r => r.Id).HasColumnName("id");
                eb.Property(r => r.TenantId).HasColumnName("tenant_id");
                eb.Property(r => r.MessageKey).HasColumnName("message_key").IsRequired();
                eb.Property(r => r.ScheduledLocalDate).HasColumnName("scheduled_local_date").HasColumnType("date");
                eb.Property(r => r.SentAtUtc).HasColumnName("sent_at_utc").HasDefaultValueSql("now()");
                eb.HasIndex(r => r.TenantId);
                eb.HasIndex(r => new { r.TenantId, r.MessageKey, r.ScheduledLocalDate })
                  .IsUnique()
                  .HasDatabaseName("ux_ministry_scheduled_message_runs_tenant_key_date");
            });

            modelBuilder.Entity<MinistryAutomationSetting>(eb =>
            {
                eb.ToTable("ministry_automation_settings", "public");
                eb.HasKey(s => new { s.TenantId, s.Key });
                eb.Property(s => s.TenantId).HasColumnName("tenant_id");
                eb.Property(s => s.Key).HasColumnName("key");
                eb.Property(s => s.Value).HasColumnName("value");
                eb.Property(s => s.UpdatedAtUtc).HasColumnName("updated_at_utc").HasDefaultValueSql("now()");
                eb.HasIndex(s => s.TenantId);
            });

            modelBuilder.Entity<ChatSafetyAlert>(eb =>
            {
                eb.ToTable("chat_safety_alerts", "public");
                eb.HasKey(a => a.Id);
                eb.Property(a => a.Id).HasColumnName("id").ValueGeneratedOnAdd();
                eb.Property(a => a.MessageId).HasColumnName("message_id");
                eb.Property(a => a.ChatId).HasColumnName("chat_id");
                eb.Property(a => a.SenderId).HasColumnName("sender_id");
                eb.Property(a => a.Category).HasColumnName("category");
                eb.Property(a => a.Severity).HasColumnName("severity");
                eb.Property(a => a.AlertLevel).HasColumnName("alert_level");
                eb.Property(a => a.Confidence).HasColumnName("confidence").HasColumnType("numeric(5,2)");
                eb.Property(a => a.Summary).HasColumnName("summary");
                eb.Property(a => a.EvidenceSnippet).HasColumnName("evidence_snippet");
                eb.Property(a => a.ConversationSnippet).HasColumnName("conversation_snippet");
                eb.Property(a => a.PastorFollowupSent).HasColumnName("pastor_followup_sent");
                eb.Property(a => a.IsResolved).HasColumnName("is_resolved");
                eb.Property(a => a.CreatedAtUtc).HasColumnName("created_at_utc");
                eb.Property(a => a.ResolvedAtUtc).HasColumnName("resolved_at_utc");
                eb.HasIndex(a => a.MessageId).IsUnique();
                eb.HasIndex(a => new { a.IsResolved, a.AlertLevel, a.CreatedAtUtc });
            });

            modelBuilder.Entity<ChatSafetyScan>(eb =>
            {
                eb.ToTable("chat_safety_scans", "public");
                eb.HasKey(s => s.MessageId);
                eb.Property(s => s.MessageId).HasColumnName("message_id");
                eb.Property(s => s.ScannedAtUtc).HasColumnName("scanned_at_utc");
                eb.Property(s => s.Engine).HasColumnName("engine");
            });

            modelBuilder.Entity<AuditLog>(eb =>
            {
                eb.ToTable("AuditLogs");
                eb.Property(a => a.TenantId).HasColumnName("tenant_id");
                eb.HasIndex(a => a.TenantId);
            });

            modelBuilder.Entity<ChatSafetyAlert>(eb =>
            {
                eb.ToTable("chat_safety_alerts", "public");
                eb.HasKey(a => a.Id);
                eb.Property(a => a.Id).HasColumnName("id").ValueGeneratedOnAdd();
                eb.Property(a => a.MessageId).HasColumnName("message_id");
                eb.Property(a => a.ChatId).HasColumnName("chat_id");
                eb.Property(a => a.SenderId).HasColumnName("sender_id");
                eb.Property(a => a.Category).HasColumnName("category");
                eb.Property(a => a.Severity).HasColumnName("severity");
                eb.Property(a => a.AlertLevel).HasColumnName("alert_level");
                eb.Property(a => a.Confidence).HasColumnName("confidence").HasColumnType("numeric(5,2)");
                eb.Property(a => a.Summary).HasColumnName("summary");
                eb.Property(a => a.EvidenceSnippet).HasColumnName("evidence_snippet");
                eb.Property(a => a.ConversationSnippet).HasColumnName("conversation_snippet");
                eb.Property(a => a.PastorFollowupSent).HasColumnName("pastor_followup_sent");
                eb.Property(a => a.IsResolved).HasColumnName("is_resolved");
                eb.Property(a => a.CreatedAtUtc).HasColumnName("created_at_utc");
                eb.Property(a => a.ResolvedAtUtc).HasColumnName("resolved_at_utc");
                eb.HasIndex(a => a.MessageId).IsUnique();
                eb.HasIndex(a => new { a.IsResolved, a.AlertLevel, a.CreatedAtUtc });
            });

            modelBuilder.Entity<ChatSafetyScan>(eb =>
            {
                eb.ToTable("chat_safety_scans", "public");
                eb.HasKey(s => s.MessageId);
                eb.Property(s => s.MessageId).HasColumnName("message_id");
                eb.Property(s => s.ScannedAtUtc).HasColumnName("scanned_at_utc");
                eb.Property(s => s.Engine).HasColumnName("engine");
            });

            // -------------------------
            // AppLanguage (admin-managed language list)
            // -------------------------
            modelBuilder.Entity<AppLanguage>(eb =>
            {
                eb.ToTable("app_languages", "public");
                eb.HasKey(l => l.Code);
                eb.Property(l => l.Code).HasColumnName("code").HasMaxLength(8);
                eb.Property(l => l.Name).HasColumnName("name").HasMaxLength(80).IsRequired();
                eb.Property(l => l.NativeName).HasColumnName("native_name").HasMaxLength(80).IsRequired();
                eb.Property(l => l.Enabled).HasColumnName("enabled").HasDefaultValue(true);
                eb.Property(l => l.IsDefault).HasColumnName("is_default").HasDefaultValue(false);
                eb.Property(l => l.DisplayOrder).HasColumnName("display_order").HasDefaultValue(0);
                eb.Property(l => l.Rtl).HasColumnName("rtl").HasDefaultValue(false);
                eb.Property(l => l.CreatedAt).HasColumnName("created_at").HasDefaultValueSql("now()");
                eb.Property(l => l.UpdatedAt).HasColumnName("updated_at").HasDefaultValueSql("now()");
            });
            modelBuilder.Entity<QaTestRun>(eb =>
            {
                eb.ToTable("qa_test_runs", "public");
                eb.HasKey(x => x.Id);
                eb.Property(x => x.Id).HasColumnName("id");
                eb.Property(x => x.StartedByUserId).HasColumnName("started_by_user_id");
                eb.Property(x => x.PlanId).HasColumnName("plan_id");
                eb.Property(x => x.RequestedModulesJson).HasColumnName("requested_modules_json").HasColumnType("jsonb");
                eb.Property(x => x.Status).HasColumnName("status").HasMaxLength(24);
                eb.Property(x => x.PassedCount).HasColumnName("passed_count");
                eb.Property(x => x.WarningCount).HasColumnName("warning_count");
                eb.Property(x => x.FailedCount).HasColumnName("failed_count");
                eb.Property(x => x.StartedAtUtc).HasColumnName("started_at_utc");
                eb.Property(x => x.CompletedAtUtc).HasColumnName("completed_at_utc");
                eb.Property(x => x.Error).HasColumnName("error");
                eb.Property(x => x.LoadTestMetricsJson).HasColumnName("load_test_metrics_json").HasColumnType("jsonb");
                eb.HasIndex(x => x.StartedAtUtc);
            });
            modelBuilder.Entity<QaTestPlan>(eb =>
            {
                eb.ToTable("qa_test_plans", "public"); eb.HasKey(x => x.Id);
                eb.Property(x => x.Id).HasColumnName("id"); eb.Property(x => x.Name).HasColumnName("name").HasMaxLength(240);
                eb.Property(x => x.ModulesJson).HasColumnName("modules_json").HasColumnType("jsonb");
                eb.Property(x => x.Status).HasColumnName("status").HasMaxLength(24);
                eb.Property(x => x.GeneratedByUserId).HasColumnName("generated_by_user_id");
                eb.Property(x => x.ReviewedByUserId).HasColumnName("reviewed_by_user_id");
                eb.Property(x => x.GeneratedAtUtc).HasColumnName("generated_at_utc");
                eb.Property(x => x.ReviewedAtUtc).HasColumnName("reviewed_at_utc");
                eb.Property(x => x.DesignFingerprint).HasColumnName("design_fingerprint").HasMaxLength(128);
                eb.Property(x => x.LoadTestApproved).HasColumnName("load_test_approved");
                eb.Property(x => x.LoadTestConfigJson).HasColumnName("load_test_config_json").HasColumnType("jsonb");
                eb.HasIndex(x => x.GeneratedAtUtc);
            });
            modelBuilder.Entity<QaTestCase>(eb =>
            {
                eb.ToTable("qa_test_cases", "public"); eb.HasKey(x => x.Id);
                eb.Property(x => x.Id).HasColumnName("id"); eb.Property(x => x.PlanId).HasColumnName("plan_id");
                eb.Property(x => x.ModuleCode).HasColumnName("module_code").HasMaxLength(64);
                eb.Property(x => x.TestKey).HasColumnName("test_key").HasMaxLength(160);
                eb.Property(x => x.Title).HasColumnName("title").HasMaxLength(240);
                eb.Property(x => x.Objective).HasColumnName("objective"); eb.Property(x => x.Preconditions).HasColumnName("preconditions");
                eb.Property(x => x.StepsJson).HasColumnName("steps_json").HasColumnType("jsonb");
                eb.Property(x => x.ExpectedResult).HasColumnName("expected_result"); eb.Property(x => x.Severity).HasColumnName("severity").HasMaxLength(24);
                eb.Property(x => x.ExecutorType).HasColumnName("executor_type").HasMaxLength(40);
                eb.Property(x => x.ExecutorSpecJson).HasColumnName("executor_spec_json").HasColumnType("jsonb");
                eb.Property(x => x.ScenarioType).HasColumnName("scenario_type").HasMaxLength(16);
                eb.Property(x => x.TestDataJson).HasColumnName("test_data_json").HasColumnType("jsonb");
                eb.Property(x => x.TestDataApproved).HasColumnName("test_data_approved");
                eb.Property(x => x.Approved).HasColumnName("approved"); eb.Property(x => x.ReviewerNotes).HasColumnName("reviewer_notes");
                eb.Property(x => x.DisplayOrder).HasColumnName("display_order");
                eb.HasOne(x => x.Plan).WithMany(x => x.Cases).HasForeignKey(x => x.PlanId).OnDelete(DeleteBehavior.Cascade);
                eb.HasIndex(x => x.PlanId); eb.HasIndex(x => new { x.PlanId, x.TestKey }).IsUnique();
            });
            modelBuilder.Entity<QaTestFinding>(eb =>
            {
                eb.ToTable("qa_test_findings", "public");
                eb.HasKey(x => x.Id);
                eb.Property(x => x.Id).HasColumnName("id");
                eb.Property(x => x.RunId).HasColumnName("run_id");
                eb.Property(x => x.ModuleCode).HasColumnName("module_code").HasMaxLength(64);
                eb.Property(x => x.TestKey).HasColumnName("test_key").HasMaxLength(160);
                eb.Property(x => x.Title).HasColumnName("title").HasMaxLength(240);
                eb.Property(x => x.Status).HasColumnName("status").HasMaxLength(24);
                eb.Property(x => x.Severity).HasColumnName("severity").HasMaxLength(24);
                eb.Property(x => x.Details).HasColumnName("details");
                eb.Property(x => x.Evidence).HasColumnName("evidence");
                eb.Property(x => x.Recommendation).HasColumnName("recommendation");
                eb.Property(x => x.ImpactAnalysis).HasColumnName("impact_analysis");
                eb.Property(x => x.DurationMs).HasColumnName("duration_ms");
                eb.HasOne(x => x.Run).WithMany(x => x.Findings).HasForeignKey(x => x.RunId).OnDelete(DeleteBehavior.Cascade);
                eb.HasIndex(x => x.RunId);
                eb.HasIndex(x => new { x.ModuleCode, x.Status });
            });
// -------------------------
            // AdminNotification
            // -------------------------
            modelBuilder.Entity<AdminNotification>(eb =>
            {
                eb.ToTable("adminnotifications", "public");
                eb.HasKey(n => n.Id);
                eb.Property(n => n.Id).HasColumnName("id").ValueGeneratedOnAdd();
                eb.Property(n => n.TenantId).HasColumnName("tenant_id");
                eb.Property(n => n.UserId).HasColumnName("userid");
                eb.Property(n => n.Type).HasColumnName("type").HasMaxLength(200);
                eb.Property(n => n.Message).HasColumnName("message").IsRequired(false);
                eb.Property(n => n.Data).HasColumnName("data").IsRequired(false);
                eb.Property(n => n.IsRead).HasColumnName("isread").HasDefaultValue(false);
                eb.Property(n => n.CreatedAt).HasColumnName("createdat");
                eb.HasIndex(n => n.TenantId);
                eb.HasIndex(n => new { n.UserId, n.IsRead });

                eb.HasOne<User>()
                  .WithMany()
                  .HasForeignKey(n => n.UserId)
                  .HasConstraintName("fk_adminnotifications_userid")
                  .OnDelete(DeleteBehavior.Cascade);
            });
            // MarriageApplication
// -------------------------
modelBuilder.Entity<MarriageApplication>(eb =>
{
    eb.ToTable("marriage_applications", "public");

    eb.HasKey(m => m.Id);

    eb.Property(m => m.Id)
      .HasColumnName("id");

    eb.Property(m => m.TenantId)
      .HasColumnName("tenant_id");

    eb.HasIndex(m => m.TenantId);

    eb.Property(m => m.GroomFullName)
      .HasColumnName("groom_full_name")
      .IsRequired()
      .HasMaxLength(200);

    eb.Property(m => m.BrideFullName)
      .HasColumnName("bride_full_name")
      .IsRequired()
      .HasMaxLength(200);

    eb.Property(m => m.GroomPhone)
      .HasColumnName("groom_phone")
      .HasMaxLength(32);

    eb.Property(m => m.BridePhone)
      .HasColumnName("bride_phone")
      .HasMaxLength(32);

    eb.Property(m => m.GroomEmail)
      .HasColumnName("groom_email")
      .HasMaxLength(256);

    eb.Property(m => m.BrideEmail)
      .HasColumnName("bride_email")
      .HasMaxLength(256);

    eb.Property(m => m.Address)
      .HasColumnName("address");

    eb.Property(m => m.GroomIsMember)
      .HasColumnName("groom_is_member");

    eb.Property(m => m.BrideIsMember)
      .HasColumnName("bride_is_member");

    eb.Property(m => m.GroomMemberId)
      .HasColumnName("groom_member_id")
      .HasMaxLength(64);

    eb.Property(m => m.BrideMemberId)
      .HasColumnName("bride_member_id")
      .HasMaxLength(64);

    eb.Property(m => m.PreferredDate)
      .HasColumnName("preferred_date");

    eb.Property(m => m.PreferredService)
      .HasColumnName("preferred_service")
      .HasMaxLength(64);

    eb.Property(m => m.ScheduledAt)
      .HasColumnName("scheduled_at");

    eb.Property(m => m.CeremonyLocation)
      .HasColumnName("ceremony_location")
      .HasMaxLength(256);

    eb.Property(m => m.Status)
      .HasColumnName("status")
      .HasMaxLength(64);

    eb.Property(m => m.Token)
      .HasColumnName("token")
      .HasMaxLength(50);

    eb.Property(m => m.Notes)
      .HasColumnName("notes");

    eb.Property(m => m.CreatedAt)
      .HasColumnName("created_at")
      .HasDefaultValueSql("now()");

    eb.Property(m => m.UpdatedAt)
      .HasColumnName("updated_at")
      .HasDefaultValueSql("now()");

    eb.Property(m => m.ApprovedAt)
      .HasColumnName("approved_at");

    eb.Property(m => m.ApprovedByUserId)
      .HasColumnName("approved_by_user_id")
      .HasMaxLength(128);

    eb.Property(m => m.CompletedAt)
      .HasColumnName("completed_at");

    eb.HasIndex(m => m.Status);
});
            // -------------------------
            // Expense
            // -------------------------
            modelBuilder.Entity<Expense>(entity =>
            {
                entity.ToTable("expenses", "public");

                entity.HasKey(e => e.Id);

                entity.Property(e => e.Id)
                      .HasColumnName("id")
                      .ValueGeneratedOnAdd();

                entity.Property(e => e.TenantId)
                      .HasColumnName("tenant_id");

                entity.HasIndex(e => e.TenantId);

                entity.Property(e => e.Description)
                      .HasColumnName("description")
                      .IsRequired();

                entity.Property(e => e.Category)
                      .HasColumnName("category")
                      .IsRequired()
                      .HasMaxLength(64);

                entity.Property(e => e.Amount)
                      .HasColumnName("amount")
                      .HasColumnType("numeric(12,2)");

                entity.Property(e => e.Date)
                      .HasColumnName("date")
                      .HasColumnType("date");

                entity.Property(e => e.Vendor)
                      .HasColumnName("vendor");

                entity.Property(e => e.Notes)
                      .HasColumnName("notes");

                entity.Property(e => e.PayrollPerson)
                      .HasColumnName("payroll_person");

                entity.Property(e => e.PayrollMonth)
                      .HasColumnName("payroll_month")
                      .HasMaxLength(7);

                entity.Property(e => e.CreatedAt)
                      .HasColumnName("created_at")
                      .HasDefaultValueSql("now()");

                entity.Property(e => e.UpdatedAt)
                      .HasColumnName("updated_at")
                      .HasDefaultValueSql("now()");

                entity.Property(e => e.CreatedByUserId)
                      .HasColumnName("created_by_user_id");
            });

						modelBuilder.Entity<Account>(eb =>
			{
				eb.ToTable("accounts", "public");

				eb.HasKey(a => a.Id);

				eb.Property(a => a.Id)
				  .HasColumnName("id")
				  .ValueGeneratedOnAdd();

				eb.Property(a => a.TenantId)
				  .HasColumnName("tenant_id");

				eb.Property(a => a.Name)
				  .HasColumnName("name")
				  .HasMaxLength(200)
				  .IsRequired();

				eb.Property(a => a.Type)
				  .HasColumnName("type")
				  .HasMaxLength(50)
				  .IsRequired();

				eb.Property(a => a.CreatedAt)
				  .HasColumnName("created_at")
				  .HasDefaultValueSql("now()");

				eb.HasIndex(a => new { a.TenantId, a.Name }).IsUnique();
			});

			modelBuilder.Entity<JournalEntry>(eb =>
			{
				eb.ToTable("journal_entries", "public");

				eb.HasKey(j => j.Id);

				eb.Property(j => j.Id)
				  .HasColumnName("id")
				  .ValueGeneratedOnAdd();

				eb.Property(j => j.TenantId)
				  .HasColumnName("tenant_id");

				eb.HasIndex(j => j.TenantId);

				eb.Property(j => j.Date)
				  .HasColumnName("date");

				eb.Property(j => j.Description)
				  .HasColumnName("description");

				eb.Property(j => j.CreatedAt)
				  .HasColumnName("created_at")
				  .HasDefaultValueSql("now()");
			});
			
			modelBuilder.Entity<JournalLine>(eb =>
{
    eb.ToTable("journal_lines", "public");

    eb.HasKey(l => l.Id);

    eb.Property(l => l.Id)
      .HasColumnName("id")
      .ValueGeneratedOnAdd();

    eb.Property(l => l.JournalEntryId)
      .HasColumnName("journal_entry_id");

    eb.Property(l => l.AccountId)
      .HasColumnName("account_id");

    eb.Property(l => l.Debit)
      .HasColumnName("debit")
      .HasColumnType("numeric(12,2)");

    eb.Property(l => l.Credit)
      .HasColumnName("credit")
      .HasColumnType("numeric(12,2)");

    // 🔗 Relationships
    eb.HasOne(l => l.JournalEntry)
      .WithMany(j => j.Lines)
      .HasForeignKey(l => l.JournalEntryId)
      .OnDelete(DeleteBehavior.Cascade);

    eb.HasOne(l => l.Account)
      .WithMany()
      .HasForeignKey(l => l.AccountId)
      .OnDelete(DeleteBehavior.Restrict);

    eb.HasIndex(l => l.AccountId);
});
			
			
            // -------------------------
            // BaptismRequest
            // -------------------------
            modelBuilder.Entity<BaptismRequest>(eb =>
            {
                eb.ToTable("baptism_requests", "public");

                eb.HasKey(b => b.Id);

                eb.Property(b => b.Id)
                  .HasColumnName("id")
                  .ValueGeneratedOnAdd();

                eb.Property(b => b.TenantId)
                  .HasColumnName("tenant_id");

                eb.HasIndex(b => b.TenantId);

                eb.Property(b => b.Token)
                  .HasColumnName("token");

                eb.Property(b => b.FullName)
                  .HasColumnName("full_name")
                  .IsRequired();

                eb.Property(b => b.FatherName)
                  .HasColumnName("father_name");

                eb.Property(b => b.MotherName)
                  .HasColumnName("mother_name");

                eb.Property(b => b.DateOfBirth)
                  .HasColumnName("date_of_birth");

                eb.Property(b => b.ContactNumber)
                  .HasColumnName("contact_number");

                eb.Property(b => b.Email)
                  .HasColumnName("email");

                eb.Property(b => b.Address)
                  .HasColumnName("address");

                eb.Property(b => b.ChurchMemberId)
                  .HasColumnName("church_member_id");

                eb.Property(b => b.PreferredDate)
                  .HasColumnName("preferred_date");

                eb.Property(b => b.PreferredService)
                  .HasColumnName("preferred_service");

                eb.Property(b => b.ChurchVerified)
                  .HasColumnName("church_verified");

                eb.Property(b => b.ChurchVerifiedBy)
                  .HasColumnName("church_verified_by");

                eb.Property(b => b.ChurchVerifiedAt)
                  .HasColumnName("church_verified_at");

                eb.Property(b => b.ConsentSigned)
                  .HasColumnName("consent_signed");

                eb.Property(b => b.ConsentSignedBy)
                  .HasColumnName("consent_signed_by");

                eb.Property(b => b.ConsentSignedAt)
                  .HasColumnName("consent_signed_at");

                eb.Property(b => b.Status)
                  .HasColumnName("status")
                  .HasDefaultValue("Pending");

                eb.Property(b => b.CertificatePdfUrl)
                  .HasColumnName("certificate_pdf_url");

                eb.Property(b => b.BaptismDate)
                  .HasColumnName("baptism_date");

                eb.Property(b => b.BaptismPlace)
                  .HasColumnName("baptism_place");

                eb.Property(b => b.BaptizedByUserId)
                  .HasColumnName("baptized_by_user_id");

                eb.Property(b => b.CreatedAt)
                  .HasColumnName("created_at")
                  .HasDefaultValueSql("now()");

                eb.Property(b => b.UpdatedAt)
                  .HasColumnName("updated_at")
                  .HasDefaultValueSql("now()");
            });

            // -------------------------
            // User
            // -------------------------
            modelBuilder.Entity<User>(eb =>
            {
                eb.ToTable("users", "public");
                eb.HasKey(u => u.Id);
                eb.HasIndex(u => u.UserCode).IsUnique();
                eb.HasIndex(u => u.TenantId);
                eb.Property(u => u.Id).HasColumnName("id");
                eb.Property(u => u.TenantId).HasColumnName("tenant_id");
                eb.Property(u => u.UserCode).HasMaxLength(16).ValueGeneratedOnAdd();
                eb.Property(u => u.Username).HasColumnName("username");
                eb.Property(u => u.Email).HasColumnName("email");
                eb.Property(u => u.DisplayName).HasColumnName("displayname");
                eb.Property(u => u.ProfilePhotoUrl).HasColumnName("profilephotourl");
                eb.Property(u => u.PayrollEnabled).HasColumnName("payrollenabled");
                eb.Property(u => u.CognitoSub).HasColumnName("cognitosub");
                eb.Property(u => u.JoinDate).HasColumnName("joindate");
                eb.Property(u => u.LastLogin).HasColumnName("lastlogin");
                eb.Property(u => u.Phone).HasColumnName("phone");
                eb.Property(u => u.Role).HasColumnName("role");
                eb.Property(u => u.PreferredLanguage).HasColumnName("preferred_language").HasMaxLength(8);
                eb.Property(u => u.MfaEnabled).HasColumnName("mfa_enabled").HasDefaultValue(false);
                eb.Property(u => u.MfaSecret).HasColumnName("mfa_secret").HasMaxLength(64);
                eb.Property(u => u.MfaPendingSecret).HasColumnName("mfa_pending_secret").HasMaxLength(64);
                eb.Property(u => u.MfaRecoveryCodes).HasColumnName("mfa_recovery_codes");
                eb.Property(u => u.MfaEnabledAtUtc).HasColumnName("mfa_enabled_at_utc");
                eb.HasOne(u => u.Tenant).WithMany().HasForeignKey(u => u.TenantId).OnDelete(DeleteBehavior.Restrict);
            });

            // -------------------------
            // Timesheet
            // -------------------------
            modelBuilder.Entity<Timesheet>(eb =>
            {
                eb.ToTable("Timesheets", "public");

                eb.HasKey(t => t.Id);

                eb.Property(t => t.Id)
                  .HasColumnName("Id")
                  .ValueGeneratedOnAdd();

                eb.Property(t => t.TenantId)
                  .HasColumnName("TenantId");

                eb.HasIndex(t => t.TenantId);

                eb.Property(t => t.UserId)
                  .HasColumnName("UserId")
                  .HasMaxLength(128)
                  .IsRequired();

                eb.Property(t => t.Date)
                  .HasColumnName("Date")
                  .HasColumnType("timestamp without time zone");

                eb.Property(t => t.Hours)
                  .HasColumnName("Hours");

                eb.Property(t => t.Task)
                  .HasColumnName("Task")
                  .HasMaxLength(512)
                  .IsRequired(false);

                eb.Property(t => t.Notes)
                  .HasColumnName("Notes")
                  .HasMaxLength(2048)
                  .IsRequired(false);
            });

            // -------------------------
            // AttendanceRecord
            // -------------------------
            modelBuilder.Entity<AttendanceRecord>(eb =>
            {
                eb.ToTable("AttendanceRecords", "public");

                eb.HasKey(a => a.Id);

                eb.Property(a => a.Id)
                  .HasColumnName("Id")
                  .ValueGeneratedOnAdd();

                eb.Property(a => a.TenantId)
                  .HasColumnName("TenantId");

                eb.HasIndex(a => a.TenantId);

                eb.Property(a => a.UserId)
                  .HasColumnName("UserId")
                  .HasMaxLength(128)
                  .IsRequired();

                eb.Property(a => a.Status)
                  .HasColumnName("Status")
                  .HasMaxLength(64)
                  .IsRequired();

                eb.Property(a => a.Date)
                  .HasColumnName("Date")
                  .HasColumnType("timestamp without time zone");
            });

            // -------------------------
            // StaffPayrollSetting
            // -------------------------
            modelBuilder.Entity<StaffPayrollSetting>(eb =>
            {
                eb.ToTable("staff_payroll_settings", "public");

                eb.HasKey(p => p.Id);

                eb.Property(p => p.Id)
                  .HasColumnName("id")
                  .ValueGeneratedOnAdd();

                eb.Property(p => p.TenantId)
                  .HasColumnName("tenant_id");

                eb.HasIndex(p => p.TenantId);

                eb.Property(p => p.UserId)
                  .HasColumnName("user_id")
                  .HasMaxLength(128)
                  .IsRequired();

                eb.Property(p => p.HourlyRate)
                  .HasColumnName("hourly_rate")
                  .HasColumnType("numeric(18,2)");

                eb.Property(p => p.WeeklyOffDay)
                  .HasColumnName("weekly_off_day")
                  .HasDefaultValue(0);

                eb.Property(p => p.MonthlyFixedAmount)
                  .HasColumnName("monthly_fixed_amount")
                  .HasColumnType("numeric(18,2)");

                eb.Property(p => p.Allowances)
                  .HasColumnName("allowances")
                  .HasColumnType("numeric(18,2)");

                eb.Property(p => p.Deductions)
                  .HasColumnName("deductions")
                  .HasColumnType("numeric(18,2)");

                eb.Property(p => p.IsActive)
                  .HasColumnName("is_active")
                  .HasDefaultValue(true);
            });

            // -------------------------
            // PayrollRun (history)
            // -------------------------
            modelBuilder.Entity<PayrollRun>(eb =>
            {
                eb.ToTable("payroll_runs", "public");

                eb.HasKey(r => r.Id);

                eb.Property(r => r.Id)
                  .HasColumnName("id"); // Guid -> uuid

                eb.Property(r => r.TenantId)
                  .HasColumnName("tenant_id");

                eb.HasIndex(r => r.TenantId);

                eb.Property(r => r.UserId)
                  .HasColumnName("user_id")
                  .HasMaxLength(128)
                  .IsRequired();

                eb.Property(r => r.StaffName)
                  .HasColumnName("staff_name")
                  .HasMaxLength(256)
                  .IsRequired(false);

                eb.Property(r => r.From)
                  .HasColumnName("from_date");

                eb.Property(r => r.To)
                  .HasColumnName("to_date");

                eb.Property(r => r.TotalHours)
                  .HasColumnName("total_hours")
                  .HasColumnType("numeric(18,2)");

                eb.Property(r => r.HourlyRate)
                  .HasColumnName("hourly_rate")
                  .HasColumnType("numeric(18,2)");

                eb.Property(r => r.FixedAmount)
                  .HasColumnName("fixed_amount")
                  .HasColumnType("numeric(18,2)");

                eb.Property(r => r.Allowances)
                  .HasColumnName("allowances")
                  .HasColumnType("numeric(18,2)");

                eb.Property(r => r.Deductions)
                  .HasColumnName("deductions")
                  .HasColumnType("numeric(18,2)");

                eb.Property(r => r.GrossAmount)
                  .HasColumnName("gross_amount")
                  .HasColumnType("numeric(18,2)");

                eb.Property(r => r.NetAmount)
                  .HasColumnName("net_amount")
                  .HasColumnType("numeric(18,2)");

                eb.Property(r => r.PreviousArrears)
                  .HasColumnName("previous_arrears")
                  .HasColumnType("numeric(18,2)")
                  .HasDefaultValue(0m);

                eb.Property(r => r.PayableAmount)
                  .HasColumnName("payable_amount")
                  .HasColumnType("numeric(18,2)")
                  .HasDefaultValue(0m);

                eb.Property(r => r.PaidAmount)
                  .HasColumnName("paid_amount")
                  .HasColumnType("numeric(18,2)")
                  .HasDefaultValue(0m);

                eb.Property(r => r.BalanceAmount)
                  .HasColumnName("balance_amount")
                  .HasColumnType("numeric(18,2)")
                  .HasDefaultValue(0m);

                eb.Property(r => r.PaymentStatus)
                  .HasColumnName("payment_status")
                  .HasMaxLength(32)
                  .HasDefaultValue("UNPAID");

                eb.Property(r => r.PaymentNotes)
                  .HasColumnName("payment_notes")
                  .IsRequired(false);

                eb.Property(r => r.PaidAtUtc)
                  .HasColumnName("paid_at_utc")
                  .IsRequired(false);

                eb.Property(r => r.RunAt)
                  .HasColumnName("run_at");

                eb.HasIndex(r => new { r.TenantId, r.UserId, r.From, r.To });
            });

            // -------------------------
            // Chat
            // -------------------------
            modelBuilder.Entity<Chat>(eb =>
            {
                eb.ToTable("chats", "public");
                eb.HasKey(c => c.Id);
                eb.Property(c => c.Id).HasColumnName("id");
                eb.Property(c => c.Name).HasColumnName("name");
                eb.Property(c => c.IsGroup).HasColumnName("isgroup");
                eb.Property(c => c.TenantId).HasColumnName("tenant_id");
                eb.Property(c => c.CreatedBy).HasColumnName("createdby");
                eb.Property(c => c.CreatedAt).HasColumnName("createdat");
                eb.Property(c => c.GroupPhotoUrl).HasColumnName("group_photo_url");
                eb.HasIndex(c => c.TenantId);

                eb.HasOne(c => c.Creator)
                  .WithMany()
                  .HasForeignKey(c => c.CreatedBy)
                  .HasConstraintName("fk_chats_createdby")
                  .OnDelete(DeleteBehavior.Restrict);

                eb.HasMany(c => c.Members)
                  .WithOne(cm => cm.Chat)
                  .HasForeignKey(cm => cm.ChatId)
                  .HasConstraintName("fk_chatmembers_chatid")
                  .OnDelete(DeleteBehavior.Cascade);

                eb.HasMany(c => c.Messages)
                  .WithOne(m => m.Chat)
                  .HasForeignKey(m => m.ChatId)
                  .HasConstraintName("fk_messages_chatid")
                  .OnDelete(DeleteBehavior.Cascade);
            });

            // -------------------------
            // ChatMember
            // -------------------------
            modelBuilder.Entity<ChatMember>(eb =>
            {
                eb.ToTable("chatmembers", "public");
                eb.HasKey(cm => new { cm.ChatId, cm.UserId });

                eb.Property(cm => cm.ChatId).HasColumnName("chatid");
                eb.Property(cm => cm.UserId).HasColumnName("userid");
                eb.Property(cm => cm.Role).HasColumnName("role");
                eb.Property(cm => cm.JoinedAt).HasColumnName("joinedat");

                eb.HasOne(cm => cm.Chat)
                  .WithMany(c => c.Members)
                  .HasForeignKey(cm => cm.ChatId)
                  .HasConstraintName("fk_chatmembers_chatid")
                  .OnDelete(DeleteBehavior.Cascade);

                eb.HasOne(cm => cm.User)
                  .WithMany(u => u.ChatMembers)
                  .HasForeignKey(cm => cm.UserId)
                  .HasConstraintName("fk_chatmembers_userid")
                  .OnDelete(DeleteBehavior.Cascade);
            });

            // -------------------------
            // Message
            // -------------------------
            modelBuilder.Entity<Message>(eb =>
            {
                eb.ToTable("messages", "public");
                eb.HasKey(m => m.Id);
                eb.Property(m => m.Id).HasColumnName("id");
                eb.Property(m => m.ChatId).HasColumnName("chatid");
                eb.Property(m => m.SenderId).HasColumnName("senderid");
                eb.Property(m => m.Content).HasColumnName("content");
                eb.Property(m => m.ContentType).HasColumnName("contenttype");
                eb.Property(m => m.AttachmentUrl).HasColumnName("attachmenturl");
                eb.Property(m => m.CreatedAt).HasColumnName("createdat");

                eb.HasOne(m => m.Chat)
                  .WithMany(c => c.Messages)
                  .HasForeignKey(m => m.ChatId)
                  .HasConstraintName("fk_messages_chatid")
                  .OnDelete(DeleteBehavior.Cascade);

                eb.HasOne(m => m.Sender)
                  .WithMany()
                  .HasForeignKey(m => m.SenderId)
                  .HasConstraintName("fk_messages_senderid")
                  .OnDelete(DeleteBehavior.Restrict);
            });

            // -------------------------
            // MessageRead
            // -------------------------
            modelBuilder.Entity<MessageRead>(eb =>
            {
                eb.ToTable("messagereads", "public");
                eb.HasKey(mr => new { mr.MessageId, mr.UserId });

                eb.Property(mr => mr.MessageId).HasColumnName("messageid");
                eb.Property(mr => mr.UserId).HasColumnName("userid");
                eb.Property(mr => mr.ReadAt).HasColumnName("readat");

                eb.HasOne(mr => mr.Message)
                  .WithMany(m => m.Reads)
                  .HasForeignKey(mr => mr.MessageId)
                  .HasConstraintName("fk_messagereads_messageid")
                  .OnDelete(DeleteBehavior.Cascade);

                eb.HasOne<User>()
                  .WithMany()
                  .HasForeignKey(mr => mr.UserId)
                  .HasConstraintName("fk_messagereads_userid")
                  .OnDelete(DeleteBehavior.Cascade);
            });

            // -------------------------
            // TeamMember
            // -------------------------
            modelBuilder.Entity<TeamMember>(eb =>
            {
                eb.ToTable("teammembers", "public");
                eb.HasKey(tm => new { tm.TeamId, tm.UserId });
                eb.Property(tm => tm.TeamId).HasColumnName("teamid");
                eb.Property(tm => tm.UserId).HasColumnName("userid");

                eb.HasOne(tm => tm.Team)
                  .WithMany(t => t.Members)
                  .HasForeignKey(tm => tm.TeamId);

                eb.HasOne(tm => tm.User)
                  .WithMany(u => u.Teams)
                  .HasForeignKey(tm => tm.UserId);
            });

            // -------------------------
            // PrayerRequest
            // -------------------------
            modelBuilder.Entity<PrayerRequest>(eb =>
            {
                eb.ToTable("prayerrequests", "public");
                eb.HasKey(p => p.Id);
                eb.Property(p => p.Id).HasColumnName("id").ValueGeneratedOnAdd();
                eb.Property(p => p.TenantId).HasColumnName("tenant_id");
                eb.HasIndex(p => p.TenantId);
                eb.Property(p => p.UserId).HasColumnName("userid");
                eb.Property(p => p.Title).HasColumnName("title").HasMaxLength(500).IsRequired(false);
                eb.Property(p => p.Message).HasColumnName("message").IsRequired(false);
                eb.Property(p => p.Anonymous).HasColumnName("anonymous");
                eb.Property(p => p.Status).HasColumnName("status").HasMaxLength(50).IsRequired();
                eb.Property(p => p.AssignedTo).HasColumnName("assignedto");
                eb.Property(p => p.CreatedBy).HasColumnName("createdby").HasMaxLength(200).IsRequired(false);
                eb.Property(p => p.CreatedAt).HasColumnName("createdat");

               // eb.HasOne(p => p.User)
                  //.WithMany()
                  //.HasForeignKey(p => p.UserId)
                  //.HasConstraintName("fk_prayerrequest_userid")
                  //.OnDelete(DeleteBehavior.Restrict);
            });

            // -------------------------
            // PrayerResponse
            // -------------------------
            modelBuilder.Entity<PrayerResponse>(eb =>
            {
                eb.ToTable("prayerresponses", "public");
                eb.HasKey(r => r.Id);
                eb.Property(r => r.Id).HasColumnName("id").ValueGeneratedOnAdd();
                eb.Property(r => r.PrayerRequestId).HasColumnName("prayerrequestid").IsRequired();
                eb.Property(r => r.ResponseText).HasColumnName("message").IsRequired();
                eb.Property(r => r.RespondedBy).HasColumnName("author").IsRequired(false);
                eb.Property(r => r.RespondedAt).HasColumnName("createdat");
                eb.Property(r => r.UpdatedAt).HasColumnName("updatedat").IsRequired(false);

                eb.HasOne(r => r.PrayerRequest)
                  .WithMany()
                  .HasForeignKey(r => r.PrayerRequestId)
                  .HasConstraintName("fk_prayerresponses_prayerrequest")
                  .OnDelete(DeleteBehavior.Cascade);

                eb.HasIndex(r => r.PrayerRequestId);
            });

            // -------------------------
            // Analytics: User Overview
            // -------------------------
            modelBuilder.Entity<AnalyticsUserOverview>(eb =>
            {
                eb.ToTable("analytics_user_overview", "public");
                eb.HasKey(a => a.Id);

                eb.Property(a => a.Id).HasColumnName("id").ValueGeneratedOnAdd();
                eb.Property(a => a.TenantId).HasColumnName("tenant_id");
                eb.HasIndex(a => a.TenantId);
                eb.Property(a => a.SnapshotAt).HasColumnName("snapshot_at");
                eb.Property(a => a.TotalUsers).HasColumnName("total_users");
                eb.Property(a => a.TotalAdmins).HasColumnName("total_admins");
                eb.Property(a => a.TotalMembers).HasColumnName("total_members");
                eb.Property(a => a.TotalStaff).HasColumnName("total_staff");
                eb.Property(a => a.TotalVolunteers).HasColumnName("total_volunteers");
                eb.Property(a => a.NewMembers30d).HasColumnName("new_members_30d");
            });

            // -------------------------
            // Analytics: Task By Role
            // -------------------------
            modelBuilder.Entity<AnalyticsTaskByRole>(eb =>
            {
                eb.ToTable("analytics_task_by_role", "public");
                eb.HasKey(a => a.Id);

                eb.Property(a => a.Id).HasColumnName("id").ValueGeneratedOnAdd();
                eb.Property(a => a.TenantId).HasColumnName("tenant_id");
                eb.HasIndex(a => a.TenantId);
                eb.Property(a => a.SnapshotAt).HasColumnName("snapshot_at");
                eb.Property(a => a.Role).HasColumnName("role");
                eb.Property(a => a.TotalTasks).HasColumnName("total_tasks");
                eb.Property(a => a.OpenTasks).HasColumnName("open_tasks");
                eb.Property(a => a.CompletedTasks).HasColumnName("completed_tasks");
                eb.Property(a => a.OverdueTasks).HasColumnName("overdue_tasks");
            });

            // -------------------------
            // Analytics: Team Productivity
            // -------------------------
            modelBuilder.Entity<AnalyticsTeamProductivity>(eb =>
            {
                eb.ToTable("analytics_team_productivity", "public");
                eb.HasKey(a => a.Id);

                eb.Property(a => a.Id).HasColumnName("id").ValueGeneratedOnAdd();
                eb.Property(a => a.TenantId).HasColumnName("tenant_id");
                eb.HasIndex(a => a.TenantId);
                eb.Property(a => a.SnapshotAt).HasColumnName("snapshot_at");
                eb.Property(a => a.TeamId).HasColumnName("team_id");
                eb.Property(a => a.PeriodLabel).HasColumnName("period_label");
                eb.Property(a => a.PeriodStart).HasColumnName("period_start");
                eb.Property(a => a.PeriodEnd).HasColumnName("period_end");
                eb.Property(a => a.TotalHours).HasColumnName("total_hours");
                eb.Property(a => a.AvgHoursPerUser).HasColumnName("avg_hours_per_user");

                eb.HasOne<Team>()
                  .WithMany()
                  .HasForeignKey(a => a.TeamId)
                  .HasConstraintName("fk_analytics_team_productivity_teamid")
                  .OnDelete(DeleteBehavior.Restrict);
            });

            // -------------------------
            // Analytics: Prayer Overview
            // -------------------------
            modelBuilder.Entity<AnalyticsPrayerOverview>(eb =>
            {
                eb.ToTable("analytics_prayer_overview", "public");
                eb.HasKey(a => a.Id);

                eb.Property(a => a.Id).HasColumnName("id").ValueGeneratedOnAdd();
                eb.Property(a => a.TenantId).HasColumnName("tenant_id");
                eb.HasIndex(a => a.TenantId);
                eb.Property(a => a.SnapshotAt).HasColumnName("snapshot_at");
                eb.Property(a => a.PeriodLabel).HasColumnName("period_label");
                eb.Property(a => a.TotalRequests).HasColumnName("total_requests");
                eb.Property(a => a.OpenRequests).HasColumnName("open_requests");
                eb.Property(a => a.ClosedRequests).HasColumnName("closed_requests");
                eb.Property(a => a.TestifiedRequests).HasColumnName("testified_requests");
            });

            // -------------------------
            // Pastoral Counselling: Candidate
            // -------------------------
            modelBuilder.Entity<Candidate>(eb =>
            {
                eb.ToTable("candidates", "public");

                eb.HasKey(c => c.Id);

               eb.Property(c => c.Id)
                 .HasColumnName("id")
                 .ValueGeneratedOnAdd();

               eb.Property(c => c.TenantId)
                 .HasColumnName("tenant_id");

               eb.HasIndex(c => c.TenantId);

               eb.Property(c => c.FullName)
                  .HasColumnName("full_name")
                  .HasMaxLength(150)
                  .IsRequired();

                eb.Property(c => c.Email)
                  .HasColumnName("email")
                  .HasMaxLength(200)
                  .IsRequired(false);

                eb.Property(c => c.Phone)
                  .HasColumnName("phone")
                  .HasMaxLength(20)
                  .IsRequired();

                eb.Property(c => c.IsChurchMember)
                  .HasColumnName("is_church_member");

                eb.Property(c => c.MemberId)
                  .HasColumnName("member_id");

                eb.Property(c => c.CreatedAt)
                  .HasColumnName("created_at")
                  .HasDefaultValueSql("now()");
            });

            // -------------------------
            // Pastoral Counselling: CounsellingCase
            // -------------------------
            modelBuilder.Entity<CounsellingCase>(eb =>
            {
                eb.ToTable("counselling_cases", "public");

                eb.HasKey(c => c.Id);

                eb.Property(c => c.Id)
                  .HasColumnName("id")
                  .ValueGeneratedOnAdd();

                eb.Property(c => c.CandidateId)
                  .HasColumnName("candidate_id");

                eb.Property(c => c.IssueCategory)
                  .HasColumnName("issue_category")
                  .HasMaxLength(100)
                  .IsRequired();

                eb.Property(c => c.Description)
                  .HasColumnName("description");

                eb.Property(c => c.Status)
                  .HasColumnName("status")
                  .HasConversion<string>()
                  .HasMaxLength(30);

                eb.Property(c => c.CreatedAt)
                  .HasColumnName("created_at")
                  .HasDefaultValueSql("now()");

                eb.Property(c => c.ClosedAt)
                  .HasColumnName("closed_at");

                eb.Property(c => c.LastUpdatedAt)
                  .HasColumnName("last_updated_at")
                  .HasDefaultValueSql("now()");

                eb.HasOne(c => c.Candidate)
                  .WithMany(x => x.CounsellingCases)
                  .HasForeignKey(c => c.CandidateId)
                  .HasConstraintName("fk_counsellingcases_candidateid")
                  .OnDelete(DeleteBehavior.Cascade);
            });

            // -------------------------
            // Pastoral Counselling: CounsellingSession
            // -------------------------
            modelBuilder.Entity<CounsellingSession>(eb =>
            {
                eb.ToTable("counselling_sessions", "public");

                eb.HasKey(s => s.Id);

                eb.Property(s => s.Id)
                  .HasColumnName("id")
                  .ValueGeneratedOnAdd();

                eb.Property(s => s.CaseId)
                  .HasColumnName("case_id");

                eb.Property(s => s.SessionType)
                  .HasColumnName("session_type")
                  .HasConversion<string>()
                  .HasMaxLength(30);

                eb.Property(s => s.Status)
                  .HasColumnName("status")
                  .HasConversion<string>()
                  .HasMaxLength(30);

                eb.Property(s => s.ScheduledAt)
                  .HasColumnName("scheduled_at");

                eb.Property(s => s.Location)
                  .HasColumnName("location")
                  .HasMaxLength(150)
                  .IsRequired(false);

                eb.Property(s => s.CounselorId)
                  .HasColumnName("counselor_id");

                eb.Property(s => s.TokenNumber)
                  .HasColumnName("token_number")
                  .HasMaxLength(50)
                  .IsRequired(false);

                eb.Property(s => s.TokenPdfUrl)
                  .HasColumnName("token_pdf_url")
                  .IsRequired(false);

                eb.Property(s => s.Outcome)
                  .HasColumnName("outcome")
                  .HasConversion<string>()
                  .HasMaxLength(40);

                eb.Property(s => s.Notes)
                  .HasColumnName("notes")
                  .IsRequired(false);

                eb.Property(s => s.CreatedAt)
                  .HasColumnName("created_at")
                  .HasDefaultValueSql("now()");

                eb.Property(s => s.CompletedAt)
                  .HasColumnName("completed_at");

                eb.HasOne(s => s.Case)
                  .WithMany(c => c.Sessions)
                  .HasForeignKey(s => s.CaseId)
                  .HasConstraintName("fk_counsellingsessions_caseid")
                  .OnDelete(DeleteBehavior.Cascade);
            });

            base.OnModelCreating(modelBuilder);
        }

        private static void ConfigureMarketing(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<MarketingProspect>(e => { e.ToTable("marketing_prospects"); e.HasKey(x => x.Id); e.HasIndex(x => x.PublicEmail); e.HasIndex(x => new { x.Status, x.DoNotContact }); e.HasIndex(x => x.Country); });
            modelBuilder.Entity<MarketingCampaign>(e => { e.ToTable("marketing_campaigns"); e.HasKey(x => x.Id); e.Property(x => x.ChannelsJson).HasColumnType("jsonb"); e.Property(x => x.AudienceJson).HasColumnType("jsonb"); e.Property(x => x.WhatsAppContentVariablesJson).HasColumnType("jsonb"); e.HasIndex(x => new { x.Status, x.NextRunAtUtc }); });
            modelBuilder.Entity<WhatsAppContactState>(e => { e.ToTable("whatsapp_contact_states"); e.HasKey(x => x.PhoneE164); e.HasIndex(x => x.LastInboundMessageSid).IsUnique().HasFilter("\"LastInboundMessageSid\" IS NOT NULL"); });
            modelBuilder.Entity<MarketingOutreach>(e => { e.ToTable("marketing_outreach"); e.HasKey(x => x.Id); e.HasOne(x => x.Campaign).WithMany(x => x.Outreach).HasForeignKey(x => x.CampaignId).OnDelete(DeleteBehavior.Cascade); e.HasOne(x => x.Prospect).WithMany().HasForeignKey(x => x.ProspectId).OnDelete(DeleteBehavior.Cascade); e.HasIndex(x => new { x.CampaignId, x.ProspectId, x.Channel, x.AttemptNumber }).IsUnique(); e.HasIndex(x => new { x.Status, x.AttemptedAtUtc }); e.HasIndex(x => new { x.Channel, x.Status }); });
            modelBuilder.Entity<MarketingCommunicationEvent>(e => { e.ToTable("marketing_communication_events"); e.HasKey(x => x.Id); e.Property(x => x.MetadataJson).HasColumnType("jsonb"); e.HasOne(x => x.Outreach).WithMany(x => x.Events).HasForeignKey(x => x.OutreachId).OnDelete(DeleteBehavior.Cascade); e.HasIndex(x => new { x.OutreachId, x.EventAtUtc }); e.HasIndex(x => x.ProviderEventId); });
            modelBuilder.Entity<MarketingLead>(e => { e.ToTable("marketing_leads"); e.HasKey(x => x.Id); e.HasOne(x => x.Prospect).WithMany().HasForeignKey(x => x.ProspectId).OnDelete(DeleteBehavior.Restrict); e.HasIndex(x => x.ProspectId).IsUnique(); });
            modelBuilder.Entity<MarketingQuote>(e => { e.ToTable("marketing_quotes"); e.HasKey(x => x.Id); e.Property(x => x.Amount).HasColumnType("numeric(14,2)"); e.Property(x => x.LineItemsJson).HasColumnType("jsonb"); e.HasIndex(x => x.QuoteNumber).IsUnique(); e.HasIndex(x => x.AcceptanceToken).IsUnique(); e.HasOne(x => x.Lead).WithMany(x => x.Quotes).HasForeignKey(x => x.LeadId).OnDelete(DeleteBehavior.Cascade); });
            modelBuilder.Entity<MarketingOrder>(e => { e.ToTable("marketing_orders"); e.HasKey(x => x.Id); e.HasIndex(x => x.QuoteId).IsUnique(); e.HasOne(x => x.Quote).WithOne(x => x.Order).HasForeignKey<MarketingOrder>(x => x.QuoteId).OnDelete(DeleteBehavior.Cascade); e.HasOne(x => x.Tenant).WithMany().HasForeignKey(x => x.TenantId).OnDelete(DeleteBehavior.SetNull); });
            modelBuilder.Entity<MarketingDiscoverySchedule>(e => { e.ToTable("marketing_discovery_schedules"); e.HasKey(x => x.Id); e.HasIndex(x => new { x.Enabled, x.NextRunAtUtc }); });
            modelBuilder.Entity<MarketingDiscoveryRun>(e => { e.ToTable("marketing_discovery_runs"); e.HasKey(x => x.Id); e.HasOne(x => x.Schedule).WithMany().HasForeignKey(x => x.ScheduleId).OnDelete(DeleteBehavior.SetNull); e.HasIndex(x => x.StartedAtUtc); });
        }
    }
}
