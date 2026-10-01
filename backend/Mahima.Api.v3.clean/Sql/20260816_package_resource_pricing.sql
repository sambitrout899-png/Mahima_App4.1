ALTER TABLE public.subscription_plans
    ADD COLUMN IF NOT EXISTS storage_limit_gb numeric(12,2) NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS ai_tokens_included_monthly bigint NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS storage_overage_price_per_gb_inr numeric(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ai_overage_price_per_million_tokens_inr numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.subscription_plans
    ADD COLUMN IF NOT EXISTS ai_credits_included_inr numeric(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ai_overage_markup_multiplier numeric(6,2) NOT NULL DEFAULT 2.5;

UPDATE public.subscription_plans
SET monthly_price_inr = 0,
    storage_limit_gb = 10
WHERE is_base_free_plan = true;

ALTER TABLE public.subscription_plans
    DROP CONSTRAINT IF EXISTS ck_subscription_plans_resource_pricing;
ALTER TABLE public.subscription_plans
    ADD CONSTRAINT ck_subscription_plans_resource_pricing CHECK (
        storage_limit_gb > 0 AND
        ai_tokens_included_monthly >= 0 AND
        storage_overage_price_per_gb_inr >= 0 AND
        ai_overage_price_per_million_tokens_inr >= 0 AND
        ai_credits_included_inr >= 0 AND
        ai_overage_markup_multiplier >= 1 AND
        (is_base_free_plan = false OR (monthly_price_inr = 0 AND storage_limit_gb = 10))
    );
