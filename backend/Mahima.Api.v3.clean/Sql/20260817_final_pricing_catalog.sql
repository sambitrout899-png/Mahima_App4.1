-- Final Mahima catalogue approved 2026-08-17. Safe to run repeatedly.
ALTER TABLE public.subscription_plans
    ADD COLUMN IF NOT EXISTS storage_limit_gb numeric(12,2) NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS ai_credits_included_inr numeric(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ai_overage_markup_multiplier numeric(6,2) NOT NULL DEFAULT 2.5,
    ADD COLUMN IF NOT EXISTS storage_overage_price_per_gb_inr numeric(12,2) NOT NULL DEFAULT 49;

UPDATE public.module_catalog SET name='Free Essentials', monthly_price_inr=0, updated_at_utc=now() WHERE code='base';
UPDATE public.module_catalog SET monthly_price_inr=1249, updated_at_utc=now() WHERE code='chat';
UPDATE public.module_catalog SET monthly_price_inr=1999, updated_at_utc=now() WHERE code='operations';
UPDATE public.module_catalog SET monthly_price_inr=1499, updated_at_utc=now() WHERE code='care_ministry';
UPDATE public.module_catalog SET monthly_price_inr=1749, updated_at_utc=now() WHERE code='admin_tools';
UPDATE public.module_catalog SET monthly_price_inr=1499, updated_at_utc=now() WHERE code='communications';

UPDATE public.subscription_plans p SET monthly_price_inr=0, storage_limit_gb=10, ai_credits_included_inr=10, storage_overage_price_per_gb_inr=49, ai_overage_markup_multiplier=2.5, updated_at_utc=now()
WHERE p.is_base_free_plan OR lower(p.code) IN ('base','base-free','essentials') OR lower(p.name) LIKE '%essential%';
UPDATE public.subscription_plans p SET monthly_price_inr=1249, storage_limit_gb=10, ai_credits_included_inr=25, storage_overage_price_per_gb_inr=49, ai_overage_markup_multiplier=2.5, updated_at_utc=now()
WHERE lower(p.code) IN ('chat','jai-masih-chat') OR lower(p.name) LIKE '%chat%';
UPDATE public.subscription_plans p SET monthly_price_inr=1999, storage_limit_gb=20, ai_credits_included_inr=20, storage_overage_price_per_gb_inr=49, ai_overage_markup_multiplier=2.5, updated_at_utc=now()
WHERE lower(p.code)='operations' OR lower(p.name) LIKE '%operations%';
UPDATE public.subscription_plans p SET monthly_price_inr=1499, storage_limit_gb=10, ai_credits_included_inr=100, storage_overage_price_per_gb_inr=49, ai_overage_markup_multiplier=2.5, updated_at_utc=now()
WHERE lower(p.code) IN ('care','care_ministry') OR lower(p.name) LIKE '%care ministry%';
UPDATE public.subscription_plans p SET monthly_price_inr=1749, storage_limit_gb=10, ai_credits_included_inr=20, storage_overage_price_per_gb_inr=49, ai_overage_markup_multiplier=2.5, updated_at_utc=now()
WHERE lower(p.code) IN ('administration','admin_tools') OR lower(p.name) LIKE '%administration%';
UPDATE public.subscription_plans p SET monthly_price_inr=1499, storage_limit_gb=25, ai_credits_included_inr=30, storage_overage_price_per_gb_inr=49, ai_overage_markup_multiplier=2.5, updated_at_utc=now()
WHERE lower(p.code)='communications' OR lower(p.name) LIKE '%communications%';

INSERT INTO public.subscription_plans (id,code,name,description,monthly_price_inr,is_base_free_plan,enabled,display_order,lifecycle_status,contract_months,early_exit_penalty_percent,storage_limit_gb,ai_credits_included_inr,ai_overage_markup_multiplier,storage_overage_price_per_gb_inr,created_at_utc,updated_at_utc)
VALUES ('00000000-0000-0000-0000-000000000107','mahima-complete','Mahima Complete','Every currently published Mahima package with priority support.',6249,false,true,70,'draft',12,10,100,250,2.5,49,now(),now())
ON CONFLICT (code) DO UPDATE SET name=excluded.name,description=excluded.description,monthly_price_inr=excluded.monthly_price_inr,storage_limit_gb=excluded.storage_limit_gb,ai_credits_included_inr=excluded.ai_credits_included_inr,ai_overage_markup_multiplier=excluded.ai_overage_markup_multiplier,storage_overage_price_per_gb_inr=excluded.storage_overage_price_per_gb_inr,updated_at_utc=now();

INSERT INTO public.subscription_plan_modules(plan_id,module_code)
SELECT '00000000-0000-0000-0000-000000000107', code FROM public.module_catalog WHERE enabled
ON CONFLICT DO NOTHING;
