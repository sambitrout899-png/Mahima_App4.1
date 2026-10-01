using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Mahima.Api.v3.clean.Data;
using Mahima.Api.v3.clean.Models;
using Microsoft.EntityFrameworkCore;

namespace Mahima.Api.v3.clean.Services
{
    public class LicensingService : ILicensingService
    {
        public const string BaseModule = "base";
        public const string ChatModule = "chat";
        public const string OperationsModule = "operations";
        public const string CareMinistryModule = "care_ministry";
        public const string AdminToolsModule = "admin_tools";
        public const string CommunicationsModule = "communications";

        private readonly MahimaDbContext _db;

        public LicensingService(MahimaDbContext db)
        {
            _db = db;
        }

        public async Task EnsureCatalogSeededAsync(CancellationToken ct = default)
        {
            // Published-package pricing is normalized in the entitlement response.
            // Database catalogue migrations run separately and must never make a read endpoint fail.
            var runSchemaMigrationDuringCatalogSeed = false;
            if (runSchemaMigrationDuringCatalogSeed) await _db.Database.ExecuteSqlRawAsync("""
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'draft';
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS contract_months integer NOT NULL DEFAULT 12;
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS early_exit_penalty_percent numeric(5,2) NOT NULL DEFAULT 10;
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS storage_limit_gb numeric(12,2) NOT NULL DEFAULT 10;
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS storage_overage_price_per_gb_inr numeric(12,2) NOT NULL DEFAULT 0;
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS ai_tokens_included_monthly bigint NOT NULL DEFAULT 0;
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS ai_overage_price_per_million_tokens_inr numeric(12,2) NOT NULL DEFAULT 0;
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS ai_credits_included_inr numeric(12,2) NOT NULL DEFAULT 0;
                ALTER TABLE public.subscription_plans
                    ADD COLUMN IF NOT EXISTS ai_overage_markup_multiplier numeric(6,2) NOT NULL DEFAULT 2.5;
                UPDATE public.subscription_plans
                SET lifecycle_status = 'published'
                WHERE published_version > 0
                  AND published_at_utc IS NOT NULL
                  AND lifecycle_status = 'draft'
                  AND updated_at_utc <= published_at_utc;
                """, ct);
            var modules = new[]
            {
                new ModuleCatalogItem { Code = BaseModule, Name = "Free Essentials", Description = "Home, public landing page, landing editor, users, prayer requests, sermons, teams, and app downloads.", MonthlyPriceInr = 0, IsBaseModule = true, DisplayOrder = 10 },
                new ModuleCatalogItem { Code = ChatModule, Name = "Jai Masih Chat", Description = "Direct chat, group chat, voice notes, calls, and chat safety.", MonthlyPriceInr = 1249, IsBaseModule = false, DisplayOrder = 20 },
                new ModuleCatalogItem { Code = OperationsModule, Name = "Operations Suite", Description = "Tasks, attendance, payroll, costs, accounting, reports, and audit trail.", MonthlyPriceInr = 1999, IsBaseModule = false, DisplayOrder = 30 },
                new ModuleCatalogItem { Code = CareMinistryModule, Name = "Care Ministry Suite", Description = "AI Pastor, marriage, baptism, counselling, and pastoral care workflows.", MonthlyPriceInr = 1499, IsBaseModule = false, DisplayOrder = 40 },
                new ModuleCatalogItem { Code = AdminToolsModule, Name = "Administration Suite", Description = "Roles, pages, admin dashboard, live users, languages, and multi-tenant administration.", MonthlyPriceInr = 1749, IsBaseModule = false, DisplayOrder = 50 },
                new ModuleCatalogItem { Code = CommunicationsModule, Name = "Communications Suite", Description = "Message center, email, Google Drive, and server files.", MonthlyPriceInr = 1499, IsBaseModule = false, DisplayOrder = 60 },
            };

            foreach (var module in modules)
            {
                var existing = await _db.ModuleCatalog.FirstOrDefaultAsync(m => m.Code == module.Code, ct);
                if (existing == null)
                {
                    _db.ModuleCatalog.Add(module);
                    continue;
                }

                existing.Name = module.Name;
                existing.Description = module.Description;
                existing.MonthlyPriceInr = module.MonthlyPriceInr;
                existing.IsBaseModule = module.IsBaseModule;
                existing.DisplayOrder = module.DisplayOrder;
                existing.Enabled = true;
                existing.UpdatedAtUtc = DateTime.UtcNow;
            }

            var legacyCodes = new[] { "payroll", "accounting", "automation" };
            var legacyModules = await _db.ModuleCatalog
                .Where(m => legacyCodes.Contains(m.Code))
                .ToListAsync(ct);
            foreach (var legacy in legacyModules)
            {
                legacy.Enabled = false;
                legacy.UpdatedAtUtc = DateTime.UtcNow;
            }
            var legacyPlanModules = await _db.SubscriptionPlanModules
                .Where(pm => legacyCodes.Contains(pm.ModuleCode))
                .ToListAsync(ct);
            if (legacyPlanModules.Count > 0)
                _db.SubscriptionPlanModules.RemoveRange(legacyPlanModules);

            var basePlan = await _db.SubscriptionPlans.FirstOrDefaultAsync(p => p.Code == "base-free", ct);
            if (basePlan == null)
            {
                basePlan = new SubscriptionPlan
                {
                    Code = "base-free",
                    Name = "Base Free",
                    Description = "Zero-priced plan matching today's member experience.",
                    MonthlyPriceInr = 0,
                    IsBaseFreePlan = true,
                    DisplayOrder = 10,
                };
                _db.SubscriptionPlans.Add(basePlan);
                await _db.SaveChangesAsync(ct);
            }

            var existingBasePlanModule = await _db.SubscriptionPlanModules
                .AnyAsync(pm => pm.PlanId == basePlan.Id && pm.ModuleCode == BaseModule, ct);
            if (!existingBasePlanModule)
                _db.SubscriptionPlanModules.Add(new SubscriptionPlanModule { PlanId = basePlan.Id, ModuleCode = BaseModule });

            await _db.SaveChangesAsync(ct);

            var synchronizePublishedPricingDuringRequest = false;
            if (synchronizePublishedPricingDuringRequest) await _db.Database.ExecuteSqlRawAsync("""
                UPDATE public.subscription_plans
                SET monthly_price_inr = CASE
                    WHEN is_base_free_plan OR lower(code) IN ('base','base-free','essentials') OR lower(name) LIKE '%essential%' THEN 0
                    WHEN lower(code) IN ('chat','jai-masih-chat') OR lower(name) LIKE '%chat%' THEN 1249
                    WHEN lower(code) = 'operations' OR lower(name) LIKE '%operations%' THEN 1999
                    WHEN lower(code) IN ('care','care_ministry') OR lower(name) LIKE '%care ministry%' THEN 1499
                    WHEN lower(code) IN ('administration','admin_tools') OR lower(name) LIKE '%administration%' THEN 1749
                    WHEN lower(code) = 'communications' OR lower(name) LIKE '%communications%' THEN 1499
                    WHEN lower(code) = 'mahima-complete' OR lower(name) = 'mahima complete' THEN 6249
                    ELSE monthly_price_inr
                END,
                storage_limit_gb = CASE
                    WHEN is_base_free_plan OR lower(code) IN ('base','base-free','essentials') OR lower(name) LIKE '%essential%' THEN 10
                    WHEN lower(code) IN ('chat','jai-masih-chat') OR lower(name) LIKE '%chat%' THEN 10
                    WHEN lower(code) = 'operations' OR lower(name) LIKE '%operations%' THEN 20
                    WHEN lower(code) IN ('care','care_ministry') OR lower(name) LIKE '%care ministry%' THEN 10
                    WHEN lower(code) IN ('administration','admin_tools') OR lower(name) LIKE '%administration%' THEN 10
                    WHEN lower(code) = 'communications' OR lower(name) LIKE '%communications%' THEN 25
                    WHEN lower(code) = 'mahima-complete' OR lower(name) = 'mahima complete' THEN 100
                    ELSE storage_limit_gb
                END,
                ai_credits_included_inr = CASE
                    WHEN is_base_free_plan OR lower(code) IN ('base','base-free','essentials') OR lower(name) LIKE '%essential%' THEN 10
                    WHEN lower(code) IN ('chat','jai-masih-chat') OR lower(name) LIKE '%chat%' THEN 25
                    WHEN lower(code) = 'operations' OR lower(name) LIKE '%operations%' THEN 20
                    WHEN lower(code) IN ('care','care_ministry') OR lower(name) LIKE '%care ministry%' THEN 100
                    WHEN lower(code) IN ('administration','admin_tools') OR lower(name) LIKE '%administration%' THEN 20
                    WHEN lower(code) = 'communications' OR lower(name) LIKE '%communications%' THEN 30
                    WHEN lower(code) = 'mahima-complete' OR lower(name) = 'mahima complete' THEN 250
                    ELSE ai_credits_included_inr
                END,
                storage_overage_price_per_gb_inr = 49,
                ai_overage_markup_multiplier = 2.5,
                updated_at_utc = now()
                WHERE is_base_free_plan
                   OR lower(code) IN ('base','base-free','essentials','chat','jai-masih-chat','operations','care','care_ministry','administration','admin_tools','communications','mahima-complete')
                   OR lower(name) LIKE ANY (ARRAY['%essential%','%chat%','%operations%','%care ministry%','%administration%','%communications%'])
                   OR lower(name) = 'mahima complete';

                DO $pricing$
                BEGIN
                    IF to_regclass('public.subscription_plan_publications') IS NOT NULL THEN
                        WITH latest AS (
                            SELECT publication.plan_id, MAX(publication.version) AS version
                            FROM public.subscription_plan_publications publication
                            GROUP BY publication.plan_id
                        ), priced AS (
                            SELECT publication.plan_id,
                                   publication.version,
                                   CASE
                                       WHEN lower(publication.definition_json->>'Code') IN ('chat','jai-masih-chat') OR lower(publication.definition_json->>'Name') LIKE '%chat%' THEN 1249
                                       WHEN lower(publication.definition_json->>'Code') = 'operations' OR lower(publication.definition_json->>'Name') LIKE '%operations%' THEN 1999
                                       WHEN lower(publication.definition_json->>'Code') IN ('care','care_ministry') OR lower(publication.definition_json->>'Name') LIKE '%care ministry%' THEN 1499
                                       WHEN lower(publication.definition_json->>'Code') IN ('administration','admin_tools') OR lower(publication.definition_json->>'Name') LIKE '%administration%' THEN 1749
                                       WHEN lower(publication.definition_json->>'Code') = 'communications' OR lower(publication.definition_json->>'Name') LIKE '%communications%' THEN 1499
                                       WHEN lower(publication.definition_json->>'Code') = 'mahima-complete' OR lower(publication.definition_json->>'Name') = 'mahima complete' THEN 6249
                                       ELSE NULL
                                   END AS price,
                                   CASE
                                       WHEN lower(publication.definition_json->>'Code') = 'operations' OR lower(publication.definition_json->>'Name') LIKE '%operations%' THEN 20
                                       WHEN lower(publication.definition_json->>'Code') = 'communications' OR lower(publication.definition_json->>'Name') LIKE '%communications%' THEN 25
                                       WHEN lower(publication.definition_json->>'Code') = 'mahima-complete' OR lower(publication.definition_json->>'Name') = 'mahima complete' THEN 100
                                       ELSE 10
                                   END AS storage_gb,
                                   CASE
                                       WHEN lower(publication.definition_json->>'Code') IN ('chat','jai-masih-chat') OR lower(publication.definition_json->>'Name') LIKE '%chat%' THEN 25
                                       WHEN lower(publication.definition_json->>'Code') = 'operations' OR lower(publication.definition_json->>'Name') LIKE '%operations%' THEN 20
                                       WHEN lower(publication.definition_json->>'Code') IN ('care','care_ministry') OR lower(publication.definition_json->>'Name') LIKE '%care ministry%' THEN 100
                                       WHEN lower(publication.definition_json->>'Code') IN ('administration','admin_tools') OR lower(publication.definition_json->>'Name') LIKE '%administration%' THEN 20
                                       WHEN lower(publication.definition_json->>'Code') = 'communications' OR lower(publication.definition_json->>'Name') LIKE '%communications%' THEN 30
                                       WHEN lower(publication.definition_json->>'Code') = 'mahima-complete' OR lower(publication.definition_json->>'Name') = 'mahima complete' THEN 250
                                       ELSE 0
                                   END AS ai_credits
                            FROM public.subscription_plan_publications publication
                            JOIN latest ON latest.plan_id = publication.plan_id AND latest.version = publication.version
                        )
                        UPDATE public.subscription_plan_publications publication
                        SET definition_json = jsonb_set(
                            jsonb_set(
                                jsonb_set(
                                    jsonb_set(
                                        jsonb_set(publication.definition_json, '{MonthlyPriceInr}', to_jsonb(priced.price), true),
                                        '{StorageLimitGb}', to_jsonb(priced.storage_gb), true),
                                    '{AiCreditsIncludedInr}', to_jsonb(priced.ai_credits), true),
                                '{StorageOveragePricePerGbInr}', '49'::jsonb, true),
                            '{AiOverageMarkupMultiplier}', '2.5'::jsonb, true)
                        FROM priced
                        WHERE publication.plan_id = priced.plan_id
                          AND publication.version = priced.version
                          AND priced.price IS NOT NULL;
                    END IF;
                END $pricing$;
                """, ct);
        }

        public async Task<bool> HasModuleAsync(Guid tenantId, string moduleCode, CancellationToken ct = default)
        {
            if (tenantId == Guid.Empty || string.IsNullOrWhiteSpace(moduleCode)) return false;
            var code = moduleCode.Trim().ToLowerInvariant();

            var module = await _db.ModuleCatalog.AsNoTracking().FirstOrDefaultAsync(m => m.Code == code && m.Enabled, ct);
            if (module?.IsBaseModule == true) return true;

            var now = DateTime.UtcNow;
            var availablePlanIds = await _db.SubscriptionPlans.AsNoTracking()
                .Where(p => p.Enabled && p.LifecycleStatus == "published")
                .Select(p => p.Id).ToListAsync(ct);
            var availableSources = availablePlanIds.Select(id => $"plan:{id:N}"[..32]).ToArray();
            return await _db.TenantModuleLicenses.AsNoTracking().AnyAsync(l =>
                l.TenantId == tenantId &&
                l.ModuleCode == code &&
                l.Status == "active" &&
                (!l.Source.StartsWith("plan:") || availableSources.Contains(l.Source)) &&
                l.StartsAtUtc <= now &&
                (l.EndsAtUtc == null || l.EndsAtUtc > now), ct);
        }

        public async Task ActivateModuleAsync(Guid tenantId, string moduleCode, decimal priceInr, string source, Guid? paymentId = null, CancellationToken ct = default)
        {
            if (tenantId == Guid.Empty) throw new ArgumentException("tenantId is required", nameof(tenantId));
            if (string.IsNullOrWhiteSpace(moduleCode)) throw new ArgumentException("moduleCode is required", nameof(moduleCode));

            var code = moduleCode.Trim().ToLowerInvariant();
            var now = DateTime.UtcNow;
            var existing = await _db.TenantModuleLicenses
                .FirstOrDefaultAsync(l => l.TenantId == tenantId && l.ModuleCode == code && l.Status == "active", ct);

            if (existing == null)
            {
                _db.TenantModuleLicenses.Add(new TenantModuleLicense
                {
                    TenantId = tenantId,
                    ModuleCode = code,
                    Status = "active",
                    PriceInr = priceInr,
                    Source = string.IsNullOrWhiteSpace(source) ? "manual" : source.Trim().ToLowerInvariant(),
                    ActivatedByPaymentId = paymentId,
                    StartsAtUtc = now,
                    CreatedAtUtc = now,
                    UpdatedAtUtc = now
                });
            }
            else
            {
                existing.PriceInr = priceInr;
                existing.Source = string.IsNullOrWhiteSpace(source) ? existing.Source : source.Trim().ToLowerInvariant();
                existing.ActivatedByPaymentId = paymentId ?? existing.ActivatedByPaymentId;
                existing.EndsAtUtc = null;
                existing.UpdatedAtUtc = now;
            }

            await _db.SaveChangesAsync(ct);
        }
    }
}
