-- Profit-target catalogue: customer-facing prices optimized for at least a
-- 30% Year-1 base-case operating margin in the Mahima profitability model.
-- Safe to run repeatedly against both app and beta databases.
UPDATE public.module_catalog
SET monthly_price_inr = CASE code
    WHEN 'base' THEN 0
    WHEN 'chat' THEN 1249
    WHEN 'operations' THEN 1999
    WHEN 'care_ministry' THEN 1499
    WHEN 'admin_tools' THEN 1749
    WHEN 'communications' THEN 1499
    ELSE monthly_price_inr
END,
updated_at_utc = now()
WHERE code IN ('base','chat','operations','care_ministry','admin_tools','communications');

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
updated_at_utc = now()
WHERE is_base_free_plan
   OR lower(code) IN ('base','base-free','essentials','chat','jai-masih-chat','operations','care','care_ministry','administration','admin_tools','communications','mahima-complete')
   OR lower(name) LIKE ANY (ARRAY['%essential%','%chat%','%operations%','%care ministry%','%administration%','%communications%'])
   OR lower(name) = 'mahima complete';

-- Published package cards are read from immutable JSON snapshots. Refresh the
-- latest snapshot for each recognised catalogue package so authenticated
-- subscription pages show the same price and included resources.
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
